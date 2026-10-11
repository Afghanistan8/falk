/** Types and vocabulary mirrored from contracts/falk.py (see docs/PROTOCOL.md). */

export type MandateStatus =
  | "DRAFT" | "ESCROWED" | "ENGAGED" | "DELIVERED" | "APPROVED" | "CONTESTED"
  | "RECORD_SEALED" | "RULING" | "APPEALED" | "FINALIZED" | "SETTLED"
  | "CANCELLED" | "LAPSED" | "RECOVERED";

export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";
export type RulingLabel = "CONFIRMED" | "PARTIAL" | "REJECTED" | "INCONCLUSIVE";
export type Action = "RELEASE_FULL" | "PRORATA" | "RETURN" | "SPLIT_EVEN" | "MANUAL_REVIEW";
export type OriginClass = "OPERATOR_HOSTED" | "CLIENT_HOSTED" | "THIRD_PARTY" | "PUBLIC_RECORD";
export type EvidenceRole = "DELIVERABLE" | "SUPPORT" | "COUNTER";
export type RetrievalLabel =
  | "SUCCESS_MATCH" | "CONTENT_MISMATCH" | "FETCH_FAIL" | "EMPTY" | "NON_SUCCESS_HTTP" | "BLOCKED";

export interface Criterion {
  id: string;
  title: string;
  description: string;
  weight: number;
  non_negotiable: boolean;
  min_evidence: number;
  independence: "ANY" | "THIRD_PARTY";
}

export interface Policy {
  version: string;
  CONFIRMED: "RELEASE_FULL";
  PARTIAL: "PRORATA" | "RETURN" | "MANUAL_REVIEW";
  REJECTED: "RETURN" | "MANUAL_REVIEW";
  INCONCLUSIVE: "MANUAL_REVIEW" | "RETURN" | "SPLIT_EVEN";
  LAPSE_BOND: "RETURN" | "FORFEIT";
}

export interface Windows {
  execution: number;
  review: number;
  response: number;
  appeal: number;
  manual: number;
}

export interface MandateView {
  mandate_id: string;
  client: string;
  operator: string;
  title: string;
  description: string;
  status: MandateStatus;
  terms_locked: boolean;
  terms_hash: string;
  evidence_rules: string;
  schemes: string;
  max_receipts: number;
  policy: Policy;
  payment_wei: string;
  payment_deposited: string;
  operator_bond_wei: string;
  operator_bond_deposited: string;
  contest_bond_wei: string;
  contest_bond_deposited: string;
  total_released: string;
  custody_held: string;
  execution_window_ms: number;
  review_window_ms: number;
  response_window_ms: number;
  appeal_window_ms: number;
  manual_window_ms: number;
  created_at_ms: number;
  funded_at_ms: number;
  engaged_at_ms: number;
  execution_deadline_at: number;
  delivered_at_ms: number;
  review_deadline_at: number;
  deliverable_url: string;
  approval_kind: "" | "CLIENT" | "UNREVIEWED";
  contested_at_ms: number;
  response_deadline_at: number;
  operator_responded: boolean;
  sealed_at_ms: number;
  sealed_count: number;
  snapshot_hash: string;
  stall_deadline_at: number;
  appeal_count: number;
  appeal_deadline_at: number;
  latest_ruling_id: number;
  final_ruling_id: number;
  resolved_action: "" | Action;
  finalized_at_ms: number;
  manual_deadline_at: number;
  split_proposed: boolean;
  split_proposer: string;
  split_pct: number;
  settled_at_ms: number;
  resolution: string;
}

export interface MandateRow {
  mandate_id: string;
  title: string;
  status: MandateStatus;
  client: string;
  operator: string;
  payment_wei: string;
  created_at_ms: number;
}

export interface MandatePage {
  total: number;
  offset: number;
  items: MandateRow[];
}

export interface Receipt {
  receipt_id: number;
  criterion_ids: string[];
  url: string;
  role: EvidenceRole;
  origin_class: OriginClass;
  content_commitment: string;
  media_type: string;
  publisher: string;
  note: string;
  submitter: string;
  submitter_role: "client" | "operator";
  submitted_at_ms: number;
}

export interface Contest {
  mandate_id: string;
  disputed: string[];
  claim: string;
  bond_wei: string;
  opened_at_ms: number;
  operator_responded: boolean;
  operator_response: string;
  responded_at_ms: number;
}

export interface Ruling {
  mandate_id: string;
  ruling_id: number;
  round_number: number;
  kind: "INITIAL" | "APPEAL";
  ruling: RulingLabel;
  score: number;
  critical_failed: boolean;
  results: { id: string; result: Verdict; reason: string }[];
  clamped: string[];
  support: Record<string, { matches: number; independent_origins: number }>;
  retrievals: Record<string, RetrievalLabel>;
  quality: string;
  flags: string[];
  reasoning: string;
  fingerprint: string;
  evaluated_at_ms: number;
}

export interface Settlement {
  mandate_id: string;
  path: string;
  action: string;
  ruling_id: number;
  score: number;
  operator_payout: string;
  client_payout: string;
  custody_before: string;
  custody_after: string;
  settled_at_ms: number;
}

export interface Passport {
  operator: string;
  closed: number;
  clean_approvals: number;
  unreviewed_claims: number;
  confirmed: number;
  partial: number;
  rejected: number;
  inconclusive: number;
  contests_faced: number;
  appeals_filed: number;
  critical_fails: number;
  lapses: number;
  scored: number;
  score_sum: number;
  value_verified_wei: string;
  derived: {
    average_score: number | null;
    contest_rate_pct: number | null;
    clean_rate_pct: number | null;
  };
}

export interface ProtocolInfo {
  name: string;
  revision: string;
  policy_version: string;
  public_write_methods: number;
  public_read_methods: number;
  mandate_count: number;
  weight_total: number;
  max_criteria: number;
  hard_max_receipts: number;
  stall_grace_ms: number;
  inconclusive_weight_limit: number;
  states: MandateStatus[];
  retrieval_labels: RetrievalLabel[];
  policy_options: Record<RulingLabel, Action[]>;
  has_owner: boolean;
  has_clock_method: boolean;
}

export const TERMINAL_STATES: MandateStatus[] = ["SETTLED", "CANCELLED", "RECOVERED"];
export const WEIGHT_TOTAL = 100;
