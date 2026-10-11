"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { describeRefusal } from "@/lib/present";
import type { MandateRow, ProtocolInfo } from "@/lib/protocol";
import { useReader } from "@/lib/useFalk";
import { Empty, Gen, StateBadge } from "./ui";

export function HomeLive() {
  const reader = useReader();
  const [info, setInfo] = useState<ProtocolInfo | null>(null);
  const [rows, setRows] = useState<MandateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const i = await reader.getProtocolInfo();
        const page = await reader.listMandates(Math.max(0, i.mandate_count - 6), 6);
        if (alive) {
          setInfo(i);
          setRows([...page.items].reverse());
        }
      } catch (e) {
        if (alive) setError(describeRefusal(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reader]);

  if (error) return <div className="notice stop">Could not read StudioNet: {error}</div>;
  if (!info || !rows) return <div className="notice wait">Reading the contract…</div>;

  return (
    <div className="stack">
      <div className="grid3">
        <div className="card tight">
          <div className="muted small">Mandates on the contract</div>
          <div style={{ fontSize: "1.8rem", fontFamily: "var(--font-display)" }}>{info.mandate_count}</div>
        </div>
        <div className="card tight">
          <div className="muted small">Revision</div>
          <div className="mono">{info.revision}</div>
        </div>
        <div className="card tight">
          <div className="muted small">Authority</div>
          <div>{info.has_owner || info.has_clock_method ? "Unexpected" : "No owner · no clock method"}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty>
          Nothing has been created on this contract yet. <Link className="link" href="/mandates/new">Create the first mandate.</Link>
        </Empty>
      ) : (
        <div className="card tablewrap">
          <table>
            <thead>
              <tr><th>Mandate</th><th>Title</th><th>Payment</th><th>State</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.mandate_id}>
                  <td><Link className="link mono" href={`/mandates/${r.mandate_id}`}>{r.mandate_id}</Link></td>
                  <td>{r.title}</td>
                  <td><Gen wei={r.payment_wei} /></td>
                  <td><StateBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
