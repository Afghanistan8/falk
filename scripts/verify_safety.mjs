#!/usr/bin/env node
/**
 * Keyless safety verification of what is ACTUALLY deployed. It reads the source
 * and ABI back from the chain (not from this repository) and checks the
 * remediations that matter for a custody contract:
 *
 *   npm run verify:safety                 # the deployment of record, from the chain
 *   node scripts/verify_safety.mjs --source contracts/falk.py   # a local file
 *
 *   S1  no public method is a clock: no tick / advance / wait / sleep / set-time,
 *       and no public method takes a time, deadline, recipient or amount
 *   S2  no owner / admin / pause / upgrade / withdraw surface, ABI or storage
 *   S3  time has exactly one source: the consensus transaction datetime
 *   S4  value has exactly one exit: one emit_transfer, inside _send, which is
 *       called only from _close, which is called only from terminal paths
 *   S5  silent clients are closed: claim_unreviewed_delivery exists and is gated
 *       on the review deadline; a contest is refused after it
 *   S6  recovery is gated: recover_escrow accepts only LAPSED / FINALIZED /
 *       RECORD_SEALED, each with its own deadline gate, never RULING / APPEALED
 *   S7  evidence is bound by sha256: a commitment is mandatory at filing,
 *       re-checked at retrieval, and a mismatch carries no text
 *   S8  settlement conserves custody and is single-shot
 *
 * scripts/safety.test.mjs proves the checks are not vacuous by running them
 * against deliberately broken copies of the contract.
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { getOnchainSource, loadDeployment, normalizeSource, rpc } from "./lib/chain.mjs";

const CLOCK_NAME = /(tick|advance|clock|wait|sleep|warp|set_time|timestamp|now)/i;
const CLOCK_PARAM = /^(now|now_ms|time|timestamp|deadline|recipient|to|amount|payee|destination|payout|fee)$/i;
const AUTH = /(owner|admin|pause|upgrade|withdraw|sweep|rescue|drain|selfdestruct|set_fee)/i;

/** Public methods and their parameter names, read from the source text (the local-file fallback). */
export function methodsFromSource(src) {
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*@gl\.public\.(write|view)/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^\s*def \w+\(/.test(lines[j])) j += 1;
    const header = [];
    while (j < lines.length) {
      header.push(lines[j]);
      if (lines[j].includes(")") && /\)\s*(->.*)?:\s*$/.test(lines[j])) break;
      j += 1;
    }
    const text = header.join(" ");
    const name = text.match(/def (\w+)\(/)[1];
    const params = text
      .slice(text.indexOf("(") + 1, text.lastIndexOf(")"))
      .split(",")
      .map((p) => p.trim().split(":")[0].split("=")[0].trim())
      .filter((p) => p && p !== "self");
    out.push([name, { params: params.map((p) => [p, ""]), readonly: /@gl\.public\.view/.test(lines[i]) }]);
  }
  return out;
}

