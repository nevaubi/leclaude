"use client";
import * as React from "react";
import { nanoid } from "nanoid";
import { useAgent, type AgentMessage } from "@/hooks/use-agent";
import { readSSE } from "@/lib/ai/sse";
import type { AgentEvent } from "@/lib/ai/agent";
import { normalizeWebCitation } from "../normalize";
import { ALL_SOURCES, type SearchHit, type SearchRun, type SearchSettings, type SearchSource, type SearchStreamEvent } from "../types";

export type SourceStatus = "idle" | "loading" | "done" | "error" | "stopped";
export interface SourceState { status: SourceStatus; hits: SearchHit[]; total: number; error?: string; durationMs?: number }

export interface RunState {
  runId: string | null;
  query: string;
  settings: SearchSettings | null;
  startedAt: number | null;
  sources: Record<SearchSource, SourceState>;
  retrievalDone: boolean;
  done: boolean;
  durationMs?: number;
  /** Set when the view shows a cached run from history rather than a live run. */
  cached?: { createdAt: string; id: string };
  aiNoKey?: boolean;
}

const emptySources = (): Record<SearchSource, SourceState> => {
  const out = {} as Record<SearchSource, SourceState>;
  for (const s of ALL_SOURCES) out[s] = { status: "idle", hits: [], total: 0 };
  return out;
};

export const EMPTY_RUN: RunState = { runId: null, query: "", settings: null, startedAt: null, sources: emptySources(), retrievalDone: false, done: false };

type StreamEvent = AgentEvent | SearchStreamEvent;

