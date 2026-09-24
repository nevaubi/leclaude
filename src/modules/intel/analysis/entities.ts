import "server-only";
import { db } from "@/lib/db";
import { INTEL_VECTOR_NAMESPACE, type IntelDocument, type IntelEntity, type IntelEntityMention, type IntelEntityType, type IntelFlag } from "../types";
import { canonicalKey, courtIdFromName, courtMention, dedupeMentions, mention, mentionsFromCaption, mentionsFromCounselString, mentionsFromJudgeField, COURT_NAMES } from "../mentions";
import { docMetaForVector, entityIdsOf, findEntity, getDocumentText, intelDocuments, intelEntities, intelRelations, intelWatches, listChunks, upsertEntity, type EntityInput } from "../store";
import { clip, extractCfrCites, extractUscCites } from "./pure";
import type { EntityListItem, EntityListResult } from "./types";

/**
 * Deterministic entity extraction and alias resolution. Every document's
 * mention stubs (`meta.entities`, written by the adapters) plus its structured
 * metadata — judge fields, parties, counsel strings, court ids, MDL numbers,
 * FDA product/manufacturer fields, agencies and CFR/U.S.C. cites in the text —
 * are resolved into `intel_entities` with canonical keys, alias matching and
 * evidence references (document, chunk, quote). The document's typed link
 * fields (judgeIds, attorneyIds, …) are filled from the result.
 */

const CITE_KINDS = new Set<IntelDocument["kind"]>(["opinion", "docket_entry", "regulation", "register_notice", "statute", "court_rule", "news", "local_file"]);
const MAX_CITES_PER_DOC = 12;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : "")).filter(Boolean);
  return typeof v === "string" ? v.split(/;|\|/).map((s) => s.trim()).filter(Boolean) : [];
}

/** Mentions from the mention stubs plus structured metadata and cites. Pure given the document and its text. */
export function extractMentions(doc: IntelDocument, text?: string): IntelEntityMention[] {
  const meta = doc.meta ?? {};
  const out: (IntelEntityMention | null)[] = [];
  const stubs = Array.isArray(meta.entities) ? (meta.entities as IntelEntityMention[]).filter((m) => m && typeof m.name === "string" && typeof m.type === "string") : [];
  out.push(...stubs.map((m) => mention(m.type, m.name, { role: m.role, externalId: m.externalId })));

  // Judges: CourtListener judge fields, "assigned to" on dockets.
  for (const f of [meta.judge, meta.assignedTo, meta.judges]) { if (typeof f === "string") out.push(...mentionsFromJudgeField(f)); else if (Array.isArray(f)) for (const j of strList(f)) out.push(...mentionsFromJudgeField(j)); }
  if (doc.kind === "judge") out.push(mention("judge", doc.title, { externalId: doc.externalId }));

  // Parties and counsel from RECAP-style metadata and the caption.
  const parties = meta.parties;
  if (Array.isArray(parties)) for (const p of parties as unknown[]) {
    if (typeof p === "string") out.push(mention("party", p));
    else if (p && typeof p === "object") { const o = p as { name?: string; role?: string; type?: string; attorneys?: unknown }; if (o.name) out.push(mention("party", o.name, { role: o.role ?? o.type })); for (const a of strList(o.attorneys)) out.push(...mentionsFromCounselString(a)); }
  }
  for (const a of strList(meta.attorneys)) out.push(...mentionsFromCounselString(a));
  if ((doc.kind === "opinion" || doc.kind === "docket") && doc.caseName) out.push(...mentionsFromCaption(doc.caseName));
  if (doc.kind === "attorney") out.push(mention("attorney", doc.title.replace(/\s+\(.*\)$/, ""), { externalId: doc.externalId }));
  if (doc.kind === "firm") out.push(mention("firm", doc.title.replace(/\s+\(.*\)$/, ""), { externalId: doc.externalId }));

  // Court.
  const courtId = doc.courtId ?? courtIdFromName(doc.court);
  if (doc.court || courtId) out.push(courtMention(doc.court ?? (courtId ? COURT_NAMES[courtId] : undefined), courtId));

  // MDL by number.
  const mdlNumber = str(meta.mdlNumber) ?? str(meta.mdl) ?? doc.title.match(/\bMDL\s*(?:No\.?\s*)?(\d{3,4})\b/i)?.[1] ?? doc.caseName?.match(/\bMDL\s*(?:No\.?\s*)?(\d{3,4})\b/i)?.[1];
  if (mdlNumber) out.push(mention("mdl", `MDL ${mdlNumber}`, { externalId: `jpml:${mdlNumber}` }));
  if (doc.kind === "mdl") { const n = mdlNumber ?? doc.docketNumber?.replace(/\D/g, ""); if (n) out.push(mention("mdl", `MDL ${n}`, { externalId: `jpml:${n}` })); }

  // FDA: product and manufacturer.
  if (doc.kind === "recall" || doc.kind === "adverse_event" || doc.tags.includes("drug-label")) {
    const product = str(meta.product) ?? str(meta.productDescription) ?? str(meta.brandName) ?? str(meta.brand_name) ?? str((meta.openfda as { brand_name?: unknown } | undefined)?.brand_name) ?? str(meta.genericName);
    if (product) out.push(mention("product", clip(product, 80)));
    const firm = str(meta.recallingFirm) ?? str(meta.recalling_firm) ?? str(meta.manufacturerName) ?? str(meta.manufacturer) ?? str((meta.openfda as { manufacturer_name?: unknown } | undefined)?.manufacturer_name);
    if (firm) out.push(mention("party", firm, { role: "manufacturer" }));
    out.push(mention("agency", "Food and Drug Administration"));
  }

  // Agencies.
  for (const a of doc.agencies) out.push(mention("agency", a));
  for (const a of strList(meta.agencies)) out.push(mention("agency", a));

  // Regulations and statutes by cite (own citation first, then cites in the head of the text).
  const head = `${doc.title}\n${doc.citation ?? ""}\n${doc.summary ?? ""}\n${(text ?? "").slice(0, 12_000)}`;
  if (doc.kind === "regulation" && doc.citation) for (const c of extractCfrCites(doc.citation)) out.push(mention("regulation", c, { externalId: `cfr:${c.replace(/\s+/g, "")}` }));
  if (doc.kind === "statute" && doc.citation) for (const c of extractUscCites(doc.citation)) out.push(mention("statute", c, { externalId: `usc:${c.replace(/\s+/g, "")}` }));
  if (CITE_KINDS.has(doc.kind)) {
    for (const c of extractCfrCites(head).slice(0, MAX_CITES_PER_DOC)) out.push(mention("regulation", c, { externalId: `cfr:${c.replace(/\s+/g, "")}` }));
    for (const c of extractUscCites(head).slice(0, MAX_CITES_PER_DOC)) out.push(mention("statute", c, { externalId: `usc:${c.replace(/\s+/g, "")}` }));
  }
  return dedupeMentions(out);
}

