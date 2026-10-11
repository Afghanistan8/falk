"""Hand-written mutation sweep over money, authority, deadline and evidence paths.

Each mutant is a small, realistic bug: swap a recipient, drop a guard, widen a
window, trust a model field. The mutated contract is written to a temp file and
the relevant slice of the suite is run against it (FALK_CONTRACT). A mutant is
KILLED when at least one test fails. The sweep exits non-zero if any mutant
survives, if a mutant spec no longer matches the source exactly once, or if the
accept-all control does not fail the suite.

    python tests/mutation_sweep.py            # all mutants
    python tests/mutation_sweep.py M07 M31    # selected ids
    python tests/mutation_sweep.py -j 4       # parallel workers
"""

import ast
import concurrent.futures as cf
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / "contracts" / "falk.py").read_text(encoding="utf-8")

CUSTODY = ["tests/direct/test_custody.py", "tests/direct/test_appeal_finalize.py"]
AUTH = ["tests/direct/test_custody.py", "tests/direct/test_evidence.py", "tests/direct/test_mandate.py",
        "tests/direct/test_appeal_finalize.py", "tests/direct/test_safety_paths.py"]
TIME = ["tests/direct/test_safety_paths.py", "tests/direct/test_evidence.py",
        "tests/direct/test_appeal_finalize.py", "tests/direct/test_custody.py"]
EVID = ["tests/direct/test_evidence.py", "tests/direct/test_adjudication.py", "tests/pure"]
ADJ = ["tests/direct/test_adjudication.py", "tests/direct/test_appeal_finalize.py", "tests/pure"]
PURE = ["tests/pure", "tests/direct/test_custody.py"]
SAFE = ["tests/direct/test_safety_paths.py"]
MAND = ["tests/direct/test_mandate.py", "tests/direct/test_evidence.py", "tests/pure"]
PARITY = ["tests/direct/test_acts_parity.py"]

M = []  # (id, category, description, [(old, new), ...], tests)


def mut(mid, cat, desc, edits, tests):
    if isinstance(edits, tuple):
        edits = [edits]
    M.append((mid, cat, desc, edits, tests))


# ------------------------------- money --------------------------------------
mut("M01", "money", "double-settle: both state guards removed",
    [("        self._require_state(m, S_APPROVED, S_FINALIZED)\n        self._require_intact(m)\n        if m.status == S_APPROVED:", "        self._require_intact(m)\n        if m.status == S_APPROVED:"),
     ("        if m.status in TERMINAL:\n            refuse(\"this mandate is already closed\")\n", "")], CUSTODY)
mut("M02", "money", "client payout goes to the operator",
    ("self._send(m.client, split[\"client\"])", "self._send(m.operator, split[\"client\"])"), CUSTODY)
mut("M03", "money", "operator payout goes to the client",
    ("self._send(m.operator, split[\"operator\"])", "self._send(m.client, split[\"operator\"])"), CUSTODY)
mut("M04", "money", "PRORATA divides by 99",
    ("share = P * int(score) // WEIGHT_TOTAL\n        op, cl = share + B, (P - share) + C", "share = P * int(score) // 99\n        op, cl = share + B, (P - share) + C"), PURE)
mut("M05", "money", "PRORATA drops the contest bond",
    ("op, cl = share + B, (P - share) + C\n    elif action in (A_RETURN", "op, cl = share + B, (P - share)\n    elif action in (A_RETURN"), PURE)
mut("M06", "money", "RELEASE_FULL sends the operator bond to the client",
    ("op, cl = P + B, C", "op, cl = P, C + B"), PURE)
mut("M07", "money", "RETURN slashes the operator bond",
    ("op, cl = B, P + C", "op, cl = 0, P + B + C"), PURE)
mut("M08", "money", "SPLIT_EVEN gives the odd wei to the operator",
    ("share = P // 2", "share = (P + 1) // 2"), PURE)
mut("M09", "money", "overpayment accepted at funding",
    ("if value != int(m.payment_wei):", "if value < int(m.payment_wei):"), MAND + AUTH[:1])
mut("M10", "money", "underpayment accepted at funding",
    ("if value != int(m.payment_wei):", "if value > int(m.payment_wei):"), AUTH[:1] + MAND)
mut("M11", "money", "operator bond underpayment accepted",
    ("if value != int(m.operator_bond_wei):", "if value > int(m.operator_bond_wei):"), AUTH[:1])
