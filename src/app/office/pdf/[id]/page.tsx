import type { Metadata } from "next";
import { db } from "@/lib/db";
import { PdfEditorPage } from "@/modules/office/pdf/editor";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ template?: string; matter?: string; blob?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const doc = id === "new" ? null : db().officeDocs.get(id);
  return { title: doc ? `${doc.title} · PDF` : "New PDF · PDF" };
}

/** PDF editor: /office/pdf/[id]; "new" opens the import dropzone, ?template=<id> generates from a template, ?blob=<id> opens an existing blob. */
export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const matters = db().matters.list({ sortBy: "shortName" });
  return <PdfEditorPage id={id} templateId={sp.template ?? null} blobId={sp.blob ?? null} matterId={sp.matter ?? null} matters={matters} />;
}
