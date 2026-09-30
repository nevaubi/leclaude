import "server-only";
import type { ResponseInput } from "openai/resources/responses/responses";
import { generateJSON, generateText, runAgent, type AgentEvent } from "@/lib/ai/agent";
import { aiConfig } from "@/lib/ai/config";
import type { TokenUsage } from "@/lib/ai/events";
import type { ToolContext, ToolDef } from "@/lib/ai/tools";
import { webSearchTool } from "@/lib/ai/toolkit/web";
import { findCitingOpinions, resolveCitationTool, searchCaseLawTool, searchDocketsTool, searchRegulationsTool, searchFederalRegisterTool, searchStatutesTool, verifyCitationsTool, type CitationResolution } from "@/lib/ai/toolkit/legal";
import type { SearchResultBlock } from "@/lib/ai/providers/types";
import { searchLibraryTool, searchEdiscoveryTool } from "@/lib/ai/toolkit/internal";
import { verifyClaims, type VerificationResult } from "@/lib/ai/verify";
import { getDocumentText, intelDocuments, primaryDate, searchIntel } from "@/modules/intel/store";
import type { IntelDocumentKind, IntelSearchHit } from "@/modules/intel/types";
import { classifyAuthority, resolveCourts } from "../jurisdictions";
import { normalizeToolResult } from "../normalize";
import { datePresetRange, toCourtListenerSyntax } from "../query-builder";
import { readSource } from "../service";
import type { ReadRef, SearchHit, SearchSettings, SearchSource } from "../types";
import { RESEARCH_MODEL_POLICY as POLICY } from "./model-policy";
import { PLAN_INSTRUCTIONS } from "./prompts";
import { classifyTreatment } from "./treatment";
import type { AuthorityTreatment, LaneKind } from "./types";

/** Model-derived plan: jurisdiction-aware sub-questions and extra retrieval queries per lane kind. */
export interface ResearchPlan {
  subQuestions: string[];
  queries: Partial<Record<LaneKind, string[]>>;
}

/**
 * Everything the research engine needs from the outside world, so the
 * orchestrator can be exercised end to end with fakes (no network, no key).
 */
export interface EngineDeps {
  hasKey: boolean;
  model: string;
  fastModel: string;
  /** Structured provider search for one source kind. Never throws for "no results"; throws for provider failures. */
  retrieve(source: SearchSource, query: string, settings: SearchSettings, signal?: AbortSignal): Promise<{ hits: SearchHit[]; total: number }>;
  /** Full text for a read reference (cached 24h by the service). */
  read(ref: ReadRef, opts: { title?: string; signal?: AbortSignal }): Promise<{ text: string; title?: string; cite?: string; url?: string; cached: boolean }>;
  /** A bounded lane agent run. Returns the lane note (and token usage when the runtime reports it). */
  laneAgent(input: { instructions: string; input: string; tools: ToolDef<never, unknown>[]; web: boolean; maxSteps: number; signal?: AbortSignal; onEvent: (e: AgentEvent) => void }): Promise<{ text: string; steps: number; usage?: TokenUsage }>;
  /**
   * Synthesis with streaming deltas (primary model, no tools). `instructions` are byte-stable per mode (cacheable prefix);
   * `evidence` carries the numbered sources as citation-native search_result blocks. A plain string is accepted; an object
   * may carry token usage.
   */
  synthesize(input: { instructions: string; input: string | ResponseInput; evidence?: SearchResultBlock[]; signal?: AbortSignal; onDelta: (d: string) => void }): Promise<string | { text: string; usage?: TokenUsage }>;
  verify(input: { answer: string; sources: { title?: string; cite?: string; url?: string; text: string }[]; signal?: AbortSignal }): Promise<VerificationResult>;
  correct(input: { instructions: string; input: string; signal?: AbortSignal }): Promise<string>;
  refine(input: { question: string; gaps: string[]; laneKinds: LaneKind[]; signal?: AbortSignal }): Promise<Partial<Record<LaneKind, string[]>>>;
  followUps(input: { question: string; answer: string; matterLine: string; signal?: AbortSignal }): Promise<string[]>;
  /** Resolve case citations on CourtListener; returns the normalised citations that resolved. */
  verifyCitationsRemote(text: string, signal?: AbortSignal): Promise<string[]>;
  // ---- optional capabilities (absent in minimal fakes; the run degrades to the deterministic path) ----
  /** Fast-model planning: sub-questions and per-lane queries. Runs concurrently with the first retrieval wave. */
  planQueries?(input: { question: string; context: string; laneKinds: LaneKind[]; signal?: AbortSignal }): Promise<ResearchPlan>;
  /** Citing-reference treatment signal for a case (never an assertion of good law). */
  citing?(input: { opinionId: number; signal?: AbortSignal }): Promise<AuthorityTreatment>;
  /** Overrides the run wall (researchWallMs); stage budgets scale with it. Tests only. */
  wallMs?: number;
  /** Resolve one reporter citation without substitution. */
  resolveCitation?(citation: string, signal?: AbortSignal): Promise<CitationResolution>;
}

