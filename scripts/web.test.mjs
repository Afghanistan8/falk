// Web-side tests: the TypeScript act matrix must equal the Python original on
// every shared vector, and the pure presentation helpers must behave.
//
//   npm run test:web
//
// Node 24 strips TypeScript types natively, so src/lib/*.ts that avoid path
// aliases can be imported directly.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { computeActs, roleOf, whyNot } from "../src/lib/acts.ts";
import {
  commitmentOf,
  formatGen,
  humanizeRefusal,
  parseGen,
  sha256Hex,
} from "../src/lib/pure.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../tests/vectors/acts.json", import.meta.url), "utf8"),
);

test("act matrix equals the Python original on every shared vector", () => {
  const d = vectors.deadline;
  let checked = 0;
  for (const [status, who, now, responded, appeals, action, proposed, proposer, acts] of vectors.rows) {
    const view = {
      status,
      client: vectors.client,
      operator: vectors.operator,
      execution_deadline_at: d,
      review_deadline_at: d,
      response_deadline_at: d,
      stall_deadline_at: d,
      appeal_deadline_at: d,
      manual_deadline_at: d,
      appeal_count: appeals,
      operator_responded: responded,
      resolved_action: action,
      split_proposed: proposed,
      split_proposer: proposer,
    };
    assert.deepEqual(computeActs(view, who, now), acts, JSON.stringify({ status, who, now }));
    checked += 1;
  }
  assert.ok(checked > 3000, `only ${checked} vectors checked`);
});

test("roleOf is case-insensitive and defaults to keeper", () => {
  const v = { client: "0xAbC", operator: "0xDeF" };
  assert.equal(roleOf(v, "0xabc"), "client");
  assert.equal(roleOf(v, "0xDEF"), "operator");
  assert.equal(roleOf(v, "0x123"), "keeper");
  assert.equal(roleOf(v, null), "keeper");
});

const base = {
  status: "DELIVERED",
  client: "0xc",
  operator: "0xo",
  execution_deadline_at: 100,
  review_deadline_at: 100,
  response_deadline_at: 100,
  stall_deadline_at: 100,
  appeal_deadline_at: 100,
  manual_deadline_at: 100,
  appeal_count: 0,
  operator_responded: false,
  resolved_action: "",
  split_proposed: false,
  split_proposer: "",
};

test("whyNot is null for allowed acts and always explains refused ones", () => {
  assert.equal(whyNot(base, "0xc", 50, "approve_work"), null);
  const reason = whyNot(base, "0xo", 50, "approve_work");
  assert.match(reason, /Only the client/);
  assert.match(whyNot(base, "0xc", 500, "open_contest"), /review window closed/);
  assert.match(whyNot(base, "0xo", 50, "claim_unreviewed_delivery"), /review window is open/);
  assert.match(whyNot({ ...base, status: "SETTLED" }, "0xc", 0, "settle"), /settled/);
});

test("every act that computeActs withholds gets a non-empty reason", () => {
  const all = [
    "update_draft", "fund_mandate", "accept_mandate", "cancel_mandate", "submit_evidence",
    "submit_deliverable", "approve_work", "claim_unreviewed_delivery", "open_contest",
    "respond_to_contest", "seal_record", "adjudicate", "appeal", "finalize_ruling", "settle",
    "propose_split", "accept_split", "lapse_mandate", "recover_escrow",
  ];
  for (const status of ["DRAFT", "ENGAGED", "DELIVERED", "CONTESTED", "RULING", "FINALIZED", "SETTLED"]) {
    for (const who of ["0xc", "0xo", "0xk"]) {
      const view = { ...base, status };
      const allowed = new Set(computeActs(view, who, 50));
      for (const act of all) {
        const reason = whyNot(view, who, 50, act);
        if (allowed.has(act)) assert.equal(reason, null, `${status}/${who}/${act}`);
        else assert.ok(reason && reason.length > 5, `${status}/${who}/${act} has no reason`);
      }
    }
  }
});

test("sha256Hex matches the standard vector and commitmentOf strips like the contract", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(await commitmentOf("  hello\n"), await commitmentOf("hello"));
});

test("GEN formatting round-trips and refuses bad input", () => {
  assert.equal(formatGen("100000000000000000000"), "100");
  assert.equal(formatGen("1500000000000000000"), "1.5");
  assert.equal(formatGen("1"), "0.000000000000000001");
  assert.equal(parseGen("1.5"), 1500000000000000000n);
  assert.equal(parseGen("0"), 0n);
  assert.throws(() => parseGen("1.0000000000000000001"));
  assert.throws(() => parseGen("-1"));
  assert.throws(() => parseGen("abc"));
});

test("humanizeRefusal strips contract prefixes and maps known refusals", () => {
  assert.equal(humanizeRefusal("[EXPECTED] only the client of this mandate may do that"),
    "Only the client of this mandate may do that.");
  assert.match(humanizeRefusal("[EXPECTED] exact payment required: expected 5 wei, received 4"), /payment must be exactly/i);
  assert.match(humanizeRefusal("something unexpected"), /something unexpected/i);
  assert.ok(humanizeRefusal("").length > 0);
});
