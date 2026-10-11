"""Evidence filing, commitments, independence, caps, review and sealing."""

import json

import pytest

from conftest import create_args, evidence
from support import (CT_BOND, IDS, MIN, OP_BOND, OTHER_COMMITMENT, PAYMENT,
                     SEALED_COMMITMENT, WINDOWS)


def refused(world, text):
    return world.vm.expect_revert(text)


def file_raw(w, mid, *, ids='["C1"]', url="https://x-site.example.org/a", role="SUPPORT",
             commitment=SEALED_COMMITMENT, origin="OPERATOR_HOSTED"):
    return w.c.submit_evidence(mid, ids, url, role, commitment, origin, "text/html", "pub", "note")


# --- commitments ------------------------------------------------------------
@pytest.mark.parametrize("bad", ["", "abc", "z" * 64, "a" * 63])
def test_commitment_is_mandatory_and_well_formed(world, engaged, bad):
    world.as_(world.bob)
    with refused(world, "content commitment is required"):
        file_raw(world, engaged, commitment=bad)
    assert world.c.get_evidence(engaged) == []


def test_commitment_accepts_prefixed_uppercase(world, engaged):
    world.as_(world.bob)
    file_raw(world, engaged, commitment="SHA256:" + SEALED_COMMITMENT.upper())
    assert world.c.get_evidence(engaged)[0]["content_commitment"] == SEALED_COMMITMENT


def test_receipt_fields_are_stored(world, engaged):
    world.as_(world.bob)
    n = file_raw(world, engaged, ids='["C2", "C1", "C2"]')
    r = world.c.get_evidence(engaged)[0]
    assert n == 1 and r["criterion_ids"] == ["C1", "C2"]
    assert r["submitter_role"] == "operator" and r["origin_class"] == "OPERATOR_HOSTED"
    assert r["submitted_at_ms"] == world.now


# --- URLs -------------------------------------------------------------------
@pytest.mark.parametrize("url", [
    "http://x-site.example.org/a", "https://user:pw@x-site.example.org/a",
    "https://localhost/a", "https://192.168.1.1/a", "file:///etc/passwd",
    "javascript:alert(1)", "https://x-site.example.org:99999/a"])
def test_unsafe_urls_are_refused(world, engaged, url):
    world.as_(world.bob)
    with pytest.raises(Exception):
        file_raw(world, engaged, url=url)


def test_http_allowed_when_mandate_permits(world, drafted):
    world.as_(world.alice)
    mid = world.c.create_mandate(**create_args(world.hex(world.bob), schemes="https,http"))
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(mid)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(mid)
    world.as_(world.bob)
    file_raw(world, mid, url="http://x-site.example.org/a")
    assert len(world.c.get_evidence(mid)) == 1


def test_duplicate_url_is_refused(world, engaged):
    world.as_(world.bob)
    file_raw(world, engaged)
    with refused(world, "already filed"):
        file_raw(world, engaged, ids='["C2"]')


# --- vocabulary / role rules ------------------------------------------------
def test_unknown_criterion_is_refused(world, engaged):
    world.as_(world.bob)
    with refused(world, "not in this checklist"):
        file_raw(world, engaged, ids='["NOPE"]')


def test_support_evidence_must_name_a_criterion(world, engaged):
    world.as_(world.bob)
    with refused(world, "at least one criterion"):
        file_raw(world, engaged, ids="[]")


@pytest.mark.parametrize("field,val", [("role", "ORACLE"), ("origin", "TRUST_ME")])
def test_unknown_role_or_origin_refused(world, engaged, field, val):
    world.as_(world.bob)
    with pytest.raises(Exception):
        file_raw(world, engaged, **{field: val})


def test_client_cannot_file_operator_hosted(world, contested):
    world.as_(world.alice)
    with refused(world, "only the operator can file OPERATOR_HOSTED"):
        file_raw(world, contested, role="COUNTER", origin="OPERATOR_HOSTED")


def test_operator_cannot_file_client_hosted(world, engaged):
    world.as_(world.bob)
    with refused(world, "only the client can file CLIENT_HOSTED"):
        file_raw(world, engaged, origin="CLIENT_HOSTED")


def test_operator_cannot_file_counter_evidence(world, engaged):
    world.as_(world.bob)
    with refused(world, "COUNTER evidence is filed by the client"):
        file_raw(world, engaged, role="COUNTER", origin="THIRD_PARTY")


