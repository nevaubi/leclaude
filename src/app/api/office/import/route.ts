import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { jsonError } from "@/lib/ai/sse";
import { blobs, db } from "@/lib/db";
import type { OfficeKind } from "@/lib/types/domain";
import { createOfficeDoc } from "@/modules/office/shared/docs-service";
import { matterFolderId, LIBRARY_FOLDERS } from "@/modules/library/ids";
import { dispatchInboundEvent } from "@/modules/workflows/inbound";
import { extractPlainText } from "@/lib/ai/toolkit/internal";
import { audit } from "@/lib/integrity/audit";
import { contentHash, sha256 } from "@/lib/integrity/hash";
import { suffixedName } from "@/lib/integrity/dedupe";

export const runtime = "nodejs";
export const maxDuration = 120;

const KIND_BY_EXT: Record<string, OfficeKind> = { docx: "word", doc: "word", rtf: "word", md: "word", txt: "word", html: "word", xlsx: "sheet", xlsm: "sheet", xls: "sheet", csv: "sheet", tsv: "sheet", pptx: "slides", pdf: "pdf" };

/**
 * Import an uploaded file into the matching editor. multipart: file, optional matterId, folderId, allowDuplicate.
 * Each editor implements `importDocument()` in src/modules/office/<kind>/import.ts.
 *
 * Deduplication: the upload's sha256 and the extracted text's contentHash are stored in doc.meta. An identical file
 * (same bytes or same text) already imported into the same matter is not imported twice: the response is
 * 409 { duplicate: true, existing: { id, title, kind, url, libraryItemId }, message } unless allowDuplicate=1.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("`file` is required (multipart/form-data)");
  const matterId = (form?.get("matterId") as string | null) ?? undefined;
  const folderId = (form?.get("folderId") as string | null) ?? undefined;
  const allowDuplicate = ["1", "true"].includes(String(form?.get("allowDuplicate") ?? ""));
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = ((form?.get("kind") as string | null) as OfficeKind | null) ?? KIND_BY_EXT[ext];
  if (!kind) return jsonError(`Unsupported file type .${ext}`, 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.byteLength) return jsonError("Empty upload");
  const byteHash = sha256(bytes);
  const d = db();
  const sameMatter = (o: { matterId?: string }) => (o.matterId ?? "") === (matterId ?? "");
  const byBytes = d.officeDocs.findOne((o) => sameMatter(o) && o.meta?.sha256 === byteHash);
  if (byBytes && !allowDuplicate) return duplicateResponse(byBytes, "This exact file was already imported");
  const importer = await ({
    word: () => import("@/modules/office/word/import"),
    sheet: () => import("@/modules/office/sheet/import"),
    slides: () => import("@/modules/office/slides/import"),
    pdf: () => import("@/modules/office/pdf/import"),
  }[kind])();
  let imported: { title: string; content: unknown; meta?: Record<string, unknown> };
  try { imported = await importer.importDocument(bytes, file.name); } catch (e) { return jsonError(`Import failed: ${(e as Error).message}`, 422); }
  const text = extractPlainText(imported.content);
  const textHash = text.trim().length > 40 ? contentHash(text) : undefined;
  const byText = textHash ? d.officeDocs.findOne((o) => o.kind === kind && sameMatter(o) && o.meta?.contentHash === textHash) : null;
  if (byText && !allowDuplicate) return duplicateResponse(byText, "A document with identical text was already imported");
  const original = blobs.put(bytes, file.type || "application/octet-stream", { name: file.name, meta: { kind, sha256: byteHash } });
  const parentId = folderId ?? (matterId ? matterFolderId(matterId) : LIBRARY_FOLDERS.myFiles);
  const taken = new Set(d.library.find((l) => l.parentId === parentId && l.type !== "folder").map((l) => l.name));
  const baseTitle = imported.title || file.name.replace(/\.[^.]+$/, "");
  const title = suffixedName(baseTitle, taken);
  const doc = createOfficeDoc({ kind, title, content: imported.content, matterId, folderId, meta: { ...(imported.meta ?? {}), originalBlobId: original.id, originalName: file.name, sha256: byteHash, contentHash: textHash, importedAt: new Date().toISOString() } });
  const now = new Date().toISOString();
  const libType = ({ word: "docx", sheet: "xlsx", slides: "pptx", pdf: "pdf" } as const)[kind];
  const libraryItemId = `lib_${nanoid(10)}`;
  d.library.put({ id: libraryItemId, parentId, name: doc.title, type: libType, matterId, officeDocId: doc.id, size: bytes.byteLength, createdAt: now, updatedAt: now, sharedWith: ["firm"] });
  audit("import", { kind: "officeDoc", id: doc.id, label: doc.title, matterId }, { file: file.name, bytes: bytes.byteLength, sha256: byteHash, contentHash: textHash, kind, libraryItemId, renamed: title !== baseTitle });
  // Fire document_added workflows (fire-and-forget; runs stream their own progress).
  const folder = folderId ? d.library.get(folderId)?.name : undefined;
  void dispatchInboundEvent({ type: "document_added", matterId, payload: { documentId: doc.id, title: doc.title, kind, folderName: folder, text: text.slice(0, 200_000), url: `/office/${kind}/${doc.id}` } }).catch((e) => console.warn("[import] workflow dispatch failed", (e as Error).message));
  return Response.json({ doc: { ...doc, content: undefined }, kind, url: `/office/${kind}/${doc.id}`, libraryItemId, sha256: byteHash, contentHash: textHash, duplicate: false });
}

function duplicateResponse(existing: { id: string; title: string; kind: OfficeKind; matterId?: string }, message: string) {
  const li = db().library.findOne((l) => l.officeDocId === existing.id);
  audit("import", { kind: "officeDoc", id: existing.id, label: existing.title, matterId: existing.matterId }, { duplicate: true, message });
  return Response.json({ duplicate: true, existing: { id: existing.id, title: existing.title, kind: existing.kind, url: `/office/${existing.kind}/${existing.id}`, libraryItemId: li?.id ?? null }, message: `${message}: "${existing.title}". Open the existing document or re-upload with allowDuplicate=1.` }, { status: 409 });
}