export function analyze(src, methods) {
  /** Body of `def name(` up to the next line at the same or lower indent. */
  const body = (name) => {
    const lines = src.split("\n");
    const start = lines.findIndex((l) => new RegExp(`^\\s*def ${name}\\(`).test(l));
    if (start < 0) return "";
    const indent = lines[start].match(/^\s*/)[0].length;
    const out = [lines[start]];
    for (let i = start + 1; i < lines.length; i += 1) {
      const l = lines[i];
      if (l.trim() && l.match(/^\s*/)[0].length <= indent && !/^\s*(\)|\]|\})/.test(l)) break;
      out.push(l);
    }
    return out.join("\n");
  };
  const callers = (target) => {
    const found = new Set();
    let current = null;
    for (const l of src.split("\n")) {
      const d = l.match(/^\s*def (\w+)\(/);
      if (d) current = d[1];
      if (current && l.includes(`${target}(`) && !l.includes(`def ${target}(`)) found.add(current);
    }
    return [...found].sort();
  };
  const results = [];
  const check = (id, label, ok, detail = "") => results.push({ id, label, ok: Boolean(ok), detail });

  const badNames = methods.map(([n]) => n).filter((n) => CLOCK_NAME.test(n));
  const badParams = methods.flatMap(([n, m]) => (m.params ?? []).filter(([p]) => CLOCK_PARAM.test(p)).map(([p]) => `${n}(${p})`));
  check("S1", "no clock method; no public method takes a time, recipient or amount", !badNames.length && !badParams.length, [...badNames, ...badParams].join(", "));

  const authMethods = methods.map(([n]) => n).filter((n) => AUTH.test(n));
  const storage = src.split("class Falk(gl.Contract):")[1]?.split("def __init__")[0] ?? "";
  const authFields = (storage.match(/^\s+(\w+):/gm) ?? []).map((l) => l.trim().replace(":", "")).filter((f) => AUTH.test(f));
  check("S2", "no owner / admin / pause / upgrade / withdraw method or storage field", !authMethods.length && !authFields.length, [...authMethods, ...authFields].join(", "));

  const timeReads = (src.match(/gl\.message_raw\["datetime"\]/g) ?? []).length;
  const wall = /(time\.time|datetime\.now|datetime\.utcnow|block\.number)/.test(src);
  check("S3", "consensus transaction datetime is the only time source", timeReads === 1 && !wall, `datetime reads=${timeReads}, wall-clock=${wall}`);

  const emits = (src.match(/\.emit_transfer\(/g) ?? []).length;
  const inSend = body("_send").includes("emit_transfer(");
  const sendCallers = callers("self._send");
  const closeCallers = callers("self._close");
  check("S4", "one value exit: emit_transfer only in _send ← _close ← terminal paths",
    emits === 1 && inSend && sendCallers.join() === "_close" &&
      closeCallers.join() === "accept_split,cancel_mandate,recover_escrow,settle",
    `emits=${emits} send<-${sendCallers} close<-${closeCallers}`);

  const claim = body("claim_unreviewed_delivery");
  const contest = body("open_contest");
  check("S5", "silent client closed: claim after the review deadline; contest refused after it",
    methods.some(([n]) => n === "claim_unreviewed_delivery") &&
      /S_DELIVERED/.test(claim) && /review_deadline_at/.test(claim) && /review window is still open/.test(claim) &&
      /review_deadline_at/.test(contest) && /review window has closed/.test(contest));

  const recover = body("recover_escrow");
  const stateGate = recover.match(/_require_state\(m,([^)]*)\)/)?.[1] ?? "";
  const gates = ["S_LAPSED", "S_FINALIZED", "S_RECORD_SEALED"].every((s) => stateGate.includes(s));
  const forbidden = ["S_RULING", "S_APPEALED", "S_APPROVED", "S_CONTESTED"].filter((s) => stateGate.includes(s));
  check("S6", "recovery only from LAPSED / FINALIZED(manual) / stalled RECORD_SEALED, each deadline-gated",
    gates && !forbidden.length && /manual_deadline_at/.test(recover) && /stall_deadline_at/.test(recover) &&
      /manual-review window is still open/.test(recover) && /panel still has time/.test(recover),
    `states=[${stateGate.trim()}] forbidden=${forbidden}`);

  const file = body("_file_receipt");
  const classify = body("classify_fetch");
  check("S7", "sha256 evidence binding: mandatory at filing, re-checked at retrieval, mismatch carries no text",
    /require_commitment\(commitment\)/.test(file) &&
      /sha256_hex\(stripped\) != expected/.test(classify) && /return \(F_MISMATCH, ""\)/.test(classify) &&
      /return \(F_MATCH, stripped\)/.test(classify));

  const close = body("_close");
  const settle = body("settle");
  check("S8", "settlement conserves custody and is single-shot",
    /split\["operator"\] \+ split\["client"\] != held/.test(close) && /status in TERMINAL/.test(close) &&
      /total_released/.test(close) && /_require_state\(m, S_APPROVED, S_FINALIZED\)/.test(settle));
  return results;
}

async function main() {
  const flag = process.argv.indexOf("--source");
  let src;
  let methods;
  if (flag >= 0) {
    src = normalizeSource(await readFile(process.argv[flag + 1], "utf8"));
    methods = methodsFromSource(src);
    console.log(`(local source ${process.argv[flag + 1]})`);
  } else {
    const dep = await loadDeployment();
    src = normalizeSource(await getOnchainSource(dep));
    const schema = await rpc(dep.rpcUrl, "gen_getContractSchema", [dep.contract.address]);
    methods = Object.entries(schema.methods ?? {});
    console.log(`(on-chain source of ${dep.contract.address})`);
  }
  const results = analyze(src, methods);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id} ${r.label}${r.ok || !r.detail ? "" : ` — ${r.detail}`}`);
  const failures = results.filter((r) => !r.ok).length;
  console.log(failures ? `\nverify:safety FAILED (${failures})` : `\nverify:safety PASSED (${results.length} checks)`);
  process.exit(failures ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
