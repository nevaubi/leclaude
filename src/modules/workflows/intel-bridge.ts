import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { generateJSON } from "@/lib/ai/agent";
import { aiConfig } from "@/lib/ai/config";
import { currentUser } from "@/lib/current-user";
import { audit } from "@/lib/integrity/audit";
import { findNearDuplicateEvent, findNearDuplicateTask } from "@/lib/integrity/dedupe";
import { sha256 } from "@/lib/integrity/hash";
import { makeProvenance } from "@/lib/integrity/provenance";
import type { Provenance, ProvenanceSource } from "@/lib/integrity/types";
import type { LibraryItem, Task, TeamUpdate } from "@/lib/types/domain";
import { KNOWLEDGE_SUBFOLDERS, matterFolderId } from "@/modules/library/ids";
import { extractIntelText } from "@/modules/intel/extract";
import { claimJob, enqueueJob, executeJob, getJob } from "@/modules/intel/jobs";
import { courtMention, dedupeMentions, mentionsFromCaption, mentionsFromJudgeField } from "@/modules/intel/mentions";
import { createSource, getSource, IntelServiceError, validateConfig } from "@/modules/intel/service";
import { sweep, verifyInsights } from "@/modules/intel/steward";
import { entityIdsOf, flagDocument, getDocument, getDocumentText, indexIntelDocument, ingestDocument, intelDocuments, intelEntities, intelInsights, intelJobs, intelRelations, intelSources, intelWatches, listDocuments, primaryDate, reindexMissingEmbeddings, upsertEntity, type ListDocumentsOptions } from "@/modules/intel/store";
import type { IntelAdapterId, IntelDocument, IntelDocumentKind, IntelEntity, IntelEntityMention, IntelEntityType, IntelEvidence, IntelInsight, IntelInsightKind, IntelJobLogLine, IntelRelation, IntelRelationType, IntelSeries, IntelSource, IntelSweepReport, IntelTimelineEntry, IntelWatch } from "@/modules/intel/types";
import { WORKFLOW_CURRENT_USER } from "./types";

/**
 * Thin server bridge between workflow executors and the intelligence layer:
 * source runs through the durable queue, document extraction / indexing /
 * entity linking, the five analyses (with a provider hook the analysis
 * module can register), insight verification, publishing to Home / matter /
 * library / watchers / digests, record queries and per-person digests.
 */

// ─────────────────────────── Shared helpers ───────────────────────────

export const UPLOADS_SOURCE_ID = "isrc_workflow_uploads";
const ENTITY_TYPES: IntelEntityType[] = ["judge", "attorney", "firm", "party", "court", "mdl", "product", "agency", "regulation", "statute", "expert"];
const STOP = new Set("the a an and or of in on for to by with from at as is are was were be been this that these those it its into over under v vs re et al inc llc corp co ltd no order motion court district united states".split(" "));

export type Logger = (line: string) => void;

function nowIso(now?: Date) { return (now ?? new Date()).toISOString(); }

export function actorFor(): { id: string; name: string } {
  return currentUser((id) => db().people.get(id)?.name);
}

/** Resolve "-7d", "-2w", "-1m" or a date to YYYY-MM-DD. */
export function relativeDate(v: unknown, now = new Date()): string | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const m = s.match(/^([+-]?\d+)\s*(d|w|m|y|h)$/i);
  if (m) {
    const n = Number(m[1]);
    const d = new Date(now);
    const u = m[2].toLowerCase();
    if (u === "d") d.setDate(d.getDate() + n); else if (u === "w") d.setDate(d.getDate() + n * 7); else if (u === "m") d.setMonth(d.getMonth() + n); else if (u === "y") d.setFullYear(d.getFullYear() + n); else d.setHours(d.getHours() + n);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

export function docDate(doc: Pick<IntelDocument, "dates" | "fetchedAt">): string | undefined {
  return primaryDate(doc.dates) ?? undefined;
}

/** Compact row for a document (what queries and insights return). */
export function docRow(doc: IntelDocument) {
  return { id: doc.id, kind: doc.kind, title: doc.title, caseName: doc.caseName, citation: doc.citation, docketNumber: doc.docketNumber, court: doc.court, courtId: doc.courtId, jurisdiction: doc.jurisdiction, date: docDate(doc) ?? null, url: doc.url ?? null, confidence: doc.confidence, flags: doc.flags.map((f) => f.kind), matterIds: doc.matterIds, sourceId: doc.sourceId, adapter: doc.adapter, summary: (doc.summary ?? "").slice(0, 240), agencies: doc.agencies, tags: doc.tags, updatedAt: doc.updatedAt };
}

function provenanceSourceFor(doc: IntelDocument): ProvenanceSource {
  const kind: ProvenanceSource["kind"] = doc.kind === "opinion" ? "case-law" : doc.kind === "docket" || doc.kind === "docket_entry" ? "docket" : doc.kind === "regulation" || doc.kind === "register_notice" || doc.kind === "recall" || doc.kind === "statute" ? "regulation" : doc.kind === "news" || doc.kind === "web_page" ? "web" : "internal";
  return { kind, id: doc.id, cite: doc.citation ?? doc.docketNumber, url: doc.url, title: doc.title };
}

function evidenceFor(doc: IntelDocument, quote?: string): IntelEvidence {
  return { docId: doc.id, quote: (quote ?? doc.summary ?? doc.title).slice(0, 300), url: doc.url, href: `/intel/documents/${doc.id}` };
}

// ─────────────────────────── Sources ───────────────────────────

export interface FetchSourceInput {
  sourceId?: string;
  adapter?: string;
  config?: Record<string, unknown> | string;
  /** Name for an ad-hoc source (node label). */
  name?: string;
  mode?: "run" | "enqueue";
  maxDocs?: number;
  since?: string;
  signal?: AbortSignal;
  log?: Logger;
  now?: Date;
}

export interface FetchSourceResult { jobId: string; status: string; sourceId: string; sourceName: string; added: number; updated: number; skipped: number; docIds: string[]; errors: { code: string; message: string }[]; notes: string[]; durationMs?: number }

function parseConfig(raw: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") { const t = raw.trim(); if (!t) return {}; try { const p = JSON.parse(t); return p && typeof p === "object" ? (p as Record<string, unknown>) : {}; } catch { throw new Error("Adapter configuration is not valid JSON"); } }
  return raw;
}

/** Find or create the manual source an ad-hoc adapter step runs through. */
export function sourceForAdapter(adapter: string, config: Record<string, unknown>, name: string, now = new Date()): IntelSource {
  const wanted = `Workflow: ${name}`.slice(0, 120);
  const existing = intelSources().findOne((s) => s.adapter === adapter && s.name === wanted);
  if (existing) {
    if (JSON.stringify(existing.config) !== JSON.stringify({ ...existing.config, ...config })) intelSources().update(existing.id, (s) => ({ ...s, config: { ...s.config, ...config }, updatedAt: nowIso(now) }));
    return intelSources().get(existing.id)!;
  }
  try {
    return createSource({ adapter: adapter as IntelAdapterId, name: wanted, description: "Created by a workflow step; runs only when the workflow does.", config, schedule: { every: "manual" }, enabled: true }, now);
  } catch (e) {
    if (e instanceof IntelServiceError) throw new Error(e.message);
    throw e;
  }
}

export async function fetchSource(input: FetchSourceInput): Promise<FetchSourceResult> {
  const now = input.now ?? new Date();
  let source: IntelSource | null = null;
  if (input.sourceId) {
    source = getSource(input.sourceId);
    if (!source) throw new Error(`Intelligence source not found: ${input.sourceId}`);
  } else if (input.adapter) {
    const config = validateConfig(input.adapter, parseConfig(input.config));
    source = sourceForAdapter(input.adapter, config, input.name ?? input.adapter, now);
  } else throw new Error("intel.fetch needs a source id or an adapter.");
  const payload: Record<string, unknown> = { trigger: "workflow", force: true };
  if (input.maxDocs) payload.maxDocs = input.maxDocs;
  const since = relativeDate(input.since, now);
  if (since) payload.since = since;
  const job = enqueueJob({ kind: "source.run", sourceId: source.id, payload, priority: 1, dedupeKey: `source.run:${source.id}` }, now);
  const summary = (j: typeof job): FetchSourceResult => {
    const r = (j.result ?? {}) as Record<string, unknown>;
    return { jobId: j.id, status: j.status, sourceId: source!.id, sourceName: source!.name, added: Number(r.added ?? 0), updated: Number(r.updated ?? 0), skipped: Number(r.skipped ?? 0), docIds: Array.isArray(r.docIds) ? (r.docIds as string[]) : [], errors: [...(Array.isArray(r.errors) ? (r.errors as { code: string; message: string }[]) : []), ...(j.error ? [j.error] : [])].map((e) => ({ code: e.code, message: e.message })), notes: Array.isArray(r.notes) ? (r.notes as string[]) : [], durationMs: typeof r.durationMs === "number" ? r.durationMs : undefined };
  };
  if (input.mode === "enqueue") { input.log?.(`Queued ${source.name} (${job.id})`); return summary(job); }
  if (job.status === "running") { input.log?.(`${source.name} is already running (${job.id}); not waiting`); return summary(job); }
  const claimed = claimJob(job.id, `workflow_${process.pid}`, now);
  if (!claimed) return summary(getJob(job.id) ?? job);
  input.log?.(`Running ${source.name} (${source.adapter})…`);
  const log = (line: IntelJobLogLine) => { if (line.level !== "debug") input.log?.(line.msg); };
  void log;
  const done = await executeJob(claimed, { signal: input.signal, now });
  const res = summary(done);
  input.log?.(`${source.name}: ${res.status} — ${res.added} added, ${res.updated} updated, ${res.skipped} skipped${res.errors.length ? `, ${res.errors.length} error(s)` : ""}`);
  return res;
}

// ─────────────────────────── Extraction ───────────────────────────

function uploadsSource(now = new Date()): IntelSource {
  const existing = intelSources().get(UPLOADS_SOURCE_ID);
  if (existing) return existing;
  const ts = nowIso(now);
  const src: IntelSource = { id: UPLOADS_SOURCE_ID, adapter: "local-corpus", name: "Workflow uploads", description: "Files uploaded through workflow front ends and extracted by intel.extract.", config: { dirs: [] }, schedule: { every: "manual" }, enabled: false, status: "disabled", health: { ok: true, consecutiveFailures: 0 }, stats: { documents: 0, chunks: 0, entities: 0, lastAdded: 0 }, system: true, createdAt: ts, updatedAt: ts };
  intelSources().put(src);
  return src;
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Two to four sentences, factual, no filler" },
    dates: { type: "object", properties: { filed: { type: "string" }, decided: { type: "string" }, published: { type: "string" }, effective: { type: "string" }, event: { type: "string" } }, required: [] },
    entities: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ENTITY_TYPES }, name: { type: "string" }, role: { type: "string" } }, required: ["type", "name"] } },
    confidence: { type: "number", description: "0..1 that the summary and entities are accurate" },
  },
  required: ["summary", "entities", "confidence"],
};

