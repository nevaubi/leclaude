import { bootstrap, errorResponse } from "@/modules/workflows/api-utils";
import { rerun } from "@/modules/workflows/engine";

export const runtime = "nodejs";

/** POST /api/workflows/runs/[runId]/rerun → starts a new run with the same inputs. */
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  bootstrap();
  const { runId } = await params;
  try {
    const run = await rerun(runId);
    return Response.json({ run: { id: run.id, status: run.status, workflowId: run.workflowId, startedAt: run.startedAt, parentRunId: run.parentRunId } }, { status: 202 });
  } catch (e) { return errorResponse(e); }
}
