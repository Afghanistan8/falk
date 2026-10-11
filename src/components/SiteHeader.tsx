"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { shortAddress } from "@/lib/present";
import { useWallet } from "./WalletProvider";

const LINKS = [
  { href: "/mandates", label: "Registry" },
  { href: "/mandates/new", label: "New mandate" },
  { href: "/operators", label: "Operators" },
  { href: "/protocol", label: "Protocol" },
  { href: "/guide", label: "Guide" },
  { href: "/health", label: "Health" },
];

export function SiteHeader() {
  const path = usePathname();
  const w = useWallet();
  return (
    <header className="site-header">
      <div className="wrap bar">
        <Link href="/" className="brand" aria-label="Falk home">
          <i aria-hidden /> Falk
        </Link>
        <nav className="nav" aria-label="Primary">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path === l.href || (l.href !== "/mandates" && path.startsWith(l.href)) ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="row">
          {!w.address ? (
            <button className="btn accent sm" onClick={w.connect} disabled={w.busy}>
              {w.hasWallet ? "Connect wallet" : "Wallet required"}
            </button>
          ) : !w.onChain ? (
            <button className="btn accent sm" onClick={w.switchChain}>
              Switch to StudioNet
            </button>
          ) : (
            <span className="tag go mono" title={w.address}>
              {shortAddress(w.address)}
            </span>
          )}
        </div>
      </div>
      {w.error ? (
        <div className="wrap" style={{ paddingBottom: 8 }}>
          <div className="notice warn small">{w.error}</div>
        </div>
      ) : null}
    </header>
  );
}
