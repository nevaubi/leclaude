import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { blobs } from "@/lib/db";
import type { OfficeComment } from "@/lib/types/domain";
import { getOfficeDoc, listComments } from "@/modules/office/shared/docs-service";
import type { DocSettings } from "@/modules/office/word/constants";
import { ensureBlockIds, type PMNode } from "@/modules/office/word/doc-model";
import { exportDocx, exportMarkdown, exportText, imageDimensions, type ExportImage } from "@/modules/office/word/export";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body { docId?: string; content?: PMNode; title?: string; format?: "docx" | "md" | "txt"; settings?: Partial<DocSettings>; changes?: "revisions" | "accepted"; includeComments?: boolean }

async function fetchImage(src: string): Promise<ExportImage | null> {
  let bytes: Uint8Array | null = null;
  const m = src.match(/^\/api\/blobs\/([A-Za-z0-9_-]+)/);
  if (m) { const b = blobs.get(m[1]); if (b) bytes = new Uint8Array(b.bytes); }
  else if (src.startsWith("data:")) { const i = src.indexOf(","); if (i > 0) bytes = Uint8Array.from(Buffer.from(src.slice(i + 1), src.slice(0, i).includes(";base64") ? "base64" : "utf8")); }
  else if (/^https?:\/\//.test(src)) { try { const r = await fetch(src, { signal: AbortSignal.timeout(8000) }); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); } catch { bytes = null; } }
  if (!bytes) return null;
  const dim = imageDimensions(bytes);
  if (!dim) return null;
  return { bytes, type: dim.type, width: dim.width || undefined, height: dim.height || undefined };
}

/** Export a document. Body: { docId | content, title?, format: docx|md|txt, settings?, changes?: revisions|accepted }. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return jsonError("Invalid body");
  let content = body.content;
  let title = body.title;
  let settings = body.settings;
  let comments: OfficeComment[] = [];
  if (body.docId) {
    const doc = getOfficeDoc(body.docId);
    if (!doc) return jsonError("Document not found", 404);
    content = content ?? (doc.content as PMNode);
    title = title ?? doc.title;
    settings = settings ?? ((doc.meta?.settings as Partial<DocSettings> | undefined) ?? undefined);
    if (body.includeComments !== false) comments = listComments(body.docId);
  }
  if (!content || content.type !== "doc") return jsonError("`content` (ProseMirror doc) or `docId` is required");
  const doc = ensureBlockIds(content);
  const safe = (title ?? "document").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "document";
  const format = body.format ?? "docx";
  if (format === "md") return new Response(exportMarkdown(doc, title ?? "Document"), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.md"` } });
  if (format === "txt") return new Response(exportText(doc), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.txt"` } });
  try {
    const buf = await exportDocx(doc, { title: title ?? "Document", settings, comments, fetchImage, changes: body.changes ?? "revisions" });
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${safe}.docx"`, "Content-Length": String(buf.byteLength) } });
  } catch (e) {
    return jsonError(`Export failed: ${(e as Error).message}`, 500);
  }
}
