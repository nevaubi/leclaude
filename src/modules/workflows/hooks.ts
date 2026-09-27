"use client";
import * as React from "react";
import { readSSE } from "@/lib/ai/sse";
import type { WorkflowRunStep } from "@/lib/types/domain";
import { isRestingStatus, isTerminalStatus, type RunEvent, type WorkflowRunRecord } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public body?: unknown) { super(message); this.name = "ApiError"; }
}

/** fetch + JSON with error extraction ({ error, code }). */
export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const b = body as { error?: string; code?: string } | null;
    throw new ApiError(b?.error ?? `${res.status} ${res.statusText}`, res.status, b?.code, body);
  }
  return body as T;
}

/** Minimal SWR-style fetch hook (no external library). */
export function useApi<T>(url: string | null, opts: { refreshMs?: number; enabled?: boolean } = {}) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(Boolean(url));
  const [tick, setTick] = React.useState(0);
  const enabled = opts.enabled !== false && Boolean(url);
  React.useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    setLoading(true);
    apiJson<T>(url)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, enabled, tick]);
  React.useEffect(() => {
    if (!opts.refreshMs || !enabled) return;
    const t = setInterval(() => setTick((n) => n + 1), opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, enabled]);
  const refresh = React.useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, refresh, setData };
}

export interface WorkflowMeta {
  aiConfigured: boolean;
  model: string;
  fastModel: string;
  people: { id: string; name: string; title?: string; role: string }[];
  matters: { id: string; name: string; shortName: string; client: string; status: string; practiceArea: string }[];
  scheduleDescriptions: Record<string, string>;
  workflows?: { id: string; name: string; status: string; system?: boolean; hasFrontend?: boolean }[];
  intelSources?: { id: string; name: string; adapter: string; kind?: string; enabled?: boolean }[];
  agents?: { id: string; label: string; hint: string }[];
}

let metaCache: WorkflowMeta | null = null;
export function useWorkflowMeta() {
  const [meta, setMeta] = React.useState<WorkflowMeta | null>(metaCache);
  React.useEffect(() => {
    if (metaCache) return;
    apiJson<WorkflowMeta>("/api/workflows/meta").then((m) => { metaCache = m; setMeta(m); }).catch(() => {});
  }, []);
  return meta;
}

function withStep(run: WorkflowRunRecord, nodeId: string, step: WorkflowRunStep, iteration?: { loopId: string; index: number; count: number }): WorkflowRunRecord {
  if (iteration) {
    // A loop-body step: record it on the iteration; the top-level mirror keeps the latest state for the canvas.
    const list = [...(run.loopIterations?.[iteration.loopId] ?? [])];
    const cur = list[iteration.index] ?? { index: iteration.index, item: undefined, steps: {} };
    list[iteration.index] = { ...cur, steps: { ...cur.steps, [nodeId]: step } };
    const steps = run.steps.some((s) => s.nodeId === nodeId) ? run.steps.map((s) => (s.nodeId === nodeId ? { ...step, logs: step.logs ?? s.logs } : s)) : run.steps;
    return { ...run, steps, loopIterations: { ...(run.loopIterations ?? {}), [iteration.loopId]: list } };
  }
  const exists = run.steps.some((s) => s.nodeId === nodeId);
  const steps = exists ? run.steps.map((s) => (s.nodeId === nodeId ? { ...step, logs: step.logs ?? s.logs } : s)) : [...run.steps, step];
  return { ...run, steps, status: run.status === "queued" ? "running" : run.status };
}

/** Fold one typed event into the run record. Status only ever comes from typed fields, never from log text. */
export function applyRunEvent(run: WorkflowRunRecord | null, ev: RunEvent): WorkflowRunRecord | null {
  if (ev.type === "snapshot") return ev.run;
  if (!run) return run;
  switch (ev.type) {
    case "run.started": return { ...run, status: "running", budget: ev.budget ?? run.budget, error: undefined, errorCode: undefined, terminalState: undefined, stopReason: undefined };
    case "plan.created": return { ...run, budget: ev.budget };
    case "node.started": case "node.completed": case "node.failed": case "node.skipped": case "node.cancelled": case "node.reset":
      return withStep(run, ev.nodeId, ev.step, "iteration" in ev ? ev.iteration : undefined);
    case "node.waiting": return withStep(run, ev.nodeId, ev.step);
    case "node.log": return { ...run, steps: run.steps.map((s) => (s.nodeId === ev.nodeId ? { ...s, logs: [...(s.logs ?? []), ev.line].slice(-200) } : s)) };
    case "artifact.created": return { ...run, artifacts: [...(run.artifacts ?? []).filter((a) => !(a.id === ev.artifact.id && a.kind === ev.artifact.kind)), ev.artifact] };
    case "output.created": return { ...run, deliverables: [...(run.deliverables ?? []).filter((d) => d.id !== ev.output.id), ev.output] };
    case "handoff.created": return { ...run, handoffs: [...(run.handoffs ?? []), ev.handoff] };
    case "review.required": return { ...run, approvals: [...(run.approvals ?? []).filter((a) => a.nodeId !== ev.approval.nodeId), ev.approval], status: "waiting_approval" };
    case "run.waiting": return { ...run, status: "waiting_approval", usage: ev.usage ?? run.usage, lease: null };
    case "run.completed": case "run.partial": case "run.failed": case "run.cancelled": case "run.budget_exhausted": case "run.verification_failed":
      return { ...run, status: ev.status, terminalState: ev.status, stopReason: ev.stopReason, failureKind: ev.failureKind, stoppedAtNodeId: ev.stoppedAtNodeId, error: ev.error, errorCode: ev.errorCode ?? run.errorCode, finishedAt: ev.endedAt, endedAt: ev.endedAt, usage: ev.usage ?? run.usage, outcome: ev.outcome ?? run.outcome, lease: null };
    case "run.done": return isTerminalStatus(ev.status) || ev.status === "waiting_approval" ? { ...run, status: ev.status } : run;
    default: return run;
  }
}