mut("M12", "money", "contest bond overpayment accepted",
    ("if value != int(m.contest_bond_wei):", "if value < int(m.contest_bond_wei):"), AUTH[:1])
mut("M13", "money", "cancel allowed after engagement",
    ("        self._require_state(m, S_DRAFT, S_ESCROWED)\n        if m.status == S_DRAFT:", "        self._require_state(m, S_DRAFT, S_ESCROWED, S_ENGAGED)\n        if m.status == S_DRAFT:"), CUSTODY)
mut("M14", "money", "custody ignores total_released",
    ("+ int(m.contest_bond_deposited) - int(m.total_released))", "+ int(m.contest_bond_deposited))"), CUSTODY + SAFE)
mut("M15", "money", "total_released never advances",
    ("m.total_released = u256(int(m.total_released) + held)", "m.total_released = u256(0)"), CUSTODY)
mut("M16", "money", "zero-value transfers emitted",
    ("        if amount > 0:\n            _Recipient(to)", "        if amount >= 0:\n            _Recipient(to)"), CUSTODY)
mut("M17", "money", "lapse FORFEIT/RETURN inverted",
    ("\"LAPSE_FORFEIT\" if m.policy_lapse_bond == \"FORFEIT\" else \"LAPSE_RETURN\"", "\"LAPSE_FORFEIT\" if m.policy_lapse_bond == \"RETURN\" else \"LAPSE_RETURN\""), SAFE)
mut("M18", "money", "manual recovery releases to the operator",
    ("self._close(m, S_RECOVERED, \"RECOVER\", \"MANUAL_REVIEW\"", "self._close(m, S_RECOVERED, \"RELEASE_FULL\", \"MANUAL_REVIEW\""), CUSTODY)
mut("M19", "money", "stalled-panel recovery releases to the operator",
    ("self._close(m, S_RECOVERED, \"RECOVER\", \"STALLED\"", "self._close(m, S_RECOVERED, \"RELEASE_FULL\", \"STALLED\""), SAFE)
mut("M20", "money", "passport value_verified counts the returned bond",
    ("+ split[\"operator\"]\n                                    - min(split[\"operator\"], int(m.operator_bond_deposited)))", "+ split[\"operator\"])"), SAFE)
mut("M21", "money", "split percentage ignored on accept",
    ("int(r.score), int(m.split_pct))", "int(r.score), 50)"), CUSTODY)
mut("M22", "money", "settle allowed for MANUAL_REVIEW rulings",
    ("        if action == A_MANUAL:\n            refuse(\"this ruling is in manual review: agree a split or wait for recovery\")\n", ""), CUSTODY)
mut("M23", "money", "unreviewed claim settles on the wrong path",
    ("m.approval_kind = \"UNREVIEWED\"", "m.approval_kind = \"CLIENT\""), SAFE)

# ------------------------------- authority -----------------------------------
mut("M24", "auth", "client guard is a no-op",
    ("        if self._sender() != str(m.client).lower():\n            refuse(\"only the client of this mandate may do that\")", "        return"), AUTH)
mut("M25", "auth", "operator guard is a no-op",
    ("        if self._sender() != str(m.operator).lower():\n            refuse(\"only the operator of this mandate may do that\")", "        return"), AUTH)
mut("M26", "auth", "party guard admits strangers",
    ("        if role == \"keeper\":\n            refuse(\"only the client or the operator of this mandate may do that\")\n        return role", "        return role"), AUTH)
mut("M27", "auth", "anyone can fund a draft",
    ("        m = self._get(mandate_id)\n        self._require_client(m)\n        self._require_state(m, S_DRAFT)\n        value", "        m = self._get(mandate_id)\n        self._require_state(m, S_DRAFT)\n        value"), AUTH)
mut("M28", "auth", "anyone can approve work",
    ("        m = self._get(mandate_id)\n        self._require_client(m)\n        self._require_state(m, S_DELIVERED)\n        self._require_intact(m)\n        m.approval_kind = \"CLIENT\"", "        m = self._get(mandate_id)\n        self._require_state(m, S_DELIVERED)\n        self._require_intact(m)\n        m.approval_kind = \"CLIENT\""), AUTH)
mut("M29", "auth", "anyone can accept as operator",
    ("        m = self._get(mandate_id)\n        self._require_operator(m)\n        self._require_state(m, S_ESCROWED)", "        m = self._get(mandate_id)\n        self._require_state(m, S_ESCROWED)"), AUTH)
