import "server-only";
import { db } from "@/lib/db";
import { hybridSearch, indexDocuments, indexStats, removeDocument } from "@/lib/ai/vector-store";
import { aiConfig } from "@/lib/ai/config";
import { contentHash, sha256 } from "@/lib/integrity/hash";
import { chunkIndexText, chunkIntelText, normalizeText, type ChunkOptions } from "./chunk";
import { canonicalKey } from "./mentions";
import {
  INTEL_COLLECTIONS,
  INTEL_VECTOR_NAMESPACE,
  type IntelChunk,
  type IntelDates,
  type IntelDocument,
  type IntelDocumentKind,
  type IntelEntity,
  type IntelEntityMention,
  type IntelEntityType,
  type IntelFlag,
  type IntelFlagKind,
  type IntelInsight,
  type IntelJob,
  type IntelRelation,
  type IntelSearchHit,
  type IntelSearchQuery,
  type IntelSource,
  type IntelWatch,
} from "./types";

/**
 * Typed collection accessors and the document lifecycle: upsert with dedupe
 * (hash, then adapter+externalId), full text in the blob store, chunks in
 * `intel_chunks`, vectors in the `intel` namespace keyed by chunk id, hybrid
 * search with metadata filters, flags, listing and stats.
 */
export const intelSources = () => db().collection<IntelSource>(INTEL_COLLECTIONS.sources);
export const intelDocuments = () => db().collection<IntelDocument>(INTEL_COLLECTIONS.documents);
export const intelChunks = () => db().collection<IntelChunk>(INTEL_COLLECTIONS.chunks);
export const intelEntities = () => db().collection<IntelEntity>(INTEL_COLLECTIONS.entities);
export const intelRelations = () => db().collection<IntelRelation>(INTEL_COLLECTIONS.relations);
export const intelInsights = () => db().collection<IntelInsight>(INTEL_COLLECTIONS.insights);
export const intelJobs = () => db().collection<IntelJob>(INTEL_COLLECTIONS.jobs);
export const intelWatches = () => db().collection<IntelWatch>(INTEL_COLLECTIONS.watches);

const MAX_TEXT_CHARS = 600_000;
const MAX_SUMMARY = 800;
const MAX_META_CHARS = 16_000;

export type IntelDocumentInput = Omit<IntelDocument, "id" | "hash" | "textBlobId" | "textLength" | "chunkCount" | "fetchedAt" | "updatedAt" | "flags" | "judgeIds" | "attorneyIds" | "firmIds" | "partyIds" | "productIds" | "agencies" | "matterIds" | "tags" | "confidence"> & {
  id?: string;
  /** Full text; stored in the blob store, never on the row. */
  text: string;
  flags?: IntelFlag[];
  judgeIds?: string[];
  attorneyIds?: string[];
  firmIds?: string[];
  partyIds?: string[];
  productIds?: string[];
  agencies?: string[];
  matterIds?: string[];
  tags?: string[];
  confidence?: number;
  /** Entity-name stubs; stored on meta.entities for the analysis layer. */
  entities?: IntelEntityMention[];
  fetchedAt?: string;
};

export interface UpsertResult { doc: IntelDocument; status: "added" | "updated" | "unchanged"; textChanged: boolean }

/** Stable document id: adapter + externalId when present, else the content hash. */
export function docIdFor(adapter: string, externalId: string | undefined, hash: string): string {
  return `idoc_${sha256(externalId ? `${adapter}|${externalId}` : `${adapter}|hash|${hash}`).slice(0, 20)}`;
}

export function textBlobIdFor(docId: string) {
  return `iblob_${docId.replace(/^idoc_/, "")}`;
}

/** The single date used for ordering and range filters. */
export function primaryDate(dates: IntelDates | undefined): string | undefined {
  if (!dates) return undefined;
  return dates.decided ?? dates.filed ?? dates.published ?? dates.effective ?? dates.event ?? dates.modified;
}

