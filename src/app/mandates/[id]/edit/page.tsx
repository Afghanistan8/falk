import { EditDraft } from "@/components/EditDraft";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="wrap section stack">
      <h1 style={{ fontSize: "2.2rem" }}>Edit draft {decodeURIComponent(id)}</h1>
      <EditDraft id={decodeURIComponent(id)} />
    </div>
  );
}
