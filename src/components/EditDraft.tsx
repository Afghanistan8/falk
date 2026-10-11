"use client";

import Link from "next/link";

import { roleOf } from "@/lib/acts";
import { useMandate } from "@/lib/useFalk";
import { CreateMandateForm } from "./CreateMandateForm";
import { Empty, ReadError } from "./ui";
import { useWallet } from "./WalletProvider";

export function EditDraft({ id }: { id: string }) {
  const { bundle, loading, error, missing, reload } = useMandate(id);
  const { address } = useWallet();
  if (loading) return <div className="notice wait">Reading {id}…</div>;
  if (missing) return <Empty>No mandate {id} exists on this contract.</Empty>;
  if (error || !bundle) return <ReadError label="Could not read the mandate." message={error ?? ""} onRetry={() => void reload()} />;
  const { mandate, criteria } = bundle;
  if (mandate.status !== "DRAFT") {
    return (
      <div className="notice warn">
        {id} is {mandate.status.toLowerCase()}: its terms are frozen and can no longer be edited.{" "}
        <Link className="link" href={`/mandates/${id}`}>Back to the mandate</Link>
      </div>
    );
  }
  if (roleOf(mandate, address) !== "client") {
    return <div className="notice warn">Only the client can edit this draft. Connect the client&apos;s wallet.</div>;
  }
  return <CreateMandateForm edit={{ mandate, criteria }} />;
}