function uniq(list: (string | undefined | null)[] | undefined): string[] {
  return Array.from(new Set((list ?? []).filter((x): x is string => Boolean(x && x.trim())).map((x) => x.trim())));
}

function compactMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  let s = JSON.stringify(meta);
  if (s.length <= MAX_META_CHARS) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) out[k] = v.slice(0, 40);
    else if (typeof v === "string") out[k] = v.slice(0, 2000);
    else out[k] = v;
  }
  s = JSON.stringify(out);
  return s.length <= MAX_META_CHARS ? out : { truncated: true, keys: Object.keys(meta) };
}

function mergeFlags(existing: IntelFlag[] | undefined, incoming: IntelFlag[] | undefined): IntelFlag[] {
  const out = [...(existing ?? [])];
  for (const f of incoming ?? []) {
    const i = out.findIndex((x) => x.kind === f.kind);
    if (i >= 0) out[i] = f; else out.push(f);
  }
  return out;
}

/** Entity ids referenced by a document (used for search filters). */
export function entityIdsOf(doc: Pick<IntelDocument, "judgeIds" | "attorneyIds" | "firmIds" | "partyIds" | "productIds" | "mdlId">): string[] {
  return uniq([...doc.judgeIds, ...doc.attorneyIds, ...doc.firmIds, ...doc.partyIds, ...doc.productIds, doc.mdlId]);
}

/** Metadata stored with every vector row for filtering. */
export function docMetaForVector(doc: IntelDocument, chunk: Pick<IntelChunk, "idx" | "section" | "page">): Record<string, unknown> {
  return { docId: doc.id, kind: doc.kind, court: doc.court, courtId: doc.courtId, jurisdiction: doc.jurisdiction, date: primaryDate(doc.dates), dates: doc.dates, matterIds: doc.matterIds, sourceId: doc.sourceId, adapter: doc.adapter, entityIds: entityIdsOf(doc), idx: chunk.idx, section: chunk.section, page: chunk.page, title: doc.title.slice(0, 160) };
}

/**
 * Insert or update a document. Dedupe order: (1) an existing row with the same
 * content hash is updated in place (metadata merged; no re-index), (2) an
 * existing row for the same adapter+externalId has its text replaced and is
 * re-indexed by the caller, (3) otherwise a new row is created.
 */
