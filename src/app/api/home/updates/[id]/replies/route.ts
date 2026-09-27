import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { addReply } from "@/modules/home/service";
import { replySchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, replySchema);
  if (!body.ok) return body.res;
  const reply = addReply(id, body.data.body);
  return reply ? Response.json({ reply }, { status: 201 }) : jsonError("Update not found", 404);
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: (_req, { id }) => refs.update(id) }));
