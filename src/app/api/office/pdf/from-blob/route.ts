import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { createFromBlob } from "@/modules/office/pdf/service";
import { withAuth } from "@/lib/auth/route";
import { officeCollection } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Open an existing blob as a PDF document (creates or reuses the document). Body: { blobId, matterId?, title? }. */
async function handlePOST(req: NextRequest) {
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

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: officeCollection }));