def test_client_cannot_file_deliverable_role(world, contested):
    world.as_(world.alice)
    with refused(world, "DELIVERABLE evidence is filed by the operator"):
        file_raw(world, contested, role="DELIVERABLE", ids="[]", origin="CLIENT_HOSTED")


# --- who and when -----------------------------------------------------------
def test_stranger_cannot_file(world, engaged):
    world.as_(world.dave)
    with refused(world, "only the client or the operator"):
        file_raw(world, engaged)


def test_client_cannot_file_while_work_is_in_progress(world, engaged):
    world.as_(world.alice)
    with refused(world, "only the operator files evidence"):
        file_raw(world, engaged, origin="CLIENT_HOSTED", role="COUNTER")


def test_client_cannot_file_before_contest(world, delivered):
    world.as_(world.alice)
    with refused(world, "only after a contest"):
        file_raw(world, delivered, origin="CLIENT_HOSTED", role="COUNTER")


@pytest.mark.parametrize("fixture_name", ["drafted", "funded"])
def test_no_evidence_before_engagement(request, world, fixture_name):
    mid = request.getfixturevalue(fixture_name)
    world.as_(world.bob)
    with refused(world, "cannot be filed while the mandate is"):
        file_raw(world, mid)


def test_client_files_counter_evidence_after_contest(world, contested):
    world.as_(world.alice)
    file_raw(world, contested, ids='["C1"]', role="COUNTER", origin="CLIENT_HOSTED",
             url="https://client-blog.example.net/rebuttal")
    assert world.c.get_evidence(contested)[-1]["submitter_role"] == "client"


def test_operator_files_in_delivered_until_review_deadline(world, delivered):
    world.as_(world.bob)
    file_raw(world, delivered, url="https://late-but-ok.example.org/x")
    world.advance(WINDOWS["review"] + 1)
    with refused(world, "review window has closed"):
        file_raw(world, delivered, url="https://too-late.example.org/x")


def test_evidence_after_execution_deadline_refused(world, engaged):
    world.advance(WINDOWS["execution"] + 1)
    world.as_(world.bob)
    with refused(world, "execution deadline has passed"):
        file_raw(world, engaged)


def test_nothing_enters_the_record_after_seal(world, sealed):
    before = len(world.c.get_evidence(sealed))
    for who, origin, role in [(world.bob, "OPERATOR_HOSTED", "SUPPORT"),
                              (world.alice, "CLIENT_HOSTED", "COUNTER")]:
        world.as_(who)
        with refused(world, "cannot be filed while the mandate is"):
            file_raw(world, sealed, url=f"https://post-seal-{role}.example.org/x",
                     origin=origin, role=role)
    assert len(world.c.get_evidence(sealed)) == before


def test_receipt_cap_is_enforced(world):
    world.as_(world.alice)
    mid = world.c.create_mandate(**create_args(world.hex(world.bob), max_receipts=2))
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(mid)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(mid)
    world.as_(world.bob)
    file_raw(world, mid, url="https://one.example.org/1")
    file_raw(world, mid, url="https://two.example.org/2")
    with refused(world, "operator has already filed the maximum of 2"):
        file_raw(world, mid, url="https://three.example.org/3")


def test_evidence_is_isolated_between_mandates(world, engaged):
    world.as_(world.alice)
    other = world.c.create_mandate(**create_args(world.hex(world.bob)))
    world.as_(world.bob)
    file_raw(world, engaged)
    assert len(world.c.get_evidence(engaged)) == 1
    assert world.c.get_evidence(other) == []


def test_same_url_may_appear_on_two_mandates(world, engaged):
    world.as_(world.alice)
    other = world.c.create_mandate(**create_args(world.hex(world.bob)))
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(other)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(other)
    world.as_(world.bob)
    file_raw(world, engaged)
    file_raw(world, other)
    assert len(world.c.get_evidence(other)) == 1


# --- independence -----------------------------------------------------------
def test_independent_origin_cannot_share_site_with_own_hosted(world, engaged):
    world.as_(world.bob)
    file_raw(world, engaged, url="https://shop.acme.example.com/a", origin="OPERATOR_HOSTED")
    with refused(world, "cannot share a site"):
        file_raw(world, engaged, url="https://blog.acme.example.com/b", origin="THIRD_PARTY")


def test_hosted_cannot_follow_independent_on_same_site(world, engaged):
    world.as_(world.bob)
    file_raw(world, engaged, url="https://review.example.org/a", origin="THIRD_PARTY")
    with refused(world, "already filed by this party as an independent origin"):
        file_raw(world, engaged, url="https://www.example.org/b", origin="OPERATOR_HOSTED")


