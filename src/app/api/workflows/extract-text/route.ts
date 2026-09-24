import { z } from "zod";
import { jsonError } from "@/lib/ai/sse";
import { bootstrap, parseBody } from "@/modules/workflows/api-utils";
import { extractTextFromBlob } from "@/modules/workflows/extract-text";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/workflows/extract-text { blobId } → { text, method, pages, truncated } for file inputs uploaded through /api/blobs. */
export async function POST(req: Request) {
  bootstrap();
  const body = await parseBody(req, z.object({ blobId: z.string().min(1) }));
  if (!body.ok) return body.res;
  try {
    const res = await extractTextFromBlob(body.data.blobId);
    return Response.json(res);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not extract text", 422, { code: "extract_failed" });
  }
}
