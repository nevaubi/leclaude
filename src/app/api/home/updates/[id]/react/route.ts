import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { toggleReaction } from "@/modules/home/service";
import { reactionSchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, reactionSchema);
  if (!body.ok) return body.res;
  const update = toggleReaction(id, body.data.emoji);
  return update ? Response.json({ update }) : jsonError("Update not found", 404);
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: (_req, { id }) => refs.update(id) }));
