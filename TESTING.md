# Testing

Falk is tested in five layers. Each layer catches a different class of mistake,
and the layers are designed to *check each other*.

| Layer | Where | Count | Needs |
| --- | --- | --- | --- |
| Pure core | `tests/pure/` | 216 | Python only (no GenVM, no `gl`) |
| Direct GenVM | `tests/direct/` | 291 | GenVM runner (cached by `fetch_genvm_bundle.py`) |
| Mutation sweep | `tests/mutation_sweep.py` | 88 mutants + 1 accept-all control | the two above |
| Web + verifier tests | `scripts/*.test.mjs` | 19 | Node 24 |
| Keyless live checks | `verify:live`, `verify:safety`, `verify:arc` | 5 + 8 + per-mandate | network only |
| Live arc | `scripts/arc.mjs` | 8 scenarios, 53 checks | funded test accounts |

## Setup

```bash
pip install -r requirements.txt
python scripts/fetch_genvm_bundle.py     # caches the pinned GenVM bundle
npm ci
```

On Windows set `PYTHONUTF8=1`. Plain `python -m pytest` works for every suite; the
`gltest` wrapper is equivalent.

## Pure core — `tests/pure/test_core.py`

`tests/support.py::core()` extracts the region of `contracts/falk.py` between
`# ==== FALK PURE CORE BEGIN ====` and `END`, executes it in a bare namespace that has
**no `gl` object**, and tests it. If a core function ever reached for the VM, its
test would fail with `NameError`; `test_core_has_no_gl_object` and
`test_core_source_never_mentions_emit_or_gl` pin this.

Covers: canonical JSON, sha256 and commitments, URL and origin rules, `site_key`,
checklist validation (weights, ids, unknown keys, bounds), policy and window
parsing, the retrieval taxonomy, panel normalisation (invented fields, missing and
conflicting verdicts), the PASS clamp, ruling derivation (table-driven, every
boundary), the consequence-only fingerprint, payout math with conservation, the act
matrix (table-driven), and passport derivations.

## Direct GenVM — `tests/direct/`

The real contract runs in a real GenVM runner. Web and LLM calls are mocked, but
storage, ABI decoding, authorisation, attached value, state transitions **and the
emitted `EthSend` transfers** are the real thing: the harness installs a call hook
and records every transfer, so custody tests assert actual payouts, not just stored
numbers.

| File | Tests | Focus |
| --- | --- | --- |
| `test_mandate.py` | 47 | creation, validation, draft edits, funding, terms-hash coverage, post-fund immutability |
| `test_custody.py` | 35 | exact deposits, cancel, approve/settle, every policy payout, conservation, no zero-value transfers |
| `test_evidence.py` | 65 | commitments, URLs, roles/origins, who-can-file-when, caps, independence, deliverable, contest, response, sealing |
| `test_adjudication.py` | 50 | ruling derivation through the contract, invented-field discard, every retrieval label, clamps, failed rounds, **validator replay** (agree / disagree) |
| `test_appeal_finalize.py` | 32 | appeal bounds, finalize gates, ruling pinning, stalled appeal, manual-review split and recovery |
| `test_safety_paths.py` | 48 | unreviewed delivery, lapse, recovery gates, stalled panel, ABI/AST hygiene (no clock, no owner, one exit), datetime handling, passport, views |
| `test_acts_parity.py` | 14 | the act matrix versus the contract's real refusals |

Validator behaviour is tested with the direct runner's `run_validator`, which
re-executes the captured validator against swapped mocks: identical observation
agrees; reasoning/quality/flag differences agree (they are not in the
fingerprint); a different verdict, a different retrieval, malformed output, a
forged leader result with invented fields — all disagree.

### The act-matrix parity test

`test_acts_parity.py` is the strongest guard against a UI that lies. For each of 14
lifecycle states, three roles (client, operator, stranger) and every deadline
boundary (`d`, `d+1`) it:

1. computes `compute_acts` from the public mandate view, then
2. **actually attempts every state-bound write** on a snapshot of the chain and
   records which succeed, then
3. asserts the two sets are equal.

`tests/gen_vectors.py` then writes 6,048 vectors from the Python original;
`scripts/web.test.mjs` replays them against `src/lib/acts.ts`. The UI cannot offer
a button the contract will refuse, or hide one it will accept.

## Mutation sweep — `tests/mutation_sweep.py`

88 hand-written mutants, each a small realistic bug, in six families:

| Family | Examples |
| --- | --- |
| money (23) | swapped recipients, PRORATA divisor, dropped contest bond, bond sent to client, exact-amount guards weakened, double-settle with both guards removed, zero-value transfers, lapse rule inverted |
| authority (17) | every `_require_*` guard as a no-op, per-method guard removals, client = operator, an owner field appears |
| deadline (14) | each window check removed, wrong base for a deadline, a public clock method appears, a wall-clock read appears |
| evidence (13) | commitment optional, hash never compared, mismatch carries text, PASS clamp removed, post-seal filing, snapshot ignores URLs, duplicate URLs, independence by page instead of site, loopback hosts, credentials in URLs |
| adjudication (14) | critical override removed, weights ignored, boundary flipped, fingerprint includes reasons / drops pairs, validator accepts anything, second appeal, ruling ids collide, unparseable verdict = PASS, model-supplied ruling replaces the derived one |
| terms (7) | weights ≠ 100, drafts editable after funding, terms hash omits checklist/policy, duplicate ids, negative weights |

