import type { Metadata } from "next";
import { db } from "@/lib/db";
import { SheetEditorPage } from "@/modules/office/sheet/editor";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ template?: string; matter?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const doc = id === "new" ? null : db().officeDocs.get(id);
  return { title: doc ? `${doc.title} · Excel` : "New workbook · Excel" };
}

/** Excel editor: /office/sheet/[id]; "new" creates (optionally from ?template=<id>&matter=<id>). */
export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const matters = db().matters.list({ sortBy: "shortName" });
  return <SheetEditorPage id={id} templateId={sp.template ?? null} matterId={sp.matter ?? null} matters={matters} />;
}
