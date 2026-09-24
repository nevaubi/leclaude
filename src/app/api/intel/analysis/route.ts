import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { rebuildEntities } from "@/modules/intel/analysis/entities";
import { buildRelations } from "@/modules/intel/analysis/graph";
import { analysisStatus, runAnalysis } from "@/modules/intel/analysis/insights";
import { scheduleAnalysisIfStale } from "@/modules/intel/analysis/jobs";
import { kickRunner } from "@/modules/intel/background";
import type { IntelInsightKind } from "@/modules/intel/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET → AnalysisStatus (last run, counts, pending documents). */
export async function GET() {
  intelAnalysisBootstrap();
  return Response.json(analysisStatus());
}

/**
 * POST { run: "entities" | "relations" | "insights" | "all", full?, matterIds?, kinds?, queue? }
 * Runs the requested pass inline (deterministic, seconds at demo scale) and returns its result;
 * `queue: true` enqueues an analysis.run job for the background runner instead.
 */
export async function POST(req: NextRequest) {
  intelAnalysisBootstrap();
  const body = (await req.json().catch(() => ({}))) as { run?: string; full?: boolean; matterIds?: string[]; kinds?: IntelInsightKind[]; queue?: boolean };
  try {
    if (body.queue) { const r = scheduleAnalysisIfStale(); kickRunner(); return Response.json(r, { status: 202 }); }
    switch (body.run ?? "all") {
      case "entities": return Response.json({ entities: rebuildEntities({}), relations: buildRelations({}) });
      case "relations": return Response.json({ relations: buildRelations({ reset: true }) });
      case "insights":
      case "all":
        return Response.json(runAnalysis({ full: body.full === true || body.run === "all", matterIds: Array.isArray(body.matterIds) ? body.matterIds : undefined, kinds: Array.isArray(body.kinds) ? body.kinds : undefined, audit: true }));
      default:
        return jsonError('run must be "entities", "relations", "insights" or "all"', 422);
    }
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