/** Attributes worth keeping on the entity, derived from the document. */
function attributesFor(m: IntelEntityMention, doc: IntelDocument): Record<string, unknown> {
  const meta = doc.meta ?? {};
  const a: Record<string, unknown> = {};
  switch (m.type) {
    case "judge":
      if (doc.kind === "judge") { if (doc.court) a.court = doc.court; if (doc.courtId) a.courtId = doc.courtId; for (const k of ["appointer", "appointedBy", "positions", "dateStart", "title"]) if (meta[k] != null) a[k === "appointer" ? "appointedBy" : k] = meta[k]; }
      else if (doc.courtId && (doc.kind === "docket" || doc.kind === "docket_entry") && m.role !== "transferee judge") { a.courtId = doc.courtId; if (doc.court) a.court = doc.court; }
      break;
    case "attorney":
      if (m.role) a.role = m.role;
      if (doc.kind === "attorney") for (const k of ["bar", "firm", "role", "side"]) if (meta[k] != null) a[k] = meta[k];
      break;
    case "firm":
      if (doc.kind === "firm") for (const k of ["city", "side"]) if (meta[k] != null) a[k] = meta[k];
      break;
    case "mdl": {
      const n = m.name.replace(/\D/g, "");
      if (n) a.mdlNumber = n;
      if (doc.kind === "mdl") { if (doc.courtId) a.transfereeCourt = doc.courtId; if (doc.court) a.court = doc.court; for (const k of ["transferDate", "judge", "status", "docketIds"]) if (meta[k] != null) a[k] = meta[k]; if (doc.docketNumber) a.docketNumber = doc.docketNumber; }
      break;
    }
    case "product":
      if (doc.kind === "recall") { const firm = str(meta.recallingFirm) ?? str(meta.recalling_firm); if (firm) a.manufacturer = firm; if (meta.classification) a.lastRecallClass = meta.classification; }
      break;
    case "regulation": {
      const c = m.name.match(/^(\d+)\s+C\.F\.R\.\s+§\s+(\d+)(?:\.(\d+))?/);
      if (c) { a.cfrCite = m.name; a.title = Number(c[1]); a.part = Number(c[2]); if (c[3]) a.section = `${c[2]}.${c[3]}`; }
      if (doc.kind === "regulation" && doc.citation && canonicalKey(doc.citation).includes(canonicalKey(m.name))) { a.heading = doc.title; if (doc.agencies.length) a.agencies = doc.agencies; }
      break;
    }
    case "statute": {
      const c = m.name.match(/^(\d+)\s+U\.S\.C\.\s+§\s+(\S+)/);
      if (c) { a.uscCite = m.name; a.title = Number(c[1]); a.section = c[2]; }
      if (doc.kind === "statute") a.heading = doc.title;
      break;
    }
    case "court":
      if (m.externalId?.startsWith("cl:court:")) a.courtId = m.externalId.slice("cl:court:".length);
      break;
    case "party":
      if (m.role) a.role = m.role;
      break;
    default:
      break;
  }
  return a;
}