mut("M30", "auth", "anyone can claim an unreviewed delivery",
    ("        m = self._get(mandate_id)\n        self._require_operator(m)\n        self._require_state(m, S_DELIVERED)\n        self._require_intact(m)\n        if self._now_ms()", "        m = self._get(mandate_id)\n        self._require_state(m, S_DELIVERED)\n        self._require_intact(m)\n        if self._now_ms()"), AUTH)
mut("M31", "auth", "strangers can appeal",
    ("        m = self._get(mandate_id)\n        self._require_party(m)\n        self._require_state(m, S_RULING)", "        m = self._get(mandate_id)\n        self._require_state(m, S_RULING)"), AUTH)
mut("M32", "auth", "client can answer the contest for the operator",
    ("        m = self._get(mandate_id)\n        self._require_operator(m)\n        self._require_state(m, S_CONTESTED)\n        contest", "        m = self._get(mandate_id)\n        self._require_state(m, S_CONTESTED)\n        contest"), AUTH)
mut("M33", "auth", "operator can cancel the escrow",
    ("        m = self._get(mandate_id)\n        self._require_client(m)\n        self._require_state(m, S_DRAFT, S_ESCROWED)", "        m = self._get(mandate_id)\n        self._require_state(m, S_DRAFT, S_ESCROWED)"), AUTH)
mut("M34", "auth", "operator can edit the draft",
    ("        m = self._get(mandate_id)\n        self._require_client(m)\n        self._require_state(m, S_DRAFT)\n        if m.terms_locked:", "        m = self._get(mandate_id)\n        self._require_state(m, S_DRAFT)\n        if m.terms_locked:"), AUTH)
mut("M35", "auth", "client may be their own operator",
    ("        if str(operator).lower() == str(m.client).lower():\n            refuse(\"client and operator must be different addresses\")\n", ""), AUTH)
mut("M36", "auth", "client may file OPERATOR_HOSTED evidence",
    ("        if origin == \"OPERATOR_HOSTED\" and role_of_caller != \"operator\":\n            refuse(\"only the operator can file OPERATOR_HOSTED evidence\")\n", ""), EVID)
mut("M37", "auth", "operator can contest their own delivery",
    ("        m = self._get(mandate_id)\n        self._require_client(m)\n        self._require_state(m, S_DELIVERED)\n        self._require_intact(m)\n        now = self._now_ms()\n        if now > int(m.review_deadline_at):", "        m = self._get(mandate_id)\n        self._require_state(m, S_DELIVERED)\n        self._require_intact(m)\n        now = self._now_ms()\n        if now > int(m.review_deadline_at):"), AUTH)
mut("M38", "auth", "strangers can propose a split",
    ("        m = self._get(mandate_id)\n        who = self._require_party(m)\n        self._require_state(m, S_FINALIZED)\n        r = self._ruling(m)", "        m = self._get(mandate_id)\n        self._require_state(m, S_FINALIZED)\n        r = self._ruling(m)"), AUTH)
mut("M39", "auth", "proposer can accept their own split",
    ("        if m.split_proposer == self._sender():\n            refuse(\"the proposer cannot accept their own split\")\n", ""), CUSTODY)
mut("M40", "auth", "an owner key appears",
    ("    version: str\n    mandates: TreeMap[str, Mandate]", "    version: str\n    owner: Address\n    mandates: TreeMap[str, Mandate]"), SAFE)

# ------------------------------- deadlines -----------------------------------
mut("M41", "deadline", "contest allowed after the review window",
    ("        if now > int(m.review_deadline_at):\n            refuse(\"the review window has closed; a contest can no longer be opened\")\n", ""), TIME)
mut("M42", "deadline", "unreviewed claim allowed during review window",
    ("        if self._now_ms() <= int(m.review_deadline_at):\n            refuse(\"the client's review window is still open\")\n", ""), TIME)
mut("M43", "deadline", "lapse allowed before the deadline",
    ("        if self._now_ms() <= int(m.execution_deadline_at):\n            refuse(\"the execution deadline has not passed\")\n", ""), TIME)
mut("M44", "deadline", "delivery allowed after the execution deadline",
    ("        if now > int(m.execution_deadline_at):\n            refuse(\"the execution deadline has passed; the mandate can only lapse\")\n", ""), TIME)
