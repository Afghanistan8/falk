"""Fixtures for the Falk direct suite (real GenVM, mocked web + LLM)."""

import json

import pytest

from support import (CONTRACT, CRITERIA_JSON, CT_BOND, IDS, OP_BOND, PAYMENT, POLICY,
                     SEALED_BODY, SEALED_COMMITMENT, T0, WINDOWS, iso, panel_json)


class World:
    """A deployed Falk plus the cheat-codes the tests need."""

    def __init__(self, vm, contract, alice, bob, carol, dave):
        self.vm, self.c = vm, contract
        self.alice, self.bob, self.carol, self.dave = alice, bob, carol, dave
        self.now = T0
        self.transfers = []
        self.set_time(T0)
        vm._gl_call_hook = self._hook

    # -- plumbing ---------------------------------------------------------
    def _hook(self, vm, request):
        if "EthSend" in request:
            self.transfers.append(request["EthSend"])
            return {"ok": None}
        return None

    def set_time(self, ms):
        import genlayer.gl as gl
        self.now = ms
        self.vm.warp(iso(ms))
        gl.message_raw["datetime"] = iso(ms)

    def advance(self, ms):
        self.set_time(self.now + ms)

    def as_(self, who, value=0):
        import genlayer.gl as gl
        self.vm.sender = who
        self.vm.value = value
        gl.message_raw["datetime"] = iso(self.now)

    def panel(self, results, status=200, body=SEALED_BODY, **extra):
        self.vm.clear_mocks()
        self.vm.mock_web(r".*", {"status": status, "body": body})
        self.vm.mock_llm(r".*independent verification panel.*", panel_json(results, **extra))

    @staticmethod
    def hex(who):
        from genlayer.py.types import Address
        return (who if isinstance(who, Address) else Address(who)).as_hex

    def sent_to(self, who):
        """Total wei the contract emitted to `who` (a test address)."""
        target = self.hex(who).lower()
        return sum(int(t["value"]) for t in self.transfers
                   if str(t["address"].as_hex).lower() == target)

    def total_sent(self):
        return sum(int(t["value"]) for t in self.transfers)


@pytest.fixture
def world(direct_vm, direct_deploy, direct_alice, direct_bob):
    from gltest.direct.loader import create_address
    contract = direct_deploy(str(CONTRACT))
    return World(direct_vm, contract, direct_alice, direct_bob,
                 create_address("carol"), create_address("dave"))


def create_args(operator, **over):
    base = dict(
        operator=str(operator), title="Five-market landscape report",
        description="Deliver a written landscape report covering five named markets.",
        checklist_json=CRITERIA_JSON, payment_wei=str(PAYMENT),
        operator_bond_wei=str(OP_BOND), contest_bond_wei=str(CT_BOND),
        evidence_rules="Sources must be public and retrievable without a login.",
        policy_json=json.dumps(POLICY), windows_json=json.dumps(WINDOWS),
        schemes="https", max_receipts=12)
    base.update(over)
    return base


def evidence(w, mid, cid="C1", url=None, origin="OPERATOR_HOSTED", role="SUPPORT",
             commitment=SEALED_COMMITMENT, ids=None):
    return w.c.submit_evidence(
        mid, json.dumps(ids if ids is not None else [cid]),
        url or f"https://op-site.example.com/{cid}", role, commitment, origin,
        "text/html", "op-site", "filed against the checklist")


@pytest.fixture
def drafted(world):
    world.as_(world.alice)
    return world.c.create_mandate(**create_args(world.hex(world.bob)))


@pytest.fixture
def funded(world, drafted):
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(drafted)
    world.as_(world.alice)
    return drafted


@pytest.fixture
def engaged(world, funded):
    world.advance(1000)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(funded)
    world.as_(world.bob)
    return funded


@pytest.fixture
def delivered(world, engaged):
    world.as_(world.bob)
    for cid in IDS:
        evidence(world, engaged, cid)
    world.advance(1000)
    world.c.submit_deliverable(engaged, "https://op-site.example.com/deliverable",
                               SEALED_COMMITMENT)
    return engaged


@pytest.fixture
def contested(world, delivered):
    world.advance(1000)
    world.as_(world.alice, CT_BOND)
    world.c.open_contest(delivered, json.dumps(["C1", "C2"]),
                         "The report omits one market and several figures have no source.")
    world.as_(world.alice)
    return delivered


@pytest.fixture
def sealed(world, contested):
    world.as_(world.bob)
    world.c.respond_to_contest(contested, "All five markets are covered; see section 3.")
    world.c.seal_record(contested)
    return contested


@pytest.fixture
def ruled(world, sealed):
    """A sealed mandate ruled PARTIAL (C1 PASS, C2 FAIL, C3 PASS = score 65)."""
    world.panel({"C1": "PASS", "C2": "FAIL", "C3": "PASS"})
    world.as_(world.carol)
    world.c.adjudicate(sealed)
    return sealed


def drive(w, results, to="FINALIZED", **over):
    """Walk a fresh mandate through contest -> ruling -> (finalize). Returns its id."""
    from support import MIN
    w.as_(w.alice)
    mid = w.c.create_mandate(**create_args(w.hex(w.bob), **over))
    w.as_(w.alice, int(over.get("payment_wei", PAYMENT)))
    w.c.fund_mandate(mid)
    w.advance(1000)
    w.as_(w.bob, int(over.get("operator_bond_wei", OP_BOND)))
    w.c.accept_mandate(mid)
    for cid in IDS:
        evidence(w, mid, cid, url=f"https://op-site.example.com/{mid}/{cid}")
    w.advance(1000)
    w.c.submit_deliverable(mid, f"https://op-site.example.com/{mid}/deliverable", SEALED_COMMITMENT)
    w.advance(1000)
    w.as_(w.alice, int(over.get("contest_bond_wei", CT_BOND)))
    w.c.open_contest(mid, json.dumps(["C1"]), "The report is incomplete.")
    w.as_(w.bob)
    w.c.respond_to_contest(mid, "It is complete.")
    w.c.seal_record(mid)
    w.panel(results)
    w.as_(w.carol)
    w.c.adjudicate(mid)
    if to == "RULING":
        return mid
    w.advance(10 * MIN)
    w.c.finalize_ruling(mid)
    return mid
