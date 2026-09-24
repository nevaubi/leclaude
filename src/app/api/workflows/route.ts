import { z } from "zod";
import { jsonError } from "@/lib/ai/sse";
import { boolParam, bootstrap, errorResponse, param, parseBody } from "@/modules/workflows/api-utils";
import { workflowUpsertSchema } from "@/modules/workflows/schema";
import { cloneWorkflow, createWorkflow, listWorkflows } from "@/modules/workflows/service";

export const runtime = "nodejs";

/** GET /api/workflows?template=1|0&mine=1&category=&q=&status=&tag= */
export async function GET(req: Request) {
  bootstrap();
  const url = new URL(req.url);
  const workflows = listWorkflows({ template: boolParam(url, "template"), mine: boolParam(url, "mine"), category: param(url, "category"), q: param(url, "q"), status: param(url, "status"), tag: param(url, "tag"), limit: Number(param(url, "limit") ?? 500) });
  return Response.json({ workflows });
}

const createSchema = z.union([
  z.object({ fromTemplateId: z.string().min(1), name: z.string().max(140).optional(), status: z.enum(["draft", "active", "archived"]).optional() }),
  workflowUpsertSchema,
]);

/** POST /api/workflows — create from a body, or clone a template with { fromTemplateId }. */
export async function POST(req: Request) {
  bootstrap();
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.res;
  try {
    if ("fromTemplateId" in body.data) {
      const workflow = cloneWorkflow(body.data.fromTemplateId, { name: body.data.name, status: body.data.status });
      if (!workflow) return jsonError("Template not found", 404);
      return Response.json({ workflow, issues: [] }, { status: 201 });
    }
    const { workflow, issues } = createWorkflow(body.data);
    return Response.json({ workflow, issues }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
