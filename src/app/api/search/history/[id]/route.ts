import { jsonError } from "@/lib/ai/sse";
import { deleteRun, getRun } from "@/modules/search/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: Request, { params }: Params) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return jsonError("Not found", 404);
  return Response.json({ run });
}

async function handleDELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteRun(id) });
}

export const GET = withAuth(handleGET, { action: "read", resource: (_req, { id }) => refs.research(id) });
export const DELETE = withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => refs.research(id) });
