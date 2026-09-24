import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { createFromBlob } from "@/modules/office/pdf/service";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Open an existing blob as a PDF document (creates or reuses the document). Body: { blobId, matterId?, title? }. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { blobId?: string; matterId?: string; title?: string; folderId?: string } | null;
  if (!body?.blobId) return jsonError("`blobId` is required");
  try {
    const r = await createFromBlob(body.blobId, { matterId: body.matterId, title: body.title, folderId: body.folderId });
    return Response.json({ doc: { ...r.doc, content: undefined }, url: r.url });
  } catch (e) {
    const msg = (e as Error).message;
    return jsonError(msg, /not found/i.test(msg) ? 404 : 500);
  }
}
