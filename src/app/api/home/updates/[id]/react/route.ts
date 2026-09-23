import { jsonError } from "@/lib/ai/sse";
import { toggleReaction } from "@/modules/home/service";
import { reactionSchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, reactionSchema);
  if (!body.ok) return body.res;
  const update = toggleReaction(id, body.data.emoji);
  return update ? Response.json({ update }) : jsonError("Update not found", 404);
}
