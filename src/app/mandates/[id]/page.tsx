import { MandateWorkspace } from "@/components/MandateWorkspace";

export default async function MandatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MandateWorkspace id={decodeURIComponent(id)} />;
}
