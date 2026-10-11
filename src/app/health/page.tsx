import { HealthPanel } from "@/components/HealthPanel";

export const metadata = { title: "Health — Falk" };

export default function Health() {
  return (
    <div className="wrap section stack">
      <div>
        <h1 style={{ fontSize: "2.2rem" }}>Health</h1>
        <p className="muted">Keyless checks against the deployment of record. A green row is something this page just verified, not something it remembers.</p>
      </div>
      <HealthPanel />
    </div>
  );
}
