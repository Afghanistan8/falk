#!/usr/bin/env node
/**
 * Live arc: drives the deployment of record through every path, on StudioNet,
 * with real signed transactions, real validator retrieval and a real panel.
 *
 *   node scripts/arc.mjs                     # all scenarios
 *   node scripts/arc.mjs --only A,B,H        # a subset
 *   node scripts/arc.mjs --skip F            # all but one
 *
 * Accounts: each scenario derives its own client / operator / keeper keys from
 * a local seed in .arc/seed (gitignored, never printed) so scenarios can run in
 * parallel without sharing a nonce. They are funded from the active `genlayer`
 * CLI account (the unlocked deployer) in small amounts.
 *
 * Output: deployments/arc-studionet.json (machine record) and docs/LIVE_PROOF.md
 * (explorer-linked table). Nothing is written unless the run completes; every
 * check is recorded and the exit code is non-zero if any check fails.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

import { commitmentOf, loadDeployment, returnedValue, rollbackReason, rpc, sleep, ROOT } from "./lib/chain.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const only = flag("--only")?.split(",");
const skip = flag("--skip")?.split(",") ?? [];

const dep = await loadDeployment();
const ADDRESS = dep.contract.address;
const EXPLORER = dep.explorerUrl;
const RAW = "https://raw.githubusercontent.com/Afghanistan8/falk/main/samples/fixtures/";
const GEN = 10n ** 18n;
const PAYMENT = 2n * GEN;
const OP_BOND = GEN / 2n;
const CT_BOND = GEN / 5n;
const WINDOWS = { execution: 240_000, review: 90_000, response: 60_000, appeal: 60_000, manual: 60_000 };
const CRITERIA = [
  { id: "C1", title: "Covers all five markets", description: "The report covers the Nordics, DACH, Benelux, Iberia and the Baltics.", weight: 40, non_negotiable: true },
  { id: "C2", title: "Every figure cites a public source", description: "Each statistic in the report names a publicly retrievable source.", weight: 35 },
  { id: "C3", title: "Executive summary fits one page", description: "The executive summary is under one page (about 150 words).", weight: 25 },
];
const WEIGHT = Object.fromEntries(CRITERIA.map((c) => [c.id, c.weight]));

// ---------------------------------------------------------------- accounts
mkdirSync(new URL(".arc/", ROOT), { recursive: true });
const seedPath = new URL(".arc/seed", ROOT);
if (!existsSync(seedPath)) writeFileSync(seedPath, randomBytes(32).toString("hex"));
// A per-run salt gives every run fresh accounts, so passports start empty and counts are exact.
const SEED = `${readFileSync(seedPath, "utf8").trim()}:${randomBytes(6).toString("hex")}`;

function actor(scenario, role) {
  const key = `0x${createHash("sha256").update(`${SEED}:${scenario}:${role}`).digest("hex")}`;
  const account = createAccount(key);
  return {
    role,
    address: account.address,
    client: createClient({ chain: studionet, endpoint: dep.rpcUrl, account }),
  };
}

const reader = createClient({ chain: studionet, endpoint: dep.rpcUrl });
async function retry(fn, tries = 6) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await sleep(2000 * (i + 1));
    }
  }
  throw last;
}
const read = (functionName, fnArgs = []) =>
  retry(() => reader.readContract({ address: ADDRESS, functionName, args: fnArgs, stateStatus: "accepted" }));
const balanceOf = async (address) => BigInt(await rpc(dep.rpcUrl, "eth_getBalance", [address, "latest"]));
const gen = (wei) => `${Number(wei) / 1e18}`;

let fundQueue = Promise.resolve();
function ensureFunds(address, minimum, topUp) {
  // CLI transfers are serialised: they all spend from the same deployer nonce.
  fundQueue = fundQueue.then(async () => {
    if ((await balanceOf(address)) >= minimum) return;
    const r = spawnSync("genlayer", ["account", "send", address, `${topUp}gen`], { shell: true, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`funding ${address} failed: ${(r.stderr || r.stdout).slice(-300)}`);
  });
  return fundQueue;
}

// ------------------------------------------------------------------ record
const checks = [];
const scenarios = [];

class Ctx {
  constructor(code, title) {
    this.code = code;
    this.title = title;
    this.steps = [];
    this.walls = [];
    this.client = actor(code, "client");
    this.operator = actor(code, "operator");
    this.keeper = actor(code, "keeper");
    this.path = "";
  }

  log(...m) {
    console.log(`[${this.code}]`, ...m);
  }

  check(label, ok, detail = "") {
    checks.push({ scenario: this.code, label, ok: Boolean(ok), detail: String(detail) });
    this.log(ok ? "ok  " : "FAIL", label, ok ? "" : detail);
    return ok;
  }

  async tx(who, functionName, fnArgs, { value = 0n, wait = "ACCEPTED", expectRefusal = null, label = null } = {}) {
    const t0 = Date.now();
    let hash;
    try {
      hash = await who.client.writeContract({
        address: ADDRESS,
        functionName,
        args: fnArgs,
        ...(value > 0n ? { value } : {}),
      });
    } catch (error) {
      const text = String(error?.message ?? error);
      if (expectRefusal) return this.refusal(functionName, label, null, text, expectRefusal);
      throw new Error(`${functionName} was not submitted: ${text.slice(0, 400)}`);
    }
    const receipt = await retry(() => who.client.waitForTransactionReceipt({
      hash,
      status: wait,
      retries: wait === "FINALIZED" ? 200 : 100,
      interval: 3000,
    }));
    const reason = rollbackReason(receipt);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (expectRefusal) return this.refusal(functionName, label, hash, reason ?? "", expectRefusal);
    if (reason) throw new Error(`${functionName} was refused: ${reason}`);
    this.steps.push({ fn: functionName, by: who.role, hash, wait, seconds, note: label ?? "" });
    this.log(`${functionName.padEnd(26)} ${who.role.padEnd(8)} ${seconds}s ${hash.slice(0, 12)}…`);
    return { hash, receipt, returned: returnedValue(receipt) };
  }

  refusal(functionName, label, hash, text, expected) {
    const clean = String(text).replace(/^.*?\[(EXPECTED|EXTERNAL|TRANSIENT|PANEL_ERROR)\]\s*/s, "").trim();
    const ok = expected instanceof RegExp ? expected.test(clean) || expected.test(text) : Boolean(clean);
    this.walls.push({ label: label ?? functionName, fn: functionName, hash, refusal: clean.slice(0, 220), ok });
    this.check(`refused: ${label ?? functionName}`, ok, clean.slice(0, 160) || "no refusal text (the transaction was not refused)");
    return { refused: true, text: clean };
  }
}

