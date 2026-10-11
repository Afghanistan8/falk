"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { describeRefusal } from "@/lib/present";
import type { MandateRow, Passport } from "@/lib/protocol";
import { useReader } from "@/lib/useFalk";
import { Empty, Gen, ReadError, StateBadge } from "./ui";
import { useWallet } from "./WalletProvider";

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

export function OperatorLookup() {
  const reader = useReader();
  const { address } = useWallet();
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [data, setData] = useState<{ target: string; passport: Passport; rows: MandateRow[] } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [failed, setFailed] = useState<{ target: string; message: string } | null>(null);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    Promise.all([reader.getPassport(target), reader.listMandatesFor(target, 0, 100)])
      .then(([p, page]) => {
        if (alive) {
          setFailed(null);
          setData({ target, passport: p, rows: page.items.filter((r) => r.operator.toLowerCase() === target.toLowerCase()).reverse() });
        }
      })
      .catch((e) => {
        if (alive) setFailed({ target, message: describeRefusal(e) });
      });
    return () => {
      alive = false;
    };
  }, [reader, target, nonce]);

  const loading = Boolean(target) && data?.target !== target && failed?.target !== target;
  const error = failed && failed.target === target ? failed.message : null;
  const passport = data && data.target === target ? data.passport : null;
  const rows = data && data.target === target ? data.rows : [];

  const valid = /^0x[0-9a-fA-F]{40}$/.test(input.trim());
  return (
    <div className="stack">
      <div className="card row">
        <input style={{ flex: 1, minWidth: 260 }} placeholder="Operator address 0x…" value={input} spellCheck={false}
          onChange={(e) => setInput(e.target.value)} aria-label="Operator address" />
        <button className="btn" disabled={!valid} onClick={() => setTarget(input.trim())}>Look up</button>
        {address ? <button className="btn ghost" onClick={() => { setInput(address); setTarget(address); }}>Use my address</button> : null}
      </div>
      {error ? <ReadError label="Could not read the passport." message={error} onRetry={() => setNonce((n) => n + 1)} /> : null}
      {loading ? <div className="notice wait">Reading the passport…</div> : null}
      {!target && !loading ? <Empty>Enter an operator address to read their passport. Counts come only from settled mandates.</Empty> : null}
      {passport && target && !loading ? (
        <>
          <div className="grid3">
            <div className="card tight"><div className="muted small">Mandates closed</div><div style={{ fontSize: "1.7rem", fontFamily: "var(--font-display)" }}>{passport.closed}</div></div>
            <div className="card tight"><div className="muted small">Value verified</div><div style={{ fontSize: "1.4rem" }}><Gen wei={passport.value_verified_wei} /></div>
              <div className="muted small">Wei actually paid for work, excluding returned bonds.</div></div>
            <div className="card tight"><div className="muted small">Average panel score</div><div style={{ fontSize: "1.7rem", fontFamily: "var(--font-display)" }}>{passport.derived.average_score ?? "—"}</div>
              <div className="muted small">Over {passport.scored} ruled mandate{passport.scored === 1 ? "" : "s"}</div></div>
          </div>
          <div className="card">
            <table>
              <tbody>
                <tr><th>Approved by client</th><td>{passport.clean_approvals}</td><th>Claimed after silent review</th><td>{passport.unreviewed_claims}</td></tr>
                <tr><th>Panel: confirmed</th><td>{passport.confirmed}</td><th>Panel: partial</th><td>{passport.partial}</td></tr>
                <tr><th>Panel: rejected</th><td>{passport.rejected}</td><th>Panel: inconclusive</th><td>{passport.inconclusive}</td></tr>
                <tr><th>Contests faced</th><td>{passport.contests_faced} ({pct(passport.derived.contest_rate_pct)} of closed)</td><th>Appeals filed</th><td>{passport.appeals_filed}</td></tr>
                <tr><th>Critical failures</th><td>{passport.critical_fails}</td><th>Lapses</th><td>{passport.lapses}</td></tr>
              </tbody>
            </table>
            <p className="muted small" style={{ marginTop: 10 }}>
              Raw counts are stored; every average and rate is derived when you read, so it cannot drift. A passport is
              a record of what settled on this contract, not a credential: a new address starts empty.
            </p>
          </div>
          <h3>Mandates as operator</h3>
          {rows.length === 0 ? <Empty>No mandates name this address as operator.</Empty> : (
            <div className="card tablewrap"><table>
              <thead><tr><th>Mandate</th><th>Title</th><th>Payment</th><th>State</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.mandate_id}><td><Link className="link mono" href={`/mandates/${r.mandate_id}`}>{r.mandate_id}</Link></td>
                  <td>{r.title}</td><td><Gen wei={r.payment_wei} /></td><td><StateBadge status={r.status} /></td></tr>
              ))}</tbody></table></div>
          )}
        </>
      ) : null}
    </div>
  );
}
