"""The pure core, tested with no GenVM at all."""

import json

import pytest

from support import CRITERIA, OTHER_COMMITMENT, SEALED_BODY, SEALED_COMMITMENT, core

K = core()
Refusal = K["_UserError"]


def crit(**kw):
    base = {"id": "A", "title": "t", "weight": 100}
    base.update(kw)
    return base


# --- isolation --------------------------------------------------------------
def test_core_has_no_gl_object():
    assert "gl" not in K


def test_core_refusal_type_is_plain_exception_without_vm():
    assert issubclass(Refusal, Exception)


# --- canonical json / hashing ----------------------------------------------
def test_canon_sorts_keys_and_strips_whitespace():
    assert K.canon({"b": 1, "a": [1, 2]}) == '{"a":[1,2],"b":1}'


def test_canon_is_insensitive_to_insertion_order():
    assert K.canon({"x": 1, "y": 2}) == K.canon({"y": 2, "x": 1})


def test_canon_keeps_unicode_unescaped():
    assert K.canon({"k": "é"}) == '{"k":"é"}'


def test_sha256_hex_known_vector():
    assert K.sha256_hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_commitment_strips_before_hashing():
    assert K.commitment_of("  hello\n") == K.commitment_of("hello")


def test_commitment_matches_fixture():
    assert K.commitment_of(SEALED_BODY) == SEALED_COMMITMENT


@pytest.mark.parametrize("raw", ["", "abc", "g" * 64, "a" * 63, "a" * 65, None])
def test_norm_commitment_rejects_malformed(raw):
    assert K.norm_commitment(raw) == ""


def test_norm_commitment_accepts_prefix_and_case():
    assert K.norm_commitment("SHA256:" + "AB" * 32) == "ab" * 32


def test_require_commitment_refuses_empty():
    with pytest.raises(Refusal, match="content commitment"):
        K.require_commitment("")


# --- addresses -------------------------------------------------------------
@pytest.mark.parametrize("v,ok", [("0x" + "a" * 40, True), ("0x" + "A" * 40, True),
                                  ("0x" + "a" * 39, False), ("a" * 42, False),
                                  ("", False), (None, False)])
def test_is_address(v, ok):
    assert K.is_address(v) is ok


# --- URLs ------------------------------------------------------------------
@pytest.mark.parametrize("url", [
    "https://example.com/a", "https://sub.example.co.uk/x?y=1#z", "https://example.com:8443/p"])
def test_url_accepts_public_https(url):
    assert K.url_ok(url, "https")


@pytest.mark.parametrize("url", [
    "http://example.com/a", "ftp://example.com/a", "https://user:pw@example.com/a",
    "https://127.0.0.1/a", "https://10.0.0.5/a", "https://localhost/a",
    "https://[::1]/a", "https://intranet.local/a", "https://nodot/a", "not a url",
    "https://example.com:99999/", "", "https://" + "a" * 600 + ".com/",
    "https://exa mple.com/"])
def test_url_refuses_unsafe(url):
    assert not K.url_ok(url, "https")


def test_url_allows_http_only_when_enabled():
    assert K.url_ok("http://example.com/a", "https,http")


def test_host_extraction_lowercases_and_drops_port():
    assert K.host_of("https://EXAMPLE.com:8443/p") == "example.com"


@pytest.mark.parametrize("host,key", [
    ("a.b.example.com", "example.com"), ("example.com", "example.com"),
    ("www.bbc.co.uk", "bbc.co.uk"), ("x.y.gov.au", "y.gov.au"),
    ("sub.example.org", "example.org")])
def test_site_key(host, key):
    assert K.site_key(host) == key


def test_subdomains_of_one_site_share_a_key():
    assert K.site_key("docs.example.com") == K.site_key("blog.example.com")


# --- checklist -------------------------------------------------------------
def test_checklist_accepts_valid_and_canonicalises():
    out = K.parse_checklist(json.dumps(CRITERIA))
    assert [c["id"] for c in out] == ["C1", "C2", "C3"]
    assert out[0]["non_negotiable"] is True and out[1]["min_evidence"] == 1


def test_checklist_defaults_fill_in():
    out = K.parse_checklist(json.dumps([crit()]))
    assert out[0]["independence"] == "ANY" and out[0]["min_evidence"] == 1
    assert out[0]["non_negotiable"] is False


