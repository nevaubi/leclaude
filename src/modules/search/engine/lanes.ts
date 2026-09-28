import "server-only";
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { AgentEvent } from "@/lib/ai/agent";
import { AIConfigError } from "@/lib/ai/config";
import { classifyFailure, isAbortError, type FailureKind } from "@/lib/ai/events";
import { isLegalFetchHost } from "@/lib/ai/toolkit/legal";
import { matterContextTool } from "@/lib/ai/toolkit/internal";
import type { Matter } from "@/lib/types/domain";
import { LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import { buildCitation, type CitationFields } from "../bluebook";
import { firmLabel } from "../firm";
import { jurisdictionByKey } from "../jurisdictions";
import { formatBluebook, normalizeWebCitation } from "../normalize";
import { providerMessage } from "../service";
import { SOURCE_LABEL, type ReadRef, type SearchHit, type SearchSettings, type SearchSource } from "../types";
import { compareAuthorities } from "./authorities";
import type { ReadRegistry } from "./cache";
import type { EngineDeps, ResearchPlan } from "./deps";
import { focusTerms, splitParagraphs } from "./paragraphs";
import { priorQueries } from "./planner";
import { laneInstructions } from "./prompts";
import { abortError, settleWithin, withRetry, type LaneBoard, type MetricsRecorder, type RunPolicy } from "./runtime";
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
  /** Results of the lanes this lane hard-depends on (`dependsOn`). */
  priors: LaneResult[];
  /** Soft-dependency board: lanes publish their first-wave sources here; `after` lanes wait on it (bounded). */
  board?: LaneBoard<ResearchSource[]>;
  /** The fast-model plan, resolving while the first retrieval wave runs (null when unavailable). */
  plan?: Promise<ResearchPlan | null>;
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
  search_case_law: "Search U.S. court opinions (CourtListener). Boolean operators, quoted phrases and proximity are supported; results respect the run's court and date filters. Returns source ids usable with read_source and get_opinion.",
  search_dockets: "Search federal dockets (PACER/RECAP): parties, nature of suit, judge, filing dates.",
  search_cfr: "Search the Code of Federal Regulations (eCFR).",
  search_federal_register: "Search Federal Register rules, proposed rules and notices.",
  search_statutes: "Search the U.S. Code and public laws (GovInfo).",
  search_library: "Search the firm's knowledge library: memos, briefs, clause bank, templates.",
  search_ediscovery: "Search this matter's document collection and deposition transcripts (Bates-numbered).",
};

/** Deterministic snippet triage for reading without an agent: binding first, then term overlap, then provider rank. */
export function rankForReading(sources: ResearchSource[], terms: string[]): ResearchSource[] {
  const lower = terms.map((t) => t.toLowerCase());
  const score = (s: ResearchSource) => {
    const hay = `${s.title} ${s.snippet ?? ""}`.toLowerCase();
    const overlap = lower.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0);
    return (s.authority === "binding" ? 3 : s.authority === "persuasive" ? 1 : 0) + overlap;
  };
  return sources.map((s, i) => ({ s, i, v: score(s) })).sort((a, b) => b.v - a.v || a.i - b.i).map((x) => x.s);
}

