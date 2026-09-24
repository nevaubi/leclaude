import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { blobs } from "@/lib/db";
import { getOfficeDoc } from "@/modules/office/shared/docs-service";
import { exportOutlineText, exportPptx } from "@/modules/office/slides/export";
import { normalizeDeck } from "@/modules/office/slides/model";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body { docId?: string; content?: unknown; title?: string; format?: "pptx" | "txt"; includeHidden?: boolean; includeNotes?: boolean }

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** Resolve an image src (blob url, data url, http url) to a base64 data URL for pptxgenjs. */
async function fetchImage(src: string): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  const m = src.match(/^\/api\/blobs\/([A-Za-z0-9_-]+)/);
  if (m) {
    const b = blobs.get(m[1]);
    if (!b) return null;
    const mime = b.mime.startsWith("image/") ? b.mime : "image/png";
    return `data:${mime};base64,${Buffer.from(b.bytes).toString("base64")}`;
  }
  if (/^https?:\/\//.test(src)) {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? MIME[src.split(".").pop()?.toLowerCase() ?? ""] ?? "image/png";
      return `data:${ct.split(";")[0]};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
    } catch { return null; }
  }
  return null;
}

/** Export a deck. Body: { docId | content, title?, format: pptx | txt, includeHidden?, includeNotes? }. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return jsonError("Invalid body");
  let content = body.content;
  let title = body.title;
  if (body.docId) {
    const doc = getOfficeDoc(body.docId);
    if (!doc) return jsonError("Document not found", 404);
    content = content ?? doc.content;
    title = title ?? doc.title;
  }
  if (!content || typeof content !== "object") return jsonError("`content` (deck) or `docId` is required");
  const deck = normalizeDeck(content);
  const safe = (title ?? "deck").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "deck";
  if (body.format === "txt") return new Response(exportOutlineText(deck, title ?? "Deck"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.txt"` } });
  try {
    const buf = await exportPptx(deck, { title: title ?? "Deck", fetchImage, includeHidden: body.includeHidden ?? true, includeNotes: body.includeNotes ?? true });
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Content-Disposition": `attachment; filename="${safe}.pptx"`, "Content-Length": String(buf.byteLength) } });
  } catch (e) {
    return jsonError(`Export failed: ${(e as Error).message}`, 500);
  }
}
