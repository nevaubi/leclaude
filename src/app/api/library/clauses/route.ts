import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { fillClauseItem, listClauses } from "@/modules/library/service";
import { withAuth } from "@/lib/auth/route";
import { bodyString, refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** Clause bank listing with categories. */
async function handleGET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return Response.json(listClauses({ category: sp.get("category") || undefined, q: sp.get("q") || undefined }));
}

/** Fill a clause's variables; optionally create a Word document (kind "word") from the filled markdown. */
async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; values?: Record<string, string>; createDoc?: boolean; matterId?: string; folderId?: string | null; title?: string; copyOnly?: boolean } | null;
  if (!body?.id) return jsonError("`id` is required");
  try { return Response.json(fillClauseItem(body.id, { values: body.values ?? {}, createDoc: body.createDoc, matterId: body.matterId, folderId: body.folderId, title: body.title, copyOnly: body.copyOnly })); } catch (e) { return jsonError((e as Error).message, 400); }
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.library() });
export const POST = withAuth(handlePOST, { action: "write", resource: async (req) => refs.library(await bodyString(req, "id")) });
