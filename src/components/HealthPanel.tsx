"use client";

import { useEffect, useState } from "react";

import { CONTRACT_ADDRESS, CONTRACT_EXPLORER_URL, EXPECTED_REVISION, SOURCE_SHA256 } from "@/lib/config";
import { Tag } from "./ui";

interface Health {
  ok: boolean;
  chainId?: number;
  revision?: string;
  mandateCount?: number;
  methods?: { total: number; read: number; write: number };
  countsMatchManifest?: boolean;
  sourceVerified?: boolean | null;
  addressOfRecord?: boolean;
  error?: string;
}

export function HealthPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Health) => alive && setHealth(j))
      .catch((e) => alive && setHealth({ ok: false, error: String(e) }));
    return () => {
      alive = false;
    };
  }, []);
  const row = (label: string, ok: boolean | null | undefined, detail: string) => (
    <tr>
      <th>{label}</th>
      <td><Tag tone={ok === null || ok === undefined ? "neutral" : ok ? "go" : "stop"}>{ok === null || ok === undefined ? "n/a" : ok ? "pass" : "fail"}</Tag></td>
      <td>{detail}</td>
    </tr>
  );
  return (
    <div className="stack">
      {!health ? <div className="notice wait">Checking StudioNet…</div> : null}
      {health ? (
        <div className="card tablewrap">
          <table><tbody>
            {row("Chain", health.chainId === 61999, health.chainId ? `chain id ${health.chainId}` : (health.error ?? "unknown"))}
            {row("Protocol revision", health.revision === EXPECTED_REVISION, health.revision ?? "—")}
            {row("Public ABI", health.countsMatchManifest, health.methods ? `${health.methods.total} methods (${health.methods.read} read, ${health.methods.write} write)` : "—")}
            {row("Source byte-verified", health.sourceVerified, health.sourceVerified === null ? "preview override address: not the address of record" : health.sourceVerified ? "on-chain source hashes to the manifest" : "source differs from the manifest")}
            {row("Mandates", health.ok, `${health.mandateCount ?? "—"} on the contract`)}
          </tbody></table>
        </div>
      ) : null}
      <div className="card stack">
        <h3>Verify it yourself, without a wallet</h3>
        <pre className="mono pre" style={{ margin: 0 }}>{`npm run verify:live     # chain, source sha256, ABI counts, protocol revision
npm run verify:safety   # no clock method, no owner, one value exit, sha256 evidence binding`}</pre>
        <dl className="facts small">
          <dt>Address</dt><dd><a className="link mono" href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">{CONTRACT_ADDRESS}</a></dd>
          <dt>Source sha256</dt><dd className="hash">{SOURCE_SHA256}</dd>
          <dt>API</dt><dd><a className="link mono" href="/api/health">/api/health</a> — the same checks as JSON.</dd>
        </dl>
      </div>
    </div>
  );
}