@pytest.mark.parametrize("weights", [[50, 49], [50, 51], [100, 1], [99], [10, 10, 10]])
def test_checklist_weights_must_sum_to_exactly_100(weights):
    items = [crit(id=f"A{i}", weight=w) for i, w in enumerate(weights)]
    with pytest.raises(Refusal, match="sum to exactly 100"):
        K.parse_checklist(json.dumps(items))


@pytest.mark.parametrize("bad", [0, -5, 101, 1.5, "50", True, None])
def test_checklist_weight_must_be_positive_integer(bad):
    with pytest.raises(Refusal):
        K.parse_checklist(json.dumps([crit(weight=bad)]))


def test_checklist_refuses_duplicates():
    items = [crit(id="A", weight=50), crit(id="A", weight=50)]
    with pytest.raises(Refusal, match="duplicate"):
        K.parse_checklist(json.dumps(items))


def test_checklist_refuses_unknown_keys():
    with pytest.raises(Refusal, match="unknown criterion field"):
        K.parse_checklist(json.dumps([crit(non_negotiible=True)]))


@pytest.mark.parametrize("raw", ["", "{", "{}", "[]", '"x"', "[1]"])
def test_checklist_refuses_non_arrays_and_junk(raw):
    with pytest.raises(Refusal):
        K.parse_checklist(raw)


def test_checklist_limits_criteria_count():
    items = [crit(id=f"A{i}", weight=1) for i in range(13)]
    with pytest.raises(Refusal, match="at most 12"):
        K.parse_checklist(json.dumps(items))


@pytest.mark.parametrize("field,value", [
    ("independence", "SOMETIMES"), ("min_evidence", 0), ("min_evidence", 6),
    ("min_evidence", "1"), ("non_negotiable", "yes"), ("id", "bad id!"), ("id", ""),
    ("title", "")])
def test_checklist_field_validation(field, value):
    with pytest.raises(Refusal):
        K.parse_checklist(json.dumps([crit(**{field: value})]))


# --- policy and windows ----------------------------------------------------
def test_policy_defaults():
    p = K.parse_policy("")
    assert p == {"CONFIRMED": "RELEASE_FULL", "PARTIAL": "PRORATA", "REJECTED": "RETURN",
                 "INCONCLUSIVE": "MANUAL_REVIEW", "LAPSE_BOND": "RETURN"}


@pytest.mark.parametrize("bad", [
    {"CONFIRMED": "RETURN"}, {"PARTIAL": "RELEASE_FULL"}, {"REJECTED": "PRORATA"},
    {"INCONCLUSIVE": "PRORATA"}, {"LAPSE_BOND": "BURN"}, {"BONUS": "x"},
    {"version": "FALK-POLICY-9"}])
def test_policy_rejects_invalid(bad):
    with pytest.raises(Refusal):
        K.parse_policy(json.dumps(bad))


def test_policy_accepts_explicit_exits():
    p = K.parse_policy(json.dumps({"INCONCLUSIVE": "SPLIT_EVEN", "REJECTED": "MANUAL_REVIEW",
                                   "LAPSE_BOND": "FORFEIT"}))
    assert p["INCONCLUSIVE"] == "SPLIT_EVEN" and p["LAPSE_BOND"] == "FORFEIT"


def test_windows_require_execution_and_review():
    with pytest.raises(Refusal, match="execution window is required"):
        K.parse_windows("{}")


@pytest.mark.parametrize("ms", [0, 59_999, 365 * 24 * 3600 * 1000 + 1, -1, "x"])
def test_windows_bounds(ms):
    with pytest.raises(Refusal):
        K.parse_windows(json.dumps({"execution": ms, "review": 60_000}))


def test_windows_fill_defaults():
    w = K.parse_windows(json.dumps({"execution": 60_000, "review": 60_000}))
    assert w["appeal"] == 86_400_000 and w["manual"] == 7 * 86_400_000


# --- retrieval taxonomy ----------------------------------------------------
def test_classify_success_match():
    assert K.classify_fetch(200, SEALED_BODY, SEALED_COMMITMENT) == ("SUCCESS_MATCH", SEALED_BODY.strip())


def test_classify_content_mismatch_carries_no_text():
    assert K.classify_fetch(200, "swapped", SEALED_COMMITMENT) == ("CONTENT_MISMATCH", "")


