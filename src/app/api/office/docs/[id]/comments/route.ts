import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { addComment, deleteComment, listComments, updateComment } from "@/modules/office/shared/docs-service";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return Response.json({ comments: listComments(id) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { anchor: string; body: string; quote?: string; source?: "user" | "agent" } | null;
  if (!body?.anchor || !body.body) return jsonError("`anchor` and `body` are required");
  return Response.json({ comment: addComment(id, body) });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { commentId: string; resolved?: boolean; body?: string; reply?: string } | null;
  if (!body?.commentId) return jsonError("`commentId` is required");
  const c = updateComment(body.commentId, body);
  return c ? Response.json({ comment: c }) : jsonError("Not found", 404);
}

export async function DELETE(req: NextRequest) {
  const commentId = req.nextUrl.searchParams.get("commentId");
  if (!commentId) return jsonError("`commentId` is required");
  return Response.json({ ok: deleteComment(commentId) });
}
