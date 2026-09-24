import { z } from "zod";
import { jsonError } from "@/lib/ai/sse";
import { bootstrap, parseBody } from "@/modules/workflows/api-utils";
import { cloneWorkflow } from "@/modules/workflows/service";

export const runtime = "nodejs";

/** POST /api/workflows/[id]/clone { name?, status? } → draft copy owned by the current user. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  bootstrap();
  const { id } = await params;
  const body = await parseBody(req, z.object({ name: z.string().max(140).optional(), status: z.enum(["draft", "active"]).optional() }).default({}));
  if (!body.ok) return body.res;
  const workflow = cloneWorkflow(id, { name: body.data.name, status: body.data.status });
  if (!workflow) return jsonError("Workflow not found", 404);
  return Response.json({ workflow }, { status: 201 });
}