Each mutant runs only the relevant slice of the suite against the mutated copy
(`FALK_CONTRACT=<tmp>`) and is **killed** when any test fails. The sweep exits
non-zero if a mutant survives, if a mutant spec stops matching the source exactly
once, if a mutant does not compile, or if the accept-all control (`refuse()` made
a no-op) does not fail the suite.

Honest note on the first run: 83 of 89 were killed. Two mutant specs did not compile
(removing a guarded statement left an empty block — fixed by replacing it with
`pass`), and four survivors exposed weak tests rather than weak mutants: a
terms-hash test that compared two mandates whose ids already differed (so the hash
differed whether or not the checklist was hashed — now it compares the *same* id via
snapshot/revert); a zero-weight/negative-weight case that the sum-to-100 check
masked in single-criterion tests (now `[0,100]`, `[-10,60,50]`); an embedded-credentials
URL that a later host check also refused (now the test asserts the specific
refusal); and the policy hash. Two further gaps were found while writing the sweep,
before it ran: a weight boundary (50) that no fixture could reach, and a fingerprint
case where two different verdict sets share a ruling. All were fixed by strengthening
the tests, not by editing the mutants.

```bash
python tests/mutation_sweep.py -j 4          # all
python tests/mutation_sweep.py M07 M31       # selected
```

## Web and verifier tests

`npm run test:web` (Node's built-in runner):

* act matrix equals the Python original on 6,048 vectors; every withheld act has a
  reason;
* `sha256Hex` / `commitmentOf` (Python `strip()` semantics) / GEN formatting /
  refusal text;
* **safety verifier self-test** — `verify_safety.mjs` is run against 13 deliberately
  broken copies of the contract (clock method, owner field, second value exit,
  recovery during an appeal, optional commitment, …) and must fail the matching
  check, so a green `verify:safety` is not vacuous.

`npm run lint`, `npm run typecheck`, `npm run build` must be clean.

## Keyless live verification

```bash
npm run verify:live     # chain id · source sha256 (repo == chain) · ABI counts · protocol revision
npm run verify:safety   # S1–S8 against the source read back from the chain
npm run verify:arc      # every recorded live mandate is still terminal, balanced, and its txs exist
```

Expected `verify:live` output:

```text
PASS chain: 61999
PASS contract: 0x35726f0f09FC0b84b679d2Ec26FB38Ea851BB8a8
PASS source: sha256 … (repository == chain, … lines)
PASS schema: 31 methods (11 read, 20 write)
PASS protocol: FALK-1.0.0, N mandate(s), no owner, no clock method
verify:live PASSED (5 checks)
```

## Live arc — `scripts/arc.mjs`

Eight scenarios, in parallel, each with its own derived test accounts, against the
deployment of record, with real signed transactions, real validator retrieval of
public fixtures and the real LLM panel:

| | Scenario | Proves |
| --- | --- | --- |
| A | approve → settle | RELEASE_FULL, 8 refusals (stranger, short bond, no commitment, recover while engaged, settle twice, …) |
| B | contest → live panel → finalize → settle | the contract's score equals the arithmetic over the verdicts; payout = formula; transfers land |
| C | wrong commitments → CONTENT_MISMATCH → recovery | no PASS on mismatched content; manual-review exit |
| D | fund → cancel | payment returned |
| E | accept → miss deadline → lapse → recover | bond returned; passport lapse |
| F | ruling → appeal → second round → finalize → settle | both rulings preserved; appeal pinned; recover refused mid-appeal |
| G | silent client → claim → settle | contest refused after the window; passport unreviewed claim |
| H | refusal walls on a funded mandate | seven refusals |

It reconciles custody (settlement record balances; custody 0; **real balances move
by the settled amounts**) and records every transaction hash with an explorer link
in `docs/LIVE_PROOF.md`.

```bash
node scripts/arc.mjs                  # all; writes deployments/arc-studionet.json + docs/LIVE_PROOF.md
node scripts/arc.mjs --only A,B       # a subset (writes .arc/last-run.json only)
```

Because the panel is a real LLM on public fixtures, the ruling in B/F depends on the
panel's reading of the fixture. The checks therefore assert the **arithmetic**
(stored score equals the derivation from the stored verdicts; payout equals the
policy formula for the stored score) rather than a particular verdict. In
every recorded run the panel ruled the sourced/unsourced fixtures as designed.

## What is not tested

* A direct-mode run uses mocked web/LLM; only the live arc exercises real
  validators. Both are needed.
* There is no fuzzing of the calldata decoder (the platform's) and no formal
  verification.
* There is no external audit.
