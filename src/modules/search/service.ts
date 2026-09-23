import "server-only";
import { nanoid } from "nanoid";
import type { ResponseInput, ResponseInputItem } from "openai/resources/responses/responses";
import { db } from "@/lib/db";
import { runAgent, generateJSON, type AgentEvent } from "@/lib/ai/agent";
import { aiConfig, AIConfigError } from "@/lib/ai/config";
import type { ToolContext, ToolDef } from "@/lib/ai/tools";
import { researchToolset } from "@/lib/ai/toolkit";
import { fetchUrlTool } from "@/lib/ai/toolkit/web";
import {
  searchCaseLawTool, searchDocketsTool, searchRegulationsTool, searchFederalRegisterTool, searchStatutesTool, getOpinionTextTool, getCfrSectionTool, getFederalRegisterDocumentTool, verifyCitationsTool, COURT_GROUPS,
} from "@/lib/ai/toolkit/legal";
import { searchLibraryTool, searchEdiscoveryTool, getLibraryItemTool, getEdiscoveryDocumentTool } from "@/lib/ai/toolkit/internal";
import { FIRM_NAME, LEGAL_STYLE_RULES, RESEARCH_METHOD, todayLine } from "@/lib/ai/prompts";
import type { LibraryItem, Matter } from "@/lib/types/domain";
import { jurisdictionByKey, resolveCourts } from "./jurisdictions";
import { normalizeToolResult, formatBluebook } from "./normalize";
import { datePresetRange, toCourtListenerSyntax } from "./query-builder";
import { ASK_SOURCE_INSTRUCTIONS, EXPAND_QUERY_INSTRUCTIONS, FAST_ANSWER_FORMAT, HEADNOTE_INSTRUCTIONS, SYNTHESIS_FORMAT, retrievalPlanLine } from "./prompts";
import { extractCitations, type ExtractedCitation } from "./citations";
import { ALL_SOURCES, DEFAULT_SETTINGS, type CitationCheck, type ReadRef, type ReadResult, type SavedSearch, type SearchHit, type SearchRun, type SearchRunRequest, type SearchSettings, type SearchSource, type SearchStreamEvent, type SourceError } from "./types";

export const CURRENT_USER = { id: "p_jwhitfield", name: "Jordan Whitfield" };

export const savedSearches = () => db().collection<SavedSearch>("search_saved");
export const searchRuns = () => db().collection<SearchRun>("search_runs");

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function sanitizeSettings(raw: Partial<SearchSettings> | undefined | null): SearchSettings {
  const r = raw ?? {};
  const sources = Array.isArray(r.sources) ? r.sources.filter((s): s is SearchSource => (ALL_SOURCES as string[]).includes(s)) : DEFAULT_SETTINGS.sources;
  return {
    sources: sources.length ? Array.from(new Set(sources)) : DEFAULT_SETTINGS.sources,
    jurisdiction: typeof r.jurisdiction === "string" && r.jurisdiction ? r.jurisdiction : DEFAULT_SETTINGS.jurisdiction,
    courts: typeof r.courts === "string" ? r.courts.trim().slice(0, 200) : "",
    datePreset: (["any", "1y", "5y", "10y", "custom"] as const).includes(r.datePreset as never) ? (r.datePreset as SearchSettings["datePreset"]) : "any",
    dateFrom: typeof r.dateFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.dateFrom) ? r.dateFrom : undefined,
    dateTo: typeof r.dateTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.dateTo) ? r.dateTo : undefined,
    limit: Math.min(50, Math.max(5, Number(r.limit) || DEFAULT_SETTINGS.limit)),
    order: r.order === "date" ? "date" : "score",
    matterId: typeof r.matterId === "string" && r.matterId ? r.matterId : null,
    fast: Boolean(r.fast),
  };
}

// ---------------------------------------------------------------------------
// Saved searches & history
// ---------------------------------------------------------------------------

export function listSavedSearches(): SavedSearch[] {
  return savedSearches().list({ sortBy: (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt) });
}

