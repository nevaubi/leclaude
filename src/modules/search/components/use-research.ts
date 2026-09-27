"use client";
import * as React from "react";
import { nanoid } from "nanoid";
import { readSSE } from "@/lib/ai/sse";
import { isTerminalEvent, type FailureKind, type ResearchStopState, type RunMetrics, type RunTerminalState } from "@/lib/ai/events";
import type { SearchRun, SearchSettings } from "../types";
import type { CitationCrossCheck, CoverageSummary, LaneStatus, ResearchLane, ResearchMessage, ResearchSource, ResearchStreamEvent, ResearchThread, VerificationSummary } from "../engine/types";

/** Progressive stages of a turn; the terminal outcome lives in `outcome`, never in a generic "done". */
export type Stage = "idle" | "planning" | "lanes" | "synthesis" | "verifying" | "correcting" | "finalizing" | "settled" | "cancelled" | "error" | "denied";

export interface LaneView {
  lane: ResearchLane;
  status: LaneStatus;
  sourceIds: string[];
  read: number;
  note?: string;
  startedAt: number;
  durationMs?: number;
  error?: string;
  failure?: FailureKind;
}

/** One compact activity row (constitution §33): a tool call, a read or a lane-level failure. */
export interface ActivityRow {
  id: string;
  laneId?: string;
  label: string;
  status: "running" | "done" | "error";
  at: number;
  failure?: FailureKind;
  retrying?: boolean;
}

export interface RunOutcome {
  terminal: RunTerminalState;
  stop?: ResearchStopState;
  failure?: FailureKind;
  reason?: string;
}

export interface PendingTurn {
  id: string;
  question: string;
  runId: string | null;
  text: string;
  stage: Stage;
  startedAt: number;
  round: number;
  roundReason?: string;
  /** Hash of the answer text currently shown (draft, revised or final). */
  artifactHash?: string;
  verification?: VerificationSummary;
  /** Why verification could not run or bind to the current text. */
  verificationNote?: string;
  citations?: CitationCrossCheck[];
  correction?: string;
  coverage?: CoverageSummary;
  /** The latest meaningful thing the run is doing. */
  current: string;
  activity: ActivityRow[];
  toolFailures: number;
  claims: { supported: number; unsupported: number; contradicted: number };
  metrics?: RunMetrics;
  outcome?: RunOutcome;
}

export interface ResearchError {
  message: string;
  status?: number;
  code?: string;
}

export interface ResearchState {
  threadId: string | null;
  threadTitle: string;
  messages: ResearchMessage[];
  /** The assistant message currently being produced (null when idle). */
  pending: PendingTurn | null;
  lanes: Record<string, LaneView>;
  laneOrder: string[];
  sources: Record<string, ResearchSource>;
  error: ResearchError | null;
  /** The API refused the request or the thread (HTTP 403): a proper state, not a toast. */
  denied: ResearchError | null;
  /** The server-side state moved under us (thread deleted; a new thread was started). */
  stale: string | null;
  noKey: boolean;
  /** The question of the last turn, for Retry. */
  lastQuestion: string | null;
}

const EMPTY: ResearchState = { threadId: null, threadTitle: "", messages: [], pending: null, lanes: {}, laneOrder: [], sources: {}, error: null, denied: null, stale: null, noKey: false, lastQuestion: null };

const MAX_ACTIVITY = 14;

type LegacyErrorEvent = { type: "error"; message: string; code?: string };
type Ev = ResearchStreamEvent | LegacyErrorEvent;

function pushActivity(rows: ActivityRow[], row: ActivityRow): ActivityRow[] {
  const i = rows.findIndex((r) => r.id === row.id);
  const next = i >= 0 ? rows.map((r, k) => (k === i ? { ...r, ...row } : r)) : [...rows, row];
  return next.length > MAX_ACTIVITY ? next.slice(-MAX_ACTIVITY) : next;
}

