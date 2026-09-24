"use client";
import * as React from "react";
import { nanoid } from "nanoid";
import { readSSE } from "@/lib/ai/sse";
import type { AgentEvent } from "@/lib/ai/agent";
import type { SearchRun, SearchSettings } from "../types";
import type { CitationCrossCheck, LaneStatus, ResearchLane, ResearchMessage, ResearchSource, ResearchStreamEvent, ResearchThread, RunStats, VerificationSummary } from "../engine/types";

export type Stage = "idle" | "planning" | "lanes" | "synthesis" | "verifying" | "correcting" | "finalizing" | "done" | "error";

export interface LaneView {
  lane: ResearchLane;
  status: LaneStatus;
  steps: { n: number; label: string; status: LaneStatus; at: number }[];
  sourceIds: string[];
  note?: string;
  startedAt: number;
  durationMs?: number;
  error?: string;
}

export interface ResearchState {
  threadId: string | null;
  threadTitle: string;
  messages: ResearchMessage[];
  /** The assistant message currently being produced (null when idle). */
  pending: { id: string; question: string; runId: string | null; text: string; stage: Stage; startedAt: number; round: number; roundReason?: string; verification?: VerificationSummary; citations?: CitationCrossCheck[]; correction?: string; stats?: RunStats } | null;
  lanes: Record<string, LaneView>;
  laneOrder: string[];
  sources: Record<string, ResearchSource>;
  error: string | null;
  noKey: boolean;
}

const EMPTY: ResearchState = { threadId: null, threadTitle: "", messages: [], pending: null, lanes: {}, laneOrder: [], sources: {}, error: null, noKey: false };

type Ev = ResearchStreamEvent | AgentEvent;

