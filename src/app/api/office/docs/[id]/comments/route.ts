import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { addComment, deleteComment, listComments, updateComment } from "@/modules/office/shared/docs-service";
import { withAuth } from "@/lib/auth/route";
import { db } from "@/lib/db";
import { officeDocFromParams } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return Response.json({ comments: listComments(id) });
}

async function handlePOST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { anchor: string; body: string; quote?: string; source?: "user" | "agent" } | null;
  if (!body?.anchor || !body.body) return jsonError("`anchor` and `body` are required");
  return Response.json({ comment: addComment(id, body) });
}

/** A comment id is honoured only for the document in the path (the one the wrapper authorized). */
function belongs(commentId: string, docId: string) { return db().officeComments.get(commentId)?.docId === docId; }

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { commentId: string; resolved?: boolean; body?: string; reply?: string } | null;
  if (!body?.commentId) return jsonError("`commentId` is required");
  if (!belongs(body.commentId, id)) return jsonError("Not found", 404);
  const c = updateComment(body.commentId, body);
  return c ? Response.json({ comment: c }) : jsonError("Not found", 404);
}

async function handleDELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const commentId = req.nextUrl.searchParams.get("commentId");
  if (!commentId) return jsonError("`commentId` is required");
  if (!belongs(commentId, id)) return jsonError("Not found", 404);
  return Response.json({ ok: deleteComment(commentId) });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: officeDocFromParams }));
export const POST = withDb(withAuth(handlePOST, { action: "write", resource: officeDocFromParams }));
export const PATCH = withDb(withAuth(handlePATCH, { action: "write", resource: officeDocFromParams }));
export const DELETE = withDb(withAuth(handleDELETE, { action: "write", resource: officeDocFromParams }));