export function createSavedSearch(input: { name?: string; query: string; settings?: Partial<SearchSettings>; tags?: string[]; notes?: string; pinned?: boolean; id?: string }): SavedSearch {
  const now = new Date().toISOString();
  const settings = sanitizeSettings(input.settings);
  const s: SavedSearch = {
    id: input.id ?? `ss_${nanoid(10)}`,
    name: (input.name ?? "").trim() || input.query.trim().slice(0, 80),
    query: input.query.trim(),
    settings,
    ownerId: CURRENT_USER.id,
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    pinned: Boolean(input.pinned),
    tags: input.tags,
    notes: input.notes,
    matterId: settings.matterId ?? null,
  };
  savedSearches().put(s);
  return s;
}

export function updateSavedSearch(id: string, patch: Partial<Pick<SavedSearch, "name" | "query" | "tags" | "notes" | "pinned" | "lastRunAt" | "runCount">> & { settings?: Partial<SearchSettings> }): SavedSearch | null {
  return savedSearches().update(id, (cur) => ({
    ...cur,
    ...patch,
    settings: patch.settings ? sanitizeSettings({ ...cur.settings, ...patch.settings }) : cur.settings,
    matterId: patch.settings?.matterId !== undefined ? patch.settings.matterId : cur.matterId,
    updatedAt: new Date().toISOString(),
  }));
}

export function deleteSavedSearch(id: string) {
  return savedSearches().delete(id);
}

export function listRuns(limit = 40): SearchRun[] {
  return searchRuns().list({ sortBy: "createdAt", direction: "desc", limit });
}

export function getRun(id: string) {
  return searchRuns().get(id);
}

export function deleteRun(id: string) {
  return searchRuns().delete(id);
}

export function clearRuns() {
  const c = searchRuns();
  for (const r of c.all()) c.delete(r.id);
}

// ---------------------------------------------------------------------------
// Structured retrieval fan-out
// ---------------------------------------------------------------------------

function toolCtx(signal?: AbortSignal): ToolContext {
  return { emit: () => {}, signal, state: {} };
}

export interface RetrievalOutcome {
  hits: Partial<Record<SearchSource, SearchHit[]>>;
  totals: Partial<Record<SearchSource, number>>;
  errors: SourceError[];
  durationMs: number;
}

function providerMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network|abort|timeout|ETIMEDOUT|ECONNRESET/i.test(msg)) return "Provider unreachable (network). Retry when online.";
  if (/429/.test(msg)) return "Provider rate limit reached. Retry in a minute or add an API token in Settings.";
  if (/403|401/.test(msg)) return "Provider refused the request (HTTP 403/401). Check outbound network/proxy access or the API token in Settings.";
  return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
}

/**
 * Run the selected providers concurrently, streaming each source as it lands.
 * Never throws: provider failures become `source.error` events.
 */
