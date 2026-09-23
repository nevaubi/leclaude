import { jsonError } from "@/lib/ai/sse";
import { deleteRun, getRun } from "@/modules/search/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return jsonError("Not found", 404);
  return Response.json({ run });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteRun(id) });
}
