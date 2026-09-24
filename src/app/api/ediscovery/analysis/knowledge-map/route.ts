import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { listKnowledgeMaps } from "@/modules/ediscovery/analysis/service";
import { knowledgeMap } from "@/modules/ediscovery/analysis/ai";

export const runtime = "nodejs";

/** GET ?matter= → { maps } */
export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  return Response.json({ maps: listKnowledgeMaps(m.matterId) });
}

/** POST { matterId, topic } → 201 { map } (503 no_api_key without a key) */
export async function POST(req: NextRequest) {
  const body = await readJson<{ matterId?: string; topic?: string }>(req);
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  if (!body?.topic?.trim()) return jsonError("`topic` is required");
  try {
    return Response.json({ map: await knowledgeMap(m.matterId, { topic: body.topic.trim(), signal: req.signal }) }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
