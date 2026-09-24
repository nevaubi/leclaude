import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { jsonError } from "@/lib/ai/sse";
import { blobs, db } from "@/lib/db";
import type { OfficeKind } from "@/lib/types/domain";
import { createOfficeDoc } from "@/modules/office/shared/docs-service";
import { matterFolderId, LIBRARY_FOLDERS } from "@/modules/library/ids";
import { dispatchInboundEvent } from "@/modules/workflows/inbound";
import { extractPlainText } from "@/lib/ai/toolkit/internal";

export const runtime = "nodejs";
export const maxDuration = 120;

const KIND_BY_EXT: Record<string, OfficeKind> = { docx: "word", doc: "word", rtf: "word", md: "word", txt: "word", html: "word", xlsx: "sheet", xlsm: "sheet", xls: "sheet", csv: "sheet", tsv: "sheet", pptx: "slides", pdf: "pdf" };

/**
 * Import an uploaded file into the matching editor. multipart: file, optional matterId, folderId.
 * Each editor implements `importDocument()` in src/modules/office/<kind>/import.ts.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("`file` is required (multipart/form-data)");
  const matterId = (form?.get("matterId") as string | null) ?? undefined;
  const folderId = (form?.get("folderId") as string | null) ?? undefined;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = ((form?.get("kind") as string | null) as OfficeKind | null) ?? KIND_BY_EXT[ext];
  if (!kind) return jsonError(`Unsupported file type .${ext}`, 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const importer = await ({
    word: () => import("@/modules/office/word/import"),
    sheet: () => import("@/modules/office/sheet/import"),
    slides: () => import("@/modules/office/slides/import"),
    pdf: () => import("@/modules/office/pdf/import"),
  }[kind])();
  let imported: { title: string; content: unknown; meta?: Record<string, unknown> };
  try { imported = await importer.importDocument(bytes, file.name); } catch (e) { return jsonError(`Import failed: ${(e as Error).message}`, 422); }
  const original = blobs.put(bytes, file.type || "application/octet-stream", { name: file.name, meta: { kind } });
  const doc = createOfficeDoc({ kind, title: imported.title || file.name.replace(/\.[^.]+$/, ""), content: imported.content, matterId, folderId, meta: { ...(imported.meta ?? {}), originalBlobId: original.id, originalName: file.name } });
  const now = new Date().toISOString();
  const libType = ({ word: "docx", sheet: "xlsx", slides: "pptx", pdf: "pdf" } as const)[kind];
  db().library.put({ id: `lib_${nanoid(10)}`, parentId: folderId ?? (matterId ? matterFolderId(matterId) : LIBRARY_FOLDERS.myFiles), name: doc.title, type: libType, matterId, officeDocId: doc.id, size: bytes.byteLength, createdAt: now, updatedAt: now, sharedWith: ["firm"] });
  // Fire document_added workflows (fire-and-forget; runs stream their own progress).
  const folder = folderId ? db().library.get(folderId)?.name : undefined;
  void dispatchInboundEvent({ type: "document_added", matterId, payload: { documentId: doc.id, title: doc.title, kind, folderName: folder, text: extractPlainText(imported.content).slice(0, 200_000), url: `/office/${kind}/${doc.id}` } }).catch((e) => console.warn("[import] workflow dispatch failed", (e as Error).message));
  return Response.json({ doc: { ...doc, content: undefined }, kind, url: `/office/${kind}/${doc.id}` });
}
