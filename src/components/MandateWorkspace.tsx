"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Act, computeActs, roleOf, whyNot } from "@/lib/acts";
import { addressUrl, txUrl } from "@/lib/config";
import type { FalkClient } from "@/lib/falk";
import { parseGen } from "@/lib/pure";
import {
  ACT_LABEL, ACTION_LABEL, RETRIEVAL_LABEL, RULING_LABEL, RULING_MEANING, STATE_NEXT,
  VERDICT_TONE, countdown, formatDuration, formatGen, formatTime, shortHash,
} from "@/lib/present";
import type { MandateStatus, Ruling } from "@/lib/protocol";
import { TERMINAL_STATES } from "@/lib/protocol";
import { useMandate, useNow, useTx } from "@/lib/useFalk";
import { EvidenceForm } from "./EvidenceForm";
import { Addr, Empty, Gen, Section, StateBadge, Tag, TxStatus } from "./ui";
import { useWallet } from "./WalletProvider";

const PATH: { status: MandateStatus[]; label: string }[] = [
  { status: ["DRAFT"], label: "Draft" },
  { status: ["ESCROWED"], label: "Funded" },
  { status: ["ENGAGED"], label: "Engaged" },
  { status: ["DELIVERED"], label: "Delivered" },
  { status: ["APPROVED", "CONTESTED", "RECORD_SEALED", "RULING", "APPEALED", "FINALIZED"], label: "Review / ruling" },
  { status: ["SETTLED", "CANCELLED", "LAPSED", "RECOVERED"], label: "Closed" },
];

export function MandateWorkspace({ id }: { id: string }) {
  const { bundle, missing, error, loading, reload } = useMandate(id);
  const { address, onChain } = useWallet();
  const now = useNow();
  const { tx, run, busy, canSign } = useTx(reload);

  if (loading) return <div className="wrap section"><div className="notice wait">Reading {id} from StudioNet…</div></div>;
  if (missing) {
    return (
      <div className="wrap section stack">
        <Empty>No mandate <span className="mono">{id}</span> exists on this contract.</Empty>
        <Link className="link" href="/mandates">Back to the registry</Link>
      </div>
    );
  }
  if (error || !bundle) return <div className="wrap section"><div className="notice stop">Could not read the mandate: {error}</div></div>;

  return (
    <Workspace bundle={bundle} address={address} onChain={onChain} now={now} tx={tx} run={run} busy={busy} canSign={canSign} reload={reload} />
  );
}

type WorkspaceProps = {
  bundle: NonNullable<ReturnType<typeof useMandate>["bundle"]>;
  address: string | null;
  onChain: boolean;
  now: number;
  tx: ReturnType<typeof useTx>["tx"];
  run: ReturnType<typeof useTx>["run"];
  busy: boolean;
  canSign: boolean;
  reload: () => Promise<unknown>;
};

