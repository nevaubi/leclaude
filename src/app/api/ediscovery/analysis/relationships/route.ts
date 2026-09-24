import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { createRelationship, deleteRelationship } from "@/modules/ediscovery/analysis/service";
import type { Relationship } from "@/lib/types/domain";

export const runtime = "nodejs";

/** POST { matterId, fromId, toId, kind, weight?, label?, evidence? } → 201 { relationship } */
export async function POST(req: NextRequest) {
  const body = await readJson<{ matterId?: string; fromId?: string; toId?: string; kind?: Relationship["kind"]; weight?: number; label?: string; evidence?: Relationship["evidence"] }>(req);
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  if (!body?.fromId || !body.toId || !body.kind) return jsonError("`fromId`, `toId` and `kind` are required");
  try {
    return Response.json({ relationship: createRelationship(m.matterId, { fromId: body.fromId, toId: body.toId, kind: body.kind, weight: body.weight, label: body.label, evidence: body.evidence }) }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}

/** DELETE ?id= */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("`id` is required");
  return Response.json({ ok: deleteRelationship(id) });
}
