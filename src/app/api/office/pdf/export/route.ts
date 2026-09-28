import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { exportPdf, safeName, type ExportRequest } from "@/modules/office/pdf/service";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Export a PDF. Body: { docId | content, title?, options: { flattenAnnotations, applyRedactions, bates, fillForms, flattenForms, decorations, bookmarks, skipResolved, rasterizedPages: { [sourcePage]: pngDataUrl } } }.
 * Returns application/pdf.
 */
async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ExportRequest | null;
  if (!body || (!body.docId && !body.content)) return jsonError("`docId` or `content` is required");
  try {
    const { bytes, title, report } = await exportPdf(body);
    const headers: Record<string, string> = { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName(title)}.pdf"`, "Content-Length": String(bytes.byteLength) };
    // Redaction outcome for the client (no redacted text): verification status and method per source page.
    if (report.redaction) headers["X-LeClaude-Redaction"] = `${report.redaction.verification?.status ?? "unverified"}; ${report.redaction.pages.map((p) => `p${p.page}=${p.method}`).join(",")}`;
    return new Response(bytes as unknown as BodyInit, { headers });
  } catch (e) {
    const msg = (e as Error).message;
    return jsonError(`Export failed: ${msg}`, /not found/i.test(msg) ? 404 : /verification failed|cannot be applied/i.test(msg) ? 422 : 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "export", resource: officeDocFromBody }));
