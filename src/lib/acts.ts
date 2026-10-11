/**
 * The act matrix: which writes may this wallet attempt on this mandate, now?
 *
 * Pure and dependency-free so that Node can import it directly. It is a
 * line-for-line mirror of `compute_acts` in contracts/falk.py; the vectors in
 * tests/vectors/acts.json are generated from the Python original and checked
 * against this file by scripts/web.test.mjs, and tests/direct/test_acts_parity.py
 * checks the Python original against the real contract's refusals.
 */

export type Act =
  | "update_draft"
  | "fund_mandate"
  | "accept_mandate"
  | "cancel_mandate"
  | "submit_evidence"
  | "submit_deliverable"
  | "approve_work"
  | "claim_unreviewed_delivery"
  | "open_contest"
  | "respond_to_contest"
  | "seal_record"
  | "adjudicate"
  | "appeal"
  | "finalize_ruling"
  | "settle"
  | "propose_split"
  | "accept_split"
  | "lapse_mandate"
  | "recover_escrow";

export type Role = "client" | "operator" | "keeper";

/** The subset of get_mandate that the matrix reads. */
export interface ActsView {
  status: string;
  client: string;
  operator: string;
  execution_deadline_at: number;
  review_deadline_at: number;
  response_deadline_at: number;
  stall_deadline_at: number;
  appeal_deadline_at: number;
  manual_deadline_at: number;
  appeal_count: number;
  operator_responded: boolean;
  resolved_action: string;
  split_proposed: boolean;
  split_proposer: string;
}

export function roleOf(view: Pick<ActsView, "client" | "operator">, address?: string | null): Role {
  const a = (address ?? "").toLowerCase();
  if (a && a === view.client.toLowerCase()) return "client";
  if (a && a === view.operator.toLowerCase()) return "operator";
  return "keeper";
}

export function computeActs(v: ActsView, address: string | null | undefined, nowMs: number): Act[] {
  const who = roleOf(v, address);
  const acts: Act[] = [];
  const now = nowMs;
  const party = who === "client" || who === "operator";
  switch (v.status) {
    case "DRAFT":
      if (who === "client") acts.push("update_draft", "fund_mandate", "cancel_mandate");
      break;
    case "ESCROWED":
      if (who === "operator") acts.push("accept_mandate");
      if (who === "client") acts.push("cancel_mandate");
      break;
    case "ENGAGED":
      if (who === "operator" && now <= v.execution_deadline_at) {
        acts.push("submit_evidence", "submit_deliverable");
      }
      if (now > v.execution_deadline_at) acts.push("lapse_mandate");
      break;
    case "DELIVERED":
      if (who === "operator" && now <= v.review_deadline_at) acts.push("submit_evidence");
      if (who === "client") {
        acts.push("approve_work");
        if (now <= v.review_deadline_at) acts.push("open_contest");
      }
      if (who === "operator" && now > v.review_deadline_at) acts.push("claim_unreviewed_delivery");
      break;
    case "CONTESTED": {
      if (party) acts.push("submit_evidence");
      if (who === "operator" && !v.operator_responded) acts.push("respond_to_contest");
      const late = now >= v.response_deadline_at;
      if ((party && (v.operator_responded || late)) || late) acts.push("seal_record");
      break;
    }
    case "RECORD_SEALED":
      acts.push("adjudicate");
      if (now > v.stall_deadline_at) acts.push("recover_escrow");
      break;
    case "RULING":
      if (party && v.appeal_count === 0 && now <= v.appeal_deadline_at) acts.push("appeal");
      if (now > v.appeal_deadline_at || v.appeal_count >= 1) acts.push("finalize_ruling");
      break;
    case "APPEALED":
      acts.push("adjudicate");
      if (now > v.stall_deadline_at) acts.push("finalize_ruling");
      break;
    case "APPROVED":
      acts.push("settle");
      break;
    case "FINALIZED":
      if (v.resolved_action !== "MANUAL_REVIEW") {
        acts.push("settle");
      } else {
        if (party && now <= v.manual_deadline_at) {
          acts.push("propose_split");
          const proposer = (v.split_proposer ?? "").toLowerCase();
          if (v.split_proposed && proposer && proposer !== (address ?? "").toLowerCase()) {
            acts.push("accept_split");
          }
        }
        if (now > v.manual_deadline_at) acts.push("recover_escrow");
      }
      break;
    case "LAPSED":
      acts.push("recover_escrow");
      break;
    default:
      break;
  }
  return acts;
}

/**
 * Plain-language reason an act is not available right now, or null when it is.
 * Used for disabled buttons and empty states so the screen never just goes grey.
 */