export function useResearch(opts: { onRunDone?: (r: { runId: string; threadId: string }) => void; onError?: (m: string) => void } = {}) {
  const [state, setState] = React.useState<ResearchState>(EMPTY);
  const abortRef = React.useRef<AbortController | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const patchPending = React.useCallback((fn: (p: NonNullable<ResearchState["pending"]>) => NonNullable<ResearchState["pending"]>) => {
    setState((s) => (s.pending ? { ...s, pending: fn(s.pending) } : s));
  }, []);

  const onEvent = React.useCallback((ev: Ev) => {
    switch (ev.type) {
      case "run.start":
        setState((s) => ({ ...s, threadId: ev.threadId, threadTitle: s.threadTitle || ev.question, pending: s.pending ? { ...s.pending, runId: ev.runId, stage: "planning" } : s.pending }));
        break;
      case "plan":
        setState((s) => {
          const lanes = { ...s.lanes };
          const order = [...s.laneOrder];
          for (const lane of ev.lanes) { lanes[lane.id] = { lane, status: "queued", steps: [], sourceIds: [], startedAt: Date.now() }; if (!order.includes(lane.id)) order.push(lane.id); }
          return { ...s, lanes, laneOrder: order, pending: s.pending ? { ...s.pending, stage: "lanes", round: ev.round } : s.pending };
        });
        break;
      case "round.start":
        patchPending((p) => ({ ...p, round: ev.round, roundReason: ev.reason, stage: "lanes" }));
        break;
      case "lane.start":
        setState((s) => (s.lanes[ev.laneId] ? { ...s, lanes: { ...s.lanes, [ev.laneId]: { ...s.lanes[ev.laneId], status: "retrieving", startedAt: Date.now() } } } : s));
        break;
      case "lane.step":
        setState((s) => { const l = s.lanes[ev.laneId]; if (!l) return s; return { ...s, lanes: { ...s.lanes, [ev.laneId]: { ...l, status: ev.status === "error" ? l.status : ev.status, steps: [...l.steps, { n: ev.step, label: ev.label, status: ev.status, at: Date.now() }].slice(-40) } } }; });
        break;
      case "lane.source":
        setState((s) => {
          const l = s.lanes[ev.laneId];
          const prev = s.sources[ev.source.id];
          const merged: ResearchSource = prev ? { ...prev, ...ev.source, read: prev.read || ev.source.read, n: ev.source.n ?? prev.n, laneIds: Array.from(new Set([...prev.laneIds, ...ev.source.laneIds])) } : ev.source;
          return { ...s, sources: { ...s.sources, [ev.source.id]: merged }, lanes: l ? { ...s.lanes, [ev.laneId]: { ...l, sourceIds: l.sourceIds.includes(ev.source.id) ? l.sourceIds : [...l.sourceIds, ev.source.id] } } : s.lanes };
        });
        break;
      case "lane.note":
        setState((s) => (s.lanes[ev.laneId] ? { ...s, lanes: { ...s.lanes, [ev.laneId]: { ...s.lanes[ev.laneId], note: ev.note } } } : s));
        break;
      case "lane.done":
        setState((s) => (s.lanes[ev.laneId] ? { ...s, lanes: { ...s.lanes, [ev.laneId]: { ...s.lanes[ev.laneId], status: ev.status, durationMs: ev.durationMs, error: ev.error } } } : s));
        break;
      case "synthesis.start":
        patchPending((p) => ({ ...p, stage: "synthesis", text: "" }));
        break;
      case "text.delta":
        patchPending((p) => ({ ...p, text: p.text + ev.delta }));
        break;
      case "answer.text":
        setState((s) => {
          const sources = { ...s.sources };
          for (const [n, id] of Object.entries(ev.citeMap)) if (sources[id]) sources[id] = { ...sources[id], n: Number(n) };
          return { ...s, sources, pending: s.pending ? { ...s.pending, text: ev.text, stage: ev.stage === "final" ? "finalizing" : s.pending.stage } : s.pending };
        });
        break;
      case "verify.start":
        patchPending((p) => ({ ...p, stage: "verifying" }));
        break;
      case "verify.done":
        patchPending((p) => ({ ...p, verification: ev.verification }));
        break;
      case "correction":
        patchPending((p) => ({ ...p, stage: "correcting", correction: ev.note }));
        break;
      case "citecheck":
        patchPending((p) => ({ ...p, citations: ev.checks }));
        break;
      case "round.done":
        patchPending((p) => ({ ...p, roundReason: ev.reason }));
        break;
      case "answer.final":
        setState((s) => {
          const sources = { ...s.sources };
          for (const src of ev.sources) sources[src.id] = { ...(sources[src.id] ?? src), ...src, read: (sources[src.id]?.read ?? false) || src.read };
          const user: ResearchMessage = { id: `u_${ev.message.id}`, role: "user", content: s.pending?.question ?? "", createdAt: ev.message.createdAt };
          return { ...s, sources, messages: [...s.messages, user, ev.message], pending: null, noKey: ev.message.banner === "no-api-key" };
        });
        break;
      case "run.done":
        optsRef.current.onRunDone?.({ runId: ev.runId, threadId: ev.threadId });
        break;
      case "error":
        setState((s) => ({ ...s, error: ev.message, noKey: ev.code === "no_api_key" ? true : s.noKey }));
        optsRef.current.onError?.(ev.message);
        break;
      default:
        break;
    }
  }, [patchPending]);

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
      lanes: {},
      laneOrder: [],
      pending: { id: `p_${runId}`, question: q, runId, text: "", stage: "planning", startedAt: Date.now(), round: 1 },
    }));
    try {
      const res = await fetch("/api/search/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, message: q, runId, threadId, savedSearchId: extra.savedSearchId }), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        let msg = `${res.status} ${res.statusText}`;
        try { const j = (await res.json()) as { error?: string }; if (j.error) msg = j.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      await readSSE<Ev>(res, onEvent, ctrl.signal);
      // If the stream ended without answer.final (server error), close the pending turn gracefully.
      setState((s) => (s.pending ? { ...s, pending: { ...s.pending, stage: "error" }, error: s.error ?? "The research run ended before an answer was produced." } : s));
    } catch (e) {
      if ((e as Error).name === "AbortError") { setState((s) => (s.pending ? { ...s, pending: { ...s.pending, stage: "done" }, lanes: Object.fromEntries(Object.entries(s.lanes).map(([k, l]) => [k, l.status === "done" || l.status === "error" ? l : { ...l, status: "stopped" }])) } : s)); return; }
      const message = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, error: message, pending: s.pending ? { ...s.pending, stage: "error" } : null }));
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
    for (const l of last?.lanes ?? []) { lanes[l.id] = { lane: { id: l.id, kind: l.kind, name: l.name, brief: "", sources: [], tools: [], queries: [], maxSteps: 0, maxReads: 0, round: l.round }, status: l.status, steps: [], sourceIds: t.sources.filter((s) => s.laneIds.includes(l.id)).map((s) => s.id), startedAt: 0, durationMs: l.durationMs }; laneOrder.push(l.id); }
    setState({ threadId: t.id, threadTitle: t.title, messages: t.messages, pending: null, lanes, laneOrder, sources, error: null, noKey: last?.banner === "no-api-key" });
  }, []);

  /** Show a legacy history run (pre-thread) as a one-turn thread. */
  const loadRun = React.useCallback((r: SearchRun) => {
    abortRef.current?.abort();
    const sources: Record<string, ResearchSource> = {};
    for (const s of r.sources ?? []) sources[s.id] = s;
    if (!r.sources?.length) for (const h of r.topHits ?? []) sources[h.id] = { id: h.id, kind: h.source, title: h.title, cite: h.cite, url: h.url, court: h.courtId, date: h.date, authority: h.authority, snippet: h.snippet, read: false, laneIds: [], hit: h, scope: h.source === "ediscovery" ? "record" : h.source === "library" ? "internal" : h.source === "web" ? "web" : "authority", foundAt: new Date(r.createdAt).getTime() };
    const assistant: ResearchMessage = { id: `run_${r.id}`, role: "assistant", content: r.synthesis ?? "", createdAt: r.createdAt, runId: r.id, stats: r.stats, verification: r.verification ? { ...r.verification, verdicts: [] } : undefined, provenance: r.provenance, banner: r.aiStatus === "no_api_key" ? "no-api-key" : r.banner ?? null, followUps: r.followUps };
    setState({ threadId: r.threadId ?? null, threadTitle: r.query, messages: [{ id: `u_${r.id}`, role: "user", content: r.query, createdAt: r.createdAt }, assistant], pending: null, lanes: {}, laneOrder: [], sources, error: null, noKey: r.aiStatus === "no_api_key" });
  }, []);

  const reset = React.useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setState(EMPTY); }, []);

  const sourceList = React.useMemo(() => Object.values(state.sources).sort((a, b) => (a.n ?? 999) - (b.n ?? 999) || a.foundAt - b.foundAt), [state.sources]);
  const streaming = state.pending != null && state.pending.stage !== "done" && state.pending.stage !== "error";

  return { state, ask, stop, loadThread, loadRun, reset, sourceList, streaming };
}
