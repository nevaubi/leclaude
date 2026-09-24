import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { deleteFactMatrix, listFactMatrices } from "@/modules/ediscovery/analysis/service";
import { buildFactMatrix } from "@/modules/ediscovery/analysis/ai";

export const runtime = "nodejs";

/** GET ?matter= → { matrices } */
export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  return Response.json({ matrices: listFactMatrices(m.matterId) });
}

/** POST { matterId, topic, witnessId? } → 201 { matrix } (503 no_api_key without a key) */
export async function POST(req: NextRequest) {
  const body = await readJson<{ matterId?: string; topic?: string; witnessId?: string }>(req);
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  if (!body?.topic?.trim()) return jsonError("`topic` is required");
  try {
    return Response.json({ matrix: await buildFactMatrix(m.matterId, { topic: body.topic.trim(), witnessId: body.witnessId, signal: req.signal }) }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}

/** DELETE ?id= */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("`id` is required");
  return Response.json({ ok: deleteFactMatrix(id) });
}