function externalIdsFor(m: IntelEntityMention): Record<string, string> | undefined {
  if (!m.externalId) return undefined;
  const [scheme, ...rest] = m.externalId.split(":");
  if (scheme === "cl" && rest[0] === "court") return { courtlistener: rest.slice(1).join(":") };
  if (scheme === "cl" && rest[0] === "person") return { courtlistener_person: rest.slice(1).join(":") };
  if (scheme === "jpml") return { jpml: rest.join(":") };
  if (scheme === "cfr" || scheme === "usc") return { [scheme]: rest.join(":") };
  return { [scheme]: rest.join(":") };
}

/** First chunk that mentions the name (or an alias), with a short quote around it. */
function evidenceFor(name: string, aliases: string[], chunks: ReturnType<typeof listChunks>): { chunkId?: string; quote?: string } {
  const needles = [name, ...aliases].map((s) => s.toLowerCase()).filter((s) => s.length >= 3).sort((a, b) => b.length - a.length);
  for (const c of chunks) {
    const lower = c.text.toLowerCase();
    for (const n of needles) {
      const i = lower.indexOf(n);
      if (i < 0) continue;
      const start = Math.max(0, i - 90), end = Math.min(c.text.length, i + n.length + 90);
      return { chunkId: c.id, quote: `${start > 0 ? "…" : ""}${c.text.slice(start, end).replace(/\s+/g, " ").trim()}${end < c.text.length ? "…" : ""}` };
    }
  }
  return {};
}

export interface ResolveResult { docId: string; entities: IntelEntity[]; linked: number; created: number }

/**
 * Resolve every mention of one document into entities, attach evidence and
 * fill the document's typed link fields. Idempotent: re-running merges into the
 * same entities (alias or external id match) and recomputes mention counts.
 */
export function resolveEntities(docOrId: IntelDocument | string, opts: { now?: string; text?: string } = {}): ResolveResult | null {
  const doc = typeof docOrId === "string" ? intelDocuments().get(docOrId) : docOrId;
  if (!doc) return null;
  const now = opts.now ?? new Date().toISOString();
  const text = opts.text ?? getDocumentText(doc.id) ?? "";
  const mentions = extractMentions(doc, text);
  const chunks = listChunks(doc.id);
  const before = intelEntities().count();
  const resolved: IntelEntity[] = [];
  for (const m of mentions) {
    const externalIds = externalIdsFor(m);
    const existing = findEntity(m.type, m.name, externalIds);
    const ev = evidenceFor(m.name, existing?.aliases ?? [], chunks);
    const input: EntityInput = {
      type: m.type,
      name: m.name,
      externalIds,
      attributes: attributesFor(m, doc),
      docId: doc.id,
      source: { docId: doc.id, chunkId: ev.chunkId, quote: ev.quote, url: doc.url },
    };
    const entity = upsertEntity(input, now);
    resolved.push(entity);
  }
  // Mention counts follow the number of linked documents (re-runs must not double count).
  const seen = new Set<string>();
  for (const e of resolved) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    intelEntities().update(e.id, (cur) => ({ ...cur, mentionCount: cur.docIds.length, updatedAt: now }));
  }
  const byType = (t: IntelEntityType) => Array.from(new Set(resolved.filter((e) => e.type === t).map((e) => e.id)));
  const next: IntelDocument = {
    ...doc,
    judgeIds: uniq([...doc.judgeIds, ...byType("judge")]),
    attorneyIds: uniq([...doc.attorneyIds, ...byType("attorney")]),
    firmIds: uniq([...doc.firmIds, ...byType("firm")]),
    partyIds: uniq([...doc.partyIds, ...byType("party")]),
    productIds: uniq([...doc.productIds, ...byType("product")]),
    mdlId: doc.mdlId ?? byType("mdl")[0],
    agencies: uniq([...doc.agencies, ...resolved.filter((e) => e.type === "agency").map((e) => e.name)]),
    meta: { ...(doc.meta ?? {}), entityIds: Array.from(seen), entitiesResolvedAt: now },
  };
  const changed = JSON.stringify([next.judgeIds, next.attorneyIds, next.firmIds, next.partyIds, next.productIds, next.mdlId, next.agencies, next.meta?.entityIds]) !== JSON.stringify([doc.judgeIds, doc.attorneyIds, doc.firmIds, doc.partyIds, doc.productIds, doc.mdlId, doc.agencies, doc.meta?.entityIds]);
  if (changed) {
    // Link fields only: keep updatedAt so freshness/analysis cadences stay honest, but refresh the vector metadata used by search filters.
    intelDocuments().put(next);
    refreshVectorMeta(next);
  }
  return { docId: doc.id, entities: Array.from(new Map(resolved.map((e) => [e.id, e])).values()), linked: seen.size, created: intelEntities().count() - before };
}

