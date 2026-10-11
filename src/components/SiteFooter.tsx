import Link from "next/link";

import { CONTRACT_ADDRESS, CONTRACT_EXPLORER_URL, EXPECTED_REVISION, IS_ADDRESS_OF_RECORD } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span>
            <strong>Falk</strong> · panel returns meaning, contract moves money.
          </span>
          <span className="row small">
            <Link className="link" href="/protocol">Protocol</Link>
            <Link className="link" href="/health">Health</Link>
            <a className="link" href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">
              Contract on explorer
            </a>
          </span>
        </div>
        <p className="small">
          {EXPECTED_REVISION} · <span className="mono">{CONTRACT_ADDRESS}</span>
          {IS_ADDRESS_OF_RECORD ? "" : " · NOT the address of record (preview override)"}
        </p>
        <p className="small">
          No database, no server key, no simulator. Your wallet signs; the browser reads StudioNet directly.
          StudioNet is a test network: do not use funds you cannot lose.
        </p>
      </div>
    </footer>
  );
}
