import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";
import { originalOf } from "@/modules/ediscovery/ingest";

export const runtime = "nodejs";

/** GET → the original uploaded file of an ingested document (attachment download; bytes exactly as received). */
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = db().edocs.get(id);
  if (!doc) return jsonError(`No document ${id}`, 404);
  const orig = originalOf(doc);
  const blob = orig ? db().blobs.get(orig.blobId) : null;
  if (!orig || !blob) return jsonError("This document has no stored original file", 404);
  // The blob must belong to the document's matter; a mismatch is a data error, never served.
  if (blob.meta?.matterId !== doc.matterId) return jsonError("Original file does not belong to this matter", 409);
  const name = orig.name.replace(/["\\\r\n]/g, "_");
  return new Response(Buffer.from(blob.bytes), {
    headers: {
      "Content-Type": orig.mime || "application/octet-stream",
      "Content-Length": String(blob.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(orig.name)}`,
      "X-Content-SHA256": orig.sha256,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = withAuth(handleGET, { action: "read", resource: (_req, p: { id: string }) => refs.edoc(p.id) });
