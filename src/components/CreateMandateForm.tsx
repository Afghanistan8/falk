"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { formatGen, parseGen } from "@/lib/pure";
import { describeRefusal } from "@/lib/present";
import type { Criterion, MandateView, Policy, Windows } from "@/lib/protocol";
import { SAMPLES } from "@/lib/samples";
import { useSigner } from "@/lib/useFalk";
import { CriteriaEditor, checklistProblems } from "./CriteriaEditor";
import { useWallet } from "./WalletProvider";

const MIN = 60_000;
const first = SAMPLES[0];

export function CreateMandateForm({ edit }: { edit?: { mandate: MandateView; criteria: Criterion[] } }) {
  const router = useRouter();
  const wallet = useWallet();
  const signer = useSigner();

  const e = edit?.mandate;
  const [operator, setOperator] = useState(e?.operator ?? "");
  const [title, setTitle] = useState(e?.title ?? "");
  const [description, setDescription] = useState(e?.description ?? "");
  const [criteria, setCriteria] = useState<Criterion[]>(
    edit?.criteria ?? [
      { id: "C1", title: "", description: "", weight: 100, non_negotiable: false, min_evidence: 1, independence: "ANY" },
    ],
  );
  const [payment, setPayment] = useState(e ? formatGen(e.payment_wei) : "");
  const [bond, setBond] = useState(e ? formatGen(e.operator_bond_wei) : "0");
  const [contestBond, setContestBond] = useState(e ? formatGen(e.contest_bond_wei) : "0");
  const [rules, setRules] = useState(e?.evidence_rules ?? "");
  const [minutes, setMinutes] = useState<Record<keyof Windows, string>>(
    e
      ? {
          execution: String(e.execution_window_ms / MIN), review: String(e.review_window_ms / MIN),
          response: String(e.response_window_ms / MIN), appeal: String(e.appeal_window_ms / MIN),
          manual: String(e.manual_window_ms / MIN),
        }
      : { execution: "1440", review: "240", response: "120", appeal: "120", manual: "1440" },
  );
  const [policy, setPolicy] = useState<Policy>(
    e?.policy ?? {
      version: "FALK-POLICY-1", CONFIRMED: "RELEASE_FULL", PARTIAL: "PRORATA", REJECTED: "RETURN",
      INCONCLUSIVE: "MANUAL_REVIEW", LAPSE_BOND: "RETURN",
    },
  );
  const [schemes, setSchemes] = useState(e?.schemes ?? "https");
  const [maxReceipts, setMaxReceipts] = useState(String(e?.max_receipts ?? 12));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (key: string) => {
    const s = SAMPLES.find((x) => x.key === key) ?? first;
    setTitle(s.title);
    setDescription(s.description);
    setCriteria(s.criteria.map((c) => ({ ...c })));
    setPayment(s.payment);
    setBond(s.operatorBond);
    setContestBond(s.contestBond);
    setRules(s.evidenceRules);
    setPolicy({ ...policy, ...(s.policy as Partial<Policy>) } as Policy);
    setMinutes(Object.fromEntries(Object.entries(s.windowsMinutes).map(([k, v]) => [k, String(v)])) as Record<keyof Windows, string>);
  };

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!/^0x[0-9a-fA-F]{40}$/.test(operator.trim())) out.push("Enter the operator's 0x… address (42 characters).");
    else if (wallet.address && operator.trim().toLowerCase() === wallet.address.toLowerCase()) out.push("The operator must be a different address from yours.");
    if (!title.trim()) out.push("Add a title.");
    if (!description.trim()) out.push("Describe the agreement.");
    out.push(...checklistProblems(criteria));
    try { if (parseGen(payment) <= BigInt(0)) out.push("Payment must be more than zero."); } catch { out.push("Payment must be a number of GEN."); }
    for (const [label, v] of [["Operator bond", bond], ["Contest bond", contestBond]] as const) {
      try { parseGen(v); } catch { out.push(`${label} must be a number of GEN (0 is allowed).`); }
    }
    for (const [k, v] of Object.entries(minutes)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 525_600) out.push(`The ${k} window must be between 1 minute and one year.`);
    }
    const cap = Number(maxReceipts);
    if (!Number.isInteger(cap) || cap < 1 || cap > 24) out.push("Receipts per party must be 1–24.");
    return out;
  }, [operator, title, description, criteria, payment, bond, contestBond, minutes, maxReceipts, wallet.address]);

  async function submit() {
    if (!signer || problems.length) return;
    setBusy(true);
    setError(null);
    try {
      const windows = Object.fromEntries(Object.entries(minutes).map(([k, v]) => [k, Math.round(Number(v) * MIN)])) as unknown as Windows;
      const input = {
        operator: operator.trim(), title: title.trim(), description: description.trim(), criteria,
        paymentWei: parseGen(payment), operatorBondWei: parseGen(bond), contestBondWei: parseGen(contestBond),
        evidenceRules: rules, policy, windows, schemes, maxReceipts: Number(maxReceipts),
      };
      if (edit) {
        await signer.updateDraft(edit.mandate.mandate_id, input);
        router.push(`/mandates/${edit.mandate.mandate_id}`);
        return;
      }
      const r = await signer.createMandate(input);
      if (typeof r.returned === "string" && r.returned.startsWith("FLK-")) router.push(`/mandates/${r.returned}`);
      else router.push("/mandates");
    } catch (e) {
      setError(describeRefusal(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {edit ? null : <div className="card row" style={{ justifyContent: "space-between" }}>
        <span className="muted">Start from a sample (you can change everything):</span>
        <span className="row">
          {SAMPLES.map((s) => (
            <button key={s.key} className="btn ghost sm" type="button" onClick={() => load(s.key)} title={s.summary}>
              {s.name}
            </button>
          ))}
        </span>
      </div>}

      <div className="card stack">
        <h3>Agreement</h3>
        <label className="field"><span>Operator address</span>
          <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="0x…" spellCheck={false} />
          <small>The only address that can accept, deliver and respond. It cannot be your own.</small>
        </label>
        <label className="field"><span>Title</span><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Agreement text</span>
          <textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field"><span>Evidence rules (shown to the panel)</span>
          <textarea value={rules} maxLength={2000} onChange={(e) => setRules(e.target.value)} />
        </label>
      </div>

      <div className="card stack">
        <h3>Acceptance checklist</h3>
        <p className="muted small">
          Weights are whole numbers that must total exactly 100. The panel only says PASS, FAIL or INCONCLUSIVE per criterion;
          the contract adds up the weights of the passes. Frozen when you fund.
        </p>
        <CriteriaEditor value={criteria} onChange={setCriteria} disabled={busy} />
      </div>

      <div className="card stack">
        <h3>Money</h3>
        <div className="grid3">
          <label className="field"><span>Payment (GEN)</span><input inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} /></label>
          <label className="field"><span>Operator performance bond (GEN)</span><input inputMode="decimal" value={bond} onChange={(e) => setBond(e.target.value)} /></label>
          <label className="field"><span>Client contest bond (GEN)</span><input inputMode="decimal" value={contestBond} onChange={(e) => setContestBond(e.target.value)} /></label>
        </div>
        <p className="muted small">Bonds go back to whoever posted them unless you choose the lapse-forfeit rule below. Ordinary underperformance is not misconduct.</p>
      </div>

      <div className="card stack">
        <h3>Settlement policy</h3>
        <div className="grid3">
          <label className="field"><span>Partial result</span>
            <select value={policy.PARTIAL} onChange={(e) => setPolicy({ ...policy, PARTIAL: e.target.value as Policy["PARTIAL"] })}>
              <option value="PRORATA">Pro-rata by score</option><option value="RETURN">Return to client</option><option value="MANUAL_REVIEW">Manual review</option>
            </select></label>
          <label className="field"><span>Rejected</span>
            <select value={policy.REJECTED} onChange={(e) => setPolicy({ ...policy, REJECTED: e.target.value as Policy["REJECTED"] })}>
              <option value="RETURN">Return to client</option><option value="MANUAL_REVIEW">Manual review</option>
            </select></label>
          <label className="field"><span>Inconclusive</span>
            <select value={policy.INCONCLUSIVE} onChange={(e) => setPolicy({ ...policy, INCONCLUSIVE: e.target.value as Policy["INCONCLUSIVE"] })}>
              <option value="MANUAL_REVIEW">Manual review</option><option value="SPLIT_EVEN">Split payment evenly</option><option value="RETURN">Return to client</option>
            </select></label>
          <label className="field"><span>If the operator never delivers</span>
            <select value={policy.LAPSE_BOND} onChange={(e) => setPolicy({ ...policy, LAPSE_BOND: e.target.value as Policy["LAPSE_BOND"] })}>
              <option value="RETURN">Return the bond</option><option value="FORFEIT">Forfeit the bond to the client</option>
            </select></label>
        </div>
        <p className="muted small">Confirmed always releases in full. Manual review keeps funds in escrow until the parties agree a split or the recovery window opens; they are never stranded.</p>
      </div>

      <div className="card stack">
        <h3>Windows (minutes)</h3>
        <div className="grid3">
          {(Object.keys(minutes) as (keyof Windows)[]).map((k) => (
            <label className="field" key={k}><span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input inputMode="numeric" value={minutes[k]} onChange={(e) => setMinutes({ ...minutes, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <p className="muted small">
          Each is a duration; the contract turns it into an absolute deadline from the consensus timestamp of the
          transaction that starts it. Execution starts when the operator accepts; review when work is delivered.
        </p>
      </div>

      <div className="card stack">
        <h3>Evidence rules</h3>
        <div className="grid2">
          <label className="field"><span>Allowed URL schemes</span>
            <select value={schemes} onChange={(e) => setSchemes(e.target.value)}>
              <option value="https">https only (recommended)</option><option value="https,http">https and http</option>
            </select></label>
          <label className="field"><span>Receipts per party</span>
            <input inputMode="numeric" value={maxReceipts} onChange={(e) => setMaxReceipts(e.target.value)} />
            <small>Each party has its own allowance, so one side cannot crowd out the other.</small></label>
        </div>
      </div>

      {problems.length > 0 ? (
        <div className="notice warn" role="status">
          <strong>Before you can create this:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}
      {error ? <div className="notice stop" role="alert">{error}</div> : null}
      <div className="row">
        <button className="btn accent" disabled={!signer || !wallet.onChain || busy || problems.length > 0} onClick={submit}>
          {busy ? "Waiting for your wallet and the network…" : edit ? "Save draft" : "Create draft mandate"}
        </button>
        {!wallet.address ? <span className="muted small">Connect a wallet first.</span> : !wallet.onChain ? <span className="muted small">Switch your wallet to StudioNet.</span> : null}
      </div>
    </div>
  );
}