// -------------------------------------------------------------- fixtures
const docs = {};
async function fixture(name) {
  if (!docs[name]) {
    const url = `${RAW}${name}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fixture ${url} returned ${response.status}`);
    const body = await response.text();
    docs[name] = { url, commitment: commitmentOf(body) };
  }
  return docs[name];
}

async function evidence(ctx, id, criterion, name, { origin = "OPERATOR_HOSTED", role = "SUPPORT", by = ctx.operator, commitment = null, suffix = "" } = {}) {
  const f = await fixture(name);
  return ctx.tx(by, "submit_evidence", [id, JSON.stringify([criterion]), `${f.url}${suffix}`, role, commitment ?? f.commitment, origin, "text/markdown", "falk-fixtures", `${name} for ${criterion}`], { label: `${criterion} ← ${name}` });
}

// ------------------------------------------------------------- building blocks
async function setup(ctx) {
  for (const a of [ctx.client, ctx.operator, ctx.keeper]) {
    const need = a.role === "client" ? 6n * GEN : a.role === "operator" ? 3n * GEN : GEN;
    await ensureFunds(a.address, need / 2n, Number(need / GEN));
  }
  ctx.start = {
    client: await balanceOf(ctx.client.address),
    operator: await balanceOf(ctx.operator.address),
    keeper: await balanceOf(ctx.keeper.address),
  };
}

