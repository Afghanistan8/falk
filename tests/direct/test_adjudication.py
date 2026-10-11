"""The consensus round: retrieval taxonomy, clamps, normalisation, validators."""

import json

import pytest

from conftest import create_args, evidence, drive
from support import (CT_BOND, IDS, MIN, OP_BOND, OTHER_BODY, PAYMENT, SEALED_BODY,
                     SEALED_COMMITMENT, WINDOWS, panel_json)

ALL_PASS = {"C1": "PASS", "C2": "PASS", "C3": "PASS"}
PARTIAL = {"C1": "PASS", "C2": "FAIL", "C3": "PASS"}


def refused(world, text):
    return world.vm.expect_revert(text)


def sealed_mandate(world, **over):
    """A sealed contest (no adjudication yet) with per-test create overrides."""
    world.as_(world.alice)
    mid = world.c.create_mandate(**create_args(world.hex(world.bob), **over))
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(mid)
    world.advance(1000)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(mid)
    return mid


def finish_to_seal(world, mid):
    world.advance(1000)
    world.as_(world.bob)
    world.c.submit_deliverable(mid, "https://op-site.example.com/d", SEALED_COMMITMENT)
    world.advance(1000)
    world.as_(world.alice, CT_BOND)
    world.c.open_contest(mid, '["C1"]', "Incomplete.")
    world.as_(world.bob)
    world.c.respond_to_contest(mid, "Complete.")
    world.c.seal_record(mid)


def adjudicate(world, mid, results=ALL_PASS, **kw):
    world.panel(results, **kw)
    world.as_(world.carol)
    return world.c.adjudicate(mid)


# --- happy path -------------------------------------------------------------
def test_adjudicate_appends_ruling_and_moves_to_ruling_state(world, sealed):
    n = adjudicate(world, sealed, PARTIAL)
    m = world.c.get_mandate(sealed)
    assert n == 1 and m["status"] == "RULING" and m["latest_ruling_id"] == 1
    assert m["appeal_deadline_at"] == world.now + WINDOWS["appeal"]


def test_ruling_score_comes_from_frozen_weights(world, sealed):
    adjudicate(world, sealed, PARTIAL)
    r = world.c.get_ruling(sealed, 1)
    assert (r["ruling"], r["score"]) == ("PARTIAL", 65)


def test_ruling_all_pass_confirmed(world, sealed):
    adjudicate(world, sealed, ALL_PASS)
    assert world.c.get_ruling(sealed, 1)["ruling"] == "CONFIRMED"


def test_ruling_keeps_reasoning_as_data_only(world, sealed):
    adjudicate(world, sealed, ALL_PASS, reasoning="long explanation")
    assert world.c.get_ruling(sealed, 1)["reasoning"] == "long explanation"


def test_ruling_records_retrieval_label_per_receipt(world, sealed):
    adjudicate(world, sealed)
    labels = set(world.c.get_ruling(sealed, 1)["retrievals"].values())
    assert labels == {"SUCCESS_MATCH"}


def test_anyone_can_run_the_round(world, sealed):
    world.panel(ALL_PASS)
    world.as_(world.dave)
    world.c.adjudicate(sealed)
    assert world.c.get_mandate(sealed)["status"] == "RULING"


@pytest.mark.parametrize("fixture_name,msg", [
    ("drafted", "needs RECORD_SEALED or APPEALED"), ("funded", "needs RECORD_SEALED"),
    ("engaged", "needs RECORD_SEALED"), ("delivered", "needs RECORD_SEALED"),
    ("contested", "needs RECORD_SEALED")])
def test_adjudicate_needs_a_sealed_record(request, world, fixture_name, msg):
    mid = request.getfixturevalue(fixture_name)
    world.panel(ALL_PASS)
    with refused(world, msg):
        world.c.adjudicate(mid)


def test_adjudicate_twice_is_refused(world, ruled):
    world.panel(ALL_PASS)
    with refused(world, "needs RECORD_SEALED or APPEALED"):
        world.c.adjudicate(ruled)
    assert len(world.c.list_rulings(ruled)) == 1


# --- invented fields --------------------------------------------------------
def test_invented_money_fields_never_reach_storage(world, sealed):
    adjudicate(world, sealed, PARTIAL, payout="999", recipient="0x" + "ab" * 20,
               percentage=100, ruling="CONFIRMED", score=100, policy="RELEASE_FULL",
               amount_wei="1")
    r = world.c.get_ruling(sealed, 1)
    blob = json.dumps(r)
    assert r["ruling"] == "PARTIAL" and r["score"] == 65
    for needle in ("payout", "recipient", "RELEASE_FULL", "amount_wei", "abab"):
        assert needle not in blob


