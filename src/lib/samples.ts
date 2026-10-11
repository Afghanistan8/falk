import type { Criterion, Policy, Windows } from "./protocol";

/**
 * Sample terms and the public evidence fixtures they pair with. These are
 * templates the user can load into the create form; nothing is seeded on-chain.
 */
export const FIXTURE_BASE = "https://raw.githubusercontent.com/Afghanistan8/falk/main/samples/fixtures/";

export interface SampleMandate {
  key: string;
  name: string;
  summary: string;
  title: string;
  description: string;
  criteria: Criterion[];
  evidenceRules: string;
  policy: Partial<Policy>;
  windowsMinutes: Record<keyof Windows, number>;
  payment: string;
  operatorBond: string;
  contestBond: string;
  fixtures: { name: string; criterion: string; role: string; note: string }[];
}

const c = (id: string, title: string, description: string, weight: number, extra: Partial<Criterion> = {}): Criterion => ({
  id, title, description, weight, non_negotiable: false, min_evidence: 1, independence: "ANY", ...extra,
});

export const SAMPLES: SampleMandate[] = [
  {
    key: "landscape",
    name: "Five-market landscape report",
    summary: "Three weighted criteria with one non-negotiable. The sample used by the live arc.",
    title: "Five-market landscape report",
    description:
      "Deliver a written landscape report covering five named European markets, with sourced figures and a one-page executive summary.",
    criteria: [
      c("C1", "Covers all five markets", "The report covers the Nordics, DACH, Benelux, Iberia and the Baltics.", 40, { non_negotiable: true }),
      c("C2", "Every figure cites a public source", "Each statistic in the report names a publicly retrievable source.", 35),
      c("C3", "Executive summary fits one page", "The executive summary is under one page (about 150 words).", 25),
    ],
    evidenceRules: "Public sources only; every document must be retrievable without a login.",
    policy: { PARTIAL: "PRORATA", REJECTED: "RETURN", INCONCLUSIVE: "MANUAL_REVIEW", LAPSE_BOND: "RETURN" },
    windowsMinutes: { execution: 4, review: 2, response: 1, appeal: 1, manual: 1 },
    payment: "2", operatorBond: "0.5", contestBond: "0.2",
    fixtures: [
      { name: "northwind-report.md", criterion: "C1", role: "SUPPORT", note: "Covers all five markets → PASS" },
      { name: "figures-sourced.md", criterion: "C2", role: "SUPPORT", note: "Every figure cited → PASS" },
      { name: "figures-unsourced.md", criterion: "C2", role: "SUPPORT", note: "No citations → FAIL (pro-rata path)" },
      { name: "exec-summary.md", criterion: "C3", role: "SUPPORT", note: "Short summary → PASS" },
      { name: "unrelated-note.md", criterion: "C1", role: "SUPPORT", note: "Irrelevant → cannot support PASS" },
      { name: "injection-attempt.md", criterion: "C1", role: "SUPPORT", note: "Embedded instruction → treated as data" },
    ],
  },
  {
    key: "independent",
    name: "Independent verification",
    summary: "A criterion that needs two distinct independent origins, demonstrating the independence rules.",
    title: "Published, independently verified dataset",
    description:
      "Publish a dataset on the operator's site and have its existence confirmed by at least two independent public records.",
    criteria: [
      c("D1", "Dataset is published", "The dataset is downloadable at the operator's published URL.", 30),
      c("D2", "Independently confirmed", "Two unrelated public sources confirm the dataset exists.", 70, {
        non_negotiable: true, min_evidence: 2, independence: "THIRD_PARTY",
      }),
    ],
    evidenceRules: "Independent sources must be on different sites from the operator and from each other.",
    policy: { PARTIAL: "PRORATA", REJECTED: "RETURN", INCONCLUSIVE: "SPLIT_EVEN", LAPSE_BOND: "FORFEIT" },
    windowsMinutes: { execution: 60, review: 30, response: 15, appeal: 15, manual: 30 },
    payment: "5", operatorBond: "1", contestBond: "0.5",
    fixtures: [],
  },
  {
    key: "sla",
    name: "Service-level attestation",
    summary: "A strict pass/fail SLA: any failure rejects, any doubt goes to manual review.",
    title: "Quarterly uptime attestation",
    description: "Provide a public status record showing at least 99.5% uptime for the quarter.",
    criteria: [
      c("S1", "Uptime at or above 99.5%", "The public status record shows uptime ≥ 99.5% for the whole quarter.", 100, { non_negotiable: true }),
    ],
    evidenceRules: "The status record must be on a domain the operator does not control, or carry a signed export.",
    policy: { PARTIAL: "RETURN", REJECTED: "RETURN", INCONCLUSIVE: "MANUAL_REVIEW", LAPSE_BOND: "RETURN" },
    windowsMinutes: { execution: 1440, review: 240, response: 120, appeal: 120, manual: 1440 },
    payment: "10", operatorBond: "2", contestBond: "1",
    fixtures: [],
  },
];