async function create(ctx, over = {}) {
  const r = await ctx.tx(ctx.client, "create_mandate", [
    ctx.operator.address,
    `Five-market landscape report (${ctx.code})`,
    "Deliver a written landscape report covering five named European markets, with sourced figures and a one-page executive summary.",
    JSON.stringify(CRITERIA),
    String(PAYMENT), String(OP_BOND), String(CT_BOND),
    "Public sources only; every document must be retrievable without a login.",
    JSON.stringify(over.policy ?? {}),
    JSON.stringify({ ...WINDOWS, ...(over.windows ?? {}) }),
    "https", 12,
  ]);
  const id = typeof r.returned === "string" ? r.returned : null;
  if (!id) throw new Error("create_mandate did not return an id");
  return id;
}

const fund = (ctx, id) => ctx.tx(ctx.client, "fund_mandate", [id], { value: PAYMENT });
const accept = (ctx, id) => ctx.tx(ctx.operator, "accept_mandate", [id], { value: OP_BOND });

async function deliver(ctx, id, { c2 = "figures-sourced.md" } = {}) {
  await evidence(ctx, id, "C1", "northwind-report.md");
  await evidence(ctx, id, "C2", c2);
  await evidence(ctx, id, "C3", "exec-summary.md");
  const f = await fixture("northwind-report.md");
  await ctx.tx(ctx.operator, "submit_deliverable", [id, `${f.url}?doc=deliverable`, f.commitment]);
}

async function contest(ctx, id, claim = "Several figures in the report carry no source.") {
  await ctx.tx(ctx.client, "open_contest", [id, JSON.stringify(["C2"]), claim], { value: CT_BOND });
  await ctx.tx(ctx.operator, "respond_to_contest", [id, "Every figure is listed with its source in the statistics annex."]);
  await ctx.tx(ctx.operator, "seal_record", [id]);
}

async function untilMs(ms, label) {
  const wait = ms - Date.now() + 4000;
  if (wait > 0) await sleep(wait);
  return label;
}


function deriveRuling(results) {
  const by = Object.fromEntries(results.map((r) => [r.id, r.result]));
  let score = 0, incon = 0, fail = false, nnIncon = false, anyFail = false, anyInc = false;
  for (const c of CRITERIA) {
    const v = by[c.id] ?? "INCONCLUSIVE";
    if (v === "PASS") score += c.weight;
    else if (v === "FAIL") { anyFail = true; fail ||= Boolean(c.non_negotiable); }
    else { anyInc = true; incon += c.weight; nnIncon ||= Boolean(c.non_negotiable); }
  }
  const ruling = fail ? "REJECTED" : !anyFail && !anyInc ? "CONFIRMED" : nnIncon || incon >= 50 ? "INCONCLUSIVE" : score === 0 ? "REJECTED" : "PARTIAL";
  return { score, ruling };
}

function expectedSplit(action, score, C) {
  const P = PAYMENT, B = OP_BOND;
  switch (action) {
    case "RELEASE_FULL": return { operator: P + B, client: C };
    case "PRORATA": { const s = (P * BigInt(score)) / 100n; return { operator: s + B, client: P - s + C }; }
    case "RETURN": return { operator: B, client: P + C };
    case "SPLIT_EVEN": return { operator: P / 2n + B, client: P - P / 2n + C };
    default: return null;
  }
}

