"""The pure act matrix must agree with the contract's real refusals.

For each lifecycle state, role and instant we compute `compute_acts` from the
public mandate view, then actually attempt every state-bound write on a
snapshot of the chain and compare. The UI mirrors compute_acts, so this test is
what keeps the screen from offering buttons the contract will refuse (or
hiding ones it would accept).
"""

import json

import pytest

from conftest import create_args, drive, evidence
from support import (CT_BOND, IDS, MIN, OP_BOND, PAYMENT, SEALED_COMMITMENT, WINDOWS, core,
                     panel_json)

K = core()
ALL_PASS = {"C1": "PASS", "C2": "PASS", "C3": "PASS"}
UNSURE = {"C1": "INCONCLUSIVE", "C2": "INCONCLUSIVE", "C3": "INCONCLUSIVE"}

DEADLINE_FIELDS = ["execution_deadline_at", "review_deadline_at", "response_deadline_at",
                   "stall_deadline_at", "appeal_deadline_at", "manual_deadline_at"]


_COUNTER = [0]


def attempt(world, mid, name, who, _label):
    """Run one write as `who`; True if the contract accepted it."""
    _COUNTER[0] += 1
    uniq = _COUNTER[0]
    vm, c = world.vm, world.c
    snap = vm.snapshot()
    sent = len(world.transfers)
    try:
        if name == "update_draft":
            world.as_(who)
            c.update_draft(mid, **create_args(world.hex(world.bob)))
        elif name == "fund_mandate":
            world.as_(who, PAYMENT)
            c.fund_mandate(mid)
        elif name == "accept_mandate":
            world.as_(who, OP_BOND)
            c.accept_mandate(mid)
        elif name == "open_contest":
            world.as_(who, CT_BOND)
            c.open_contest(mid, '["C1"]', "claim")
        elif name == "submit_evidence":
            world.as_(who)
            role_is_client = str(who) == str(world.alice)
            c.submit_evidence(mid, '["C1"]', f"https://probe-{uniq}.example.org/x",
                              "COUNTER" if role_is_client else "SUPPORT", SEALED_COMMITMENT,
                              "CLIENT_HOSTED" if role_is_client else "OPERATOR_HOSTED",
                              "text/html", "p", "n")
        elif name == "submit_deliverable":
            world.as_(who)
            c.submit_deliverable(mid, f"https://probe-{uniq}.example.org/d", SEALED_COMMITMENT)
        elif name == "respond_to_contest":
            world.as_(who)
            c.respond_to_contest(mid, "response")
        elif name == "propose_split":
            world.as_(who)
            c.propose_split(mid, 40)
        elif name == "adjudicate":
            world.panel(ALL_PASS)
            world.as_(who)
            c.adjudicate(mid)
        else:
            world.as_(who)
            getattr(c, name)(mid)
        return True
    except Exception:
        return False
    finally:
        vm.revert(snap)
        del world.transfers[sent:]


WRITES = ["update_draft", "fund_mandate", "accept_mandate", "cancel_mandate", "submit_evidence",
          "submit_deliverable", "approve_work", "claim_unreviewed_delivery", "open_contest",
          "respond_to_contest", "seal_record", "adjudicate", "appeal", "finalize_ruling",
          "settle", "propose_split", "accept_split", "lapse_mandate", "recover_escrow"]


def build(world, name):
    w = world
    w.as_(w.alice)
    if name == "draft":
        return w.c.create_mandate(**create_args(w.hex(w.bob)))
    if name == "escrowed":
        mid = w.c.create_mandate(**create_args(w.hex(w.bob)))
        w.as_(w.alice, PAYMENT)
        w.c.fund_mandate(mid)
        return mid
    mid = None
    if name in ("engaged", "delivered", "approved", "contested", "contested_responded", "sealed",
                "ruling", "appealed", "finalized_prorata", "finalized_manual",
                "finalized_manual_proposed", "lapsed"):
        mid = w.c.create_mandate(**create_args(w.hex(w.bob)))
        w.as_(w.alice, PAYMENT)
        w.c.fund_mandate(mid)
        w.advance(1000)
        w.as_(w.bob, OP_BOND)
        w.c.accept_mandate(mid)
        w.as_(w.bob)
        for cid in IDS:
            evidence(w, mid, cid, url=f"https://op-site.example.com/{cid}")
    if name == "engaged":
        return mid
    if name == "lapsed":
        w.advance(WINDOWS["execution"] + 1)
        w.c.lapse_mandate(mid)
        return mid
    w.advance(1000)
    w.c.submit_deliverable(mid, "https://op-site.example.com/deliverable", SEALED_COMMITMENT)
    if name == "delivered":
        return mid
    if name == "approved":
        w.as_(w.alice)
        w.c.approve_work(mid)
        return mid
    w.advance(1000)
    w.as_(w.alice, CT_BOND)
    w.c.open_contest(mid, '["C1"]', "claim")
    if name == "contested":
        return mid
    w.as_(w.bob)
    w.c.respond_to_contest(mid, "response")
    if name == "contested_responded":
        return mid
    w.c.seal_record(mid)
    if name == "sealed":
        return mid
    w.panel(UNSURE if "manual" in name else ALL_PASS)
    w.c.adjudicate(mid)
    if name == "ruling":
        return mid
    if name == "appealed":
        w.as_(w.alice)
        w.c.appeal(mid)
        return mid
    w.advance(WINDOWS["appeal"] + 1)
    w.c.finalize_ruling(mid)
    if name == "finalized_manual_proposed":
        w.as_(w.alice)
        w.c.propose_split(mid, 25)
    return mid


STATES = ["draft", "escrowed", "engaged", "delivered", "approved", "contested",
          "contested_responded", "sealed", "ruling", "appealed", "finalized_prorata",
          "finalized_manual", "finalized_manual_proposed", "lapsed"]


@pytest.mark.parametrize("state", STATES)
def test_act_matrix_agrees_with_contract(world, state):
    mid = build(world, state)
    view = world.c.get_mandate(mid)
    base = world.now
    instants = {base}
    for field in DEADLINE_FIELDS:
        if view[field] > 0:
            instants.update({view[field], view[field] + 1})
    roles = {"client": world.alice, "operator": world.bob, "keeper": world.dave}
    checked = 0
    for t in sorted(instants):
        world.set_time(t)
        for label, who in roles.items():
            expected = set(K.compute_acts(view, world.hex(who), t))
            actual = {w for w in WRITES if attempt(world, mid, w, who, f"{state}-{t}-{label}-{w}")}
            assert actual == expected, (state, label, t - base, sorted(actual ^ expected))
            checked += 1
    assert checked >= 3
