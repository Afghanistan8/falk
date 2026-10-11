import { CreateMandateForm } from "@/components/CreateMandateForm";

export const metadata = { title: "New mandate — Falk" };

export default function NewMandate() {
  return (
    <div className="wrap section stack">
      <div>
        <h1 style={{ fontSize: "2.2rem" }}>New mandate</h1>
        <p className="muted">
          A draft costs nothing but gas and can be edited until you fund it. Funding sends the exact payment into
          escrow and freezes every term by hash.
        </p>
      </div>
      <CreateMandateForm />
    </div>
  );
}
