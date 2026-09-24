import { bootstrap, errorResponse } from "@/modules/workflows/api-utils";
import { rerun } from "@/modules/workflows/engine";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** POST /api/workflows/runs/[runId]/rerun → starts a new run with the same inputs. */
async function handlePOST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  bootstrap();
  const { runId } = await params;
  try {
    const run = await rerun(runId);
    return Response.json({ run: { id: run.id, status: run.status, workflowId: run.workflowId, startedAt: run.startedAt, parentRunId: run.parentRunId } }, { status: 202 });
  } catch (e) { return errorResponse(e); }
}

export const POST = withAuth(handlePOST, { action: "run", resource: (_req, { runId }) => refs.workflowRun(runId) });
