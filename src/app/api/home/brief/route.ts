import { AIConfigError } from "@/lib/ai/config";
import { jsonError } from "@/lib/ai/sse";
import { generateDailyBrief } from "@/modules/home/brief";
import { computeFallbackBrief } from "@/modules/home/brief-fallback";
import { buildBriefContext, cacheBrief, getCachedBrief, getOrComputeBrief } from "@/modules/home/service";
import { dateKey } from "@/modules/home/time";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== dateKey(new Date())) {
    const brief = getCachedBrief(date);
    return brief ? Response.json({ brief, cached: true }) : jsonError("No brief cached for that date", 404);
  }
  const now = new Date();
  const cached = getCachedBrief(dateKey(now));
  return Response.json({ brief: cached ?? getOrComputeBrief(now), cached: Boolean(cached) });
}

/** Regenerate today's brief with the fast model. Falls back to the computed brief (503 + code) without a key. */
export async function POST(req: Request) {
  const now = new Date();
  let mode: "ai" | "computed" = "ai";
  try { const b = (await req.json()) as { mode?: string }; if (b?.mode === "computed") mode = "computed"; } catch { /* empty body is fine */ }
  if (mode === "computed") {
    const brief = computeFallbackBrief(buildBriefContext(now));
    cacheBrief(brief);
    return Response.json({ brief });
  }
  try {
    const brief = await generateDailyBrief({ now, signal: req.signal });
    return Response.json({ brief });
  } catch (e) {
    const brief = computeFallbackBrief(buildBriefContext(now));
    cacheBrief(brief);
    if (e instanceof AIConfigError) return jsonError(e.message, 503, { code: "no_api_key", brief });
    return jsonError(e instanceof Error ? e.message : "Brief generation failed", 502, { code: "ai_error", brief });
  }
}