function extractiveSummary(text: string, max = 600): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim();
}

export interface ExtractInput { docIds?: string[]; blobIds?: string[]; summarize?: boolean; entities?: boolean; maxDocs?: number; useModel?: boolean; fast?: boolean; matterId?: string; signal?: AbortSignal; log?: Logger; now?: Date; tags?: string[] }
export interface ExtractResult { docs: number; summarized: number; entitiesFound: number; flagged: number; docIds: string[]; texts: { id: string; title: string; kind: IntelDocumentKind; text: string }[]; uploaded: string[] }

export async function extractDocuments(input: ExtractInput): Promise<ExtractResult> {
  const now = input.now ?? new Date();
  const ids = [...(input.docIds ?? [])];
  const uploaded: string[] = [];
  for (const blobId of input.blobIds ?? []) {
    const b = db().blobs.get(blobId);
    if (!b) { input.log?.(`Upload ${blobId} not found`); continue; }
    const src = uploadsSource(now);
    let text = "";
    try { text = (await extractIntelText(b.bytes, b.name, b.mime)).text; } catch (e) { input.log?.(`Could not extract ${b.name ?? blobId}: ${(e as Error).message}`); continue; }
    if (!text.trim()) { input.log?.(`No text in ${b.name ?? blobId}`); continue; }
    const r = await ingestDocument({ sourceId: src.id, adapter: "local-corpus", kind: "local_file", title: b.name ?? blobId, dates: { modified: b.createdAt.slice(0, 10) }, externalId: `blob:${blobId}`, text, matterIds: input.matterId ? [input.matterId] : [], tags: ["upload", "workflow", ...(input.tags ?? [])], meta: { blobId, mime: b.mime, size: b.size }, confidence: 0.9 }, { embed: aiConfig().hasKey, now });
    ids.push(r.doc.id);
    uploaded.push(r.doc.id);
  }
  const max = Math.max(1, input.maxDocs ?? 25);
  const useModel = (input.useModel ?? true) && aiConfig().hasKey && (input.summarize !== false || input.entities !== false);
  let summarized = 0, entitiesFound = 0, flagged = 0;
  const texts: ExtractResult["texts"] = [];
  const done: string[] = [];
  for (const id of ids.slice(0, max)) {
    if (input.signal?.aborted) break;
    const doc = getDocument(id);
    if (!doc) { input.log?.(`Document ${id} not found`); continue; }
    const text = getDocumentText(id) ?? "";
    const meta = { ...(doc.meta ?? {}) } as Record<string, unknown>;
    const existing = Array.isArray(meta.entities) ? (meta.entities as IntelEntityMention[]) : [];
    let mentions = input.entities === false ? existing : dedupeMentions([...existing, ...mentionsFromCaption(doc.caseName), ...mentionsFromJudgeField(typeof meta.judge === "string" ? meta.judge : typeof meta.assignedTo === "string" ? meta.assignedTo : undefined), courtMention(doc.court, doc.courtId)]);
    let summary = doc.summary;
    let dates = doc.dates;
    let confidence = doc.confidence;
    if (useModel && text.trim()) {
      try {
        const j = await generateJSON<{ summary: string; dates?: Record<string, string>; entities: { type: IntelEntityType; name: string; role?: string }[]; confidence: number }>({ instructions: "You extract metadata from legal and regulatory documents for a litigation firm's intelligence store. Summarize factually; list the judges, attorneys, firms, parties, courts, MDLs, products, agencies, regulations and statutes actually named; normalize dates to YYYY-MM-DD; never guess.", input: `TITLE: ${doc.title}\nKIND: ${doc.kind}\n\nTEXT:\n"""\n${text.slice(0, 40_000)}\n"""`, schema: EXTRACT_SCHEMA, fast: input.fast !== false, signal: input.signal });
        if (input.summarize !== false && j.summary?.trim()) { summary = j.summary.trim().slice(0, 800); summarized++; }
        if (input.entities !== false && Array.isArray(j.entities)) mentions = dedupeMentions([...mentions, ...j.entities.filter((e) => e && ENTITY_TYPES.includes(e.type) && e.name).map((e) => ({ type: e.type, name: e.name, role: e.role }))]);
        const fresh: Record<string, string> = {};
        for (const [k, v] of Object.entries(j.dates ?? {})) if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) fresh[k] = v;
        dates = { ...fresh, ...doc.dates };
        confidence = Math.max(0, Math.min(1, Number(j.confidence) || confidence));
      } catch (e) {
        input.log?.(`Model extraction failed for ${doc.id}: ${(e as Error).message}; keeping the deterministic pass`);
      }
    } else if (input.summarize !== false && !summary && text.trim()) { summary = extractiveSummary(text); summarized++; }
    entitiesFound += mentions.length;
    intelDocuments().update(doc.id, (cur) => ({ ...cur, summary, dates, confidence, meta: { ...(cur.meta ?? {}), entities: mentions, extractedAt: nowIso(now) }, updatedAt: nowIso(now) }));
    if (confidence < 0.6 && !doc.flags.some((f) => f.kind === "low_confidence")) { flagDocument(doc.id, { kind: "low_confidence", note: `extraction confidence ${confidence.toFixed(2)}`, by: "workflow:intel.extract" }); flagged++; }
    texts.push({ id: doc.id, title: doc.title, kind: doc.kind, text: text.slice(0, 4000) });
    done.push(doc.id);
  }
  return { docs: done.length, summarized, entitiesFound, flagged, docIds: done, texts, uploaded };
}

// ─────────────────────────── Indexing ───────────────────────────

export async function indexDocs(input: { docIds?: string[]; embed?: boolean; chunkSize?: number; limit?: number; log?: Logger; signal?: AbortSignal }): Promise<{ docs: number; chunks: number; embedded: number; docIds: string[] }> {
  const ids = input.docIds ?? [];
  const embed = input.embed !== false && aiConfig().hasKey;
  if (!ids.length) {
    const r = await reindexMissingEmbeddings(input.limit ?? 25, { chunkSize: input.chunkSize });
    input.log?.(embed ? `Re-embedded ${r.chunks} chunk(s) of ${r.docs} document(s)` : "No API key: nothing to re-embed");
    return { ...r, docIds: [] };
  }
  let chunks = 0, embedded = 0; const done: string[] = [];
  for (const id of ids) {
    if (input.signal?.aborted) break;
    const doc = getDocument(id);
    if (!doc) continue;
    const r = await indexIntelDocument(doc, undefined, { size: input.chunkSize, embed });
    chunks += r.chunks; embedded += r.embedded; done.push(id);
  }
  input.log?.(`Indexed ${done.length} document(s): ${chunks} chunk(s), ${embedded} embedded`);
  return { docs: done.length, chunks, embedded, docIds: done };
}

// ─────────────────────────── Entities and relations ───────────────────────────

function relationId(from: string, to: string, type: IntelRelationType) { return `irel_${sha256(`${from}|${to}|${type}`).slice(0, 16)}`; }

export function upsertRelation(from: string, to: string, type: IntelRelationType, docId: string, now = new Date()): IntelRelation {
  const id = relationId(from, to, type);
  const ts = nowIso(now);
  const cur = intelRelations().get(id);
  const evidence = [...(cur?.evidence ?? [])];
  const seen = evidence.some((e) => e.docId === docId);
  if (!seen) evidence.push({ docId });
  const rel: IntelRelation = { id, from, to, type, evidence: evidence.slice(-40), confidence: Math.min(0.95, 0.5 + 0.1 * evidence.length), firstSeen: cur?.firstSeen ?? ts, lastSeen: ts, weight: seen ? cur!.weight : (cur?.weight ?? 0) + 1 };
  intelRelations().put(rel);
  return rel;
}