async function settleAndReconcile(ctx, id, { by = ctx.keeper, expectAction = null } = {}) {
  const before = { client: await balanceOf(ctx.client.address), operator: await balanceOf(ctx.operator.address) };
  await ctx.tx(by, "settle", [id], { wait: "FINALIZED" });
  const s = await read("get_settlement", [id]);
  const m = await read("get_mandate", [id]);
  ctx.check("mandate is SETTLED with custody 0", m.status === "SETTLED" && m.custody_held === "0", `${m.status} held=${m.custody_held}`);
  ctx.check("settlement record balances", BigInt(s.operator_payout) + BigInt(s.client_payout) === BigInt(s.custody_before) && s.custody_after === "0",
    `${s.operator_payout}+${s.client_payout} vs ${s.custody_before}`);
  if (expectAction) ctx.check(`settlement action is ${expectAction}`, s.action === expectAction, s.action);
  const exp = expectedSplit(s.action, s.score, BigInt(m.contest_bond_deposited));
  if (exp) {
    ctx.check("operator payout equals contract arithmetic over the frozen score",
      BigInt(s.operator_payout) === exp.operator && BigInt(s.client_payout) === exp.client,
      `got ${s.operator_payout}/${s.client_payout}, want ${exp.operator}/${exp.client}`);
  }
  // The emitted transfers land on finalization; poll the real balances.
  let landed = false;
  for (let i = 0; i < 40 && !landed; i += 1) {
    const now = { client: await balanceOf(ctx.client.address), operator: await balanceOf(ctx.operator.address) };
    landed = now.operator - before.operator >= BigInt(s.operator_payout) * 99n / 100n && now.client - before.client >= BigInt(s.client_payout) * 99n / 100n;
    if (!landed) await sleep(3000);
  }
  ctx.check("emitted transfers reached both parties' balances", landed, "balances did not move by the settled amounts");
  ctx.settlement = s;
  return s;
}

async function adjudicate(ctx, id, by = ctx.keeper) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await ctx.tx(by, "adjudicate", [id], { label: attempt > 1 ? `retry ${attempt}` : "" });
      break;
    } catch (error) {
      ctx.log(`adjudicate attempt ${attempt} failed (${String(error.message).slice(0, 120)}); state unchanged, retrying`);
      const m = await read("get_mandate", [id]);
      if (!["RECORD_SEALED", "APPEALED"].includes(m.status)) break;
      if (attempt >= 4) throw error;
      await sleep(5000);
    }
  }
  const rulings = await read("list_rulings", [id]);
  const r = rulings[rulings.length - 1];
  const d = deriveRuling(r.results);
  ctx.check("ruling score/ruling equal the contract derivation from the verdicts", r.score === d.score && r.ruling === d.ruling, `stored ${r.ruling}/${r.score} derived ${d.ruling}/${d.score}`);
  ctx.log(`ruling #${r.ruling_id}: ${r.ruling} score ${r.score}`, JSON.stringify(r.results.map((x) => `${x.id}:${x.result}`)), `retrievals ${JSON.stringify(r.retrievals)}`);
  return r;
}

