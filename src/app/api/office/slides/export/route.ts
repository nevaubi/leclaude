import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { blobs } from "@/lib/db";
import { getOfficeDoc } from "@/modules/office/shared/docs-service";
import { exportOutlineText, exportPptx } from "@/modules/office/slides/export";
import { normalizeDeck, type DeckContent } from "@/modules/office/slides/model";
import { sha256 } from "@/lib/integrity/hash";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

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

/**
 * The original package of an imported deck, loaded from the authorized stored document (never from the request):
 * `doc.meta.originalBlobId` must hold bytes whose sha256 equals the deck's recorded package hash. Anything else
 * (no document, no stored original, hash mismatch) exports a freshly generated package.
 */
function sourcePackageFor(docMeta: Record<string, unknown> | undefined, deck: DeckContent): Uint8Array | null {
  const want = deck.meta?.pptx?.sha256;
  const blobId = typeof docMeta?.originalBlobId === "string" ? docMeta.originalBlobId : null;
  if (!want || !blobId) return null;
  const blob = blobs.get(blobId);
  if (!blob) return null;
  const bytes = new Uint8Array(blob.bytes);
  return sha256(bytes) === want ? bytes : null;
}

/** Export a deck. Body: { docId | content, title?, format: pptx | txt, includeHidden?, includeNotes? }. */
async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return jsonError("Invalid body");
  let content = body.content;
  let title = body.title;
  let docMeta: Record<string, unknown> | undefined;
  if (body.docId) {
    const doc = getOfficeDoc(body.docId);
    if (!doc) return jsonError("Document not found", 404);
    content = content ?? doc.content;
    title = title ?? doc.title;
    docMeta = doc.meta;
  }
  if (!content || typeof content !== "object") return jsonError("`content` (deck) or `docId` is required");
  const deck = normalizeDeck(content);
  const safe = (title ?? "deck").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "deck";
  if (body.format === "txt") return new Response(exportOutlineText(deck, title ?? "Deck"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.txt"` } });
  try {
    let mode = "generated";
    const buf = await exportPptx(deck, { title: title ?? "Deck", fetchImage, includeHidden: body.includeHidden ?? true, includeNotes: body.includeNotes ?? true, sourcePackage: sourcePackageFor(docMeta, deck), onReport: (r) => { mode = r.mode; } });
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Content-Disposition": `attachment; filename="${safe}.pptx"`, "Content-Length": String(buf.byteLength), "X-Export-Mode": mode } });
  } catch (e) {
    return jsonError(`Export failed: ${(e as Error).message}`, 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "export", resource: officeDocFromBody }));
