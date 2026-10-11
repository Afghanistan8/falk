"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWallet } from "@/components/WalletProvider";
import { FalkClient, PendingReceipt, isMandate } from "./falk";
import type { TxPhase } from "./falk";
import { describeRefusal } from "./present";
import type { Contest, Criterion, MandateView, Receipt, Ruling, Settlement } from "./protocol";

/** A read-only client (no wallet needed) shared by read hooks. */
export function useReader(): FalkClient {
  return useMemo(() => new FalkClient(), []);
}

/** A client bound to the connected wallet for signing. */
export function useSigner(): FalkClient | null {
  const { address, provider } = useWallet();
  return useMemo(() => (address && provider ? new FalkClient(address, provider) : null), [address, provider]);
}

/** A clock that ticks once a second. Local time is an ESTIMATE; the contract uses consensus time. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export interface MandateBundle {
  mandate: MandateView;
  criteria: Criterion[];
  evidence: Receipt[];
  contest: Contest | null;
  rulings: Ruling[];
  settlement: Settlement | null;
}

async function fetchBundle(reader: FalkClient, id: string): Promise<MandateBundle | null> {
  const m = await reader.getMandate(id);
  if (!isMandate(m)) return null;
  const [criteria, evidence, contest, rulings, settlement] = await Promise.all([
    reader.getCriteria(id),
    reader.getEvidence(id),
    reader.getContest(id),
    reader.listRulings(id),
    reader.getSettlement(id),
  ]);
  return {
    mandate: m,
    criteria,
    evidence,
    contest: "mandate_id" in contest ? (contest as Contest) : null,
    rulings,
    settlement: "mandate_id" in settlement ? (settlement as Settlement) : null,
  };
}

interface MandateLoad {
  bundle: MandateBundle | null;
  missing: boolean;
  error: string | null;
  loading: boolean;
}

export function useMandate(id: string) {
  const reader = useReader();
  const [state, setState] = useState<MandateLoad>({ bundle: null, missing: false, error: null, loading: true });
  const seq = useRef(0);

  const reload = useCallback(async (): Promise<MandateBundle | null> => {
    const mine = ++seq.current;
    try {
      const bundle = await fetchBundle(reader, id);
      if (mine === seq.current) setState({ bundle, missing: bundle === null, error: null, loading: false });
      return bundle;
    } catch (e) {
      if (mine === seq.current) setState((s) => ({ ...s, error: describeRefusal(e), loading: false }));
      return null;
    }
  }, [reader, id]);

  useEffect(() => {
    let alive = true;
    const mine = ++seq.current;
    fetchBundle(reader, id)
      .then((bundle) => {
        if (alive && mine === seq.current) setState({ bundle, missing: bundle === null, error: null, loading: false });
      })
      .catch((e) => {
        if (alive && mine === seq.current) setState((s) => ({ ...s, error: describeRefusal(e), loading: false }));
      });
    return () => {
      alive = false;
    };
  }, [reader, id]);

  return { ...state, reload };
}

export interface TxState {
  phase: TxPhase;
  hash?: string;
  label?: string;
  message?: string;
  pending?: boolean;
  by?: string | null;
}

/**
 * Run one write, then RE-READ authoritative state. Success is claimed only when
 * the receipt shows the contract executed and the re-read succeeded; a pending
 * hash is shown as pending, never as failed, and never invites a resubmission.
 */
export function useTx(afterwards: () => Promise<unknown>) {
  const signer = useSigner();
  const { address } = useWallet();
  const [rawTx, setTx] = useState<TxState>({ phase: "idle" });
  // A status belongs to the wallet that produced it; another account never inherits it.
  const tx: TxState = rawTx.by === address ? rawTx : { phase: "idle" };
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (label: string, action: (client: FalkClient) => Promise<{ hash: string }>) => {
      if (!signer || busy) return;
      setBusy(true);
      setTx({ phase: "wallet", label, by: address });
      signer.setPhaseHandler((phase, hash) => setTx((t) => ({ ...t, phase, hash: hash ?? t.hash, label, by: address })));
      try {
        const result = await action(signer);
        const fresh = await afterwards();
        setTx({
          phase: "done",
          by: address,
          hash: result.hash,
          label,
          message:
            fresh === null
              ? `${label}: confirmed by the chain, but the page could not re-read the new state. Use Retry to refresh.`
              : `${label}: confirmed by the chain and state re-read.`,
        });
      } catch (e) {
        if (e instanceof PendingReceipt) {
          setTx({ phase: "pending", by: address, hash: e.hash, label, pending: true, message: e.message });
          void afterwards();
        } else {
          const hash = (e as { hash?: string }).hash;
          const rejected = /reject|denied/i.test(e instanceof Error ? e.message : "");
          setTx({ phase: rejected ? "rejected" : "failed", by: address, hash, label, message: describeRefusal(e) });
        }
      } finally {
        setBusy(false);
      }
    },
    [signer, busy, afterwards, address],
  );
  return { tx, run, busy, canSign: Boolean(signer) };
}