def test_independent_origin_cannot_match_deliverable_site(world, delivered):
    world.as_(world.bob)
    with refused(world, "cannot share a site"):
        file_raw(world, delivered, url="https://op-site.example.com/other", origin="PUBLIC_RECORD")


def test_independent_origin_on_distinct_site_is_accepted(world, engaged):
    world.as_(world.bob)
    file_raw(world, engaged, url="https://shop.acme.example.com/a", origin="OPERATOR_HOSTED")
    file_raw(world, engaged, url="https://registry.example.org/a", origin="PUBLIC_RECORD")
    assert [r["origin_class"] for r in world.c.get_evidence(engaged)] == ["OPERATOR_HOSTED", "PUBLIC_RECORD"]


def test_client_independent_cannot_match_operator_deliverable(world, contested):
    world.as_(world.alice)
    with refused(world, "cannot share a site"):
        file_raw(world, contested, url="https://op-site.example.com/audit", role="COUNTER",
                 origin="THIRD_PARTY")


# --- deliverable ------------------------------------------------------------
def test_deliver_records_receipt_and_review_deadline(world, delivered):
    m = world.c.get_mandate(delivered)
    assert m["status"] == "DELIVERED" and m["deliverable_url"].endswith("/deliverable")
    assert m["review_deadline_at"] == m["delivered_at_ms"] + WINDOWS["review"]
    last = world.c.get_evidence(delivered)[-1]
    assert last["role"] == "DELIVERABLE" and last["criterion_ids"] == []


def test_deliver_only_by_operator(world, engaged):
    world.as_(world.alice)
    with refused(world, "only the operator"):
        world.c.submit_deliverable(engaged, "https://op-site.example.com/d", SEALED_COMMITMENT)


def test_deliver_requires_commitment(world, engaged):
    world.as_(world.bob)
    with refused(world, "content commitment is required"):
        world.c.submit_deliverable(engaged, "https://op-site.example.com/d", "")


def test_deliver_after_deadline_is_refused(world, engaged):
    world.advance(WINDOWS["execution"] + 1)
    world.as_(world.bob)
    with refused(world, "execution deadline has passed"):
        world.c.submit_deliverable(engaged, "https://op-site.example.com/d", SEALED_COMMITMENT)


def test_deliver_twice_is_refused(world, delivered):
    world.as_(world.bob)
    with refused(world, "needs ENGAGED"):
        world.c.submit_deliverable(delivered, "https://op-site.example.com/d2", SEALED_COMMITMENT)


# --- contest ----------------------------------------------------------------
def test_contest_records_bond_and_response_deadline(world, contested):
    m = world.c.get_mandate(contested)
    c = world.c.get_contest(contested)
    assert m["status"] == "CONTESTED" and m["contest_bond_deposited"] == str(CT_BOND)
    assert m["response_deadline_at"] == m["contested_at_ms"] + WINDOWS["response"]
    assert c["disputed"] == ["C1", "C2"] and not c["operator_responded"]


def test_contest_after_review_window_is_refused(world, delivered):
    world.advance(WINDOWS["review"] + 1)
    world.as_(world.alice, CT_BOND)
    with refused(world, "review window has closed"):
        world.c.open_contest(delivered, '["C1"]', "Too late.")


def test_contest_only_by_client(world, delivered):
    world.as_(world.bob, CT_BOND)
    with refused(world, "only the client"):
        world.c.open_contest(delivered, '["C1"]', "I contest my own work.")


@pytest.mark.parametrize("disputed,claim,msg", [
    ('["NOPE"]', "x", "not in this checklist"), ("[]", "x", "at least one criterion"),
    ('["C1"]', "  ", "written claim")])
def test_contest_validation(world, delivered, disputed, claim, msg):
    world.as_(world.alice, CT_BOND)
    with refused(world, msg):
        world.c.open_contest(delivered, disputed, claim)


def test_contest_twice_is_refused(world, contested):
    world.as_(world.alice, CT_BOND)
    with refused(world, "needs DELIVERED"):
        world.c.open_contest(contested, '["C1"]', "again")