def test_invented_ruling_and_score_cannot_move_money(world, sealed):
    adjudicate(world, sealed, PARTIAL, ruling="CONFIRMED", score=100)
    world.advance(10 * MIN)
    world.c.finalize_ruling(sealed)
    world.c.settle(sealed)
    assert world.sent_to(world.bob) == PAYMENT * 65 // 100 + OP_BOND


def test_model_cannot_name_a_recipient(world, sealed):
    adjudicate(world, sealed, ALL_PASS, recipient=world.hex(world.dave), to=world.hex(world.dave))
    world.advance(10 * MIN)
    world.c.finalize_ruling(sealed)
    world.c.settle(sealed)
    assert world.sent_to(world.dave) == 0


def test_missing_criterion_verdict_becomes_inconclusive(world, sealed):
    adjudicate(world, sealed, {"C1": "PASS", "C2": "PASS"})
    r = world.c.get_ruling(sealed, 1)
    assert [x["result"] for x in r["results"]] == ["PASS", "PASS", "INCONCLUSIVE"]


def test_unknown_verdict_word_becomes_inconclusive(world, sealed):
    adjudicate(world, sealed, {"C1": "PASS", "C2": "PASS", "C3": "APPROVED"})
    assert world.c.get_ruling(sealed, 1)["results"][2]["result"] == "INCONCLUSIVE"


def test_extra_criterion_ids_are_ignored(world, sealed):
    adjudicate(world, sealed, {**ALL_PASS, "C99": "FAIL"})
    assert world.c.get_ruling(sealed, 1)["ruling"] == "CONFIRMED"


def test_lowercase_verdicts_are_accepted(world, sealed):
    adjudicate(world, sealed, {"C1": "pass", "C2": "pass", "C3": "pass"})
    assert world.c.get_ruling(sealed, 1)["ruling"] == "CONFIRMED"


# --- retrieval taxonomy through the round -----------------------------------
def test_non_success_http_cannot_support_pass(world, sealed):
    adjudicate(world, sealed, ALL_PASS, status=404)
    r = world.c.get_ruling(sealed, 1)
    assert set(r["retrievals"].values()) == {"NON_SUCCESS_HTTP"}
    assert r["ruling"] == "INCONCLUSIVE" and sorted(r["clamped"]) == IDS


def test_content_mismatch_cannot_support_pass(world, sealed):
    adjudicate(world, sealed, ALL_PASS, body=OTHER_BODY)
    r = world.c.get_ruling(sealed, 1)
    assert set(r["retrievals"].values()) == {"CONTENT_MISMATCH"}
    assert r["ruling"] == "INCONCLUSIVE" and r["score"] == 0


def test_empty_body_cannot_support_pass(world, sealed):
    adjudicate(world, sealed, ALL_PASS, body="")
    r = world.c.get_ruling(sealed, 1)
    assert set(r["retrievals"].values()) == {"EMPTY"} and r["score"] == 0


def test_mismatched_content_text_never_reaches_the_prompt(world, sealed):
    secret = "SECRET-INJECTION-TOKEN-7781"
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": "swapped " + secret})
    world.vm.mock_llm(rf".*{secret}.*", panel_json(ALL_PASS))              # leak detector
    world.vm.mock_llm(r".*independent verification panel.*", panel_json({"C1": "FAIL", "C2": "FAIL", "C3": "FAIL"}))
    world.as_(world.carol)
    world.c.adjudicate(sealed)
    assert world.c.get_ruling(sealed, 1)["ruling"] == "REJECTED"      # detector did not fire


def test_matching_content_text_does_reach_the_prompt(world, sealed):
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": SEALED_BODY})
    world.vm.mock_llm(r".*the sealed deliverable.*", panel_json(ALL_PASS))
    world.vm.mock_llm(r".*independent verification panel.*", panel_json({"C1": "FAIL", "C2": "FAIL", "C3": "FAIL"}))
    world.as_(world.carol)
    world.c.adjudicate(sealed)
    assert world.c.get_ruling(sealed, 1)["ruling"] == "CONFIRMED"


def test_unreachable_source_cannot_support_pass(world, sealed):
    world.vm.clear_mocks()
    world.vm.mock_web(r"https://nothing-matches\.invalid/.*", {"status": 200, "body": "x"})
    world.vm.mock_llm(r".*independent verification panel.*", panel_json(ALL_PASS))
    world.as_(world.carol)
    world.c.adjudicate(sealed)
    r = world.c.get_ruling(sealed, 1)
    assert set(r["retrievals"].values()) == {"FETCH_FAIL"} and r["score"] == 0


