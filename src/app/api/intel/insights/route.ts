import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { currentUser } from "@/lib/current-user";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { listInsights, runAnalysis } from "@/modules/intel/analysis/insights";
import { INSIGHT_KIND_LABEL, INSIGHT_STATUS_LABEL } from "@/modules/intel/analysis/pure";
import { enqueueJob } from "@/modules/intel/jobs";
import type { IntelInsight, IntelInsightKind } from "@/modules/intel/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET ?userId=&matterId=&status=published,verified&kind=trend,alert&entityId=&q=&limit=&offset=&rank=1|0
 * → { insights, items, total, ranked }. Ranked (recency × relevance × confidence × watches) whenever
 * a userId or matterId is given unless rank=0.
 */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const status = p("status")?.split(",").map((s) => s.trim()).filter((s): s is IntelInsight["status"] => s in INSIGHT_STATUS_LABEL);
  const kind = p("kind")?.split(",").map((s) => s.trim()).filter((s): s is IntelInsightKind => s in INSIGHT_KIND_LABEL);
  const userId = p("userId");
  const matterId = p("matterId");
  const rank = p("rank") ? p("rank") === "1" || p("rank") === "true" : Boolean(userId || matterId);
  return Response.json(listInsights({ userId: userId ?? (rank ? currentUser().id : undefined), matterId, status: status?.length ? status : undefined, kind: kind?.length ? kind : undefined, entityId: p("entityId"), q: p("q"), limit: Number(p("limit") ?? 50) || 50, offset: Number(p("offset") ?? 0) || 0, rank, includeFirmWide: p("firmWide") !== "0" }));
}

/**
 * POST { action: "run", full?, matterIds?, kinds? } → run the deterministic analysis pass inline and return its result.
 * POST { action: "verify", ids } → queue model verification for the given insights.
 */
export async function POST(req: NextRequest) {
  intelAnalysisBootstrap();
  const body = (await req.json().catch(() => ({}))) as { action?: string; full?: boolean; matterIds?: string[]; kinds?: IntelInsightKind[]; ids?: string[] };
  try {
    if (body.action === "run") return Response.json(runAnalysis({ full: body.full === true, matterIds: Array.isArray(body.matterIds) ? body.matterIds : undefined, kinds: Array.isArray(body.kinds) ? body.kinds : undefined, audit: true }));
    if (body.action === "verify") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string").slice(0, 50) : [];
      if (!ids.length) return jsonError("ids is required", 422);
      const job = enqueueJob({ kind: "insight.verify", payload: { insightIds: ids }, priority: 3, dedupeKey: `insight.verify:${ids.slice().sort().join(",").slice(0, 200)}`, maxAttempts: 2 });
      return Response.json({ job }, { status: 202 });
    }
    return jsonError('Provide { action: "run" } or { action: "verify", ids }', 422);
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