export interface LinkEntitiesResult { docs: number; entities: number; relations: number; entityIds: string[]; byType: Record<string, number> }

export function linkEntities(input: { docIds: string[]; relations?: boolean; log?: Logger; now?: Date; signal?: AbortSignal }): LinkEntitiesResult {
  const now = input.now ?? new Date();
  const all = new Set<string>();
  const byType: Record<string, number> = {};
  let relations = 0, docs = 0;
  for (const id of input.docIds) {
    if (input.signal?.aborted) break;
    const doc = getDocument(id);
    if (!doc) continue;
    const mentions = Array.isArray(doc.meta?.entities) ? (doc.meta!.entities as IntelEntityMention[]).filter((m) => m && m.name && ENTITY_TYPES.includes(m.type)).slice(0, 24) : [];
    if (!mentions.length) { docs++; continue; }
    const linked: { id: string; type: IntelEntityType; role?: string }[] = [];
    for (const m of mentions) {
      const entity = upsertEntity({ type: m.type, name: m.name, docId: doc.id, externalIds: m.externalId ? { [doc.adapter]: m.externalId } : undefined, attributes: m.role ? { role: m.role } : undefined, source: { docId: doc.id } }, nowIso(now));
      linked.push({ id: entity.id, type: entity.type, role: m.role });
      all.add(entity.id);
      byType[entity.type] = (byType[entity.type] ?? 0) + 1;
    }
    const of = (t: IntelEntityType) => linked.filter((l) => l.type === t).map((l) => l.id);
    intelDocuments().update(doc.id, (cur) => ({
      ...cur,
      judgeIds: uniq([...cur.judgeIds, ...of("judge")]),
      attorneyIds: uniq([...cur.attorneyIds, ...of("attorney")]),
      firmIds: uniq([...cur.firmIds, ...of("firm")]),
      partyIds: uniq([...cur.partyIds, ...of("party")]),
      productIds: uniq([...cur.productIds, ...of("product")]),
      mdlId: cur.mdlId ?? of("mdl")[0],
      agencies: uniq([...cur.agencies, ...mentions.filter((m) => m.type === "agency").map((m) => m.name)]),
      meta: { ...(cur.meta ?? {}), entityIds: uniq(linked.map((l) => l.id)), linkedAt: nowIso(now) },
      updatedAt: nowIso(now),
    }));
    if (input.relations !== false) {
      const judges = of("judge"), courts = of("court"), attorneys = of("attorney"), firms = of("firm"), parties = of("party"), mdls = of("mdl");
      for (const j of judges) for (const c of courts) { upsertRelation(j, c, "presides", doc.id, now); relations++; }
      for (const j of judges) for (const m of mdls) { upsertRelation(j, m, "presides", doc.id, now); relations++; }
      for (const a of attorneys) for (const f of firms) { upsertRelation(a, f, "member_of", doc.id, now); relations++; }
      for (const a of attorneys) for (const j of judges) { upsertRelation(a, j, "before_judge", doc.id, now); relations++; }
      for (const a of attorneys) for (const p of parties) { upsertRelation(a, p, "represents", doc.id, now); relations++; }
      for (let i = 0; i < attorneys.length; i++) for (let k = i + 1; k < attorneys.length; k++) { upsertRelation(attorneys[i], attorneys[k], "co_counsel", doc.id, now); relations++; }
      for (const p of parties) for (const m of mdls) { upsertRelation(p, m, "appears_in", doc.id, now); relations++; }
    }
    docs++;
  }
  input.log?.(`Linked ${all.size} entit${all.size === 1 ? "y" : "ies"} across ${docs} document(s)${input.relations !== false ? `, ${relations} relation(s)` : ""}`);
  return { docs, entities: all.size, relations, entityIds: Array.from(all), byType };
}

function uniq(list: (string | undefined | null)[]): string[] { return Array.from(new Set(list.filter((x): x is string => Boolean(x)))); }

// ─────────────────────────── Analysis ───────────────────────────

export type AnalysisKind = "trends" | "clusters" | "chronology" | "profiles" | "graph";
export interface AnalysisScope { matterId?: string; kinds?: IntelDocumentKind[]; entityIds?: string[]; court?: string; jurisdiction?: string; dateFrom?: string; dateTo?: string; q?: string }
export interface AnalysisActor { workflowId: string; workflowName: string; runId: string; nodeId: string; nodeLabel: string; href: string; userId?: string }
export interface AnalysisRequest { analysis: AnalysisKind; scope: AnalysisScope; title?: string; maxDocs?: number; actor: AnalysisActor; now: Date; signal?: AbortSignal; log?: Logger }
export interface AnalysisResult { analysis: AnalysisKind; insightIds: string[]; insights: Pick<IntelInsight, "id" | "kind" | "title" | "summary" | "confidence" | "status">[]; data: Record<string, unknown>; docCount: number; text: string }
export type IntelAnalysisProvider = (req: AnalysisRequest) => Promise<AnalysisResult>;

type G = typeof globalThis & { __leclaudeWorkflowAnalysisProvider?: IntelAnalysisProvider; __leclaudeWorkflowUserContextProvider?: UserContextProvider };

/** The analysis module (src/modules/intel/analysis) registers its implementation here; the built-in provider stays the fallback. */
export function setIntelAnalysisProvider(p: IntelAnalysisProvider | null) { (globalThis as G).__leclaudeWorkflowAnalysisProvider = p ?? undefined; }
export function getIntelAnalysisProvider(): IntelAnalysisProvider { return (globalThis as G).__leclaudeWorkflowAnalysisProvider ?? builtInAnalysis; }

export function scopeDocuments(scope: AnalysisScope, maxDocs = 400, now = new Date()): IntelDocument[] {
  const o: ListDocumentsOptions = { kinds: scope.kinds?.length ? scope.kinds : undefined, matterId: scope.matterId || undefined, court: scope.court || undefined, jurisdiction: scope.jurisdiction || undefined, q: scope.q || undefined, dateFrom: relativeDate(scope.dateFrom, now), dateTo: relativeDate(scope.dateTo, now), entityId: scope.entityIds?.[0], sort: "date", direction: "desc", limit: Math.min(500, Math.max(10, maxDocs)) };
  let docs = listDocuments(o).items;
  if (scope.entityIds && scope.entityIds.length > 1) { const set = new Set(scope.entityIds); docs = listDocuments({ ...o, entityId: undefined }).items.filter((d) => entityIdsOf(d).some((id) => set.has(id)) || (Array.isArray(d.meta?.entityIds) && (d.meta!.entityIds as string[]).some((id) => set.has(id)))); }
  return docs;
}

function monthOf(date: string | undefined): string | undefined { return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : undefined; }
function topN(counts: Map<string, number>, n: number) { return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n); }
function terms(text: string): string[] { return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)); }

function confidenceFor(docs: number): number { return docs >= 50 ? 0.9 : docs >= 10 ? 0.8 : docs >= 3 ? 0.65 : docs > 0 ? 0.5 : 0.2; }

function insightKey(kind: IntelInsightKind, scope: IntelInsight["scope"], title: string) { return sha256(`${kind}|${JSON.stringify(scope)}|${title}`).slice(0, 20); }