@pytest.mark.parametrize("body", ["", "   \n", None])
def test_classify_empty(body):
    assert K.classify_fetch(200, body, SEALED_COMMITMENT) == ("EMPTY", "")


@pytest.mark.parametrize("status", [199, 301, 404, 500, 0])
def test_classify_non_success(status):
    assert K.classify_fetch(status, SEALED_BODY, SEALED_COMMITMENT) == ("NON_SUCCESS_HTTP", "")


def test_classify_missing_commitment_is_mismatch():
    assert K.classify_fetch(200, SEALED_BODY, "")[0] == "CONTENT_MISMATCH"


def test_classify_unknown_status_is_judged_on_body():
    assert K.classify_fetch(None, SEALED_BODY, SEALED_COMMITMENT)[0] == "SUCCESS_MATCH"


def test_only_success_match_carries_text():
    for label, text in [K.classify_fetch(404, "x", "a" * 64), K.classify_fetch(200, "", "a" * 64),
                        K.classify_fetch(200, "x", OTHER_COMMITMENT)]:
        assert text == "" and label != "SUCCESS_MATCH"


# --- normalisation ---------------------------------------------------------
CL = K.parse_checklist(json.dumps(CRITERIA))


def raw(results, **extra):
    d = {"criterion_results": [{"id": k, "result": v} for k, v in results.items()]}
    d.update(extra)
    return d


def test_normalize_builds_fixed_keys():
    n = K.normalize_panel(raw({"C1": "PASS", "C2": "FAIL", "C3": "pass"}), "M", CL)
    assert set(n) == {"mandate_id", "results", "quality", "flags", "reasoning"}
    assert [r["result"] for r in n["results"]] == ["PASS", "FAIL", "PASS"]


def test_normalize_discards_invented_money_fields():
    n = K.normalize_panel(raw({"C1": "PASS", "C2": "PASS", "C3": "PASS"},
                              payout="1000", recipient="0xabc", percentage=100,
                              ruling="CONFIRMED", score=100, policy="RELEASE_FULL"), "M", CL)
    blob = json.dumps(n)
    for needle in ("payout", "recipient", "percentage", "0xabc", "policy", "RELEASE_FULL"):
        assert needle not in blob


def test_normalize_missing_criterion_is_inconclusive():
    n = K.normalize_panel(raw({"C1": "PASS"}), "M", CL)
    assert [r["result"] for r in n["results"]] == ["PASS", "INCONCLUSIVE", "INCONCLUSIVE"]


def test_normalize_unknown_criterion_ids_are_ignored():
    n = K.normalize_panel(raw({"C1": "PASS", "ZZ": "PASS"}), "M", CL)
    assert [r["id"] for r in n["results"]] == ["C1", "C2", "C3"]


@pytest.mark.parametrize("v", ["MAYBE", "", None, 7, "Passed"])
def test_normalize_invalid_verdict_is_inconclusive(v):
    n = K.normalize_panel({"criterion_results": [{"id": "C1", "result": v}]}, "M", CL)
    assert n["results"][0]["result"] == "INCONCLUSIVE"


def test_normalize_conflicting_duplicates_become_inconclusive():
    r = {"criterion_results": [{"id": "C1", "result": "PASS"}, {"id": "C1", "result": "FAIL"}]}
    assert K.normalize_panel(r, "M", CL)["results"][0]["result"] == "INCONCLUSIVE"


def test_normalize_agreeing_duplicates_are_kept():
    r = {"criterion_results": [{"id": "C1", "result": "PASS"}, {"id": "C1", "result": "PASS"}]}
    assert K.normalize_panel(r, "M", CL)["results"][0]["result"] == "PASS"


def test_normalize_accepts_mapping_form():
    n = K.normalize_panel({"results": {"C1": "PASS", "C2": "FAIL", "C3": "FAIL"}}, "M", CL)
    assert [r["result"] for r in n["results"]] == ["PASS", "FAIL", "FAIL"]


@pytest.mark.parametrize("bad", [None, [], "x", 3])
def test_normalize_non_object_is_panel_error(bad):
    with pytest.raises(Refusal, match="PANEL_ERROR"):
        K.normalize_panel(bad, "M", CL)


def test_normalize_requires_results_key():
    with pytest.raises(Refusal, match="no criterion results"):
        K.normalize_panel({"reasoning": "x"}, "M", CL)


