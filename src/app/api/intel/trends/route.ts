import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { buildTrends, trendOptions } from "@/modules/intel/analysis/trends";
import { TREND_GROUP_LABEL, type TrendGroupBy, type TrendQuery } from "@/modules/intel/analysis/types";
import type { MotionType } from "@/modules/intel/analysis/pure";
import type { IntelDocumentKind } from "@/modules/intel/types";

export const runtime = "nodejs";

/**
 * GET ?groupBy=court&kinds=opinion,docket_entry&jurisdiction=&court=&judgeId=&entityId=&matterId=&motion=&from=YYYY-MM&to=YYYY-MM&top=8&compare=a,b
 * → TrendResult. `?options=1` returns the filter options (courts, jurisdictions, judges, kinds, matters, states).
 */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  if (p("options") === "1") return Response.json(trendOptions());
  const groupBy = (p("groupBy") ?? "kind") as TrendGroupBy;
  if (!(groupBy in TREND_GROUP_LABEL)) return jsonError(`groupBy must be one of ${Object.keys(TREND_GROUP_LABEL).join(", ")}`, 422);
  const q: TrendQuery = {
    groupBy,
    kinds: p("kinds")?.split(",").map((s) => s.trim()).filter(Boolean) as IntelDocumentKind[] | undefined,
    jurisdiction: p("jurisdiction"),
    court: p("court"),
    judgeId: p("judgeId"),
    entityId: p("entityId"),
    matterId: p("matterId"),
    motion: p("motion") as MotionType | undefined,
    from: p("from"),
    to: p("to"),
    top: p("top") ? Math.max(1, Math.min(Number(p("top")) || 8, 40)) : undefined,
    compare: p("compare")?.split(",").map((s) => s.trim()).filter(Boolean),
  };
  return Response.json(buildTrends(q));
}