export function recordInsight(input: { kind: IntelInsightKind; scope: IntelInsight["scope"]; title: string; summary: string; data: Record<string, unknown>; evidence: IntelEvidence[]; sources: ProvenanceSource[]; confidence: number; actor: AnalysisActor; now: Date; flags?: IntelInsight["flags"]; model?: string }): IntelInsight {
  const at = nowIso(input.now);
  const key = insightKey(input.kind, input.scope, input.title);
  const existing = intelInsights().findOne((i) => i.data?.key === key && i.status !== "dismissed");
  const provenance: Provenance = makeProvenance({ surface: "workflow.intel.analyze", model: input.model ?? "deterministic", sources: input.sources.slice(0, 40), confidence: input.confidence, instructions: `${input.actor.workflowName} › ${input.actor.nodeLabel}`, input: JSON.stringify(input.scope) });
  const flags = [...(input.flags ?? [])];
  if (input.confidence < 0.6) flags.push({ kind: "low_confidence", note: `coverage confidence ${input.confidence.toFixed(2)}`, at, by: "workflow:intel.analyze" });
  const insight: IntelInsight = {
    id: existing?.id ?? `iins_${nanoid(12)}`,
    kind: input.kind,
    scope: input.scope,
    title: input.title.slice(0, 200),
    summary: input.summary.slice(0, 4000),
    data: { ...input.data, key, run: { workflowId: input.actor.workflowId, runId: input.actor.runId, nodeId: input.actor.nodeId, href: input.actor.href } },
    evidence: input.evidence.slice(0, 60),
    provenance,
    confidence: input.confidence,
    status: existing && existing.status === "published" ? "published" : "draft",
    flags,
    score: Math.round(input.confidence * 100) / 100,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  intelInsights().put(insight);
  audit("ai.generate", { kind: "intel.insight", id: insight.id, label: insight.title, matterId: insight.scope.matterId }, { surface: provenance.surface, model: provenance.model, kind: insight.kind, confidence: insight.confidence, evidence: insight.evidence.length, runId: input.actor.runId, nodeId: input.actor.nodeId, updated: Boolean(existing) }, input.actor.userId ? { id: input.actor.userId, name: db().people.get(input.actor.userId)?.name ?? input.actor.userId } : undefined);
  return insight;
}

function scopeLabel(scope: AnalysisScope): string {
  const parts: string[] = [];
  if (scope.matterId) parts.push(db().matters.get(scope.matterId)?.shortName ?? scope.matterId);
  if (scope.kinds?.length) parts.push(scope.kinds.map((k) => k.replace(/_/g, " ")).join(", "));
  if (scope.court) parts.push(scope.court);
  if (scope.jurisdiction) parts.push(scope.jurisdiction);
  if (scope.q) parts.push(`"${scope.q}"`);
  if (scope.dateFrom || scope.dateTo) parts.push(`${scope.dateFrom ?? "…"} → ${scope.dateTo ?? "now"}`);
  return parts.join(" · ") || "all documents";
}

function insightScope(scope: AnalysisScope, entityIds: string[] = [], now: Date): IntelInsight["scope"] {
  const from = relativeDate(scope.dateFrom, now), to = relativeDate(scope.dateTo, now);
  return { matterId: scope.matterId || undefined, entityIds, court: scope.court || undefined, jurisdiction: scope.jurisdiction || undefined, period: from || to ? { from: from ?? "", to: to ?? nowIso(now).slice(0, 10) } : undefined };
}

const builtInAnalysis: IntelAnalysisProvider = async (req) => {
  const docs = scopeDocuments(req.scope, req.maxDocs, req.now);
  const label = scopeLabel(req.scope);
  const base = { actor: req.actor, now: req.now };
  const brief = (list: IntelDocument[]) => list.slice(0, 12).map((d) => evidenceFor(d));
  const sources = (list: IntelDocument[]) => list.slice(0, 40).map(provenanceSourceFor);
  req.log?.(`${docs.length} document(s) in scope (${label})`);

  if (req.analysis === "trends") {
    const months = new Map<string, number>(); const byKind = new Map<string, Map<string, number>>(); const byCourt = new Map<string, number>(); const kindTotals = new Map<string, number>();
    for (const d of docs) {
      const m = monthOf(docDate(d)); if (!m) continue;
      months.set(m, (months.get(m) ?? 0) + 1);
      kindTotals.set(d.kind, (kindTotals.get(d.kind) ?? 0) + 1);
      if (!byKind.has(d.kind)) byKind.set(d.kind, new Map()); byKind.get(d.kind)!.set(m, (byKind.get(d.kind)!.get(m) ?? 0) + 1);
      const court = d.court ?? d.courtId; if (court) byCourt.set(court, (byCourt.get(court) ?? 0) + 1);
    }
    const monthKeys = Array.from(months.keys()).sort();
    const values = monthKeys.map((m) => months.get(m) ?? 0);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const sd = values.length > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)) : 0;
    const anomalies = monthKeys.map((m, i) => ({ month: m, value: values[i], z: sd > 0 ? Number(((values[i] - mean) / sd).toFixed(2)) : 0 })).filter((a) => values.length >= 4 && Math.abs(a.z) >= 2);
    const series: IntelSeries[] = [{ label: "All documents", points: monthKeys.map((m) => ({ t: m, v: months.get(m) ?? 0 })) }, ...topN(kindTotals, 5).map(([k]) => ({ label: k.replace(/_/g, " "), points: monthKeys.map((m) => ({ t: m, v: byKind.get(k)?.get(m) ?? 0 })) }))];
    const busiest = topN(months, 1)[0];
    const summary = docs.length
      ? `${docs.length} documents (${label}) between ${monthKeys[0] ?? "?"} and ${monthKeys[monthKeys.length - 1] ?? "?"}; busiest month ${busiest?.[0] ?? "n/a"} (${busiest?.[1] ?? 0}). By kind: ${topN(kindTotals, 5).map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`).join(", ")}${byCourt.size ? `. Courts: ${topN(byCourt, 4).map(([c, n]) => `${c} ${n}`).join(", ")}` : ""}${anomalies.length ? `. Anomalies: ${anomalies.map((a) => `${a.month} (${a.value}, z=${a.z})`).join(", ")}` : ". No anomalous months."}`
      : `No documents in scope (${label}).`;
    const anomalyDocs = docs.filter((d) => anomalies.some((a) => monthOf(docDate(d)) === a.month));
    const insight = recordInsight({ ...base, kind: anomalies.length ? "anomaly" : "trend", scope: insightScope(req.scope, req.scope.entityIds ?? [], req.now), title: req.title || `Trends — ${label}`, summary, data: { series, months: monthKeys, anomalies, byKind: Object.fromEntries(kindTotals), byCourt: Object.fromEntries(byCourt), docCount: docs.length }, evidence: brief([...anomalyDocs, ...docs]), sources: sources(docs), confidence: confidenceFor(docs.length) });
    return { analysis: "trends", insightIds: [insight.id], insights: [pick(insight)], data: insight.data, docCount: docs.length, text: summary };
  }

  if (req.analysis === "clusters") {
    const groups = new Map<string, IntelDocument[]>();
    for (const d of docs) { const k = `${d.kind}|${d.court ?? d.courtId ?? d.agencies[0] ?? d.jurisdiction ?? "general"}`; groups.set(k, [...(groups.get(k) ?? []), d]); }
    const clusters = Array.from(groups.entries()).map(([k, list]) => {
      const tf = new Map<string, number>();
      for (const d of list) for (const w of terms(`${d.title} ${d.summary ?? ""}`)) tf.set(w, (tf.get(w) ?? 0) + 1);
      const [kind, where] = k.split("|");
      const top = topN(tf, 4).map(([w]) => w);
      return { id: `c_${sha256(k).slice(0, 8)}`, label: `${kind.replace(/_/g, " ")} · ${where}${top.length ? ` — ${top.join(", ")}` : ""}`, kind, where, size: list.length, terms: top, docIds: list.slice(0, 20).map((d) => d.id) };
    }).sort((a, b) => b.size - a.size);
    const summary = docs.length ? `${clusters.length} cluster(s) over ${docs.length} documents (${label}). Largest: ${clusters.slice(0, 5).map((c) => `${c.label} (${c.size})`).join("; ")}.` : `No documents in scope (${label}).`;
    const insight = recordInsight({ ...base, kind: "cluster", scope: insightScope(req.scope, req.scope.entityIds ?? [], req.now), title: req.title || `Clusters — ${label}`, summary, data: { clusters, docCount: docs.length }, evidence: brief(docs), sources: sources(docs), confidence: confidenceFor(docs.length) });
    return { analysis: "clusters", insightIds: [insight.id], insights: [pick(insight)], data: insight.data, docCount: docs.length, text: summary };
  }

  if (req.analysis === "chronology") {
    const entries: (IntelTimelineEntry & { key: string })[] = [];
    for (const d of docs) { const at = docDate(d); if (!at) continue; entries.push({ at, title: d.title, detail: (d.summary ?? "").slice(0, 240) || undefined, kind: d.kind, evidence: [evidenceFor(d)], confidence: d.confidence, key: `${at}|${d.title}` }); }
    if (req.scope.matterId) {
      const existing = entries.map((e) => ({ id: e.key, date: e.at, title: e.title }));
      for (const t of db().timeline.find((e) => e.matterId === req.scope.matterId)) {
        if (findNearDuplicateEvent(existing, { date: t.date, title: t.title })) continue;
        entries.push({ at: t.date, title: t.title, detail: t.description?.slice(0, 240), kind: `timeline:${t.category}`, evidence: [{ docId: `timeline:${t.id}`, quote: t.sources[0]?.excerpt?.slice(0, 200), href: `/ediscovery?matter=${req.scope.matterId}&tab=timeline` }], confidence: t.verified ? 0.9 : 0.6, key: `${t.date}|${t.title}` });
      }
    }
    entries.sort((a, b) => a.at.localeCompare(b.at));
    const timeline: IntelTimelineEntry[] = entries.map(({ key, ...rest }) => { void key; return rest; });
    const summary = timeline.length ? `${timeline.length} dated events (${label}) from ${timeline[0].at} to ${timeline[timeline.length - 1].at}. First: ${timeline[0].title}. Latest: ${timeline[timeline.length - 1].title}.` : `No dated documents in scope (${label}).`;
    const insight = recordInsight({ ...base, kind: "chronology", scope: insightScope(req.scope, req.scope.entityIds ?? [], req.now), title: req.title || `Chronology — ${label}`, summary, data: { timeline, docCount: docs.length }, evidence: timeline.flatMap((t) => t.evidence).filter((e) => !e.docId.startsWith("timeline:")).slice(0, 60), sources: sources(docs), confidence: confidenceFor(timeline.length) });
    return { analysis: "chronology", insightIds: [insight.id], insights: [pick(insight)], data: insight.data, docCount: docs.length, text: summary };
  }

  if (req.analysis === "profiles") {
    const ids = req.scope.entityIds?.length ? req.scope.entityIds : topEntityIds(docs, 8);
    const insights: IntelInsight[] = [];
    const profiles: Record<string, unknown>[] = [];
    for (const id of ids) {
      const e = intelEntities().get(id);
      if (!e) continue;
      const edocs = listDocuments({ entityId: id, limit: 200, sort: "date", direction: "desc" }).items;
      const byKind = new Map<string, number>(); const courts = new Map<string, number>();
      for (const d of edocs) { byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1); const c = d.court ?? d.courtId; if (c) courts.set(c, (courts.get(c) ?? 0) + 1); }
      const dates = edocs.map(docDate).filter((x): x is string => Boolean(x)).sort();
      const rels = intelRelations().find((r) => r.from === id || r.to === id).sort((a, b) => b.weight - a.weight).slice(0, 8).map((r) => { const otherId = r.from === id ? r.to : r.from; const other = intelEntities().get(otherId); return { id: otherId, name: other?.name ?? otherId, type: other?.type, relation: r.type, weight: r.weight }; });
      const profile = { id: e.id, type: e.type, name: e.name, attributes: e.attributes, mentionCount: e.mentionCount, docCount: edocs.length, byKind: Object.fromEntries(byKind), courts: topN(courts, 5).map(([c, n]) => ({ court: c, count: n })), firstSeen: dates[0], lastSeen: dates[dates.length - 1], related: rels, recentDocs: edocs.slice(0, 5).map(docRow), flags: (e.flags ?? []).map((f) => f.kind) };
      profiles.push(profile);
      const summary = `${e.name} (${e.type}): ${edocs.length} linked document(s)${byKind.size ? ` — ${topN(byKind, 4).map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`).join(", ")}` : ""}${courts.size ? `; courts: ${topN(courts, 3).map(([c]) => c).join(", ")}` : ""}${dates.length ? `; activity ${dates[0]} → ${dates[dates.length - 1]}` : ""}${rels.length ? `; related: ${rels.slice(0, 4).map((r) => `${r.name} (${r.relation})`).join(", ")}` : ""}.`;
      insights.push(recordInsight({ ...base, kind: "profile", scope: { ...insightScope(req.scope, [e.id], req.now) }, title: req.title && ids.length === 1 ? req.title : `Profile — ${e.name}`, summary, data: { profile }, evidence: brief(edocs), sources: sources(edocs), confidence: confidenceFor(edocs.length), flags: e.flags }));
    }
    const text = insights.length ? insights.map((i) => `- ${i.summary}`).join("\n") : `No entities found for ${label}.`;
    return { analysis: "profiles", insightIds: insights.map((i) => i.id), insights: insights.map(pick), data: { profiles }, docCount: docs.length, text };
  }

  // graph
  const counts = new Map<string, number>();
  for (const d of docs) for (const id of [...entityIdsOf(d), ...(Array.isArray(d.meta?.entityIds) ? (d.meta!.entityIds as string[]) : [])]) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of req.scope.entityIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const nodeIds = topN(counts, 60).map(([id]) => id);
  const set = new Set(nodeIds);
  const nodes = nodeIds.map((id) => intelEntities().get(id)).filter((e): e is IntelEntity => Boolean(e)).map((e) => ({ id: e.id, type: e.type, name: e.name, mentions: e.mentionCount, docs: counts.get(e.id) ?? 0 }));
  let edges = intelRelations().find((r) => set.has(r.from) && set.has(r.to)).map((r) => ({ from: r.from, to: r.to, type: r.type, weight: r.weight }));
  if (!edges.length) {
    const co = new Map<string, number>();
    for (const d of docs) { const ids = uniq([...entityIdsOf(d), ...(Array.isArray(d.meta?.entityIds) ? (d.meta!.entityIds as string[]) : [])]).filter((id) => set.has(id)).sort(); for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) { const key = `${ids[i]}|${ids[k]}`; co.set(key, (co.get(key) ?? 0) + 1); } }
    edges = Array.from(co.entries()).map(([k, w]) => { const [from, to] = k.split("|"); return { from, to, type: "mentions" as IntelRelationType, weight: w }; });
  }
  const summary = nodes.length ? `${nodes.length} entities and ${edges.length} relation(s) across ${docs.length} documents (${label}). Most connected: ${nodes.slice(0, 5).map((n) => `${n.name} (${n.type})`).join(", ")}.` : `No linked entities in scope (${label}).`;
  const insight = recordInsight({ ...base, kind: "pattern", scope: insightScope(req.scope, nodeIds.slice(0, 20), req.now), title: req.title || `Knowledge graph — ${label}`, summary, data: { graph: { nodes, edges }, docCount: docs.length }, evidence: brief(docs), sources: sources(docs), confidence: confidenceFor(nodes.length) });
  return { analysis: "graph", insightIds: [insight.id], insights: [pick(insight)], data: insight.data, docCount: docs.length, text: summary };
};

