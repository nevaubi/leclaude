import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { burnIn } from "@/modules/office/pdf/service";
import { normalizeModel } from "@/modules/office/pdf/model";
import { saveOfficeDoc } from "@/modules/office/shared/docs-service";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromParams } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 180;

type Params = { params: Promise<{ id: string }> };

/**
 * Bake the current model into a new source PDF ("apply to source"):
 * redactions (true removal from the content stream, server-side rasterization
 * only where editing is unsafe, verified by re-extraction), stamps/markups,
 * Bates numbers, form values, page operations.
 * Body: { content?: model (saved first), applyRedactions?, flattenAnnotations?, flattenForms?, bates?, forceRasterize?, rasterizedPages?: { [sourcePage]: pngDataUrl }, label? }.
 * Returns { doc, model, report } — report.redaction lists the method per page and the verification.
 */
async function handlePOST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { content?: unknown; applyRedactions?: boolean; flattenAnnotations?: boolean; flattenForms?: boolean; bates?: boolean; forceRasterize?: boolean; rasterizedPages?: Record<number, string>; label?: string } | null;
  if (!body) return jsonError("Invalid body");
  try {
    if (body.content) { const saved = saveOfficeDoc(id, { content: normalizeModel(body.content) }); if (!saved) return jsonError("Document not found", 404); }
    const r = await burnIn(id, { applyRedactions: body.applyRedactions, flattenAnnotations: body.flattenAnnotations, flattenForms: body.flattenForms, bates: body.bates, forceRasterize: body.forceRasterize === true, rasterizedPages: body.rasterizedPages, label: body.label });
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ doc: { ...r.doc, content: undefined }, model: r.model, report: r.report });
  } catch (e) {
    const msg = (e as Error).message;
    return jsonError(`Apply failed: ${msg}`, /verification failed|cannot be applied/i.test(msg) ? 422 : 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: officeDocFromParams }));
