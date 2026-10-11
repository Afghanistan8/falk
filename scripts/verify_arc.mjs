#!/usr/bin/env node
/**
 * Keyless check that the recorded live arc still matches the chain.
 *
 *   npm run verify:arc
 *
 * deployments/arc-studionet.json lists every mandate the live arc drove and the
 * outcome it recorded. This re-reads each mandate and settlement from StudioNet
 * and confirms: the arc ran against the address of record, every mandate is in
 * the recorded terminal state with zero custody, every settlement balances, and
 * every transaction hash in the record exists on the chain.
 */

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

import { loadDeployment, ROOT, rpc } from "./lib/chain.mjs";

const dep = await loadDeployment();
const path = new URL("deployments/arc-studionet.json", ROOT);
if (!existsSync(path)) {
  console.error("no deployments/arc-studionet.json: run `npm run arc` first");
  process.exit(1);
}
const arc = JSON.parse(readFileSync(path, "utf8"));
const client = createClient({ chain: studionet, endpoint: dep.rpcUrl });
const read = (functionName, args) =>
  client.readContract({ address: dep.contract.address, functionName, args, stateStatus: "accepted" });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

check("arc ran against the address of record", arc.contract.toLowerCase() === dep.contract.address.toLowerCase(), `${arc.contract} vs ${dep.contract.address}`);
check("arc revision equals the manifest", arc.revision === dep.contract.version);
check("arc recorded no failed checks", arc.checks.failed === 0, JSON.stringify(arc.checks));

const TERMINAL = new Set(["SETTLED", "CANCELLED", "RECOVERED"]);
let hashes = 0;
let missing = 0;
for (const s of arc.scenarios) {
  if (s.status !== "complete") {
    check(`${s.code} ${s.title} completed`, false, s.error ?? s.status);
    continue;
  }
  const m = await read("get_mandate", [s.mandate]);
  const ok = TERMINAL.has(m.status) && m.custody_held === "0";
  check(`${s.code} ${s.title}: ${s.mandate} is ${m.status} with custody ${m.custody_held}`, ok);
  if (m.status === "SETTLED" || m.status === "RECOVERED" || m.status === "CANCELLED") {
    const st = await read("get_settlement", [s.mandate]);
    if (st.mandate_id) {
      check(`${s.code} settlement balances (${st.action})`,
        BigInt(st.operator_payout) + BigInt(st.client_payout) === BigInt(st.custody_before) && st.custody_after === "0");
    }
  }
  for (const step of [...s.steps, ...s.walls]) {
    if (!step.hash) continue;
    hashes += 1;
    const tx = await rpc(dep.rpcUrl, "eth_getTransactionByHash", [step.hash]).catch(() => null);
    if (!tx) {
      missing += 1;
      check(`${s.code} tx ${step.hash.slice(0, 12)}… exists`, false, step.fn);
    }
  }
}
check(`all ${hashes} recorded transaction hashes exist on the chain`, missing === 0, `${missing} missing`);
console.log(failures ? `\nverify:arc FAILED (${failures})` : "\nverify:arc PASSED");
process.exit(failures ? 1 : 0);
