import "server-only";
import type { ResponseInput } from "openai/resources/responses/responses";
import { generateJSON, generateText, runAgent, type AgentEvent } from "@/lib/ai/agent";
import { aiConfig } from "@/lib/ai/config";
import type { ToolContext, ToolDef } from "@/lib/ai/tools";
import { webSearchTool } from "@/lib/ai/toolkit/web";
import { searchCaseLawTool, searchDocketsTool, searchRegulationsTool, searchFederalRegisterTool, searchStatutesTool, verifyCitationsTool } from "@/lib/ai/toolkit/legal";
import { searchLibraryTool, searchEdiscoveryTool } from "@/lib/ai/toolkit/internal";
import { verifyClaims, type VerificationResult } from "@/lib/ai/verify";
import { resolveCourts } from "../jurisdictions";
import { normalizeToolResult } from "../normalize";
import { datePresetRange, toCourtListenerSyntax } from "../query-builder";
import { readSource } from "../service";
import type { ReadRef, SearchHit, SearchSettings, SearchSource } from "../types";
import type { LaneKind } from "./types";

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
  /** A bounded lane agent run. Returns the lane note. */
  laneAgent(input: { instructions: string; input: string; tools: ToolDef<never, unknown>[]; web: boolean; maxSteps: number; signal?: AbortSignal; onEvent: (e: AgentEvent) => void }): Promise<{ text: string; steps: number }>;
  /** Synthesis with streaming deltas (primary model, no tools). */
  synthesize(input: { instructions: string; input: string | ResponseInput; signal?: AbortSignal; onDelta: (d: string) => void }): Promise<string>;
  verify(input: { answer: string; sources: { title?: string; cite?: string; url?: string; text: string }[]; signal?: AbortSignal }): Promise<VerificationResult>;
  correct(input: { instructions: string; input: string; signal?: AbortSignal }): Promise<string>;
  refine(input: { question: string; gaps: string[]; laneKinds: LaneKind[]; signal?: AbortSignal }): Promise<Partial<Record<LaneKind, string[]>>>;
  followUps(input: { question: string; answer: string; matterLine: string; signal?: AbortSignal }): Promise<string[]>;
  /** Resolve case citations on CourtListener; returns the normalised citations that resolved. */
  verifyCitationsRemote(text: string, signal?: AbortSignal): Promise<string[]>;
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
      const payload = await withTimeout(job(), 25_000, signal);
      return normalizeToolResult(source, payload, nctx);
    },

    async read(ref, opts) {
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
        reasoningEffort: "low",
        verbosity: "low",
        maxSteps: input.maxSteps,
        maxOutputTokens: 1800,
        signal: input.signal,
        metadata: { app: "leclaude", surface: "research-lane" },
        onEvent: input.onEvent,
      });
      return { text: res.text, steps: res.steps };
    },

    async synthesize(input) {
      const res = await runAgent({
        instructions: input.instructions,
        input: input.input,
        maxSteps: 1,
        verbosity: "medium",
        signal: input.signal,
        metadata: { app: "leclaude", surface: "research-synthesis" },
        onEvent: (e) => { if (e.type === "text.delta") input.onDelta(e.delta); },
      });
      return res.text;
    },

    verify(input) {
      return verifyClaims({ answer: input.answer, sources: input.sources, maxClaims: 25, signal: input.signal, fast: true });
    },

    async correct(input) {
      const r = await generateText({ fast: true, reasoningEffort: "low", instructions: input.instructions, input: input.input, maxOutputTokens: 4000, signal: input.signal });
      return r.text;
    },

    async refine(input) {
      const r = await generateJSON<{ refinements: { lane: LaneKind; queries: string[] }[] }>({
        fast: true,
        reasoningEffort: "low",
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
        fast: true,
        reasoningEffort: "low",
        instructions: "Propose exactly three precise follow-up research questions a litigator would ask next, each bound to the matter, jurisdiction and posture in play (name the court, standard or authority where it sharpens the question). One sentence each, no numbering.",
        input: `${input.matterLine}\n\nQuestion: ${input.question}\n\nAnswer:\n${input.answer.slice(0, 6000)}`,
        schema: FOLLOWUP_SCHEMA,
        name: "follow_ups",
        maxOutputTokens: 400,
        signal: input.signal,
      });
      return (r.questions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3);
    },

    async verifyCitationsRemote(text, signal) {
      const r = (await withTimeout(Promise.resolve(verifyCitationsTool.execute({ text }, toolCtx(signal))), 12_000, signal)) as { citations: { citation: string; resolved: boolean }[] };
      return r.citations.filter((c) => c.resolved).map((c) => c.citation);
    },
  };
}