def test_mixed_retrievals_clamp_only_unsupported_criteria(world):
    mid = sealed_mandate(world)
    world.as_(world.bob)
    evidence(world, mid, "C1", url="https://good.example.org/c1")
    evidence(world, mid, "C2", url="https://bad.example.org/c2", commitment="b" * 64)
    evidence(world, mid, "C3", url="https://good.example.org/c3")
    finish_to_seal(world, mid)
    adjudicate(world, mid, ALL_PASS)
    r = world.c.get_ruling(mid, 1)
    assert r["clamped"] == ["C2"]
    assert [x["result"] for x in r["results"]] == ["PASS", "INCONCLUSIVE", "PASS"]
    assert r["ruling"] == "PARTIAL" and r["score"] == 65


def test_criterion_with_no_receipts_cannot_pass(world):
    mid = sealed_mandate(world)
    world.as_(world.bob)
    evidence(world, mid, "C1", url="https://good.example.org/c1")
    finish_to_seal(world, mid)
    adjudicate(world, mid, ALL_PASS)
    r = world.c.get_ruling(mid, 1)
    assert r["clamped"] == ["C2", "C3"] and r["score"] == 40


def test_min_evidence_above_one_requires_enough_receipts(world):
    cl = [dict(c) for c in __import__("support").CRITERIA]
    cl[0]["min_evidence"] = 2
    mid = sealed_mandate(world, checklist_json=json.dumps(cl))
    world.as_(world.bob)
    evidence(world, mid, "C1", url="https://good.example.org/c1")
    evidence(world, mid, "C2", url="https://good.example.org/c2")
    evidence(world, mid, "C3", url="https://good.example.org/c3")
    finish_to_seal(world, mid)
    adjudicate(world, mid, ALL_PASS)
    assert "C1" in world.c.get_ruling(mid, 1)["clamped"]


def test_third_party_criterion_needs_independent_origins(world):
    cl = [dict(c) for c in __import__("support").CRITERIA]
    cl[0]["independence"] = "THIRD_PARTY"
    mid = sealed_mandate(world, checklist_json=json.dumps(cl))
    world.as_(world.bob)
    for cid in IDS:
        evidence(world, mid, cid, url=f"https://op.example.org/{cid}")        # operator hosted only
    finish_to_seal(world, mid)
    adjudicate(world, mid, ALL_PASS)
    r = world.c.get_ruling(mid, 1)
    assert "C1" in r["clamped"] and r["ruling"] == "INCONCLUSIVE"


def test_third_party_criterion_passes_with_independent_site(world):
    cl = [dict(c) for c in __import__("support").CRITERIA]
    cl[0]["independence"] = "THIRD_PARTY"
    mid = sealed_mandate(world, checklist_json=json.dumps(cl))
    world.as_(world.bob)
    evidence(world, mid, "C1", url="https://registry.example.net/c1", origin="PUBLIC_RECORD")
    evidence(world, mid, "C2", url="https://op.example.org/c2")
    evidence(world, mid, "C3", url="https://op.example.org/c3")
    finish_to_seal(world, mid)
    adjudicate(world, mid, ALL_PASS)
    assert world.c.get_ruling(mid, 1)["ruling"] == "CONFIRMED"


def test_many_pages_on_one_site_count_as_one_independent_origin(world):
    cl = [dict(c) for c in __import__("support").CRITERIA]
    cl[0]["independence"] = "THIRD_PARTY"
    cl[0]["min_evidence"] = 2
    mid = sealed_mandate(world, checklist_json=json.dumps(cl))
    world.as_(world.bob)
    evidence(world, mid, "C1", url="https://a.registry.example.net/1", origin="PUBLIC_RECORD")
    evidence(world, mid, "C1", url="https://b.registry.example.net/2", origin="PUBLIC_RECORD")
    evidence(world, mid, "C2", url="https://op.example.org/c2")
    evidence(world, mid, "C3", url="https://op.example.org/c3")
    finish_to_seal(world, mid)
    adjudicate(world, mid, ALL_PASS)
    r = world.c.get_ruling(mid, 1)
    assert "C1" in r["clamped"] and r["support"]["C1"]["independent_origins"] == 1


def test_receipt_mapped_to_one_criterion_does_not_support_another(world):
    mid = sealed_mandate(world)
    world.as_(world.bob)
    evidence(world, mid, "C1", url="https://good.example.org/c1")
    finish_to_seal(world, mid)
    adjudicate(world, mid, ALL_PASS)
    support = world.c.get_ruling(mid, 1)["support"]
    assert support["C1"]["matches"] == 1 and support["C2"]["matches"] == 0


