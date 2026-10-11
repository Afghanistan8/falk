# Falk — Protocol

Revision string: **`FALK-1.0.0`** (returned by `get_protocol_info`).

## 1. Parties

| Role | Powers |
| --- | --- |
| **Client** | creates the mandate, edits the draft, funds, cancels pre-accept, approves, contests, files counter-evidence, appeals |
| **Operator** | accepts with bond, files evidence, delivers, responds to contests, claims unreviewed delivery, appeals |
| **Keeper** (anyone) | calls *progress-only* methods: `seal_record` (after response deadline), `adjudicate`, `finalize_ruling`, `settle`, `lapse_mandate`, `recover_escrow`. A keeper never chooses an amount or recipient |

No owner, no admin, no pause.

## 2. Mandate (frozen at funding)

```jsonc
{
  "title": "…", "description": "…",
  "operator": "0x…",
  "checklist": [
    { "id": "C1", "title": "…", "description": "…",
      "weight": 40, "non_negotiable": true,
      "min_evidence": 1,          // admissible SUCCESS_MATCH receipts needed to PASS
      "independence": "ANY"        // or "THIRD_PARTY": needs distinct independent origins
    }
  ],                               // weights are integers summing to exactly 100
  "payment_wei": "…", "operator_bond_wei": "…", "contest_bond_wei": "…",
  "policy": {
    "version": "FALK-POLICY-1",
    "CONFIRMED":    "RELEASE_FULL",
    "PARTIAL":      "PRORATA | RETURN | MANUAL_REVIEW",
    "REJECTED":     "RETURN | MANUAL_REVIEW",
    "INCONCLUSIVE": "MANUAL_REVIEW | RETURN | SPLIT_EVEN",
    "LAPSE_BOND":   "RETURN | FORFEIT"
  },
  "windows_ms": { "execution": …, "review": …, "response": …, "appeal": …, "manual": … },
  "evidence_rules": { "max_receipts": 1‥24 /* per party; the deliverable does not count */, "schemes": ["https"], "text": "…" }
}
```

`checklist_hash = sha256(canon(all of the above))` is computed at `fund_mandate`
and re-verified before every adjudication and settlement. After funding there is
no write path that mutates any hashed field.

## 3. Lifecycle

```text
DRAFT ──fund──► ESCROWED ──accept──► ENGAGED ──deliver──► DELIVERED
  │ update_draft     │ cancel(client)     │ lapse (past exec deadline)      │
  ▼ (loops)          ▼                    ▼                                 │
              CANCELLED (terminal)     LAPSED ──recover_escrow──► RECOVERED │
                                                                             │
        ┌──────────── approve (client) / claim_unreviewed (operator, after   │
        │             review deadline) ◄─────────────────────────────────────┤
        ▼                                                                    │
    APPROVED ──settle──► SETTLED                          open_contest ◄─────┘
                                                                │ (client + bond, before review deadline)
                                                                ▼
                                                           CONTESTED ──respond/seal──► RECORD_SEALED
                                                                                         │ adjudicate
                                                                                         ▼
                                      ┌──────────── appeal (once) ──────────────── RULING
                                      ▼                                                 │ finalize (after appeal deadline)
                                  APPEALED ──adjudicate──► RULING                       ▼
                                                                                   FINALIZED ──settle──► SETTLED
                                                                                         │ MANUAL_REVIEW exit:
                                                                                         │ propose_split/accept_split → SETTLED
                                                                                         │ recover_escrow (after manual deadline) → RECOVERED
RECORD_SEALED / APPEALED ──recover_escrow (panel stalled past grace)──► RECOVERED
```

### 3.1 Transition table (caller, state, gate)

| Write | Caller | From | Gate |
| --- | --- | --- | --- |
| `create_mandate` | anyone (→ client) | — | validations; operator ≠ client |
| `update_draft` | client | DRAFT | — |
| `fund_mandate` | client | DRAFT | value == payment_wei |
| `accept_mandate` | operator | ESCROWED | value == bond (the execution clock starts here) |
| `cancel_mandate` | client | DRAFT, ESCROWED | — (payment returned) |
| `submit_evidence` | operator / client | see §5 | commitment mandatory; caps; independence |
| `submit_deliverable` | operator | ENGAGED | now ≤ execution deadline; commitment mandatory |
| `approve_work` | client | DELIVERED | — |
| `claim_unreviewed_delivery` | operator | DELIVERED | now > review deadline |
| `open_contest` | client | DELIVERED | now ≤ review deadline; value == contest bond |
| `respond_to_contest` | operator | CONTESTED | once; before seal |
| `seal_record` | party, or anyone after response deadline | CONTESTED | party: operator responded or deadline passed |
| `adjudicate` | anyone | RECORD_SEALED, APPEALED | one open round; failure rolls back |
| `appeal` | client / operator | RULING | `appeal_count == 0`, now ≤ appeal deadline |
| `finalize_ruling` | anyone | RULING | now > appeal deadline |
| `settle` | anyone | APPROVED, FINALIZED | action ≠ MANUAL_REVIEW |
| `propose_split` / `accept_split` | party / counterparty | FINALIZED (MANUAL_REVIEW) | before manual deadline |
| `lapse_mandate` | anyone | ENGAGED | now > execution deadline |
| `recover_escrow` | anyone | LAPSED; FINALIZED(MANUAL_REVIEW); RECORD_SEALED/APPEALED stalled | §9 |

## 4. Outcomes

