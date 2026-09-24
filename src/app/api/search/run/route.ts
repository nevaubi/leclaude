import { jsonError, sseResponse } from "@/lib/ai/sse";
import { parseRunRequest } from "@/modules/search/service";
import { runResearch } from "@/modules/search/engine/run";

export const runtime = "nodejs";

/**
 * POST /api/search/run — one research turn streamed over SSE.
 * Body: useAgent-compatible ({message, threadId?, runId?, ...SearchSettings}).
 * Events: plan / lane.* / synthesis.start / text.delta / answer.text / verify.* /
 * correction / citecheck / round.done / followups / answer.final / run.done
 * (see src/modules/search/engine/types.ts). Aborts everything on disconnect.
 */
export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON body"); }
  const parsed = parseRunRequest(body);
  if ("error" in parsed) return jsonError(parsed.error);
  const { query, settings, runId, threadId, savedSearchId } = parsed;
  return sseResponse(async (send, signal) => {
    await runResearch({ question: query, settings, runId, threadId, savedSearchId }, send, signal);
  });
}