function mergeSource(prev: ResearchSource | undefined, incoming: ResearchSource): ResearchSource {
  if (!prev) return incoming;
  return { ...prev, ...incoming, read: prev.read || incoming.read, n: incoming.n ?? prev.n, chars: incoming.chars ?? prev.chars, excerpt: incoming.excerpt ?? prev.excerpt, laneIds: Array.from(new Set([...prev.laneIds, ...incoming.laneIds])) };
}

function outcomeOf(m: ResearchMessage): RunOutcome | undefined {
  return m.terminal ? { terminal: m.terminal, stop: m.stop, failure: m.failure, reason: m.failureMessage } : undefined;
}

export function useResearch(opts: { onRunDone?: (r: { runId: string; threadId: string; terminal: RunTerminalState }) => void; onError?: (m: string) => void } = {}) {
  const [state, setState] = React.useState<ResearchState>(EMPTY);
  const abortRef = React.useRef<AbortController | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const patchPending = React.useCallback((fn: (p: PendingTurn) => PendingTurn) => {
    setState((s) => (s.pending ? { ...s, pending: fn(s.pending) } : s));
  }, []);
  const patchLane = React.useCallback((laneId: string, fn: (l: LaneView) => LaneView) => {
    setState((s) => (s.lanes[laneId] ? { ...s, lanes: { ...s.lanes, [laneId]: fn(s.lanes[laneId]) } } : s));
  }, []);

  const onEvent = React.useCallback((ev: Ev) => {
    switch (ev.type) {
      case "run.started":
        setState((s) => ({
          ...s,
          threadId: ev.threadId ?? s.threadId,
          threadTitle: s.threadTitle || ev.question,
          stale: ev.threadReplaced ? "The thread you were in no longer exists on the server, so this question started a new thread." : s.stale,
          pending: s.pending ? { ...s.pending, runId: ev.runId, stage: "planning", current: "Planning research lanes" } : s.pending,
        }));
        break;
      case "plan.created":
        setState((s) => {
          const lanes = { ...s.lanes };
          const order = [...s.laneOrder];
          for (const lane of ev.lanes) { lanes[lane.id] = { lane, status: "queued", sourceIds: [], read: 0, startedAt: Date.now() }; if (!order.includes(lane.id)) order.push(lane.id); }
          const current = ev.round > 1 ? `Round ${ev.round}: ${ev.reason ?? "refining"}` : `${ev.lanes.length} lane${ev.lanes.length === 1 ? "" : "s"} planned`;
          return { ...s, lanes, laneOrder: order, pending: s.pending ? { ...s.pending, stage: "lanes", round: ev.round, roundReason: ev.reason, current } : s.pending };
        });
        break;
      case "lane.started":
        patchLane(ev.laneId, (l) => ({ ...l, status: "retrieving", startedAt: Date.now() }));
        break;
      case "tool.started":
        patchPending((p) => ({ ...p, current: ev.label, activity: pushActivity(p.activity, { id: ev.toolId, laneId: ev.laneId, label: ev.label, status: "running", at: Date.now() }) }));
        if (ev.laneId) patchLane(ev.laneId, (l) => ({ ...l, status: /^search_|^web_search$/.test(ev.name) ? (l.status === "reading" ? "reading" : "retrieving") : "reading" }));
        break;
      case "tool.completed":
        patchPending((p) => ({ ...p, activity: pushActivity(p.activity, { id: ev.toolId, laneId: ev.laneId, label: ev.label, status: "done", at: Date.now() }) }));
        break;
      case "tool.failed":
        patchPending((p) => ({ ...p, toolFailures: p.toolFailures + (ev.retrying ? 0 : 1), current: ev.retrying ? `Retrying: ${ev.label}` : p.current, activity: pushActivity(p.activity, { id: ev.toolId, laneId: ev.laneId, label: `${ev.label} — ${ev.error}`, status: ev.retrying ? "running" : "error", at: Date.now(), failure: ev.failure, retrying: ev.retrying }) }));
        break;
      case "source.found":
        setState((s) => {
          const l = s.lanes[ev.laneId];
          const merged = mergeSource(s.sources[ev.source.id], ev.source);
          return { ...s, sources: { ...s.sources, [ev.source.id]: merged }, lanes: l ? { ...s.lanes, [ev.laneId]: { ...l, sourceIds: l.sourceIds.includes(ev.source.id) ? l.sourceIds : [...l.sourceIds, ev.source.id] } } : s.lanes };
        });
        break;
      case "source.read_started":
        patchPending((p) => ({ ...p, current: `Reading ${ev.title}`, activity: pushActivity(p.activity, { id: `read:${ev.sourceId}`, laneId: ev.laneId, label: `Reading ${ev.title}`, status: "running", at: Date.now() }) }));
        patchLane(ev.laneId, (l) => ({ ...l, status: "reading" }));
        break;
      case "source.read":
        setState((s) => {
          const l = s.lanes[ev.laneId];
          const merged = mergeSource(s.sources[ev.source.id], ev.source);
          const lanes = l ? { ...s.lanes, [ev.laneId]: { ...l, read: l.read + 1, sourceIds: l.sourceIds.includes(ev.source.id) ? l.sourceIds : [...l.sourceIds, ev.source.id] } } : s.lanes;
          const pending = s.pending ? { ...s.pending, activity: pushActivity(s.pending.activity, { id: `read:${ev.sourceId}`, laneId: ev.laneId, label: `Read ${merged.cite ?? merged.title}${ev.cached ? " (cached)" : ""}`, status: "done", at: Date.now() }) } : s.pending;
          return { ...s, sources: { ...s.sources, [ev.source.id]: merged }, lanes, pending };
        });
        break;
      case "lane.completed":
        patchLane(ev.laneId, (l) => ({ ...l, status: ev.status as LaneStatus, durationMs: ev.durationMs, error: ev.error, failure: ev.failure, note: ev.note ?? l.note, read: Math.max(l.read, ev.read) }));
        if (ev.status !== "done") patchPending((p) => ({ ...p, activity: pushActivity(p.activity, { id: `lane:${ev.laneId}`, laneId: ev.laneId, label: ev.status === "timeout" ? (ev.error ?? "Lane timed out") : ev.status === "skipped" ? "Lane skipped (run stopped)" : ev.status === "stopped" ? "Lane stopped" : (ev.error ?? "Lane failed"), status: ev.status === "stopped" || ev.status === "skipped" ? "done" : "error", at: Date.now(), failure: ev.failure }) }));
        break;
      case "synthesis.started":
        patchPending((p) => ({ ...p, stage: "synthesis", text: "", current: `Writing the answer from ${ev.sources} source${ev.sources === 1 ? "" : "s"} (${ev.read} read)` }));
        break;
      case "answer.delta":
        patchPending((p) => ({ ...p, text: p.text + ev.delta }));
        break;
      case "artifact.created":
        setState((s) => {
          const sources = { ...s.sources };
          for (const [n, id] of Object.entries(ev.citeMap)) if (sources[id]) sources[id] = { ...sources[id], n: Number(n) };
          return { ...s, sources, pending: s.pending ? { ...s.pending, text: ev.text, artifactHash: ev.artifactHash, stage: ev.stage === "final" ? "finalizing" : s.pending.stage, current: ev.stage === "revised" ? "Answer revised after verification" : ev.stage === "final" ? "Finalizing" : s.pending.current } : s.pending };
        });
        break;
      case "verification.started":
        patchPending((p) => ({ ...p, stage: "verifying", current: `${ev.pass > 1 ? "Re-checking" : "Checking"} claims against ${ev.sources} source${ev.sources === 1 ? "" : "s"} read`, claims: { supported: 0, unsupported: 0, contradicted: 0 } }));
        break;
      case "claim.supported":
        patchPending((p) => ({ ...p, claims: { ...p.claims, supported: p.claims.supported + 1 } }));
        break;
      case "claim.unsupported":
        patchPending((p) => ({ ...p, claims: { ...p.claims, unsupported: p.claims.unsupported + 1 } }));
        break;
      case "claim.contradicted":
        patchPending((p) => ({ ...p, claims: { ...p.claims, contradicted: p.claims.contradicted + 1 } }));
        break;
      case "verification.completed":
        patchPending((p) => ({ ...p, verification: ev.verification, verificationNote: undefined, current: `${ev.supported} of ${ev.supported + ev.unsupported + ev.contradicted} claims supported` }));
        break;
      case "verification.unavailable":
        patchPending((p) => ({ ...p, verificationNote: ev.reason, current: "Verification unavailable" }));
        break;
      case "correction.started":
        patchPending((p) => ({ ...p, stage: "correcting", current: `Revising ${ev.unsupported + ev.contradicted} flagged claim${ev.unsupported + ev.contradicted === 1 ? "" : "s"}` }));
        break;
      case "correction.completed":
        patchPending((p) => ({ ...p, correction: ev.note }));
        break;
      case "citation.checked":
        patchPending((p) => ({ ...p, stage: "finalizing", citations: ev.checks, current: ev.unresolved ? `${ev.unresolved} citation${ev.unresolved === 1 ? "" : "s"} unresolved` : "Citations cross-checked" }));
        break;
      case "coverage.gap":
        patchPending((p) => ({ ...p, coverage: { complete: false, reason: ev.reason, gaps: ev.gaps }, roundReason: ev.reason }));
        break;
      case "round.completed":
        patchPending((p) => ({ ...p, roundReason: ev.reason, coverage: p.coverage && !ev.complete ? p.coverage : { complete: ev.complete && !(p.coverage && !p.coverage.complete && p.coverage.reason === ev.reason), reason: ev.reason, gaps: p.coverage?.gaps ?? [] } }));
        break;
      case "review.required":
        patchPending((p) => ({ ...p, current: `Human review required: ${ev.reason}` }));
        break;
      case "run.completed":
      case "run.partial":
      case "run.failed":
      case "run.cancelled":
        setState((s) => {
          const sources = { ...s.sources };
          for (const src of ev.sources) sources[src.id] = { ...(sources[src.id] ?? src), ...src, read: (sources[src.id]?.read ?? false) || src.read };
          for (const [n, id] of Object.entries(ev.message.citeMap ?? {})) if (sources[id]) sources[id] = { ...sources[id], n: Number(n) };
          const user: ResearchMessage = { id: `u_${ev.message.id}`, role: "user", content: s.pending?.question ?? "", createdAt: ev.message.createdAt };
          const lanes = Object.fromEntries(Object.entries(s.lanes).map(([k, l]) => [k, l.status === "queued" || l.status === "retrieving" || l.status === "reading" ? { ...l, status: (ev.type === "run.cancelled" ? "stopped" : "done") as LaneStatus } : l]));
          return { ...s, sources, lanes, messages: [...s.messages, user, ev.message], pending: null, noKey: ev.message.banner === "no-api-key", threadId: ev.threadId ?? s.threadId };
        });
        optsRef.current.onRunDone?.({ runId: ev.runId, threadId: ev.threadId ?? "", terminal: ev.terminal });
        break;
      case "error":
        setState((s) => ({ ...s, error: { message: ev.message, code: ev.code }, noKey: ev.code === "no_api_key" ? true : s.noKey, pending: s.pending ? { ...s.pending, stage: "error", outcome: { terminal: "failed", failure: "unknown", reason: ev.message } } : s.pending }));
        optsRef.current.onError?.(ev.message);
        break;
      default:
        break;
    }
  }, [patchPending, patchLane]);

  /** Ask a question (new thread when none is active). */
  const ask = React.useCallback(async (question: string, settings: SearchSettings, extra: { savedSearchId?: string; newThread?: boolean } = {}) => {
    const q = question.trim();
    if (!q) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const runId = `run_${nanoid(10)}`;
    const threadId = extra.newThread ? null : state.threadId;
    setState((s) => ({
      ...(extra.newThread ? { ...EMPTY } : s),
      threadId,
      threadTitle: extra.newThread ? q : s.threadTitle || q,
      error: null,
      denied: null,
      stale: extra.newThread ? null : s.stale,
      lanes: {},
      laneOrder: [],
      lastQuestion: q,
      pending: { id: `p_${runId}`, question: q, runId, text: "", stage: "planning", startedAt: Date.now(), round: 1, current: "Sending the question", activity: [], toolFailures: 0, claims: { supported: 0, unsupported: 0, contradicted: 0 } },
    }));
    try {
      const res = await fetch("/api/search/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, message: q, runId, threadId, savedSearchId: extra.savedSearchId }), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        let msg = `${res.status} ${res.statusText}`;
        let code: string | undefined;
        try { const j = (await res.json()) as { error?: string; code?: string }; if (j.error) msg = j.error; code = j.code; } catch { /* ignore */ }
        if (res.status === 403 || res.status === 401) {
          setState((s) => ({ ...s, denied: { message: msg, status: res.status, code }, pending: s.pending ? { ...s.pending, stage: "denied" } : null }));
          return;
        }
        throw Object.assign(new Error(msg), { status: res.status, code });
      }
      let sawTerminal = false;
      await readSSE<Ev>(res, (ev) => { if (isTerminalEvent(ev as { type: string })) sawTerminal = true; onEvent(ev); }, ctrl.signal);
      // If the stream ended without a terminal event (server crash, proxy cut), close the turn as a failure, never as success.
      if (!sawTerminal) setState((s) => (s.pending ? { ...s, pending: { ...s.pending, stage: "error", outcome: { terminal: "failed", failure: "incomplete_result", reason: "The research run ended before an answer was produced." } }, error: s.error ?? { message: "The research run ended before an answer was produced." } } : s));
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Cancelled by the user: the turn settles locally with whatever answer text had streamed (the server persists the same partial answer).
        setState((s) => {
          if (!s.pending) return s;
          const p = s.pending;
          const lanes = Object.fromEntries(Object.entries(s.lanes).map(([k, l]) => [k, l.status === "done" || l.status === "error" || l.status === "timeout" ? l : { ...l, status: "stopped" as LaneStatus }]));
          const assistant: ResearchMessage = { id: `local_${p.runId ?? nanoid(6)}`, role: "assistant", content: p.text, createdAt: new Date().toISOString(), runId: p.runId ?? undefined, terminal: "cancelled", stop: "cancelled", failure: "cancelled", failureMessage: p.text ? "Stopped by you; the partial answer is kept and was not verified as final." : "Stopped by you before an answer was produced.", artifactHash: p.artifactHash, verification: p.verification, citations: p.citations, citeMap: {}, lanes: Object.values(lanes).map((l) => ({ id: l.lane.id, name: l.lane.name, kind: l.lane.kind, status: l.status, sources: l.sourceIds.length, read: l.read, durationMs: l.durationMs ?? Date.now() - l.startedAt, round: l.lane.round, error: l.error, failure: l.failure })), coverage: p.coverage, trust: "generated" };
          const user: ResearchMessage = { id: `u_${assistant.id}`, role: "user", content: p.question, createdAt: new Date(p.startedAt).toISOString() };
          return { ...s, lanes, messages: [...s.messages, user, assistant], pending: null };
        });
        return;
      }
      const err = e as Error & { status?: number; code?: string };
      const message = err instanceof Error ? err.message : String(e);
      setState((s) => ({ ...s, error: { message, status: err.status, code: err.code }, pending: s.pending ? { ...s.pending, stage: "error", outcome: { terminal: "failed", failure: err.status && err.status >= 500 ? "provider_outage" : "unknown", reason: message } } : null }));
      optsRef.current.onError?.(message);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [onEvent, state.threadId]);

  const stop = React.useCallback(() => { abortRef.current?.abort(); abortRef.current = null; }, []);

  /** Show a stored thread. */
  const loadThread = React.useCallback((t: ResearchThread) => {
    abortRef.current?.abort();
    const sources: Record<string, ResearchSource> = {};
    for (const s of t.sources) sources[s.id] = s;
    // Re-apply the last answer's citation numbers so the Sources tab matches the answer on screen.
    const last = [...t.messages].reverse().find((m) => m.role === "assistant");
    if (last?.citeMap) for (const [n, id] of Object.entries(last.citeMap)) if (sources[id]) sources[id] = { ...sources[id], n: Number(n) };
    const lanes: Record<string, LaneView> = {};
    const laneOrder: string[] = [];
    for (const l of last?.lanes ?? []) { lanes[l.id] = { lane: { id: l.id, kind: l.kind, name: l.name, brief: "", sources: [], tools: [], queries: [], maxSteps: 0, maxReads: 0, round: l.round }, status: l.status, sourceIds: t.sources.filter((s) => s.laneIds.includes(l.id)).map((s) => s.id), read: l.read ?? 0, startedAt: 0, durationMs: l.durationMs, error: l.error, failure: l.failure }; laneOrder.push(l.id); }
    const lastQuestion = [...t.messages].reverse().find((m) => m.role === "user")?.content ?? null;
    setState({ threadId: t.id, threadTitle: t.title, messages: t.messages, pending: null, lanes, laneOrder, sources, error: null, denied: null, stale: null, noKey: last?.banner === "no-api-key", lastQuestion });
  }, []);

  /** Show a legacy history run (pre-thread) as a one-turn thread. */
  const loadRun = React.useCallback((r: SearchRun) => {
    abortRef.current?.abort();
    const sources: Record<string, ResearchSource> = {};
    for (const s of r.sources ?? []) sources[s.id] = s;
    if (!r.sources?.length) for (const h of r.topHits ?? []) sources[h.id] = { id: h.id, kind: h.source, title: h.title, cite: h.cite, url: h.url, court: h.courtId, date: h.date, authority: h.authority, snippet: h.snippet, read: false, laneIds: [], hit: h, scope: h.source === "ediscovery" ? "record" : h.source === "library" ? "internal" : h.source === "web" ? "web" : "authority", foundAt: new Date(r.createdAt).getTime() };
    const assistant: ResearchMessage = { id: `run_${r.id}`, role: "assistant", content: r.synthesis ?? "", createdAt: r.createdAt, runId: r.id, stats: r.stats, verification: r.verification ? { ...r.verification, verdicts: [] } : undefined, provenance: r.provenance, banner: r.aiStatus === "no_api_key" ? "no-api-key" : r.banner ?? null, followUps: r.followUps, terminal: r.terminal, stop: r.stop, failure: r.failure, metrics: r.metrics, artifactHash: r.artifactHash, trust: r.trust, mode: r.mode };
    setState({ threadId: r.threadId ?? null, threadTitle: r.query, messages: [{ id: `u_${r.id}`, role: "user", content: r.query, createdAt: r.createdAt }, assistant], pending: null, lanes: {}, laneOrder: [], sources, error: null, denied: null, stale: null, noKey: r.aiStatus === "no_api_key", lastQuestion: r.query });
  }, []);

  /** Mark the view as denied (e.g. a thread the API refused to return). */
  const deny = React.useCallback((message: string, status?: number) => { abortRef.current?.abort(); setState((s) => ({ ...s, denied: { message, status }, pending: null })); }, []);

  const reset = React.useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setState(EMPTY); }, []);

  const sourceList = React.useMemo(() => Object.values(state.sources).sort((a, b) => (a.n ?? 999) - (b.n ?? 999) || a.foundAt - b.foundAt), [state.sources]);
  const streaming = state.pending != null && state.pending.stage !== "settled" && state.pending.stage !== "error" && state.pending.stage !== "cancelled" && state.pending.stage !== "denied";

  return { state, ask, stop, loadThread, loadRun, reset, deny, sourceList, streaming, outcomeOf };
}

export { outcomeOf };