export interface RunStreamState {
  run: WorkflowRunRecord | null;
  connected: boolean;
  error: string | null;
  noApiKey: boolean;
  progress: Record<string, string>;
  /** Latest retry notice per node (attempt, delay), cleared when the node settles. */
  retrying: Record<string, { attempt: number; nextAttempt: number; delayMs: number; message: string }>;
  /** Budget dimensions that crossed 80% of their limit. */
  budgetWarnings: Record<string, { used: number; limit: number }>;
  loading: boolean;
}

const EMPTY_STATE = (runId: string | null, initial?: WorkflowRunRecord | null): RunStreamState => ({ run: initial ?? null, connected: false, error: null, noApiKey: false, progress: {}, retrying: {}, budgetWarnings: {}, loading: Boolean(runId && !initial) });

/** Follows a run over SSE and folds typed events into a run record; reconnects after approvals. */
export function useRunStream(runId: string | null, initial?: WorkflowRunRecord | null) {
  const [state, setState] = React.useState<RunStreamState>(() => EMPTY_STATE(runId, initial));
  const [generation, setGeneration] = React.useState(0);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!runId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/workflows/runs/${runId}/stream`, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
        if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error ?? `${res.status} ${res.statusText}`); }
        setState((s) => ({ ...s, connected: true, error: null, loading: false }));
        await readSSE<RunEvent>(res, (ev) => {
          if (!active) return;
          setState((s) => {
            let progress = s.progress;
            let retrying = s.retrying;
            let budgetWarnings = s.budgetWarnings;
            if (ev.type === "node.progress") progress = { ...progress, [ev.nodeId]: ev.label };
            if (ev.type === "node.retrying") retrying = { ...retrying, [ev.nodeId]: { attempt: ev.attempt, nextAttempt: ev.nextAttempt, delayMs: ev.delayMs, message: ev.message } };
            if ((ev.type === "node.completed" || ev.type === "node.failed" || ev.type === "node.skipped" || ev.type === "node.cancelled") && !ev.iteration) {
              progress = { ...progress }; delete progress[ev.nodeId];
              retrying = { ...retrying }; delete retrying[ev.nodeId];
            }
            if (ev.type === "budget.warning") budgetWarnings = { ...budgetWarnings, [ev.dimension]: { used: ev.used, limit: ev.limit } };
            const noApiKey = s.noApiKey || (ev.type === "error" && ev.code === "no_api_key") || (ev.type === "run.failed" && ev.errorCode === "no_api_key");
            const error = ev.type === "error" ? ev.message : s.error;
            return { ...s, run: applyRunEvent(s.run, ev), progress, retrying, budgetWarnings, noApiKey, error, loading: false };
          });
          // A snapshot of a run that already rests (finished or parked) is complete: close the stream instead of waiting for a terminator.
          if (ev.type === "snapshot" && isRestingStatus(ev.run.status)) ctrl.abort();
        }, ctrl.signal);
        // Refresh the final record (outputs, loop results, telemetry) once the stream closes.
        if (active) {
          try { const j = await apiJson<{ run: WorkflowRunRecord }>(`/api/workflows/runs/${runId}`); if (active) setState((s) => ({ ...s, run: j.run, connected: false, progress: {}, retrying: {} })); } catch { /* keep streamed state */ }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          if (active) {
            try { const j = await apiJson<{ run: WorkflowRunRecord }>(`/api/workflows/runs/${runId}`); if (active) setState((s) => ({ ...s, run: j.run, connected: false, loading: false, progress: {}, retrying: {} })); } catch { /* keep streamed state */ }
          }
          return;
        }
        if (active) setState((s) => ({ ...s, connected: false, error: (e as Error).message, loading: false }));
      } finally {
        if (active) setState((s) => ({ ...s, connected: false }));
      }
    })();
    return () => { active = false; ctrl.abort(); };
  }, [runId, generation]);

  const reconnect = React.useCallback(() => setGeneration((g) => g + 1), []);
  const patch = React.useCallback((fn: (r: WorkflowRunRecord | null) => WorkflowRunRecord | null) => setState((s) => ({ ...s, run: fn(s.run) })), []);
  const resting = state.run ? isRestingStatus(state.run.status) : false;
  const terminal = state.run ? isTerminalStatus(state.run.status) : false;
  return { ...state, resting, terminal, reconnect, patch };
}

export function stepMap(run: WorkflowRunRecord | null): Map<string, WorkflowRunStep> {
  return new Map((run?.steps ?? []).map((s) => [s.nodeId, s]));
}
