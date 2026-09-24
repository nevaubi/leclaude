"use client";
import * as React from "react";
import { readSSE } from "@/lib/ai/sse";
import type { WorkflowRunStep } from "@/lib/types/domain";
import type { RunEvent, WorkflowRunRecord } from "./types";

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

const RESTING = new Set(["succeeded", "failed", "cancelled", "waiting_approval"]);

function applyEvent(run: WorkflowRunRecord | null, ev: RunEvent): WorkflowRunRecord | null {
  if (ev.type === "snapshot") return ev.run;
  if (!run) return run;
  switch (ev.type) {
    case "step.status": {
      const exists = run.steps.some((s) => s.nodeId === ev.nodeId);
      const steps = exists ? run.steps.map((s) => (s.nodeId === ev.nodeId ? { ...ev.step, logs: ev.step.logs ?? s.logs } : s)) : [...run.steps, ev.step];
      let loopIterations = run.loopIterations;
      if (ev.iteration) {
        const list = [...(loopIterations?.[ev.iteration.loopId] ?? [])];
        const cur = list[ev.iteration.index] ?? { index: ev.iteration.index, item: undefined, steps: {} };
        list[ev.iteration.index] = { ...cur, steps: { ...cur.steps, [ev.nodeId]: ev.step } };
        loopIterations = { ...(loopIterations ?? {}), [ev.iteration.loopId]: list };
      }
      return { ...run, steps, loopIterations, status: run.status === "queued" ? "running" : run.status };
    }
    case "step.log": {
      const steps = run.steps.map((s) => (s.nodeId === ev.nodeId ? { ...s, logs: [...(s.logs ?? []), ev.line].slice(-200) } : s));
      return { ...run, steps };
    }
    case "run.status": return { ...run, status: ev.status, error: ev.error ?? run.error, errorCode: ev.errorCode ?? run.errorCode, finishedAt: ev.finishedAt ?? run.finishedAt, usage: ev.usage ?? run.usage };
    case "artifact": return { ...run, artifacts: [...(run.artifacts ?? []).filter((a) => !(a.id === ev.artifact.id && a.kind === ev.artifact.kind)), ev.artifact] };
    case "approval.requested": return { ...run, approvals: [...(run.approvals ?? []).filter((a) => a.nodeId !== ev.approval.nodeId), ev.approval], status: "waiting_approval" };
    case "run.done": return { ...run, status: ev.status };
    case "handoff": return { ...run, handoffs: [...(run.handoffs ?? []), ev.handoff] };
    case "output": return { ...run, deliverables: [...(run.deliverables ?? []).filter((d) => d.id !== ev.output.id), ev.output] };
    default: return run;
  }
}

export interface RunStreamState {
  run: WorkflowRunRecord | null;
  connected: boolean;
  error: string | null;
  noApiKey: boolean;
  progress: Record<string, string>;
  loading: boolean;
}

/** Follows a run over SSE and folds events into a run record; reconnects after approvals. */
export function useRunStream(runId: string | null, initial?: WorkflowRunRecord | null) {
  const [state, setState] = React.useState<RunStreamState>({ run: initial ?? null, connected: false, error: null, noApiKey: false, progress: {}, loading: Boolean(runId && !initial) });
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
            if (ev.type === "step.progress") progress = { ...progress, [ev.nodeId]: ev.label };
            if (ev.type === "step.status" && ev.step.status !== "running") { progress = { ...progress }; delete progress[ev.nodeId]; }
            const noApiKey = s.noApiKey || (ev.type === "error" && ev.code === "no_api_key") || (ev.type === "run.status" && ev.errorCode === "no_api_key");
            const error = ev.type === "error" ? ev.message : s.error;
            return { ...s, run: applyEvent(s.run, ev), progress, noApiKey, error, loading: false };
          });
        }, ctrl.signal);
        // Refresh the final record (outputs, loop results) once the stream closes.
        if (active) {
          try { const j = await apiJson<{ run: WorkflowRunRecord }>(`/api/workflows/runs/${runId}`); if (active) setState((s) => ({ ...s, run: j.run, connected: false, progress: {} })); } catch { /* keep streamed state */ }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (active) setState((s) => ({ ...s, connected: false, error: (e as Error).message, loading: false }));
      } finally {
        if (active) setState((s) => ({ ...s, connected: false }));
      }
    })();
    return () => { active = false; ctrl.abort(); };
  }, [runId, generation]);

  const reconnect = React.useCallback(() => setGeneration((g) => g + 1), []);
  const patch = React.useCallback((fn: (r: WorkflowRunRecord | null) => WorkflowRunRecord | null) => setState((s) => ({ ...s, run: fn(s.run) })), []);
  const resting = state.run ? RESTING.has(state.run.status) : false;
  return { ...state, resting, reconnect, patch };
}

export function stepMap(run: WorkflowRunRecord | null): Map<string, WorkflowRunStep> {
  return new Map((run?.steps ?? []).map((s) => [s.nodeId, s]));
}
