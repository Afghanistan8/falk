"""Silent counterparties, lapse, recovery gates, ABI hygiene, views."""

import ast
import json
import re

import pytest

from conftest import create_args, drive
from support import CONTRACT, CT_BOND, MIN, OP_BOND, PAYMENT, WINDOWS

DAY = 24 * 60 * MIN
SOURCE = CONTRACT.read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)


def refused(world, text):
    return world.vm.expect_revert(text)


def public_methods():
    out = {"write": [], "view": []}
    for node in ast.walk(TREE):
        if isinstance(node, ast.ClassDef) and node.name == "Falk":
            for fn in node.body:
                if isinstance(fn, ast.FunctionDef):
                    for dec in fn.decorator_list:
                        text = ast.unparse(dec)
                        if text.startswith("gl.public.write"):
                            out["write"].append(fn)
                        elif text.startswith("gl.public.view"):
                            out["view"].append(fn)
    return out


# --- silent client: unreviewed delivery -------------------------------------
def test_operator_claims_after_review_window(world, delivered):
    world.advance(WINDOWS["review"] + 1)
    world.as_(world.bob)
    world.c.claim_unreviewed_delivery(delivered)
    m = world.c.get_mandate(delivered)
    assert m["status"] == "APPROVED" and m["approval_kind"] == "UNREVIEWED"
    world.as_(world.dave)
    world.c.settle(delivered)
    assert world.c.get_settlement(delivered)["path"] == "UNREVIEWED"
    assert world.sent_to(world.bob) == PAYMENT + OP_BOND


def test_claim_before_review_window_ends_is_refused(world, delivered):
    world.as_(world.bob)
    with refused(world, "review window is still open"):
        world.c.claim_unreviewed_delivery(delivered)


def test_claim_only_by_operator(world, delivered):
    world.advance(WINDOWS["review"] + 1)
    world.as_(world.alice)
    with refused(world, "only the operator"):
        world.c.claim_unreviewed_delivery(delivered)


def test_claim_is_impossible_once_contested(world, contested):
    world.advance(WINDOWS["review"] + 1)
    world.as_(world.bob)
    with refused(world, "needs DELIVERED"):
        world.c.claim_unreviewed_delivery(contested)


def test_client_can_still_approve_after_review_window(world, delivered):
    world.advance(WINDOWS["review"] + 1)
    world.as_(world.alice)
    world.c.approve_work(delivered)
    assert world.c.get_mandate(delivered)["approval_kind"] == "CLIENT"


def test_contest_loses_to_unreviewed_claim_race(world, delivered):
    world.advance(WINDOWS["review"] + 1)
    world.as_(world.alice, CT_BOND)
    with refused(world, "review window has closed"):
        world.c.open_contest(delivered, '["C1"]', "late")


# --- silent operator: lapse and recover -------------------------------------
def test_lapse_after_deadline_then_recover_returns_payment_and_bond(world, engaged):
    world.advance(WINDOWS["execution"] + 1)
    world.as_(world.dave)
    world.c.lapse_mandate(engaged)
    assert world.c.get_mandate(engaged)["status"] == "LAPSED"
    world.c.recover_escrow(engaged)
    assert world.sent_to(world.alice) == PAYMENT and world.sent_to(world.bob) == OP_BOND
    assert world.c.get_mandate(engaged)["status"] == "RECOVERED"
    assert world.c.get_mandate(engaged)["custody_held"] == "0"


def test_lapse_before_deadline_is_refused(world, engaged):
    with refused(world, "execution deadline has not passed"):
        world.c.lapse_mandate(engaged)


def test_lapse_requires_engagement(world, funded):
    world.advance(WINDOWS["execution"] * 3)
    with refused(world, "needs ENGAGED"):
        world.c.lapse_mandate(funded)


