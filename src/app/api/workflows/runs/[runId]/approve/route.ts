import { withDb } from "@/lib/db/request";
import { bootstrap, errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { resumeRun } from "@/modules/workflows/engine";
import { approvalSchema } from "@/modules/workflows/schema";
import { summarizeRun } from "@/modules/workflows/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** POST /api/workflows/runs/[runId]/approve { approved, comment } → resumes (or cancels) the run. */
async function handlePOST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  bootstrap();
  const { runId } = await params;
  const body = await parseBody(req, approvalSchema);
  if (!body.ok) return body.res;
  try {
    const run = await resumeRun(runId, { approved: body.data.approved, comment: body.data.comment });
    return Response.json({ run: summarizeRun(run) });
  } catch (e) { return errorResponse(e); }
}

export const POST = withDb(withAuth(handlePOST, { action: "approve", resource: (_req, { runId }) => refs.workflowRun(runId) }));
