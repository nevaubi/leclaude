import "server-only";
/**
 * Model-call telemetry (constitution §36, §42): one bounded trace per provider call with routing, latency, token and
 * cache usage, fallbacks and errors. Never prompt or source text. Stored in the `ai_traces` collection so the
 * settings UI and evals can read cost/latency without a separate service.
 */
import { db } from "@/lib/db";
import type { InferenceErrorCode, InferenceUsage, ModelRole, ProviderId, StopReason, TaskType } from "./providers/types";

export interface AITrace {
  id: string;
  at: string;
  traceId: string;
  provider: ProviderId;
  model: string;
  taskType?: TaskType;
  role?: ModelRole;
  /** Caller surface from request metadata (e.g. "office-word", "research-lane"). */
  surface?: string;
  matterId?: string;
  latencyMs: number;
  usage?: InferenceUsage;
  cacheRead?: number;
  cacheWrite?: number;
  stopReason?: StopReason;
  /** Set when this call ran because the previous target failed with a retryable error. */
  fallbackFrom?: { provider: ProviderId; model: string };
  error?: { code: InferenceErrorCode | "cancelled"; message: string };
}

export const AI_TRACES_COLLECTION = "ai_traces";
const MAX_TRACES = 1000;
const PRUNE_BATCH = 200;

const traces = () => db().collection<AITrace>(AI_TRACES_COLLECTION);

/** Record a trace. Never throws: telemetry must not break a model call. */
export function recordTrace(input: Omit<AITrace, "id" | "at"> & { at?: string }): AITrace | null {
  try {
    const col = traces();
    const at = input.at ?? new Date().toISOString();
    const trace: AITrace = { ...input, id: `trace_${at.replace(/[^0-9]/g, "").slice(0, 17)}_${Math.random().toString(36).slice(2, 8)}`, at, error: input.error ? { code: input.error.code, message: input.error.message.slice(0, 500) } : undefined };
    col.put(trace);
    const count = col.count();
    if (count > MAX_TRACES + PRUNE_BATCH) {
      const oldest = col.list({ sortBy: "at", direction: "asc", limit: count - MAX_TRACES });
      for (const t of oldest) col.delete(t.id);
    }
    return trace;
  } catch (e) {
    console.warn("[ai-telemetry] failed to record trace:", (e as Error).message);
    return null;
  }
}

export function recentTraces(limit = 50): AITrace[] {
  try { return traces().list({ sortBy: "at", direction: "desc", limit }); } catch { return []; }
}

export interface TraceSummary {
  since: string;
  calls: number;
  errors: number;
  fallbacks: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  latencyMs: { p50: number; p95: number };
  byProvider: Record<string, { calls: number; errors: number; input: number; output: number; cacheRead: number }>;
}

/** Aggregate the traces of the last `windowMs` (default 24h) for the settings page and evals. */
export function traceSummary(windowMs = 24 * 60 * 60 * 1000): TraceSummary {
  const since = new Date(Date.now() - windowMs).toISOString();
  let rows: AITrace[] = [];
  try { rows = traces().find((t) => t.at >= since); } catch { rows = []; }
  const latencies = rows.map((t) => t.latencyMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] : 0);
  const byProvider: TraceSummary["byProvider"] = {};
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const t of rows) {
    const p = (byProvider[t.provider] ??= { calls: 0, errors: 0, input: 0, output: 0, cacheRead: 0 });
    p.calls++;
    if (t.error) p.errors++;
    p.input += t.usage?.input ?? 0;
    p.output += t.usage?.output ?? 0;
    p.cacheRead += t.cacheRead ?? t.usage?.cacheRead ?? 0;
    tokens.input += t.usage?.input ?? 0;
    tokens.output += t.usage?.output ?? 0;
    tokens.cacheRead += t.cacheRead ?? t.usage?.cacheRead ?? 0;
    tokens.cacheWrite += t.cacheWrite ?? t.usage?.cacheWrite ?? 0;
  }
  return { since, calls: rows.length, errors: rows.filter((t) => t.error).length, fallbacks: rows.filter((t) => t.fallbackFrom).length, tokens, latencyMs: { p50: pct(0.5), p95: pct(0.95) }, byProvider };
}