def test_normalize_filters_flags_and_quality():
    n = K.normalize_panel(raw({"C1": "PASS"}, integrity_flags=["FABRICATED_EVIDENCE", "NOPE", "FABRICATED_EVIDENCE"],
                              evidence_quality="amazing"), "M", CL)
    assert n["flags"] == ["FABRICATED_EVIDENCE"] and n["quality"] == "INSUFFICIENT"


def test_normalize_clips_long_text():
    n = K.normalize_panel(raw({"C1": "PASS"}, reasoning="x" * 99999), "M", CL)
    assert len(n["reasoning"]) == 2000


# --- ruling derivation -----------------------------------------------------
def res(c1, c2, c3):
    return [{"id": "C1", "result": c1}, {"id": "C2", "result": c2}, {"id": "C3", "result": c3}]


@pytest.mark.parametrize("r,ruling,score", [
    (("PASS", "PASS", "PASS"), "CONFIRMED", 100),
    (("PASS", "FAIL", "PASS"), "PARTIAL", 65),
    (("PASS", "PASS", "FAIL"), "PARTIAL", 75),
    (("PASS", "FAIL", "FAIL"), "PARTIAL", 40),
    (("FAIL", "PASS", "PASS"), "REJECTED", 60),          # non-negotiable C1 failed
    (("FAIL", "FAIL", "FAIL"), "REJECTED", 0),
    (("INCONCLUSIVE", "PASS", "PASS"), "INCONCLUSIVE", 60),   # non-negotiable undecided
    (("PASS", "INCONCLUSIVE", "PASS"), "PARTIAL", 65),         # 35 < 50 inconclusive weight
    (("PASS", "INCONCLUSIVE", "INCONCLUSIVE"), "INCONCLUSIVE", 40),  # 60 >= 50
    (("INCONCLUSIVE",) * 3, "INCONCLUSIVE", 0),
    (("PASS", "FAIL", "INCONCLUSIVE"), "PARTIAL", 40),
])
def test_derive_ruling_table(r, ruling, score):
    d = K.derive_ruling(CL, res(*r))
    assert (d["ruling"], d["score"]) == (ruling, score)


def test_critical_fail_overrides_score():
    d = K.derive_ruling(CL, res("FAIL", "PASS", "PASS"))
    assert d["critical_failed"] and d["ruling"] == "REJECTED" and d["score"] == 60


def test_non_critical_fail_is_not_critical():
    d = K.derive_ruling(CL, res("PASS", "FAIL", "PASS"))
    assert not d["critical_failed"]


def test_score_never_exceeds_100():
    assert K.derive_ruling(CL, res("PASS", "PASS", "PASS"))["score"] == 100


def test_derive_lists_ids():
    d = K.derive_ruling(CL, res("PASS", "FAIL", "INCONCLUSIVE"))
    assert (d["passed"], d["failed"], d["inconclusive"]) == (["C1"], ["C2"], ["C3"])


def test_missing_verdict_counts_as_inconclusive():
    d = K.derive_ruling(CL, [{"id": "C1", "result": "PASS"}])
    assert d["inconclusive"] == ["C2", "C3"]


# --- clamp and support -----------------------------------------------------
def fetched(*rows):
    return [{"criterion_ids": ids, "retrieval": lab, "origin_class": org, "url": url}
            for ids, lab, org, url in rows]


def test_support_counts_only_success_match():
    f = fetched((["C1"], "SUCCESS_MATCH", "OPERATOR_HOSTED", "https://a.example.com/1"),
                (["C1"], "CONTENT_MISMATCH", "OPERATOR_HOSTED", "https://a.example.com/2"),
                (["C1"], "FETCH_FAIL", "OPERATOR_HOSTED", "https://a.example.com/3"))
    assert K.support_counts(f, CL)["C1"]["matches"] == 1


def test_support_counts_distinct_independent_sites():
    f = fetched((["C1"], "SUCCESS_MATCH", "THIRD_PARTY", "https://a.example.com/1"),
                (["C1"], "SUCCESS_MATCH", "THIRD_PARTY", "https://b.example.com/2"),
                (["C1"], "SUCCESS_MATCH", "THIRD_PARTY", "https://other.org/3"))
    s = K.support_counts(f, CL)["C1"]
    assert (s["matches"], s["independent_origins"]) == (3, 2)


