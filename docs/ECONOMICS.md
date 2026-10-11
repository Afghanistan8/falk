# Economics

Falk has **no protocol fee, no token and no treasury**. Every wei that enters a
mandate leaves it to the client or the operator. This page is about incentives.

## Money in a mandate

| Component | Posted by | When | Returned to |
| --- | --- | --- | --- |
| Payment `P` | client | `fund_mandate` | operator (as earned) / client |
| Performance bond `B` | operator | `accept_mandate` | operator, except under `LAPSE_BOND = FORFEIT` |
| Contest bond `C` | client | `open_contest` | client |

All three are exact: a different `msg.value` is refused. Settlement uses what was
**deposited**, never the agreed number.

## Outcome table

| Path | Operator receives | Client receives |
| --- | --- | --- |
| Approve / unreviewed claim | `P + B` | 0 |
| CONFIRMED | `P + B` | `C` |
| PARTIAL, pro-rata, score *s* | `⌊P·s/100⌋ + B` | `P − ⌊P·s/100⌋ + C` |
| PARTIAL or REJECTED, return | `B` | `P + C` |
| INCONCLUSIVE, even split | `⌊P/2⌋ + B` | `P − ⌊P/2⌋ + C` |
| Agreed split of *p*% | `⌊P·p/100⌋ + B` | rest `+ C` |
| Manual-review / stalled recovery | `B` | `P + C` |
| Lapse (bond returned) | `B` | `P` |
| Lapse (bond forfeit) | 0 | `P + B` |
| Cancel before acceptance | 0 | `P` |

Rounding: pro-rata floors the operator's share, so the odd wei goes to the client;
`Σ = P + B + C` always (asserted before any value moves).

## Why bonds return by default

Underperformance is not misconduct. A bond that was slashed on every partial
result would make operators price in the slash and would turn every contest into a
fight over the bond rather than the work. Falk's bonds exist to make **commitment
and contesting costly**, not to punish:

* The **operator bond** makes accepting-and-vanishing cost something only if the
  mandate froze `LAPSE_BOND = FORFEIT`. With `RETURN` it is a pure commitment
  device (locked capital while work is in progress).
* The **contest bond** makes a frivolous contest cost *time-value of money*, and
  it deters nothing if set to 0. Pick it so that a contest is a considered act.

Parties who want stronger deterrence set `LAPSE_BOND = FORFEIT` and larger bonds;
the choice is frozen into the terms hash so neither side can change it later.

## Incentive notes

* **Silent client.** Without `claim_unreviewed_delivery` a client could withhold
  approval indefinitely. With it, silence after the review window pays the operator.
  A client who disagrees must contest inside the window and post `C`.
* **Contest timing.** The client sees the delivery before deciding; the operator has
  already committed their evidence. The review window length is a negotiation
  parameter (frozen).
* **Pro-rata vs return.** For subjective work, `PARTIAL → PRORATA` is the natural
  policy; for pass/fail SLAs, `PARTIAL → RETURN` makes partial performance worthless
  to the operator, which removes the incentive to argue a criterion's weight.
* **Non-negotiable criteria.** Make a criterion non-negotiable only when partial
  credit is meaningless without it (a legal deliverable that must exist at all).
* **Manual review is not free.** `MANUAL_REVIEW` keeps funds in escrow until the
  parties agree a split or the recovery window opens; the default exit returns each
  party their own deposit. Both sides therefore weigh a negotiated split against a
  full refund-and-bond-return.
* **Appeals.** One appeal, no extra bond in this revision. The cost is one extra
  panel round and the appeal window. A party who expects the first ruling to stand
  should not appeal; the second ruling replaces the first, for better or worse.
* **Keepers.** Progress methods are permissionless and unpaid in-protocol. A party
  with something at stake (the operator wanting payment, the client wanting a
  refund) is the natural keeper. The UI exposes every step.

## What the passport measures

`value_verified_wei` is the amount actually paid to the operator by a
contract-derived settlement, **excluding** the returned bond. `closed`,
`clean_approvals`, `unreviewed_claims`, `confirmed/partial/rejected/inconclusive`,
`contests_faced`, `appeals_filed`, `critical_fails`, `lapses`, `scored`,
`score_sum` are counters incremented once per mandate at its terminal transition.
Averages and rates are computed on read. It is a record, not a credit score; see
`SECURITY.md` on sybil limits.

## Sizing

The platform fees for a transaction are separate from the mandate. A rule of thumb
for choosing windows: execution = how long the work really takes plus slack; review
= how long the client needs to read the evidence; response ≥ the time an operator
needs to gather a rebuttal; appeal ≥ one panel round; manual ≥ the time two people
need to negotiate. Minimum for every window is one minute; maximum one year.
