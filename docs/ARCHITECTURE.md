# Falk — Architecture

> **Panel returns meaning. Contract moves money.**

Falk is one deployable Intelligent Contract (`contracts/falk.py`) with a strict
internal split between a **pure domain core** and a **thin GenVM shell**. The
split exists so that every rule that touches money, authority, time or evidence
can be tested with no VM at all, and so that the part that *does* need the VM
(storage, `gl.message`, web retrieval, LLM calls, value emission) stays small
enough to read in one sitting.

## 1. Layers

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Web (Next.js, no DB, no server signer)                                   │
│   MetaMask EIP-1193 ──► src/lib/falk.ts ──► StudioNet RPC only           │
│   src/lib/acts.ts  (pure act matrix, mirrored from falk core)            │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ JSON-RPC (gen_call / eth_sendRawTransaction)
┌───────────────────────────────▼──────────────────────────────────────────┐
│ contracts/falk.py                                                        │
│                                                                          │
│  ┌──────────────────────── SHELL (needs GenVM) ───────────────────────┐  │
│  │ Falk(gl.Contract): storage, guards, 18 writes, reads               │  │
│  │ _now_ms()   gl.message_raw["datetime"]   (only time source)        │  │
│  │ _send()     emit_transfer   (only value exit, recipients = storage)│  │
│  │ _round()    gl.vm.run_nondet_unsafe(leader, validator)             │  │
│  └───────────────────────────────▲────────────────────────────────────┘  │
│                                  │ calls, never the reverse              │
│  ┌──────────────────────── PURE CORE (no gl, no I/O) ─────────────────┐  │
│  │ canonical JSON · sha256 commitments · checklist parse/validate     │  │
│  │ weight sum · host/URL rules · independence · retrieval taxonomy    │  │
│  │ normalize_panel · fingerprint · derive_ruling · policy · payout    │  │
│  │ compute_acts · passport derivations                                │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Why one file

GenVM deploys a single source blob; imports of sibling modules are not
available at deploy time. Falk therefore keeps the pure core **inside**
`falk.py`, between two marker comments:

```text
# ==== FALK PURE CORE BEGIN ====
# ==== FALK PURE CORE END ====
```

`tests/pure/` extracts exactly that region, executes it in a bare Python
namespace that contains **no `gl` object**, and tests it. If a core function
ever reaches for the VM, its test fails with `NameError`. The marker discipline
is enforced by `tests/pure/test_core_isolation.py`.

## 2. Determinism boundary

| Nondeterministic (inside `run_nondet_unsafe`) | Deterministic (everything else) |
| --- | --- |
| HTTP GET of each sealed URL | all storage reads and writes |
| LLM extraction of per-criterion verdicts | weights, score, ruling derivation |
| | policy selection, payout arithmetic |
| | deadlines, authorization, state transitions |
| | emission of value |

The nondeterministic section returns **one thing**: an ordered list of
`(criterion_id, PASS | FAIL | INCONCLUSIVE)`. The normalizer rebuilds a fixed key
set from whatever the model produced, discards every other field, clamps PASS
where the evidence cannot support it, and the contract derives everything else.

### 2.1 Equivalence design

* Leader and validators run the **same code**. GenVM's linter requires every
  `gl.nondet.*` call to sit inside the function passed to `run_nondet_unsafe`, so
  the retrieval-and-extraction body lives in `leader_fn` and `validator_fn` simply
  calls `leader_fn()` again. Identical by construction, with no second copy to
  drift.
* The consensus **fingerprint** is `sha256(canonical_json({mandate_id, results:
  [[cid, result], …] in checklist order, inconclusive_ids, ruling}))`. Reasoning
  text, quality labels, integrity flags and per-source retrieval labels are
  stored for inspection but are **not** compared.
* Retrieval labels are not in the fingerprint, but they *do* influence results
  through the PASS clamp (§2.2). A validator whose fetch genuinely differs from
  the leader's will therefore produce a different clamp and disagree — which is
  the correct outcome: the round fails and nothing moves.

### 2.2 The PASS clamp

After normalization, for each criterion with a `PASS` verdict the contract
counts how many of its **mapped receipts** this node retrieved as
`SUCCESS_MATCH` (HTTP 2xx, non-empty, body sha256 equals the sealed
commitment) and, for criteria demanding independence, how many **distinct
independent origins** among them. If either count is below the criterion's frozen
minimum, `PASS` is rewritten to `INCONCLUSIVE`. A model cannot talk its way past
this: the clamp runs after the model, on contract-held numbers.