export function whyNot(
  v: ActsView,
  address: string | null | undefined,
  nowMs: number,
  act: Act,
  fmt: (ms: number) => string = (ms) => new Date(ms).toISOString(),
): string | null {
  if (computeActs(v, address, nowMs).includes(act)) return null;
  const who = roleOf(v, address);
  const s = v.status;
  const needState: Partial<Record<Act, string[]>> = {
    update_draft: ["DRAFT"], fund_mandate: ["DRAFT"], accept_mandate: ["ESCROWED"],
    cancel_mandate: ["DRAFT", "ESCROWED"], submit_evidence: ["ENGAGED", "DELIVERED", "CONTESTED"],
    submit_deliverable: ["ENGAGED"], approve_work: ["DELIVERED"],
    claim_unreviewed_delivery: ["DELIVERED"], open_contest: ["DELIVERED"],
    respond_to_contest: ["CONTESTED"], seal_record: ["CONTESTED"],
    adjudicate: ["RECORD_SEALED", "APPEALED"], appeal: ["RULING"],
    finalize_ruling: ["RULING", "APPEALED"], settle: ["APPROVED", "FINALIZED"],
    propose_split: ["FINALIZED"], accept_split: ["FINALIZED"], lapse_mandate: ["ENGAGED"],
    recover_escrow: ["LAPSED", "FINALIZED", "RECORD_SEALED"],
  };
  const states = needState[act] ?? [];
  if (!states.includes(s)) {
    return `Not available while the mandate is ${s.replace("_", " ").toLowerCase()}.`;
  }
  const clientOnly: Act[] = ["update_draft", "fund_mandate", "cancel_mandate", "approve_work", "open_contest"];
  const operatorOnly: Act[] = ["accept_mandate", "submit_deliverable", "claim_unreviewed_delivery", "respond_to_contest"];
  if (clientOnly.includes(act) && who !== "client") return "Only the client of this mandate can do this.";
  if (operatorOnly.includes(act) && who !== "operator") return "Only the operator of this mandate can do this.";
  if (["submit_evidence", "appeal", "propose_split", "accept_split"].includes(act) && who === "keeper") {
    return "Only the client or the operator can do this.";
  }
  switch (act) {
    case "submit_evidence":
      return s === "DELIVERED" && who === "client"
        ? "The client can file evidence only after opening a contest."
        : s === "ENGAGED" && who === "client"
          ? "Only the operator files evidence while the work is in progress."
          : `The window for filing evidence closed at ${fmt(s === "ENGAGED" ? v.execution_deadline_at : v.review_deadline_at)}.`;
    case "submit_deliverable":
      return `The execution deadline passed at ${fmt(v.execution_deadline_at)}; the mandate can only lapse.`;
    case "open_contest":
      return `The review window closed at ${fmt(v.review_deadline_at)}.`;
    case "claim_unreviewed_delivery":
      return `The client's review window is open until ${fmt(v.review_deadline_at)}.`;
    case "lapse_mandate":
      return `The execution deadline is ${fmt(v.execution_deadline_at)}.`;
    case "respond_to_contest":
      return "The operator has already responded.";
    case "seal_record":
      return who === "keeper"
        ? `Anyone can seal after the response deadline (${fmt(v.response_deadline_at)}); until then only a party can, once the operator has responded.`
        : `Waiting for the operator's response, or until ${fmt(v.response_deadline_at)}.`;
    case "adjudicate":
      return null;
    case "appeal":
      return v.appeal_count >= 1
        ? "The single permitted appeal has been used."
        : `The appeal window closed at ${fmt(v.appeal_deadline_at)}.`;
    case "finalize_ruling":
      return s === "APPEALED"
        ? `The appeal round has until ${fmt(v.stall_deadline_at)} to rule before the first ruling stands.`
        : `The ruling can still be appealed until ${fmt(v.appeal_deadline_at)}.`;
    case "settle":
      return v.resolved_action === "MANUAL_REVIEW"
        ? "This ruling is in manual review: agree a split, or wait for escrow recovery."
        : "Nothing to settle yet.";
    case "propose_split":
      return v.resolved_action !== "MANUAL_REVIEW"
        ? "This ruling settles under its policy; no split is needed."
        : `The manual-review window closed at ${fmt(v.manual_deadline_at)}.`;
    case "accept_split":
      return !v.split_proposed
        ? "No split has been proposed yet."
        : "You cannot accept your own proposal, and the window must still be open.";
    case "recover_escrow":
      return s === "FINALIZED"
        ? v.resolved_action !== "MANUAL_REVIEW"
          ? "This ruling settles under its policy; use Settle."
          : `Recovery opens after ${fmt(v.manual_deadline_at)}.`
        : s === "RECORD_SEALED"
          ? `The panel has until ${fmt(v.stall_deadline_at)} before recovery opens.`
          : "Not available.";
    default:
      return "Not available right now.";
  }
}