function pick(i: IntelInsight) { return { id: i.id, kind: i.kind, title: i.title, summary: i.summary, confidence: i.confidence, status: i.status }; }

function topEntityIds(docs: IntelDocument[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const d of docs) for (const id of [...entityIdsOf(d), ...(Array.isArray(d.meta?.entityIds) ? (d.meta!.entityIds as string[]) : [])]) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ranked = topN(counts, n * 3).map(([id]) => intelEntities().get(id)).filter((e): e is IntelEntity => Boolean(e) && ["judge", "attorney", "firm", "mdl", "product", "agency", "court", "party"].includes(e!.type));
  return ranked.slice(0, n).map((e) => e.id);
}

export async function runAnalysis(req: AnalysisRequest): Promise<AnalysisResult> {
  return getIntelAnalysisProvider()(req);
}

// ─────────────────────────── Verification ───────────────────────────

export async function verifyInsightSet(input: { insightIds?: string[]; limit?: number; signal?: AbortSignal; log?: Logger; now?: Date }): Promise<{ checked: number; verified: number; flagged: number; skipped: number; reason?: string; insightIds: string[]; trusted: boolean }> {
  const ids = input.insightIds?.length
    ? input.insightIds.filter((id) => intelInsights().has(id))
    : intelInsights().find((i) => i.status === "verified" || i.status === "published" || i.status === "draft").sort((a, b) => (a.provenance.verification?.checkedAt ?? "").localeCompare(b.provenance.verification?.checkedAt ?? "")).slice(0, input.limit ?? 25).map((i) => i.id);
  if (!ids.length) return { checked: 0, verified: 0, flagged: 0, skipped: 0, insightIds: [], trusted: true };
  const r = await verifyInsights({ insightIds: ids, signal: input.signal, now: input.now, log: (l) => input.log?.(l.msg) });
  input.log?.(r.reason ? `Verification skipped (${r.reason}) for ${ids.length} insight(s)` : `${r.checked} checked: ${r.verified} verified, ${r.flagged} flagged`);
  return { ...r, insightIds: ids, trusted: r.flagged === 0 };
}

export async function integritySweep(input: { network?: boolean; limit?: number; signal?: AbortSignal; log?: Logger; now?: Date }): Promise<IntelSweepReport> {
  return sweep({ network: input.network ?? false, sampleSize: input.limit, signal: input.signal, now: input.now, log: (l) => input.log?.(l.msg) });
}

// ─────────────────────────── Publishing ───────────────────────────

export type PublishTarget = "home" | "matter" | "library" | "watch" | "digest";
export interface PublishInput {
  to: PublishTarget;
  insightIds?: string[];
  items?: unknown;
  title?: string;
  summary?: string;
  matterId?: string;
  userId?: string;
  recipientIds?: string[];
  libraryFolderId?: string;
  requireVerified?: boolean;
  actor: AnalysisActor;
  now?: Date;
  log?: Logger;
}
export interface PublishResult { to: PublishTarget; published: number; skipped: number; notified: string[]; insightIds: string[]; itemIds: string[]; updateIds: string[]; taskIds: string[]; href?: string }

function isVerified(i: IntelInsight) { return i.status === "verified" || i.provenance.verification?.status === "verified" || i.provenance.verification?.status === "partially-verified"; }

function alertFromItems(input: PublishInput, now: Date): IntelInsight | null {
  const rows = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]).filter((r) => r && typeof r === "object") : [];
  if (!rows.length) return null;
  const titleOf = (r: Record<string, unknown>) => String(r.title ?? r.caseName ?? r.name ?? r.subject ?? r.id ?? "record");
  const docIds = rows.map((r) => String(r.id ?? "")).filter((id) => id.startsWith("idoc_"));
  const evidence: IntelEvidence[] = docIds.slice(0, 40).map((id) => { const d = getDocument(id); return d ? evidenceFor(d) : { docId: id }; });
  const sources: ProvenanceSource[] = docIds.slice(0, 40).map((id) => { const d = getDocument(id); return d ? provenanceSourceFor(d) : { kind: "internal", id }; });
  const summary = (input.summary?.trim() || `${rows.length} record(s):\n${rows.slice(0, 12).map((r) => `- ${titleOf(r)}${r.date ? ` (${String(r.date)})` : ""}`).join("\n")}${rows.length > 12 ? `\n- … ${rows.length - 12} more` : ""}`).slice(0, 4000);
  return recordInsight({ kind: "alert", scope: { matterId: input.matterId || undefined, entityIds: [] }, title: (input.title?.trim() || `${rows.length} new record(s)`).slice(0, 200), summary, data: { table: rows.slice(0, 50), count: rows.length }, evidence, sources, confidence: docIds.length ? 0.85 : 0.7, actor: input.actor, now });
}

function notify(userIds: string[], message: string, href: string, actor: AnalysisActor, now: Date): { id: string }[] {
  const out: { id: string }[] = [];
  for (const userId of uniq(userIds)) {
    if (!db().people.has(userId)) continue;
    const notif = { id: `wn_${nanoid(10)}`, runId: actor.runId, workflowId: actor.workflowId, nodeId: actor.nodeId, channel: "in-app", recipientIds: [userId], message, href, createdAt: nowIso(now), read: false };
    db().collection<typeof notif>("workflow_notifications").put(notif);
    out.push({ id: notif.id });
  }
  return out;
}