## 3. Storage model

One storage home per concept, no duplicate arrays that can drift.

| Concept | Storage | Notes |
| --- | --- | --- |
| Mandate | `TreeMap[str, Mandate]` | scalar fields only; checklist as canonical JSON string |
| Evidence | `TreeMap[str, DynArray[Receipt]]` | **the** home of receipts; seal records a count + hash, not a copy |
| Contest | `TreeMap[str, Contest]` | at most one per mandate |
| Rulings | `TreeMap[str, DynArray[Ruling]]` | append-only; index = ruling id − 1 |
| Settlement | `TreeMap[str, Settlement]` | written once, in the same transaction that zeroes custody |
| Passport | `TreeMap[str, Passport]` | counts only; averages derived at read time |

There is **no** `owner`, `admin`, `paused`, `upgrade` or `clock` storage field.

## 4. Time

`_now_ms()` parses `gl.message_raw["datetime"]`, the transaction timestamp that
consensus approved. Every deadline is `now_ms_at_transition + frozen_window`
stored as absolute UTC milliseconds on the mandate. Deadlines are per mandate:
there is no global counter and no cross-mandate coupling. There is no public
method that accepts a timestamp, advances time, waits, or counts calls as time.
`scripts/verify_safety.mjs` reads the live ABI and fails on any such name.

## 5. Custody

* `payment_deposited`, `operator_bond_deposited`, `contest_bond_deposited` record
  what the chain actually moved (`gl.message.value`), distinct from the agreed
  amounts. Settlement arithmetic uses **deposited** values.
* `custody_held = Σ deposited − total_released` (derived, never stored twice).
* `_send()` is the only function that calls `emit_transfer`. It takes a
  *storage-resolved* address, never caller input; every public write is checked
  by the test suite for "no path where recipient or amount comes from
  `calldata`".
* Every settlement computes a `Split`, asserts `Σ parts == custody_held`, writes
  the terminal state and `total_released`, then emits. Held reaches zero in the
  same transaction.

## 6. Modules (pure core) and contracts

| Function | Contract |
| --- | --- |
| `canon(obj)` | sorted keys, `(",",":")` separators, `ensure_ascii=False`; byte-stable |
| `sha256_hex(bytes)` / `commitment_of(text)` | lower-case hex; text is `.strip()`ped UTF-8 |
| `parse_checklist(json)` | validates ids, weights sum to exactly 100, bounds; returns canonical list |
| `url_ok(url, schemes)` / `host_of(url)` | rejects credentials, userinfo, loopback/private literals |
| `classify_fetch(status, body, commitment)` | closed taxonomy (§ PROTOCOL 7) |
| `normalize_panel(raw, mandate_id, checklist)` | fixed key set; unknown fields dropped |
| `clamp_results(results, checklist, supports)` | PASS→INCONCLUSIVE where evidence is short |
| `fingerprint(mandate_id, results, checklist)` | consequence-only |
| `derive_ruling(checklist, results)` | `(score, ruling, critical_failed, passed, failed, inconclusive)` |
| `choose_action(policy, ruling)` | policy lookup, closed vocabulary |
| `split_custody(action, …)` | integer payout math, conservation asserted |
| `compute_acts(view, who, now_ms)` | allowed actions — the same function the UI mirrors |
| `passport_stats(p)` | derived averages |

## 7. Failure containment

* A failed or non-agreeing panel round raises before any write in the same call:
  the transaction rolls back, state is unchanged, `adjudicate` is retry-safe.
* `adjudicate` writes the ruling only after normalization succeeded; the ruling
  list is append-only.
* `recover_escrow` has an explicit gate table (PROTOCOL §9) and is the single
  exit for lapsed, stalled and unresolved-manual-review custody.

## 8. SDK choices and notes

Pinned toolchain: `genlayer-test==0.29.2`, `genvm-linter==0.11.0`,
`genlayer-py==0.16.3`, GenVM runner `py-genlayer:1jb45aa8…` (same runner the
reference network accepted). APIs used: `gl.Contract`, `gl.message.sender_address`
/ `.value`, `gl.message_raw["datetime"]`, `gl.nondet.web.get`,
`gl.nondet.exec_prompt(..., response_format="json")`,
`gl.vm.run_nondet_unsafe`, `gl.evm.contract_interface` + `emit_transfer`.
Where the direct-mode runtime differs from the live network it is noted in
`TESTING.md`.
