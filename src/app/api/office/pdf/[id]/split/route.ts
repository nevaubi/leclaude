import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { parsePageRange } from "@/modules/office/pdf/model";
import { loadPdf, splitToNewDocument } from "@/modules/office/pdf/service";
import { activePages } from "@/modules/office/pdf/model";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Extract pages into a new document. Body: { pages: "1-3,5" | number[], title? }. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { pages?: string | number[]; title?: string } | null;
  if (!body?.pages) return jsonError("`pages` is required");
  const loaded = loadPdf(id);
  if (!loaded) return jsonError("Document not found", 404);
  const max = activePages(loaded.model).length;
  const pages = Array.isArray(body.pages) ? body.pages.map(Number).filter((n) => n >= 1 && n <= max) : parsePageRange(body.pages, max);
  if (!pages.length) return jsonError("No valid pages in range");
  try {
    const r = await splitToNewDocument(id, pages, body.title);
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ doc: { ...r.doc, content: undefined }, url: r.url, pages });
  } catch (e) {
    return jsonError(`Split failed: ${(e as Error).message}`, 500);
  }
}