def test_support_ignores_party_hosted_for_independence():
    f = fetched((["C1"], "SUCCESS_MATCH", "OPERATOR_HOSTED", "https://a.example.com/1"))
    assert K.support_counts(f, CL)["C1"]["independent_origins"] == 0


def test_clamp_turns_unsupported_pass_into_inconclusive():
    out, clamped = K.clamp_results(res("PASS", "PASS", "PASS"), CL, {
        "C1": {"matches": 1, "independent_origins": 0},
        "C2": {"matches": 0, "independent_origins": 0},
        "C3": {"matches": 1, "independent_origins": 0}})
    assert [r["result"] for r in out] == ["PASS", "INCONCLUSIVE", "PASS"] and clamped == ["C2"]


def test_clamp_never_touches_fail_or_inconclusive():
    out, clamped = K.clamp_results(res("FAIL", "INCONCLUSIVE", "FAIL"), CL, {})
    assert [r["result"] for r in out] == ["FAIL", "INCONCLUSIVE", "FAIL"] and clamped == []


def test_clamp_uses_independent_count_for_third_party_criteria():
    cl = K.parse_checklist(json.dumps([crit(independence="THIRD_PARTY", min_evidence=2)]))
    r = [{"id": "A", "result": "PASS"}]
    out, c = K.clamp_results(r, cl, {"A": {"matches": 5, "independent_origins": 1}})
    assert out[0]["result"] == "INCONCLUSIVE" and c == ["A"]
    out, c = K.clamp_results(r, cl, {"A": {"matches": 2, "independent_origins": 2}})
    assert out[0]["result"] == "PASS" and c == []


def test_clamp_respects_min_evidence_above_one():
    cl = K.parse_checklist(json.dumps([crit(min_evidence=3)]))
    r = [{"id": "A", "result": "PASS"}]
    assert K.clamp_results(r, cl, {"A": {"matches": 2, "independent_origins": 0}})[0][0]["result"] == "INCONCLUSIVE"
    assert K.clamp_results(r, cl, {"A": {"matches": 3, "independent_origins": 0}})[0][0]["result"] == "PASS"


# --- fingerprint -----------------------------------------------------------
def test_fingerprint_ignores_reasoning_reasons_quality_flags():
    a = [dict(r, reason="because A") for r in res("PASS", "FAIL", "PASS")]
    b = [dict(r, reason="entirely different words") for r in res("PASS", "FAIL", "PASS")]
    assert K.fingerprint("M", a, CL) == K.fingerprint("M", b, CL)


def test_fingerprint_changes_with_any_verdict():
    base = K.fingerprint("M", res("PASS", "FAIL", "PASS"), CL)
    for alt in [("PASS", "PASS", "PASS"), ("FAIL", "FAIL", "PASS"), ("PASS", "FAIL", "FAIL"),
                ("PASS", "INCONCLUSIVE", "PASS")]:
        assert K.fingerprint("M", res(*alt), CL) != base


def test_fingerprint_binds_mandate_id():
    r = res("PASS", "PASS", "PASS")
    assert K.fingerprint("M1", r, CL) != K.fingerprint("M2", r, CL)


# --- policy / payout math --------------------------------------------------
P, B, C = 100 * 10 ** 18, 5 * 10 ** 18, 2 * 10 ** 18
POL = K.parse_policy("")


@pytest.mark.parametrize("ruling,action", [("CONFIRMED", "RELEASE_FULL"), ("PARTIAL", "PRORATA"),
                                           ("REJECTED", "RETURN"), ("INCONCLUSIVE", "MANUAL_REVIEW")])
def test_choose_action_default(ruling, action):
    assert K.choose_action(POL, ruling) == action


def test_split_release_full():
    assert K.split_custody("RELEASE_FULL", P, B, C) == {"operator": P + B, "client": C}


@pytest.mark.parametrize("score", [0, 1, 33, 65, 99, 100])
def test_split_prorata_conserves_custody(score):
    s = K.split_custody("PRORATA", P, B, C, score=score)
    assert s["operator"] + s["client"] == P + B + C
    assert s["operator"] == P * score // 100 + B


def test_split_prorata_rounds_down_for_operator_with_odd_wei():
    s = K.split_custody("PRORATA", 101, 0, 0, score=33)
    assert s == {"operator": 33, "client": 68}