// ------------------------------------------------------------------ scenarios
const SCENARIOS = {
  async A(ctx) {
    ctx.path = "create → fund → accept → evidence → deliver → approve → settle";
    const id = await create(ctx);
    await fund(ctx, id);
    await ctx.tx(ctx.stranger ?? ctx.keeper, "update_draft", [id, ctx.operator.address, "x", "x", JSON.stringify(CRITERIA), "1", "0", "0", "", "{}", JSON.stringify(WINDOWS), "https", 12], { expectRefusal: /needs DRAFT|only the client/, label: "update_draft after funding" });
    await ctx.tx(ctx.keeper, "accept_mandate", [id], { value: OP_BOND, expectRefusal: /only the operator/, label: "accept_mandate by a stranger" });
    await ctx.tx(ctx.operator, "accept_mandate", [id], { value: OP_BOND - 1n, expectRefusal: /exact performance bond/, label: "accept_mandate with a short bond" });
    await accept(ctx, id);
    await ctx.tx(ctx.operator, "submit_evidence", [id, '["C1"]', `${RAW}northwind-report.md`, "SUPPORT", "", "OPERATOR_HOSTED", "text/markdown", "x", "x"], { expectRefusal: /content commitment is required/, label: "evidence without a content commitment" });
    await ctx.tx(ctx.keeper, "recover_escrow", [id], { expectRefusal: /needs LAPSED|FINALIZED|RECORD_SEALED/, label: "recover_escrow while engaged" });
    await deliver(ctx, id);
    await ctx.tx(ctx.operator, "approve_work", [id], { expectRefusal: /only the client/, label: "approve_work by the operator" });
    await ctx.tx(ctx.client, "approve_work", [id]);
    const s = await settleAndReconcile(ctx, id, { expectAction: "RELEASE_FULL" });
    await ctx.tx(ctx.keeper, "settle", [id], { expectRefusal: /needs APPROVED or FINALIZED|already closed/, label: "settle twice" });
    ctx.mandate = id;
    ctx.outcome = `RELEASE_FULL · operator ${gen(BigInt(s.operator_payout))} GEN`;
  },

  async B(ctx) {
    ctx.path = "contest → seal → live panel → finalize → settle (prorata)";
    const id = await create(ctx);
    await fund(ctx, id);
    await accept(ctx, id);
    await deliver(ctx, id, { c2: "figures-unsourced.md" });
    await contest(ctx, id);
    const r = await adjudicate(ctx, id);
    await ctx.tx(ctx.keeper, "settle", [id], { expectRefusal: /needs APPROVED or FINALIZED/, label: "settle before finalize" });
    await untilMs(Date.now() + WINDOWS.appeal, "appeal window");
    await ctx.tx(ctx.keeper, "finalize_ruling", [id]);
    const m = await read("get_mandate", [id]);
    if (m.resolved_action === "MANUAL_REVIEW") {
      ctx.log("panel returned INCONCLUSIVE; recovering via the manual-review exit");
      await untilMs(Number(m.manual_deadline_at) + 1000, "manual window");
      await ctx.tx(ctx.keeper, "recover_escrow", [id], { wait: "FINALIZED" });
      ctx.outcome = `INCONCLUSIVE → manual-review recovery`;
    } else {
      const s = await settleAndReconcile(ctx, id);
      ctx.outcome = `${r.ruling} ${r.score}/100 → ${s.action} · operator ${gen(BigInt(s.operator_payout))} GEN`;
    }
    ctx.mandate = id;
  },

  async C(ctx) {
    ctx.path = "content mismatch → no PASS → manual review → recovery";
    const id = await create(ctx);
    await fund(ctx, id);
    await accept(ctx, id);
    const wrong = commitmentOf("a document that is not the one served at the URL");
    await evidence(ctx, id, "C1", "northwind-report.md", { commitment: wrong });
    await evidence(ctx, id, "C2", "figures-sourced.md", { commitment: wrong });
    await evidence(ctx, id, "C3", "exec-summary.md", { commitment: wrong });
    const f = await fixture("northwind-report.md");
    await ctx.tx(ctx.operator, "submit_deliverable", [id, `${f.url}?doc=deliverable`, wrong]);
    await contest(ctx, id, "The evidence does not demonstrate any criterion.");
    const r = await adjudicate(ctx, id);
    ctx.check("every retrieval was classified CONTENT_MISMATCH", Object.values(r.retrievals).every((x) => x === "CONTENT_MISMATCH"), JSON.stringify(r.retrievals));
    ctx.check("no criterion passed on mismatched content", r.results.every((x) => x.result !== "PASS"), JSON.stringify(r.results));
    await untilMs(Date.now() + WINDOWS.appeal, "appeal window");
    await ctx.tx(ctx.keeper, "finalize_ruling", [id]);
    const m = await read("get_mandate", [id]);
    if (m.resolved_action === "MANUAL_REVIEW") {
      await ctx.tx(ctx.keeper, "recover_escrow", [id], { expectRefusal: /manual-review window is still open/, label: "recover_escrow inside the manual window" });
      await untilMs(Number(m.manual_deadline_at) + 1000, "manual window");
      const before = { c: await balanceOf(ctx.client.address), o: await balanceOf(ctx.operator.address) };
      await ctx.tx(ctx.keeper, "recover_escrow", [id], { wait: "FINALIZED" });
      const s = await read("get_settlement", [id]);
      ctx.check("recovery returns each party their own deposit", BigInt(s.client_payout) === PAYMENT + CT_BOND && BigInt(s.operator_payout) === OP_BOND, `${s.client_payout}/${s.operator_payout}`);
      ctx.outcome = `INCONCLUSIVE → recovered · client ${gen(BigInt(s.client_payout))} / operator ${gen(BigInt(s.operator_payout))} GEN`;
      void before;
    } else {
      const s = await settleAndReconcile(ctx, id);
      ctx.outcome = `${r.ruling} → ${s.action}`;
    }
    ctx.mandate = id;
  },

  async D(ctx) {
    ctx.path = "fund → cancel";
    const id = await create(ctx);
    const before = await balanceOf(ctx.client.address);
    await fund(ctx, id);
    await ctx.tx(ctx.operator, "cancel_mandate", [id], { expectRefusal: /only the client/, label: "cancel_mandate by the operator" });
    await ctx.tx(ctx.client, "cancel_mandate", [id], { wait: "FINALIZED" });
    const m = await read("get_mandate", [id]);
    ctx.check("cancelled with custody 0", m.status === "CANCELLED" && m.custody_held === "0", `${m.status}/${m.custody_held}`);
    let back = false;
    for (let i = 0; i < 30 && !back; i += 1) {
      back = (await balanceOf(ctx.client.address)) >= before - GEN / 100n;
      if (!back) await sleep(3000);
    }
    ctx.check("payment returned to the client", back, "client balance did not recover the payment");
    ctx.mandate = id;
    ctx.outcome = "CANCELLED · payment returned";
  },

  async E(ctx) {
    ctx.path = "accept → miss execution deadline → lapse → recover";
    const id = await create(ctx, { windows: { execution: 60_000 } });
    await fund(ctx, id);
    await accept(ctx, id);
    await ctx.tx(ctx.keeper, "lapse_mandate", [id], { expectRefusal: /deadline has not passed/, label: "lapse before the deadline" });
    const m = await read("get_mandate", [id]);
    await untilMs(Number(m.execution_deadline_at) + 1000, "execution deadline");
    await ctx.tx(ctx.keeper, "lapse_mandate", [id]);
    await ctx.tx(ctx.keeper, "recover_escrow", [id], { wait: "FINALIZED" });
    const s = await read("get_settlement", [id]);
    ctx.check("lapse returns payment to client and bond to operator", BigInt(s.client_payout) === PAYMENT && BigInt(s.operator_payout) === OP_BOND, `${s.client_payout}/${s.operator_payout}`);
    const p = await read("get_passport", [ctx.operator.address]);
    ctx.check("operator passport counts the lapse", p.lapses === 1, JSON.stringify(p));
    ctx.mandate = id;
    ctx.outcome = "LAPSED → recovered · bond returned";
  },

  async F(ctx) {
    ctx.path = "ruling → appeal → second round → finalize → settle";
    const id = await create(ctx, { windows: { appeal: 300_000 } });
    await fund(ctx, id);
    await accept(ctx, id);
    await deliver(ctx, id, { c2: "figures-unsourced.md" });
    await contest(ctx, id);
    const first = await adjudicate(ctx, id);
    await ctx.tx(ctx.client, "appeal", [id]);
    await ctx.tx(ctx.keeper, "recover_escrow", [id], { expectRefusal: /needs LAPSED|FINALIZED|RECORD_SEALED/, label: "recover_escrow during an appeal" });
    await ctx.tx(ctx.operator, "appeal", [id], { expectRefusal: /needs RULING/, label: "second appeal" });
    const second = await adjudicate(ctx, id);
    const all = await read("list_rulings", [id]);
    ctx.check("both rulings are preserved, in order", all.length === 2 && all[0].kind === "INITIAL" && all[1].kind === "APPEAL", JSON.stringify(all.map((x) => x.kind)));
    await ctx.tx(ctx.keeper, "finalize_ruling", [id]);
    const m = await read("get_mandate", [id]);
    ctx.check("finalization pins the appeal ruling", m.final_ruling_id === 2, String(m.final_ruling_id));
    if (m.resolved_action === "MANUAL_REVIEW") {
      ctx.outcome = `appealed: ${first.ruling} → ${second.ruling} (manual review)`;
    } else {
      const s = await settleAndReconcile(ctx, id);
      ctx.outcome = `appealed: ${first.ruling}/${first.score} → ${second.ruling}/${second.score} → ${s.action}`;
    }
    ctx.mandate = id;
  },

  async G(ctx) {
    ctx.path = "silent client → claim_unreviewed_delivery → settle";
    const id = await create(ctx, { windows: { review: 60_000 } });
    await fund(ctx, id);
    await accept(ctx, id);
    await deliver(ctx, id);
    await ctx.tx(ctx.operator, "claim_unreviewed_delivery", [id], { expectRefusal: /review window is still open/, label: "claim inside the review window" });
    const m = await read("get_mandate", [id]);
    await untilMs(Number(m.review_deadline_at) + 1000, "review window");
    await ctx.tx(ctx.client, "open_contest", [id, '["C2"]', "Late contest."], { value: CT_BOND, expectRefusal: /review window has closed/, label: "contest after the review window" });
    await ctx.tx(ctx.operator, "claim_unreviewed_delivery", [id]);
    const s = await settleAndReconcile(ctx, id, { by: ctx.operator, expectAction: "RELEASE_FULL" });
    const p = await read("get_passport", [ctx.operator.address]);
    ctx.check("passport records an unreviewed claim", p.unreviewed_claims === 1 && p.closed === 1, JSON.stringify(p));
    ctx.mandate = id;
    ctx.outcome = `RELEASE_FULL (unreviewed) · operator ${gen(BigInt(s.operator_payout))} GEN`;
  },

  async H(ctx) {
    ctx.path = "refusal walls on a funded mandate";
    const id = await create(ctx);
    await ctx.tx(ctx.keeper, "fund_mandate", [id], { value: PAYMENT, expectRefusal: /only the client/, label: "fund_mandate by a stranger" });
    await ctx.tx(ctx.client, "fund_mandate", [id], { value: PAYMENT - 1n, expectRefusal: /exact payment required/, label: "fund_mandate with a short payment" });
    await fund(ctx, id);
    await ctx.tx(ctx.client, "fund_mandate", [id], { value: PAYMENT, expectRefusal: /needs DRAFT/, label: "fund_mandate twice" });
    await ctx.tx(ctx.client, "approve_work", [id], { expectRefusal: /needs DELIVERED/, label: "approve_work before delivery" });
    await ctx.tx(ctx.keeper, "adjudicate", [id], { expectRefusal: /needs RECORD_SEALED/, label: "adjudicate before any seal" });
    await ctx.tx(ctx.keeper, "settle", [id], { expectRefusal: /needs APPROVED or FINALIZED/, label: "settle an unfinished mandate" });
    await ctx.tx(ctx.client, "cancel_mandate", [id]);
    ctx.mandate = id;
    ctx.outcome = "all walls held · cancelled cleanly";
  },
};