export function upsertDocument(input: IntelDocumentInput, opts: { now?: Date } = {}): UpsertResult {
  const now = (opts.now ?? new Date()).toISOString();
  const d = db();
  const text = normalizeText(input.text ?? "").slice(0, MAX_TEXT_CHARS);
  const hash = contentHash(text || input.title);
  const docs = intelDocuments();
  const byHash = docs.findOne((x) => x.hash === hash && x.adapter === input.adapter);
  const byExternal = !byHash && input.externalId ? docs.findOne((x) => x.adapter === input.adapter && x.externalId === input.externalId) : null;
  const existing = byHash ?? byExternal ?? (input.id ? docs.get(input.id) : null);
  const meta = compactMeta({ ...(existing?.meta ?? {}), ...(input.meta ?? {}), ...(input.entities?.length ? { entities: input.entities.slice(0, 60) } : {}) });
  const base: IntelDocument = {
    id: existing?.id ?? input.id ?? docIdFor(input.adapter, input.externalId, hash),
    sourceId: input.sourceId,
    adapter: input.adapter,
    kind: input.kind,
    title: input.title.trim().slice(0, 300) || "Untitled",
    summary: input.summary?.trim().slice(0, MAX_SUMMARY) || existing?.summary,
    jurisdiction: input.jurisdiction ?? existing?.jurisdiction,
    court: input.court ?? existing?.court,
    courtId: input.courtId ?? existing?.courtId,
    docketNumber: input.docketNumber ?? existing?.docketNumber,
    caseName: input.caseName ?? existing?.caseName,
    citation: input.citation ?? existing?.citation,
    judgeIds: uniq([...(existing?.judgeIds ?? []), ...(input.judgeIds ?? [])]),
    attorneyIds: uniq([...(existing?.attorneyIds ?? []), ...(input.attorneyIds ?? [])]),
    firmIds: uniq([...(existing?.firmIds ?? []), ...(input.firmIds ?? [])]),
    partyIds: uniq([...(existing?.partyIds ?? []), ...(input.partyIds ?? [])]),
    mdlId: input.mdlId ?? existing?.mdlId,
    productIds: uniq([...(existing?.productIds ?? []), ...(input.productIds ?? [])]),
    agencies: uniq([...(existing?.agencies ?? []), ...(input.agencies ?? [])]),
    dates: { ...(existing?.dates ?? {}), ...(input.dates ?? {}) },
    url: input.url ?? existing?.url,
    externalId: input.externalId ?? existing?.externalId,
    hash,
    textBlobId: existing?.textBlobId,
    textLength: text.length,
    chunkCount: existing?.chunkCount ?? 0,
    matterIds: uniq([...(existing?.matterIds ?? []), ...(input.matterIds ?? [])]),
    tags: uniq([...(existing?.tags ?? []), ...(input.tags ?? [])]),
    flags: mergeFlags(existing?.flags, input.flags),
    confidence: Math.max(0, Math.min(1, input.confidence ?? existing?.confidence ?? 0.7)),
    provenance: input.provenance ?? existing?.provenance,
    meta,
    fetchedAt: input.fetchedAt ?? now,
    updatedAt: now,
  };
  const textChanged = !existing || existing.hash !== hash || !existing.textBlobId;
  if (textChanged) {
    const blobId = textBlobIdFor(base.id);
    d.blobs.put(new TextEncoder().encode(text), "text/plain; charset=utf-8", { id: blobId, name: `${base.title.slice(0, 80)}.txt`, meta: { docId: base.id, kind: base.kind } });
    base.textBlobId = blobId;
    if (existing) base.chunkCount = 0; // stale chunks; caller re-indexes
  }
  if (existing && !textChanged) {
    const before = JSON.stringify({ ...existing, updatedAt: undefined, fetchedAt: undefined });
    const after = JSON.stringify({ ...base, updatedAt: undefined, fetchedAt: undefined });
    if (before === after) {
      // Nothing changed except the fetch timestamp: refresh it so staleness tracking stays honest.
      const refreshed = { ...existing, fetchedAt: now, updatedAt: existing.updatedAt };
      docs.put(refreshed);
      return { doc: refreshed, status: "unchanged", textChanged: false };
    }
    docs.put(base);
    return { doc: base, status: "updated", textChanged: false };
  }
  docs.put(base);
  return { doc: base, status: existing ? "updated" : "added", textChanged };
}

export function getDocument(id: string): IntelDocument | null {
  return intelDocuments().get(id);
}

export function getDocumentText(id: string): string | null {
  const doc = intelDocuments().get(id);
  if (!doc?.textBlobId) return null;
  const b = db().blobs.get(doc.textBlobId);
  return b ? new TextDecoder().decode(b.bytes) : null;
}

export function findByExternalId(adapter: string, externalId: string): IntelDocument | null {
  return intelDocuments().findOne((x) => x.adapter === adapter && x.externalId === externalId);
}

export function listChunks(docId: string): IntelChunk[] {
  return intelChunks().list({ where: (c) => c.docId === docId, sortBy: "idx" });
}

/**
 * Chunk a document's text, store the chunks and index them (keyword-only
 * without an OpenAI key). Idempotent: existing chunks and vectors for the
 * document are replaced; stale chunk ids are removed from the vector store.
 */
