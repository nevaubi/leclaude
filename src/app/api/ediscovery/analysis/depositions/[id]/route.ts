import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { getDeposition, listDesignations, objectionSummary, resolveExhibit, toggleFlag, updateQA } from "@/modules/ediscovery/analysis/service";
import type { QAFlag } from "@/modules/ediscovery/analysis/types";

export const runtime = "nodejs";

/** GET → { deposition, designations, objections, exhibits: [{id, description, bates, docId}] } */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dep = getDeposition(id);
  if (!dep) return jsonError(`No deposition ${id}`, 404);
  const exhibits = (dep.exhibits ?? []).map((e) => ({ ...e, docId: resolveExhibit(dep, e.id).docId }));
  return Response.json({ deposition: dep, designations: listDesignations(id), objections: objectionSummary(id), exhibits });
}

/** PATCH { index, flags? | toggle?: QAFlag, note? } → { qa } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ index?: number; flags?: QAFlag[]; toggle?: QAFlag; note?: string | null }>(req);
  if (!body || typeof body.index !== "number") return jsonError("`index` is required");
  try {
    const dep = body.toggle ? toggleFlag(id, body.index, body.toggle) : updateQA(id, body.index, { flags: body.flags, note: body.note });
    if (!dep) return jsonError(`No deposition ${id}`, 404);
    return Response.json({ qa: dep.transcript[body.index], index: body.index });
  } catch (e) { return errorResponse(e); }
}