// ---------------------------------------------------------------------- run
const selected = Object.keys(SCENARIOS).filter((c) => (!only || only.includes(c)) && !skip.includes(c));
const TITLES = { A: "Approve path", B: "Contested → pro-rata", C: "Content mismatch → recovery", D: "Cancel before engagement", E: "Lapse → recovery", F: "Appeal", G: "Unreviewed delivery", H: "Refusal walls" };

console.log(`Falk arc on ${dep.chainName} · contract ${ADDRESS} · scenarios ${selected.join(", ")}`);
const info = await read("get_protocol_info");
if (info.revision !== dep.contract.version) throw new Error(`contract reports ${info.revision}, manifest says ${dep.contract.version}`);

const started = Date.now();
const results = await Promise.allSettled(
  selected.map(async (code) => {
    const ctx = new Ctx(code, TITLES[code]);
    scenarios.push(ctx);
    try {
      await setup(ctx);
      await SCENARIOS[code](ctx);
      ctx.status = "complete";
    } catch (error) {
      ctx.status = "error";
      ctx.error = String(error?.message ?? error).slice(0, 600);
      ctx.log("ERROR", ctx.error);
    }
    ctx.end = {
      client: await balanceOf(ctx.client.address),
      operator: await balanceOf(ctx.operator.address),
    };
  }),
);
void results;