export async function publishInsights(input: PublishInput): Promise<PublishResult> {
  const now = input.now ?? new Date();
  const at = nowIso(now);
  const result: PublishResult = { to: input.to, published: 0, skipped: 0, notified: [], insightIds: [], itemIds: [], updateIds: [], taskIds: [] };
  const alert = alertFromItems(input, now);
  const insights = [...(input.insightIds ?? []).map((id) => intelInsights().get(id)).filter((i): i is IntelInsight => Boolean(i)), ...(alert ? [alert] : [])];
  if (input.to === "digest") {
    const people = uniq([input.userId, ...(input.recipientIds ?? [])]);
    if (!people.length) throw new Error("A digest needs a person (userId) or recipients.");
    for (const userId of people) {
      const digest = await buildDigest(userId, { now, actor: input.actor, title: input.title, extraInsightIds: insights.map((i) => i.id) });
      if (!digest) { result.skipped++; continue; }
      result.published++; result.insightIds.push(digest.insight.id);
      const n = notify([userId], digest.insight.title, `/?insight=${digest.insight.id}`, input.actor, now);
      if (n.length) result.notified.push(userId);
    }
    result.href = "/";
    input.log?.(`Digest for ${result.notified.length} person(s)`);
    return result;
  }
  const eligible = insights.filter((i) => { if (input.requireVerified && !isVerified(i)) { result.skipped++; return false; } if (i.status === "dismissed" || i.flags.some((f) => f.kind === "contradicted")) { result.skipped++; return false; } return true; });
  if (input.to === "home" || input.to === "matter") {
    for (const i of eligible) {
      const scope = input.to === "matter" && input.matterId ? { ...i.scope, matterId: input.matterId } : i.scope;
      intelInsights().put({ ...i, scope, status: "published", updatedAt: at });
      result.published++; result.insightIds.push(i.id);
    }
    result.href = input.to === "matter" && input.matterId ? `/intel?matter=${input.matterId}` : "/";
    audit("update", { kind: "intel.insight", id: result.insightIds[0], label: `Published ${result.published} insight(s) to ${input.to}`, matterId: input.matterId }, { to: input.to, insightIds: result.insightIds, runId: input.actor.runId, nodeId: input.actor.nodeId });
    return result;
  }
  if (input.to === "library") {
    if (!eligible.length) return result;
    const parentId = input.libraryFolderId || (input.matterId ? matterFolderId(input.matterId) : KNOWLEDGE_SUBFOLDERS.research);
    const title = (input.title?.trim() || (eligible.length === 1 ? eligible[0].title : `Insights — ${input.actor.workflowName} — ${at.slice(0, 10)}`)).slice(0, 200);
    const body = [`# ${title}`, "", ...eligible.flatMap((i) => [`## ${i.title}`, "", i.summary, "", ...(i.evidence.length ? ["Evidence:", ...i.evidence.slice(0, 10).map((e) => `- ${e.href ?? e.url ?? e.docId}${e.quote ? ` — ${e.quote.slice(0, 160)}` : ""}`), ""] : []), `_Confidence ${(i.confidence * 100).toFixed(0)}% · ${i.provenance.verification?.status ?? "unverified"}_`, ""])].join("\n");
    const item: LibraryItem = { id: `lib_${nanoid(10)}`, parentId, name: title, type: "note", matterId: input.matterId || undefined, content: body.slice(0, 200_000), tags: ["insight", "workflow"], ownerId: WORKFLOW_CURRENT_USER.id, sharedWith: ["matter-team"], createdAt: at, updatedAt: at, description: `Published by workflow "${input.actor.workflowName}"`, status: "draft" };
    db().library.put(item);
    for (const i of eligible) { intelInsights().put({ ...i, status: "published", updatedAt: at }); result.insightIds.push(i.id); }
    result.published = eligible.length; result.itemIds.push(item.id); result.href = `/library?item=${item.id}`;
    for (const rid of input.recipientIds ?? []) { const n = notify([rid], `${title} is in the library`, result.href, input.actor, now); if (n.length) result.notified.push(rid); }
    return result;
  }
  // watch
  for (const i of eligible) {
    const entityIds = new Set(i.scope.entityIds ?? []);
    const text = `${i.title} ${i.summary}`.toLowerCase();
    const watchers: IntelWatch[] = intelWatches().find((w) => (w.kind !== "query" && entityIds.has(w.target)) || (w.kind === "query" && w.target.trim() && text.includes(w.target.trim().toLowerCase())) || (Boolean(w.matterId) && w.matterId === i.scope.matterId));
    intelInsights().put({ ...i, status: "published", data: { ...i.data, watchers: uniq(watchers.map((w) => w.userId)) }, updatedAt: at });
    result.published++; result.insightIds.push(i.id);
    for (const w of watchers) {
      const channels = w.channels.length ? w.channels : ["home"];
      if (channels.includes("home") || channels.includes("digest")) { const n = notify([w.userId], `${w.label}: ${i.title}`, `/?insight=${i.id}`, input.actor, now); if (n.length) result.notified.push(w.userId); }
      if (channels.includes("task")) {
        const title = `Review: ${i.title}`.slice(0, 200);
        const dup = findNearDuplicateTask(db().tasks.find((t) => t.status !== "done"), { title, matterId: i.scope.matterId });
        if (!dup) {
          const task: Task = { id: `t_${nanoid(10)}`, title, description: i.summary.slice(0, 2000), matterId: i.scope.matterId, assigneeId: w.userId, createdById: WORKFLOW_CURRENT_USER.id, status: "todo", priority: "medium", createdAt: at, updatedAt: at, tags: ["intel", "watch"], source: "workflow", links: [{ label: `Run · ${input.actor.workflowName}`, href: input.actor.href }] };
          db().tasks.put(task); result.taskIds.push(task.id);
        }
      }
      intelWatches().update(w.id, (cur) => ({ ...cur, lastNotifiedAt: at }));
    }
  }
  result.notified = uniq(result.notified);
  result.href = "/";
  input.log?.(`${result.published} insight(s) published; ${result.notified.length} watcher(s) notified`);
  return result;
}

// ─────────────────────────── Queries ───────────────────────────

export type QuerySource = "intel_documents" | "intel_entities" | "intel_insights" | "intel_jobs" | "ediscovery" | "library" | "tasks" | "events" | "matters" | "people";
export interface QueryInput { source: QuerySource | string; q?: string; filters?: Record<string, unknown>; matterId?: string; since?: string; limit?: number; sort?: string; direction?: "asc" | "desc"; now?: Date }
export interface QueryResult { source: string; count: number; total: number; rows: Record<string, unknown>[]; ids: string[]; text: string }

const f = {
  str: (v: unknown) => (v == null ? "" : String(v)).trim(),
  bool: (v: unknown) => (typeof v === "string" ? ["true", "yes", "1", "on"].includes(v.toLowerCase()) : Boolean(v)),
  list: (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []),
  has: (v: unknown) => v !== undefined && v !== null && v !== "",
};

