import { jsonError } from "@/lib/ai/sse";
import { deleteUpdate } from "@/modules/home/service";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return deleteUpdate(id) ? Response.json({ ok: true }) : jsonError("Update not found", 404);
}