function uniq(list: (string | undefined)[]): string[] {
  return Array.from(new Set(list.filter((x): x is string => Boolean(x))));
}

/** Update the `meta` column of a document's vector rows (entity ids, matters) without re-embedding. */
export function refreshVectorMeta(doc: IntelDocument): void {
  try {
    const raw = db().raw;
    const upd = raw.prepare("UPDATE vectors SET meta = ? WHERE collection = ? AND doc_id = ?");
    for (const c of listChunks(doc.id)) upd.run(JSON.stringify(docMetaForVector(doc, c)), INTEL_VECTOR_NAMESPACE, c.id);
    // The vector store caches parsed rows per collection; drop the cached namespace so filters see the new metadata.
    const g = globalThis as typeof globalThis & { __leclaudeVecCache?: Map<string, unknown> };
    g.__leclaudeVecCache?.delete(INTEL_VECTOR_NAMESPACE);
  } catch { /* vectors table not ready */ }
}

export interface RebuildOptions { docIds?: string[]; since?: string; now?: string; limit?: number }

/** Resolve entities for many documents (all, a list, or those updated since a timestamp). */
export function rebuildEntities(opts: RebuildOptions = {}): { docs: number; linked: number; created: number; entities: number } {
  const now = opts.now ?? new Date().toISOString();
  let docs = opts.docIds?.length ? opts.docIds.map((id) => intelDocuments().get(id)).filter((d): d is IntelDocument => Boolean(d)) : intelDocuments().all();
  if (opts.since) docs = docs.filter((d) => d.updatedAt >= opts.since! || !d.meta?.entitiesResolvedAt);
  docs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (opts.limit) docs = docs.slice(0, opts.limit);
  let linked = 0, created = 0;
  for (const d of docs) { const r = resolveEntities(d, { now }); if (r) { linked += r.linked; created += r.created; } }
  return { docs: docs.length, linked, created, entities: intelEntities().count() };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Documents linked to an entity: the entity's own list plus documents whose typed fields reference it. */
export function entityDocuments(entityId: string, opts: { limit?: number } = {}): IntelDocument[] {
  const e = intelEntities().get(entityId);
  const ids = new Set(e?.docIds ?? []);
  const docs = intelDocuments().find((d) => ids.has(d.id) || entityIdsOf(d).includes(entityId) || (Array.isArray(d.meta?.entityIds) && (d.meta!.entityIds as string[]).includes(entityId)));
  docs.sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? "") || b.updatedAt.localeCompare(a.updatedAt));
  return opts.limit ? docs.slice(0, opts.limit) : docs;
}

export function dateOf(d: IntelDocument): string | undefined {
  return d.dates.decided ?? d.dates.filed ?? d.dates.published ?? d.dates.effective ?? d.dates.event ?? d.dates.modified;
}

