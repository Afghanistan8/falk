#!/usr/bin/env node
/**
 * Keyless verification of the deployment of record. No wallet, no private key.
 *
 *   npm run verify:live
 *
 * Checks, in order:
 *   1. the endpoint reports the manifest's chain id;
 *   2. contracts/falk.py hashes to the manifest, and the source returned by
 *      gen_getContractCode normalises to exactly the same bytes;
 *   3. the on-chain schema has the recorded read/write method counts;
 *   4. get_protocol_info returns the recorded revision, agrees with the schema
 *      on method counts, and reports no owner and no clock method.
 */

import { readFile } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

import { getOnchainSource, loadDeployment, normalizeSource, ROOT, rpc, sha256 } from "./lib/chain.mjs";

const dep = await loadDeployment();
const source = normalizeSource(await readFile(new URL(dep.contract.source, ROOT), "utf8"));
const results = [];
const pass = (label, detail) => {
  results.push(["PASS", label, detail]);
  console.log(`PASS ${label}: ${detail}`);
};
const fail = (label, detail) => {
  console.error(`FAIL ${label}: ${detail}`);
  process.exitCode = 1;
};

const chainId = Number.parseInt(await rpc(dep.rpcUrl, "eth_chainId"), 16);
if (chainId !== dep.chainId) fail("chain", `expected ${dep.chainId}, received ${chainId}`);
else pass("chain", String(chainId));

const localHash = sha256(source);
const onchainHash = sha256(normalizeSource(await getOnchainSource(dep)));
if (localHash !== dep.contract.sourceSha256) {
  fail("manifest", `contracts/falk.py hashes to ${localHash}, manifest says ${dep.contract.sourceSha256}`);
} else if (onchainHash !== localHash) {
  console.error("REDEPLOY REQUIRED");
  console.error(`  repository source : ${localHash}`);
  console.error(`  deployed source   : ${onchainHash}`);
  console.error(`  address           : ${dep.contract.address}`);
  fail("source", "the deployed source is not the repository source");
} else {
  pass("contract", dep.contract.address);
  pass("source", `sha256 ${localHash} (repository == chain, ${dep.contract.sourceLines} lines)`);
}

const schema = await rpc(dep.rpcUrl, "gen_getContractSchema", [dep.contract.address]);
const methods = Object.entries(schema.methods ?? {});
const reads = methods.filter(([, m]) => m.readonly).length;
const writes = methods.length - reads;
if (methods.length !== dep.contract.publicMethods || reads !== dep.contract.readMethods || writes !== dep.contract.writeMethods) {
  fail("schema", `${methods.length} methods (${reads} read, ${writes} write); manifest has ${dep.contract.publicMethods} (${dep.contract.readMethods}/${dep.contract.writeMethods})`);
} else {
  pass("schema", `${methods.length} methods (${reads} read, ${writes} write)`);
}

const client = createClient({ chain: studionet, endpoint: dep.rpcUrl });
const info = await client.readContract({
  address: dep.contract.address, functionName: "get_protocol_info", args: [], stateStatus: "accepted",
});
if (info.revision !== dep.contract.version) {
  fail("protocol", `expected ${dep.contract.version}, received ${info.revision}`);
} else if (info.public_write_methods !== writes || info.public_read_methods !== reads) {
  fail("protocol", `get_protocol_info says ${info.public_write_methods}/${info.public_read_methods}, schema says ${writes}/${reads}`);
} else if (info.has_owner !== false || info.has_clock_method !== false) {
  fail("protocol", "contract reports an owner or a clock method");
} else {
  pass("protocol", `${info.revision}, ${info.mandate_count} mandate(s), no owner, no clock method`);
}

if (process.exitCode) {
  console.error("\nverify:live FAILED");
} else {
  console.log(`\nverify:live PASSED (${results.length} checks)`);
}
