import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { clusterScope } from "@/modules/intel/analysis/clusters";
import type { IntelDocumentKind } from "@/modules/intel/types";

export const runtime = "nodejs";

/** GET ?matterId=&kinds=&entityId=&court=&jurisdiction=&q=&k=&maxChunks=&method=embeddings|tfidf → ClusterResult. */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const method = p("method");
  if (method && method !== "embeddings" && method !== "tfidf") return jsonError("method must be embeddings or tfidf", 422);
  try {
    return Response.json(clusterScope({
      matterId: p("matterId"),
      kinds: p("kinds")?.split(",").map((s) => s.trim()).filter(Boolean) as IntelDocumentKind[] | undefined,
      entityId: p("entityId"),
      court: p("court"),
      jurisdiction: p("jurisdiction"),
      q: p("q"),
      k: p("k") ? Math.max(1, Math.min(Number(p("k")) || 4, 20)) : undefined,
      maxChunks: p("maxChunks") ? Math.max(10, Math.min(Number(p("maxChunks")) || 600, 2000)) : undefined,
      method: method as "embeddings" | "tfidf" | undefined,
    }));
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
