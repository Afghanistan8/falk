import type { Metadata } from "next";

import { MandateWorkspace } from "@/components/MandateWorkspace";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${decodeURIComponent(id)} — Falk` };
}

export default async function MandatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MandateWorkspace id={decodeURIComponent(id)} />;
}
