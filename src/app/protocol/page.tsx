import Link from "next/link";

export const metadata = { title: "Protocol — Falk" };

const LIFECYCLE = `DRAFT ──fund──► ESCROWED ──accept (+bond)──► ENGAGED ──deliver──► DELIVERED
  │ cancel          │ cancel (client)      │ lapse (past deadline)      │
  ▼                 ▼                      ▼                            │
CANCELLED       CANCELLED               LAPSED ──recover──► RECOVERED   │
                                                                         │
   approve (client) / claim_unreviewed (operator, after review window) ◄─┤
        ▼                                                                │
    APPROVED ──settle──► SETTLED                  open_contest (+bond) ◄─┘
                                                        ▼
                                                   CONTESTED ──respond / seal──► RECORD_SEALED
                                                                                    │ adjudicate (panel)
                                              appeal (once) ◄── RULING ◄───────────┘
                                                  ▼               │ finalize (after appeal window)
                                              APPEALED            ▼
                                                  └─adjudicate─► FINALIZED ──settle──► SETTLED
                                                              (manual review: split, or recover)`;

const OUTCOMES: [string, string, string][] = [
  ["CONFIRMED", "Every criterion passed", "Release in full to the operator"],
  ["PARTIAL", "Some passed; score = sum of their frozen weights", "Pro-rata by score (or return / manual review, as frozen)"],
  ["REJECTED", "A non-negotiable criterion failed, or nothing passed", "Return to the client (or manual review)"],
  ["INCONCLUSIVE", "A non-negotiable is undecided, or undecided weight ≥ 50", "Manual review (or return / even split)"],
];

const RETRIEVAL: [string, string, string][] = [
  ["SUCCESS_MATCH", "2xx, non-empty, body sha256 equals the sealed commitment", "Yes"],
  ["CONTENT_MISMATCH", "Retrieved, but the body differs from the commitment", "No — and no text reaches the model"],
  ["EMPTY", "2xx with an empty body", "No"],
  ["NON_SUCCESS_HTTP", "Status outside 2xx", "No"],
  ["FETCH_FAIL", "Exception or timeout", "No"],
  ["BLOCKED", "Refused by the URL policy", "No"],
];

const CLOSED: [string, string][] = [
  ["Invented payouts", "The normalizer rebuilds a fixed key set. A model's amount, percentage, recipient, score or policy is discarded; the contract derives all of them."],
  ["Post-seal evidence swap", "Every receipt is filed with a sha256 of its body. After sealing, a page whose hash differs is CONTENT_MISMATCH and is never shown to the model."],
  ["Clock gaming", "No method accepts or advances time. Deadlines are absolute timestamps taken from the consensus transaction datetime at each transition."],
  ["Silent client", "After the review window the operator can claim the delivery; a contest is refused after it."],
  ["Silent operator", "A missed execution deadline lapses the mandate and the escrow is recoverable."],
  ["Failed or stalled panel", "A round that does not reach agreement writes nothing and can be retried; a record that no panel rules on within the grace period is recoverable."],
  ["Double settle", "Settlement is a state transition that writes the terminal state and zeroes custody before value is emitted."],
  ["Optimistic UI", "After every write the app re-reads chain state. An accepted-but-refused transaction is shown as refused; a pending hash is shown as pending."],
];

export default function Protocol() {
  return (
    <div className="wrap section stack">
      <div>
        <h1 style={{ fontSize: "2.2rem" }}>Protocol</h1>
        <p className="muted" style={{ maxWidth: "50rem" }}>
          Falk is a two-party work agreement with escrow. The client funds; the operator accepts with a bond and delivers.
          If anyone disputes the work, independent GenLayer validators retrieve the sealed public evidence and answer one
          question per criterion. Everything else is the contract&apos;s arithmetic. Full text: <code>docs/PROTOCOL.md</code>.
        </p>
      </div>

      <div className="card stack"><h2>Lifecycle</h2><pre className="mono pre" style={{ margin: 0, overflowX: "auto", fontSize: "0.74rem" }}>{LIFECYCLE}</pre></div>

      <div className="card stack">
        <h2>Outcomes</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Ruling</th><th>Derived by the contract when</th><th>Default settlement</th></tr></thead>
          <tbody>{OUTCOMES.map(([a, b, c]) => <tr key={a}><td className="mono">{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small">Order of derivation: non-negotiable FAIL → rejected; all PASS → confirmed; undecided → inconclusive; no PASS → rejected; otherwise partial. The model never names the ruling.</p>
      </div>

      <div className="grid2">
        <div className="card stack">
          <h2>What crosses the consensus boundary</h2>
          <p>Leader and every validator independently fetch the same sealed URLs and run the same code. They compare only:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>the mandate id,</li>
            <li>the ordered (criterion, verdict) pairs,</li>
            <li>the inconclusive ids,</li>
            <li>the ruling derived from them.</li>
          </ul>
          <p className="muted small">Reasoning, quality grades, integrity flags and per-source labels are stored for inspection and never gate acceptance.</p>
        </div>
        <div className="card stack">
          <h2>Retrieval classification</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Label</th><th>Condition</th><th>May support PASS</th></tr></thead>
            <tbody>{RETRIEVAL.map(([a, b, c]) => <tr key={a}><td className="mono">{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>

      <div className="card stack">
        <h2>Naive oracle failure modes, closed</h2>
        <div className="grid2">{CLOSED.map(([t, b]) => <div key={t}><h3>{t}</h3><p className="muted">{b}</p></div>)}</div>
      </div>

      <div className="card stack">
        <h2>Honest limits</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>A colluding validator majority can return a wrong verdict; the single appeal re-runs the same kind of panel.</li>
          <li>Evidence that disappears before the round is treated as unusable, which can cost an honest operator a PASS.</li>
          <li>Consensus time is only as honest as the transaction datetime validators accept.</li>
          <li>The passport counts settled history; a fresh address starts empty. It is not an identity system.</li>
          <li>The contract has not had an external audit. StudioNet is a test network.</li>
        </ul>
        <p className="small"><Link className="link" href="/guide">Walk through it with the sample fixtures →</Link></p>
      </div>
    </div>
  );
}
