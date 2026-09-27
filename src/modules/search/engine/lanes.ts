import "server-only";
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { AgentEvent } from "@/lib/ai/agent";
import { AIConfigError } from "@/lib/ai/config";
import { classifyFailure, isAbortError, type FailureKind } from "@/lib/ai/events";
import { matterContextTool } from "@/lib/ai/toolkit/internal";
import type { Matter } from "@/lib/types/domain";
import { FIRM_NAME, LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import { jurisdictionByKey } from "../jurisdictions";
import { formatBluebook, normalizeWebCitation } from "../normalize";
import { providerMessage } from "../service";
import { SOURCE_LABEL, type ReadRef, type SearchHit, type SearchSettings, type SearchSource } from "../types";
import type { ReadRegistry } from "./cache";
import type { EngineDeps } from "./deps";
import { priorQueries } from "./planner";
import { abortError, withRetry, type MetricsRecorder, type RunPolicy } from "./runtime";
import { mergeSources, sourceFromHit, sourceKey } from "./sources";
import type { LaneStatus, ResearchEventInput, ResearchLane, ResearchSource } from "./types";

export interface LaneContext {
  question: string;
  settings: SearchSettings;
  matter: Matter | null;
  deps: EngineDeps;
  /** Typed event emitter (runId/at/seq are stamped by the run). */
  emit: (e: ResearchEventInput) => void;
  /** Lane-scoped signal: fires on run cancellation or on this lane's timeout. Every provider/model call receives it. */
  signal?: AbortSignal;
  /** The run's own signal, to tell a cancellation from a lane timeout when classifying the outcome. */
  runSignal?: AbortSignal;
  /** True once this lane's timeout fired. */
  timedOut?: () => boolean;
  /** Shared full-text store (source id → text) for the run. */
  texts: Map<string, string>;
  /** Shared in-flight read registry so two lanes never fetch the same source twice. */
  reads: ReadRegistry;
  /** Sources already known to the run/thread (for dedupe awareness). */
  known: ResearchSource[];
  policy: RunPolicy;
  metrics?: MetricsRecorder;
  /** Results of the lanes this lane depends on (dependency-aware scheduling). */
  priors: LaneResult[];
}

export interface LaneFailure {
  name: string;
  error: string;
  failure: FailureKind;
}

export interface LaneResult {
  laneId: string;
  status: LaneStatus;
  sources: ResearchSource[];
  read: number;
  note: string;
  agentRan: boolean;
  durationMs: number;
  /** Set when the lane ended in error/timeout, or when it completed with provider/tool failures inside it. */
  error?: string;
  failure?: FailureKind;
  /** Provider/tool failures that did not stop the lane (partial failures the UI lists). */
  failures: LaneFailure[];
}

const SEARCH_TOOL_FOR: Partial<Record<string, SearchSource>> = {
  search_case_law: "caselaw", search_dockets: "dockets", search_cfr: "regulations", search_federal_register: "federal_register", search_statutes: "statutes", search_library: "library", search_ediscovery: "ediscovery",
};

const SEARCH_TOOL_DESC: Record<string, string> = {
  search_case_law: "Search U.S. court opinions (CourtListener). Boolean operators, quoted phrases and proximity are supported. Returns source ids usable with read_source.",
  search_dockets: "Search federal dockets (PACER/RECAP): parties, nature of suit, judge, filing dates.",
  search_cfr: "Search the Code of Federal Regulations (eCFR).",
  search_federal_register: "Search Federal Register rules, proposed rules and notices.",
  search_statutes: "Search the U.S. Code and public laws (GovInfo).",
  search_library: "Search the firm's knowledge library: memos, briefs, clause bank, templates.",
  search_ediscovery: "Search this matter's document collection and deposition transcripts (Bates-numbered).",
};

/** Run one lane: deterministic provider retrieval (with retry on transient failures), then (with a key) a bounded fast-model agent that reads the best sources. */
export async function runLane(lane: ResearchLane, ctx: LaneContext, slot: { queuedMs?: number } = {}): Promise<LaneResult> {
  const t0 = Date.now();
  const { deps, emit, signal, policy } = ctx;
  let sources: ResearchSource[] = [];
  const found = new Map<string, ResearchSource>();
  let reads = 0;
  let agentRan = false;
  let note = "";
  let toolSeq = 0;
  const failures: LaneFailure[] = [];
  const nextToolId = () => `${lane.id}:t${++toolSeq}`;
  const retry = { retries: policy.retrievalRetries, baseMs: policy.retryBaseMs, maxMs: policy.retryMaxMs, signal };

  const record = (incoming: ResearchSource[], announce = true) => {
    for (const s of incoming) {
      const prev = found.get(s.id);
      const merged = prev ? mergeSources([prev], [s])[0] : s;
      found.set(s.id, merged);
      if (announce) emit({ type: "source.found", laneId: lane.id, sourceId: merged.id, title: merged.title, cite: merged.cite, kind: merged.kind, source: merged });
    }
    sources = Array.from(found.values());
  };
  const readCount = () => sources.filter((s) => s.read).length;

  emit({ type: "lane.started", laneId: lane.id, round: lane.round, queuedMs: slot.queuedMs ?? 0 });
  try {
    // 1. Structured retrieval across the lane's providers (parallel); every hit becomes a "found" source.
    //    Dependent lanes add queries built from what their dependencies read (e.g. authority that limits the leading cases).
    const queries = Array.from(new Set([...lane.queries, ...priorQueries(lane, ctx.priors)])).slice(0, 4);
    await Promise.all(lane.sources.filter((s) => s !== "web").flatMap((source) => queries.map(async (q) => {
      const toolId = nextToolId();
      const name = `search_${source}`;
      const label = `Searching ${SOURCE_LABEL[source].toLowerCase()}: ${q}`;
      const started = Date.now();
      emit({ type: "tool.started", laneId: lane.id, toolId, name, label });
      try {
        const { hits } = await withRetry(() => deps.retrieve(source, q, ctx.settings, signal), {
          ...retry,
          onRetry: ({ error, failure, delayMs }) => emit({ type: "tool.failed", laneId: lane.id, toolId, name, label, error: `${providerMessage(error)} Retrying in ${(delayMs / 1000).toFixed(1)}s.`, failure, durationMs: Date.now() - started, retrying: true }),
        });
        ctx.metrics?.addToolTime(Date.now() - started);
        record(hits.slice(0, 10).map((h) => sourceFromHit(h, lane.id)));
        emit({ type: "tool.completed", laneId: lane.id, toolId, name, label, durationMs: Date.now() - started });
      } catch (e) {
        if (isAbortError(e)) throw e;
        ctx.metrics?.addToolTime(Date.now() - started);
        const failure = classifyFailure(e);
        const error = `${SOURCE_LABEL[source]}: ${providerMessage(e)}`;
        failures.push({ name, error, failure });
        emit({ type: "tool.failed", laneId: lane.id, toolId, name, label, error, failure, durationMs: Date.now() - started, retrying: false });
      }
    })));
    if (signal?.aborted) throw abortError();

    // 2. Reading. Fast lanes read the top hits deterministically; deep lanes hand the found list to a bounded agent.
    const readOne = async (s: ResearchSource, ref: ReadRef) => {
      if (reads >= lane.maxReads) throw new Error("Read cap reached for this lane; write the lane note from what you have already read.");
      reads++;
      const started = Date.now();
      emit({ type: "source.read_started", laneId: lane.id, sourceId: s.id, title: s.cite ?? s.title });
      const r = await ctx.reads.read(s.id, () => withRetry(() => deps.read(ref, { title: s.title, signal }), retry), signal);
      const text = r.text ?? "";
      const durationMs = Date.now() - started;
      if (!r.shared) ctx.metrics?.addToolTime(durationMs);
      record([{ ...s, read: true, chars: text.length, readMs: durationMs, cached: r.cached || r.shared, excerpt: text.slice(0, 600), title: s.title || r.title || s.title, url: s.url ?? r.url, cite: s.cite ?? r.cite }], false);
      const merged = found.get(s.id)!;
      emit({ type: "source.read", laneId: lane.id, sourceId: s.id, chars: text.length, cached: Boolean(r.cached || r.shared), durationMs, source: merged });
      return text;
    };

    if (lane.kind === "fast" || !deps.hasKey) {
      // Deterministic reads keep fast answers (and the no-key path) source-backed without an agent.
      const top = Array.from(found.values()).filter((s) => s.hit.readRef && s.kind !== "web").slice(0, lane.kind === "fast" ? 2 : Math.min(2, lane.maxReads));
      for (const s of top) {
        try { await readOne(s, s.hit.readRef!); } catch (e) {
          if (isAbortError(e)) throw e;
          const failure = classifyFailure(e);
          const error = `Could not read ${s.cite ?? s.title}: ${providerMessage(e)}`;
          failures.push({ name: "read_source", error, failure });
          emit({ type: "tool.failed", laneId: lane.id, toolId: nextToolId(), name: "read_source", label: `Reading ${s.cite ?? s.title}`, error, failure, durationMs: 0, retrying: false });
        }
      }
    } else {
      agentRan = true;
      const tools = buildLaneTools(lane, ctx, { found, record, readOne });
      const j = jurisdictionByKey(ctx.settings.jurisdiction);
      const matterLine = ctx.matter ? `Matter: ${ctx.matter.name} (${ctx.matter.caption ?? ctx.matter.shortName}); client ${ctx.matter.client} (${ctx.matter.clientSide}); ${ctx.matter.court ?? ""}; stage ${ctx.matter.stage ?? "n/a"}; matter id ${ctx.matter.id}.` : "No matter selected.";
      const instructions = [
        `You are the "${lane.name}" research lane for ${FIRM_NAME}: ${lane.brief}. ${todayLine()}`,
        matterLine,
        `Jurisdiction: ${j.label}.`,
        `Method: the structured search already ran (results below). Run at most two more targeted searches if the results miss the point, then READ up to ${lane.maxReads} of the most relevant sources with read_source (or fetch_url for web pages) before writing anything. ${lane.kind === "contrary" ? "Your job is adverse authority: look for decisions that reject, distinguish or limit the proposition, and for any circuit split." : lane.kind === "record" ? "Cite the record with Bates numbers or docket entry numbers; separate what the record shows from outside authority." : lane.kind === "regulatory" ? "Prefer the current CFR text and the Federal Register action that adopted it; note effective dates." : lane.kind === "secondary" ? "Prefer official agency pages, court websites, and the firm library over commentary; never rely on a snippet for a holding." : "Prefer binding authority in the selected jurisdiction; note posture and standard of review."}`,
        LEGAL_STYLE_RULES,
        "OUTPUT: a lane note in markdown. One bullet per source you READ, in the form: `- <source id> — <cite> — holding or relevance in one or two sentences, with pin cite or § when available`. Then one line `Gaps:` naming what you could not find. Do not include sources you did not read. Keep it under 250 words.",
      ].join("\n\n");
      const list = Array.from(found.values()).slice(0, 25).map((s) => `${s.id} · ${formatBluebook(s.hit)}${s.authority && s.authority !== "n/a" ? ` (${s.authority})` : ""}${s.snippet ? ` — ${s.snippet.slice(0, 200)}` : ""}`).join("\n");
      const priorNote = lane.kind === "contrary" && ctx.priors.length ? `\n\nLeading authority the controlling lane read (look for decisions that reject, distinguish or limit these):\n${ctx.priors.flatMap((p) => p.sources).filter((s) => s.read && s.kind === "caselaw").slice(0, 4).map((s) => `- ${formatBluebook(s.hit)}`).join("\n")}` : "";
      const input = `Research question: ${ctx.question}\n\nStructured results already found (${found.size}):\n${list || "(none — search first)"}${priorNote}`;
      let webSearchId: string | null = null;
      const onEvent = (e: AgentEvent) => {
        if (e.type === "tool.call") emit({ type: "tool.started", laneId: lane.id, toolId: e.id, name: e.name, label: e.label });
        if (e.type === "tool.result") {
          ctx.metrics?.addToolTime(e.durationMs);
          if (e.ok) emit({ type: "tool.completed", laneId: lane.id, toolId: e.id, name: e.name, label: e.name, durationMs: e.durationMs });
          else emit({ type: "tool.failed", laneId: lane.id, toolId: e.id, name: e.name, label: e.name, error: e.error ?? "tool failed", failure: classifyFailure(e.error), durationMs: e.durationMs, retrying: false });
        }
        if (e.type === "web_search") {
          if (e.status === "searching") { webSearchId = nextToolId(); emit({ type: "tool.started", laneId: lane.id, toolId: webSearchId, name: "web_search", label: "Searching the web" }); }
          else { emit({ type: "tool.completed", laneId: lane.id, toolId: webSearchId ?? nextToolId(), name: "web_search", label: e.query ? `Web search: ${e.query}` : "Web search complete", durationMs: 0 }); webSearchId = null; }
        }
        if (e.type === "citation" && e.citation.source === "web" && e.citation.url) {
          const hit = normalizeWebCitation({ title: e.citation.title, url: e.citation.url, snippet: e.citation.snippet }, found.size);
          record([sourceFromHit(hit, lane.id)]);
        }
      };
      const agentStarted = Date.now();
      try {
        const res = await deps.laneAgent({ instructions, input, tools, web: lane.tools.includes("web_search"), maxSteps: lane.maxSteps, signal, onEvent });
        ctx.metrics?.addModelTime(Date.now() - agentStarted, res.usage ?? null);
        note = res.text.trim();
      } catch (e) {
        ctx.metrics?.addModelTime(Date.now() - agentStarted, null);
        if (isAbortError(e)) throw e;
        if (e instanceof AIConfigError) agentRan = false;
        else {
          const failure = classifyFailure(e);
          const error = `Lane agent stopped: ${providerMessage(e)}`;
          failures.push({ name: "lane_agent", error, failure });
          emit({ type: "tool.failed", laneId: lane.id, toolId: nextToolId(), name: "lane_agent", label: `${lane.name} agent`, error, failure, durationMs: Date.now() - agentStarted, retrying: false });
        }
      }
    }

    const durationMs = Date.now() - t0;
    const error = failures.length ? failures.map((f) => f.error).join("; ") : undefined;
    const failure = failures.length ? failures[0].failure : undefined;
    emit({ type: "lane.completed", laneId: lane.id, status: "done", durationMs, sources: sources.length, read: readCount(), error, failure, note: note || undefined });
    return { laneId: lane.id, status: "done", sources, read: readCount(), note, agentRan, durationMs, error, failure, failures };
  } catch (e) {
    const durationMs = Date.now() - t0;
    const laneAborted = Boolean(signal?.aborted) || isAbortError(e);
    const runCancelled = Boolean(ctx.runSignal?.aborted);
    const status: LaneStatus = laneAborted ? (runCancelled || !ctx.timedOut?.() ? "stopped" : "timeout") : "error";
    const failure: FailureKind = status === "timeout" ? "timeout" : status === "stopped" ? "cancelled" : classifyFailure(e);
    const error = status === "timeout" ? `Lane timed out after ${Math.round(durationMs / 1000)}s; ${sources.length} source${sources.length === 1 ? "" : "s"} kept` : status === "stopped" ? undefined : providerMessage(e);
    emit({ type: "lane.completed", laneId: lane.id, status, durationMs, sources: sources.length, read: readCount(), error, failure, note: note || undefined });
    return { laneId: lane.id, status, sources, read: readCount(), note, agentRan, durationMs, error, failure, failures };
  }
}

interface LaneToolHooks {
  found: Map<string, ResearchSource>;
  record: (incoming: ResearchSource[]) => void;
  readOne: (s: ResearchSource, ref: ReadRef) => Promise<string>;
}

/** Lane-scoped tools: searches go through deps.retrieve (recorded as found sources); reads go through deps.read (recorded, cached, capped). */
export function buildLaneTools(lane: ResearchLane, ctx: LaneContext, hooks: LaneToolHooks): ToolDef<never, unknown>[] {
  const tools: ToolDef<never, unknown>[] = [];
  const compact = (s: ResearchSource) => ({ id: s.id, cite: formatBluebook(s.hit), court: s.court, date: s.date, authority: s.authority, snippet: s.snippet?.slice(0, 240), read: s.read });

  for (const name of lane.tools) {
    const source = SEARCH_TOOL_FOR[name];
    if (source) {
      tools.push(defineTool<{ query: string; limit?: number }>({
        name,
        description: SEARCH_TOOL_DESC[name],
        parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", description: "Default 8, max 12" } }, required: ["query"] },
        label: (a) => `Searching ${SOURCE_LABEL[source].toLowerCase()}: ${a.query}`,
        async execute(args) {
          const { hits, total } = await withRetry(() => ctx.deps.retrieve(source, args.query, { ...ctx.settings, limit: Math.min(args.limit ?? 8, 12) }, ctx.signal), { retries: ctx.policy.retrievalRetries, baseMs: ctx.policy.retryBaseMs, maxMs: ctx.policy.retryMaxMs, signal: ctx.signal });
          const incoming = hits.slice(0, 10).map((h) => sourceFromHit(h, lane.id));
          hooks.record(incoming);
          return { total, results: incoming.map((s) => compact(hooks.found.get(s.id) ?? s)) };
        },
      }) as ToolDef<never, unknown>);
    }
  }

  tools.push(defineTool<{ source_id: string; max_chars?: number }>({
    name: "read_source",
    description: `Read the full text of a source by its id (from search results). Required before quoting or characterizing a holding. At most ${lane.maxReads} reads in this lane.`,
    parameters: { type: "object", properties: { source_id: { type: "string" }, max_chars: { type: "integer", description: "Default 30000" } }, required: ["source_id"] },
    label: (a) => { const s = hooks.found.get(a.source_id); return `Reading ${s?.cite ?? s?.title ?? a.source_id}`; },
    async execute(args) {
      const s = hooks.found.get(args.source_id) ?? ctx.known.find((k) => k.id === args.source_id);
      if (!s) throw new Error(`Unknown source id ${args.source_id}; use an id returned by a search tool.`);
      const ref = s.hit.readRef;
      if (!ref) throw new Error("This source has no readable full text; rely on the snippet and mark characterizations [VERIFY].");
      const cached = ctx.texts.get(s.id);
      const text = cached ?? (await hooks.readOne(s, ref));
      const max = args.max_chars ?? 30_000;
      return { id: s.id, cite: formatBluebook(s.hit), url: s.url, length: text.length, text: text.length > max ? text.slice(0, max) + "\n…[truncated]" : text };
    },
  }) as ToolDef<never, unknown>);

  if (lane.tools.includes("fetch_url")) {
    tools.push(defineTool<{ url: string; max_chars?: number }>({
      name: "fetch_url",
      description: "Read a public web page (agency site, court site, statute page) by URL. Counts toward the lane's read cap.",
      parameters: { type: "object", properties: { url: { type: "string" }, max_chars: { type: "integer" } }, required: ["url"] },
      label: (a) => `Reading ${safeHost(a.url)}`,
      async execute(args) {
        if (!/^https?:\/\//i.test(args.url)) throw new Error("Only http(s) URLs are supported");
        const hit: SearchHit = normalizeWebCitation({ title: args.url, url: args.url }, hooks.found.size);
        const existing = hooks.found.get(sourceKey(hit));
        const s = existing ?? sourceFromHit(hit, lane.id);
        if (!existing) hooks.record([s]);
        const text = ctx.texts.get(s.id) ?? (await hooks.readOne(s, { kind: "url", url: args.url }));
        const max = args.max_chars ?? 30_000;
        return { id: s.id, url: args.url, length: text.length, text: text.length > max ? text.slice(0, max) + "\n…[truncated]" : text };
      },
    }) as ToolDef<never, unknown>);
  }

  if (lane.tools.includes("get_matter_context")) tools.push(matterContextTool as unknown as ToolDef<never, unknown>);

  if (lane.tools.includes("verify_citations")) {
    tools.push(defineTool<{ text: string }>({
      name: "verify_citations",
      description: "Check whether case citations in a passage resolve to real reported decisions (CourtListener). Use before relying on a citation you did not read.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      label: () => "Verifying citations",
      async execute(args) {
        try { return { resolved: await ctx.deps.verifyCitationsRemote(args.text, ctx.signal) }; } catch (e) { return { error: providerMessage(e), resolved: [] }; }
      },
    }) as ToolDef<never, unknown>);
  }

  return tools;
}

function safeHost(url: string) { try { return new URL(url).host; } catch { return "page"; } }