export async function indexIntelDocument(docOrId: IntelDocument | string, text?: string, opts: ChunkOptions & { embed?: boolean } = {}): Promise<{ chunks: number; embedded: number }> {
  const doc = typeof docOrId === "string" ? intelDocuments().get(docOrId) : docOrId;
  if (!doc) throw new Error(`Intel document not found: ${String(docOrId)}`);
  const body = text ?? getDocumentText(doc.id) ?? "";
  const chunks = chunkIntelText(body, { size: opts.size, overlap: opts.overlap, maxChunks: opts.maxChunks });
  const col = intelChunks();
  const old = listChunks(doc.id);
  const rows: IntelChunk[] = chunks.map((c) => ({ id: `${doc.id}#${c.idx}`, docId: doc.id, idx: c.idx, text: c.text, section: c.section, page: c.page, startChar: c.startChar, endChar: c.endChar, hash: contentHash(c.text) }));
  const keep = new Set(rows.map((r) => r.id));
  for (const o of old) if (!keep.has(o.id)) { col.delete(o.id); removeDocument(INTEL_VECTOR_NAMESPACE, o.id); }
  col.putMany(rows);
  const embed = opts.embed ?? aiConfig().hasKey;
  const res = rows.length
    ? await indexDocuments(INTEL_VECTOR_NAMESPACE, rows.map((r) => ({ id: r.id, text: chunkIndexText(r, doc.title), meta: docMetaForVector(doc, r) })), { embed, chunkSize: 4000 })
    : { docs: 0, chunks: 0, embedded: 0 };
  const latest = intelDocuments().get(doc.id) ?? doc;
  intelDocuments().put({ ...latest, chunkCount: rows.length, textLength: body.length, updatedAt: new Date().toISOString() });
  return { chunks: rows.length, embedded: res.embedded };
}

/** Upsert + (re)index when the text changed or the document has no chunks yet. */
export async function ingestDocument(input: IntelDocumentInput, opts: { embed?: boolean; chunkSize?: number; overlap?: number; now?: Date; reindex?: boolean } = {}): Promise<UpsertResult & { chunks: number }> {
  const r = upsertDocument(input, { now: opts.now });
  if (r.textChanged || r.doc.chunkCount === 0 || opts.reindex) {
    const text = normalizeText(input.text ?? "").slice(0, MAX_TEXT_CHARS);
    const idx = await indexIntelDocument(r.doc, text, { embed: opts.embed, size: opts.chunkSize, overlap: opts.overlap });
    return { ...r, doc: intelDocuments().get(r.doc.id) ?? r.doc, chunks: idx.chunks };
  }
  return { ...r, chunks: r.doc.chunkCount };
}

export function deleteDocument(id: string): boolean {
  const d = db();
  const doc = intelDocuments().get(id);
  if (!doc) return false;
  for (const c of listChunks(id)) { intelChunks().delete(c.id); removeDocument(INTEL_VECTOR_NAMESPACE, c.id); }
  if (doc.textBlobId) d.blobs.delete(doc.textBlobId);
  return intelDocuments().delete(id);
}

