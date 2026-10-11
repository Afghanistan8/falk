import Link from "next/link";

import { FIXTURE_BASE, SAMPLES } from "@/lib/samples";

export const metadata = { title: "Guide — Falk" };

const STEPS: [string, string][] = [
  ["Create and fund", "The client writes the agreement and a weighted checklist (weights total 100), then funds the exact payment. Funding freezes every term by hash."],
  ["Accept", "The operator posts the exact performance bond. The execution clock starts from that transaction's consensus time."],
  ["File evidence", "Both sides can file public URLs against criteria. Each needs a sha256 of the document body; the app can compute it for you."],
  ["Deliver", "The operator marks the work delivered. The client now has the review window."],
  ["Approve — or contest", "Approve and anyone can settle. Contest (with the bond) and the record is sealed, then a panel of validators judges it. If the client says nothing, the operator can claim after the window."],
  ["Panel, appeal, finalize", "The panel returns PASS / FAIL / INCONCLUSIVE per criterion. Either side may appeal once. After the appeal window anyone can finalize."],
  ["Settle", "The contract applies the frozen policy to the pinned ruling and zeroes custody. Manual-review rulings are settled by an agreed split, or by recovery when the window closes."],
];

export default function Guide() {
  return (
    <div className="wrap section stack">
      <div>
        <h1 style={{ fontSize: "2.2rem" }}>Guide</h1>
        <p className="muted" style={{ maxWidth: "50rem" }}>
          You need MetaMask (or another EIP-1193 wallet) on GenLayer StudioNet and a little test GEN. Two wallets let you play both sides.
        </p>
      </div>
      <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>
        {STEPS.map(([t, b]) => <li key={t}><strong>{t}.</strong> <span className="muted">{b}</span></li>)}
      </ol>

      <div className="card stack">
        <h2>Sample evidence you can use right now</h2>
        <p className="muted">
          Public, static documents served from the project repository so every validator can retrieve them. Load a sample on the{" "}
          <Link className="link" href="/mandates/new">new mandate</Link> page, then file these URLs as evidence.
        </p>
        <div className="tablewrap"><table>
          <thead><tr><th>Fixture</th><th>Use it for</th><th>Expected</th></tr></thead>
          <tbody>{SAMPLES[0].fixtures.map((f) => (
            <tr key={f.name}><td><a className="link mono" href={`${FIXTURE_BASE}${f.name}`} target="_blank" rel="noreferrer">{f.name}</a></td>
              <td className="mono">{f.criterion}</td><td>{f.note}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="muted small">Never edit a fixture after a mandate has committed to its hash: the contract would (correctly) call it a mismatch.</p>
      </div>

      <div className="card stack">
        <h2>Things worth trying</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>The contest path with a partial result:</strong> use <code>figures-unsourced.md</code> for C2 and watch the contract compute a 65-point pro-rata split.</li>
          <li><strong>Mismatch:</strong> file a correct URL with a wrong sha256. The panel is never shown its text, and no criterion can pass on it.</li>
          <li><strong>Silent client:</strong> deliver, wait out the review window, and claim as the operator.</li>
          <li><strong>Refusals:</strong> the Actions panel lists every action that is blocked right now and the exact reason.</li>
        </ul>
        <p className="small muted">A manual checklist covering every write lives in <code>samples/MANUAL_TEST_CHECKLIST.md</code>.</p>
      </div>
    </div>
  );
}
