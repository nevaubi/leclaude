import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { ensureExtracted } from "@/modules/office/pdf/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * Materialize (template/seed documents) and extract text, outline and form
 * fields; the result is cached on the model. Returns the updated model plus
 * per-page positioned runs when ?runs=1. POST ?force=1 re-extracts.
 */
async function handle(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const force = req.nextUrl.searchParams.get("force") === "1";
  const withRuns = req.nextUrl.searchParams.get("runs") === "1";
  try {
    const r = await ensureExtracted(id, force);
    if (!r) return jsonError("Document not found", 404);
    const { loaded, extraction } = r;
    return Response.json({
      doc: { ...loaded.doc, content: undefined },
      model: loaded.model,
      extraction: { pageCount: extraction.pageCount, outline: extraction.outline, fields: extraction.fields, meta: extraction.meta, extractedAt: extraction.extractedAt, pages: extraction.pages.map((p) => ({ page: p.page, width: p.width, height: p.height, rotation: p.rotation, chars: p.text.length, runs: withRuns ? p.runs : undefined })) },
    });
  } catch (e) {
    return jsonError(`Extraction failed: ${(e as Error).message}`, 500);
  }
}

export const GET = handle;
export const POST = handle;
