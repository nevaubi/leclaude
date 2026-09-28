import { withDb } from "@/lib/db/request";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { drainQueuedRunsSoon } from "@/modules/intel/autoconfig";
import { kickRunner } from "@/modules/intel/background";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { runSourceNow } from "@/modules/intel/jobs";
import { getSource } from "@/modules/intel/service";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST { wait?: boolean, maxDocs?: number, backfillDays?: number } → { job }. With wait, the run executes inline and
 * the finished job is returned. backfillDays (1-3650) searches that far back instead of the incremental window.
 */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  intelBootstrap();
  const { id } = await params;
  if (!getSource(id)) return jsonError("Source not found", 404);
  const body = (await req.json().catch(() => ({}))) as { wait?: boolean; maxDocs?: number; backfillDays?: number };
  const days = typeof body.backfillDays === "number" && Number.isFinite(body.backfillDays) ? Math.round(body.backfillDays) : undefined;
  if (days !== undefined && (days < 1 || days > 3650)) return jsonError("backfillDays must be between 1 and 3650", 422);
  const since = days !== undefined ? new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10) : undefined;
  try {
    const job = await runSourceNow(id, { wait: Boolean(body.wait), maxDocs: typeof body.maxDocs === "number" ? body.maxDocs : undefined, since });
    // A persistent host's in-process loop picks the job up; on serverless hosts there is no loop, so work the queue
    // right after the response instead of leaving the run for the next cron tick.
    if (!body.wait && !kickRunner()) drainQueuedRunsSoon();
    return Response.json({ job });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "run", resource: (_req, { id }) => ({ kind: "intel", id }) }));
