"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { ADD_CHAIN_PARAMS, CHAIN_HEX } from "@/lib/config";
import type { Eip1193Provider } from "@/lib/falk";

interface WalletState {
  address: string | null;
  chainId: string | null;
  provider: Eip1193Provider | null;
  hasWallet: boolean;
  onChain: boolean;
  busy: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

function injected(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

const subscribeNever = () => () => {};
const serverProvider = (): Eip1193Provider | null => null;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hydration-safe: null on the server, the injected provider in the browser.
  const provider = useSyncExternalStore(subscribeNever, injected, serverProvider);

  useEffect(() => {
    const p = provider;
    if (!p) return;
    let alive = true;
    (async () => {
      try {
        const accounts = (await p.request({ method: "eth_accounts" })) as string[];
        const id = (await p.request({ method: "eth_chainId" })) as string;
        if (alive) {
          setAddress(accounts[0] ?? null);
          setChainId(id);
        }
      } catch {
        /* a wallet that will not answer is treated as not connected */
      }
    })();
    const onAccounts = (accounts: unknown) => setAddress((accounts as string[])[0] ?? null);
    const onChain = (id: unknown) => setChainId(String(id));
    const emitter = p as unknown as {
      on?: (e: string, f: (v: unknown) => void) => void;
      removeListener?: (e: string, f: (v: unknown) => void) => void;
    };
    emitter.on?.("accountsChanged", onAccounts);
    emitter.on?.("chainChanged", onChain);
    return () => {
      alive = false;
      emitter.removeListener?.("accountsChanged", onAccounts);
      emitter.removeListener?.("chainChanged", onChain);
    };
  }, [provider]);

  const switchChain = useCallback(async () => {
    const p = injected();
    if (!p) return;
    setError(null);
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 4902 || code === -32603) {
        await p.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setChainId((await p.request({ method: "eth_chainId" })) as string);
  }, []);

  const connect = useCallback(async () => {
    const p = injected();
    if (!p) {
      setError("No EIP-1193 wallet was found in this browser. Install MetaMask to sign transactions.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts[0] ?? null);
      setChainId((await p.request({ method: "eth_chainId" })) as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      provider,
      hasWallet: Boolean(provider),
      onChain: chainId?.toLowerCase() === CHAIN_HEX,
      busy,
      error,
      connect,
      switchChain,
    }),
    [address, chainId, provider, busy, error, connect, switchChain],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}
