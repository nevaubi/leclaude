import "server-only";
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { AgentEvent } from "@/lib/ai/agent";
import { AIConfigError } from "@/lib/ai/config";
import { matterContextTool } from "@/lib/ai/toolkit/internal";
import type { Matter } from "@/lib/types/domain";
import { FIRM_NAME, LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import { jurisdictionByKey } from "../jurisdictions";
import { formatBluebook, normalizeWebCitation } from "../normalize";
import { providerMessage } from "../service";
import { SOURCE_LABEL, type ReadRef, type SearchHit, type SearchSettings, type SearchSource } from "../types";
import type { EngineDeps } from "./deps";
import { mergeSources, sourceFromHit, sourceKey } from "./sources";
import type { LaneStatus, ResearchLane, ResearchSource, ResearchStreamEvent } from "./types";

export interface LaneContext {
  question: string;
  settings: SearchSettings;
  matter: Matter | null;
  deps: EngineDeps;
  send: (e: ResearchStreamEvent | AgentEvent) => void;
  signal?: AbortSignal;
  /** Shared full-text store (source id → text) for the run. */
  texts: Map<string, string>;
  /** Sources already known to the run/thread (for dedupe awareness). */
  known: ResearchSource[];
}

export interface LaneResult {
  laneId: string;
  status: LaneStatus;
  sources: ResearchSource[];
  note: string;
  agentRan: boolean;
  durationMs: number;
  error?: string;
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

/** Run one lane: deterministic provider retrieval, then (with a key) a bounded fast-model agent that reads the best sources. */
export async function runLane(lane: ResearchLane, ctx: LaneContext): Promise<LaneResult> {
  const t0 = Date.now();
  const { deps, send, signal } = ctx;
  let sources: ResearchSource[] = [];
  const found = new Map<string, ResearchSource>();
  let reads = 0;
  let agentRan = false;
  let step = 0;
  let note = "";

  const record = (incoming: ResearchSource[], emit = true) => {
    for (const s of incoming) {
      const prev = found.get(s.id);
      const merged = prev ? mergeSources([prev], [s])[0] : s;
      found.set(s.id, merged);
      if (emit) send({ type: "lane.source", laneId: lane.id, source: merged });
    }
    sources = Array.from(found.values());
  };
  const stepEvent = (label: string, status: LaneStatus) => send({ type: "lane.step", laneId: lane.id, step: ++step, label, status });

  send({ type: "lane.start", laneId: lane.id, round: lane.round });
  try {
    // 1. Structured retrieval across the lane's providers (parallel), every hit becomes a "found" source.
    stepEvent(`Searching ${lane.sources.map((s) => SOURCE_LABEL[s]).join(", ")}`, "retrieving");
    await Promise.all(lane.sources.filter((s) => s !== "web").flatMap((source) => lane.queries.map(async (q) => {
      try {
        const { hits } = await deps.retrieve(source, q, ctx.settings, signal);
        record(hits.slice(0, 10).map((h) => sourceFromHit(h, lane.id)));
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        stepEvent(`${SOURCE_LABEL[source]}: ${providerMessage(e)}`, "error");
      }
    })));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // 2. Reading. Fast lanes read the top hits deterministically; deep lanes hand the found list to a bounded agent.
    const readOne = async (s: ResearchSource, ref: ReadRef) => {
      if (reads >= lane.maxReads) throw new Error("Read cap reached for this lane; write the lane note from what you have already read.");
      reads++;
      const started = Date.now();
      stepEvent(`Reading ${s.cite ?? s.title}`, "reading");
      const r = await deps.read(ref, { title: s.title, signal });
      const text = r.text ?? "";
      ctx.texts.set(s.id, text);
      record([{ ...s, read: true, chars: text.length, readMs: Date.now() - started, cached: r.cached, excerpt: text.slice(0, 600), title: s.title || r.title || s.title, url: s.url ?? r.url, cite: s.cite ?? r.cite }]);
      return text;
    };

    if (lane.kind === "fast" || !deps.hasKey) {
      // Deterministic reads keep fast answers (and the no-key path) source-backed without an agent.
      const top = Array.from(found.values()).filter((s) => s.hit.readRef && s.kind !== "web").slice(0, lane.kind === "fast" ? 2 : Math.min(2, lane.maxReads));
      for (const s of top) { try { await readOne(s, s.hit.readRef!); } catch (e) { if ((e as Error).name === "AbortError") throw e; stepEvent(`Could not read ${s.cite ?? s.title}: ${providerMessage(e)}`, "error"); } }
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
      const input = `Research question: ${ctx.question}\n\nStructured results already found (${found.size}):\n${list || "(none — search first)"}`;
      const onEvent = (e: AgentEvent) => {
        if (e.type === "tool.call") stepEvent(e.label, "reading");
        if (e.type === "web_search") stepEvent(e.status === "searching" ? "Searching the web" : e.query ? `Web search: ${e.query}` : "Web search complete", "retrieving");
        if (e.type === "citation" && e.citation.source === "web" && e.citation.url) {
          const hit = normalizeWebCitation({ title: e.citation.title, url: e.citation.url, snippet: e.citation.snippet }, found.size);
          record([sourceFromHit(hit, lane.id)]);
        }
      };
      try {
        const res = await deps.laneAgent({ instructions, input, tools, web: lane.tools.includes("web_search"), maxSteps: lane.maxSteps, signal, onEvent });
        note = res.text.trim();
        if (note) send({ type: "lane.note", laneId: lane.id, note });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        if (e instanceof AIConfigError) agentRan = false;
        else stepEvent(`Agent stopped: ${providerMessage(e)}`, "error");
      }
    }

    const durationMs = Date.now() - t0;
    send({ type: "lane.done", laneId: lane.id, status: "done", durationMs, sources: sources.length });
    return { laneId: lane.id, status: "done", sources, note, agentRan, durationMs };
  } catch (e) {
    const durationMs = Date.now() - t0;
    const aborted = (e as Error).name === "AbortError";
    const status: LaneStatus = aborted ? "stopped" : "error";
    const error = aborted ? undefined : providerMessage(e);
    send({ type: "lane.done", laneId: lane.id, status, durationMs, sources: sources.length, error });
    return { laneId: lane.id, status, sources, note, agentRan, durationMs, error };
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
          const { hits, total } = await ctx.deps.retrieve(source, args.query, { ...ctx.settings, limit: Math.min(args.limit ?? 8, 12) }, ctx.signal);
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
