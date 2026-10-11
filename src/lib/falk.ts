import { createClient } from "genlayer-js";

import { CHAIN, CHAIN_RPC, CONTRACT_ADDRESS } from "./config";
import type {
  Contest,
  Criterion,
  MandatePage,
  MandateView,
  Passport,
  Policy,
  ProtocolInfo,
  Receipt,
  Ruling,
  Settlement,
  Windows,
} from "./protocol";

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
}

/** Network-level failure (gateway error page, dropped connection), as opposed to a contract answer. */
export function isRateLimited(error: unknown): boolean {
  const m = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ""}` : String(error);
  return /rate limit/i.test(m);
}

export function isTransportError(error: unknown): boolean {
  if (isRateLimited(error)) return false; // retrying a rate limit only spends more of the budget
  const m = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ""}` : String(error);
  return /failed to fetch|fetch failed|networkerror|unknown rpc error|unexpected token '<'|econnreset|timeout|timed out|502|503|504|load failed/i.test(m);
}

// ---------------------------------------------------------------- receipts
type LeaderReceipt = {
  result?: { status?: string; payload?: unknown };
  execution_result?: string;
  vote?: string | null;
  genvm_result?: { error_code?: string | null };
};

function leaderReceipts(receipt: unknown): LeaderReceipt[] {
  const r = receipt as {
    consensus_data?: { leader_receipt?: unknown };
    result?: { leader_receipt?: unknown };
    leader_receipt?: unknown;
  } | null;
  const direct = r?.consensus_data?.leader_receipt;
  if (Array.isArray(direct)) return direct as LeaderReceipt[];
  const nested = r?.result?.leader_receipt ?? r?.leader_receipt;
  return Array.isArray(nested) ? (nested as LeaderReceipt[]) : [];
}

/**
 * A receipt that the chain ACCEPTED is not proof the contract SUCCEEDED: a
 * refused call is an accepted transaction whose leader execution rolled back.
 */
export function rollbackReason(receipt: unknown): string | null {
  for (const leader of leaderReceipts(receipt)) {
    if (String(leader.vote ?? "").toLowerCase() === "idle") continue;
    if (leader.genvm_result?.error_code === "CONSENSUS_VALIDATOR_QUORUM_REACHED") continue;
    const status = leader.result?.status;
    if (status === "rollback" || status === "contract_error") {
      return typeof leader.result?.payload === "string"
        ? leader.result.payload
        : "The contract refused this transaction.";
    }
    if (
      leader.execution_result &&
      !["SUCCESS", "FINISHED", "FINISHED_WITH_RETURN"].includes(leader.execution_result)
    ) {
      return `Contract execution ended with ${leader.execution_result}.`;
    }
  }
  return null;
}

