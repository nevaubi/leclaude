import { jsonError } from "@/lib/ai/sse";
import { bootstrap, errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { startRun } from "@/modules/workflows/engine";
import { runStartSchema } from "@/modules/workflows/schema";
import { getWorkflow } from "@/modules/workflows/service";

export const runtime = "nodejs";

/** POST /api/workflows/[id]/run { inputs, matterId } → { run } (the run executes in the background; stream progress from /runs/[runId]/stream). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  bootstrap();
  const { id } = await params;
  const workflow = getWorkflow(id);
  if (!workflow) return jsonError("Workflow not found", 404);
  const body = await parseBody(req, runStartSchema);
  if (!body.ok) return body.res;
  try {
    const run = await startRun(workflow, { inputs: body.data.inputs ?? {}, matterId: body.data.matterId ?? undefined, triggeredBy: body.data.triggeredBy ?? "manual" });
    return Response.json({ run: { id: run.id, status: run.status, workflowId: run.workflowId, startedAt: run.startedAt } }, { status: 202 });
  } catch (e) { return errorResponse(e); }
}
