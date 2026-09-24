import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { AIConfigError, aiConfig } from "@/lib/ai/config";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { dismissInsight, getInsight, publishInsight, verifyInsight } from "@/modules/intel/analysis/insights";
import { docLite } from "@/modules/intel/analysis/profiles";
import { intelChunks, intelDocuments } from "@/modules/intel/store";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** GET → { insight, evidence: [{ ...ref, doc, chunkText }] } with the cited records resolved. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  const insight = getInsight(id);
  if (!insight) return jsonError("Insight not found", 404);
  const evidence = insight.evidence.map((ev) => { const doc = intelDocuments().get(ev.docId); const chunk = ev.chunkId ? intelChunks().get(ev.chunkId) : null; return { ...ev, doc: doc ? docLite(doc) : null, chunkText: chunk?.text.slice(0, 1200) }; });
  return Response.json({ insight, evidence });
}

/** POST { action: "publish"|"dismiss"|"verify", force?, note? } → { insight } (verify needs OPENAI_API_KEY → 503 otherwise). */
export async function POST(req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  if (!getInsight(id)) return jsonError("Insight not found", 404);
  const body = (await req.json().catch(() => ({}))) as { action?: string; force?: boolean; note?: string };
  try {
    switch (body.action) {
      case "publish": {
        const r = publishInsight(id, { force: body.force === true });
        if (!r.ok) return jsonError(r.message ?? "Cannot publish", 409, { insight: r.insight });
        return Response.json({ insight: r.insight });
      }
      case "dismiss":
        return Response.json({ insight: dismissInsight(id, { note: body.note }) });
      case "verify": {
        if (!aiConfig().hasKey) throw new AIConfigError();
        const r = await verifyInsight(id, { signal: req.signal });
        return Response.json(r);
      }
      default:
        return jsonError('Provide { action: "publish" | "dismiss" | "verify" }', 422);
    }
  } catch (e) {
    if (e instanceof AIConfigError) return jsonError(e.message, 503, { code: "ai_not_configured" });
    return jsonError((e as Error).message, 500);
  }
}
