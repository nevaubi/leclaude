import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { findContradictions } from "@/modules/ediscovery/analysis/ai";

export const runtime = "nodejs";

/** POST { matterId, depositionId, topic, indexes? } → { created: Conflict[], considered } (503 no_api_key without a key) */
export async function POST(req: NextRequest) {
  const body = await readJson<{ matterId?: string; depositionId?: string; topic?: string; indexes?: number[] }>(req);
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  if (!body?.depositionId) return jsonError("`depositionId` is required");
  try {
    const res = await findContradictions(m.matterId, { depositionId: body.depositionId, topic: body.topic?.trim() || "all topics", indexes: body.indexes, signal: req.signal });
    return Response.json(res, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