def test_lapse_forfeit_policy_sends_bond_to_client(world):
    world.as_(world.alice)
    mid = world.c.create_mandate(**create_args(world.hex(world.bob),
                                               policy_json=json.dumps({"LAPSE_BOND": "FORFEIT"})))
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(mid)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(mid)
    world.advance(WINDOWS["execution"] + 1)
    world.c.lapse_mandate(mid)
    world.c.recover_escrow(mid)
    assert world.sent_to(world.alice) == PAYMENT + OP_BOND and world.sent_to(world.bob) == 0


def test_recover_cannot_run_twice(world, engaged):
    world.advance(WINDOWS["execution"] + 1)
    world.c.lapse_mandate(engaged)
    world.c.recover_escrow(engaged)
    with refused(world, "needs LAPSED or FINALIZED or RECORD_SEALED"):
        world.c.recover_escrow(engaged)
    assert world.total_sent() == PAYMENT + OP_BOND


def test_lapse_twice_is_refused(world, engaged):
    world.advance(WINDOWS["execution"] + 1)
    world.c.lapse_mandate(engaged)
    with refused(world, "needs ENGAGED"):
        world.c.lapse_mandate(engaged)


@pytest.mark.parametrize("fixture_name", ["drafted", "funded", "engaged", "delivered", "contested"])
def test_recover_unavailable_in_live_states(request, world, fixture_name):
    mid = request.getfixturevalue(fixture_name)
    world.advance(100 * DAY)
    with pytest.raises(Exception):
        world.c.recover_escrow(mid)
    assert world.total_sent() == 0


# --- stalled panel ----------------------------------------------------------
def test_recover_unavailable_while_panel_has_time(world, sealed):
    world.advance(13 * DAY)
    with refused(world, "panel still has time"):
        world.c.recover_escrow(sealed)


def test_stalled_panel_recovers_each_party_their_own(world, sealed):
    world.advance(14 * DAY + 1)
    world.as_(world.dave)
    world.c.recover_escrow(sealed)
    assert world.sent_to(world.alice) == PAYMENT + CT_BOND
    assert world.sent_to(world.bob) == OP_BOND
    assert world.c.get_settlement(sealed)["path"] == "STALLED"


def test_failed_panel_rounds_do_not_move_custody_and_do_not_extend_the_stall(world, sealed):
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": "x"})
    world.vm.mock_llm(r".*independent verification panel.*", "{}")
    world.as_(world.carol)
    for _ in range(3):
        with pytest.raises(Exception):
            world.c.adjudicate(sealed)
    assert world.total_sent() == 0
    world.advance(14 * DAY + 1)
    world.c.recover_escrow(sealed)
    assert world.total_sent() == PAYMENT + OP_BOND + CT_BOND


# --- no clock, no owner, one exit -------------------------------------------
FORBIDDEN_NAME = re.compile(r"(tick|advance|clock|wait|sleep|warp|set_time|timestamp|"
                            r"owner|admin|pause|upgrade|withdraw|sweep|rescue|drain|"
                            r"set_fee|selfdestruct|transfer|send)", re.I)
FORBIDDEN_PARAM = {"now", "now_ms", "time", "timestamp", "deadline", "recipient", "to",
                   "amount", "payee", "destination", "payout", "value_wei", "fee"}


def test_public_method_counts_match_protocol_constants():
    ms = public_methods()
    assert len(ms["write"]) == 20 and len(ms["view"]) == 11


def test_no_public_method_name_suggests_clock_owner_or_withdrawal():
    for kind in public_methods().values():
        for fn in kind:
            assert not FORBIDDEN_NAME.search(fn.name), fn.name


def test_no_public_method_takes_a_time_recipient_or_amount_parameter():
    for kind in public_methods().values():
        for fn in kind:
            params = {a.arg for a in fn.args.args}
            assert not (params & FORBIDDEN_PARAM), (fn.name, params & FORBIDDEN_PARAM)


def test_no_owner_or_admin_storage_field():
    cls = next(n for n in ast.walk(TREE) if isinstance(n, ast.ClassDef) and n.name == "Falk")
    fields = {n.target.id for n in cls.body if isinstance(n, ast.AnnAssign)}
    assert not {f for f in fields if re.search(r"owner|admin|paused|operator_key", f)}


