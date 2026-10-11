"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { STATE_LABEL, describeRefusal } from "@/lib/present";
import type { MandateRow, MandateStatus } from "@/lib/protocol";
import { useReader } from "@/lib/useFalk";
import { Addr, Empty, Gen, ReadError, StateBadge } from "./ui";
import { useWallet } from "./WalletProvider";

type Filter = "all" | "mine" | "open" | "closed";
const CLOSED: MandateStatus[] = ["SETTLED", "CANCELLED", "RECOVERED"];

export function MandateBrowser() {
  const reader = useReader();
  const { address } = useWallet();
  const [rows, setRows] = useState<MandateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all: MandateRow[] = [];
        let offset = 0;
        for (;;) {
          const page = await reader.listMandates(offset, 100);
          all.push(...page.items);
          offset += page.items.length;
          if (!page.items.length || offset >= page.total) break;
        }
        if (alive) setRows(all.reverse());
      } catch (e) {
        if (alive) setError(describeRefusal(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reader]);

  const shown = useMemo(() => {
    const me = address?.toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === "mine" && !(me && (r.client.toLowerCase() === me || r.operator.toLowerCase() === me))) return false;
      if (filter === "open" && CLOSED.includes(r.status)) return false;
      if (filter === "closed" && !CLOSED.includes(r.status)) return false;
      const q = query.trim().toLowerCase();
      return !q || r.title.toLowerCase().includes(q) || r.mandate_id.toLowerCase().includes(q) ||
        r.client.toLowerCase().includes(q) || r.operator.toLowerCase().includes(q);
    });
  }, [rows, filter, query, address]);

  if (error) return <ReadError label="Could not read the registry." message={error} />;
  if (!rows) return <div className="notice wait">Reading the registry from StudioNet…</div>;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" role="group" aria-label="Filter">
          {(["all", "mine", "open", "closed"] as Filter[]).map((f) => (
            <button key={f} className={`btn sm ${filter === f ? "" : "ghost"}`} onClick={() => setFilter(f)}
              disabled={f === "mine" && !address} title={f === "mine" && !address ? "Connect a wallet to see your mandates" : undefined}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input style={{ maxWidth: 280 }} placeholder="Search id, title or address" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
      </div>
      {rows.length === 0 ? (
        <Empty>
          The registry is empty: nothing has been created on this contract yet.{" "}
          <Link className="link" href="/mandates/new">Create the first mandate.</Link>
        </Empty>
      ) : shown.length === 0 ? (
        <Empty>No mandate matches this filter.</Empty>
      ) : (
        <div className="card tablewrap">
          <table>
            <thead>
              <tr><th>Mandate</th><th>Title</th><th>Client</th><th>Operator</th><th>Payment</th><th>State</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.mandate_id}>
                  <td><Link className="link mono" href={`/mandates/${r.mandate_id}`}>{r.mandate_id}</Link></td>
                  <td>{r.title}</td>
                  <td><Addr value={r.client} you={address?.toLowerCase() === r.client.toLowerCase()} /></td>
                  <td><Addr value={r.operator} you={address?.toLowerCase() === r.operator.toLowerCase()} /></td>
                  <td><Gen wei={r.payment_wei} /></td>
                  <td><StateBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {rows.length} mandate{rows.length === 1 ? "" : "s"} on chain. States: {Object.values(STATE_LABEL).slice(0, 4).join(" · ")} …
      </p>
    </div>
  );
}