export function queryRecords(input: QueryInput): QueryResult {
  const now = input.now ?? new Date();
  const d = db();
  const fl = input.filters ?? {};
  const q = f.str(input.q).toLowerCase();
  const limit = Math.max(1, Math.min(500, input.limit ?? 50));
  const dir = input.direction === "asc" ? 1 : -1;
  const since = relativeDate(input.since, now);
  const matterId = f.str(input.matterId) || undefined;
  const has = (s: string | undefined | null) => !q || (s ?? "").toLowerCase().includes(q);
  const finish = (rows: Record<string, unknown>[], total: number, line: (r: Record<string, unknown>) => string): QueryResult => ({ source: input.source, count: rows.length, total, rows, ids: rows.map((r) => String(r.id ?? "")).filter(Boolean), text: rows.slice(0, 40).map((r) => `- ${line(r)}`).join("\n") });
  switch (input.source) {
    case "intel_documents": {
      const res = listDocuments({ kinds: f.list(fl.kinds).filter(Boolean) as IntelDocumentKind[], court: f.str(fl.court) || undefined, courtId: f.str(fl.courtId) || undefined, jurisdiction: f.str(fl.jurisdiction) || undefined, flagged: f.has(fl.flagged) ? f.bool(fl.flagged) : undefined, flagKinds: f.list(fl.flagKinds) as never, entityId: f.str(fl.entityId) || undefined, sourceId: f.str(fl.sourceId) || undefined, adapter: f.str(fl.adapter) || undefined, minConfidence: f.has(fl.minConfidence) ? Number(fl.minConfidence) : undefined, matterId, q: q || undefined, dateFrom: since ?? relativeDate(fl.dateFrom, now), dateTo: relativeDate(fl.dateTo, now), sort: (["updated", "date", "title", "confidence", "fetched"].includes(String(input.sort)) ? input.sort : "date") as ListDocumentsOptions["sort"], direction: input.direction ?? "desc", limit });
      return finish(res.items.map(docRow), res.total, (r) => `**${r.title}** · ${r.kind} · ${r.date ?? "n/d"}${r.court ? ` · ${r.court}` : ""}${r.citation ? ` · ${r.citation}` : ""}${r.url ? ` — ${r.url}` : ""}`);
    }
    case "intel_entities": {
      const types = f.list(fl.type ?? fl.types);
      const all = intelEntities().find((e) => (!types.length || types.includes(e.type)) && (has(e.name) || (e.aliases ?? []).some(has))).sort((a, b) => (b.mentionCount - a.mentionCount) * -dir);
      const rows = all.slice(0, limit).map((e) => ({ id: e.id, type: e.type, name: e.name, mentionCount: e.mentionCount, docCount: e.docIds.length, attributes: e.attributes, aliases: e.aliases, flags: (e.flags ?? []).map((x) => x.kind), updatedAt: e.updatedAt }));
      return finish(rows, all.length, (r) => `**${r.name}** (${r.type}) · ${r.mentionCount} mention(s), ${r.docCount} document(s)`);
    }
    case "intel_insights": {
      const kinds = f.list(fl.kind ?? fl.kinds), statuses = f.list(fl.status);
      const all = intelInsights().find((i) => (!kinds.length || kinds.includes(i.kind)) && (!statuses.length || statuses.includes(i.status)) && (!matterId || i.scope.matterId === matterId) && (!f.str(fl.userId) || i.scope.userId === f.str(fl.userId)) && (!since || i.updatedAt.slice(0, 10) >= since) && has(`${i.title} ${i.summary}`)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) * -dir);
      const rows = all.slice(0, limit).map((i) => ({ id: i.id, kind: i.kind, title: i.title, summary: i.summary.slice(0, 400), status: i.status, confidence: i.confidence, matterId: i.scope.matterId ?? null, entityIds: i.scope.entityIds, flags: i.flags.map((x) => x.kind), verification: i.provenance.verification?.status ?? "unverified", updatedAt: i.updatedAt, href: `/?insight=${i.id}` }));
      return finish(rows, all.length, (r) => `**${r.title}** · ${r.kind} · ${r.status} · ${Math.round(Number(r.confidence) * 100)}%`);
    }
    case "intel_jobs": {
      const statuses = f.list(fl.status), kinds = f.list(fl.kind);
      const all = intelJobs().find((j) => (!statuses.length || statuses.includes(j.status)) && (!kinds.length || kinds.includes(j.kind)) && (!f.str(fl.sourceId) || j.sourceId === f.str(fl.sourceId)) && (!since || j.createdAt.slice(0, 10) >= since)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) * -dir);
      const rows = all.slice(0, limit).map((j) => ({ id: j.id, kind: j.kind, status: j.status, sourceId: j.sourceId ?? null, sourceName: j.sourceId ? intelSources().get(j.sourceId)?.name ?? null : null, attempts: j.attempts, error: j.error ?? null, fixes: j.fixes.map((x) => x.action), escalated: Boolean(j.escalation), createdAt: j.createdAt, finishedAt: j.finishedAt ?? null }));
      return finish(rows, all.length, (r) => `${r.kind} · ${r.status}${r.sourceName ? ` · ${r.sourceName}` : ""}${r.error ? ` · ${(r.error as { message: string }).message}` : ""}`);
    }
    case "ediscovery": {
      const prefix = f.str(fl.batesPrefix).toUpperCase();
      const all = d.edocs.find((e) => (!matterId || e.matterId === matterId) && (!prefix || e.bates.toUpperCase().startsWith(prefix)) && (!f.str(fl.custodian) || e.custodianName.toLowerCase().includes(f.str(fl.custodian).toLowerCase())) && (!f.str(fl.docType) || e.type.toLowerCase() === f.str(fl.docType).toLowerCase()) && (!f.has(fl.privileged) || Boolean(e.coding?.privileged) === f.bool(fl.privileged)) && (!f.has(fl.hot) || Boolean(e.coding?.hot) === f.bool(fl.hot)) && (!f.has(fl.responsive) || Boolean(e.coding?.responsive) === f.bool(fl.responsive)) && (!f.str(fl.dateAfter) || e.date >= (relativeDate(fl.dateAfter, now) ?? "")) && (!f.str(fl.dateBefore) || e.date <= (relativeDate(fl.dateBefore, now) ?? "9")) && (!since || e.date >= since) && (has(e.subject) || has(e.text.slice(0, 2000)))).sort((a, b) => a.date.localeCompare(b.date) * -dir);
      const rows = all.slice(0, limit).map((e) => ({ id: e.id, bates: e.bates, date: e.date, custodian: e.custodianName, type: e.type, subject: e.subject, from: e.from, to: e.to, passage: e.text.slice(0, 300), coding: e.coding, matterId: e.matterId }));
      return finish(rows, all.length, (r) => `**${r.bates}** · ${r.date} · ${r.custodian} · ${r.type} — ${r.subject}${(r.coding as { privileged?: boolean })?.privileged ? " · PRIVILEGED" : ""}`);
    }
    case "library": {
      const type = f.str(fl.type), tag = f.str(fl.tag), folderId = f.str(fl.folderId);
      const all = d.library.find((i) => (type ? i.type === type : i.type !== "folder") && (!matterId || i.matterId === matterId) && (!tag || (i.tags ?? []).includes(tag)) && (!folderId || i.parentId === folderId) && (!since || i.updatedAt.slice(0, 10) >= since) && (has(i.name) || has(i.description))).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) * -dir);
      const rows = all.slice(0, limit).map((i) => ({ id: i.id, name: i.name, type: i.type, matterId: i.matterId ?? null, parentId: i.parentId, tags: i.tags ?? [], size: i.size ?? null, officeDocId: i.officeDocId ?? null, url: i.url ?? null, updatedAt: i.updatedAt, href: `/library?item=${i.id}` }));
      return finish(rows, all.length, (r) => `**${r.name}** · ${r.type} · ${String(r.updatedAt).slice(0, 10)}`);
    }
    case "tasks": {
      const status = f.str(fl.status), assignee = f.str(fl.assigneeId), today = nowIso(now).slice(0, 10);
      const all = d.tasks.find((t) => (!matterId || t.matterId === matterId) && (status ? t.status === status : t.status !== "done") && (!assignee || t.assigneeId === assignee) && (!f.has(fl.overdue) || !f.bool(fl.overdue) || (Boolean(t.dueAt) && t.dueAt! < today)) && (!since || t.createdAt.slice(0, 10) >= since) && has(t.title)).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") * (input.direction === "desc" ? -1 : 1));
      const rows = all.slice(0, limit).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt ?? null, assigneeId: t.assigneeId ?? null, assignee: t.assigneeId ? d.people.get(t.assigneeId)?.name ?? null : null, matterId: t.matterId ?? null, tags: t.tags ?? [], href: `/?task=${t.id}` }));
      return finish(rows, all.length, (r) => `**${r.title}** · ${r.status} · ${r.priority}${r.dueAt ? ` · due ${r.dueAt}` : ""}${r.assignee ? ` · ${r.assignee}` : ""}`);
    }
    case "events": {
      const kind = f.str(fl.kind), from = relativeDate(fl.from, now) ?? since, to = relativeDate(fl.to, now);
      const all = d.events.find((e) => (!matterId || e.matterId === matterId) && (!kind || e.kind === kind) && (!from || e.startsAt.slice(0, 10) >= from) && (!to || e.startsAt.slice(0, 10) <= to) && has(e.title)).sort((a, b) => a.startsAt.localeCompare(b.startsAt) * (input.direction === "desc" ? -1 : 1));
      const rows = all.slice(0, limit).map((e) => ({ id: e.id, title: e.title, kind: e.kind, startsAt: e.startsAt, endsAt: e.endsAt ?? null, location: e.location ?? null, matterId: e.matterId ?? null, ruleSource: e.ruleSource ?? null, href: `/?event=${e.id}` }));
      return finish(rows, all.length, (r) => `**${r.title}** · ${r.kind} · ${String(r.startsAt).slice(0, 16).replace("T", " ")}`);
    }
    case "matters": {
      const status = f.str(fl.status), area = f.str(fl.practiceArea);
      const all = d.matters.find((m) => (status ? m.status === status : true) && (!area || m.practiceArea === area) && (has(m.name) || has(m.shortName) || has(m.client))).sort((a, b) => a.name.localeCompare(b.name) * (input.direction === "desc" ? -1 : 1));
      const rows = all.slice(0, limit).map((m) => ({ id: m.id, name: m.name, shortName: m.shortName, caption: m.caption ?? null, client: m.client, clientSide: m.clientSide, court: m.court ?? null, judge: m.judge ?? null, stage: m.stage ?? null, status: m.status, practiceArea: m.practiceArea, teamIds: m.teamIds, leadAttorneyId: m.leadAttorneyId ?? null }));
      return finish(rows, all.length, (r) => `**${r.shortName}** · ${r.client} · ${r.status}${r.stage ? ` · ${r.stage}` : ""}`);
    }
    case "people": {
      const roles = f.list(fl.role ?? fl.roles);
      const all = d.people.find((p) => (roles.length ? roles.includes(p.role) : ["attorney", "paralegal", "staff"].includes(p.role)) && (has(p.name) || has(p.title))).sort((a, b) => a.name.localeCompare(b.name) * (input.direction === "desc" ? -1 : 1));
      const rows = all.slice(0, limit).map((p) => ({ id: p.id, name: p.name, title: p.title ?? null, role: p.role, email: p.email ?? null, organization: p.organization ?? null }));
      return finish(rows, all.length, (r) => `**${r.name}**${r.title ? ` · ${r.title}` : ""} · ${r.role}`);
    }
    default:
      throw new Error(`Unknown query source "${input.source}"`);
  }
}

