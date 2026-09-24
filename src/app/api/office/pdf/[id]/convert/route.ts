import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { convertToWord } from "@/modules/office/pdf/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Convert the PDF's extracted text into a new Word document. Body: { title?, markdown? }. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { title?: string; markdown?: string };
  try {
    const r = await convertToWord(id, body);
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ doc: { ...r.doc, content: undefined }, url: r.url });
  } catch (e) {
    return jsonError(`Conversion failed: ${(e as Error).message}`, 500);
  }
}
