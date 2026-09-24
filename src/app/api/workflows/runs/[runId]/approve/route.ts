import { bootstrap, errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { resumeRun } from "@/modules/workflows/engine";
import { approvalSchema } from "@/modules/workflows/schema";
import { summarizeRun } from "@/modules/workflows/service";

export const runtime = "nodejs";

/** POST /api/workflows/runs/[runId]/approve { approved, comment } → resumes (or cancels) the run. */
export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  bootstrap();
  const { runId } = await params;
  const body = await parseBody(req, approvalSchema);
  if (!body.ok) return body.res;
  try {
    const run = await resumeRun(runId, { approved: body.data.approved, comment: body.data.comment });
    return Response.json({ run: summarizeRun(run) });
  } catch (e) { return errorResponse(e); }
}