def test_split_return_gives_bonds_back_to_posters():
    assert K.split_custody("RETURN", P, B, C) == {"operator": B, "client": P + C}


def test_split_even_gives_odd_wei_to_client():
    assert K.split_custody("SPLIT_EVEN", 101, 0, 0) == {"operator": 50, "client": 51}


@pytest.mark.parametrize("pct", [0, 1, 50, 99, 100])
def test_split_pct_conserves(pct):
    s = K.split_custody("SPLIT_PCT", P, B, C, pct=pct)
    assert s["operator"] + s["client"] == P + B + C


@pytest.mark.parametrize("pct", [-1, 101])
def test_split_pct_bounds(pct):
    with pytest.raises(Refusal):
        K.split_custody("SPLIT_PCT", P, B, C, pct=pct)


def test_lapse_return_and_forfeit():
    assert K.split_custody("LAPSE_RETURN", P, B, 0) == {"operator": B, "client": P}
    assert K.split_custody("LAPSE_FORFEIT", P, B, 0) == {"operator": 0, "client": P + B}


def test_cancel_and_recover():
    assert K.split_custody("CANCEL", P, 0, 0) == {"operator": 0, "client": P}
    assert K.split_custody("RECOVER", P, B, C) == {"operator": B, "client": P + C}


def test_unknown_action_refused():
    with pytest.raises(Refusal):
        K.split_custody("STEAL", P, B, C)


def test_negative_components_refused():
    with pytest.raises(Refusal):
        K.split_custody("RETURN", -1, 0, 0)


# --- act matrix ------------------------------------------------------------
CLIENT, OPERATOR, ANYONE = "0xC1", "0x0P", "0xEE"


def view(**kw):
    v = {"status": "DRAFT", "client": CLIENT, "operator": OPERATOR, "execution_deadline_at": 1000,
         "review_deadline_at": 1000, "response_deadline_at": 1000, "stall_deadline_at": 1000,
         "appeal_deadline_at": 1000, "manual_deadline_at": 1000, "appeal_count": 0,
         "operator_responded": False, "resolved_action": "", "split_proposed": False,
         "split_proposer": ""}
    v.update(kw)
    return v


@pytest.mark.parametrize("status,who,now,expected", [
    ("DRAFT", CLIENT, 0, {"update_draft", "fund_mandate", "cancel_mandate"}),
    ("DRAFT", OPERATOR, 0, set()),
    ("ESCROWED", OPERATOR, 0, {"accept_mandate"}),
    ("ESCROWED", CLIENT, 0, {"cancel_mandate"}),
    ("ESCROWED", ANYONE, 0, set()),
    ("ENGAGED", OPERATOR, 500, {"submit_evidence", "submit_deliverable"}),
    ("ENGAGED", OPERATOR, 1500, {"lapse_mandate"}),
    ("ENGAGED", ANYONE, 1500, {"lapse_mandate"}),
    ("ENGAGED", CLIENT, 500, set()),
    ("DELIVERED", CLIENT, 500, {"approve_work", "open_contest"}),
    ("DELIVERED", CLIENT, 1500, {"approve_work"}),
    ("DELIVERED", OPERATOR, 500, {"submit_evidence"}),
    ("DELIVERED", OPERATOR, 1500, {"claim_unreviewed_delivery"}),
    ("APPROVED", ANYONE, 0, {"settle"}),
    ("RECORD_SEALED", ANYONE, 500, {"adjudicate"}),
    ("RECORD_SEALED", ANYONE, 1500, {"adjudicate", "recover_escrow"}),
    ("RULING", CLIENT, 500, {"appeal"}),
    ("RULING", ANYONE, 500, set()),
    ("RULING", ANYONE, 1500, {"finalize_ruling"}),
    ("APPEALED", ANYONE, 500, {"adjudicate"}),
    ("APPEALED", ANYONE, 1500, {"adjudicate", "finalize_ruling"}),
    ("LAPSED", ANYONE, 0, {"recover_escrow"}),
    ("SETTLED", CLIENT, 0, set()),
    ("CANCELLED", OPERATOR, 0, set()),
    ("RECOVERED", ANYONE, 0, set()),
])
def test_acts_table(status, who, now, expected):
    assert set(K.compute_acts(view(status=status), who, now)) == expected


