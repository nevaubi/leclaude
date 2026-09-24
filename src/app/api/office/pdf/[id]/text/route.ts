import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { documentText, safeName } from "@/modules/office/pdf/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Extracted text as .txt (?markers=0 to omit page markers). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const r = await documentText(id, req.nextUrl.searchParams.get("markers") !== "0");
    if (!r) return jsonError("Document not found", 404);
    return new Response(r.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${safeName(r.title)}.txt"` } });
  } catch (e) {
    return jsonError(`Extraction failed: ${(e as Error).message}`, 500);
  }
}
