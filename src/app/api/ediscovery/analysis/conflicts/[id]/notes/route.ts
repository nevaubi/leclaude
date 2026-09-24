import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { addConflictNote } from "@/modules/ediscovery/analysis/service";

export const runtime = "nodejs";

/** POST { body } → 201 { note } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ body?: string }>(req);
  if (!body?.body?.trim()) return jsonError("`body` is required");
  try {
    return Response.json({ note: addConflictNote(id, body.body) }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
