# Threat model

Assets: **escrowed funds** (payment + bonds), **the integrity of a ruling**, and
**liveness** (no mandate may become unresolvable).

Actors: a malicious **client**, a malicious **operator**, a malicious **stranger /
keeper**, a malicious or mistaken **model**, an unreliable **evidence host**, and a
minority or majority of **validators**.

Notation: *(Prevented)* the attack cannot succeed by construction and is tested;
*(Bounded)* it can succeed but the damage is capped and stated; *(Out of scope)*
a limit of the platform or of any oracle design.

## 1. Malicious client

| Attack | Outcome |
| --- | --- |
| Fund, then take it back after the operator has worked | After `accept_mandate`, `cancel_mandate` is refused. *(Prevented — test_cancel_after_engagement_is_refused, M13)* |
| Stay silent so the operator is never paid | After the review window the operator calls `claim_unreviewed_delivery`; a late contest is refused. *(Prevented — S5, G in the live arc)* |
| Contest a good delivery to delay payment | Costs the contest bond (returned on the pay-out), takes bounded time (response + panel + appeal windows). The ruling, not the client, decides. *(Bounded)* |
| Contest at the last second to race the operator's claim | Contest and claim use the same consensus deadline; whichever lands at or before `review_deadline_at` wins, after it only the claim is valid. *(Prevented)* |
| Swap the evidence page after sealing | sha256 mismatch ⇒ CONTENT_MISMATCH, no text to the model, no PASS. *(Prevented — M56/M57)* |
| Fill the evidence cap to block the operator | Per-party allowance. *(Prevented)* |
| Edit terms after funding | `terms_locked`; hash re-verified before every adjudication and settlement. *(Prevented — M83–M85)* |
| Appeal repeatedly to stall | One appeal per mandate. *(Prevented — M74)* Costs one extra round and one extra window. *(Bounded)* |
| Refuse to `settle` | Anyone can settle; recipients come from storage. *(Prevented)* |

## 2. Malicious operator

| Attack | Outcome |
| --- | --- |
| Accept, never deliver, hold the escrow | `lapse_mandate` after the deadline (anyone), then `recover_escrow`; bond forfeits to the client if the mandate froze `LAPSE_BOND = FORFEIT`, otherwise returns. *(Prevented from stranding; incentive depends on the frozen rule)* |
| Deliver late | `submit_deliverable` refused after the execution deadline. *(Prevented — M44)* |
| File "independent" evidence from its own site | Refused when the site equals the deliverable's or its own hosted evidence's site. *(Prevented — M62)* Two different domains owned by one party are *not* detected. *(Out of scope)* |
| One document, many URLs, to meet `min_evidence` | Receipts are counted per distinct URL; for `THIRD_PARTY` criteria, per distinct *site*. *(Prevented for independent criteria; Bounded for ANY criteria — they count receipts, by design)* |
| Prompt-inject the model through a source | Source text is data; the contract derives the outcome from verdict labels only; a PASS still needs matching, committed evidence. *(Bounded: a persuasive injection could flip an LLM verdict on a criterion that has real matching evidence; validators judge independently and must agree; one appeal)* |
| Withhold the response to a contest | Anyone seals after the response deadline; the evidence already filed is judged. *(Prevented)* |
| Make the panel fail forever | Failed rounds change nothing; after the stall grace the escrow is recoverable (or a stalled appeal falls back to the first ruling). *(Prevented from stranding)* |

## 3. Stranger / keeper

| Attack | Outcome |
| --- | --- |
| Call progress methods to redirect value | No method takes a recipient or amount; recipients are storage addresses. *(Prevented — S1, S4)* |
| Settle early | `settle` requires APPROVED or FINALIZED; `finalize_ruling` requires the appeal window to have ended (or an appeal to have completed). *(Prevented)* |
| Seal early to cut the operator's response | Strangers can seal only at or after `response_deadline_at`. *(Prevented — M51)* |
| Run `adjudicate` repeatedly | State leaves RECORD_SEALED/APPEALED after a success; a failed round changes nothing. *(Prevented)* Costs the caller gas only. |
| Spam mandates | Allowed; costs the spammer gas; the registry paginates. *(Bounded)* |

## 4. The model

| Attack / failure | Outcome |
| --- | --- |
| Returns amounts, percentages, recipients, scores, rulings, policy names | Discarded by the normaliser. *(Prevented — I1)* |
| Returns a verdict for an unknown criterion, a duplicate, or garbage | Unknown ids ignored; conflicting duplicates ⇒ INCONCLUSIVE; garbage ⇒ INCONCLUSIVE; missing ⇒ INCONCLUSIVE. *(Prevented)* |
| Says PASS on evidence it was not shown | PASS clamp: needs `min_evidence` SUCCESS_MATCH receipts mapped to that criterion (and distinct independent sites for THIRD_PARTY). *(Prevented — M58)* |
| Hallucinates a reason | Stored as inspection data; never consulted. *(Bounded to display)* |
| Disagrees with other validators | Fingerprint mismatch ⇒ no consensus ⇒ nothing written ⇒ retry. *(Prevented from moving money)* |

## 5. Evidence hosts

| Failure | Outcome |
| --- | --- |
| Page edited after sealing | CONTENT_MISMATCH |
| Page removed / 404 / timeout | NON_SUCCESS_HTTP / FETCH_FAIL ⇒ cannot support PASS. May cost an honest operator a PASS. *(Bounded — file evidence on durable hosts)* |
| Host serves different bytes to different validators | Different clamp ⇒ fingerprint mismatch ⇒ round fails, retry. *(Prevented from moving money)* |
| Host serves content that is not text (binary) | Decoded with replacement characters; the hash would not match a text commitment ⇒ mismatch. *(Bounded: commit only to textual documents)* |

## 6. Validators

| Scenario | Outcome |
| --- | --- |
| Minority wrong | Overruled at consensus. |
| Majority wrong or colluding | Wrong ruling; one appeal to the same kind of panel. *(Out of scope — this is the trust assumption of GenLayer consensus)* |
| Non-responsive | Rounds retry; stall grace guarantees an exit. *(Prevented from stranding)* |

## 7. Platform

| Risk | Note |
| --- | --- |
| `on="finalized"` transfers | Value is emitted when the settling transaction finalizes. Until then the mandate is already terminal in storage with held = 0. |
| Reentrancy | `emit_transfer` is a queued message, not a synchronous call; the terminal state and `total_released` are written first. |
| Integer overflow | Python integers; storage `u256` fields hold values far below 2²⁵⁶. |
| Upgrade | None. Redeploy and migrate manually. |
| StudioNet resets | StudioNet is a test network and can be reset; mainnet-style guarantees do not apply. |

## 8. Residual risks, ranked

1. Validator-majority error or collusion (platform trust assumption).
2. LLM sensitivity on subjective criteria — mitigated by writing objective criteria,
   `min_evidence`, and `THIRD_PARTY` independence.
3. Evidence durability.
4. No audit; no formal verification.
5. Passport sybil resistance is nil by design.