export function deleteSourceDocuments(sourceId: string): number {
  let n = 0;
  for (const doc of intelDocuments().find((x) => x.sourceId === sourceId)) if (deleteDocument(doc.id)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export function flagDocument(docId: string, flag: Omit<IntelFlag, "at"> & { at?: string }): IntelDocument | null {
  return intelDocuments().update(docId, (doc) => ({ ...doc, flags: mergeFlags(doc.flags, [{ ...flag, at: flag.at ?? new Date().toISOString() }]), updatedAt: new Date().toISOString() }));
}

export function unflagDocument(docId: string, kind: IntelFlagKind): IntelDocument | null {
  return intelDocuments().update(docId, (doc) => ({ ...doc, flags: doc.flags.filter((f) => f.kind !== kind), updatedAt: new Date().toISOString() }));
}

export function hasFlag(doc: Pick<IntelDocument, "flags">, kind: IntelFlagKind): boolean {
  return doc.flags.some((f) => f.kind === kind);
}

// ---------------------------------------------------------------------------
// Listing and search
// ---------------------------------------------------------------------------

export interface ListDocumentsOptions {
  kinds?: IntelDocumentKind[];
  sourceId?: string;
  sourceIds?: string[];
  adapter?: string;
  matterId?: string;
  court?: string;
  courtId?: string;
  jurisdiction?: string;
  /** Case-insensitive substring over title, caseName, citation, docketNumber. */
  q?: string;
  flagged?: boolean;
  flagKinds?: IntelFlagKind[];
  dateFrom?: string;
  dateTo?: string;
  entityId?: string;
  seeded?: boolean;
  minConfidence?: number;
  sort?: "updated" | "date" | "title" | "confidence" | "fetched";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export function documentMatches(doc: IntelDocument, o: ListDocumentsOptions): boolean {
  if (o.kinds?.length && !o.kinds.includes(doc.kind)) return false;
  if (o.sourceId && doc.sourceId !== o.sourceId) return false;
  if (o.sourceIds?.length && !o.sourceIds.includes(doc.sourceId)) return false;
  if (o.adapter && doc.adapter !== o.adapter) return false;
  if (o.matterId && !doc.matterIds.includes(o.matterId)) return false;
  if (o.courtId && doc.courtId !== o.courtId) return false;
  if (o.court && !(doc.court ?? "").toLowerCase().includes(o.court.toLowerCase()) && doc.courtId !== o.court) return false;
  if (o.jurisdiction && !(doc.jurisdiction ?? "").toLowerCase().includes(o.jurisdiction.toLowerCase())) return false;
  if (o.flagged === true && !doc.flags.length) return false;
  if (o.flagged === false && doc.flags.length) return false;
  if (o.flagKinds?.length && !doc.flags.some((f) => o.flagKinds!.includes(f.kind))) return false;
  if (o.seeded !== undefined && Boolean(doc.meta?.seeded) !== o.seeded) return false;
  if (o.minConfidence != null && doc.confidence < o.minConfidence) return false;
  if (o.entityId && !entityIdsOf(doc).includes(o.entityId)) return false;
  const date = primaryDate(doc.dates);
  if (o.dateFrom && (!date || date < o.dateFrom)) return false;
  if (o.dateTo && (!date || date > o.dateTo)) return false;
  if (o.q) {
    const q = o.q.toLowerCase();
    if (![doc.title, doc.caseName, doc.citation, doc.docketNumber, doc.summary].some((s) => s?.toLowerCase().includes(q))) return false;
  }
  return true;
}

export function listDocuments(o: ListDocumentsOptions = {}): { items: IntelDocument[]; total: number; limit: number; offset: number } {
  const limit = Math.max(1, Math.min(o.limit ?? 50, 500));
  const offset = Math.max(0, o.offset ?? 0);
  const dir = o.direction === "asc" ? 1 : -1;
  const key = (doc: IntelDocument) => (o.sort === "date" ? primaryDate(doc.dates) ?? "" : o.sort === "title" ? doc.title.toLowerCase() : o.sort === "confidence" ? String(doc.confidence.toFixed(3)) : o.sort === "fetched" ? doc.fetchedAt : doc.updatedAt);
  const all = intelDocuments().find((doc) => documentMatches(doc, o)).sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir);
  return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

function searchFilter(q: IntelSearchQuery): (meta: Record<string, unknown>, docId: string) => boolean {
  return (meta) => {
    if (q.kinds?.length && !q.kinds.includes(meta.kind as IntelDocumentKind)) return false;
    if (q.court && meta.courtId !== q.court && !String(meta.court ?? "").toLowerCase().includes(q.court.toLowerCase())) return false;
    if (q.jurisdiction && !String(meta.jurisdiction ?? "").toLowerCase().includes(q.jurisdiction.toLowerCase())) return false;
    if (q.matterId && !(Array.isArray(meta.matterIds) && (meta.matterIds as string[]).includes(q.matterId))) return false;
    if (q.sourceIds?.length && !q.sourceIds.includes(String(meta.sourceId))) return false;
    if (q.entityIds?.length) { const ids = Array.isArray(meta.entityIds) ? (meta.entityIds as string[]) : []; if (!q.entityIds.some((e) => ids.includes(e))) return false; }
    const date = typeof meta.date === "string" ? meta.date : undefined;
    if (q.dateFrom && (!date || date < q.dateFrom)) return false;
    if (q.dateTo && (!date || date > q.dateTo)) return false;
    return true;
  };
}

/** Hybrid (keyword + vector) search over intel chunks, grouped per document (best two chunks each). */
export async function searchIntel(q: IntelSearchQuery): Promise<IntelSearchHit[]> {
  const limit = Math.max(1, Math.min(q.limit ?? 20, 100));
  const query = q.q?.trim() ?? "";
  if (!query) {
    // No query: newest matching documents with their first chunk.
    const docs = listDocuments({ kinds: q.kinds, court: q.court, jurisdiction: q.jurisdiction, matterId: q.matterId, sourceIds: q.sourceIds, dateFrom: q.dateFrom, dateTo: q.dateTo, entityId: q.entityIds?.[0], sort: "date", limit }).items;
    return docs.map((doc) => { const c = listChunks(doc.id)[0]; return { doc: pickDoc(doc), chunk: c ? pickChunk(c) : { id: `${doc.id}#0`, idx: 0, text: doc.summary ?? doc.title }, score: 0 }; });
  }
  const hits = await hybridSearch(INTEL_VECTOR_NAMESPACE, query, { k: limit * 4, filter: searchFilter(q), perDoc: 1 });
  const perDoc = new Map<string, IntelSearchHit[]>();
  for (const h of hits) {
    const docId = String(h.meta?.docId ?? h.docId.split("#")[0]);
    const doc = intelDocuments().get(docId);
    if (!doc) continue;
    const chunk = intelChunks().get(h.docId);
    const hit: IntelSearchHit = { doc: pickDoc(doc), chunk: chunk ? pickChunk(chunk) : { id: h.docId, idx: h.chunkIndex, text: h.text }, score: h.score };
    const list = perDoc.get(docId) ?? [];
    if (list.length < 2) { list.push(hit); perDoc.set(docId, list); }
  }
  return Array.from(perDoc.values()).flat().sort((a, b) => b.score - a.score).slice(0, limit);
}

function pickDoc(doc: IntelDocument): IntelSearchHit["doc"] {
  return { id: doc.id, kind: doc.kind, title: doc.title, court: doc.court, jurisdiction: doc.jurisdiction, citation: doc.citation, docketNumber: doc.docketNumber, caseName: doc.caseName, url: doc.url, dates: doc.dates, confidence: doc.confidence, flags: doc.flags };
}

function pickChunk(c: IntelChunk): IntelSearchHit["chunk"] {
  return { id: c.id, idx: c.idx, text: c.text, section: c.section, page: c.page };
}

// ---------------------------------------------------------------------------
// Entities (basic upsert; alias resolution lives in analysis/)
// ---------------------------------------------------------------------------

export interface EntityInput {
  type: IntelEntityType;
  name: string;
  id?: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  externalIds?: Record<string, string>;
  docId?: string;
  source?: { docId: string; chunkId?: string; quote?: string; url?: string };
  flags?: IntelFlag[];
}

export function entityIdFor(type: IntelEntityType, name: string) {
  return `ient_${type}_${sha256(canonicalKey(name)).slice(0, 12)}`;
}

/** Find an entity by (type, name/alias) or external id. */
export function findEntity(type: IntelEntityType, name: string, externalIds?: Record<string, string>): IntelEntity | null {
  const key = canonicalKey(name);
  return intelEntities().findOne((e) => e.type === type && (e.canonical === key || e.aliases.some((a) => canonicalKey(a) === key) || Boolean(externalIds && e.externalIds && Object.entries(externalIds).some(([k, v]) => e.externalIds![k] === v))));
}

export function upsertEntity(input: EntityInput, now = new Date().toISOString()): IntelEntity {
  const existing = (input.id ? intelEntities().get(input.id) : null) ?? findEntity(input.type, input.name, input.externalIds);
  const docIds = uniq([...(existing?.docIds ?? []), input.docId, input.source?.docId]).slice(-200);
  const sources = [...(existing?.sources ?? [])];
  if (input.source && !sources.some((s) => s.docId === input.source!.docId && s.chunkId === input.source!.chunkId)) sources.push(input.source);
  const entity: IntelEntity = {
    id: existing?.id ?? input.id ?? entityIdFor(input.type, input.name),
    type: input.type,
    name: existing?.name ?? input.name,
    canonical: existing?.canonical ?? canonicalKey(input.name),
    aliases: uniq([...(existing?.aliases ?? []), ...(input.aliases ?? []), existing && canonicalKey(existing.name) !== canonicalKey(input.name) ? input.name : undefined]),
    attributes: { ...(existing?.attributes ?? {}), ...(input.attributes ?? {}) },
    mentionCount: (existing?.mentionCount ?? 0) + (input.docId || input.source ? 1 : 0),
    docIds,
    sources: sources.slice(-100),
    externalIds: { ...(existing?.externalIds ?? {}), ...(input.externalIds ?? {}) },
    flags: input.flags ?? existing?.flags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  intelEntities().put(entity);
  return entity;
}

// ---------------------------------------------------------------------------
// Stats and maintenance
// ---------------------------------------------------------------------------

export function intelStats() {
  const docs = intelDocuments().all();
  const byKind: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let flagged = 0;
  for (const d of docs) {
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    bySource[d.sourceId] = (bySource[d.sourceId] ?? 0) + 1;
    if (d.flags.length) flagged++;
  }
  let vectors = { docs: 0, chunks: 0, embedded: 0 };
  try { vectors = indexStats(INTEL_VECTOR_NAMESPACE); } catch { /* table not ready */ }
  return {
    documents: docs.length,
    chunks: intelChunks().count(),
    entities: intelEntities().count(),
    relations: intelRelations().count(),
    insights: intelInsights().count(),
    jobs: intelJobs().count(),
    sources: intelSources().count(),
    watches: intelWatches().count(),
    byKind,
    bySource,
    flagged,
    vectors,
  };
}

/** Documents whose chunks have no embeddings yet (keyword-only) — re-indexed when a key becomes available. */
export function documentsMissingEmbeddings(limit = 50): IntelDocument[] {
  const rows = db().raw.prepare("SELECT DISTINCT doc_id FROM vectors WHERE collection = ? AND embedding IS NULL LIMIT ?").all(INTEL_VECTOR_NAMESPACE, limit * 20) as { doc_id: string }[];
  const ids = new Set<string>();
  for (const r of rows) { ids.add(r.doc_id.split("#")[0]); if (ids.size >= limit) break; }
  return Array.from(ids).map((id) => intelDocuments().get(id)).filter((d): d is IntelDocument => Boolean(d));
}

export async function reindexMissingEmbeddings(limit = 25, opts: { chunkSize?: number } = {}): Promise<{ docs: number; chunks: number; embedded: number }> {
  if (!aiConfig().hasKey) return { docs: 0, chunks: 0, embedded: 0 };
  let chunks = 0, embedded = 0, docs = 0;
  for (const doc of documentsMissingEmbeddings(limit)) {
    const r = await indexIntelDocument(doc, undefined, { embed: true, size: opts.chunkSize });
    docs++; chunks += r.chunks; embedded += r.embedded;
  }
  return { docs, chunks, embedded };
}