function Workspace({ bundle, address, onChain, now, tx, run, busy, canSign, reload }: WorkspaceProps) {
  const { mandate: m, criteria, evidence, contest, rulings, settlement } = bundle;
  const who = roleOf(m, address);
  const acts = useMemo(() => computeActs(m, address, now), [m, address, now]);
  const disabledAll = !canSign || !onChain || busy;
  const latest = rulings[rulings.length - 1] ?? null;
  const [split, setSplit] = useState("50");
  const [claim, setClaim] = useState("");
  const [disputed, setDisputed] = useState<string[]>([]);
  const [response, setResponse] = useState("");
  const [deliverUrl, setDeliverUrl] = useState("");
  const [deliverHash, setDeliverHash] = useState("");

  const pathIndex = PATH.findIndex((p) => p.status.includes(m.status));
  const closed = TERMINAL_STATES.includes(m.status);
  const go = (label: string, fn: (c: FalkClient) => Promise<{ hash: string }>) => void run(label, fn);

  const simple: Partial<Record<Act, { tone?: "accent"; text: string; fn: (c: FalkClient) => Promise<{ hash: string }> }>> = {
    fund_mandate: { tone: "accent", text: `Fund with exactly ${formatGen(m.payment_wei)} GEN`, fn: (c) => c.fundMandate(m.mandate_id, BigInt(m.payment_wei)) },
    accept_mandate: { tone: "accent", text: `Accept and post a ${formatGen(m.operator_bond_wei)} GEN bond`, fn: (c) => c.acceptMandate(m.mandate_id, BigInt(m.operator_bond_wei)) },
    cancel_mandate: { text: "Cancel and withdraw", fn: (c) => c.cancelMandate(m.mandate_id) },
    approve_work: { tone: "accent", text: "Approve the work", fn: (c) => c.approveWork(m.mandate_id) },
    claim_unreviewed_delivery: { tone: "accent", text: "Claim unreviewed delivery", fn: (c) => c.claimUnreviewed(m.mandate_id) },
    seal_record: { text: "Seal the record", fn: (c) => c.sealRecord(m.mandate_id) },
    adjudicate: { tone: "accent", text: "Run the panel round", fn: (c) => c.adjudicate(m.mandate_id) },
    appeal: { text: "Appeal (one time only)", fn: (c) => c.appeal(m.mandate_id) },
    finalize_ruling: { tone: "accent", text: "Finalize the ruling", fn: (c) => c.finalizeRuling(m.mandate_id) },
    settle: { tone: "accent", text: "Settle", fn: (c) => c.settle(m.mandate_id) },
    accept_split: { tone: "accent", text: `Accept the proposed ${m.split_pct}% operator split`, fn: (c) => c.acceptSplit(m.mandate_id) },
    lapse_mandate: { text: "Mark as lapsed", fn: (c) => c.lapseMandate(m.mandate_id) },
    recover_escrow: { text: "Recover the escrow", fn: (c) => c.recoverEscrow(m.mandate_id) },
  };
  const simpleActs = (Object.keys(simple) as Act[]).filter((a) => acts.includes(a));
  const allActs = Object.keys(ACT_LABEL) as Act[];
  const blocked = allActs
    .filter((a) => !acts.includes(a) && a !== "update_draft")
    .map((a) => ({ act: a, reason: whyNot(m, address, now, a, formatTime) }))
    .filter((x): x is { act: Act; reason: string } => Boolean(x.reason));

  return (
    <div className="wrap section stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="muted mono small">{m.mandate_id}</div>
          <h1 style={{ fontSize: "2.1rem" }}>{m.title}</h1>
        </div>
        <StateBadge status={m.status} />
      </div>
      <p className="muted" style={{ maxWidth: "52rem" }}>{m.description}</p>

      <div className="card stack">
        <ol className="steps" aria-label="Lifecycle">
          {PATH.map((p, i) => (
            <li key={p.label} className={i < pathIndex || (closed && i <= pathIndex) ? "done" : i === pathIndex ? "now" : ""}>
              <span className="dot" aria-hidden />
              {p.label}
              {i === pathIndex ? <span className="muted small"> · {m.status.replace("_", " ").toLowerCase()}</span> : null}
            </li>
          ))}
        </ol>
        <div className="notice"><strong>Next:</strong> {STATE_NEXT[m.status]}</div>
        <div className="row small muted">
          <span>You are the <strong>{who === "keeper" ? "observer (anyone can run progress-only steps)" : who}</strong>.</span>
          <span>Times are estimated from your clock; the contract uses consensus time.</span>
        </div>
      </div>

      <div className="grid2">
        <Section title="Actions">
          {!address ? <div className="notice warn">Connect a wallet to act. Everything else on this page is read live from the chain.</div> : null}
          {address && !onChain ? <div className="notice warn">Your wallet is on a different network. Switch to StudioNet to sign.</div> : null}
          {acts.includes("update_draft") ? (
            <div className="notice">
              This draft is still editable. <Link className="btn ghost sm" href={`/mandates/${m.mandate_id}/edit`}>Edit terms</Link>{" "}
              Funding freezes them by hash.
            </div>
          ) : null}
          <div className="row">
            {simpleActs.map((a) => (
              <button key={a} className={`btn ${simple[a]?.tone === "accent" ? "accent" : ""}`} disabled={disabledAll} onClick={() => go(ACT_LABEL[a], simple[a]!.fn)}>
                {simple[a]!.text}
              </button>
            ))}
            {simpleActs.length === 0 && !acts.some((a) => ["submit_evidence", "submit_deliverable", "open_contest", "respond_to_contest", "propose_split"].includes(a)) ? (
              <span className="muted">{closed ? "This mandate is closed. Nothing more can be done." : "Nothing is available to you right now."}</span>
            ) : null}
          </div>

          {acts.includes("submit_deliverable") ? (
            <div className="card tight stack">
              <h3>Mark delivered</h3>
              <label className="field"><span>Deliverable URL</span><input value={deliverUrl} onChange={(e) => setDeliverUrl(e.target.value)} placeholder="https://…" spellCheck={false} /></label>
              <label className="field"><span>Deliverable sha256</span><input className="mono" value={deliverHash} onChange={(e) => setDeliverHash(e.target.value)} spellCheck={false} /></label>
              <button className="btn accent" disabled={disabledAll || !deliverUrl.trim() || !/^[0-9a-fA-F]{64}$/.test(deliverHash.trim())}
                onClick={() => go("Mark delivered", (c) => c.submitDeliverable(m.mandate_id, deliverUrl.trim(), deliverHash.trim().toLowerCase()))}>Deliver</button>
              <p className="muted small">Filing a deliverable starts the client&apos;s review window ({formatDuration(m.review_window_ms)}).</p>
            </div>
          ) : null}

          {acts.includes("open_contest") ? (
            <div className="card tight stack">
              <h3>Open a contest</h3>
              <div className="row">{criteria.map((c) => (
                <label key={c.id} className="row small"><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={disputed.includes(c.id)}
                  onChange={(e) => setDisputed(e.target.checked ? [...disputed, c.id] : disputed.filter((x) => x !== c.id))} /><span className="mono">{c.id}</span> {c.title}</label>
              ))}</div>
              <textarea value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="What is wrong, and why?" maxLength={2000} />
              <button className="btn accent" disabled={disabledAll || !claim.trim() || disputed.length === 0}
                onClick={() => go("Open a contest", (c) => c.openContest(m.mandate_id, disputed, claim.trim(), BigInt(m.contest_bond_wei)))}>
                Post {formatGen(m.contest_bond_wei)} GEN bond and contest
              </button>
              <p className="muted small">The panel judges the whole checklist, not only the criteria you name. Your bond comes back to you.</p>
            </div>
          ) : null}

          {acts.includes("respond_to_contest") ? (
            <div className="card tight stack">
              <h3>Respond to the contest</h3>
              <textarea value={response} onChange={(e) => setResponse(e.target.value)} maxLength={2000} />
              <button className="btn" disabled={disabledAll || !response.trim()} onClick={() => go("Respond to the contest", (c) => c.respondToContest(m.mandate_id, response.trim()))}>Send response</button>
            </div>
          ) : null}

          {acts.includes("propose_split") ? (
            <div className="card tight stack">
              <h3>Propose a split</h3>
              <label className="field"><span>Operator&apos;s share of the payment (%)</span>
                <input inputMode="numeric" value={split} onChange={(e) => setSplit(e.target.value)} /></label>
              <button className="btn" disabled={disabledAll || !/^\d+$/.test(split) || Number(split) > 100}
                onClick={() => go("Propose a split", (c) => c.proposeSplit(m.mandate_id, Number(split)))}>Propose</button>
              {m.split_proposed ? <p className="small">Currently proposed: <strong>{m.split_pct}%</strong> to the operator, by <Addr value={m.split_proposer} />. A new proposal replaces it.</p> : null}
            </div>
          ) : null}

          {acts.includes("submit_evidence") && (who === "client" || who === "operator") ? (
            <details className="card tight" open={m.status !== "DELIVERED"}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>File evidence</summary>
              <div style={{ marginTop: 12 }}>
                <EvidenceForm mandate={m} criteria={criteria} role={who} disabled={disabledAll} onSubmit={go} />
              </div>
            </details>
          ) : null}

          <TxStatus tx={tx} />

          {blocked.length > 0 ? (
            <details>
              <summary className="small muted" style={{ cursor: "pointer" }}>Not available right now ({blocked.length}) — and why</summary>
              <ul className="small" style={{ paddingLeft: 18 }}>
                {blocked.map((b) => <li key={b.act}><strong>{ACT_LABEL[b.act]}:</strong> {b.reason}</li>)}
              </ul>
            </details>
          ) : null}
        </Section>

        <Section title="Money">
          <dl className="facts">
            <dt>Payment</dt><dd><Gen wei={m.payment_deposited === "0" ? m.payment_wei : m.payment_deposited} /> {m.payment_deposited === "0" ? <span className="muted">(agreed, not yet deposited)</span> : null}</dd>
            <dt>Operator bond</dt><dd><Gen wei={m.operator_bond_deposited === "0" ? m.operator_bond_wei : m.operator_bond_deposited} /> {m.operator_bond_deposited === "0" ? <span className="muted">(agreed)</span> : null}</dd>
            <dt>Contest bond</dt><dd><Gen wei={m.contest_bond_deposited === "0" ? m.contest_bond_wei : m.contest_bond_deposited} /> {m.contest_bond_deposited === "0" ? <span className="muted">(agreed)</span> : null}</dd>
            <dt>Held in custody</dt><dd><strong><Gen wei={m.custody_held} /></strong></dd>
            <dt>Released</dt><dd><Gen wei={m.total_released} /></dd>
            <dt>Client</dt><dd><a className="link" href={addressUrl(m.client)} target="_blank" rel="noreferrer"><Addr value={m.client} you={who === "client"} /></a></dd>
            <dt>Operator</dt><dd><a className="link" href={addressUrl(m.operator)} target="_blank" rel="noreferrer"><Addr value={m.operator} you={who === "operator"} /></a> · <Link className="link" href="/operators">passport</Link></dd>
          </dl>
          {settlement ? (
            <div className="notice go">
              <strong>Settled · {ACTION_LABEL[settlement.action] ?? settlement.action}</strong> ({settlement.path.toLowerCase().replace("_", " ")}).{" "}
              Operator received <Gen wei={settlement.operator_payout} />, client received <Gen wei={settlement.client_payout} />. Custody after: <Gen wei={settlement.custody_after} />.
            </div>
          ) : null}
        </Section>
      </div>

      <Section title="Deadlines" aside={<span className="muted small">absolute UTC, set from consensus time</span>}>
        <div className="tablewrap"><table><tbody>
          {([
            ["Execution deadline", m.execution_deadline_at, m.status === "ENGAGED"],
            ["Review deadline", m.review_deadline_at, m.status === "DELIVERED"],
            ["Operator response", m.response_deadline_at, m.status === "CONTESTED"],
            ["Panel stall limit", m.stall_deadline_at, ["RECORD_SEALED", "APPEALED"].includes(m.status)],
            ["Appeal deadline", m.appeal_deadline_at, m.status === "RULING"],
            ["Manual-review deadline", m.manual_deadline_at, m.status === "FINALIZED"],
          ] as [string, number, boolean][]).filter(([, v]) => v > 0).map(([label, v, active]) => (
            <tr key={label}><th>{label}</th><td>{formatTime(v)}</td><td className={active ? "" : "muted"}>{active ? countdown(v, now) : "—"}</td></tr>
          ))}
          {m.execution_deadline_at === 0 && m.funded_at_ms === 0 ? <tr><td className="muted">Deadlines appear as the mandate moves: nothing is scheduled while it is a draft.</td></tr> : null}
        </tbody></table></div>
      </Section>

      <Section title="Acceptance checklist" aside={<span className="muted small">weights frozen at funding</span>}>
        <div className="tablewrap"><table>
          <thead><tr><th>Id</th><th>Criterion</th><th>Weight</th><th>Rules</th>{latest ? <th>Latest verdict</th> : null}</tr></thead>
          <tbody>{criteria.map((c) => {
            const r = latest?.results.find((x) => x.id === c.id);
            return (
              <tr key={c.id}>
                <td className="mono">{c.id}</td>
                <td><strong>{c.title}</strong>{c.description ? <div className="muted small">{c.description}</div> : null}</td>
                <td>{c.weight}</td>
                <td className="small">
                  {c.non_negotiable ? <Tag tone="stop">non-negotiable</Tag> : null}{" "}
                  needs {c.min_evidence} {c.independence === "THIRD_PARTY" ? "independent site(s)" : "retrieved source(s)"}
                </td>
                {latest ? <td>{r ? <Tag tone={VERDICT_TONE[r.result]}>{r.result}</Tag> : "—"}{latest.clamped.includes(c.id) ? <div className="small muted">PASS withheld: not enough admissible evidence</div> : null}</td> : null}
              </tr>
            );
          })}</tbody>
        </table></div>
      </Section>

      <Section title={`Evidence (${evidence.length})`} aside={m.sealed_at_ms ? <Tag tone="warn">sealed {m.sealed_count} · {shortHash(m.snapshot_hash)}</Tag> : <Tag tone="neutral">open</Tag>}>
        {evidence.length === 0 ? <Empty>No evidence has been filed on this mandate.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>#</th><th>Source</th><th>For</th><th>Origin</th><th>Commitment</th>{latest ? <th>Panel retrieval</th> : null}</tr></thead>
            <tbody>{evidence.map((e) => {
              const label = latest?.retrievals[String(e.receipt_id)];
              const meta = label ? RETRIEVAL_LABEL[label] : null;
              return (
                <tr key={e.receipt_id}>
                  <td>{e.receipt_id}</td>
                  <td><a className="link" href={e.url} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{e.url}</a>
                    <div className="small muted">{e.role.toLowerCase()} · filed by {e.submitter_role} · {formatTime(e.submitted_at_ms)}</div></td>
                  <td className="mono">{e.criterion_ids.join(", ") || "—"}</td>
                  <td className="small">{e.origin_class.replace("_", " ").toLowerCase()}</td>
                  <td className="hash" title={e.content_commitment}>{shortHash(e.content_commitment, 12)}</td>
                  {latest ? <td>{meta ? <Tag tone={meta.tone} title={meta.meaning}>{meta.text}</Tag> : "—"}</td> : null}
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Section>

      {contest ? (
        <Section title="Contest">
          <dl className="facts">
            <dt>Disputed</dt><dd className="mono">{contest.disputed.join(", ")}</dd>
            <dt>Claim</dt><dd className="pre">{contest.claim}</dd>
            <dt>Operator response</dt><dd className="pre">{contest.operator_responded ? contest.operator_response : <span className="muted">none yet</span>}</dd>
            <dt>Bond</dt><dd><Gen wei={contest.bond_wei} /></dd>
          </dl>
        </Section>
      ) : null}

      <Section title={`Rulings (${rulings.length})`}>
        {rulings.length === 0 ? <Empty>No panel round has completed. {m.status === "RECORD_SEALED" ? "The record is sealed: anyone can run the round." : ""}</Empty> :
          rulings.map((r) => <RulingCard key={r.ruling_id} r={r} pinned={m.final_ruling_id === r.ruling_id} criteria={criteria} />)}
      </Section>

      <Section title="Frozen terms">
        <dl className="facts">
          <dt>Terms hash</dt><dd className="hash">{m.terms_hash || <span className="muted">not frozen until funded</span>}</dd>
          <dt>Policy</dt>
          <dd>Confirmed → {ACTION_LABEL[m.policy.CONFIRMED]}<br />Partial → {ACTION_LABEL[m.policy.PARTIAL]}<br />Rejected → {ACTION_LABEL[m.policy.REJECTED]}<br />
            Inconclusive → {ACTION_LABEL[m.policy.INCONCLUSIVE]}<br />No delivery → bond {m.policy.LAPSE_BOND === "FORFEIT" ? "forfeited to the client" : "returned"}</dd>
          <dt>Windows</dt><dd>execution {formatDuration(m.execution_window_ms)} · review {formatDuration(m.review_window_ms)} · response {formatDuration(m.response_window_ms)} · appeal {formatDuration(m.appeal_window_ms)} · manual {formatDuration(m.manual_window_ms)}</dd>
          <dt>Evidence rules</dt><dd>{m.evidence_rules || "—"} <span className="muted">· schemes {m.schemes}, up to {m.max_receipts} receipts per party</span></dd>
          {m.deliverable_url ? (<><dt>Deliverable</dt><dd><a className="link" href={m.deliverable_url} target="_blank" rel="noreferrer">{m.deliverable_url}</a></dd></>) : null}
        </dl>
      </Section>
      {tx.hash ? <p className="muted small">Last transaction: <a className="link mono" href={txUrl(tx.hash)} target="_blank" rel="noreferrer">{tx.hash}</a></p> : null}
    </div>
  );
}

function RulingCard({ r, pinned, criteria }: { r: Ruling; pinned: boolean; criteria: { id: string; title: string; weight: number }[] }) {
  const tone = r.ruling === "CONFIRMED" ? "go" : r.ruling === "REJECTED" ? "stop" : "warn";
  return (
    <div className="card tight stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <strong>Round {r.round_number} · {r.kind === "APPEAL" ? "appeal" : "initial"}</strong>
          <Tag tone={tone}>{RULING_LABEL[r.ruling]}</Tag>
          <span className="mono">score {r.score}/100</span>
          {r.critical_failed ? <Tag tone="stop">non-negotiable failed</Tag> : null}
          {pinned ? <Tag tone="go">pinned for settlement</Tag> : null}
        </div>
        <span className="muted small">{formatTime(r.evaluated_at_ms)}</span>
      </div>
      <p className="muted small">{RULING_MEANING[r.ruling]} The score and ruling are the contract&apos;s own arithmetic over the frozen weights; the panel supplied only the verdicts below.</p>
      <div className="tablewrap"><table><tbody>
        {r.results.map((x) => {
          const c = criteria.find((k) => k.id === x.id);
          return (
            <tr key={x.id}><td className="mono">{x.id}</td><td>{c?.title}</td><td><Tag tone={VERDICT_TONE[x.result]}>{x.result}</Tag></td>
              <td className="small muted">{r.clamped.includes(x.id) ? "PASS withheld by the contract: insufficient admissible evidence. " : ""}{x.reason}</td></tr>
          );
        })}
      </tbody></table></div>
      <details>
        <summary className="small muted" style={{ cursor: "pointer" }}>Inspection data (stored, never used for settlement)</summary>
        <dl className="facts small" style={{ marginTop: 8 }}>
          <dt>Evidence quality</dt><dd>{r.quality}</dd>
          <dt>Integrity flags</dt><dd>{r.flags.length ? r.flags.join(", ") : "none"}</dd>
          <dt>Panel reasoning</dt><dd className="pre">{r.reasoning || "—"}</dd>
          <dt>Fingerprint</dt><dd className="hash">{r.fingerprint}</dd>
        </dl>
      </details>
    </div>
  );
}
