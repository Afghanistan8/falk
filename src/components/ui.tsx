"use client";

import type { ReactNode } from "react";

import { txUrl } from "@/lib/config";
import { STATE_LABEL, STATE_TONE, formatGen, shortAddress } from "@/lib/present";
import type { Tone } from "@/lib/present";
import type { MandateStatus } from "@/lib/protocol";
import type { TxState } from "@/lib/useFalk";

export function Tag({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`tag ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StateBadge({ status }: { status: MandateStatus }) {
  return <Tag tone={STATE_TONE[status] ?? "neutral"}>{STATE_LABEL[status] ?? status}</Tag>;
}

export function Gen({ wei }: { wei: string }) {
  return (
    <span className="mono" title={`${wei} wei`}>
      {formatGen(wei)} GEN
    </span>
  );
}

export function Addr({ value, you }: { value: string; you?: boolean }) {
  return (
    <span className="mono" title={value}>
      {shortAddress(value)}
      {you ? " (you)" : ""}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Truthful transaction status: pending is pending, never "failed". */
export function TxStatus({ tx }: { tx: TxState }) {
  if (tx.phase === "idle") return null;
  const link = tx.hash ? (
    <a className="link mono" href={txUrl(tx.hash)} target="_blank" rel="noreferrer">
      {tx.hash.slice(0, 12)}…
    </a>
  ) : null;
  const inFlight = ["wallet", "submitted", "pending", "finalizing"].includes(tx.phase);
  const text: Record<string, string> = {
    wallet: "Waiting for your wallet to sign…",
    submitted: "Submitted. Waiting for the network…",
    pending: "Waiting for validators to accept the transaction…",
    finalizing: "Accepted. Waiting for finalization so value movements are complete…",
  };
  if (inFlight) {
    return (
      <div className="notice wait" role="status">
        <strong>{tx.label}.</strong> {text[tx.phase]} {link}
      </div>
    );
  }
  if (tx.phase === "done") {
    return (
      <div className="notice go" role="status">
        {tx.message} {link}
      </div>
    );
  }
  if (tx.pending) {
    return (
      <div className="notice warn" role="status">
        <strong>Still pending.</strong> {tx.message} {link}
      </div>
    );
  }
  return (
    <div className="notice stop" role="alert">
      <strong>{tx.phase === "rejected" ? "You declined it in the wallet." : `${tx.label} was refused.`}</strong>{" "}
      {tx.phase === "rejected" ? "Nothing was sent." : tx.message}
      {tx.hash ? (
        <>
          {" "}
          The chain recorded the attempt as {link}; the contract rolled it back, so nothing moved.
        </>
      ) : null}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A read failure with a way out: retry the read, or reload if no retry is wired. */
export function ReadError({ label, message, onRetry }: { label: string; message: string; onRetry?: () => void }) {
  return (
    <div className="notice stop" role="alert">
      <strong>{label}</strong> {message}{" "}
      <button className="btn ghost sm" onClick={onRetry ?? (() => window.location.reload())}>
        Retry
      </button>
    </div>
  );
}
