"""Appeal (once, bounded), finalisation gates and ruling pinning."""

import pytest

from conftest import drive
from support import CT_BOND, MIN, OP_BOND, PAYMENT, WINDOWS

ALL_PASS = {"C1": "PASS", "C2": "PASS", "C3": "PASS"}
PARTIAL = {"C1": "PASS", "C2": "FAIL", "C3": "PASS"}
REJECT = {"C1": "FAIL", "C2": "FAIL", "C3": "FAIL"}


def refused(world, text):
    return world.vm.expect_revert(text)


# --- appeal -----------------------------------------------------------------
def test_client_can_appeal_within_window(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    m = world.c.get_mandate(ruled)
    assert m["status"] == "APPEALED" and m["appeal_count"] == 1


def test_operator_can_appeal_within_window(world, ruled):
    world.as_(world.bob)
    world.c.appeal(ruled)
    assert world.c.get_mandate(ruled)["status"] == "APPEALED"


def test_stranger_cannot_appeal(world, ruled):
    world.as_(world.dave)
    with refused(world, "only the client or the operator"):
        world.c.appeal(ruled)


def test_appeal_after_window_is_refused(world, ruled):
    world.advance(WINDOWS["appeal"] + 2 * MIN)
    world.as_(world.alice)
    with refused(world, "appeal window has closed"):
        world.c.appeal(ruled)


def test_appeal_before_any_ruling_is_refused(world, sealed):
    world.as_(world.alice)
    with refused(world, "needs RULING"):
        world.c.appeal(sealed)


def test_second_appeal_is_refused(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    world.panel(PARTIAL)
    world.c.adjudicate(ruled)
    with refused(world, "single permitted appeal"):
        world.c.appeal(ruled)


def test_appeal_round_appends_second_ruling_and_keeps_first(world, ruled):
    first = world.c.get_ruling(ruled, 1)
    world.as_(world.alice)
    world.c.appeal(ruled)
    world.panel(ALL_PASS)
    n = world.c.adjudicate(ruled)
    rulings = world.c.list_rulings(ruled)
    assert n == 2 and [r["kind"] for r in rulings] == ["INITIAL", "APPEAL"]
    assert rulings[0] == first and rulings[1]["ruling"] == "CONFIRMED"
    assert world.c.get_mandate(ruled)["status"] == "RULING"


def test_cannot_adjudicate_a_ruling_without_an_appeal(world, ruled):
    world.panel(ALL_PASS)
    with refused(world, "needs RECORD_SEALED or APPEALED"):
        world.c.adjudicate(ruled)


def test_appeal_can_overturn_the_first_ruling(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    world.panel(REJECT)
    world.c.adjudicate(ruled)
    world.c.finalize_ruling(ruled)
    world.c.settle(ruled)
    assert world.c.get_settlement(ruled)["action"] == "RETURN"
    assert world.sent_to(world.alice) == PAYMENT + CT_BOND


def test_failed_appeal_round_leaves_state_appealed(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    world.vm.clear_mocks()
    world.vm.mock_web(r".*", {"status": 200, "body": "x"})
    world.vm.mock_llm(r".*independent verification panel.*", "{}")
    with pytest.raises(Exception):
        world.c.adjudicate(ruled)
    assert world.c.get_mandate(ruled)["status"] == "APPEALED"
    assert len(world.c.list_rulings(ruled)) == 1


# --- finalize ---------------------------------------------------------------
def test_finalize_before_appeal_window_ends_is_refused(world, ruled):
    world.as_(world.dave)
    with refused(world, "can still be appealed"):
        world.c.finalize_ruling(ruled)


def test_finalize_after_window_pins_ruling_and_opens_manual_clock(world, ruled):
    world.advance(WINDOWS["appeal"] + 1)
    world.as_(world.dave)
    world.c.finalize_ruling(ruled)
    m = world.c.get_mandate(ruled)
    assert m["status"] == "FINALIZED" and m["final_ruling_id"] == 1
    assert m["manual_deadline_at"] == world.now + WINDOWS["manual"]
    assert m["resolved_action"] == "PRORATA"


def test_finalize_immediately_after_the_appeal_round(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    world.panel(ALL_PASS)
    world.c.adjudicate(ruled)
    world.c.finalize_ruling(ruled)
    assert world.c.get_mandate(ruled)["final_ruling_id"] == 2


def test_finalize_twice_is_refused(world, ruled):
    world.advance(WINDOWS["appeal"] + 1)
    world.c.finalize_ruling(ruled)
    with refused(world, "needs RULING or APPEALED"):
        world.c.finalize_ruling(ruled)


def test_finalize_without_ruling_is_refused(world, sealed):
    with refused(world, "needs RULING or APPEALED"):
        world.c.finalize_ruling(sealed)


def test_settle_before_finalize_is_refused(world, ruled):
    with refused(world, "needs APPROVED or FINALIZED"):
        world.c.settle(ruled)
    assert world.total_sent() == 0


def test_recover_while_appealable_is_refused(world, ruled):
    world.advance(WINDOWS["manual"] * 5)
    with refused(world, "needs LAPSED or FINALIZED or RECORD_SEALED"):
        world.c.recover_escrow(ruled)
    assert world.total_sent() == 0


def test_recover_during_appeal_is_refused(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    world.advance(WINDOWS["manual"] * 5)
    with refused(world, "needs LAPSED or FINALIZED or RECORD_SEALED"):
        world.c.recover_escrow(ruled)


def test_stalled_appeal_falls_back_to_the_first_ruling(world, ruled):
    world.as_(world.alice)
    world.c.appeal(ruled)
    with refused(world, "still within its grace period"):
        world.c.finalize_ruling(ruled)
    world.advance(14 * 24 * 60 * MIN + 1)
    world.c.finalize_ruling(ruled)
    m = world.c.get_mandate(ruled)
    assert m["status"] == "FINALIZED" and m["final_ruling_id"] == 1
    world.c.settle(ruled)
    assert world.sent_to(world.bob) == PAYMENT * 65 // 100 + OP_BOND


def test_final_ruling_pins_settlement_to_that_ruling(world, ruled):
    world.as_(world.bob)
    world.c.appeal(ruled)
    world.panel(ALL_PASS)
    world.c.adjudicate(ruled)
    world.c.finalize_ruling(ruled)
    world.c.settle(ruled)
    s = world.c.get_settlement(ruled)
    assert s["ruling_id"] == 2 and s["score"] == 100 and s["action"] == "RELEASE_FULL"


# --- mutual-exit split for MANUAL_REVIEW ------------------------------------
def inconclusive(world):
    return drive(world, {"C1": "INCONCLUSIVE", "C2": "INCONCLUSIVE", "C3": "INCONCLUSIVE"})


def test_propose_then_accept_split_settles_exactly(world):
    mid = inconclusive(world)
    world.as_(world.alice)
    world.c.propose_split(mid, 30)
    world.as_(world.bob)
    world.c.accept_split(mid)
    assert world.sent_to(world.bob) == PAYMENT * 30 // 100 + OP_BOND
    assert world.sent_to(world.alice) == PAYMENT - PAYMENT * 30 // 100 + CT_BOND
    assert world.c.get_settlement(mid)["path"] == "SPLIT"


def test_proposer_cannot_accept_own_split(world):
    mid = inconclusive(world)
    world.as_(world.alice)
    world.c.propose_split(mid, 30)
    with refused(world, "cannot accept their own split"):
        world.c.accept_split(mid)


def test_accept_without_proposal_is_refused(world):
    mid = inconclusive(world)
    world.as_(world.bob)
    with refused(world, "no proposed split"):
        world.c.accept_split(mid)


def test_a_new_proposal_replaces_the_old_one(world):
    mid = inconclusive(world)
    world.as_(world.alice)
    world.c.propose_split(mid, 10)
    world.as_(world.bob)
    world.c.propose_split(mid, 90)
    with refused(world, "cannot accept their own split"):
        world.c.accept_split(mid)
    world.as_(world.alice)
    world.c.accept_split(mid)
    assert world.sent_to(world.bob) == PAYMENT * 90 // 100 + OP_BOND


@pytest.mark.parametrize("pct", [-1, 101])
def test_split_percentage_bounds(world, pct):
    mid = inconclusive(world)
    world.as_(world.alice)
    with refused(world, "whole percentage"):
        world.c.propose_split(mid, pct)


def test_stranger_cannot_propose_or_accept(world):
    mid = inconclusive(world)
    world.as_(world.dave)
    with refused(world, "only the client or the operator"):
        world.c.propose_split(mid, 50)
    with refused(world, "only the client or the operator"):
        world.c.accept_split(mid)


def test_split_after_manual_window_is_refused(world):
    mid = inconclusive(world)
    world.as_(world.alice)
    world.c.propose_split(mid, 50)
    world.advance(WINDOWS["manual"] + 1)
    world.as_(world.bob)
    with refused(world, "manual-review window has closed"):
        world.c.accept_split(mid)


def test_split_is_unavailable_for_rulings_that_settle(world):
    mid = drive(world, PARTIAL)
    world.as_(world.alice)
    with refused(world, "not in manual review"):
        world.c.propose_split(mid, 50)


def test_manual_review_default_exit_returns_each_party_their_own(world):
    mid = inconclusive(world)
    world.advance(WINDOWS["manual"] + 1)
    world.as_(world.dave)
    world.c.recover_escrow(mid)
    assert world.sent_to(world.alice) == PAYMENT + CT_BOND
    assert world.sent_to(world.bob) == OP_BOND
    assert world.c.get_mandate(mid)["status"] == "RECOVERED"


def test_manual_recovery_before_window_is_refused(world):
    mid = inconclusive(world)
    with refused(world, "manual-review window is still open"):
        world.c.recover_escrow(mid)
    assert world.total_sent() == 0


def test_recover_refused_for_rulings_that_settle(world):
    mid = drive(world, PARTIAL)
    world.advance(WINDOWS["manual"] + 1)
    with refused(world, "settles under its policy"):
        world.c.recover_escrow(mid)
