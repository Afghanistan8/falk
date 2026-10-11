#!/usr/bin/env node
/**
 * Write deployments/studionet.json from what the CHAIN reports, not from what
 * we remember. Run right after `genlayer deploy`:
 *
 *   node scripts/record_deployment.mjs <contractAddress> <deployTxHash>
 *
 * It refuses to record a deployment whose on-chain source does not normalise to
 * contracts/falk.py byte-for-byte.
 */

import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

import { getOnchainSource, normalizeSource, ROOT, rpc, sha256 } from "./lib/chain.mjs";

const [address, txHash] = process.argv.slice(2);
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) {
  console.error("usage: node scripts/record_deployment.mjs <contractAddress> <deployTxHash>");
  process.exit(2);
}

const rpcUrl = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
const explorerUrl = process.env.NEXT_PUBLIC_EXPLORER_URL || "https://explorer-studio.genlayer.com";
const sourceRaw = await readFile(new URL("contracts/falk.py", ROOT), "utf8");
const source = normalizeSource(sourceRaw);
const onchain = normalizeSource(await getOnchainSource({ rpcUrl, contract: { address } }));
if (source !== onchain) {
  console.error("on-chain source does NOT match contracts/falk.py after normalisation; not recording");
  process.exit(1);
}

const chainId = Number.parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
const schema = await rpc(rpcUrl, "gen_getContractSchema", [address]);
const methods = Object.values(schema.methods || {});
const reads = methods.filter((m) => m.readonly).length;
const client = createClient({ chain: studionet, endpoint: rpcUrl });
const info = await client.readContract({ address, functionName: "get_protocol_info", args: [], stateStatus: "accepted" });

const manifest = {
  network: "studionet",
  chainId,
  chainIdHex: `0x${chainId.toString(16)}`,
  chainName: "GenLayer StudioNet",
  rpcUrl,
  explorerUrl,
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  contract: {
    name: "Falk",
    version: info.revision,
    status: "deployed-and-byte-verified",
    address,
    explorerUrl: `${explorerUrl}/address/${address}`,
    deployTransaction: txHash ?? null,
    deployer: process.env.FALK_DEPLOYER || null,
    source: "contracts/falk.py",
    sourceSha256: sha256(source),
    sourceLines: source.trimEnd().split("\n").length,
    sourceBytes: Buffer.byteLength(source, "utf8"),
    runner: (source.match(/py-genlayer:[0-9a-z]+/) || [""])[0],
    publicMethods: methods.length,
    readMethods: reads,
    writeMethods: methods.length - reads,
    verifiedAt: new Date().toISOString().slice(0, 10),
    verification:
      "gen_getContractCode returned the deployed source; after BOM, CRLF, result-banner and blank-edge normalisation its sha256 equals that of contracts/falk.py. gen_getContractSchema reported the recorded method counts and get_protocol_info returned the recorded revision.",
  },
};

await writeFile(new URL("deployments/studionet.json", ROOT), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`recorded ${address}: ${methods.length} methods (${reads} read, ${methods.length - reads} write), sha256 ${manifest.contract.sourceSha256}`);