function toolCtx(signal?: AbortSignal): ToolContext {
  return { emit: () => {}, signal, state: {} };
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then((v) => { clearTimeout(t); signal?.removeEventListener("abort", onAbort); resolve(v); }, (e) => { clearTimeout(t); signal?.removeEventListener("abort", onAbort); reject(e); });
  });
}

/** Intelligence record kinds that feed each provider source. */
export const INTEL_KINDS_FOR_SOURCE: Partial<Record<SearchSource, IntelDocumentKind[]>> = {
  caselaw: ["opinion"],
  statutes: ["statute"],
  regulations: ["regulation", "court_rule"],
  federal_register: ["register_notice", "recall", "adverse_event"],
  dockets: ["docket", "docket_entry", "mdl"],
  library: ["local_file", "news", "web_page", "judge", "attorney", "firm", "expert"],
};

const INTEL_KIND_LABEL: Partial<Record<IntelDocumentKind, string>> = { opinion: "Opinion", statute: "Statute", regulation: "CFR", court_rule: "Court rule", register_notice: "Federal Register", recall: "FDA recall", adverse_event: "FDA adverse event", docket: "Docket", docket_entry: "Docket entry", mdl: "MDL", local_file: "Local file", news: "News", web_page: "Web page", judge: "Judge", attorney: "Attorney", firm: "Firm", expert: "Expert" };

/** Read reference scheme for intelligence records (`deps.read` resolves it from the store, no network). */
export const INTEL_READ_PREFIX = "intel://";

/** Normalize an intelligence hit onto a provider source kind so lanes, citations and reading treat it like any other authority. */
export function intelHitToSearchHit(h: IntelSearchHit, source: SearchSource, settings: Pick<SearchSettings, "jurisdiction" | "courts">): SearchHit {
  const d = h.doc;
  const courtId = intelDocuments().get(d.id)?.courtId;
  const kind = INTEL_KIND_LABEL[d.kind] ?? d.kind;
  const flagged = d.flags.filter((f) => f.kind !== "stale").map((f) => f.kind.replace(/_/g, " "));
  return {
    id: `intel:${d.id}`,
    source,
    title: d.caseName && d.kind !== "docket_entry" ? d.caseName : d.title,
    subtitle: [d.court, d.docketNumber ? `No. ${d.docketNumber}` : "", `${kind} · intelligence corpus`, flagged.length ? `flagged: ${flagged.join(", ")}` : ""].filter(Boolean).join(" · "),
    cite: d.citation,
    citations: d.citation ? [d.citation] : [],
    court: d.court,
    courtId,
    date: primaryDate(d.dates),
    snippet: h.chunk.text.slice(0, 400),
    url: d.url,
    score: h.score,
    authority: source === "caselaw" ? classifyAuthority(courtId, settings.jurisdiction, settings.courts) : "n/a",
    readRef: { kind: "url", url: `${INTEL_READ_PREFIX}${d.id}` },
    docketNumber: d.docketNumber,
  };
}

