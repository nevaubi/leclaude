import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { compressDocument } from "@/modules/office/pdf/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Re-save the source PDF with object streams. Returns sizes and the updated model. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const r = await compressDocument(id);
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ before: r.before, after: r.after, saved: r.before - r.after, doc: { ...r.loaded.doc, content: undefined }, model: r.loaded.model });
  } catch (e) {
    return jsonError(`Compress failed: ${(e as Error).message}`, 500);
  }
}
