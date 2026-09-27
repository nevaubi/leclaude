import { withDb } from "@/lib/db/request";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { db } from "@/lib/db";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { buildChronology, exportChronologyToTimeline } from "@/modules/intel/analysis/chronology";
import type { IntelDocumentKind } from "@/modules/intel/types";
import { withAuth } from "@/lib/auth/route";
import { bodyMatterId, queryParam, refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** GET ?matterId=|mdlId=|productId=|entityId=&from=&to=&kinds=&ediscovery=0&limit= → ChronologyResult. */
async function handleGET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const q = { matterId: p("matterId"), mdlId: p("mdlId"), productId: p("productId"), entityId: p("entityId") };
  if (!q.matterId && !q.mdlId && !q.productId && !q.entityId) return jsonError("Provide matterId, mdlId, productId or entityId", 422);
  return Response.json(buildChronology({
    ...q,
    from: p("from"),
    to: p("to"),
    kinds: p("kinds")?.split(",").map((s) => s.trim()).filter(Boolean) as IntelDocumentKind[] | undefined,
    includeEdiscovery: p("ediscovery") !== "0",
    limit: p("limit") ? Math.max(1, Math.min(Number(p("limit")) || 200, 2000)) : undefined,
  }));
}

/** POST { matterId, minConfidence? } → export gate-passing entries to the e-discovery timeline (createdBy "ai", with provenance). */
async function handlePOST(req: NextRequest) {
  intelAnalysisBootstrap();
  const body = (await req.json().catch(() => ({}))) as { matterId?: string; minConfidence?: number };
  if (!body.matterId) return jsonError("matterId is required", 422);
  if (!db().matters.has(body.matterId)) return jsonError("Matter not found", 404);
  const minConfidence = typeof body.minConfidence === "number" ? Math.max(0, Math.min(1, body.minConfidence)) : undefined;
  return Response.json(exportChronologyToTimeline(body.matterId, { minConfidence }));
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => refs.intel(queryParam(req, "matterId")) }));
export const POST = withDb(withAuth(handlePOST, { action: "write", resource: async (req) => ({ kind: "timeline", matterId: await bodyMatterId(req) }) }));
