import type { NextRequest } from "next/server";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { jobCounts, listJobs } from "@/modules/intel/jobs";
import { intelSources } from "@/modules/intel/store";
import type { IntelJobKind, IntelJobStatus } from "@/modules/intel/types";

export const runtime = "nodejs";

/** GET ?status=queued,running&kind=&sourceId=&escalated=1&since=&limit=&offset= → { items, total, counts }. */
export async function GET(req: NextRequest) {
  intelBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const status = p("status")?.split(",").map((s) => s.trim()).filter(Boolean) as IntelJobStatus[] | undefined;
  const limit = Math.max(1, Math.min(Number(p("limit") ?? 50) || 50, 500));
  const offset = Math.max(0, Number(p("offset") ?? 0) || 0);
  const { items, total } = listJobs({ status, kind: p("kind") as IntelJobKind | undefined, sourceId: p("sourceId"), since: p("since"), escalatedOnly: p("escalated") === "1" || p("escalated") === "true", limit, offset });
  const names = new Map(intelSources().all().map((s) => [s.id, s.name]));
  return Response.json({
    items: items.map((j) => ({ ...j, sourceName: j.sourceId ? names.get(j.sourceId) : undefined, log: j.log.slice(-20) })),
    total,
    limit,
    offset,
    counts: jobCounts(),
  });
}
