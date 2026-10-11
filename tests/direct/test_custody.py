"""Exact deposits, single value exit, conservation, double-settle refusal."""

import json

import pytest

from conftest import create_args, drive
from support import CT_BOND, MIN, OP_BOND, PAYMENT, WINDOWS

ALL_PASS = {"C1": "PASS", "C2": "PASS", "C3": "PASS"}
PARTIAL = {"C1": "PASS", "C2": "FAIL", "C3": "PASS"}
CRITICAL = {"C1": "FAIL", "C2": "PASS", "C3": "PASS"}
UNSURE = {"C1": "INCONCLUSIVE", "C2": "INCONCLUSIVE", "C3": "INCONCLUSIVE"}
TOTAL = PAYMENT + OP_BOND + CT_BOND


def refused(world, text):
    return world.vm.expect_revert(text)


# --- bonds ------------------------------------------------------------------
@pytest.mark.parametrize("delta", [-1, 1, -OP_BOND])
def test_operator_bond_must_be_exact(world, funded, delta):
    world.as_(world.bob, OP_BOND + delta)
    with refused(world, "exact performance bond required"):
        world.c.accept_mandate(funded)
    assert world.c.get_mandate(funded)["status"] == "ESCROWED"


def test_accept_records_bond_in_custody(world, engaged):
    m = world.c.get_mandate(engaged)
    assert m["operator_bond_deposited"] == str(OP_BOND)
    assert m["custody_held"] == str(PAYMENT + OP_BOND)


def test_accept_only_by_operator(world, funded):
    world.as_(world.carol, OP_BOND)
    with refused(world, "only the operator"):
        world.c.accept_mandate(funded)


def test_accept_before_funding_is_refused(world, drafted):
    world.as_(world.bob, OP_BOND)
    with refused(world, "needs ESCROWED"):
        world.c.accept_mandate(drafted)


def test_accept_sets_execution_deadline_from_consensus_time(world, funded):
    world.advance(5000)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(funded)
    m = world.c.get_mandate(funded)
    assert m["execution_deadline_at"] == world.now + WINDOWS["execution"]


@pytest.mark.parametrize("delta", [-1, 1])
def test_contest_bond_must_be_exact(world, delivered, delta):
    world.as_(world.alice, CT_BOND + delta)
    with refused(world, "exact contest bond required"):
        world.c.open_contest(delivered, '["C1"]', "It failed.")
    world.as_(world.alice)
    assert world.c.get_mandate(delivered)["status"] == "DELIVERED"


# --- cancel -----------------------------------------------------------------
def test_cancel_draft_moves_nothing(world, drafted):
    world.as_(world.alice)
    world.c.cancel_mandate(drafted)
    assert world.c.get_mandate(drafted)["status"] == "CANCELLED"
    assert world.transfers == []


def test_cancel_escrowed_returns_payment_to_client(world, funded):
    world.as_(world.alice)
    world.c.cancel_mandate(funded)
    m = world.c.get_mandate(funded)
    assert m["status"] == "CANCELLED" and m["custody_held"] == "0"
    assert world.sent_to(world.alice) == PAYMENT and world.sent_to(world.bob) == 0


def test_cancel_after_engagement_is_refused(world, engaged):
    world.as_(world.alice)
    with refused(world, "needs DRAFT or ESCROWED"):
        world.c.cancel_mandate(engaged)


def test_cancel_only_by_client(world, funded):
    world.as_(world.bob)
    with refused(world, "only the client"):
        world.c.cancel_mandate(funded)


def test_cancel_twice_is_refused(world, funded):
    world.as_(world.alice)
    world.c.cancel_mandate(funded)
    with refused(world, "needs DRAFT or ESCROWED"):
        world.c.cancel_mandate(funded)
    assert world.sent_to(world.alice) == PAYMENT


# --- approve + settle -------------------------------------------------------
def test_approve_then_settle_pays_operator_in_full(world, delivered):
    world.as_(world.alice)
    world.c.approve_work(delivered)
    assert world.c.get_mandate(delivered)["status"] == "APPROVED"
    world.as_(world.carol)
    world.c.settle(delivered)
    s = world.c.get_settlement(delivered)
    assert (s["action"], s["path"]) == ("RELEASE_FULL", "CLIENT")
    assert s["operator_payout"] == str(PAYMENT + OP_BOND) and s["client_payout"] == "0"
    assert world.sent_to(world.bob) == PAYMENT + OP_BOND
    assert world.sent_to(world.alice) == 0


def test_settle_by_a_stranger_cannot_redirect_value(world, delivered):
    world.as_(world.alice)
    world.c.approve_work(delivered)
    world.as_(world.dave)
    world.c.settle(delivered)
    assert world.sent_to(world.dave) == 0
    assert world.sent_to(world.bob) == PAYMENT + OP_BOND


