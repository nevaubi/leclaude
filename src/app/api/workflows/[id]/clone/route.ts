import { z } from "zod";
import { jsonError } from "@/lib/ai/sse";
import { bootstrap, parseBody } from "@/modules/workflows/api-utils";
import { cloneWorkflow, workflowForTemplate } from "@/modules/workflows/service";

export const runtime = "nodejs";

/**
 * POST /api/workflows/[id]/clone { name?, status?, reuse? } → a copy owned by the current user.
 * `reuse: true` (the gallery's Start action) returns the caller's existing, non-archived copy of a
 * template when there is one and otherwise creates an active copy; the response says which.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  bootstrap();
  const { id } = await params;
  const body = await parseBody(req, z.object({ name: z.string().max(140).optional(), status: z.enum(["draft", "active"]).optional(), reuse: z.boolean().optional() }).default({}));
  if (!body.ok) return body.res;
  if (body.data.reuse) {
    const workflow = workflowForTemplate(id);
    if (!workflow) return jsonError("Workflow not found", 404);
    return Response.json({ workflow, reused: workflow.id !== id && workflow.createdAt !== workflow.updatedAt ? true : undefined }, { status: workflow.id === id ? 200 : 201 });
  }
  const workflow = cloneWorkflow(id, { name: body.data.name, status: body.data.status });
  if (!workflow) return jsonError("Workflow not found", 404);
  return Response.json({ workflow }, { status: 201 });
}
