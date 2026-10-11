import Link from "next/link";

import { HomeLive } from "@/components/HomeLive";

const GUARANTEES = [
  ["Models return meaning only", "Validators return PASS, FAIL or INCONCLUSIVE per criterion. Amounts, percentages, recipients and policies in a model's answer are discarded."],
  ["The contract does the arithmetic", "Score is the sum of weights frozen at funding. Settlement is integer math over what was actually deposited."],
  ["Evidence is committed, then sealed", "Every receipt carries a sha256 of its body. A swapped page is classified CONTENT_MISMATCH and cannot support PASS."],
  ["Time is consensus time", "Deadlines are absolute timestamps recorded at each transition. There is no clock method to call."],
  ["No stranded funds", "Silent client, silent operator, failed panel, stalled appeal: each has an explicit, gated exit."],
  ["No owner key", "There is no admin, pause or upgrade path. Value leaves through one private function to addresses in storage."],
];

export default function Home() {
  return (
    <>
      <section className="band hero">
        <div className="wrap">
          <div className="kicker">Evidence-backed settlement for delegated work</div>
          <h1>The record settles the work.</h1>
          <p className="lead" style={{ marginTop: 16 }}>
            Falk holds payment until independent GenLayer validators retrieve sealed public evidence and return
            structured criterion results. The contract alone derives the score, the policy and where the money goes.
          </p>
          <div className="row" style={{ marginTop: 24 }}>
            <Link className="btn accent" href="/mandates/new">Create a mandate</Link>
            <Link className="btn ghost" href="/mandates">Browse the registry</Link>
            <Link className="btn ghost" href="/protocol">Read the protocol</Link>
          </div>
        </div>
      </section>

      <section className="section wrap stack">
        <h2>Live from StudioNet</h2>
        <HomeLive />
      </section>

      <section className="section wrap stack">
        <h2>What cannot go wrong</h2>
        <div className="grid3">
          {GUARANTEES.map(([title, body]) => (
            <div className="card" key={title}>
              <h3>{title}</h3>
              <p className="muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
