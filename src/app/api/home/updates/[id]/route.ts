import { jsonError } from "@/lib/ai/sse";
import { deleteUpdate } from "@/modules/home/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleDELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return deleteUpdate(id) ? Response.json({ ok: true }) : jsonError("Update not found", 404);
}

export const DELETE = withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => refs.update(id) });
