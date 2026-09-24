import { NextRequest } from "next/server";
import { getThread, listThreadSummaries } from "@/modules/search/engine/threads";
import { jsonError } from "@/lib/ai/sse";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** GET /api/search/threads?limit=40 → recent research threads (summaries). ?id= returns one full thread. */
async function handleGET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const thread = getThread(id);
    if (!thread) return jsonError("Not found", 404);
    return Response.json({ thread });
  }
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 40)));
  return Response.json({ threads: listThreadSummaries(limit) });
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.research() });