/** Hits from the intelligence corpus for a provider source (empty when the source has no intel kinds; never throws). */
export async function intelHitsFor(source: SearchSource, query: string, settings: SearchSettings, limit = 6): Promise<SearchHit[]> {
  const kinds = INTEL_KINDS_FOR_SOURCE[source];
  if (!kinds?.length || !query.trim()) return [];
  try {
    const range = datePresetRange(settings.datePreset, { from: settings.dateFrom, to: settings.dateTo });
    const hits = await searchIntel({ q: query, kinds, matterId: settings.matterId ?? undefined, dateFrom: range.from, dateTo: range.to, limit });
    const seen = new Set<string>();
    return hits.filter((h) => { if (seen.has(h.doc.id)) return false; seen.add(h.doc.id); return true; }).map((h) => intelHitToSearchHit(h, source, settings));
  } catch (e) {
    console.warn("[research] intel retrieval failed:", (e as Error).message);
    return [];
  }
}

/** Merge provider hits with intel hits, dropping intel rows that duplicate a provider hit (same url or citation). */
export function mergeIntelHits(provider: SearchHit[], intel: SearchHit[]): SearchHit[] {
  const urls = new Set(provider.map((h) => h.url?.toLowerCase()).filter(Boolean));
  const cites = new Set(provider.map((h) => h.cite?.toLowerCase().replace(/\s+/g, " ")).filter(Boolean));
  return [...provider, ...intel.filter((h) => !(h.url && urls.has(h.url.toLowerCase())) && !(h.cite && cites.has(h.cite.toLowerCase().replace(/\s+/g, " "))))];
}

const PLAN_SCHEMA = { type: "object", properties: { subQuestions: { type: "array", items: { type: "string" } }, lanes: { type: "array", items: { type: "object", properties: { lane: { type: "string", enum: ["controlling", "contrary", "regulatory", "record", "secondary", "fast"] }, queries: { type: "array", items: { type: "string" } } }, required: ["lane", "queries"] } } }, required: ["subQuestions", "lanes"] };
const FOLLOWUP_SCHEMA = { type: "object", properties: { questions: { type: "array", items: { type: "string" } } }, required: ["questions"] };
const REFINE_SCHEMA = { type: "object", properties: { refinements: { type: "array", items: { type: "object", properties: { lane: { type: "string", enum: ["controlling", "contrary", "regulatory", "record", "secondary", "fast"] }, queries: { type: "array", items: { type: "string" } } }, required: ["lane", "queries"] } } }, required: ["refinements"] };

