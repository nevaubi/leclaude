import { z } from "zod";
import { jsonError } from "@/lib/ai/sse";
import { bootstrap, errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { validateWorkflow } from "@/modules/workflows/graph";
import { workflowUpsertSchema } from "@/modules/workflows/schema";
import { deleteWorkflow, getWorkflow, listRuns, updateWorkflow } from "@/modules/workflows/service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  bootstrap();
  const { id } = await params;
  const workflow = getWorkflow(id);
  if (!workflow) return jsonError("Workflow not found", 404);
  const { issues } = validateWorkflow(workflow.nodes, workflow.edges);
  const recentRuns = listRuns({ workflowId: id, limit: 25 }).runs;
  return Response.json({ workflow, issues, recentRuns });
}

/** PUT: full save from the builder (validation issues are returned, drafts may be saved with errors; activating requires a valid graph). */
export async function PUT(req: Request, { params }: Ctx) {
  bootstrap();
  const { id } = await params;
  const body = await parseBody(req, workflowUpsertSchema.partial());
  if (!body.ok) return body.res;
  try {
    const cur = getWorkflow(id);
    if (!cur) return jsonError("Workflow not found", 404);
    const status = body.data.status ?? cur.status;
    if (status === "active" && body.data.nodes && body.data.edges) {
      const v = validateWorkflow(body.data.nodes as never, body.data.edges as never);
      if (!v.ok) return jsonError(`Cannot activate: ${v.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`, 422, { issues: v.issues, code: "invalid_workflow" });
    }
    const res = updateWorkflow(id, body.data);
    if (!res) return jsonError("Workflow not found", 404);
    return Response.json(res);
  } catch (e) { return errorResponse(e); }
}

const patchSchema = z.object({ status: z.enum(["draft", "active", "archived"]).optional(), name: z.string().min(1).max(140).optional(), description: z.string().max(2000).optional(), tags: z.array(z.string()).optional(), category: workflowUpsertSchema.shape.category.optional() });

/** PATCH: metadata / status only. */
export async function PATCH(req: Request, { params }: Ctx) {
  bootstrap();
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.res;
  const cur = getWorkflow(id);
  if (!cur) return jsonError("Workflow not found", 404);
  if (body.data.status === "active") {
    const v = validateWorkflow(cur.nodes, cur.edges);
    if (!v.ok) return jsonError(`Cannot activate: ${v.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`, 422, { issues: v.issues, code: "invalid_workflow" });
  }
  const res = updateWorkflow(id, body.data);
  return Response.json(res);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  bootstrap();
  const { id } = await params;
  const cur = getWorkflow(id);
  if (!cur) return jsonError("Workflow not found", 404);
  if (cur.isTemplate) return jsonError("Built-in templates cannot be deleted; archive your copy instead.", 403);
  deleteWorkflow(id);
  return Response.json({ ok: true });
}