| Ruling | Derivation (contract-only) | Default action |
| --- | --- | --- |
| CONFIRMED | all criteria PASS | RELEASE_FULL |
| REJECTED | any non-negotiable FAIL; or no PASS and no INCONCLUSIVE weight | RETURN |
| INCONCLUSIVE | any non-negotiable INCONCLUSIVE, or INCONCLUSIVE weight ≥ 50 | MANUAL_REVIEW |
| PARTIAL | otherwise | PRORATA |

`score = Σ weight(PASS criteria)`, an integer 0‥100. Derivation order:

1. any non-negotiable `FAIL` → REJECTED
2. all `PASS` → CONFIRMED
3. any non-negotiable `INCONCLUSIVE`, or Σ INCONCLUSIVE weights ≥ 50 → INCONCLUSIVE
4. `score == 0` → REJECTED
5. otherwise PARTIAL

## 5. Evidence

A **receipt** = `{id, criterion_ids, url, role, origin_class, content_commitment, media_type, publisher, note, submitter, submitted_at}`.

* `content_commitment`: mandatory 64-hex sha256 of `strip(utf-8 body)`.
* `role`: `DELIVERABLE | SUPPORT | COUNTER`.
* `origin_class`: `OPERATOR_HOSTED | CLIENT_HOSTED | THIRD_PARTY | PUBLIC_RECORD`.
* Who/when: operator in ENGAGED, DELIVERED, CONTESTED(before seal); client only in CONTESTED (before seal) and only role `COUNTER`/`SUPPORT`. Nothing after `seal_record`.
* **Independence rules** (enforced at filing): a receipt claiming `THIRD_PARTY` or `PUBLIC_RECORD` is refused if its host equals the host of the mandate's deliverable URL, or of any receipt the same submitter filed as `*_HOSTED`. A criterion with `independence: THIRD_PARTY` counts **distinct hosts among independent receipts** toward `min_evidence`, so ten pages on one site are one origin.
* URL rules: allowed schemes only (default https), no userinfo, no IP literals, no loopback/private suffixes (`.local`, `.internal`, …), ≤ 512 chars. Duplicate URLs per mandate refused.
* Caps: `max_receipts` is **per party** (operator and client each get the allowance; the deliverable receipt is not counted), so neither side can crowd the other out of the record.
* `seal_record` freezes: `evidence_count`, `snapshot_hash = sha256(canon([[id, criterion_ids, url, commitment, origin_class], …]))`. `adjudicate` recomputes and compares before any retrieval.

## 6. Adjudication

1. Recompute checklist hash and snapshot hash from storage; mismatch → refuse.
2. Build `sources` from storage only (caller supplies nothing).
3. Round (leader and each validator, identical closure): fetch each URL → classify → build prompt with *body text only for SUCCESS_MATCH* → `exec_prompt(json)`.
4. Normalize: fixed keys; `results` = one verdict per checklist id, missing → INCONCLUSIVE, invalid → INCONCLUSIVE; extra fields dropped.
5. Clamp (ARCHITECTURE §2.2).
6. Fingerprint compare.
7. On agreement, contract derives `(score, ruling, …)`, appends ruling, sets state RULING and `appeal_deadline = now + appeal_window`.

## 7. Retrieval taxonomy

| Label | Condition | May support PASS | Text into prompt |
| --- | --- | --- | --- |
| `SUCCESS_MATCH` | 2xx, non-empty, sha256 == sealed commitment | **yes** | yes (truncated) |
| `CONTENT_MISMATCH` | 2xx, non-empty, sha256 ≠ commitment | no | **no** |
| `EMPTY` | 2xx, body empty/whitespace | no | no |
| `NON_SUCCESS_HTTP` | status outside 2xx | no | no |
| `FETCH_FAIL` | exception / timeout | no | no |
| `BLOCKED` | refused by URL policy at retrieval time | no | no |

## 8. Settlement math

Let `P = payment_deposited`, `B = operator_bond_deposited`, `C = contest_bond_deposited`, all integers.

| Action | Operator receives | Client receives |
| --- | --- | --- |
| RELEASE_FULL | `P + B` | `C` |
| PRORATA(score) | `P·score//100 + B` | `P − P·score//100 + C` |
| RETURN | `B` | `P + C` |
| SPLIT_EVEN | `P//2 + B` | `P − P//2 + C` |
| agreed split (pct) | `P·pct//100 + B` | rest `+ C` |

Bonds return to posters. The only exception is the frozen `LAPSE_BOND = FORFEIT`
rule: if the operator accepted and never delivered, `B` goes to the client.
`Σ parts == P + B + C` is asserted before any value moves.

## 9. Recovery gates

| State | Condition | Result |
| --- | --- | --- |
| LAPSED | always (after `lapse_mandate`) | payment → client, bond per `LAPSE_BOND` |
| FINALIZED, action MANUAL_REVIEW | `now > manual_deadline` and no accepted split | payment + contest bond → client, operator bond → operator |
| RECORD_SEALED / APPEALED | `now > sealed_at + stall_grace` (14 days) | same as above |
| anything appealable (RULING) | **never** | — |

## 10. Passport (per operator address, counts only)

`mandates_settled, clean_approvals, unreviewed_claims, confirmed, partial, rejected, inconclusive, contests_faced, appeals_filed, critical_fails, lapses, scored, score_sum, value_verified_wei`.
Updated only inside `settle`/`recover_escrow`/`lapse_mandate`, exactly once per
mandate (guarded by terminal state). Averages are computed at read time.
`value_verified_wei` counts **wei actually paid to the operator** by a
contract-derived settlement — wording in an agreement cannot raise it.

## 11. Error vocabulary

All refusals are `UserError("[EXPECTED] …")` with human-readable text; the UI
maps them in `present.ts`. `[EXTERNAL]` = environment (e.g. datetime), `[PANEL_ERROR]` = panel output unusable.
