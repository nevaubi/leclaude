import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { deleteConflict, getConflict, updateConflict } from "@/modules/ediscovery/analysis/service";
import type { Conflict } from "@/lib/types/domain";

export const runtime = "nodejs";

/** GET → { conflict: ConflictRow, notes } */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = getConflict(id);
  if (!res) return jsonError(`No conflict ${id}`, 404);
  return Response.json(res);
}

/** PATCH { status? | severity? | title? | analysis? | kind? | addSide? | removeSideIndex? } → { conflict } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<Partial<Pick<Conflict, "status" | "severity" | "title" | "analysis" | "kind">> & { addSide?: Conflict["sides"][number]; removeSideIndex?: number }>(req);
  if (!body) return jsonError("Invalid JSON body");
  try {
    const c = updateConflict(id, body);
    if (!c) return jsonError(`No conflict ${id}`, 404);
    return Response.json(getConflict(id));
  } catch (e) { return errorResponse(e); }
}

/** DELETE → { ok } */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ ok: deleteConflict(id) });
}