const failed = checks.filter((c) => !c.ok);
const errors = scenarios.filter((s) => s.status !== "complete");
const record = {
  network: dep.chainName,
  chainId: dep.chainId,
  contract: ADDRESS,
  revision: info.revision,
  ranAt: new Date().toISOString(),
  seconds: Math.round((Date.now() - started) / 1000),
  checks: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
  scenarios: scenarios.sort((a, b) => a.code.localeCompare(b.code)).map((s) => ({
    code: s.code, title: s.title, path: s.path, status: s.status, error: s.error ?? null,
    mandate: s.mandate ?? null, outcome: s.outcome ?? null,
    actors: { client: s.client.address, operator: s.operator.address, keeper: s.keeper.address },
    steps: s.steps, walls: s.walls,
  })),
  failedChecks: failed,
};

const complete = failed.length === 0 && errors.length === 0 && !only && skip.length === 0;
if (complete) {
  writeFileSync(new URL("deployments/arc-studionet.json", ROOT), `${JSON.stringify(record, null, 2)}\n`);
  const link = (h) => `[\`${h.slice(0, 10)}…\`](${EXPLORER}/tx/${h})`;
  const lines = [
    "# Live proof",
    "",
    `Generated by \`node scripts/arc.mjs\` against \`${ADDRESS}\` (${record.revision}) on ${record.network} (chain ${record.chainId}) at ${record.ranAt}.`,
    `${record.checks.passed}/${record.checks.total} checks passed. Every hash below is a real StudioNet transaction.`,
    "",
  ];
  for (const s of record.scenarios) {
    lines.push(`## ${s.code} · ${s.title}`, "", `**Path:** ${s.path}`, `**Mandate:** \`${s.mandate}\``, `**Outcome:** ${s.outcome}`, "");
    lines.push("| Step | Caller | Transaction |", "| --- | --- | --- |");
    for (const t of s.steps) lines.push(`| \`${t.fn}\`${t.note ? ` — ${t.note}` : ""} | ${t.by} | ${link(t.hash)} |`);
    if (s.walls.length) {
      lines.push("", "Refusals (the transaction is accepted by the chain and the contract rolls it back; nothing moves):", "", "| Attempt | Contract's answer | Transaction |", "| --- | --- | --- |");
      for (const w of s.walls) lines.push(`| ${w.label} | ${w.refusal.replace(/\|/g, "/")} | ${w.hash ? link(w.hash) : "rejected at submission"} |`);
    }
    lines.push("");
  }
  writeFileSync(new URL("docs/LIVE_PROOF.md", ROOT), `${lines.join("\n")}\n`);
  console.log("wrote deployments/arc-studionet.json and docs/LIVE_PROOF.md");
} else {
  writeFileSync(new URL(".arc/last-run.json", ROOT), `${JSON.stringify(record, null, 2)}\n`);
  console.log("partial or failing run: wrote .arc/last-run.json only");
}

console.log(`\n${record.checks.passed}/${record.checks.total} checks passed in ${record.seconds}s; ${errors.length} scenario error(s)`);
for (const f of failed) console.log(`  FAIL [${f.scenario}] ${f.label}: ${f.detail}`);
for (const e of errors) console.log(`  ERROR [${e.code}] ${e.error}`);
process.exit(failed.length || errors.length ? 1 : 0);
