import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { searchLibrary } from "@/modules/library/service";
import { parseFilters } from "@/modules/library/filters";
import { withAuth } from "@/lib/auth/route";
import { queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** Hybrid (semantic + keyword) search over library items and office documents with passage highlights. */
async function handleGET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const k = Math.min(Number(sp.get("k") ?? 30) || 30, 100);
  const f = parseFilters(sp);
  try { return Response.json(await searchLibrary(q, { ...f, q: undefined }, k)); } catch (e) { return jsonError((e as Error).message, 500); }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "library_item", matterId: queryParam(req, "matter", "matterId") }) }));
