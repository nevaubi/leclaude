import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { compressDocument } from "@/modules/office/pdf/service";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromParams } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Re-save the source PDF with object streams. Returns sizes and the updated model. */
async function handlePOST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const r = await compressDocument(id);
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ before: r.before, after: r.after, saved: r.before - r.after, doc: { ...r.loaded.doc, content: undefined }, model: r.loaded.model });
  } catch (e) {
    return jsonError(`Compress failed: ${(e as Error).message}`, 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: officeDocFromParams }));
