import { MandateBrowser } from "@/components/MandateBrowser";

export const metadata = { title: "Registry — Falk" };

export default function Registry() {
  return (
    <div className="wrap section stack">
      <div>
        <h1 style={{ fontSize: "2.2rem" }}>Registry</h1>
        <p className="muted">Every mandate on the contract, read live from StudioNet. Nothing here is seeded or cached.</p>
      </div>
      <MandateBrowser />
    </div>
  );
}
