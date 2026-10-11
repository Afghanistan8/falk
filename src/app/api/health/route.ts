import { createHash } from "node:crypto";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

import deployment from "../../../../deployments/studionet.json";

export const dynamic = "force-dynamic";

async function rpc(url: string, method: string, params: unknown[] = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const payload = (await response.json()) as { result?: unknown; error?: unknown };
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

function normalize(text: string): string {
  const value = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = value.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines[0]?.trim().toLowerCase().startsWith("result:")) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return `${lines.join("\n")}\n`;
}

/**
 * Keyless health: chain id, protocol revision, schema method counts and, for
 * the address of record, whether the on-chain source hashes to the manifest.
 * No database and no signer are involved.
 */
export async function GET() {
  const rpcUrl = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || deployment.rpcUrl;
  const address = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || deployment.contract.address) as `0x${string}`;
  const ofRecord = address.toLowerCase() === deployment.contract.address.toLowerCase();
  try {
    const chainId = Number.parseInt(String(await rpc(rpcUrl, "eth_chainId")), 16);
    if (chainId !== deployment.chainId) throw new Error(`RPC reports chain ${chainId}, expected ${deployment.chainId}`);

    const client = createClient({ chain: studionet, endpoint: rpcUrl });
    const info = (await client.readContract({
      address, functionName: "get_protocol_info", args: [], stateStatus: "accepted",
    } as never)) as { revision?: string; mandate_count?: number; public_write_methods?: number; public_read_methods?: number };
    if (info.revision !== deployment.contract.version) throw new Error(`contract reports ${info.revision}`);

    const schema = (await rpc(rpcUrl, "gen_getContractSchema", [address])) as { methods?: Record<string, { readonly?: boolean }> };
    const methods = Object.values(schema.methods ?? {});
    const reads = methods.filter((m) => m.readonly).length;

    let sourceVerified: boolean | null = null;
    if (ofRecord) {
      const code = Buffer.from(String(await rpc(rpcUrl, "gen_getContractCode", [address])), "base64").toString("utf8");
      sourceVerified = createHash("sha256").update(normalize(code), "utf8").digest("hex") === deployment.contract.sourceSha256;
    }
    const countsMatch =
      methods.length === deployment.contract.publicMethods &&
      reads === deployment.contract.readMethods &&
      info.public_write_methods === deployment.contract.writeMethods &&
      info.public_read_methods === deployment.contract.readMethods;

    return Response.json({
      ok: sourceVerified !== false && countsMatch,
      network: deployment.chainName,
      chainId,
      contract: address,
      addressOfRecord: ofRecord,
      revision: info.revision,
      mandateCount: info.mandate_count ?? 0,
      methods: { total: methods.length, read: reads, write: methods.length - reads },
      countsMatchManifest: countsMatch,
      sourceVerified,
      sourceSha256: deployment.contract.sourceSha256,
    });
  } catch (error) {
    return Response.json(
      { ok: false, network: deployment.chainName, contract: address, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