def test_settle_twice_is_refused_and_pays_once(world, delivered):
    world.as_(world.alice)
    world.c.approve_work(delivered)
    world.c.settle(delivered)
    with refused(world, "needs APPROVED or FINALIZED"):
        world.c.settle(delivered)
    assert world.total_sent() == PAYMENT + OP_BOND


def test_settle_zeroes_custody_before_value_leaves(world, delivered):
    world.as_(world.alice)
    world.c.approve_work(delivered)
    world.c.settle(delivered)
    m = world.c.get_mandate(delivered)
    s = world.c.get_settlement(delivered)
    assert m["custody_held"] == "0" and s["custody_after"] == "0"
    assert m["total_released"] == str(PAYMENT + OP_BOND)


def test_approve_only_by_client(world, delivered):
    world.as_(world.bob)
    with refused(world, "only the client"):
        world.c.approve_work(delivered)


def test_settle_before_approval_is_refused(world, delivered):
    world.as_(world.alice)
    with refused(world, "needs APPROVED or FINALIZED"):
        world.c.settle(delivered)


def test_settle_unfunded_is_refused(world, drafted):
    with refused(world, "needs APPROVED or FINALIZED"):
        world.c.settle(drafted)


# --- outcome payouts --------------------------------------------------------
def test_confirmed_ruling_releases_full(world):
    mid = drive(world, ALL_PASS)
    world.c.settle(mid)
    assert world.sent_to(world.bob) == PAYMENT + OP_BOND
    assert world.sent_to(world.alice) == CT_BOND


def test_partial_ruling_is_prorata_by_contract_score(world):
    mid = drive(world, PARTIAL)
    world.c.settle(mid)
    s = world.c.get_settlement(mid)
    assert s["score"] == 65 and s["action"] == "PRORATA"
    assert world.sent_to(world.bob) == PAYMENT * 65 // 100 + OP_BOND
    assert world.sent_to(world.alice) == PAYMENT - PAYMENT * 65 // 100 + CT_BOND


def test_critical_failure_rejects_despite_partial_score(world):
    mid = drive(world, CRITICAL)
    r = world.c.get_ruling(mid, 1)
    assert r["ruling"] == "REJECTED" and r["critical_failed"] and r["score"] == 60
    world.c.settle(mid)
    assert world.sent_to(world.alice) == PAYMENT + CT_BOND
    assert world.sent_to(world.bob) == OP_BOND


@pytest.mark.parametrize("results", [ALL_PASS, PARTIAL, CRITICAL])
def test_every_settled_outcome_conserves_custody(world, results):
    mid = drive(world, results)
    world.c.settle(mid)
    assert world.total_sent() == TOTAL
    assert world.c.get_mandate(mid)["custody_held"] == "0"


def test_inconclusive_with_split_even_policy(world):
    mid = drive(world, UNSURE, policy_json=json.dumps({"INCONCLUSIVE": "SPLIT_EVEN"}))
    world.c.settle(mid)
    assert world.sent_to(world.bob) == PAYMENT // 2 + OP_BOND
    assert world.total_sent() == TOTAL


def test_inconclusive_with_return_policy(world):
    mid = drive(world, UNSURE, policy_json=json.dumps({"INCONCLUSIVE": "RETURN"}))
    world.c.settle(mid)
    assert world.sent_to(world.alice) == PAYMENT + CT_BOND
    assert world.sent_to(world.bob) == OP_BOND


def test_partial_can_be_configured_to_return(world):
    mid = drive(world, PARTIAL, policy_json=json.dumps({"PARTIAL": "RETURN"}))
    world.c.settle(mid)
    assert world.sent_to(world.bob) == OP_BOND


def test_rejected_can_be_configured_to_manual_review(world):
    mid = drive(world, CRITICAL, policy_json=json.dumps({"REJECTED": "MANUAL_REVIEW"}))
    world.as_(world.dave)
    with refused(world, "manual review"):
        world.c.settle(mid)
    assert world.total_sent() == 0


def test_manual_review_settle_is_refused(world):
    mid = drive(world, UNSURE)
    with refused(world, "manual review"):
        world.c.settle(mid)
    assert world.c.get_mandate(mid)["custody_held"] == str(TOTAL)


def test_zero_bonds_pay_exactly_the_payment(world):
    mid = drive(world, ALL_PASS, operator_bond_wei="0", contest_bond_wei="0")
    world.c.settle(mid)
    assert world.total_sent() == PAYMENT


def test_prorata_rounding_never_creates_or_loses_wei(world):
    odd = 100 * 10 ** 18 + 7
    mid = drive(world, PARTIAL, payment_wei=str(odd))
    world.c.settle(mid)
    assert world.total_sent() == odd + OP_BOND + CT_BOND
    assert world.sent_to(world.bob) == odd * 65 // 100 + OP_BOND


def test_no_zero_value_transfers_are_emitted(world):
    mid = drive(world, ALL_PASS, contest_bond_wei="0")
    world.c.settle(mid)
    assert world.transfers and all(int(t["value"]) > 0 for t in world.transfers)