def test_acts_contested_sealing_rules():
    v = view(status="CONTESTED")
    assert "seal_record" not in K.compute_acts(v, CLIENT, 500)
    assert "seal_record" not in K.compute_acts(v, ANYONE, 500)
    assert "seal_record" in K.compute_acts(v, ANYONE, 1000)
    v2 = view(status="CONTESTED", operator_responded=True)
    assert "seal_record" in K.compute_acts(v2, CLIENT, 500)
    assert "respond_to_contest" in K.compute_acts(view(status="CONTESTED"), OPERATOR, 500)
    assert "respond_to_contest" not in K.compute_acts(v2, OPERATOR, 500)


def test_acts_ruling_after_appeal_finalizes_immediately():
    v = view(status="RULING", appeal_count=1)
    assert K.compute_acts(v, ANYONE, 500) == ["finalize_ruling"]
    assert "appeal" not in K.compute_acts(v, CLIENT, 500)


def test_acts_finalized_manual_review():
    v = view(status="FINALIZED", resolved_action="MANUAL_REVIEW")
    assert set(K.compute_acts(v, CLIENT, 500)) == {"propose_split"}
    assert set(K.compute_acts(v, ANYONE, 500)) == set()
    assert set(K.compute_acts(v, ANYONE, 1500)) == {"recover_escrow"}
    v = view(status="FINALIZED", resolved_action="MANUAL_REVIEW", split_proposed=True,
             split_proposer=CLIENT)
    assert "accept_split" in K.compute_acts(v, OPERATOR, 500)
    assert "accept_split" not in K.compute_acts(v, CLIENT, 500)


def test_acts_finalized_normal_policy_settles():
    assert K.compute_acts(view(status="FINALIZED", resolved_action="PRORATA"), ANYONE, 0) == ["settle"]


# --- passport --------------------------------------------------------------
def test_passport_derived_stats():
    s = K.passport_stats({"scored": 4, "score_sum": 300, "closed": 10, "contests_faced": 4,
                          "clean_approvals": 5, "unreviewed_claims": 1})
    assert s == {"average_score": 75, "contest_rate_pct": 40, "clean_rate_pct": 60}


def test_passport_empty_has_no_averages():
    s = K.passport_stats({})
    assert s == {"average_score": None, "contest_rate_pct": None, "clean_rate_pct": None}


# --- boundary hygiene ------------------------------------------------------
def test_core_source_never_mentions_emit_or_gl():
    from support import core_source
    src = core_source()
    for needle in ("emit_transfer", "gl.", "message_raw", "nondet"):
        assert needle not in src.replace("gl.vm.UserError", "")


def test_markers_are_present_exactly_once():
    from support import BEGIN, END, CONTRACT
    text = CONTRACT.read_text(encoding="utf-8")
    assert text.count(BEGIN) == 1 and text.count(END) == 1


def test_inconclusive_weight_boundary_is_inclusive():
    cl = K.parse_checklist(json.dumps([crit(id="A", weight=50), crit(id="B", weight=50)]))
    d = K.derive_ruling(cl, [{"id": "A", "result": "PASS"}, {"id": "B", "result": "INCONCLUSIVE"}])
    assert d["ruling"] == "INCONCLUSIVE"
    cl = K.parse_checklist(json.dumps([crit(id="A", weight=51), crit(id="B", weight=49)]))
    d = K.derive_ruling(cl, [{"id": "A", "result": "PASS"}, {"id": "B", "result": "INCONCLUSIVE"}])
    assert d["ruling"] == "PARTIAL"


def test_fingerprint_distinguishes_swapped_verdicts_with_same_ruling():
    a = K.fingerprint("M", res("PASS", "FAIL", "PASS"), CL)
    b = K.fingerprint("M", res("PASS", "PASS", "FAIL"), CL)
    assert a != b


def test_credentials_in_url_get_a_specific_refusal():
    with pytest.raises(Refusal, match="embedded credentials"):
        K.split_url("https://user:pw@example.com/a", "https")


@pytest.mark.parametrize("weights", [[0, 100], [-10, 60, 50], [-1, 101]])
def test_checklist_refuses_non_positive_weights_even_when_sum_is_100(weights):
    items = [crit(id=f"A{i}", weight=w) for i, w in enumerate(weights)]
    with pytest.raises(Refusal):
        K.parse_checklist(json.dumps(items))
