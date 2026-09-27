import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { bootstrap, errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { startRun } from "@/modules/workflows/engine";
import { runStartSchema } from "@/modules/workflows/schema";
import { getWorkflow, workflowForTemplate } from "@/modules/workflows/service";
import { withAuth } from "@/lib/auth/route";
import { bodyMatterId, refs } from "@/lib/auth/resources";
import { requirePrincipal } from "@/lib/auth/context";
import { hasMatterAccess } from "@/lib/auth/policy";

export const runtime = "nodejs";

/**
 * POST /api/workflows/[id]/run { inputs, matterId, frontend? } → { run }.
 * The run executes in the background; stream progress from /runs/[runId]/stream.
 * With `frontend: true` (the Start page) a template id is resolved to the
 * caller's own copy of the template, so run history never attaches to the
 * shared template; the response carries the workflow that actually ran.
 */
async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  bootstrap();
  const { id } = await params;
  let workflow = getWorkflow(id);
  if (!workflow) return jsonError("Workflow not found", 404);
  const body = await parseBody(req, runStartSchema);
  if (!body.ok) return body.res;
  const principal = requirePrincipal();
  // The run's matter can also come from the start form's matter input; it is authorized like the body's matterId.
  const inputMatter = typeof body.data.inputs?.matter === "string" ? body.data.inputs.matter.trim() : "";
  if (inputMatter && !hasMatterAccess(principal, inputMatter)) return jsonError("You do not have access to that matter", 403, { code: "matter_forbidden" });
  if (body.data.frontend && workflow.isTemplate) {
    const own = workflowForTemplate(id, { ownerId: principal.id });
    if (own) workflow = own;
  }
  try {
    const run = await startRun(workflow, { inputs: body.data.inputs ?? {}, matterId: body.data.matterId ?? undefined, triggeredBy: body.data.triggeredBy ?? "manual", triggeredById: principal.id });
    return Response.json({ run: { id: run.id, status: run.status, workflowId: run.workflowId, startedAt: run.startedAt }, workflow: { id: workflow.id, name: workflow.name } }, { status: 202 });
  } catch (e) { return errorResponse(e); }
}

export const POST = withDb(withAuth(handlePOST, { action: "run", resource: async (req, { id }) => ({ ...refs.workflow(id), matterId: await bodyMatterId(req) }) }));