export function entityDetail(e: IntelEntity): string | undefined {
  const a = e.attributes;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  switch (e.type) {
    case "judge": return [s("title"), s("court") ?? (s("courtId") ? COURT_NAMES[s("courtId")!] ?? s("courtId") : undefined)].filter(Boolean).join(" · ") || undefined;
    case "attorney": { const firm = s("firmId") ? intelEntities().get(s("firmId")!)?.name : s("firm"); return [s("role"), firm, s("bar") ? `${s("bar")} bar` : undefined].filter(Boolean).join(" · ") || undefined; }
    case "firm": return [s("city"), s("side") ? `${s("side")} side` : undefined].filter(Boolean).join(" · ") || undefined;
    case "mdl": return [s("transfereeCourt") ? COURT_NAMES[s("transfereeCourt")!] ?? s("transfereeCourt") : s("court"), e.aliases[0]].filter(Boolean).join(" · ") || undefined;
    case "product": return [s("category"), s("manufacturer")].filter(Boolean).join(" · ") || undefined;
    case "court": return s("circuit") ? `${s("circuit")}` : s("courtId");
    case "regulation": return s("heading");
    case "statute": return s("heading");
    case "party": return s("role") ? `${s("role")}${s("industry") ? ` · ${s("industry")}` : ""}` : s("industry");
    case "agency": return Array.isArray(a.cfrTitles) ? `CFR title${(a.cfrTitles as number[]).length > 1 ? "s" : ""} ${(a.cfrTitles as number[]).join(", ")}` : undefined;
    default: return undefined;
  }
}

export interface ListEntitiesOptions { type?: IntelEntityType | IntelEntityType[]; q?: string; ids?: string[]; watchedBy?: string; onlyWatched?: boolean; flagged?: boolean; sort?: "name" | "mentions" | "documents" | "updated" | "lastSeen"; direction?: "asc" | "desc"; limit?: number; offset?: number }

export function listEntities(o: ListEntitiesOptions = {}): EntityListResult {
  const types = o.type ? (Array.isArray(o.type) ? o.type : [o.type]) : undefined;
  const q = o.q?.trim().toLowerCase();
  const idSet = o.ids ? new Set(o.ids) : undefined;
  const watched = o.watchedBy ? new Set(intelWatches().find((w) => w.userId === o.watchedBy).map((w) => w.target)) : new Set<string>();
  const relCounts = new Map<string, number>();
  for (const r of intelRelations().all()) { relCounts.set(r.from, (relCounts.get(r.from) ?? 0) + 1); relCounts.set(r.to, (relCounts.get(r.to) ?? 0) + 1); }
  const docs = intelDocuments().all();
  const lastSeen = new Map<string, string>();
  for (const d of docs) { const date = dateOf(d); if (!date) continue; for (const id of [...entityIdsOf(d), ...((d.meta?.entityIds as string[] | undefined) ?? [])]) { const cur = lastSeen.get(id); if (!cur || date > cur) lastSeen.set(id, date); } }
  const all = intelEntities().all();
  const counts: Partial<Record<IntelEntityType, number>> = {};
  for (const e of all) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const items: EntityListItem[] = all
    .filter((e) => (!types || types.includes(e.type)) && (!idSet || idSet.has(e.id)) && (!o.onlyWatched || watched.has(e.id)) && (o.flagged === undefined || Boolean(e.flags?.length) === o.flagged) && (!q || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)) || (entityDetail(e) ?? "").toLowerCase().includes(q)))
    .map((e) => ({ id: e.id, type: e.type, name: e.name, aliases: e.aliases, detail: entityDetail(e), mentionCount: e.mentionCount, documents: e.docIds.length, relations: relCounts.get(e.id) ?? 0, lastSeen: lastSeen.get(e.id), flags: e.flags ?? [], watched: watched.has(e.id), seeded: Boolean(e.attributes.seeded), updatedAt: e.updatedAt }));
  const dir = o.direction === "asc" ? 1 : -1;
  const sort = o.sort ?? "documents";
  items.sort((a, b) => {
    const k = sort === "name" ? a.name.localeCompare(b.name) * -1 : sort === "mentions" ? a.mentionCount - b.mentionCount : sort === "updated" ? a.updatedAt.localeCompare(b.updatedAt) : sort === "lastSeen" ? (a.lastSeen ?? "").localeCompare(b.lastSeen ?? "") : a.documents - b.documents;
    return k * dir || a.name.localeCompare(b.name);
  });
  const limit = Math.max(1, Math.min(o.limit ?? 200, 2000));
  const offset = Math.max(0, o.offset ?? 0);
  return { items: items.slice(offset, offset + limit), total: items.length, counts, limit, offset };
}

/** Flag or unflag an entity (needs_review / low_confidence) — used by the sweep and the UI. */
export function flagEntity(id: string, flag: Omit<IntelFlag, "at"> & { at?: string }): IntelEntity | null {
  return intelEntities().update(id, (e) => ({ ...e, flags: [...(e.flags ?? []).filter((f) => f.kind !== flag.kind), { ...flag, at: flag.at ?? new Date().toISOString() }], updatedAt: new Date().toISOString() }));
}