def test_respond_only_once_and_only_by_operator(world, contested):
    world.as_(world.alice)
    with refused(world, "only the operator"):
        world.c.respond_to_contest(contested, "I respond for them")
    world.as_(world.bob)
    world.c.respond_to_contest(contested, "Here is my response.")
    with refused(world, "already responded"):
        world.c.respond_to_contest(contested, "And again.")
    assert world.c.get_contest(contested)["operator_response"] == "Here is my response."


def test_respond_needs_text(world, contested):
    world.as_(world.bob)
    with refused(world, "response needs text"):
        world.c.respond_to_contest(contested, " ")


# --- sealing ----------------------------------------------------------------
def test_seal_freezes_count_and_snapshot(world, sealed):
    m = world.c.get_mandate(sealed)
    assert m["status"] == "RECORD_SEALED"
    assert m["sealed_count"] == len(world.c.get_evidence(sealed)) == 4
    assert len(m["snapshot_hash"]) == 64


def test_snapshot_depends_on_evidence(world):
    from conftest import drive
    a = drive(world, {"C1": "PASS", "C2": "PASS", "C3": "PASS"}, to="RULING")
    b = drive(world, {"C1": "PASS", "C2": "PASS", "C3": "PASS"}, to="RULING")
    assert world.c.get_mandate(a)["snapshot_hash"] != world.c.get_mandate(b)["snapshot_hash"]


def test_party_cannot_seal_before_operator_responds(world, contested):
    world.as_(world.alice)
    with refused(world, "response window is still open"):
        world.c.seal_record(contested)


def test_stranger_cannot_seal_before_deadline(world, contested):
    world.as_(world.dave)
    with refused(world, "only a party can seal"):
        world.c.seal_record(contested)


def test_client_may_seal_once_operator_responded(world, contested):
    world.as_(world.bob)
    world.c.respond_to_contest(contested, "ok")
    world.as_(world.alice)
    world.c.seal_record(contested)
    assert world.c.get_mandate(contested)["status"] == "RECORD_SEALED"


def test_anyone_may_seal_after_response_deadline(world, contested):
    world.advance(WINDOWS["response"])
    world.as_(world.dave)
    world.c.seal_record(contested)
    assert world.c.get_mandate(contested)["status"] == "RECORD_SEALED"


def test_seal_twice_is_refused(world, sealed):
    world.as_(world.alice)
    with refused(world, "needs CONTESTED"):
        world.c.seal_record(sealed)


def test_seal_before_contest_is_refused(world, delivered):
    world.as_(world.alice)
    with refused(world, "needs CONTESTED"):
        world.c.seal_record(delivered)


def test_an_operator_filling_its_cap_cannot_block_delivery_or_counter_evidence(world):
    world.as_(world.alice)
    mid = world.c.create_mandate(**create_args(world.hex(world.bob), max_receipts=2))
    world.as_(world.alice, PAYMENT)
    world.c.fund_mandate(mid)
    world.as_(world.bob, OP_BOND)
    world.c.accept_mandate(mid)
    world.as_(world.bob)
    file_raw(world, mid, url="https://one.example.org/1")
    file_raw(world, mid, url="https://two.example.org/2")
    world.c.submit_deliverable(mid, "https://deliver.example.org/d", SEALED_COMMITMENT)
    world.as_(world.alice, CT_BOND)
    world.c.open_contest(mid, '["C1"]', "not done")
    world.as_(world.alice)
    file_raw(world, mid, url="https://rebut-1.example.net/1", role="COUNTER", origin="CLIENT_HOSTED")
    file_raw(world, mid, url="https://rebut-2.example.net/2", role="COUNTER", origin="CLIENT_HOSTED")
    with refused(world, "client has already filed the maximum of 2"):
        file_raw(world, mid, url="https://rebut-3.example.net/3", role="COUNTER", origin="CLIENT_HOSTED")


def test_role_and_origin_are_case_insensitive(world, engaged):
    world.as_(world.bob)
    file_raw(world, engaged, role="support", origin="operator_hosted")
    r = world.c.get_evidence(engaged)[0]
    assert (r["role"], r["origin_class"]) == ("SUPPORT", "OPERATOR_HOSTED")


def test_reassigning_the_operator_back_does_not_duplicate_the_index(world, drafted):
    world.as_(world.alice)
    world.c.update_draft(drafted, **create_args(world.hex(world.carol)))
    world.c.update_draft(drafted, **create_args(world.hex(world.bob)))
    world.c.update_draft(drafted, **create_args(world.hex(world.carol)))
    assert world.c.list_mandates_for(world.hex(world.carol))["total"] == 1
