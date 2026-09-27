import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { treeResponse } from "@/modules/library/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET() {
  try { return Response.json(treeResponse()); } catch (e) { return jsonError((e as Error).message, 500); }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => refs.library() }));