def test_value_exits_through_exactly_one_function():
    calls = [n for n in ast.walk(TREE) if isinstance(n, ast.Attribute) and n.attr == "emit_transfer"]
    assert len(calls) == 1
    send = next(n for n in ast.walk(TREE) if isinstance(n, ast.FunctionDef) and n.name == "_send")
    assert calls[0] in list(ast.walk(send))


def test_send_is_only_called_from_close():
    callers = set()
    for fn in ast.walk(TREE):
        if isinstance(fn, ast.FunctionDef):
            for n in ast.walk(fn):
                if isinstance(n, ast.Call) and ast.unparse(n.func) == "self._send":
                    callers.add(fn.name)
    assert callers == {"_close"}


def test_close_is_only_called_from_terminal_paths():
    callers = set()
    for fn in ast.walk(TREE):
        if isinstance(fn, ast.FunctionDef):
            for n in ast.walk(fn):
                if isinstance(n, ast.Call) and ast.unparse(n.func) == "self._close":
                    callers.add(fn.name)
    assert callers == {"cancel_mandate", "settle", "accept_split", "recover_escrow"}


def test_contract_never_reads_wall_clock_or_counts_calls_as_time():
    for needle in ("time.time", "datetime.now", "datetime.utcnow", "block.number", "call_count"):
        assert needle not in SOURCE


def test_only_message_datetime_is_the_time_source():
    assert SOURCE.count('gl.message_raw["datetime"]') == 1


def test_protocol_info_reports_revision_counts_and_no_authority(world):
    info = world.c.get_protocol_info()
    assert info["revision"] == "FALK-1.0.0" and info["policy_version"] == "FALK-POLICY-1"
    assert (info["public_write_methods"], info["public_read_methods"]) == (20, 11)
    assert info["has_owner"] is False and info["has_clock_method"] is False
    assert "RECOVERED" in info["states"] and "SUCCESS_MATCH" in info["retrieval_labels"]


def test_deadlines_are_absolute_and_per_mandate(world, funded):
    other_world_mid = world.c.create_mandate(**create_args(world.hex(world.bob)))
    world.advance(5 * MIN)
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(other_world_mid)
    world.advance(1000)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(funded)
    world.advance(2 * MIN)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(other_world_mid)
    a, b = world.c.get_mandate(funded), world.c.get_mandate(other_world_mid)
    assert b["execution_deadline_at"] - a["execution_deadline_at"] == 2 * MIN


def test_activity_on_one_mandate_cannot_expire_another(world, engaged):
    world.as_(world.alice)
    other = world.c.create_mandate(**create_args(world.hex(world.bob)))
    for _ in range(25):
        world.as_(world.alice)
        world.c.update_draft(other, **create_args(world.hex(world.bob)))
    with refused(world, "execution deadline has not passed"):
        world.c.lapse_mandate(engaged)


def test_missing_transaction_datetime_is_refused(world, drafted):
    import genlayer.gl as gl
    world.as_(world.alice, PAYMENT)
    gl.message_raw["datetime"] = ""
    with refused(world, "transaction datetime unavailable"):
        world.c.fund_mandate(drafted)


def test_naive_transaction_datetime_is_refused(world, drafted):
    import genlayer.gl as gl
    world.as_(world.alice, PAYMENT)
    gl.message_raw["datetime"] = "2027-01-01T00:00:00"
    with refused(world, "must carry a timezone"):
        world.c.fund_mandate(drafted)


# --- passport ---------------------------------------------------------------
def test_passport_counts_a_clean_approval(world, delivered):
    world.as_(world.alice)
    world.c.approve_work(delivered)
    world.c.settle(delivered)
    p = world.c.get_passport(world.hex(world.bob))
    assert (p["closed"], p["clean_approvals"], p["contests_faced"]) == (1, 1, 0)
    assert p["value_verified_wei"] == str(PAYMENT)
    assert p["derived"]["clean_rate_pct"] == 100 and p["derived"]["average_score"] is None