mut("M45", "deadline", "appeal allowed after the window",
    ("        if now > int(m.appeal_deadline_at):\n            refuse(\"the appeal window has closed\")\n", ""), TIME)
mut("M46", "deadline", "finalize allowed while appealable",
    ("            if int(m.appeal_count) == 0 and now <= int(m.appeal_deadline_at):\n                refuse(\"the ruling can still be appealed\")\n", "            pass\n"), TIME)
mut("M47", "deadline", "manual recovery allowed inside the window",
    ("        if now <= int(m.manual_deadline_at):\n            refuse(\"the manual-review window is still open\")\n", ""), TIME)
mut("M48", "deadline", "stalled recovery allowed early",
    ("            if now <= int(m.stall_deadline_at):\n                refuse(\"the panel still has time to rule on this record\")\n", ""), TIME)
mut("M49", "deadline", "execution clock starts at funding, not acceptance",
    ("m.execution_deadline_at = u256(now + int(m.execution_window_ms))", "m.execution_deadline_at = u256(int(m.funded_at_ms) + int(m.execution_window_ms))"), TIME)
mut("M50", "deadline", "review window uses the execution window",
    ("m.review_deadline_at = u256(now + int(m.review_window_ms))", "m.review_deadline_at = u256(now + int(m.execution_window_ms))"), TIME)
mut("M51", "deadline", "keeper may seal before the response deadline",
    ("            if not late:\n                refuse(\"only a party can seal before the response deadline\")", "            pass"), TIME)
mut("M52", "deadline", "a public clock method exists",
    ("    @gl.public.view\n    def get_protocol_info(self) -> dict:", "    @gl.public.write\n    def advance_clock(self, ms: int) -> None:\n        self.version = str(ms)\n\n    @gl.public.view\n    def get_protocol_info(self) -> dict:"), SAFE)
mut("M53", "deadline", "stalled appeal finalizes immediately",
    ("            if now <= int(m.stall_deadline_at):\n                refuse(\"the appeal round is still within its grace period\")\n", "            pass\n"), TIME)
mut("M54", "deadline", "a second time source (wall clock) is used",
    ("        raw = str(gl.message_raw[\"datetime\"] or \"\").strip()", "        import time\n        raw = str(gl.message_raw[\"datetime\"] or \"\").strip()\n        _ = time.time()"), SAFE)

# ------------------------------- evidence ------------------------------------
mut("M55", "evidence", "content commitment becomes optional",
    ("digest = require_commitment(commitment)", "digest = norm_commitment(commitment)"), EVID)
mut("M56", "evidence", "commitment is never compared to the retrieved body",
    ("if not expected or sha256_hex(stripped) != expected:", "if False:"), EVID)
mut("M57", "evidence", "mismatched content text is carried into the prompt",
    ("return (F_MISMATCH, \"\")\n    return (F_MATCH, stripped)", "return (F_MISMATCH, stripped)\n    return (F_MATCH, stripped)"), EVID)
mut("M58", "evidence", "PASS clamp removed",
    ("            if have < c[\"min_evidence\"]:\n                verdict = R_INCONCLUSIVE\n                clamped.append(r[\"id\"])", "            if False:\n                clamped.append(r[\"id\"])"), EVID)
mut("M59", "evidence", "evidence can be filed after seal",
    ("        else:\n            refuse(f\"evidence cannot be filed while the mandate is {m.status}\")", "        else:\n            pass"), EVID)
mut("M60", "evidence", "snapshot ignores urls and commitments",
    ("            items.append([int(r.receipt_id), r.criterion_ids, r.url,\n                          r.content_commitment, r.origin_class])", "            items.append([int(r.receipt_id), r.criterion_ids, r.origin_class])"), EVID)
mut("M61", "evidence", "duplicate URLs accepted",
    ("            if str(r.url).strip() == clean_url:\n                refuse(\"this URL is already filed on this mandate\")\n", ""), EVID)
mut("M62", "evidence", "independent origin may share the party's own site",
    ("        if origin in INDEPENDENT_ORIGINS and site in own_sites:\n            refuse(\"an independent origin cannot share a site with this party's own \"\n                   \"hosted evidence or the deliverable\")\n", ""), EVID)
mut("M63", "evidence", "independence counts pages instead of sites",
    ("                    sites.add(site_key(host_of(f.get(\"url\", \"\"))))", "                    sites.add(f.get(\"url\", \"\"))"), EVID)
