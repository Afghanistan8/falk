"use client";

import type { Criterion } from "@/lib/protocol";
import { WEIGHT_TOTAL } from "@/lib/protocol";

export function weightTotal(criteria: Criterion[]): number {
  return criteria.reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0);
}

/** Client-side mirror of parse_checklist's checks, so the form can say why before a wallet prompt. */
export function checklistProblems(criteria: Criterion[]): string[] {
  const problems: string[] = [];
  if (criteria.length === 0) problems.push("Add at least one criterion.");
  if (criteria.length > 12) problems.push("At most 12 criteria are allowed.");
  const seen = new Set<string>();
  criteria.forEach((c, i) => {
    const n = i + 1;
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(c.id)) problems.push(`Criterion ${n}: the id must be 1–16 letters, digits, _ or -.`);
    if (seen.has(c.id)) problems.push(`Criterion ${n}: duplicate id ${c.id}.`);
    seen.add(c.id);
    if (!c.title.trim()) problems.push(`Criterion ${n}: add a title.`);
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100) problems.push(`Criterion ${n}: weight must be a whole number from 1 to 100.`);
    if (!Number.isInteger(c.min_evidence) || c.min_evidence < 1 || c.min_evidence > 5) problems.push(`Criterion ${n}: minimum evidence must be 1–5.`);
  });
  const total = weightTotal(criteria);
  if (total !== WEIGHT_TOTAL) problems.push(`Weights must add up to exactly 100 (they add up to ${total}).`);
  return problems;
}

export function CriteriaEditor({
  value,
  onChange,
  disabled,
}: {
  value: Criterion[];
  onChange: (next: Criterion[]) => void;
  disabled?: boolean;
}) {
  const total = weightTotal(value);
  const update = (i: number, patch: Partial<Criterion>) =>
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div className="stack">
      {value.map((c, i) => (
        <fieldset key={i} className="card tight" disabled={disabled} style={{ border: "1px solid var(--line)" }}>
          <legend className="small mono muted">Criterion {i + 1}</legend>
          <div className="grid3">
            <label className="field">
              <span>Id</span>
              <input value={c.id} maxLength={16} onChange={(e) => update(i, { id: e.target.value.trim() })} />
            </label>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span>Title</span>
              <input value={c.title} maxLength={120} onChange={(e) => update(i, { title: e.target.value })} />
            </label>
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            <span>What counts as met?</span>
            <textarea value={c.description} maxLength={2000} onChange={(e) => update(i, { description: e.target.value })} />
          </label>
          <div className="grid3" style={{ marginTop: 10 }}>
            <label className="field">
              <span>Weight (whole number)</span>
              <input type="number" min={1} max={100} value={c.weight}
                onChange={(e) => update(i, { weight: Math.trunc(Number(e.target.value)) })} />
            </label>
            <label className="field">
              <span>Minimum evidence</span>
              <input type="number" min={1} max={5} value={c.min_evidence}
                onChange={(e) => update(i, { min_evidence: Math.trunc(Number(e.target.value)) })} />
            </label>
            <label className="field">
              <span>Independence</span>
              <select value={c.independence} onChange={(e) => update(i, { independence: e.target.value as Criterion["independence"] })}>
                <option value="ANY">Any admissible source</option>
                <option value="THIRD_PARTY">Distinct independent sites</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
            <label className="row small">
              <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={c.non_negotiable}
                onChange={(e) => update(i, { non_negotiable: e.target.checked })} />
              Non-negotiable — if this fails the work is rejected regardless of score
            </label>
            <button type="button" className="btn ghost sm" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="btn ghost sm"
          disabled={disabled || value.length >= 12}
          onClick={() =>
            onChange([...value, { id: `C${value.length + 1}`, title: "", description: "", weight: 1, non_negotiable: false, min_evidence: 1, independence: "ANY" }])
          }
        >
          Add criterion
        </button>
        <span className={`tag ${total === WEIGHT_TOTAL ? "go" : "stop"}`}>
          Weights {total} / {WEIGHT_TOTAL}
        </span>
      </div>
      <div className="bar" aria-hidden>
        <i style={{ width: `${Math.min(100, total)}%`, background: total === WEIGHT_TOTAL ? "var(--go)" : "var(--stop)" }} />
      </div>
    </div>
  );
}