def test_passport_counts_unreviewed_claims_separately(world, delivered):
    world.advance(WINDOWS["review"] + 1)
    world.as_(world.bob)
    world.c.claim_unreviewed_delivery(delivered)
    world.c.settle(delivered)
    p = world.c.get_passport(world.hex(world.bob))
    assert (p["clean_approvals"], p["unreviewed_claims"]) == (0, 1)


def test_passport_records_ruling_outcomes_and_average(world):
    a = drive(world, {"C1": "PASS", "C2": "FAIL", "C3": "PASS"})
    b = drive(world, {"C1": "PASS", "C2": "PASS", "C3": "PASS"})
    c = drive(world, {"C1": "FAIL", "C2": "PASS", "C3": "PASS"})
    for mid in (a, b, c):
        world.c.settle(mid)
    p = world.c.get_passport(world.hex(world.bob))
    assert (p["partial"], p["confirmed"], p["rejected"], p["critical_fails"]) == (1, 1, 1, 1)
    assert p["contests_faced"] == 3 and p["scored"] == 3 and p["score_sum"] == 65 + 100 + 60
    assert p["derived"]["average_score"] == (65 + 100 + 60) // 3


def test_passport_value_verified_excludes_returned_bond(world):
    mid = drive(world, {"C1": "PASS", "C2": "PASS", "C3": "PASS"})
    world.c.settle(mid)
    assert world.c.get_passport(world.hex(world.bob))["value_verified_wei"] == str(PAYMENT)


def test_passport_value_verified_is_zero_after_rejection(world):
    mid = drive(world, {"C1": "FAIL", "C2": "FAIL", "C3": "FAIL"})
    world.c.settle(mid)
    assert world.c.get_passport(world.hex(world.bob))["value_verified_wei"] == "0"


def test_passport_counts_lapses(world, engaged):
    world.advance(WINDOWS["execution"] + 1)
    world.c.lapse_mandate(engaged)
    assert world.c.get_passport(world.hex(world.bob))["lapses"] == 1


def test_passport_unknown_operator_is_all_zero(world):
    p = world.c.get_passport(world.hex(world.dave))
    assert p["closed"] == 0 and p["derived"]["average_score"] is None


def test_passport_does_not_change_on_unsettled_rulings(world, ruled):
    p = world.c.get_passport(world.hex(world.bob))
    assert p["closed"] == 0 and p["partial"] == 0


def test_passport_counts_appeals_filed(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    world.panel({"C1": "PASS", "C2": "PASS", "C3": "PASS"})
    world.c.adjudicate(ruled)
    world.c.finalize_ruling(ruled)
    world.c.settle(ruled)
    assert world.c.get_passport(world.hex(world.bob))["appeals_filed"] == 1


# --- views ------------------------------------------------------------------
def test_get_settlement_empty_until_closed(world, delivered):
    assert world.c.get_settlement(delivered) == {}


def test_settlement_record_balances(world):
    mid = drive(world, {"C1": "PASS", "C2": "FAIL", "C3": "PASS"})
    world.c.settle(mid)
    s = world.c.get_settlement(mid)
    assert int(s["operator_payout"]) + int(s["client_payout"]) == int(s["custody_before"])
    assert s["custody_after"] == "0"


def test_mandate_view_exposes_resolved_action_after_finalize(world):
    mid = drive(world, {"C1": "PASS", "C2": "FAIL", "C3": "PASS"})
    assert world.c.get_mandate(mid)["resolved_action"] == "PRORATA"


def test_mandate_view_custody_matches_deposits_minus_released(world, engaged):
    m = world.c.get_mandate(engaged)
    assert int(m["custody_held"]) == (int(m["payment_deposited"]) + int(m["operator_bond_deposited"])
                                     + int(m["contest_bond_deposited"]) - int(m["total_released"]))


def test_list_pages_are_clamped(world, drafted):
    page = world.c.list_mandates(0, 10_000)
    assert len(page["items"]) == 1
    assert world.c.list_mandates(-5, 0)["offset"] == 0
