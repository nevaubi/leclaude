import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { applyRedactionsToSource } from "@/modules/office/pdf/service";
import { normalizeModel } from "@/modules/office/pdf/model";
import { saveOfficeDoc } from "@/modules/office/shared/docs-service";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromParams } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 180;

type Params = { params: Promise<{ id: string }> };

/**
 * Apply the pending redactions only (constitution §41: true removal). Content under each box is removed from
 * the page content stream (pages where that is unsafe are rasterized server-side), annotations/fields/metadata
 * repeating the text are scrubbed, and the output is re-extracted to verify the text is gone before it is saved.
 * Other annotations stay editable (written as native PDF annotations). Body: { content?, forceRasterize? }.
 * Returns { doc, model, report } (report.redaction: per-page method, glyphs removed, verification).
 */
async function handlePOST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { content?: unknown; forceRasterize?: boolean } | null;
  try {
    if (body?.content) { const saved = saveOfficeDoc(id, { content: normalizeModel(body.content) }); if (!saved) return jsonError("Document not found", 404); }
    const r = await applyRedactionsToSource(id, { forceRasterize: body?.forceRasterize === true });
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ doc: { ...r.doc, content: undefined }, model: r.model, report: r.report });
  } catch (e) {
    const msg = (e as Error).message;
    return jsonError(`Redaction failed: ${msg}`, /verification failed|cannot be applied/i.test(msg) ? 422 : 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: officeDocFromParams }));
