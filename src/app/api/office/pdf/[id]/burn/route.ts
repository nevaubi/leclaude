import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { burnIn } from "@/modules/office/pdf/service";
import { normalizeModel } from "@/modules/office/pdf/model";
import { saveOfficeDoc } from "@/modules/office/shared/docs-service";

export const runtime = "nodejs";
export const maxDuration = 180;

type Params = { params: Promise<{ id: string }> };

/**
 * Bake the current model into a new source PDF ("apply to source"):
 * redactions (with client-rasterized pages for true content removal),
 * stamps/markups, Bates numbers, form values, page operations.
 * Body: { content?: model (saved first), applyRedactions?, flattenAnnotations?, flattenForms?, bates?, rasterizedPages?: { [sourcePage]: pngDataUrl }, label? }.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { content?: unknown; applyRedactions?: boolean; flattenAnnotations?: boolean; flattenForms?: boolean; bates?: boolean; rasterizedPages?: Record<number, string>; label?: string } | null;
  if (!body) return jsonError("Invalid body");
  try {
    if (body.content) { const saved = saveOfficeDoc(id, { content: normalizeModel(body.content) }); if (!saved) return jsonError("Document not found", 404); }
    const r = await burnIn(id, { applyRedactions: body.applyRedactions, flattenAnnotations: body.flattenAnnotations, flattenForms: body.flattenForms, bates: body.bates, rasterizedPages: body.rasterizedPages, label: body.label });
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ doc: { ...r.doc, content: undefined }, model: r.model });
  } catch (e) {
    return jsonError(`Apply failed: ${(e as Error).message}`, 500);
  }
}
