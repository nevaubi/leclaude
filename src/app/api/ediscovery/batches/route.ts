import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import type { ReviewBatch } from "@/lib/types/domain";
import { ensureReview, errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { createBatches, listBatches } from "@/modules/ediscovery/review-service";
import type { BatchCreateInput } from "@/modules/ediscovery/types";

export const runtime = "nodejs";

/** GET ?matter=&assignee=&status= → { batches: ReviewBatchSummary[] } */
export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  ensureReview();
  const sp = req.nextUrl.searchParams;
  return Response.json({ batches: listBatches(m.matterId, { assigneeId: sp.get("assignee") ?? undefined, status: (sp.get("status") as ReviewBatch["status"] | null) ?? undefined }) });
}

/** POST BatchCreateInput → 201 { batches: ReviewBatch[] } (size splits the set into numbered batches). */
export async function POST(req: NextRequest) {
  const body = await readJson<BatchCreateInput>(req);
  if (!body) return jsonError("Invalid JSON body");
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  ensureReview();
  try {
    const batches = await createBatches({ ...body, matterId: m.matterId });
    return Response.json({ batches }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