export async function runStructuredRetrieval(query: string, settings: SearchSettings, send: (e: SearchStreamEvent) => void, signal?: AbortSignal): Promise<RetrievalOutcome> {
  const started = Date.now();
  const courts = resolveCourts(settings.jurisdiction, settings.courts);
  const range = datePresetRange(settings.datePreset, { from: settings.dateFrom, to: settings.dateTo });
  const clQuery = toCourtListenerSyntax(query);
  const ctx = toolCtx(signal);
  const nctx = { jurisdiction: settings.jurisdiction, courts: settings.courts };
  const limit = settings.limit;
  const outcome: RetrievalOutcome = { hits: {}, totals: {}, errors: [], durationMs: 0 };

  const jobs: Record<SearchSource, (() => Promise<unknown>) | null> = {
    caselaw: async () => searchCaseLawTool.execute({ query: clQuery, courts: courts || undefined, filed_after: range.from, filed_before: range.to, order_by: settings.order === "date" ? "dateFiled desc" : "score desc", limit: Math.min(limit, 20) }, ctx),
    dockets: async () => searchDocketsTool.execute({ query: clQuery, courts: courts || undefined, filed_after: range.from, filed_before: range.to, limit: Math.min(limit, 20) }, ctx),
    regulations: async () => searchRegulationsTool.execute({ query, limit: Math.min(limit, 20) }, ctx),
    federal_register: async () => searchFederalRegisterTool.execute({ query, published_after: range.from, published_before: range.to, limit: Math.min(limit, 20) }, ctx),
    statutes: async () => searchStatutesTool.execute({ query, limit: Math.min(limit, 20) }, ctx),
    library: async () => searchLibraryTool.execute({ query, matter_id: settings.matterId ?? undefined, limit: Math.min(limit, 25) }, ctx),
    ediscovery: async () => searchEdiscoveryTool.execute({ query, matter_id: settings.matterId ?? undefined, date_after: range.from, date_before: range.to, limit: Math.min(limit, 25) }, ctx),
    web: null, // web results arrive through the agent's web_search citations
  };

  await Promise.all(
    settings.sources.map(async (source) => {
      const job = jobs[source];
      if (!job) return;
      const t0 = Date.now();
      try {
        const payload = await withTimeout(job(), 25_000, signal);
        const { hits, total } = normalizeToolResult(source, payload, nctx);
        outcome.hits[source] = hits;
        outcome.totals[source] = total;
        send({ type: "results", source, results: hits, total, durationMs: Date.now() - t0 });
      } catch (e) {
        const message = providerMessage(e);
        outcome.errors.push({ source, message, durationMs: Date.now() - t0 });
        send({ type: "source.error", source, message, durationMs: Date.now() - t0 });
      }
    }),
  );
  outcome.durationMs = Date.now() - started;
  send({ type: "retrieval.done", durationMs: outcome.durationMs });
  return outcome;
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then((v) => { clearTimeout(t); signal?.removeEventListener("abort", onAbort); resolve(v); }, (e) => { clearTimeout(t); signal?.removeEventListener("abort", onAbort); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// AI synthesis
// ---------------------------------------------------------------------------

function renderHitsForPrompt(hits: Partial<Record<SearchSource, SearchHit[]>>, max = 8): string {
  const lines: string[] = [];
  let n = 0;
  for (const source of ALL_SOURCES) {
    const list = hits[source];
    if (!list?.length) continue;
    lines.push(`### ${source}`);
    for (const h of list.slice(0, max)) {
      n++;
      const ref = h.opinionId ? ` opinion_id=${h.opinionId}` : h.cfr?.section ? ` cfr title=${h.cfr.title} section=${h.cfr.section}` : h.fr?.documentNumber ? ` fr_document=${h.fr.documentNumber}` : h.edoc ? ` bates=${h.edoc.bates}` : h.library ? ` library_id=${h.id.split(":")[1]}` : "";
      lines.push(`[${n}] ${formatBluebook(h)}${h.courtId ? ` (${h.courtId}, ${h.authority})` : ""}${ref}${h.url ? ` ${h.url}` : ""}\n    ${(h.snippet ?? "").slice(0, 320)}`);
    }
  }
  return lines.join("\n");
}

export interface SynthesisOptions {
  query: string;
  settings: SearchSettings;
  matter: Matter | null;
  /** Resolves when structured retrieval is done; the agent gets a short head start on whatever arrived. */
  retrieval: Promise<RetrievalOutcome>;
  partial: () => Partial<Record<SearchSource, SearchHit[]>>;
  send: (e: AgentEvent) => void;
  signal?: AbortSignal;
  /** Continue the stored conversation instead of starting a new synthesis. */
  previousResponseId?: string | null;
}

export type SynthesisStatus = SearchRun["aiStatus"];

/** Run the research agent (or the fast answer) and stream its events. Returns the final text. */
export async function runSynthesis(o: SynthesisOptions): Promise<{ text: string; status: SynthesisStatus }> {
  const cfg = aiConfig();
  if (!cfg.hasKey) {
    o.send({ type: "error", message: "OPENAI_API_KEY is not configured. Add it to .env.local to enable AI synthesis; structured results still load.", code: "no_api_key" });
    return { text: "", status: "no_api_key" };
  }
  const j = jurisdictionByKey(o.settings.jurisdiction);
  const courts = resolveCourts(o.settings.jurisdiction, o.settings.courts);
  const range = datePresetRange(o.settings.datePreset, { from: o.settings.dateFrom, to: o.settings.dateTo });
  const matterLine = o.matter ? `Active matter: ${o.matter.name} (${o.matter.caption ?? o.matter.shortName}); client ${o.matter.client} (${o.matter.clientSide}); ${o.matter.court ?? ""}; stage: ${o.matter.stage ?? "n/a"}. Matter id: ${o.matter.id}. ${o.matter.description ?? ""}` : "No matter selected. Call get_matter_context if the question refers to a matter.";

  try {
    if (o.previousResponseId) {
      // Follow-up question in the same conversation: no new retrieval, tools stay available (fast mode keeps no tools).
      const { tools, builtinTools } = o.settings.fast ? { tools: [], builtinTools: [] } : researchToolset({ web: o.settings.sources.includes("web"), legal: true, internal: true, webContextSize: "medium" });
      const instructions = [
        `You are the ${FIRM_NAME} legal research agent answering a follow-up question in an ongoing research session. ${todayLine()}`,
        matterLine,
        `Jurisdiction: ${j.label}${courts ? ` (courts: ${courts})` : ""}.`,
        RESEARCH_METHOD,
        LEGAL_STYLE_RULES,
        "Answer the follow-up directly, keep numbered citations consistent with the Sources list you already gave (add new numbers for new sources), and read any new authority before quoting it.",
      ].join("\n\n");
      const res = await runAgent({ instructions, input: o.query, tools, builtinTools, previousResponseId: o.previousResponseId, model: o.settings.fast ? cfg.fastModel : undefined, reasoningEffort: o.settings.fast ? "low" : undefined, maxSteps: o.settings.fast ? 1 : 10, verbosity: "low", signal: o.signal, metadata: { app: "leclaude", surface: "search-followup" }, onEvent: o.send });
      return { text: res.text, status: "ok" };
    }

    if (o.settings.fast) {
      // Fast answer: wait (briefly) for structured results, then one fast-model pass with no tools and no reading step.
      const outcome = await Promise.race([o.retrieval, sleep(9_000).then(() => null)]);
      const hits = outcome?.hits ?? o.partial();
      const instructions = [
        `You are the ${FIRM_NAME} research agent in FAST mode. ${todayLine()}`,
        matterLine,
        `Jurisdiction: ${j.label}${courts ? ` (courts: ${courts})` : ""}.${range.from ? ` Date range from ${range.from}.` : ""}`,
        LEGAL_STYLE_RULES,
        FAST_ANSWER_FORMAT,
      ].join("\n\n");
      const input = `Research question: ${o.query}\n\nStructured search results (use these as your sources; cite them by number):\n${renderHitsForPrompt(hits) || "(no structured results were returned)"}`;
      const res = await runAgent({ instructions, input, model: cfg.fastModel, reasoningEffort: "low", verbosity: "low", maxSteps: 1, maxOutputTokens: 1800, signal: o.signal, metadata: { app: "leclaude", surface: "search-fast" }, onEvent: o.send });
      return { text: res.text, status: "ok" };
    }

    // Full synthesis: short head start so the agent can go straight to reading the top structured hits.
    await Promise.race([o.retrieval, sleep(2_500)]);
    const partial = o.partial();
    const { tools, builtinTools } = researchToolset({ web: o.settings.sources.includes("web"), legal: true, internal: true, webContextSize: "medium" });
    const instructions = [
      `You are the ${FIRM_NAME} legal research agent. ${todayLine()}`,
      matterLine,
      retrievalPlanLine(o.settings.sources, j.label, courts, range.from, range.to, o.matter?.name),
      RESEARCH_METHOD,
      LEGAL_STYLE_RULES,
      SYNTHESIS_FORMAT,
      Object.keys(partial).length ? `Preliminary structured results already retrieved for the user (read the most relevant ones first; ids are usable with the read tools):\n${renderHitsForPrompt(partial, 6)}` : "",
    ].filter(Boolean).join("\n\n");
    const input: ResponseInput = [{ role: "user", content: [{ type: "input_text", text: o.query }] } as ResponseInputItem];
    const res = await runAgent({ instructions, input, tools, builtinTools, maxSteps: 14, verbosity: "medium", signal: o.signal, state: { matterId: o.settings.matterId }, metadata: { app: "leclaude", surface: "search" }, onEvent: o.send });
    return { text: res.text, status: "ok" };
  } catch (e) {
    if (e instanceof AIConfigError) { o.send({ type: "error", message: e.message, code: "no_api_key" }); return { text: "", status: "no_api_key" }; }
    if ((e as Error).name === "AbortError") return { text: "", status: "skipped" };
    o.send({ type: "error", message: e instanceof Error ? e.message : String(e) });
    return { text: "", status: "error" };
  }
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Whole run
// ---------------------------------------------------------------------------

export function recordRun(input: { id: string; query: string; settings: SearchSettings; startedAt: number; outcome: RetrievalOutcome; synthesis: string; aiStatus: SynthesisStatus; savedSearchId?: string }): SearchRun {
  const counts: Partial<Record<SearchSource, number>> = {};
  const topHits: SearchHit[] = [];
  for (const s of ALL_SOURCES) {
    const list = input.outcome.hits[s];
    if (list) { counts[s] = list.length; topHits.push(...list.slice(0, 3)); }
  }
  const run: SearchRun = {
    id: input.id,
    query: input.query,
    settings: input.settings,
    createdAt: new Date(input.startedAt).toISOString(),
    durationMs: Date.now() - input.startedAt,
    counts,
    totals: input.outcome.totals,
    errors: input.outcome.errors.length ? input.outcome.errors : undefined,
    synthesis: input.synthesis ? input.synthesis.slice(0, 6000) : undefined,
    topHits: topHits.slice(0, 12),
    ownerId: CURRENT_USER.id,
    matterId: input.settings.matterId ?? null,
    savedSearchId: input.savedSearchId,
    aiStatus: input.aiStatus,
  };
  searchRuns().put(run);
  if (input.savedSearchId) updateSavedSearch(input.savedSearchId, { lastRunAt: run.createdAt, runCount: (savedSearches().get(input.savedSearchId)?.runCount ?? 0) + 1 });
  // keep history bounded
  const all = searchRuns().list({ sortBy: "createdAt", direction: "desc" });
  for (const old of all.slice(250)) searchRuns().delete(old.id);
  return run;
}

export interface ParsedRunRequest { query: string; settings: SearchSettings; runId: string; savedSearchId?: string; skipSynthesis: boolean; followUp: boolean; previousResponseId: string | null }

export function parseRunRequest(body: unknown): ParsedRunRequest | { error: string } {
  const b = (body ?? {}) as Partial<SearchRunRequest> & { savedSearchId?: string; query?: string; skipSynthesis?: boolean; followUp?: boolean };
  const query = (typeof b.message === "string" ? b.message : typeof b.query === "string" ? b.query : "").trim();
  if (!query) return { error: "`message` (the research query) is required" };
  if (query.length > 4000) return { error: "Query is too long (max 4000 characters)" };
  return {
    query,
    settings: sanitizeSettings(b),
    runId: typeof b.runId === "string" && b.runId ? b.runId.replace(/[^\w.-]/g, "").slice(0, 40) || `run_${nanoid(10)}` : `run_${nanoid(10)}`,
    savedSearchId: typeof b.savedSearchId === "string" ? b.savedSearchId : undefined,
    skipSynthesis: Boolean(b.skipSynthesis),
    followUp: Boolean(b.followUp) && typeof b.previousResponseId === "string" && b.previousResponseId.length > 0,
    previousResponseId: typeof b.previousResponseId === "string" ? b.previousResponseId : null,
  };
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

const READ_MAX = 160_000;

interface OpinionText { opinion_id: number; url?: string; text: string; length: number }
interface CfrText { cite: string; url: string; as_of: string; text: string }
interface FrText { title?: string; citation?: string; published?: string; url?: string; text: string }
interface UrlText { url: string; title?: string; contentType?: string; text: string }
interface EdocText { id: string; matterId: string; bates: string; batesEnd?: string; date: string; custodianName: string; from?: string; to?: string[]; cc?: string[]; type: string; subject: string; text: string; coding?: unknown; aiSummary?: string }

export async function readSource(ref: ReadRef, opts: { title?: string; signal?: AbortSignal } = {}): Promise<ReadResult> {
  const ctx = toolCtx(opts.signal);
  switch (ref.kind) {
    case "opinion": {
      const r = (await getOpinionTextTool.execute({ opinion_id: ref.id, max_chars: READ_MAX }, ctx)) as OpinionText;
      return { kind: "opinion", title: opts.title ?? `Opinion #${ref.id}`, url: r.url, text: r.text, length: r.length, meta: { opinionId: ref.id } };
    }
    case "cfr": {
      const r = (await getCfrSectionTool.execute({ title: ref.title, section: ref.section, max_chars: READ_MAX }, ctx)) as CfrText;
      return { kind: "cfr", title: opts.title ?? r.cite, cite: r.cite, url: r.url, text: r.text, length: r.text.length, meta: { asOf: r.as_of } };
    }
    case "fr": {
      const r = (await getFederalRegisterDocumentTool.execute({ document_number: ref.id, max_chars: READ_MAX }, ctx)) as FrText;
      return { kind: "fr", title: r.title ?? opts.title ?? ref.id, cite: r.citation, url: r.url, text: r.text, length: r.text.length, meta: { published: r.published, documentNumber: ref.id } };
    }
    case "url":
    case "statute": {
      const r = (await fetchUrlTool.execute({ url: ref.url, max_chars: READ_MAX }, ctx)) as UrlText;
      return { kind: ref.kind, title: opts.title ?? r.title ?? ref.url, url: r.url, text: r.text, length: r.text.length, meta: { contentType: r.contentType } };
    }
    case "library": {
      const item = (await getLibraryItemTool.execute({ id: ref.id, max_chars: READ_MAX }, ctx)) as LibraryItem & { content: string };
      return { kind: "library", title: item.name, text: item.content || item.description || "(This library item has no text content. Open it in the Office editor.)", url: item.officeDocId ? `/office/word/${item.officeDocId}` : item.url, length: (item.content ?? "").length, meta: { type: item.type, tags: item.tags, practiceArea: item.practiceArea, officeDocId: item.officeDocId, updatedAt: item.updatedAt } };
    }
    case "edoc": {
      const r = (await getEdiscoveryDocumentTool.execute({ id_or_bates: ref.id, max_chars: READ_MAX }, ctx)) as EdocText;
      const header = [`Bates: ${r.bates}${r.batesEnd ? `–${r.batesEnd}` : ""}`, `Date: ${r.date}`, `Custodian: ${r.custodianName}`, r.from ? `From: ${r.from}` : "", r.to?.length ? `To: ${r.to.join("; ")}` : "", r.cc?.length ? `Cc: ${r.cc.join("; ")}` : "", `Type: ${r.type}`].filter(Boolean).join("\n");
      return { kind: "edoc", title: `${r.bates} — ${r.subject}`, cite: r.bates, url: `/ediscovery?matter=${r.matterId}&doc=${r.id}`, text: `${header}\n\n${r.text}`, length: r.text.length, meta: { bates: r.bates, custodian: r.custodianName, coding: r.coding, aiSummary: r.aiSummary, matterId: r.matterId } };
    }
  }
}

export function parseReadRef(body: unknown): ReadRef | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind;
  const id = b.id;
  const url = typeof b.url === "string" ? b.url : undefined;
  switch (kind) {
    case "opinion": { const n = Number(id); return Number.isFinite(n) && n > 0 ? { kind: "opinion", id: n } : null; }
    case "cfr": { const t = Number(b.title); const s = typeof b.section === "string" ? b.section : ""; return Number.isFinite(t) && s ? { kind: "cfr", title: t, section: s } : null; }
    case "fr": return typeof id === "string" && id ? { kind: "fr", id } : null;
    case "url": return url && /^https?:\/\//i.test(url) ? { kind: "url", url } : null;
    case "statute": return url && /^https?:\/\//i.test(url) ? { kind: "statute", url, id: typeof id === "string" ? id : undefined } : null;
    case "library": return typeof id === "string" && id ? { kind: "library", id } : null;
    case "edoc": return typeof id === "string" && id ? { kind: "edoc", id } : null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Headnote summary, ask-about-source, query expansion, citation check
// ---------------------------------------------------------------------------

export interface Headnotes { syllabus: string; headnotes: string[]; holding: string; disposition: string; keyQuotes: { quote: string; locator: string }[] }

export async function summarizeSource(input: { title: string; cite?: string; text: string; signal?: AbortSignal }): Promise<Headnotes> {
  return generateJSON<Headnotes>({
    fast: true,
    instructions: HEADNOTE_INSTRUCTIONS,
    input: `SOURCE: ${input.title}${input.cite ? ` (${input.cite})` : ""}\n\n${input.text.slice(0, 90_000)}`,
    name: "headnotes",
    maxOutputTokens: 1400,
    signal: input.signal,
    schema: {
      type: "object",
      properties: {
        syllabus: { type: "string" },
        headnotes: { type: "array", items: { type: "string" } },
        holding: { type: "string" },
        disposition: { type: "string" },
        keyQuotes: { type: "array", items: { type: "object", properties: { quote: { type: "string" }, locator: { type: "string" } }, required: ["quote", "locator"] } },
      },
      required: ["syllabus", "headnotes", "holding", "disposition", "keyQuotes"],
    },
  });
}

export interface AskSourceBody { message: string; history?: { role: "user" | "assistant"; content: string }[]; previousResponseId?: string | null; source: { title: string; cite?: string; url?: string; kind?: string }; text: string }

export async function askAboutSource(body: AskSourceBody, send: (e: AgentEvent) => void, signal?: AbortSignal) {
  const instructions = [
    `You are the ${FIRM_NAME} research agent. ${todayLine()}`,
    ASK_SOURCE_INSTRUCTIONS,
    LEGAL_STYLE_RULES,
    `SOURCE: ${body.source.title}${body.source.cite ? ` — ${body.source.cite}` : ""}${body.source.url ? ` — ${body.source.url}` : ""}\n"""\n${body.text.slice(0, 70_000)}\n"""`,
  ].join("\n\n");
  const input: ResponseInput = [];
  if (!body.previousResponseId) for (const h of (body.history ?? []).slice(-10)) input.push({ role: h.role, content: h.content.slice(0, 8000) } as ResponseInputItem);
  input.push({ role: "user", content: body.message } as ResponseInputItem);
  const tools = [verifyCitationsTool, getOpinionTextTool, getCfrSectionTool, fetchUrlTool] as unknown as ToolDef<never, unknown>[];
  try {
    await runAgent({ instructions, input, tools, previousResponseId: body.previousResponseId ?? null, maxSteps: 6, verbosity: "low", signal, metadata: { app: "leclaude", surface: "search-ask" }, onEvent: send });
  } catch (e) {
    if (e instanceof AIConfigError) { send({ type: "error", message: e.message, code: "no_api_key" }); return; }
    throw e;
  }
}

export interface ExpandedQuery { query: string; rationale: string }

export async function expandQuery(query: string, jurisdictionLabel: string, signal?: AbortSignal): Promise<ExpandedQuery[]> {
  const r = await generateJSON<{ queries: ExpandedQuery[] }>({
    fast: true,
    instructions: EXPAND_QUERY_INSTRUCTIONS,
    input: `Jurisdiction: ${jurisdictionLabel}\nQuery: ${query}`,
    name: "expanded_queries",
    maxOutputTokens: 500,
    signal,
    schema: { type: "object", properties: { queries: { type: "array", items: { type: "object", properties: { query: { type: "string" }, rationale: { type: "string" } }, required: ["query", "rationale"] } } }, required: ["queries"] },
  });
  return (r.queries ?? []).slice(0, 3);
}

export interface CiteCheckResult {
  extracted: ExtractedCitation[];
  checks: CitationCheck[];
  providerError?: string;
  summary: { total: number; resolved: number; unresolved: number; unchecked: number };
}

export async function checkCitations(text: string, signal?: AbortSignal): Promise<CiteCheckResult> {
  const extracted = extractCitations(text);
  let checks: CitationCheck[] = [];
  let providerError: string | undefined;
  if (extracted.some((c) => c.kind === "case")) {
    try {
      const r = (await withTimeout(Promise.resolve(verifyCitationsTool.execute({ text }, toolCtx(signal))), 25_000, signal)) as { citations: { citation: string; resolved: boolean; status: number; error?: string; matches?: { case_name?: string; date_filed?: string; url?: string }[] }[] };
      checks = r.citations.map((c) => ({ citation: c.citation, resolved: c.resolved, status: c.status, error: c.error, matches: c.matches }));
    } catch (e) {
      providerError = providerMessage(e);
    }
  }
  const resolved = checks.filter((c) => c.resolved).length;
  const unresolved = checks.filter((c) => !c.resolved).length;
  const caseCount = extracted.filter((c) => c.kind === "case").length;
  return { extracted, checks, providerError, summary: { total: extracted.length, resolved, unresolved, unchecked: extracted.length - (checks.length ? Math.min(checks.length, caseCount) : 0) } };
}

// ---------------------------------------------------------------------------
// Save to library
// ---------------------------------------------------------------------------

export const SAVED_RESEARCH_FOLDER_ID = "lib_folder_saved_research";

export function saveHitToLibrary(hit: SearchHit, opts: { matterId?: string | null; note?: string } = {}): LibraryItem {
  const d = db();
  const now = new Date().toISOString();
  if (!d.library.get(SAVED_RESEARCH_FOLDER_ID)) {
    d.library.put({ id: SAVED_RESEARCH_FOLDER_ID, parentId: null, name: "Saved research", type: "folder", description: "Authorities saved from the Search agent", createdAt: now, updatedAt: now, ownerId: CURRENT_USER.id, sharedWith: ["firm"], tags: ["research"] });
  }
  const cite = formatBluebook(hit);
  const existing = d.library.findOne((l) => l.parentId === SAVED_RESEARCH_FOLDER_ID && l.name === cite);
  if (existing) return existing;
  const isExternal = Boolean(hit.url && /^https?:\/\//.test(hit.url));
  const item: LibraryItem = {
    id: `lib_${nanoid(10)}`,
    parentId: SAVED_RESEARCH_FOLDER_ID,
    name: cite,
    type: isExternal ? "link" : "note",
    matterId: opts.matterId ?? undefined,
    description: hit.snippet?.slice(0, 300),
    url: isExternal ? hit.url : undefined,
    content: [cite, hit.subtitle, hit.snippet, opts.note ? `Note: ${opts.note}` : ""].filter(Boolean).join("\n\n"),
    tags: ["research", hit.source, hit.authority && hit.authority !== "n/a" ? hit.authority : ""].filter(Boolean),
    ownerId: CURRENT_USER.id,
    sharedWith: ["firm"],
    createdAt: now,
    updatedAt: now,
    status: "approved",
  };
  d.library.put(item);
  return item;
}

/** Court-group keys exposed for the sync test and the UI. */
export function courtGroupKeys() {
  return Object.keys(COURT_GROUPS);
}
