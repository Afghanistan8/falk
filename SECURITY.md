# Security

Falk is a custody contract. This document states what it promises, how each
promise is enforced, how each promise is *tested*, and what it does **not**
promise. The longer adversarial analysis is in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

> Falk has had no external audit. StudioNet is a test network. Do not put in funds
> you cannot lose.

## Reporting

Open a private security advisory on the repository
(<https://github.com/Afghanistan8/falk/security/advisories>) or email the
maintainer listed on the GitHub profile. Please include the mandate id or
transaction hash and the state you expected.

## Invariants

| # | Invariant | Enforced by | Verified by |
| --- | --- | --- | --- |
| I1 | A model cannot name an amount, percentage, recipient, score, ruling or policy. | `normalize_panel` rebuilds a fixed key set; `derive_ruling` and `split_custody` are integer arithmetic over storage. | `test_core.py` (normalise), `test_adjudication.py::test_invented_*`, mutants M69, M79–M81 |
| I2 | Score = Σ frozen weights of PASS criteria; weights total exactly 100; non-negotiable FAIL ⇒ REJECTED. | `parse_checklist`, `derive_ruling` | pure table tests, M68, M82, M87 |
| I3 | Evidence is bound to a sha256 committed at filing and re-checked after sealing; a mismatch carries no text and cannot support PASS. | `require_commitment`, `classify_fetch`, PASS clamp | `test_adjudication.py` taxonomy tests, M55–M58, `verify:safety` S7 |
| I4 | Nothing filed after `seal_record` is judged. | state gate in `submit_evidence`; snapshot hash recomputed in `adjudicate` | `test_evidence.py::test_nothing_enters_the_record_after_seal`, M59, M60 |
| I5 | Time is the consensus transaction datetime; no method accepts or advances time; deadlines are per mandate. | `_now_ms` is the only reader of `gl.message_raw["datetime"]` | ABI/AST tests, M52, M54, `verify:safety` S1/S3 |
| I6 | Value leaves through exactly one function, to addresses read from storage. | `_send` ← `_close` ← {cancel, settle, accept_split, recover} | AST tests, M02, M03, `verify:safety` S4 |
| I7 | Settlement conserves custody and runs once. | `split_custody` asserts Σ = held; `_close` refuses a terminal mandate and writes `total_released` | M01, M05, M14, M15, `verify:safety` S8 |
| I8 | No owner, admin, pause, upgrade or withdraw path. | absent | M40, `verify:safety` S2 |
| I9 | Recovery never opens while a ruling is appealable. | `recover_escrow` state gate | `test_appeal_finalize.py`, M78, `verify:safety` S6 |
| I10 | A failed panel round writes nothing. | all writes happen after `_round` returns | `test_unusable_panel_output_changes_nothing`, `test_failed_round_is_retry_safe` |
| I11 | Terms cannot change after funding. | `terms_locked`, `terms_hash` re-verified before adjudicate/settle | M83–M85 |
| I12 | Each party's evidence allowance is separate. | per-party counter in `_file_receipt` | `test_an_operator_filling_its_cap_*` |

## Remediations of known oracle-contract failure modes

| Failure mode | Closed by |
| --- | --- |
| Invented payouts | I1 |
| Post-seal evidence swap | I3, I4 |
| Clock gaming / tick spam | I5 |
| Silent client holds delivered work | `claim_unreviewed_delivery` (S5) |
| Silent operator holds escrow | `lapse_mandate` → `recover_escrow` |
| Failed or stalled panel strands funds | I10 + stall-gated recovery; stalled appeal falls back to the first ruling |
| Double settlement | I7 |
| Prompt injection in evidence | text only reaches the model for SUCCESS_MATCH; prompt marks sources as data; an injected "mark everything PASS" cannot change the contract's derivation; the PASS clamp needs real matching evidence |
| Optimistic UI | re-read after every write; accepted-but-refused shown as refused; pending shown as pending |
| One party exhausting the evidence cap | per-party allowance (I12) |

## Consensus-boundary notes

* Leader and validator run **the same code**: `validator_fn` calls `leader_fn()`.
  GenVM's linter requires `gl.nondet.*` calls to sit inside the function handed to
  `run_nondet_unsafe`, so the body is written once and re-executed, not copied.
* The fingerprint covers `(mandate_id, ordered (criterion, verdict) pairs,
  inconclusive ids, derived ruling)` and nothing else. Reasoning, quality grade,
  integrity flags and retrieval labels never gate acceptance.
* Retrieval labels *do* influence results through the PASS clamp. A validator whose
  fetch differs from the leader's computes a different clamp and disagrees; the
  round fails and nothing moves.

## What Falk does not promise

* **Validator majority.** If a majority of validators collude or are fooled, the
  verdicts are wrong. There is one appeal, judged by the same kind of panel.
* **Evidence disappearance.** A source that is unreachable when the panel runs is
  FETCH_FAIL and cannot support PASS, even if it was fine yesterday. File evidence
  on hosts that will keep it.
* **Independence is approximate.** Independence is enforced as (a) a declared origin
  class, (b) refusal when an "independent" URL shares a registrable site with the
  same party's hosted evidence or the deliverable, and (c) counting *distinct
  sites*. The site key is a heuristic (last two labels; last three for common
  ccTLD registries). It can merge unrelated sites (over-refuse); it cannot let two
  pages of one site count twice. It cannot detect two different domains secretly
  controlled by one party.
* **Datetime trust.** Deadlines are as honest as the transaction timestamp that
  consensus accepts.
* **Passport.** Counts of settled history. A fresh address starts empty; nothing
  stops one operator from using many addresses.
* **Sybil mandates.** Anyone can create mandates; a party that is both client and
  operator through two addresses can manufacture passport counts at the cost of gas
  and their own bond.
* **No upgradeability, no pause.** A bug cannot be patched in place. The remedy is
  redeploy and migrate by hand; the absence of an admin key is deliberate.
* **Model variance.** LLM validators can disagree on borderline criteria. The design
  makes disagreement fail the round (retry) rather than move money, but a
  persistently ambiguous criterion will stall until the stall-grace recovery.

## Operational hygiene

* No private key is read, stored or generated by the web app. Transactions are
  signed by the user's wallet (EIP-1193).
* `.env.example` contains public flags only. `.arc/` (local arc seed) is gitignored.
* The live arc derives throw-away test accounts from a local seed and funds them
  from the active `genlayer` CLI account; it never prints or commits a key.