export function returnedValue(receipt: unknown): unknown {
  for (const leader of leaderReceipts(receipt)) {
    if (leader.result?.status !== "return") continue;
    let value: unknown = leader.result.payload;
    if (value && typeof value === "object" && "readable" in value) {
      value = (value as { readable?: unknown }).readable;
    }
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

/** The transaction was submitted but its receipt has not arrived. It is NOT failed: never resubmit value actions. */
export class PendingReceipt extends Error {
  readonly hash: string;
  constructor(hash: string, detail: string) {
    super(`The transaction was submitted but its receipt is still pending (${detail}). Do not send it again.`);
    this.name = "PendingReceipt";
    this.hash = hash;
  }
}

export type TxPhase = "idle" | "wallet" | "submitted" | "pending" | "finalizing" | "done" | "rejected" | "failed";

export interface TxResult {
  hash: string;
  returned: unknown;
}

type Wait = "ACCEPTED" | "FINALIZED";

// ------------------------------------------------------------------ client
const inflight = new Map<string, { at: number; promise: Promise<unknown> }>();

export class FalkClient {
  private readonly client: ReturnType<typeof createClient>;
  private onPhase?: (phase: TxPhase, hash?: string) => void;

  setPhaseHandler(handler: (phase: TxPhase, hash?: string) => void) {
    this.onPhase = handler;
  }

  constructor(account?: string | null, provider?: Eip1193Provider) {
    const config: Record<string, unknown> = { chain: CHAIN, endpoint: CHAIN_RPC };
    if (account) config.account = account as `0x${string}`;
    if (provider) config.provider = provider;
    this.client = createClient(config as never);
  }

  /**
   * Reads retry on transport failures: the StudioNet gateway occasionally
   * answers with an HTML error page or drops a connection. A contract-level
   * refusal is not retried.
   */
  private async read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    // The public RPC allows ~500 requests/hour/IP: identical reads issued at the
    // same moment (strict-mode double effects, several components) share one request.
    const key = `${functionName}:${JSON.stringify(args)}`;
    const hit = inflight.get(key);
    if (hit && Date.now() - hit.at < 1500) return hit.promise as Promise<T>;
    const promise = this.readUncached<T>(functionName, args);
    inflight.set(key, { at: Date.now(), promise });
    promise.catch(() => inflight.delete(key));
    return promise;
  }

  private async readUncached<T>(functionName: string, args: unknown[] = []): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const raw = await this.client.readContract({
          address: CONTRACT_ADDRESS,
          functionName,
          args: args as never,
          stateStatus: "accepted",
        } as never);
        return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
      } catch (error) {
        last = error;
        if (!isTransportError(error)) throw error;
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    throw last;
  }

  getProtocolInfo() { return this.read<ProtocolInfo>("get_protocol_info"); }
  listMandates(offset = 0, limit = 100) { return this.read<MandatePage>("list_mandates", [offset, limit]); }
  listMandatesFor(address: string, offset = 0, limit = 100) {
    return this.read<MandatePage>("list_mandates_for", [address, offset, limit]);
  }
  getMandate(id: string) { return this.read<MandateView | Record<string, never>>("get_mandate", [id]); }
  getCriteria(id: string) { return this.read<Criterion[]>("get_criteria", [id]); }
  getEvidence(id: string) { return this.read<Receipt[]>("get_evidence", [id]); }
  getContest(id: string) { return this.read<Contest | Record<string, never>>("get_contest", [id]); }
  listRulings(id: string) { return this.read<Ruling[]>("list_rulings", [id]); }
  getSettlement(id: string) { return this.read<Settlement | Record<string, never>>("get_settlement", [id]); }
  getPassport(operator: string) { return this.read<Passport>("get_passport", [operator]); }

  private async write(
    functionName: string,
    args: unknown[],
    { value, wait = "ACCEPTED" }: { value?: bigint; wait?: Wait } = {},
  ): Promise<TxResult> {
    this.onPhase?.("wallet");
    let hash: `0x${string}`;
    try {
      hash = (await this.client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args: args as never,
        ...(value !== undefined && value > BigInt(0) ? { value } : {}),
      } as never)) as `0x${string}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onPhase?.(/reject|denied|user denied|user rejected/i.test(message) ? "rejected" : "failed");
      throw error;
    }
    this.onPhase?.("submitted", hash);
    let receipt: unknown;
    try {
      this.onPhase?.(wait === "FINALIZED" ? "finalizing" : "pending", hash);
      receipt = await this.client.waitForTransactionReceipt({
        hash,
        status: wait as never,
        retries: wait === "FINALIZED" ? 120 : 60,
        interval: 5000,
      } as never);
    } catch (error) {
      throw new PendingReceipt(hash, error instanceof Error ? error.message : String(error));
    }
    const reason = rollbackReason(receipt);
    if (reason) {
      this.onPhase?.("failed", hash);
      const err = new Error(reason);
      (err as Error & { hash?: string }).hash = hash;
      throw err;
    }
    this.onPhase?.("done", hash);
    return { hash, returned: returnedValue(receipt) };
  }

  createMandate(i: {
    operator: string; title: string; description: string; criteria: Criterion[];
    paymentWei: bigint; operatorBondWei: bigint; contestBondWei: bigint;
    evidenceRules: string; policy: Partial<Policy>; windows: Windows;
    schemes: string; maxReceipts: number;
  }) {
    return this.write("create_mandate", [
      i.operator, i.title, i.description, JSON.stringify(i.criteria),
      i.paymentWei.toString(), i.operatorBondWei.toString(), i.contestBondWei.toString(),
      i.evidenceRules, JSON.stringify(i.policy), JSON.stringify(i.windows), i.schemes, i.maxReceipts,
    ]);
  }
  updateDraft(id: string, i: Parameters<FalkClient["createMandate"]>[0]) {
    return this.write("update_draft", [
      id, i.operator, i.title, i.description, JSON.stringify(i.criteria),
      i.paymentWei.toString(), i.operatorBondWei.toString(), i.contestBondWei.toString(),
      i.evidenceRules, JSON.stringify(i.policy), JSON.stringify(i.windows), i.schemes, i.maxReceipts,
    ]);
  }
  fundMandate(id: string, payment: bigint) { return this.write("fund_mandate", [id], { value: payment }); }
  acceptMandate(id: string, bond: bigint) { return this.write("accept_mandate", [id], { value: bond }); }
  cancelMandate(id: string) { return this.write("cancel_mandate", [id], { wait: "FINALIZED" }); }
  submitEvidence(id: string, e: {
    criterionIds: string[]; url: string; role: string; commitment: string; origin: string;
    mediaType: string; publisher: string; note: string;
  }) {
    return this.write("submit_evidence", [
      id, JSON.stringify(e.criterionIds), e.url, e.role, e.commitment, e.origin,
      e.mediaType, e.publisher, e.note,
    ]);
  }
  submitDeliverable(id: string, url: string, commitment: string) {
    return this.write("submit_deliverable", [id, url, commitment]);
  }
  approveWork(id: string) { return this.write("approve_work", [id]); }
  claimUnreviewed(id: string) { return this.write("claim_unreviewed_delivery", [id]); }
  openContest(id: string, disputed: string[], claim: string, bond: bigint) {
    return this.write("open_contest", [id, JSON.stringify(disputed), claim], { value: bond });
  }
  respondToContest(id: string, response: string) { return this.write("respond_to_contest", [id, response]); }
  sealRecord(id: string) { return this.write("seal_record", [id]); }
  adjudicate(id: string) { return this.write("adjudicate", [id]); }
  appeal(id: string) { return this.write("appeal", [id]); }
  finalizeRuling(id: string) { return this.write("finalize_ruling", [id]); }
  settle(id: string) { return this.write("settle", [id], { wait: "FINALIZED" }); }
  proposeSplit(id: string, pct: number) { return this.write("propose_split", [id, pct]); }
  acceptSplit(id: string) { return this.write("accept_split", [id], { wait: "FINALIZED" }); }
  lapseMandate(id: string) { return this.write("lapse_mandate", [id]); }
  recoverEscrow(id: string) { return this.write("recover_escrow", [id], { wait: "FINALIZED" }); }
}

export function isMandate(m: MandateView | Record<string, never> | null | undefined): m is MandateView {
  return Boolean(m && "mandate_id" in m);
}
