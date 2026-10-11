"""Mandate creation, draft edits, funding and post-fund immutability."""

import json

import pytest

from conftest import create_args
from support import CRITERIA, CT_BOND, OP_BOND, PAYMENT, WINDOWS


def refused(world, text):
    return world.vm.expect_revert(text)


# --- creation ---------------------------------------------------------------
def test_create_returns_sequential_ids(world):
    world.as_(world.alice)
    a = world.c.create_mandate(**create_args(world.hex(world.bob)))
    b = world.c.create_mandate(**create_args(world.hex(world.bob)))
    assert (a, b) == ("FLK-000001", "FLK-000002")


def test_create_records_client_and_draft_status(world, drafted):
    m = world.c.get_mandate(drafted)
    assert m["status"] == "DRAFT" and not m["terms_locked"]
    assert m["client"].lower() == world.hex(world.alice).lower()
    assert m["operator"].lower() == world.hex(world.bob).lower()


def test_create_stores_canonical_checklist(world, drafted):
    crit = world.c.get_criteria(drafted)
    assert [c["id"] for c in crit] == ["C1", "C2", "C3"]
    assert sum(c["weight"] for c in crit) == 100


def test_create_defaults_deposits_to_zero(world, drafted):
    m = world.c.get_mandate(drafted)
    assert m["payment_deposited"] == "0" and m["custody_held"] == "0"


def test_create_refuses_client_as_operator(world):
    world.as_(world.alice)
    with refused(world, "different addresses"):
        world.c.create_mandate(**create_args(world.hex(world.alice)))


@pytest.mark.parametrize("bad", ["", "0x123", "not-an-address", "0x" + "z" * 40])
def test_create_refuses_bad_operator(world, bad):
    world.as_(world.alice)
    with refused(world, "operator must be"):
        world.c.create_mandate(**create_args(bad))


def test_create_refuses_weights_not_100(world):
    world.as_(world.alice)
    bad = [dict(c) for c in CRITERIA]
    bad[0]["weight"] = 41
    with refused(world, "sum to exactly 100"):
        world.c.create_mandate(**create_args(world.hex(world.bob), checklist_json=json.dumps(bad)))


def test_create_refuses_empty_title(world):
    world.as_(world.alice)
    with refused(world, "title is required"):
        world.c.create_mandate(**create_args(world.hex(world.bob), title="  "))


def test_create_refuses_empty_description(world):
    world.as_(world.alice)
    with refused(world, "description is required"):
        world.c.create_mandate(**create_args(world.hex(world.bob), description=""))


@pytest.mark.parametrize("pay", ["0", "-5", "abc", ""])
def test_create_refuses_non_positive_payment(world, pay):
    world.as_(world.alice)
    with refused(world, "payment must be a positive"):
        world.c.create_mandate(**create_args(world.hex(world.bob), payment_wei=pay))


def test_create_refuses_negative_bonds(world):
    world.as_(world.alice)
    with refused(world, "bonds cannot be negative"):
        world.c.create_mandate(**create_args(world.hex(world.bob), operator_bond_wei="-1"))


def test_create_allows_zero_bonds(world):
    world.as_(world.alice)
    mid = world.c.create_mandate(**create_args(world.hex(world.bob), operator_bond_wei="0",
                                               contest_bond_wei="0"))
    assert world.c.get_mandate(mid)["operator_bond_wei"] == "0"


def test_create_refuses_invalid_policy(world):
    world.as_(world.alice)
    with refused(world, "policy for CONFIRMED"):
        world.c.create_mandate(**create_args(world.hex(world.bob),
                                             policy_json=json.dumps({"CONFIRMED": "RETURN"})))


def test_create_refuses_short_window(world):
    world.as_(world.alice)
    w = dict(WINDOWS, execution=1000)
    with refused(world, "between one minute and one year"):
        world.c.create_mandate(**create_args(world.hex(world.bob), windows_json=json.dumps(w)))


def test_create_refuses_bad_scheme(world):
    world.as_(world.alice)
    with refused(world, "https and/or http"):
        world.c.create_mandate(**create_args(world.hex(world.bob), schemes="ftp"))


@pytest.mark.parametrize("cap", [0, 25, -1])
def test_create_refuses_bad_receipt_cap(world, cap):
    world.as_(world.alice)
    with refused(world, "max receipts"):
        world.c.create_mandate(**create_args(world.hex(world.bob), max_receipts=cap))


def test_create_indexes_both_parties(world, drafted):
    mine = world.c.list_mandates_for(world.hex(world.alice))
    theirs = world.c.list_mandates_for(world.hex(world.bob))
    assert mine["total"] == 1 and theirs["total"] == 1
    assert world.c.list_mandates_for(world.hex(world.carol))["total"] == 0


def test_list_mandates_pages(world):
    world.as_(world.alice)
    for _ in range(3):
        world.c.create_mandate(**create_args(world.hex(world.bob)))
    page = world.c.list_mandates(1, 1)
    assert page["total"] == 3 and [i["mandate_id"] for i in page["items"]] == ["FLK-000002"]


def test_unknown_mandate_reads_are_empty_not_errors(world):
    assert world.c.get_mandate("FLK-999999") == {}
    assert world.c.get_criteria("FLK-999999") == []
    assert world.c.get_evidence("FLK-999999") == []
    assert world.c.get_contest("FLK-999999") == {}
    assert world.c.list_rulings("FLK-999999") == []
    assert world.c.get_settlement("FLK-999999") == {}


def test_unknown_mandate_write_is_refused(world):
    world.as_(world.alice)
    with refused(world, "unknown mandate"):
        world.c.approve_work("FLK-999999")


