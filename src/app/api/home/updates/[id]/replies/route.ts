import { jsonError } from "@/lib/ai/sse";
import { addReply } from "@/modules/home/service";
import { replySchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, replySchema);
  if (!body.ok) return body.res;
  const reply = addReply(id, body.data.body);
  return reply ? Response.json({ reply }, { status: 201 }) : jsonError("Update not found", 404);
}