export function defaultDeps(): EngineDeps {
  const cfg = aiConfig();
  return {
    hasKey: cfg.hasKey,
    model: cfg.model,
    fastModel: cfg.fastModel,

    async retrieve(source, query, settings, signal) {
      const ctx = toolCtx(signal);
      const courts = resolveCourts(settings.jurisdiction, settings.courts);
      const range = datePresetRange(settings.datePreset, { from: settings.dateFrom, to: settings.dateTo });
      const limit = Math.min(settings.limit, 12);
      const nctx = { jurisdiction: settings.jurisdiction, courts: settings.courts };
      const clQuery = toCourtListenerSyntax(query);
      const job = (): Promise<unknown> => {
        switch (source) {
          case "caselaw": return Promise.resolve(searchCaseLawTool.execute({ query: clQuery, courts: courts || undefined, filed_after: range.from, filed_before: range.to, order_by: settings.order === "date" ? "dateFiled desc" : "score desc", limit }, ctx));
          case "dockets": return Promise.resolve(searchDocketsTool.execute({ query: clQuery, courts: courts || undefined, filed_after: range.from, filed_before: range.to, limit }, ctx));
          case "regulations": return Promise.resolve(searchRegulationsTool.execute({ query, limit }, ctx));
          case "federal_register": return Promise.resolve(searchFederalRegisterTool.execute({ query, published_after: range.from, published_before: range.to, limit }, ctx));
          case "statutes": return Promise.resolve(searchStatutesTool.execute({ query, limit }, ctx));
          case "library": return Promise.resolve(searchLibraryTool.execute({ query, matter_id: settings.matterId ?? undefined, limit }, ctx));
          case "ediscovery": return Promise.resolve(searchEdiscoveryTool.execute({ query, matter_id: settings.matterId ?? undefined, date_after: range.from, date_before: range.to, limit }, ctx));
          case "web": return Promise.resolve({ results: [] });
        }
      };
      // The intelligence corpus feeds the same lane in parallel; its hits are normalized onto the provider kind.
      const intel = intelHitsFor(source, query, settings, 6);
      let provider: { hits: SearchHit[]; total: number };
      try {
        const payload = await withTimeout(job(), 25_000, signal);
        provider = normalizeToolResult(source, payload, nctx);
      } catch (e) {
        const fallback = await intel;
        if (!fallback.length || (e as Error).name === "AbortError") throw e;
        console.warn(`[research] ${source} provider failed; using ${fallback.length} intelligence hit(s):`, (e as Error).message);
        return { hits: fallback, total: fallback.length };
      }
      const extra = await intel;
      const hits = mergeIntelHits(provider.hits, extra);
      return { hits, total: provider.total + (hits.length - provider.hits.length) };
    },

    async read(ref, opts) {
      if (ref.kind === "url" && ref.url.startsWith(INTEL_READ_PREFIX)) {
        const id = ref.url.slice(INTEL_READ_PREFIX.length);
        const doc = intelDocuments().get(id);
        const text = getDocumentText(id);
        if (!doc || text == null) throw new Error(`Intelligence record ${id} not found`);
        return { text, title: doc.title, cite: doc.citation ?? doc.docketNumber, url: doc.url, cached: true };
      }
      const r = await withTimeout(readSource(ref, opts), 30_000, opts.signal);
      return { text: r.text, title: r.title, cite: r.cite, url: r.url, cached: Boolean(r.meta?.cached) };
    },

    async laneAgent(input) {
      const res = await runAgent({
        instructions: input.instructions,
        input: input.input,
        tools: input.tools,
        builtinTools: input.web ? [webSearchTool({ contextSize: "low" })] : [],
        model: cfg.fastModel,
        taskType: POLICY.laneAgent.taskType,
        reasoningEffort: POLICY.laneAgent.reasoningEffort,
        cacheStablePrefix: POLICY.laneAgent.cacheStablePrefix,
        verbosity: "low",
        maxSteps: input.maxSteps,
        maxOutputTokens: POLICY.laneAgent.maxOutputTokens,
        signal: input.signal,
        metadata: { app: "leclaude", surface: "research-lane" },
        onEvent: input.onEvent,
      });
      return { text: res.text, steps: res.steps, usage: res.usage };
    },

    async synthesize(input) {
      const res = await runAgent({
        instructions: input.instructions,
        input: input.input,
        evidence: input.evidence?.length ? input.evidence : undefined,
        taskType: POLICY.synthesize.taskType,
        cacheStablePrefix: POLICY.synthesize.cacheStablePrefix,
        maxOutputTokens: POLICY.synthesize.maxOutputTokens,
        maxSteps: 1,
        verbosity: "medium",
        signal: input.signal,
        metadata: { app: "leclaude", surface: "research-synthesis" },
        onEvent: (e) => { if (e.type === "text.delta") input.onDelta(e.delta); },
      });
      return { text: res.text, usage: res.usage };
    },

    verify(input) {
      return verifyClaims({ answer: input.answer, sources: input.sources, maxClaims: 25, signal: input.signal, fast: true });
    },

    async correct(input) {
      const r = await generateText({ fast: POLICY.correct.fast, taskType: POLICY.correct.taskType, reasoningEffort: POLICY.correct.reasoningEffort, cacheStablePrefix: POLICY.correct.cacheStablePrefix, instructions: input.instructions, input: input.input, maxOutputTokens: POLICY.correct.maxOutputTokens, signal: input.signal });
      return r.text;
    },

    async refine(input) {
      const r = await generateJSON<{ refinements: { lane: LaneKind; queries: string[] }[] }>({
        fast: POLICY.refine.fast,
        taskType: POLICY.refine.taskType,
        reasoningEffort: POLICY.refine.reasoningEffort,
        cacheStablePrefix: POLICY.refine.cacheStablePrefix,
        instructions: "You are a legal research librarian planning a second search round. For each research lane listed, write up to two precise boolean search queries (AND/OR/NOT, quoted phrases, wildcards*) that would locate authority for the unsupported claims. Skip lanes that cannot help. Under 20 words per query.",
        input: `Question: ${input.question}\nLanes: ${input.laneKinds.join(", ")}\nUnsupported claims:\n${input.gaps.map((g) => `- ${g}`).join("\n")}`,
        schema: REFINE_SCHEMA,
        name: "lane_refinements",
        maxOutputTokens: 600,
        signal: input.signal,
      });
      const out: Partial<Record<LaneKind, string[]>> = {};
      for (const x of r.refinements ?? []) if (x.queries?.length) out[x.lane] = x.queries.slice(0, 2);
      return out;
    },

    async followUps(input) {
      const r = await generateJSON<{ questions: string[] }>({
        fast: POLICY.followUps.fast,
        taskType: POLICY.followUps.taskType,
        reasoningEffort: POLICY.followUps.reasoningEffort,
        cacheStablePrefix: POLICY.followUps.cacheStablePrefix,
        instructions: "Propose exactly three precise follow-up research questions a litigator would ask next, each bound to the matter, jurisdiction and posture in play (name the court, standard or authority where it sharpens the question). One sentence each, no numbering.",
        input: `${input.matterLine}\n\nQuestion: ${input.question}\n\nAnswer:\n${input.answer.slice(0, 6000)}`,
        schema: FOLLOWUP_SCHEMA,
        name: "follow_ups",
        maxOutputTokens: 400,
        signal: input.signal,
      });
      return (r.questions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3);
    },

    async planQueries(input) {
      const r = await generateJSON<{ subQuestions: string[]; lanes: { lane: LaneKind; queries: string[] }[] }>({
        fast: POLICY.plan.fast,
        taskType: POLICY.plan.taskType,
        reasoningEffort: POLICY.plan.reasoningEffort,
        cacheStablePrefix: POLICY.plan.cacheStablePrefix,
        instructions: PLAN_INSTRUCTIONS,
        input: `${input.context}\nLanes: ${input.laneKinds.join(", ")}\n\nResearch question: ${input.question}`,
        schema: PLAN_SCHEMA,
        name: "research_plan",
        maxOutputTokens: POLICY.plan.maxOutputTokens,
        signal: input.signal,
      });
      const queries: ResearchPlan["queries"] = {};
      for (const x of r.lanes ?? []) if (x.queries?.length) queries[x.lane] = x.queries.map((q) => q.trim()).filter(Boolean).slice(0, 2);
      return { subQuestions: (r.subQuestions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 5), queries };
    },

    async citing(input) {
      const r = await withTimeout(findCitingOpinions(input.opinionId, { limit: 6, signal: input.signal }), 12_000, input.signal);
      const row = (c: (typeof r.citing)[number]) => ({ title: c.case_name ?? "Citing opinion", cite: c.citations[0], date: c.date_filed, url: c.url, snippet: c.snippet });
      return classifyTreatment({ citing: r.citing.map(row), citingCount: r.citing_count, negative: r.negative.map(row) });
    },

    async resolveCitation(citation, signal) {
      return (await withTimeout(Promise.resolve(resolveCitationTool.execute({ citation }, toolCtx(signal))), 15_000, signal)) as CitationResolution;
    },

    async verifyCitationsRemote(text, signal) {
      const r = (await withTimeout(Promise.resolve(verifyCitationsTool.execute({ text }, toolCtx(signal))), 12_000, signal)) as { citations: { citation: string; resolved: boolean }[] };
      return r.citations.filter((c) => c.resolved).map((c) => c.citation);
    },
  };
}
