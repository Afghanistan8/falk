import { OperatorLookup } from "@/components/OperatorLookup";

export const metadata = { title: "Operators — Falk" };

export default function Operators() {
  return (
    <div className="wrap section stack">
      <div>
        <h1 style={{ fontSize: "2.2rem" }}>Operator passport</h1>
        <p className="muted">Count-based history of how an operator&apos;s mandates actually closed on this contract.</p>
      </div>
      <OperatorLookup />
    </div>
  );
}
