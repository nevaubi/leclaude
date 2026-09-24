import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { searchIntel } from "@/modules/intel/store";
import type { IntelDocumentKind, IntelSearchQuery } from "@/modules/intel/types";

export const runtime = "nodejs";

function fromParams(url: URL): IntelSearchQuery {
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  return {
    q: p("q") ?? "",
    kinds: p("kinds")?.split(",").map((s) => s.trim()).filter(Boolean) as IntelDocumentKind[] | undefined,
    jurisdiction: p("jurisdiction"),
    court: p("court"),
    dateFrom: p("dateFrom"),
    dateTo: p("dateTo"),
    entityIds: p("entityIds")?.split(",").map((s) => s.trim()).filter(Boolean),
    matterId: p("matterId"),
    sourceIds: p("sourceIds")?.split(",").map((s) => s.trim()).filter(Boolean),
    limit: p("limit") ? Number(p("limit")) : undefined,
  };
}

async function run(query: IntelSearchQuery) {
  const started = Date.now();
  const hits = await searchIntel(query);
  return Response.json({ query, hits, total: hits.length, durationMs: Date.now() - started });
}

/** GET ?q=&kinds=&jurisdiction=&court=&dateFrom=&dateTo=&entityIds=&matterId=&sourceIds=&limit= → { query, hits, total }. */
export async function GET(req: NextRequest) {
  intelBootstrap();
  try { return await run(fromParams(new URL(req.url))); } catch (e) { return jsonError((e as Error).message, 500); }
}

/** POST IntelSearchQuery → { query, hits, total }. */
export async function POST(req: NextRequest) {
  intelBootstrap();
  let body: IntelSearchQuery;
  try { body = (await req.json()) as IntelSearchQuery; } catch { return jsonError("Invalid JSON body"); }
  if (!body || typeof body !== "object") return jsonError("Body must be an IntelSearchQuery", 422);
  try { return await run({ ...body, q: String(body.q ?? "") }); } catch (e) { return jsonError((e as Error).message, 500); }
}