// ─────────────────────────── User context and digests ───────────────────────────

export interface WorkflowUserContext {
  user: { id: string; name: string; title?: string };
  matters: { id: string; name: string; shortName: string; client: string; stage?: string; court?: string }[];
  events: { id: string; title: string; startsAt: string; kind: string; matterId?: string }[];
  tasks: { id: string; title: string; dueAt?: string; priority: string; status: string; matterId?: string; overdue: boolean }[];
  watches: IntelWatch[];
  insights: IntelInsight[];
  documents: ReturnType<typeof docRow>[];
  updates: { id: string; body: string; createdAt: string; matterId?: string; author: string }[];
}
export type UserContextProvider = (userId: string, opts: { now: Date }) => Promise<WorkflowUserContext | null> | WorkflowUserContext | null;

/** The intel context module (buildUserContext) registers here; the built-in builder reads the same collections. */
export function setUserContextProvider(p: UserContextProvider | null) { (globalThis as G).__leclaudeWorkflowUserContextProvider = p ?? undefined; }

export function builtInUserContext(userId: string, opts: { now: Date }): WorkflowUserContext | null {
  const d = db();
  const person = d.people.get(userId);
  if (!person) return null;
  const now = opts.now;
  const today = nowIso(now).slice(0, 10);
  const horizon = new Date(now.getTime() + 14 * 86400_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const matters = d.matters.find((m) => m.status !== "closed" && (m.teamIds.includes(userId) || m.leadAttorneyId === userId));
  const matterIds = new Set(matters.map((m) => m.id));
  const events = d.events.find((e) => e.startsAt >= nowIso(now) && e.startsAt <= horizon && ((e.attendeeIds ?? []).includes(userId) || (Boolean(e.matterId) && matterIds.has(e.matterId!)))).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 20);
  const tasks = d.tasks.find((t) => t.status !== "done" && t.assigneeId === userId).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")).slice(0, 25);
  const watches = intelWatches().find((w) => w.userId === userId);
  const insights = intelInsights().find((i) => (i.status === "published" || i.status === "verified") && i.updatedAt >= weekAgo && ((Boolean(i.scope.matterId) && matterIds.has(i.scope.matterId!)) || i.scope.userId === userId || (i.scope.entityIds ?? []).some((id) => watches.some((w) => w.target === id)))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  const documents = intelDocuments().find((doc) => doc.updatedAt >= dayAgo && doc.matterIds.some((id) => matterIds.has(id))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15).map(docRow);
  const updates = d.updates.find((u) => u.createdAt >= dayAgo && (!u.matterId || matterIds.has(u.matterId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map((u) => ({ id: u.id, body: u.body.slice(0, 300), createdAt: u.createdAt, matterId: u.matterId, author: d.people.get(u.authorId)?.name ?? u.authorId }));
  return {
    user: { id: person.id, name: person.name, title: person.title },
    matters: matters.map((m) => ({ id: m.id, name: m.name, shortName: m.shortName, client: m.client, stage: m.stage, court: m.court })),
    events: events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, kind: e.kind, matterId: e.matterId })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, priority: t.priority, status: t.status, matterId: t.matterId, overdue: Boolean(t.dueAt && t.dueAt < today) })),
    watches, insights, documents, updates,
  };
}

export async function userContext(userId: string, opts: { now?: Date } = {}): Promise<WorkflowUserContext | null> {
  const now = opts.now ?? new Date();
  const provider = (globalThis as G).__leclaudeWorkflowUserContextProvider;
  if (provider) { try { const r = await provider(userId, { now }); if (r) return r; } catch { /* fall back to the built-in builder */ } }
  return builtInUserContext(userId, { now });
}

export interface DigestResult { insight: IntelInsight; markdown: string; context: WorkflowUserContext }

/** Build a personalized digest for one person and record it as a published `digest` insight scoped to them. */
export async function buildDigest(userId: string, opts: { now?: Date; actor: AnalysisActor; title?: string; extraInsightIds?: string[] }): Promise<DigestResult | null> {
  const now = opts.now ?? new Date();
  const ctx = await userContext(userId, { now });
  if (!ctx) return null;
  const d = db();
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const title = (opts.title?.trim() || `Your brief — ${dateLabel}`).slice(0, 200);
  const shortName = (id?: string) => (id ? d.matters.get(id)?.shortName ?? id : "");
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const extras = (opts.extraInsightIds ?? []).map((id) => intelInsights().get(id)).filter((i): i is IntelInsight => Boolean(i) && !ctx.insights.some((x) => x.id === i!.id));
  const insights = [...ctx.insights, ...extras].slice(0, 12);
  const overdue = ctx.tasks.filter((t) => t.overdue), dueSoon = ctx.tasks.filter((t) => !t.overdue && t.dueAt && t.dueAt <= new Date(now.getTime() + 3 * 86400_000).toISOString().slice(0, 10));
  const lines: string[] = [`# ${title}`, "", `Good morning, ${ctx.user.name.split(" ")[0]}. ${ctx.matters.length} active matter(s), ${ctx.events.length} event(s) in the next 14 days, ${ctx.tasks.length} open task(s)${overdue.length ? ` (${overdue.length} overdue)` : ""}.`, ""];
  if (ctx.events.length) { lines.push("## Coming up", "", ...ctx.events.slice(0, 8).map((e) => `- ${fmt(e.startsAt)} — **${e.title}** (${e.kind}${e.matterId ? `, ${shortName(e.matterId)}` : ""})`), ""); }
  if (overdue.length || dueSoon.length) { lines.push("## Tasks needing attention", "", ...overdue.map((t) => `- OVERDUE ${t.dueAt} — ${t.title}${t.matterId ? ` (${shortName(t.matterId)})` : ""}`), ...dueSoon.map((t) => `- due ${t.dueAt} — ${t.title}${t.matterId ? ` (${shortName(t.matterId)})` : ""}`), ""); }
  if (ctx.documents.length) { lines.push("## New in the intelligence store (24h)", "", ...ctx.documents.slice(0, 8).map((doc) => `- ${doc.kind.replace(/_/g, " ")}: **${doc.title}**${doc.date ? ` (${doc.date})` : ""}${doc.court ? ` · ${doc.court}` : ""}`), ""); }
  if (insights.length) { lines.push("## Insights for your matters", "", ...insights.slice(0, 6).map((i) => `- **${i.title}** — ${i.summary.split("\n")[0].slice(0, 200)} _(${Math.round(i.confidence * 100)}%${i.provenance.verification?.status ? `, ${i.provenance.verification.status}` : ""})_`), ""); }
  if (ctx.updates.length) { lines.push("## Team updates", "", ...ctx.updates.slice(0, 5).map((u) => `- ${u.author}: ${u.body.split("\n")[0].slice(0, 160)}`), ""); }
  if (ctx.watches.length) lines.push(`_Watching ${ctx.watches.length} item(s): ${ctx.watches.slice(0, 5).map((w) => w.label).join(", ")}._`);
  const markdown = lines.join("\n");
  const evidence: IntelEvidence[] = [...ctx.documents.slice(0, 10).map((doc) => ({ docId: doc.id, url: doc.url ?? undefined, href: `/intel/documents/${doc.id}` })), ...insights.flatMap((i) => i.evidence.slice(0, 2))].slice(0, 30);
  const sources: ProvenanceSource[] = [...ctx.events.slice(0, 5).map((e) => ({ kind: "internal" as const, id: e.id, title: e.title })), ...ctx.tasks.slice(0, 5).map((t) => ({ kind: "internal" as const, id: t.id, title: t.title })), ...ctx.documents.slice(0, 10).map((doc) => ({ kind: "internal" as const, id: doc.id, title: doc.title, url: doc.url ?? undefined }))];
  const insight = recordInsight({ kind: "digest", scope: { userId, entityIds: [] , period: { from: nowIso(new Date(now.getTime() - 86400_000)).slice(0, 10), to: nowIso(now).slice(0, 10) } }, title, summary: markdown.slice(0, 4000), data: { sections: { events: ctx.events.length, tasks: ctx.tasks.length, overdue: overdue.length, documents: ctx.documents.length, insights: insights.length, updates: ctx.updates.length }, insightIds: insights.map((i) => i.id), taskIds: ctx.tasks.map((t) => t.id), eventIds: ctx.events.map((e) => e.id), personalized: true }, evidence, sources, confidence: 0.9, actor: { ...opts.actor, userId }, now });
  intelInsights().update(insight.id, (cur) => ({ ...cur, status: "published" }));
  return { insight: intelInsights().get(insight.id)!, markdown, context: ctx };
}

/** Post a team update (used by digest / library publishing when a visible note is wanted). */
export function postUpdate(input: { body: string; matterId?: string; kind?: TeamUpdate["kind"]; href?: string; label?: string; authorId?: string; now?: Date }): TeamUpdate {
  const at = nowIso(input.now);
  const update: TeamUpdate = { id: `tu_${nanoid(10)}`, authorId: input.authorId ?? WORKFLOW_CURRENT_USER.id, body: input.body.slice(0, 4000), matterId: input.matterId, createdAt: at, kind: input.kind ?? "update", attachments: input.href ? [{ label: input.label ?? "Open", href: input.href }] : undefined };
  db().updates.put(update);
  return update;
}