# --- failed rounds are non-destructive --------------------------------------
@pytest.mark.parametrize("llm_reply", ["[]", '"nope"', "{}", '{"reasoning":"only prose"}'])
def test_unusable_panel_output_changes_nothing(world, sealed, llm_reply):
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": SEALED_BODY})
    world.vm.mock_llm(r".*independent verification panel.*", llm_reply)
    world.as_(world.carol)
    with pytest.raises(Exception):
        world.c.adjudicate(sealed)
    m = world.c.get_mandate(sealed)
    assert m["status"] == "RECORD_SEALED" and world.c.list_rulings(sealed) == []
    assert world.total_sent() == 0


def test_failed_round_is_retry_safe(world, sealed):
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": SEALED_BODY})
    world.vm.mock_llm(r".*independent verification panel.*", "{}")
    world.as_(world.carol)
    with pytest.raises(Exception):
        world.c.adjudicate(sealed)
    world.panel(ALL_PASS)
    world.c.adjudicate(sealed)
    assert len(world.c.list_rulings(sealed)) == 1


# --- validator consensus ----------------------------------------------------
def test_validator_agrees_with_identical_observation(world, sealed):
    adjudicate(world, sealed, PARTIAL)
    assert world.vm.run_validator() is True


def test_validator_ignores_reasoning_and_reason_differences(world, sealed):
    adjudicate(world, sealed, PARTIAL, reasoning="leader reasoning")
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": SEALED_BODY})
    other = json.loads(panel_json(PARTIAL, reasoning="a totally different explanation",
                                  evidence_quality="LOW", integrity_flags=["FABRICATED_EVIDENCE"]))
    for item in other["criterion_results"]:
        item["reason"] = "different words"
    world.vm.mock_llm(r".*independent verification panel.*", json.dumps(other))
    assert world.vm.run_validator() is True


@pytest.mark.parametrize("alt", [
    {"C1": "PASS", "C2": "PASS", "C3": "PASS"}, {"C1": "FAIL", "C2": "FAIL", "C3": "PASS"},
    {"C1": "PASS", "C2": "INCONCLUSIVE", "C3": "PASS"},
    {"C1": "PASS", "C2": "PASS", "C3": "FAIL"}])           # same ruling, different pairs
def test_validator_rejects_a_different_verdict(world, sealed, alt):
    adjudicate(world, sealed, PARTIAL)
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": SEALED_BODY})
    world.vm.mock_llm(r".*independent verification panel.*", panel_json(alt))
    assert world.vm.run_validator() is False


def test_validator_rejects_when_its_own_retrieval_differs(world, sealed):
    adjudicate(world, sealed, ALL_PASS)
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": OTHER_BODY})       # content swapped
    world.vm.mock_llm(r".*independent verification panel.*", panel_json(ALL_PASS))
    assert world.vm.run_validator() is False


def test_validator_rejects_malformed_panel_output(world, sealed):
    adjudicate(world, sealed, ALL_PASS)
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": SEALED_BODY})
    world.vm.mock_llm(r".*independent verification panel.*", "{}")
    assert world.vm.run_validator() is False


def test_validator_rejects_invented_ruling_in_leader_result(world, sealed):
    adjudicate(world, sealed, PARTIAL)
    forged = {"mandate_id": sealed, "results": [{"id": c, "result": "PASS", "reason": ""} for c in IDS],
              "clamped": [], "support": {}, "quality": "HIGH", "flags": [], "reasoning": "",
              "retrievals": {}, "ruling": "CONFIRMED", "payout": "everything"}
    assert world.vm.run_validator(leader_result=forged) is False


def test_validator_handles_leader_user_error(world, sealed):
    adjudicate(world, sealed, PARTIAL)
    assert world.vm.run_validator(leader_error=Exception("[TRANSIENT] boom")) is False


# --- ruling log -------------------------------------------------------------
def test_get_ruling_bounds(world, ruled):
    assert world.c.get_ruling(ruled, 0) == {} and world.c.get_ruling(ruled, 2) == {}
    assert world.c.get_ruling(ruled, 1)["ruling_id"] == 1


def test_ruling_fingerprint_is_stored_and_stable(world, ruled):
    r = world.c.get_ruling(ruled, 1)
    assert len(r["fingerprint"]) == 64 and world.c.list_rulings(ruled)[0]["fingerprint"] == r["fingerprint"]


def test_inconclusive_panel_leads_to_manual_review_not_payout(world):
    mid = drive(world, {"C1": "INCONCLUSIVE", "C2": "INCONCLUSIVE", "C3": "INCONCLUSIVE"})
    assert world.c.get_mandate(mid)["resolved_action"] == "MANUAL_REVIEW"
    assert world.total_sent() == 0