/** Run one lane: deterministic provider retrieval (parallel, retried on transient failures), a second targeted wave, then reading. */
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
  const ran = new Set<string>();

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

  /** One retrieval wave: every (provider × query) pair in parallel. */
  const retrieveWave = (queries: string[]) => Promise.all(lane.sources.filter((s) => s !== "web").flatMap((source) => queries.filter((q) => !ran.has(`${source}\u0000${q}`)).map(async (q) => {
    ran.add(`${source}\u0000${q}`);
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

  emit({ type: "lane.started", laneId: lane.id, round: lane.round, queuedMs: slot.queuedMs ?? 0 });
  let afterSources: ResearchSource[] = [];
  try {
    // 1. First wave across the lane's providers (parallel); every hit becomes a "found" source.
    //    Hard dependencies (dependsOn) already settled, so their queries join the first wave.
    await retrieveWave(Array.from(new Set([...lane.queries, ...priorQueries(lane, ctx.priors)])).slice(0, 4));
    if (signal?.aborted) throw abortError();
    ctx.board?.publish(lane.id, sources);

    // 2. Second, targeted wave: queries built from soft dependencies' first-wave results and from the fast-model plan.
    //    Both are awaited with a bound so a slow plan or dependency never stalls the lane.
    const [depResults, plan] = await Promise.all([
      Promise.all((lane.after ?? []).map((id) => ctx.board ? ctx.board.wait(id, policy.softDepWaitMs, signal) : Promise.resolve(undefined))),
      lane.kind === "fast" ? Promise.resolve(undefined) : settleWithin(ctx.plan, policy.planWaitMs, signal),
    ]);
    if (signal?.aborted) throw abortError();
    afterSources = depResults.flatMap((r) => r ?? []);
    const extra = [
      ...priorQueries(lane, afterSources.length ? [{ sources: afterSources }] : []),
      ...((plan?.queries?.[lane.kind] ?? []).filter((q) => !lane.queries.includes(q))),
    ].slice(0, 3);
    if (extra.length) {
      await retrieveWave(extra);
      if (signal?.aborted) throw abortError();
      ctx.board?.publish(lane.id, sources);
    }

    // 3. Reading. Fast lanes (and the no-key path) read the best hits deterministically and in parallel;
    //    deep lanes hand the found list to a bounded fast-model agent.
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
      const terms = focusTerms([ctx.question, ...lane.queries]);
      const top = rankForReading(Array.from(found.values()).filter((s) => s.hit.readRef && s.kind !== "web"), terms).slice(0, lane.kind === "fast" ? 2 : Math.min(2, lane.maxReads));
      await Promise.all(top.map(async (s) => {
        try { await readOne(s, s.hit.readRef!); } catch (e) {
          if (isAbortError(e)) throw e;
          const failure = classifyFailure(e);
          const error = `Could not read ${s.cite ?? s.title}: ${providerMessage(e)}`;
          failures.push({ name: "read_source", error, failure });
          emit({ type: "tool.failed", laneId: lane.id, toolId: nextToolId(), name: "read_source", label: `Reading ${s.cite ?? s.title}`, error, failure, durationMs: 0, retrying: false });
        }
      }));
    } else {
      agentRan = true;
      const tools = buildLaneTools(lane, ctx, { found, record, readOne });
      const j = jurisdictionByKey(ctx.settings.jurisdiction);
      const matterLine = ctx.matter ? `Matter: ${ctx.matter.name} (${ctx.matter.caption ?? ctx.matter.shortName}); client ${ctx.matter.client} (${ctx.matter.clientSide}); ${ctx.matter.court ?? ""}; stage ${ctx.matter.stage ?? "n/a"}; matter id ${ctx.matter.id}.` : "No matter selected.";
      // Byte-stable per lane kind (cacheable prefix); everything volatile is in the user turn below.
      const instructions = laneInstructions(lane.kind, lane.name, lane.brief, firmLabel(), lane.maxReads, LEGAL_STYLE_RULES);
      const list = Array.from(found.values()).slice(0, 25).map((s) => `${s.id} · ${formatBluebook(s.hit)}${s.authority && s.authority !== "n/a" ? ` (${s.authority})` : ""}${s.snippet ? ` — ${s.snippet.slice(0, 200)}` : ""}`).join("\n");
      const leading = [...ctx.priors.flatMap((p) => p.sources), ...afterSources].filter((s) => s.kind === "caselaw" && s.title.includes(" v. ")).sort((a, b) => Number(b.read) - Number(a.read) || Number(b.authority === "binding") - Number(a.authority === "binding"));
      const priorNote = lane.kind === "contrary" && leading.length ? `\n\nLeading authority the controlling lane found (look for decisions that reject, distinguish or limit these):\n${Array.from(new Map(leading.map((s) => [s.id, s])).values()).slice(0, 4).map((s) => `- ${s.id} · ${formatBluebook(s.hit)}`).join("\n")}` : "";
      const input = `${todayLine()}\n${matterLine}\nJurisdiction: ${j.label}.\n\nStructured results already found (${found.size}):\n${list || "(none — search first)"}${priorNote}\n\nResearch question: ${ctx.question}`;
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

    ctx.board?.publish(lane.id, sources);
    const durationMs = Date.now() - t0;
    const error = failures.length ? failures.map((f) => f.error).join("; ") : undefined;
    const failure = failures.length ? failures[0].failure : undefined;
    emit({ type: "lane.completed", laneId: lane.id, status: "done", durationMs, sources: sources.length, read: readCount(), error, failure, note: note || undefined });
    return { laneId: lane.id, status: "done", sources, read: readCount(), note, agentRan, durationMs, error, failure, failures };
  } catch (e) {
    ctx.board?.publish(lane.id, sources);
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

type AnyTool = ToolDef<never, unknown>;

/**
 * Lane-scoped tools (constitution §52): narrow, typed, bounded. Searches go through deps.retrieve (recorded as found
 * sources); reads go through deps.read (recorded, cached, capped) so "read" always means the text reached this run.
 * Tool definitions are byte-stable per lane kind so providers can cache them.
 */
export function buildLaneTools(lane: ResearchLane, ctx: LaneContext, hooks: LaneToolHooks): AnyTool[] {
  const tools: AnyTool[] = [];
  const has = (name: string) => lane.tools.includes(name);
  const compact = (s: ResearchSource) => ({ id: s.id, cite: formatBluebook(s.hit), court: s.court, date: s.date, authority: s.authority, snippet: s.snippet?.slice(0, 240), read: s.read });
  const retryOpts = { retries: ctx.policy.retrievalRetries, baseMs: ctx.policy.retryBaseMs, maxMs: ctx.policy.retryMaxMs, signal: ctx.signal };
  const lookup = (id: string) => hooks.found.get(id) ?? ctx.known.find((k) => k.id === id);
  const textFor = async (s: ResearchSource): Promise<string> => {
    const ref = s.hit.readRef;
    if (!ref) throw new Error("This source has no readable full text; rely on the snippet and mark characterizations [VERIFY].");
    return ctx.texts.get(s.id) ?? (await hooks.readOne(s, ref));
  };

  for (const name of lane.tools) {
    const source = SEARCH_TOOL_FOR[name];
    if (!source) continue;
    tools.push(defineTool<{ query: string; limit?: number }>({
      name,
      description: SEARCH_TOOL_DESC[name],
      parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", description: "Default 8, max 12" } }, required: ["query"] },
      examples: [{ query: name === "search_case_law" ? "\"government contractor defense\" AND \"reasonably precise\"" : "PFOA maximum contaminant level", limit: 8 }],
      timeoutMs: 30_000,
      label: (a) => `Searching ${SOURCE_LABEL[source].toLowerCase()}: ${a.query}`,
      async execute(args) {
        const { hits, total } = await withRetry(() => ctx.deps.retrieve(source, args.query, { ...ctx.settings, limit: Math.min(args.limit ?? 8, 12) }, ctx.signal), retryOpts);
        const incoming = hits.slice(0, 10).map((h) => sourceFromHit(h, lane.id));
        hooks.record(incoming);
        return { total, results: incoming.map((s) => compact(hooks.found.get(s.id) ?? s)) };
      },
    }) as AnyTool);
  }

  tools.push(defineTool<{ source_id: string; max_chars?: number }>({
    name: "read_source",
    description: `Read the full text of a source by its id (from search results). Required before quoting or characterizing a holding. At most ${lane.maxReads} reads in this lane.`,
    parameters: { type: "object", properties: { source_id: { type: "string" }, max_chars: { type: "integer", description: "Default 30000" } }, required: ["source_id"] },
    examples: [{ source_id: "caselaw:112120" }],
    timeoutMs: 45_000,
    maxResultChars: 32_000,
    label: (a) => { const s = hooks.found.get(a.source_id); return `Reading ${s?.cite ?? s?.title ?? a.source_id}`; },
    async execute(args) {
      const s = lookup(args.source_id);
      if (!s) throw new Error(`Unknown source id ${args.source_id}; use an id returned by a search tool.`);
      const text = await textFor(s);
      const max = args.max_chars ?? 30_000;
      return { id: s.id, cite: formatBluebook(s.hit), url: s.url, length: text.length, text: text.length > max ? text.slice(0, max) + "\n…[truncated]" : text };
    },
  }) as AnyTool);

  if (has("get_opinion")) {
    tools.push(defineTool<{ source_id: string; start_paragraph?: number; count?: number }>({
      name: "get_opinion",
      description: "Read a source (usually an opinion) in numbered paragraph windows: ¶1, ¶2 … — the same numbering pinpoint cites [n ¶k] use and the reader shows. Counts toward the lane's read cap on first use.",
      parameters: { type: "object", properties: { source_id: { type: "string" }, start_paragraph: { type: "integer", description: "1-based, default 1" }, count: { type: "integer", description: "Default 40, max 100" } }, required: ["source_id"] },
      examples: [{ source_id: "caselaw:112120", start_paragraph: 1, count: 40 }],
      timeoutMs: 45_000,
      maxResultChars: 36_000,
      label: (a) => { const s = hooks.found.get(a.source_id); return `Reading ${s?.cite ?? s?.title ?? a.source_id}${a.start_paragraph ? ` from ¶${a.start_paragraph}` : ""}`; },
      async execute(args) {
        const s = lookup(args.source_id);
        if (!s) throw new Error(`Unknown source id ${args.source_id}; use an id returned by a search tool.`);
        const paras = splitParagraphs(await textFor(s));
        const start = Math.max(1, Math.floor(args.start_paragraph ?? 1));
        const n = Math.min(Math.max(1, Math.floor(args.count ?? 40)), 100);
        return { id: s.id, cite: formatBluebook(s.hit), total_paragraphs: paras.length, paragraphs: paras.slice(start - 1, start - 1 + n).map((text, i) => ({ n: start + i, text: text.length > 3000 ? text.slice(0, 3000) + " …" : text })), next_start: start - 1 + n < paras.length ? start + n : null };
      },
    }) as AnyTool);
  }

  if (has("find_citing_opinions") && ctx.deps.citing) {
    const citing = ctx.deps.citing.bind(ctx.deps);
    tools.push(defineTool<{ source_id: string }>({
      name: "find_citing_opinions",
      description: "For a case among the sources, find citing opinions and whether any use negative-treatment language (overruled, abrogated, declined to follow…). Returns a treatment signal to REVIEW; it is not a citator and never establishes good law.",
      parameters: { type: "object", properties: { source_id: { type: "string" } }, required: ["source_id"] },
      examples: [{ source_id: "caselaw:112120" }],
      timeoutMs: 20_000,
      label: (a) => { const s = hooks.found.get(a.source_id); return `Checking citing opinions for ${s?.cite ?? s?.title ?? a.source_id}`; },
      async execute(args) {
        const s = lookup(args.source_id);
        const opinionId = s?.hit.readRef?.kind === "opinion" ? s.hit.readRef.id : s?.hit.opinionId;
        if (!s || s.kind !== "caselaw" || opinionId == null) throw new Error("find_citing_opinions needs a case-law source id with a CourtListener opinion.");
        const treatment = await citing({ opinionId, signal: ctx.signal });
        hooks.record([{ ...s, laneIds: [lane.id], treatment }]);
        return { id: s.id, cite: formatBluebook(s.hit), ...treatment };
      },
    }) as AnyTool);
  }

  if (has("resolve_citation") && ctx.deps.resolveCitation) {
    const resolve = ctx.deps.resolveCitation.bind(ctx.deps);
    tools.push(defineTool<{ citation: string }>({
      name: "resolve_citation",
      description: "Resolve one reporter citation (e.g. '487 U.S. 500') to a reported decision. Returns resolved, ambiguous (several candidates, none chosen) or unresolved. Never substitute a similar case for an unresolved citation.",
      parameters: { type: "object", properties: { citation: { type: "string" } }, required: ["citation"] },
      examples: [{ citation: "487 U.S. 500" }],
      timeoutMs: 20_000,
      label: (a) => `Resolving ${a.citation}`,
      async execute(args) { return resolve(args.citation, ctx.signal); },
    }) as AnyTool);
  }

  if (has("build_citation")) {
    tools.push(defineTool<{ fields: CitationFields }>({
      name: "build_citation",
      description: "Format a Bluebook citation deterministically from structured fields (case, statute, regulation, federal_register, docket). Missing required fields are returned as errors; nothing is invented.",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            description: "type plus the fields for that type: case {caseName, volume, reporter, page, pinpoint?, court (id or abbreviation), year | date, docketNumber?, wl?}; statute {title, sections[], year?, code?}; regulation {title, sections[], year}; federal_register {volume, page, pinpoint?, date, name?}; docket {caseName, docketNumber, court, filed?, ecf?}",
            properties: { type: { type: "string", enum: ["case", "statute", "regulation", "federal_register", "docket"] } },
            required: ["type"],
            additionalProperties: true,
          },
        },
        required: ["fields"],
      },
      strict: false,
      examples: [{ fields: { type: "case", caseName: "Boyle v. United Technologies Corp.", volume: 487, reporter: "U.S.", page: 500, pinpoint: "512", year: 1988 } }, { fields: { type: "regulation", title: 40, sections: ["141.61"], year: 2024 } }],
      timeoutMs: 2_000,
      label: () => "Formatting a citation",
      execute(args) { return buildCitation(args.fields); },
    }) as AnyTool);
  }

  if (has("compare_authorities")) {
    tools.push(defineTool<{ source_ids: string[] }>({
      name: "compare_authorities",
      description: "Side-by-side table of sources already found: citation, court, year, binding/persuasive, read state, treatment signal and holding sentences with ¶ pinpoints (only for sources read in full). Use it to reconcile authorities before writing the lane note.",
      parameters: { type: "object", properties: { source_ids: { type: "array", items: { type: "string" }, description: "Up to 8 source ids" } }, required: ["source_ids"] },
      examples: [{ source_ids: ["caselaw:112120", "caselaw:4381234"] }],
      timeoutMs: 5_000,
      label: (a) => `Comparing ${a.source_ids.length} authorities`,
      execute(args) {
        const list = args.source_ids.slice(0, 8).map(lookup).filter((s): s is ResearchSource => Boolean(s));
        return { rows: compareAuthorities(list, (s) => ctx.texts.get(s.id)), unknown: args.source_ids.filter((id) => !lookup(id)) };
      },
    }) as AnyTool);
  }

  // Matter record tools exist only when a matter is selected (never widened to all matters).
  if (ctx.matter && has("search_matter_documents")) {
    const matterId = ctx.matter.id;
    tools.push(defineTool<{ query: string; limit?: number }>({
      name: "search_matter_documents",
      description: "Search the selected matter's documents and deposition transcripts (Bates-numbered). Limited to this matter.",
      parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", description: "Default 8, max 12" } }, required: ["query"] },
      examples: [{ query: "90-day rat study hepatic effects", limit: 8 }],
      timeoutMs: 30_000,
      label: (a) => `Searching matter documents: ${a.query}`,
      async execute(args) {
        const { hits, total } = await withRetry(() => ctx.deps.retrieve("ediscovery", args.query, { ...ctx.settings, matterId, limit: Math.min(args.limit ?? 8, 12) }, ctx.signal), retryOpts);
        const incoming = hits.slice(0, 10).map((h) => sourceFromHit(h, lane.id));
        hooks.record(incoming);
        return { total, results: incoming.map((s) => compact(hooks.found.get(s.id) ?? s)) };
      },
    }) as AnyTool);
    tools.push(defineTool<{ source_id: string; max_chars?: number }>({
      name: "read_matter_document",
      description: "Read a matter document found by search_matter_documents (selected matter only).",
      parameters: { type: "object", properties: { source_id: { type: "string" }, max_chars: { type: "integer", description: "Default 20000" } }, required: ["source_id"] },
      examples: [{ source_id: "ediscovery:MFC-000123" }],
      timeoutMs: 30_000,
      maxResultChars: 24_000,
      label: (a) => `Reading ${hooks.found.get(a.source_id)?.cite ?? a.source_id}`,
      async execute(args) {
        const s = hooks.found.get(args.source_id);
        if (!s || s.scope !== "record") throw new Error("read_matter_document reads only matter documents found in this lane.");
        const text = await textFor(s);
        const max = args.max_chars ?? 20_000;
        return { id: s.id, bates: s.cite, text: text.length > max ? text.slice(0, max) + "\n…[truncated]" : text };
      },
    }) as AnyTool);
  }

  if (has("fetch_url")) {
    const openWeb = ctx.settings.sources.includes("web");
    tools.push(defineTool<{ url: string; max_chars?: number }>({
      name: "fetch_url",
      description: openWeb ? "Read a public web page (agency site, court site, statute page) by URL. Counts toward the lane's read cap." : "Read an official legal web page by URL (courts, eCFR, Federal Register, GovInfo, Congress, Cornell LII, federal and state agencies). Other hosts are refused unless web sources are in scope. Counts toward the lane's read cap.",
      parameters: { type: "object", properties: { url: { type: "string" }, max_chars: { type: "integer" } }, required: ["url"] },
      examples: [{ url: "https://www.ecfr.gov/current/title-40/section-141.61" }],
      timeoutMs: 30_000,
      maxResultChars: 32_000,
      label: (a) => `Reading ${safeHost(a.url)}`,
      async execute(args) {
        if (!/^https?:\/\//i.test(args.url)) throw new Error("Only http(s) URLs are supported");
        if (!openWeb && !isLegalFetchHost(args.url)) throw new Error(`${safeHost(args.url)} is not an allowlisted legal source; add Web to the sources to read the open web.`);
        const hit: SearchHit = normalizeWebCitation({ title: args.url, url: args.url }, hooks.found.size);
        const existing = hooks.found.get(sourceKey(hit));
        const s = existing ?? sourceFromHit(hit, lane.id);
        if (!existing) hooks.record([s]);
        const text = ctx.texts.get(s.id) ?? (await hooks.readOne(s, { kind: "url", url: args.url }));
        const max = args.max_chars ?? 30_000;
        return { id: s.id, url: args.url, length: text.length, text: text.length > max ? text.slice(0, max) + "\n…[truncated]" : text };
      },
    }) as AnyTool);
  }

  if (has("get_matter_context")) tools.push(matterContextTool as unknown as AnyTool);

  if (has("verify_citations")) {
    tools.push(defineTool<{ text: string }>({
      name: "verify_citations",
      description: "Check whether case citations in a passage resolve to real reported decisions (CourtListener). Use before relying on a citation you did not read.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      examples: [{ text: "Boyle v. United Techs. Corp., 487 U.S. 500 (1988)" }],
      timeoutMs: 20_000,
      label: () => "Verifying citations",
      async execute(args) {
        try { return { resolved: await ctx.deps.verifyCitationsRemote(args.text, ctx.signal) }; } catch (e) { return { error: providerMessage(e), resolved: [] }; }
      },
    }) as AnyTool);
  }

  return tools;
}

function safeHost(url: string) { try { return new URL(url).host; } catch { return "page"; } }
