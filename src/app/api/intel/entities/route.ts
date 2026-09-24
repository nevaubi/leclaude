import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { currentUser } from "@/lib/current-user";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { listEntities, rebuildEntities, type ListEntitiesOptions } from "@/modules/intel/analysis/entities";
import { buildRelations } from "@/modules/intel/analysis/graph";
import { ENTITY_TYPES } from "@/modules/intel/analysis/pure";
import type { IntelEntityType } from "@/modules/intel/types";

export const runtime = "nodejs";

/**
 * GET ?type=judge,attorney&q=&sort=documents|name|mentions|updated|lastSeen&direction=&limit=&offset=&watched=1&flagged=1&userId=
 * → { items, total, counts, limit, offset }
 */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const types = p("type")?.split(",").map((s) => s.trim()).filter((s): s is IntelEntityType => ENTITY_TYPES.includes(s as IntelEntityType));
  const opts: ListEntitiesOptions = {
    type: types?.length ? types : undefined,
    q: p("q"),
    ids: p("ids")?.split(",").filter(Boolean),
    watchedBy: p("userId") ?? currentUser().id,
    onlyWatched: p("watched") === "1" || p("watched") === "true",
    flagged: p("flagged") == null ? undefined : p("flagged") === "1" || p("flagged") === "true",
    sort: (p("sort") as ListEntitiesOptions["sort"]) ?? "documents",
    direction: (p("direction") as ListEntitiesOptions["direction"]) ?? "desc",
    limit: Number(p("limit") ?? 200) || 200,
    offset: Number(p("offset") ?? 0) || 0,
  };
  return Response.json(listEntities(opts));
}

/** POST { action: "rebuild", docIds?: string[] } → re-resolve entities (and relations) for the corpus or a subset. */
export async function POST(req: NextRequest) {
  intelAnalysisBootstrap();
  const body = (await req.json().catch(() => ({}))) as { action?: string; docIds?: string[] };
  if (body.action !== "rebuild") return jsonError('Provide { action: "rebuild" }', 422);
  try {
    const entities = rebuildEntities({ docIds: Array.isArray(body.docIds) ? body.docIds : undefined });
    const relations = buildRelations({ docIds: Array.isArray(body.docIds) ? body.docIds : undefined });
    return Response.json({ entities, relations });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
