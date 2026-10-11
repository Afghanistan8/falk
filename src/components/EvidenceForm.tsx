"use client";

import { useState } from "react";

import { commitmentOf } from "@/lib/pure";
import type { Criterion, MandateView, OriginClass } from "@/lib/protocol";
import type { FalkClient } from "@/lib/falk";
import { ORIGIN_LABEL } from "@/lib/present";

interface Props {
  mandate: MandateView;
  criteria: Criterion[];
  role: "client" | "operator";
  disabled: boolean;
  onSubmit: (label: string, action: (c: FalkClient) => Promise<{ hash: string }>) => void;
}

/**
 * Filing evidence means committing to its exact bytes. The commitment can be
 * computed here from the live URL (when the host allows cross-origin reads) or
 * from pasted text; either way it is sha256 of the stripped UTF-8 body, the
 * same thing the contract re-checks after sealing.
 */
export function EvidenceForm({ mandate, criteria, role, disabled, onSubmit }: Props) {
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [commitment, setCommitment] = useState("");
  const [body, setBody] = useState("");
  const [origin, setOrigin] = useState<OriginClass>(role === "client" ? "CLIENT_HOSTED" : "OPERATOR_HOSTED");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const origins: OriginClass[] =
    role === "client" ? ["CLIENT_HOSTED", "THIRD_PARTY", "PUBLIC_RECORD"] : ["OPERATOR_HOSTED", "THIRD_PARTY", "PUBLIC_RECORD"];
  const evidenceRole = role === "client" ? "COUNTER" : "SUPPORT";
  const valid = /^[0-9a-f]{64}$/.test(commitment.trim().toLowerCase().replace(/^sha256:/, ""));

  async function fetchAndHash() {
    setStatus("Fetching…");
    try {
      const r = await fetch(url.trim());
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      const text = await r.text();
      setCommitment(await commitmentOf(text));
      setStatus(`Hashed ${text.length} characters from the live URL.`);
    } catch (e) {
      setStatus(`Could not read it from the browser (${e instanceof Error ? e.message : e}). Paste the body below instead, or compute the sha256 yourself.`);
    }
  }
  async function hashPasted() {
    setCommitment(await commitmentOf(body));
    setStatus(`Hashed ${body.length} pasted characters.`);
  }

  return (
    <div className="stack">
      <label className="field"><span>Public URL ({mandate.schemes})</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
      </label>
      <fieldset className="card tight" style={{ border: "1px solid var(--line)" }}>
        <legend className="small muted">Speaks to criteria</legend>
        <div className="row">
          {criteria.map((c) => (
            <label key={c.id} className="row small">
              <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={picked.includes(c.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
              <span className="mono">{c.id}</span> {c.title}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field"><span>Where does it come from?</span>
        <select value={origin} onChange={(e) => setOrigin(e.target.value as OriginClass)}>
          {origins.map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
        </select>
        <small>
          Independent origins (third party / public record) are refused if they share a site with your own hosted
          evidence or the deliverable.
        </small>
      </label>
      <label className="field"><span>Content commitment (sha256 of the body)</span>
        <input className="mono" value={commitment} onChange={(e) => setCommitment(e.target.value)} placeholder="64 hex characters" spellCheck={false} />
      </label>
      <div className="row">
        <button type="button" className="btn ghost sm" disabled={!url.trim()} onClick={fetchAndHash}>Fetch URL and compute</button>
        <span className="muted small">or paste the exact body and hash it locally:</span>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste the document text (optional)" />
      <div className="row"><button type="button" className="btn ghost sm" disabled={!body.trim()} onClick={hashPasted}>Hash pasted text</button></div>
      {status ? <div className="notice small" role="status">{status}</div> : null}
      <label className="field"><span>Note (optional)</span><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="btn accent" disabled={disabled || !valid || !url.trim() || picked.length === 0}
        onClick={() => onSubmit("File evidence", (c) => c.submitEvidence(mandate.mandate_id, {
          criterionIds: picked, url: url.trim(), role: evidenceRole, commitment: commitment.trim().toLowerCase(),
          origin, mediaType: "text/html", publisher: "", note,
        }))}>
        File evidence
      </button>
      {!valid && commitment ? <p className="small" style={{ color: "var(--stop)" }}>A commitment is exactly 64 hexadecimal characters.</p> : null}
    </div>
  );
}