mut("M64", "evidence", "non-success HTTP still carries a body",
    ("    if code is not None and (code < 200 or code >= 300):\n        return (F_NON_SUCCESS, \"\")", "    if False:\n        return (F_NON_SUCCESS, \"\")"), EVID)
mut("M65", "evidence", "receipt cap not enforced",
    ("        if role != \"DELIVERABLE\" and filed_by_party >= int(m.max_receipts):", "        if False:"), EVID)
mut("M66", "evidence", "loopback and private hosts accepted",
    ("    if host == \"localhost\" or host.endswith(_BLOCKED_SUFFIX):\n        refuse(\"loopback and private-network hosts are not allowed\")\n", ""), EVID)
mut("M67", "evidence", "embedded credentials accepted in URLs",
    ("    if \"@\" in authority:\n        refuse(\"URLs with embedded credentials are not allowed\")\n", ""), EVID)

# ------------------------------- adjudication --------------------------------
mut("M68", "adjudication", "critical failures no longer override the score",
    ("            nn_fail = nn_fail or c[\"non_negotiable\"]", "            nn_fail = False"), ADJ)
mut("M69", "adjudication", "score ignores frozen weights",
    ("            score += c[\"weight\"]\n            passed.append", "            score += 10\n            passed.append"), ADJ)
mut("M70", "adjudication", "inconclusive boundary becomes exclusive",
    ("elif nn_incon or incon_weight >= INCONCLUSIVE_WEIGHT_LIMIT:", "elif nn_incon or incon_weight > INCONCLUSIVE_WEIGHT_LIMIT:"), ADJ)
mut("M71", "adjudication", "fingerprint includes free-text reasons",
    ("\"results\": [[r[\"id\"], r[\"result\"]] for r in results],\n               \"inconclusive\"", "\"results\": [[r[\"id\"], r[\"result\"], r.get(\"reason\", \"\")] for r in results],\n               \"inconclusive\""), ADJ)
mut("M72", "adjudication", "fingerprint drops the verdict pairs",
    ("\"results\": [[r[\"id\"], r[\"result\"]] for r in results],\n               \"inconclusive\"", "\"results\": [],\n               \"inconclusive\""), ADJ)
mut("M73", "adjudication", "validator accepts anything",
    ("                return fprint(mid, theirs[\"results\"], crit) == fprint(mid, mine[\"results\"], crit)", "                return True"), ADJ)
mut("M74", "adjudication", "a second appeal is permitted",
    ("        if int(m.appeal_count) >= 1:\n            refuse(\"the single permitted appeal has already been used\")", "        if int(m.appeal_count) >= 2:\n            refuse(\"the single permitted appeal has already been used\")"), ADJ)
mut("M75", "adjudication", "finalize pins the first ruling regardless of appeal",
    ("m.final_ruling_id = m.latest_ruling_id", "m.final_ruling_id = u256(1)"), ADJ)
mut("M76", "adjudication", "ruling ids collide",
    ("number = len(bucket[m.mandate_id]) + 1\n        now = self._now_ms()", "number = 1\n        now = self._now_ms()"), ADJ)
mut("M77", "adjudication", "settle accepted straight from RULING",
    ("self._require_state(m, S_APPROVED, S_FINALIZED)\n        self._require_intact(m)\n        if m.status == S_APPROVED:", "self._require_state(m, S_APPROVED, S_FINALIZED, S_RULING)\n        self._require_intact(m)\n        if m.status == S_APPROVED:"), CUSTODY)
mut("M78", "adjudication", "escrow recoverable while a ruling is appealable",
    ("self._require_state(m, S_LAPSED, S_FINALIZED, S_RECORD_SEALED)", "self._require_state(m, S_LAPSED, S_FINALIZED, S_RECORD_SEALED, S_RULING)"), ADJ)
mut("M79", "adjudication", "unparseable verdicts count as PASS",
    ("    return token if token in VERDICTS else R_INCONCLUSIVE", "    return token if token in VERDICTS else R_PASS"), ADJ)
mut("M80", "adjudication", "missing verdicts default to PASS",
    ("seen.get(c[\"id\"], (R_INCONCLUSIVE, \"no verdict returned\"))", "seen.get(c[\"id\"], (R_PASS, \"no verdict returned\"))"), ADJ)
