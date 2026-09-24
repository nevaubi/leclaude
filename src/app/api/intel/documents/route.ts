import type { NextRequest } from "next/server";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { listDocuments, type ListDocumentsOptions } from "@/modules/intel/store";
import type { IntelDocumentKind, IntelFlagKind } from "@/modules/intel/types";

export const runtime = "nodejs";

/**
 * GET ?kinds=opinion,docket&sourceId=&adapter=&matterId=&court=&jurisdiction=&q=&flagged=1&flagKinds=stale,contradicted
 *     &dateFrom=&dateTo=&entityId=&seeded=0&minConfidence=&sort=date&direction=desc&limit=50&offset=0
 * → { items (rows without text), total, limit, offset }.
 */
export async function GET(req: NextRequest) {
  intelBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const bool = (k: string) => { const v = p(k); return v == null ? undefined : v === "1" || v === "true"; };
  const opts: ListDocumentsOptions = {
    kinds: p("kinds")?.split(",").map((s) => s.trim()).filter(Boolean) as IntelDocumentKind[] | undefined,
    sourceId: p("sourceId"),
    adapter: p("adapter"),
    matterId: p("matterId"),
    court: p("court"),
    courtId: p("courtId"),
    jurisdiction: p("jurisdiction"),
    q: p("q"),
    flagged: bool("flagged"),
    flagKinds: p("flagKinds")?.split(",").map((s) => s.trim()).filter(Boolean) as IntelFlagKind[] | undefined,
    dateFrom: p("dateFrom"),
    dateTo: p("dateTo"),
    entityId: p("entityId"),
    seeded: bool("seeded"),
    minConfidence: p("minConfidence") ? Number(p("minConfidence")) : undefined,
    sort: (p("sort") as ListDocumentsOptions["sort"]) ?? "updated",
    direction: (p("direction") as ListDocumentsOptions["direction"]) ?? "desc",
    limit: Number(p("limit") ?? 50) || 50,
    offset: Number(p("offset") ?? 0) || 0,
  };
  return Response.json(listDocuments(opts));
}
