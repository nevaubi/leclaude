import { jsonError, sseResponse } from "@/lib/ai/sse";
import { db } from "@/lib/db";
import { parseRunRequest, recordRun, runStructuredRetrieval, runSynthesis, type RetrievalOutcome } from "@/modules/search/service";
import type { SearchHit, SearchSource, SearchStreamEvent } from "@/modules/search/types";

export const runtime = "nodejs";

/**
 * POST /api/search/run — one request, two parallel tracks streamed over SSE:
 *  1. structured retrieval fan-out → {type:"results"|"source.error"} per source
 *  2. AI synthesis (runAgent) → the standard agent events (text.delta, tool.call, …)
 * Ends with {type:"run.done"} after the run is persisted to history.
 */
export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON body"); }
  const parsed = parseRunRequest(body);
  if ("error" in parsed) return jsonError(parsed.error);
  const { query, settings, runId, savedSearchId, skipSynthesis, followUp, previousResponseId } = parsed;
  const matter = settings.matterId ? db().matters.get(settings.matterId) : null;

  // Follow-up question: continue the agent conversation only (no retrieval, nothing recorded).
  if (followUp) {
    return sseResponse(async (send, signal) => {
      const empty: RetrievalOutcome = { hits: {}, totals: {}, errors: [], durationMs: 0 };
      await runSynthesis({ query, settings, matter: matter ?? null, retrieval: Promise.resolve(empty), partial: () => ({}), send, signal, previousResponseId });
    });
  }

  return sseResponse(async (send, signal) => {
    const startedAt = Date.now();
    send({ type: "run.start", runId, query, sources: settings.sources, effectiveQuery: query } satisfies SearchStreamEvent);

    const partial: Partial<Record<SearchSource, SearchHit[]>> = {};
    const retrieval: Promise<RetrievalOutcome> = runStructuredRetrieval(
      query,
      settings,
      (e) => { if (e.type === "results") partial[e.source] = e.results; send(e); },
      signal,
    );

    if (skipSynthesis) {
      // Per-source retry from the client: retrieval only, not recorded in history.
      const outcome = await retrieval;
      send({ type: "run.done", runId, counts: Object.fromEntries(Object.entries(outcome.hits).map(([k, v]) => [k, v?.length ?? 0])), durationMs: outcome.durationMs } satisfies SearchStreamEvent);
      return;
    }

    const synthesis = runSynthesis({ query, settings, matter: matter ?? null, retrieval, partial: () => partial, send, signal });

    const [outcome, ai] = await Promise.all([retrieval, synthesis]);
    if (signal.aborted) return;
    const run = recordRun({ id: runId, query, settings, startedAt, outcome, synthesis: ai.text, aiStatus: ai.status, savedSearchId });
    send({ type: "run.done", runId: run.id, counts: run.counts, durationMs: run.durationMs } satisfies SearchStreamEvent);
  });
}
