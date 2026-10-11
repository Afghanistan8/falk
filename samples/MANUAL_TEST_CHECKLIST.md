# Manual test checklist (MetaMask on StudioNet)

You need two wallets (client and operator), each with a little test GEN, and a third
wallet or browser profile to play the stranger/keeper. Use the public fixtures in
`samples/fixtures/` — the Guide page lists their URLs.

Tick a box only when the **screen** showed the expected result *after* the page
re-read the chain, and the explorer link for that transaction opened.

## 0. Environment

- [ ] `npm run dev`; `/health` shows chain 61999, revision `FALK-1.0.0`, "Source byte-verified: pass".
- [ ] With no wallet: Registry loads, a mandate opens read-only, actions say "Connect a wallet".
- [ ] Wallet on another network: header shows **Switch to StudioNet**; actions stay disabled; switching works (and adds the chain if absent).
- [ ] Empty registry shows the truthful empty state (only on a fresh contract).

## 1. Create → fund → accept (every write has a button)

- [ ] **New mandate** → load the "Five-market landscape report" sample → weights show 100/100 → **Create draft mandate** → redirected to the workspace in state *Draft*.
- [ ] Change a weight to 99 → the form refuses with "Weights must add up to exactly 100" before any wallet prompt.
- [ ] Operator = your own address → refused in the form.
- [ ] **Edit terms** → change the title → **Save draft** → new title shown.
- [ ] As the operator wallet, the draft shows no actions and says why.
- [ ] **Fund with exactly 2 GEN** → state *Funded*; "Held in custody" = 2 GEN; terms hash appears; **Edit terms** is gone.
- [ ] As the operator, **Accept and post a 0.5 GEN bond** → state *In progress*; execution deadline appears with a countdown.

## 2. Evidence and delivery

- [ ] **File evidence** for C1 with `northwind-report.md`: click **Fetch URL and compute** → a 64-hex commitment appears → file it → receipt #1 listed.
- [ ] File a receipt with a wrong commitment (change one hex digit) — it is accepted (the chain cannot know) but the panel later labels it *Mismatch*.
- [ ] Try an empty commitment → the button stays disabled.
- [ ] File the same URL twice → refused with "already filed".
- [ ] Claim an *Independent third party* origin on the deliverable's own site → refused.
- [ ] **Mark delivered** with the deliverable URL and its sha256 → state *Delivered*; review deadline appears.

## 3. Approve path

- [ ] As the client **Approve the work** → state *Approved*; **Settle** (as anyone) → state *Settled*; operator received 2.5 GEN (`payment + bond`); custody 0.
- [ ] **Settle** again → not offered; the "not available" list says why.

## 4. Contest path

- [ ] On a fresh delivered mandate, as the client **Open a contest** (tick C2, add a claim) with the 0.2 GEN bond → *Contested*.
- [ ] As the operator **Respond to the contest**; then **Seal the record** → *Record sealed*, count and snapshot hash shown.
- [ ] Try to file evidence now → not offered ("cannot be filed while sealed").
- [ ] **Run the panel round** (any wallet) → *Ruled*; each criterion shows PASS/FAIL/INCONCLUSIVE; the score and ruling are labelled as the contract's arithmetic; per-receipt retrieval labels show *Match*.
- [ ] A criterion whose receipt was a mismatch shows "PASS withheld" and the receipt shows *Mismatch*.
- [ ] **Appeal (one time only)** → *Appealed*; run the panel again → second ruling; **Appeal** is now gone ("the single permitted appeal has been used").
- [ ] **Finalize the ruling** (before the appeal deadline it is refused with the deadline) → *Finalized*; **Settle** → payout equals the on-screen formula.

## 5. Manual review and recovery

- [ ] Use evidence the panel cannot read (or all wrong commitments) → INCONCLUSIVE → after finalizing: **Settle** is not offered; **Propose a split** is.
- [ ] Propose 30% as the client; as the operator **Accept the proposed 30% operator split** → *Settled*.
- [ ] Repeat, and instead wait out the manual-review window → **Recover the escrow** → *Escrow recovered*; each party got their own deposit back.

## 6. Silent counterparties

- [ ] Operator accepts and does nothing: after the execution deadline anyone sees **Mark as lapsed**; then **Recover the escrow** → bond returned (or forfeited, per the frozen rule).
- [ ] Client delivers nothing/approves nothing: after the review deadline the operator sees **Claim unreviewed delivery**; the client's **Open a contest** is gone.
- [ ] Contest left unanswered: after the response deadline a stranger can **Seal the record**.

## 7. Cancel

- [ ] Fund a mandate and **Cancel and withdraw** before acceptance → *Cancelled*, 2 GEN back.

## 8. Truthfulness of the UI

- [ ] Reject a transaction in MetaMask → "You declined it in the wallet. Nothing was sent."
- [ ] Trigger a refusal (e.g. approve as the operator is not offered; use the explorer to see a refused attempt) → the banner says *refused* with a plain-language reason and the transaction link; state is unchanged after the re-read.
- [ ] Close the tab mid-transaction and reopen → state is whatever the chain says; nothing is replayed.
- [ ] A very slow receipt shows **Still pending** (not *failed*) and tells you not to send it again.
- [ ] `/operators`: enter the operator's address → counts match what you just settled; averages are derived.
