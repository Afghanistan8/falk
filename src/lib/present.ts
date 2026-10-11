import { humanizeRefusal } from "./pure";
import type { Action, MandateStatus, RetrievalLabel, RulingLabel, Verdict } from "./protocol";

export { formatGen, parseGen, humanizeRefusal as refusalText } from "./pure";

export type Tone = "neutral" | "wait" | "go" | "stop" | "done" | "warn";

export const STATE_LABEL: Record<MandateStatus, string> = {
  DRAFT: "Draft",
  ESCROWED: "Funded · awaiting operator",
  ENGAGED: "In progress",
  DELIVERED: "Delivered · in review",
  APPROVED: "Approved · ready to settle",
  CONTESTED: "Contested",
  RECORD_SEALED: "Record sealed · awaiting panel",
  RULING: "Ruled · appeal window",
  APPEALED: "Appealed · awaiting second round",
  FINALIZED: "Finalized",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
  LAPSED: "Lapsed",
  RECOVERED: "Escrow recovered",
};

export const STATE_TONE: Record<MandateStatus, Tone> = {
  DRAFT: "neutral", ESCROWED: "wait", ENGAGED: "go", DELIVERED: "wait", APPROVED: "go",
  CONTESTED: "warn", RECORD_SEALED: "warn", RULING: "warn", APPEALED: "warn",
  FINALIZED: "go", SETTLED: "done", CANCELLED: "done", LAPSED: "stop", RECOVERED: "done",
};

/** One sentence: where the mandate is and what has to happen next. */
export const STATE_NEXT: Record<MandateStatus, string> = {
  DRAFT: "The client can still edit the terms. Funding freezes them by hash.",
  ESCROWED: "Payment is in escrow. The operator accepts by posting the performance bond; the client can still cancel.",
  ENGAGED: "The operator files evidence and delivers before the execution deadline, or the mandate can lapse.",
  DELIVERED: "The client approves, or contests before the review deadline. If the client stays silent the operator can claim after it.",
  APPROVED: "Approved. Anyone can settle; the payment goes to the operator and bonds return to their posters.",
  CONTESTED: "The operator may respond; then either party seals the record. After the response deadline anyone can seal it.",
  RECORD_SEALED: "The evidence set is frozen. Anyone can run the panel round; a failed round changes nothing and can be retried.",
  RULING: "A ruling exists. Either party may appeal once; otherwise anyone can finalize after the appeal deadline.",
  APPEALED: "The sealed record is being re-judged. Anyone can run the second round.",
  FINALIZED: "The ruling is pinned. Anyone can settle under the frozen policy, or the parties resolve a manual review.",
  SETTLED: "Closed. Custody is zero and the settlement is recorded.",
  CANCELLED: "Closed before engagement. The payment went back to the client.",
  LAPSED: "The operator missed the execution deadline. Anyone can recover the escrow.",
  RECOVERED: "Closed. Escrow was returned under the recovery rules.",
};

export const RULING_LABEL: Record<RulingLabel, string> = {
  CONFIRMED: "Confirmed",
  PARTIAL: "Partial",
  REJECTED: "Rejected",
  INCONCLUSIVE: "Inconclusive",
};

export const RULING_MEANING: Record<RulingLabel, string> = {
  CONFIRMED: "Every criterion passed.",
  PARTIAL: "Some criteria passed; the score is the sum of their frozen weights.",
  REJECTED: "A non-negotiable criterion failed, or nothing passed.",
  INCONCLUSIVE: "The sealed record could not decide enough of the checklist.",
};

export const ACTION_LABEL: Record<string, string> = {
  RELEASE_FULL: "Release in full to the operator",
  PRORATA: "Pro-rata by score",
  RETURN: "Return to the client",
  SPLIT_EVEN: "Split the payment evenly",
  MANUAL_REVIEW: "Manual review (parties agree a split, or escrow is recovered)",
  RECOVER: "Recovered",
  CANCEL: "Cancelled",
  SPLIT_PCT: "Agreed split",
  LAPSE_RETURN: "Lapse · bond returned",
  LAPSE_FORFEIT: "Lapse · bond forfeited",
};

export const VERDICT_TONE: Record<Verdict, Tone> = { PASS: "go", FAIL: "stop", INCONCLUSIVE: "warn" };

export const RETRIEVAL_LABEL: Record<RetrievalLabel, { text: string; tone: Tone; meaning: string }> = {
  SUCCESS_MATCH: { text: "Match", tone: "go", meaning: "Retrieved and matches the sealed commitment; its text was shown to the panel." },
  CONTENT_MISMATCH: { text: "Mismatch", tone: "stop", meaning: "Retrieved, but the body no longer matches the sealed sha256. No text was shown; cannot support PASS." },
  FETCH_FAIL: { text: "Fetch failed", tone: "stop", meaning: "The validator could not retrieve it. Cannot support PASS." },
  EMPTY: { text: "Empty", tone: "stop", meaning: "The page was empty. Cannot support PASS." },
  NON_SUCCESS_HTTP: { text: "HTTP error", tone: "stop", meaning: "The server answered with a non-2xx status. Cannot support PASS." },
  BLOCKED: { text: "Blocked", tone: "stop", meaning: "Refused by the URL policy. Cannot support PASS." },
};

export const ORIGIN_LABEL: Record<string, string> = {
  OPERATOR_HOSTED: "Operator-hosted",
  CLIENT_HOSTED: "Client-hosted",
  THIRD_PARTY: "Independent third party",
  PUBLIC_RECORD: "Public record",
};

export const ACT_LABEL: Record<string, string> = {
  update_draft: "Save draft",
  fund_mandate: "Fund the mandate",
  accept_mandate: "Accept and post bond",
  cancel_mandate: "Cancel and withdraw",
  submit_evidence: "File evidence",
  submit_deliverable: "Mark delivered",
  approve_work: "Approve the work",
  claim_unreviewed_delivery: "Claim unreviewed delivery",
  open_contest: "Open a contest",
  respond_to_contest: "Respond to the contest",
  seal_record: "Seal the record",
  adjudicate: "Run the panel",
  appeal: "Appeal (once)",
  finalize_ruling: "Finalize the ruling",
  settle: "Settle",
  propose_split: "Propose a split",
  accept_split: "Accept the proposed split",
  lapse_mandate: "Mark lapsed",
  recover_escrow: "Recover the escrow",
};

export function formatTime(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function countdown(deadlineMs: number, nowMs: number): string {
  if (!deadlineMs) return "—";
  const diff = deadlineMs - nowMs;
  if (diff <= 0) return `passed ${formatDuration(-diff)} ago`;
  return `in ${formatDuration(diff)}`;
}

export function shortAddress(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "—";
}

export function shortHash(h: string, n = 10): string {
  return h && h.length > n + 2 ? `${h.slice(0, n)}…` : h || "—";
}

export function describeRefusal(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return humanizeRefusal(message);
}

export type { Action };
