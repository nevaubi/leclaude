import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { exportPdf, safeName, type ExportRequest } from "@/modules/office/pdf/service";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Export a PDF. Body: { docId | content, title?, options: { flattenAnnotations, applyRedactions, bates, fillForms, flattenForms, decorations, bookmarks, skipResolved, rasterizedPages: { [sourcePage]: pngDataUrl } } }.
 * Returns application/pdf.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ExportRequest | null;
  if (!body || (!body.docId && !body.content)) return jsonError("`docId` or `content` is required");
  try {
    const { bytes, title } = await exportPdf(body);
    return new Response(bytes as unknown as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName(title)}.pdf"`, "Content-Length": String(bytes.byteLength) } });
  } catch (e) {
    const msg = (e as Error).message;
    return jsonError(`Export failed: ${msg}`, /not found/i.test(msg) ? 404 : 500);
  }
}