export function useSearch(opts: { onRunDone?: (runId: string) => void; onError?: (message: string) => void } = {}) {
  const [run, setRun] = React.useState<RunState>(EMPTY_RUN);
  const settingsRef = React.useRef<SearchSettings | null>(null);
  const savedIdRef = React.useRef<string | undefined>(undefined);
  const followUpRef = React.useRef(false);
  const runIdRef = React.useRef<string | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const patchSource = React.useCallback((source: SearchSource, patch: Partial<SourceState>) => {
    setRun((r) => ({ ...r, sources: { ...r.sources, [source]: { ...r.sources[source], ...patch } } }));
  }, []);

  const onEvent = React.useCallback((raw: AgentEvent) => {
    const ev = raw as StreamEvent;
    switch (ev.type) {
      case "run.start":
        runIdRef.current = ev.runId;
        setRun((r) => ({ ...r, runId: ev.runId, cached: undefined }));
        break;
      case "results":
        patchSource(ev.source, { status: "done", hits: ev.results, total: ev.total, durationMs: ev.durationMs, error: undefined });
        break;
      case "source.error":
        patchSource(ev.source, { status: "error", error: ev.message, durationMs: ev.durationMs });
        break;
      case "retrieval.done":
        setRun((r) => ({ ...r, retrievalDone: true }));
        break;
      case "run.done":
        setRun((r) => ({ ...r, done: true, durationMs: ev.durationMs, sources: Object.fromEntries(Object.entries(r.sources).map(([k, v]) => [k, v.status === "loading" ? { ...v, status: "done" } : v])) as Record<SearchSource, SourceState> }));
        optsRef.current.onRunDone?.(ev.runId);
        break;
      case "citation":
        if (ev.citation.source === "web" && ev.citation.url) {
          setRun((r) => {
            const cur = r.sources.web;
            if (cur.hits.some((h) => h.url === ev.citation.url)) return r;
            const hit = normalizeWebCitation(ev.citation, cur.hits.length);
            return { ...r, sources: { ...r.sources, web: { ...cur, status: "done", hits: [...cur.hits, hit], total: cur.hits.length + 1 } } };
          });
        }
        break;
      case "error":
        if (ev.code === "no_api_key") setRun((r) => ({ ...r, aiNoKey: true, sources: { ...r.sources, web: r.sources.web.status === "loading" ? { ...r.sources.web, status: "error", error: "OpenAI web search requires OPENAI_API_KEY." } : r.sources.web } }));
        break;
      default:
        break;
    }
  }, [patchSource]);

  const agent = useAgent({
    endpoint: "/api/search/run",
    extra: () => {
      const s = settingsRef.current ?? ({} as SearchSettings);
      const base: Record<string, unknown> = { ...s, history: [], savedSearchId: savedIdRef.current, runId: runIdRef.current ?? undefined };
      if (followUpRef.current) base.followUp = true; else base.previousResponseId = null;
      return base;
    },
    onEvent,
    onError: (m) => optsRef.current.onError?.(m),
  });
  const agentRef = React.useRef(agent);
  agentRef.current = agent;

  /** Start a fresh run: structured retrieval + synthesis. */
  const start = React.useCallback((query: string, settings: SearchSettings, extra: { savedSearchId?: string } = {}) => {
    const q = query.trim();
    if (!q) return;
    settingsRef.current = settings;
    savedIdRef.current = extra.savedSearchId;
    followUpRef.current = false;
    runIdRef.current = `run_${nanoid(10)}`;
    const sources = emptySources();
    for (const s of settings.sources) sources[s] = { status: "loading", hits: [], total: 0 };
    setRun({ runId: runIdRef.current, query: q, settings, startedAt: Date.now(), sources, retrievalDone: false, done: false });
    agentRef.current.reset();
    void agentRef.current.send(q, { hidden: true });
  }, []);

  /** Ask a follow-up question of the synthesis agent (keeps the conversation; no new retrieval). */
  const followUp = React.useCallback((message: string) => {
    if (!settingsRef.current) return;
    followUpRef.current = true;
    void agentRef.current.send(message);
  }, []);

  const stop = React.useCallback(() => {
    agentRef.current.stop();
    setRun((r) => ({ ...r, done: true, sources: Object.fromEntries(Object.entries(r.sources).map(([k, v]) => [k, v.status === "loading" ? { ...v, status: "stopped", error: "Stopped" } : v])) as Record<SearchSource, SourceState> }));
  }, []);

  /** Re-run one provider only (no synthesis), e.g. after "provider unreachable". */
  const retrySource = React.useCallback(async (source: SearchSource) => {
    const settings = settingsRef.current;
    const query = run.query;
    if (!settings || !query) return;
    patchSource(source, { status: "loading", error: undefined });
    try {
      const res = await fetch("/api/search/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, sources: [source], message: query, skipSynthesis: true, runId: `retry_${nanoid(6)}` }) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await readSSE<StreamEvent>(res, (ev) => {
        if (ev.type === "results" && ev.source === source) patchSource(source, { status: "done", hits: ev.results, total: ev.total, durationMs: ev.durationMs, error: undefined });
        if (ev.type === "source.error" && ev.source === source) patchSource(source, { status: "error", error: ev.message, durationMs: ev.durationMs });
      });
    } catch (e) {
      patchSource(source, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [run.query, patchSource]);

  /** Show a cached run from history. */
  const restore = React.useCallback((cached: SearchRun) => {
    agentRef.current.stop();
    settingsRef.current = cached.settings;
    followUpRef.current = false;
    runIdRef.current = cached.id;
    const sources = emptySources();
    for (const s of cached.settings.sources) {
      const hits = (cached.topHits ?? []).filter((h) => h.source === s);
      const err = cached.errors?.find((e) => e.source === s);
      sources[s] = { status: err ? "error" : "done", hits, total: cached.totals?.[s] ?? cached.counts[s] ?? hits.length, error: err?.message };
    }
    setRun({ runId: cached.id, query: cached.query, settings: cached.settings, startedAt: new Date(cached.createdAt).getTime(), sources, retrievalDone: true, done: true, durationMs: cached.durationMs, cached: { createdAt: cached.createdAt, id: cached.id }, aiNoKey: cached.aiStatus === "no_api_key" });
    const msg: AgentMessage = { id: `cached_${cached.id}`, role: "assistant", content: cached.synthesis ?? "", createdAt: new Date(cached.createdAt).getTime(), status: cached.aiStatus === "no_api_key" ? "error" : "done", error: cached.aiStatus === "no_api_key" ? "OPENAI_API_KEY was not configured when this search ran; structured results were cached." : undefined, tools: [], citations: [] };
    agentRef.current.setMessages([msg]);
  }, []);

  const clear = React.useCallback(() => {
    agentRef.current.reset();
    settingsRef.current = null;
    runIdRef.current = null;
    setRun(EMPTY_RUN);
  }, []);

  const allHits = React.useMemo(() => ALL_SOURCES.flatMap((s) => run.sources[s].hits), [run.sources]);

  return { run, allHits, agent, start, followUp, stop, retrySource, restore, clear, isStreaming: agent.isStreaming };
}
