# Falk

**The record settles the work.**

Falk is an evidence-backed verification and settlement protocol for delegated work, built as a single GenLayer Intelligent Contract. A client funds a mandate; an operator accepts with a bond and delivers; if anyone disputes the work, independent validators retrieve the **sealed** public evidence, re-check it against sha256 commitments, and return **PASS / FAIL / INCONCLUSIVE per criterion — and nothing else**. The contract alone sums the frozen weights, derives the ruling, selects the frozen policy and moves the money. Models never name an amount, a recipient, a percentage or a payout.

> Panel returns meaning. Contract moves money.

## Live deployment

| | |
| --- | --- |
| Network | GenLayer StudioNet |
| Chain id | `61999` (`0xf22f`) |
| RPC | `https://studio.genlayer.com/api` |
| Contract | [`0x35726f0f09FC0b84b679d2Ec26FB38Ea851BB8a8`](https://explorer-studio.genlayer.com/address/0x35726f0f09FC0b84b679d2Ec26FB38Ea851BB8a8) |
| Deploy transaction | [`0x845adfc6…5ad7`](https://explorer-studio.genlayer.com/tx/0x845adfc635b35c7aa9730465befc4caec21a2bd08c8a389b7117d2cb79515ad7) |
| Protocol revision | `FALK-1.0.0` (policy template `FALK-POLICY-1`) |
| Source | `contracts/falk.py` — 1,901 lines, 81,659 bytes |
| Source sha256 | `6f2f696c80ef42951f76ea6230d62071700a72b7319cd9814863c6af5287c65e` (repository == chain) |
| Public methods | 31 = 20 write + 11 read (also reported on-chain by `get_protocol_info`) |
| Runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Owner / admin / pause / upgrade | none |

The manifest is [`deployments/studionet.json`](deployments/studionet.json), written by `scripts/record_deployment.mjs` from what the chain reports. `npm run verify:live` re-derives every row above without a wallet.

## Core guarantees

* **Models return meaning only.** The normaliser rebuilds a fixed key set; invented `payout`, `recipient`, `percentage`, `score`, `ruling` or `policy` fields are discarded. Score = Σ frozen integer weights of PASS criteria; a non-negotiable FAIL forces REJECTED.
* **Evidence is committed, then sealed.** Every receipt carries a mandatory sha256 content commitment. `seal_record` freezes the admissible set and a snapshot hash; nothing filed afterwards is judged. After sealing, a retrieved body that hashes differently is `CONTENT_MISMATCH` — **no text reaches the model**, and it cannot support PASS.
* **The contract clamps PASS.** After the model answers, a PASS survives only if the contract counts enough `SUCCESS_MATCH` receipts mapped to that criterion (and enough *distinct independent sites* for `THIRD_PARTY` criteria). The clamp runs on contract-held numbers, after the model.
* **Consequence-only consensus.** Leader and validators run the same code (the validator re-executes `leader_fn`). The fingerprint is `(mandate id, ordered (criterion, verdict) pairs, inconclusive ids, derived ruling)`. Reasoning, quality grades, flags and retrieval labels are stored for inspection and never gate acceptance.
* **Time is consensus time.** Deadlines are absolute UTC milliseconds taken from the transaction datetime at each transition, per mandate. There is no tick, wait, sleep or clock method, and no method accepts a timestamp.
* **One value exit.** `emit_transfer` appears once, in `_send`, called only from `_close`, which is reached only from cancel / settle / accept-split / recover. Recipients are read from storage; no public method takes a recipient or an amount. Settlement conserves custody (`Σ == held`, asserted) and runs once.
* **No stranded funds.** Silent client → `claim_unreviewed_delivery`. Silent operator → lapse → recover. Failed panel → nothing written, retry. Stalled record → recover after the grace period. Stalled appeal → the first ruling stands. Manual review → agreed split, or recovery returns each party their own deposit. Nothing is recoverable while a ruling is appealable.
* **No owner key.** No admin, pause, upgrade or withdraw path — checked in the ABI, in storage and in the on-chain source.
* **Bonds return to posters** by default; ordinary underperformance is not misconduct. A mandate may freeze `LAPSE_BOND = FORFEIT` instead.
* **The UI does not lie.** Re-read after every write; an accepted-but-refused transaction is shown as refused; a pending hash is shown as pending and never invites a resubmission.

## How each naive LLM-oracle failure is closed

| Failure | Closed by |
| --- | --- |
| Invented payouts | normaliser + contract arithmetic (mutants M69, M79–M81) |
| Post-seal evidence swap | sha256 commitments + seal snapshot (M55–M60) |
| Prompt injection in a source | text is data; only SUCCESS_MATCH text is shown; the clamp needs matching evidence (live fixture `injection-attempt.md`) |
| Clock gaming | no clock method; one time source (M52, M54, S1/S3) |
| Silent counterparty | unreviewed claim · lapse · stall recovery (S5, S6, arc E/G) |
| Double settle | terminal-state guard + single exit (M01, S4/S8) |
| Failed panel moves money | all writes happen after the round returns (tests, arc) |
| Evidence cap griefing | per-party allowance |
| Optimistic UI | authoritative re-read, refusal and pending states |

Full analysis: [SECURITY.md](SECURITY.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Lifecycle

```text
DRAFT ──fund──► ESCROWED ──accept (+bond)──► ENGAGED ──deliver──► DELIVERED
  │ cancel          │ cancel (client)          │ lapse (past deadline)   │
  ▼                 ▼                          ▼                         │
CANCELLED       CANCELLED                   LAPSED ──recover──► RECOVERED│
                                                                         │
     approve (client) / claim_unreviewed (operator, after review) ◄──────┤
        ▼                                                                │
    APPROVED ──settle──► SETTLED                  open_contest (+bond) ◄─┘
                                                        ▼
                                                   CONTESTED ──respond / seal──► RECORD_SEALED
                                                                                    │ adjudicate (panel)
                                              appeal (once) ◄── RULING ◄───────────┘
                                                  ▼               │ finalize (after appeal window)
                                              APPEALED            ▼
                                                  └─adjudicate─► FINALIZED ──settle──► SETTLED
                                                              (manual review: agreed split, or recover)
```

## Outcomes

| Ruling | Derived by the contract when | Default settlement |
| --- | --- | --- |
| `CONFIRMED` | all criteria PASS | `RELEASE_FULL` → operator `P + B` |
| `PARTIAL` | some PASS; score = Σ weights of PASS | `PRORATA` → operator `⌊P·score/100⌋ + B`, client the rest `+ C` |
| `REJECTED` | a non-negotiable FAIL, or nothing passed | `RETURN` → client `P + C`, operator `B` |
| `INCONCLUSIVE` | a non-negotiable is undecided, or undecided weight ≥ 50 | `MANUAL_REVIEW` (or `RETURN` / `SPLIT_EVEN`, as frozen) |

`P` payment, `B` operator bond, `C` contest bond — all **deposited** amounts. Derivation order: non-negotiable FAIL → REJECTED; all PASS → CONFIRMED; undecided → INCONCLUSIVE; no PASS → REJECTED; else PARTIAL. See [docs/PROTOCOL.md](docs/PROTOCOL.md) and [docs/ECONOMICS.md](docs/ECONOMICS.md).

## Public surface

**Writes (20)**

| Method | Caller | From → to |
| --- | --- | --- |
| `create_mandate` | anyone (becomes client) | → DRAFT |
| `update_draft` | client | DRAFT |
| `fund_mandate` (payable, exact) | client | DRAFT → ESCROWED |
| `accept_mandate` (payable, exact bond) | operator | ESCROWED → ENGAGED |
| `cancel_mandate` | client | DRAFT / ESCROWED → CANCELLED |
| `submit_evidence` | client / operator | ENGAGED, DELIVERED, CONTESTED (before seal) |
| `submit_deliverable` | operator | ENGAGED → DELIVERED |
| `approve_work` | client | DELIVERED → APPROVED |
| `claim_unreviewed_delivery` | operator | DELIVERED → APPROVED (after review deadline) |
| `open_contest` (payable, exact bond) | client | DELIVERED → CONTESTED (before review deadline) |
| `respond_to_contest` | operator | CONTESTED |
| `seal_record` | party; anyone after the response deadline | CONTESTED → RECORD_SEALED |
| `adjudicate` | anyone | RECORD_SEALED / APPEALED → RULING |
| `appeal` | client / operator (once) | RULING → APPEALED |
| `finalize_ruling` | anyone | RULING / APPEALED → FINALIZED |
| `settle` | anyone | APPROVED / FINALIZED → SETTLED |
| `propose_split`, `accept_split` | parties | FINALIZED (manual review) |
| `lapse_mandate` | anyone | ENGAGED → LAPSED |
| `recover_escrow` | anyone | LAPSED / FINALIZED (manual) / stalled RECORD_SEALED → RECOVERED |

**Reads (11):** `get_protocol_info`, `list_mandates`, `list_mandates_for`, `get_mandate`, `get_criteria`, `get_evidence`, `get_contest`, `list_rulings`, `get_ruling`, `get_settlement`, `get_passport`.

The *act matrix* — which writes a wallet may attempt on a mandate right now — is a pure function (`compute_acts` in the contract file, mirrored in `src/lib/acts.ts`) that the UI uses and the test-suite checks against the contract's real refusals.

## Operator passport

Counts only, written once per mandate at its terminal transition: `closed`, `clean_approvals`, `unreviewed_claims`, `confirmed`, `partial`, `rejected`, `inconclusive`, `contests_faced`, `appeals_filed`, `critical_fails`, `lapses`, `scored`, `score_sum`, `value_verified_wei` (wei actually paid for work, bond excluded). Averages and rates are computed at read time, so they cannot drift and wording in an agreement cannot raise them.

## Web architecture

```text
 MetaMask (EIP-1193) ──signs──┐
                              ▼
 Next.js app (no DB, no server key) ── src/lib/falk.ts ── genlayer-js ──► StudioNet RPC
        ▲   src/lib/acts.ts (pure act matrix)                               │
        └──────────── re-read chain state after every write ◄───────────────┘
```

No database, no server signer, no simulator fallback, no seeded data. `src/lib/config.ts` is the sole resolver of network and address. `/api/health` is a keyless probe.

## Verify it yourself (no wallet, no key)

```bash
npm ci
npm run verify:live     # chain id · source sha256 (repo == chain) · ABI counts · revision
npm run verify:safety   # S1–S8 against the source read back from the chain
npm run verify:arc      # the recorded live mandates are still terminal, balanced, and their txs exist
```

```text
PASS chain: 61999
PASS contract: 0x35726f0f09FC0b84b679d2Ec26FB38Ea851BB8a8
PASS source: sha256 6f2f696c…c65e (repository == chain, 1901 lines)
PASS schema: 31 methods (11 read, 20 write)
PASS protocol: FALK-1.0.0, N mandate(s), no owner, no clock method
verify:live PASSED (5 checks)
```

## Testing

```bash
pip install -r requirements.txt && python scripts/fetch_genvm_bundle.py
python -m pytest tests/pure -q        # 216 — the pure core, with no VM
python -m pytest tests/direct -q      # 291 — real GenVM runner, mocked web + LLM, captured transfers
python tests/mutation_sweep.py -j 4   # 88 hand-written mutants + accept-all control; all must be killed
npm run test:web                      # 19 — act-matrix parity (6,048 vectors) + safety-verifier self-test
npm run lint && npm run typecheck && npm run build
```

* **Pure core, tested with no GenVM.** The region of `contracts/falk.py` between the `FALK PURE CORE` markers is executed in a namespace with no `gl` object.
* **Direct suite** exercises lifecycle, weights, immutability, exact bonds, evidence binding, sealing, normalisation, invented-field discard, score, critical failure, appeal, finalize, settle, double-settle, unreviewed delivery, recovery gates, content mismatch, ABI hygiene — and replays **validators** against swapped observations.
* **Act-matrix parity:** 14 states × 3 roles × every deadline boundary — the pure matrix must equal what the contract actually accepts.
* **Mutation sweep:** swapped recipients, dropped guards, widened windows, invented payouts, a public clock method, weights ≠ 100, post-fund edits, evidence without commitment … The first full sweep killed 83 of 89; two mutant specs did not compile (fixed) and four survivors exposed weak tests, which were strengthened rather than the mutants edited. Details in [TESTING.md](TESTING.md).

## Verified end-to-end live

<!-- proof:start -->
Run `node scripts/arc.mjs` on 2026-10-11 against `0x35726f0f09FC0b84b679d2Ec26FB38Ea851BB8a8` (FALK-1.0.0): **53/53 checks passed**, 8 scenarios, 569s, every hash a real StudioNet transaction.

| | Scenario | Mandate | Outcome | Refusals | Key transactions |
| --- | --- | --- | --- | --- | --- |
| A | Approve path | `FLK-000020` | RELEASE_FULL · operator 2.5 GEN | 7 | approve_work [`0x514674f5…`](https://explorer-studio.genlayer.com/tx/0x514674f586aff099447bf1578eb79c09aa8337e39644bfa8a9a60d6ed939c293) · settle [`0xb6020f65…`](https://explorer-studio.genlayer.com/tx/0xb6020f659442aa8f65aa1dc2885e91e10f41dce533e30e922ffa888e3c0a203f) |
| B | Contested → pro-rata | `FLK-000021` | PARTIAL 65/100 → PRORATA · operator 1.8 GEN | 1 | adjudicate [`0x076e586b…`](https://explorer-studio.genlayer.com/tx/0x076e586bd949006f69707bd32bd24258e4979d820fe45fed93d819034a5bea72) · settle [`0xaba0f617…`](https://explorer-studio.genlayer.com/tx/0xaba0f617270ba5bea3f589dd2e7ed3421b1704c32cd78ba0d3b31d9f2a9f66e5) |
| C | Content mismatch → recovery | `FLK-000022` | INCONCLUSIVE → recovered · client 2.2 / operator 0.5 GEN | 1 | adjudicate [`0x93ab4289…`](https://explorer-studio.genlayer.com/tx/0x93ab428962cdebfad8bddcde34d570f3ecabe284ea5f49f23c27785536b4fd65) · recover_escrow [`0xe75e654c…`](https://explorer-studio.genlayer.com/tx/0xe75e654ccfbc4d870358e778da7890d9e94a92416ef2fcb2c400e36ffd351550) |
| D | Cancel before engagement | `FLK-000023` | CANCELLED · payment returned | 1 | cancel_mandate [`0xd0e6954e…`](https://explorer-studio.genlayer.com/tx/0xd0e6954e43f2c1b5d3d4802a9f573404d9f6f809bb9d5eeca23c5009c9a46bfc) |
| E | Lapse → recovery | `FLK-000024` | LAPSED → recovered · bond returned | 1 | lapse_mandate [`0x316b03ef…`](https://explorer-studio.genlayer.com/tx/0x316b03ef26012ff1e30a32aaf8f7d8d22d9d9ed4b33c55826482429c70fb5f3f) · recover_escrow [`0x300f3024…`](https://explorer-studio.genlayer.com/tx/0x300f30247c12f402b15899b2bcba70d3aba83cf22b41b7d38c6190e32eccae1b) |
| F | Appeal | `FLK-000025` | appealed: PARTIAL/65 → PARTIAL/65 → PRORATA | 2 | adjudicate [`0x76bdc695…`](https://explorer-studio.genlayer.com/tx/0x76bdc69576aa8136864465fbbb6aef7ea61ab68a58eb3e443c64aa4c856804eb) · appeal [`0x4ce91ed1…`](https://explorer-studio.genlayer.com/tx/0x4ce91ed160fd0a9101f843fc3e63311cbf48bd8dc1d2f6d11871946e6ff1cd45) · adjudicate [`0x589bdbaa…`](https://explorer-studio.genlayer.com/tx/0x589bdbaa2eb2b1ef480068d4831f49307b4a9520b6d6d2161eb7d55eaaec8464) · settle [`0x379db436…`](https://explorer-studio.genlayer.com/tx/0x379db436182ce581725f1db8a03052c08ef6080b77c5aa43b26006cf6df291a5) |
| G | Unreviewed delivery | `FLK-000026` | RELEASE_FULL (unreviewed) · operator 2.5 GEN | 2 | claim_unreviewed_delivery [`0x0c5cbf40…`](https://explorer-studio.genlayer.com/tx/0x0c5cbf40c0b0124ebb7c90b9fe59aa737721e66376939e32e1c943ed1ccb8a5f) · settle [`0x68d2389c…`](https://explorer-studio.genlayer.com/tx/0x68d2389c2e1e60403e23460e0f9e1ca4d126cc9ccef68bf3f9a5dad7ae0611b3) |
| H | Refusal walls | `FLK-000027` | all walls held · cancelled cleanly | 6 | cancel_mandate [`0x56cfe3e2…`](https://explorer-studio.genlayer.com/tx/0x56cfe3e20bed2e52d6c0fd304718a46c15d6c39f9355091c85235a76c923485b) |

Every step and every refusal, with explorer links: [docs/LIVE_PROOF.md](docs/LIVE_PROOF.md). Machine record: [deployments/arc-studionet.json](deployments/arc-studionet.json). Re-check it keylessly with `npm run verify:arc`.
<!-- proof:end -->

The arc uses throw-away accounts funded from the deployer, public fixtures served from this repository, real validator retrieval and the real LLM panel. Checks include: the stored score equals the contract's arithmetic over the stored verdicts; settlement records balance; custody is zero; **the emitted transfers move the parties' real balances by the settled amounts**.

## Repository layout

```text
contracts/falk.py            the deployable Intelligent Contract: pure core + storage + shell
deployments/                 studionet.json (address of record) · arc-studionet.json (live proof)
tests/pure/                  the pure core, no VM
tests/direct/                291 direct GenVM tests
tests/mutation_sweep.py      88 mutants + control
tests/gen_vectors.py         act-matrix vectors shared with the web tests
samples/fixtures/            public evidence documents · samples/scenarios · MANUAL_TEST_CHECKLIST.md
scripts/                     verify_* (keyless) · arc.mjs · record_deployment.mjs · fetch_genvm_bundle.py
src/app, src/components      Next.js App Router UI
src/lib/                     config · falk (client) · useFalk · acts · present · pure
docs/                        ARCHITECTURE · PROTOCOL · THREAT_MODEL · ECONOMICS · LIVE_PROOF
SECURITY.md TESTING.md DEPLOYMENT.md
.github/workflows/ci.yml     web · contract · mutation · keyless live checks
```

## What Falk does differently from the reference design (Attestra)

Falk is an original implementation of the same problem class, and was designed against Attestra's README, contract and tests. Concrete, checkable differences:

| | Attestra (`lobinni/attestra`) | Falk |
| --- | --- | --- |
| Structure | one 2,379-line module of helpers plus the contract | a pure core (no `gl`) that is extracted and tested with no VM, plus a thin shell, in one deployable file |
| Direct tests | 53 | 291 (plus 216 pure-core tests) |
| Mutation testing | none in the repository | 88 hand-written mutants + an accept-all control, run in CI |
| Who may progress a mandate | the two parties **or a deploy-time `owner`** that is stored on-chain (used by `seal_record`, `adjudicate`, `finalize_ruling`, `settle`, `lapse_mandate`, `recover_escrow`) | anyone; there is no owner. Progress methods cannot choose a recipient or an amount |
| Per-criterion verdicts | used as the panel returned them (after normalisation) | additionally clamped by the contract: a PASS needs `min_evidence` matching receipts and, for `THIRD_PARTY` criteria, distinct independent sites |
| Evidence allowance | not per party in the source I read | per-party, so one side cannot crowd the other out of the record |
| UI correctness | — | the act matrix is a pure function whose output is compared with the contract's real refusals in every state, role and deadline boundary |
| Keyless verification | `check_live_deployment`, `check_safety_requirements` | `verify:live`, `verify:safety` (S1–S8, self-tested against 13 deliberately broken contracts) and `verify:arc` |

The Attestra column is what I found reading its repository at the time of writing; it may have changed since.

## Limitations (honest)

A colluding validator majority can return wrong verdicts (one appeal, same kind of panel). Evidence that disappears before the round cannot support PASS. Deadlines are only as honest as the consensus datetime. Independence is enforced by declared origin and distinct-site rules, which cannot see two domains secretly owned by one party. The passport records settled history; it is not an identity system and cannot resist sybils. LLM validators can disagree on subjective criteria — that costs a retry, never money. There is no upgrade path (by design) and **no external audit**. StudioNet is a test network. See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