mut("M81", "adjudication", "a model-supplied ruling replaces the derived one",
    ("    return {\"score\": min(score, WEIGHT_TOTAL), \"ruling\": ruling, \"critical_failed\": nn_fail,", "    return {\"score\": min(score, WEIGHT_TOTAL), \"ruling\": (V_CONFIRMED if score >= 60 else ruling), \"critical_failed\": nn_fail,"), ADJ)

# ------------------------------- terms ---------------------------------------
mut("M82", "terms", "weights need not sum to 100",
    ("    if total != WEIGHT_TOTAL:\n        refuse(", "    if False:\n        refuse("), MAND)
mut("M83", "terms", "drafts stay editable after funding",
    ("        self._require_client(m)\n        self._require_state(m, S_DRAFT)\n        if m.terms_locked:\n            refuse(\"terms are frozen\")", "        self._require_client(m)\n        if m.terms_locked:\n            pass"), MAND)
mut("M84", "terms", "terms hash omits the checklist",
    ("\"description\": m.description, \"checklist\": self._checklist(m),", "\"description\": m.description, \"checklist\": [],"), MAND)
mut("M85", "terms", "terms hash omits policy",
    ("            \"policy\": {\"version\": POLICY_VERSION, \"CONFIRMED\": m.policy_confirmed,\n                       \"PARTIAL\": m.policy_partial, \"REJECTED\": m.policy_rejected,\n                       \"INCONCLUSIVE\": m.policy_inconclusive,\n                       \"LAPSE_BOND\": m.policy_lapse_bond},\n            \"windows_ms\"", "            \"windows_ms\""), MAND)
mut("M86", "terms", "duplicate criterion ids accepted",
    ("        if cid in seen:\n            refuse(f\"duplicate criterion id: {cid}\")\n", ""), PURE + MAND)
mut("M87", "terms", "negative weights accepted",
    ("        if weight < 1 or weight > WEIGHT_TOTAL:", "        if weight > WEIGHT_TOTAL:"), PURE)
mut("M88", "terms", "act matrix offers contest after the review window",
    ("            if now <= v[\"review_deadline_at\"]:\n                acts.append(\"open_contest\")", "            if True:\n                acts.append(\"open_contest\")"), PARITY + PURE)

CONTROL = ("CTRL", "control", "accept-all: every refusal becomes a no-op",
           [("def refuse(message):\n    raise _UserError(f\"{E_EXPECTED} {message}\")", "def refuse(message):\n    return None")],
           ["tests/direct/test_custody.py", "tests/direct/test_evidence.py", "tests/direct/test_mandate.py"])


def run_one(spec):
    mid, cat, desc, edits, tests = spec
    text = SRC
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            return (mid, cat, desc, "BAD-SPEC", f"snippet matched {n} times: {old[:70]!r}")
        text = text.replace(old, new)
    try:
        ast.parse(text)
    except SyntaxError as err:
        return (mid, cat, desc, "BAD-SPEC", f"mutant does not compile: {err}")
    with tempfile.TemporaryDirectory() as tmp:
        path = pathlib.Path(tmp) / "falk_mutant.py"
        path.write_text(text, encoding="utf-8")
        env = dict(os.environ, FALK_CONTRACT=str(path), PYTHONUTF8="1")
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", *tests],
            cwd=ROOT, env=env, capture_output=True, text=True)
    status = "KILLED" if proc.returncode != 0 else "SURVIVED"
    tail = ""
    if status == "KILLED":
        for line in proc.stdout.splitlines():
            if line.startswith("FAILED") or line.startswith("ERROR"):
                tail = line[:140]
                break
    return (mid, cat, desc, status, tail)


def main(argv):
    workers = 1
    wanted = []
    it = iter(argv)
    for a in it:
        if a == "-j":
            workers = int(next(it))
        else:
            wanted.append(a)
    specs = [s for s in M if not wanted or s[0] in wanted]
    results = []
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        for res in pool.map(run_one, specs):
            results.append(res)
            print(f"{res[0]:5} {res[1]:12} {res[3]:9} {res[2]}")
            if res[3] != "KILLED":
                print(f"        -> {res[4]}")
    if not wanted:
        ctl = run_one(CONTROL)
        print(f"{ctl[0]:5} {ctl[1]:12} {ctl[3]:9} {ctl[2]}")
        results.append(ctl)
    killed = sum(1 for r in results if r[3] == "KILLED")
    bad = [r for r in results if r[3] != "KILLED"]
    print(f"\nmutants: {len(results)}  killed: {killed}  survived/bad: {len(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