# --- draft edits ------------------------------------------------------------
def test_update_draft_changes_terms(world, drafted):
    world.as_(world.alice)
    world.c.update_draft(drafted, **{k: v for k, v in create_args(world.hex(world.bob),
                                                                 title="Renamed").items()})
    assert world.c.get_mandate(drafted)["title"] == "Renamed"


def test_update_draft_only_by_client(world, drafted):
    world.as_(world.bob)
    with refused(world, "only the client"):
        world.c.update_draft(drafted, **create_args(world.hex(world.bob)))


def test_update_draft_can_change_operator_and_reindexes(world, drafted):
    world.as_(world.alice)
    world.c.update_draft(drafted, **create_args(world.hex(world.carol)))
    assert world.c.list_mandates_for(world.hex(world.carol))["total"] == 1
    assert world.c.get_mandate(drafted)["operator"].lower() == world.hex(world.carol).lower()


def test_update_draft_revalidates_weights(world, drafted):
    world.as_(world.alice)
    bad = [dict(c) for c in CRITERIA]
    bad[1]["weight"] = 1
    with refused(world, "sum to exactly 100"):
        world.c.update_draft(drafted, **create_args(world.hex(world.bob), checklist_json=json.dumps(bad)))


def test_update_draft_refused_after_funding(world, funded):
    world.as_(world.alice)
    with refused(world, "needs DRAFT"):
        world.c.update_draft(funded, **create_args(world.hex(world.bob), title="Sneaky"))
    assert world.c.get_mandate(funded)["title"] != "Sneaky"


# --- funding ----------------------------------------------------------------
def test_fund_requires_exact_payment_short(world, drafted):
    world.as_(world.alice, PAYMENT - 1)
    with refused(world, "exact payment required"):
        world.c.fund_mandate(drafted)
    assert world.c.get_mandate(drafted)["status"] == "DRAFT"


def test_fund_requires_exact_payment_excess(world, drafted):
    world.as_(world.alice, PAYMENT + 1)
    with refused(world, "exact payment required"):
        world.c.fund_mandate(drafted)


def test_fund_requires_value_at_all(world, drafted):
    world.as_(world.alice, 0)
    with refused(world, "exact payment required"):
        world.c.fund_mandate(drafted)


def test_fund_only_by_client(world, drafted):
    world.as_(world.bob, PAYMENT)
    with refused(world, "only the client"):
        world.c.fund_mandate(drafted)


def test_fund_freezes_terms_and_records_deposit(world, funded):
    m = world.c.get_mandate(funded)
    assert m["status"] == "ESCROWED" and m["terms_locked"]
    assert m["payment_deposited"] == str(PAYMENT) and m["custody_held"] == str(PAYMENT)
    assert len(m["terms_hash"]) == 64


def test_fund_twice_is_refused(world, funded):
    world.as_(world.alice, PAYMENT)
    with refused(world, "needs DRAFT"):
        world.c.fund_mandate(funded)


def test_terms_hash_is_deterministic_and_term_sensitive(world):
    world.as_(world.alice)
    a = world.c.create_mandate(**create_args(world.hex(world.bob)))
    b = world.c.create_mandate(**create_args(world.hex(world.bob), title="Other"))
    for mid in (a, b):
        world.as_(world.alice, PAYMENT)
        world.c.fund_mandate(mid)
    assert world.c.get_mandate(a)["terms_hash"] != world.c.get_mandate(b)["terms_hash"]


def test_windows_recorded_per_mandate(world, funded):
    m = world.c.get_mandate(funded)
    assert (m["execution_window_ms"], m["review_window_ms"]) == (WINDOWS["execution"], WINDOWS["review"])
    assert m["policy"]["PARTIAL"] == "PRORATA"


def test_two_mandates_have_independent_state(world, funded):
    world.as_(world.alice)
    other = world.c.create_mandate(**create_args(world.hex(world.bob)))
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(other)
    world.advance(1000)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(other)
    assert world.c.get_mandate(funded)["status"] == "ESCROWED"
    assert world.c.get_mandate(other)["status"] == "ENGAGED"


def hash_with(world, **over):
    """terms_hash of FLK-000001 funded with the given overrides (chain state is rolled back)."""
    snap = world.vm.snapshot()
    try:
        world.as_(world.alice)
        mid = world.c.create_mandate(**create_args(world.hex(world.bob), **over))
        world.as_(world.alice, PAYMENT)
        world.c.fund_mandate(mid)
        return world.c.get_mandate(mid)["terms_hash"]
    finally:
        world.vm.revert(snap)


def test_terms_hash_covers_the_checklist(world):
    tweaked = [dict(c) for c in CRITERIA]
    tweaked[0]["weight"], tweaked[1]["weight"] = 35, 40
    assert hash_with(world) != hash_with(world, checklist_json=json.dumps(tweaked))


def test_terms_hash_covers_policy(world):
    assert hash_with(world) != hash_with(world, policy_json=json.dumps({"PARTIAL": "RETURN"}))


def test_terms_hash_covers_windows(world):
    other = json.dumps(dict(WINDOWS, appeal=WINDOWS["appeal"] + 1))
    assert hash_with(world) != hash_with(world, windows_json=other)


def test_terms_hash_covers_bonds_and_rules(world):
    base = hash_with(world)
    assert base != hash_with(world, operator_bond_wei=str(OP_BOND + 1))
    assert base != hash_with(world, contest_bond_wei=str(CT_BOND + 1))
    assert base != hash_with(world, evidence_rules="different rules")
    assert base != hash_with(world, max_receipts=11)


def test_terms_hash_is_reproducible(world):
    assert hash_with(world) == hash_with(world)
