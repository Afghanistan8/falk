// Shared helpers for the keyless verifiers and the live arc. No keys are read
// or written here; the arc passes accounts in explicitly.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const ROOT = new URL("../../", import.meta.url);

export async function loadDeployment() {
  return JSON.parse(await readFile(new URL("deployments/studionet.json", ROOT), "utf8"));
}

export async function rpc(url, method, params = [], attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
      return payload.result;
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** Same normalisation the on-chain transport is verified under: BOM, CRLF, result banner, blank edges. */
export function normalizeSource(text) {
  const value = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = value.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines[0]?.trim().toLowerCase().startsWith("result:")) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return `${lines.join("\n")}\n`;
}

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Python str.strip() semantics, matching src/lib/pure.ts and the contract. */
export function pyStrip(text) {
  const space = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  return text.replace(new RegExp(`^[${space}]+|[${space}]+$`, "g"), "");
}

export const commitmentOf = (body) => sha256(pyStrip(body));

export async function getOnchainSource(deployment) {
  const encoded = await rpc(deployment.rpcUrl, "gen_getContractCode", [deployment.contract.address]);
  return Buffer.from(encoded, "base64").toString("utf8");
}

// ---- receipts -------------------------------------------------------------
function leaderReceipts(receipt) {
  const direct = receipt?.consensus_data?.leader_receipt;
  if (Array.isArray(direct)) return direct;
  const nested = receipt?.result?.leader_receipt ?? receipt?.leader_receipt;
  return Array.isArray(nested) ? nested : [];
}

/** The contract's refusal text, or null when the leader execution succeeded. */
export function rollbackReason(receipt) {
  for (const leader of leaderReceipts(receipt)) {
    if (String(leader.vote ?? "").toLowerCase() === "idle") continue;
    if (leader.genvm_result?.error_code === "CONSENSUS_VALIDATOR_QUORUM_REACHED") continue;
    const status = leader.result?.status;
    if (status === "rollback" || status === "contract_error") {
      const p = leader.result?.payload;
      return typeof p === "string" ? p : JSON.stringify(p ?? "contract refused");
    }
    if (leader.execution_result && !["SUCCESS", "FINISHED", "FINISHED_WITH_RETURN"].includes(leader.execution_result)) {
      return `execution ended with ${leader.execution_result}`;
    }
  }
  return null;
}

export function returnedValue(receipt) {
  for (const leader of leaderReceipts(receipt)) {
    if (leader.result?.status !== "return") continue;
    let value = leader.result.payload;
    if (value && typeof value === "object" && "readable" in value) value = value.readable;
    for (let i = 0; i < 3 && typeof value === "string"; i += 1) {
      try {
        value = JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  return null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
