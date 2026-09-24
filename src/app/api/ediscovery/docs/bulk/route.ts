import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { bulkCode } from "@/modules/ediscovery/service";
import type { BulkCodingRequest } from "@/modules/ediscovery/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await readJson<BulkCodingRequest>(req);
  if (!body?.ids?.length) return jsonError("`ids` is required");
  if (body.ids.length > 2000) return jsonError("Too many ids (max 2000)");
  try {
    return Response.json(bulkCode({ ...body, patch: body.patch ?? {} }));
  } catch (e) {
    return errorResponse(e);
  }
}
