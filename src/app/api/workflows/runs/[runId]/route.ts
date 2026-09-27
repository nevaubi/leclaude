import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { bootstrap } from "@/modules/workflows/api-utils";
import { isRunActive } from "@/modules/workflows/engine";
import { deleteRun, getRun, getWorkflow } from "@/modules/workflows/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ runId: string }> };

async function handleGET(_req: Request, { params }: Ctx) {
  bootstrap();
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return jsonError("Run not found", 404);
  const workflow = getWorkflow(run.workflowId);
  return Response.json({ run, workflow: workflow ? { id: workflow.id, name: workflow.name, category: workflow.category, isTemplate: workflow.isTemplate, status: workflow.status } : null, active: isRunActive(runId) });
}

async function handleDELETE(_req: Request, { params }: Ctx) {
  bootstrap();
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return jsonError("Run not found", 404);
  if (isRunActive(runId)) return jsonError("Cancel the run before deleting it", 409);
  deleteRun(runId);
  return Response.json({ ok: true });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (_req, { runId }) => refs.workflowRun(runId) }));
export const DELETE = withDb(withAuth(handleDELETE, { action: "delete", resource: (_req, { runId }) => refs.workflowRun(runId) }));
