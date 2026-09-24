import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import type { ReviewBatch } from "@/lib/types/domain";
import { ensureReview, errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { deleteBatch, getBatch, updateBatch } from "@/modules/ediscovery/review-service";

export const runtime = "nodejs";

/** GET → { batch: ReviewBatchSummary & { disagreements } } */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  ensureReview();
  const batch = getBatch(id);
  if (!batch) return jsonError(`No batch ${id}`, 404);
  return Response.json({ batch });
}

/** PATCH { name?, description?, assigneeId?, priority?, dueAt?, status?, qcSamplePercent?, secondPass? } → { batch } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<Partial<Pick<ReviewBatch, "name" | "description" | "assigneeId" | "priority" | "dueAt" | "status" | "qcSamplePercent" | "secondPass">>>(req);
  if (!body) return jsonError("Invalid JSON body");
  try {
    const batch = updateBatch(id, body);
    if (!batch) return jsonError(`No batch ${id}`, 404);
    return Response.json({ batch: getBatch(id) });
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return deleteBatch(id) ? Response.json({ ok: true }) : jsonError(`No batch ${id}`, 404);
}
