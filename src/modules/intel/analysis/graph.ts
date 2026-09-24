import "server-only";
import { sha256 } from "@/lib/integrity/hash";
import type { IntelDocument, IntelEntity, IntelEntityMention, IntelEntitySourceRef, IntelRelation, IntelRelationType } from "../types";
import { canonicalKey } from "../mentions";
import { entityIdsOf, findEntity, getDocumentText, intelDocuments, intelEntities, intelRelations, listChunks } from "../store";
import { dateOf } from "./entities";
import { clip } from "./pure";
import type { GraphExport, GraphLinkExport, GraphNodeExport } from "./types";

/**
 * Knowledge graph: relations between entities derived deterministically from
 * the documents that mention them (judge presides over an MDL, counsel appears
 * before a judge, an agency regulates a product, a manufacturer recalled it…).
 * Every edge carries a weight (independent documents), a confidence and
 * evidence references, and is rebuilt idempotently.
 */

export const UNDIRECTED: Set<IntelRelationType> = new Set(["co_counsel", "opposes"]);

export function relationId(from: string, to: string, type: IntelRelationType): string {
  return `irel_${sha256(`${from}|${to}|${type}`).slice(0, 16)}`;
}

interface Acc { from: string; to: string; type: IntelRelationType; docs: Map<string, IntelEntitySourceRef>; confidences: number[]; dates: string[] }

function accKey(from: string, to: string, type: IntelRelationType): [string, string] {
  return UNDIRECTED.has(type) && to < from ? [to, from] : [from, to];
}

/** Entity ids linked to each document (typed fields + meta.entityIds + entity.docIds). */
function docEntityIndex(docs: IntelDocument[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  const add = (docId: string, id: string) => { const s = idx.get(docId) ?? new Set<string>(); s.add(id); idx.set(docId, s); };
  const docIds = new Set(docs.map((d) => d.id));
  for (const d of docs) { for (const id of entityIdsOf(d)) add(d.id, id); for (const id of (d.meta?.entityIds as string[] | undefined) ?? []) add(d.id, id); }
  for (const e of intelEntities().all()) for (const id of e.docIds) if (docIds.has(id)) add(id, e.id);
  return idx;
}

function roleIndex(doc: IntelDocument): Map<string, string> {
  const m = new Map<string, string>();
  const stubs = Array.isArray(doc.meta?.entities) ? (doc.meta!.entities as IntelEntityMention[]) : [];
  for (const s of stubs) if (s?.name && s.role) m.set(`${s.type}|${canonicalKey(s.name)}`, s.role.toLowerCase());
  return m;
}

function sideOf(role: string | undefined): "plaintiff" | "defendant" | undefined {
  if (!role) return undefined;
  if (/plaintiff|claimant|petitioner|movant\b/.test(role) && !/defen/.test(role)) return "plaintiff";
  if (/defen|respondent|manufacturer/.test(role)) return "defendant";
  return undefined;
}

/** Pair attorneys with firms named next to them in the text ("Michael A. London (Douglas & London, P.C.)"). */
function pairCounsel(text: string, attorneys: IntelEntity[], firms: IntelEntity[]): [IntelEntity, IntelEntity][] {
  const out: [IntelEntity, IntelEntity][] = [];
  if (!text || !attorneys.length || !firms.length) return out;
  const lower = text.toLowerCase();
  for (const a of attorneys) {
    const names = [a.name, ...a.aliases].map((n) => n.toLowerCase());
    for (const f of firms) {
      const fnames = [f.name, ...f.aliases].map((n) => n.toLowerCase());
      const hit = names.some((an) => { const i = lower.indexOf(an); if (i < 0) return false; const window = lower.slice(i, i + an.length + 80); return fnames.some((fn) => window.includes(fn)); });
      if (hit) { out.push([a, f]); break; }
    }
  }
  return out;
}

export interface BuildRelationsOptions { docIds?: string[]; now?: string; reset?: boolean }

/** Rebuild relations from documents (all, or a subset merged into the existing edges). */
export function buildRelations(opts: BuildRelationsOptions = {}): { total: number; created: number; updated: number } {
  const now = opts.now ?? new Date().toISOString();
  const docs = opts.docIds?.length ? opts.docIds.map((id) => intelDocuments().get(id)).filter((d): d is IntelDocument => Boolean(d)) : intelDocuments().all();
  const entityById = new Map(intelEntities().all().map((e) => [e.id, e]));
  const idx = docEntityIndex(docs);
  const acc = new Map<string, Acc>();
  const add = (from: string | undefined, to: string | undefined, type: IntelRelationType, doc: IntelDocument, ref: IntelEntitySourceRef) => {
    if (!from || !to || from === to) return;
    const [f, t] = accKey(from, to, type);
    const key = `${f}|${t}|${type}`;
    const a: Acc = acc.get(key) ?? { from: f, to: t, type, docs: new Map<string, IntelEntitySourceRef>(), confidences: [], dates: [] };
    if (!a.docs.has(doc.id)) { a.docs.set(doc.id, ref); a.confidences.push(doc.confidence); const d = dateOf(doc); if (d) a.dates.push(d); }
    acc.set(key, a);
  };
  const courtEntityFor = (courtId: string | undefined) => (courtId ? intelEntities().findOne((e) => e.type === "court" && (e.externalIds?.courtlistener === courtId || e.attributes.courtId === courtId)) : null);

  for (const doc of docs) {
    const ids = Array.from(idx.get(doc.id) ?? []);
    const ents = ids.map((id) => entityById.get(id)).filter((e): e is IntelEntity => Boolean(e));
    const by = (t: IntelEntity["type"]) => ents.filter((e) => e.type === t);
    const roles = roleIndex(doc);
    const roleOf = (e: IntelEntity) => roles.get(`${e.type}|${canonicalKey(e.name)}`) ?? [...e.aliases].map((a) => roles.get(`${e.type}|${canonicalKey(a)}`)).find(Boolean) ?? (typeof e.attributes.role === "string" ? (e.attributes.role as string).toLowerCase() : undefined);
    const chunk0 = listChunks(doc.id)[0];
    const ref: IntelEntitySourceRef = { docId: doc.id, chunkId: chunk0?.id, quote: clip(doc.summary ?? doc.title, 160), url: doc.url };
    const judges = by("judge"), attorneys = by("attorney"), firms = by("firm"), parties = by("party"), products = by("product"), mdls = by("mdl"), agencies = by("agency"), regs = by("regulation"), statutes = by("statute");
    const court = courtEntityFor(doc.courtId) ?? by("court")[0];
    const mdl = mdls[0];
    const litigation = doc.kind === "docket" || doc.kind === "docket_entry" || doc.kind === "opinion" || doc.kind === "mdl";

    for (const j of judges) {
      if (mdl && litigation) add(j.id, mdl.id, "presides", doc, ref);
      if (court && roleOf(j) !== "transferee judge") add(j.id, court.id, "member_of", doc, ref);
      for (const a of attorneys) add(a.id, j.id, "before_judge", doc, ref);
      for (const f of firms) add(f.id, j.id, "before_judge", doc, ref);
    }
    if (mdl) {
      for (const a of attorneys) add(a.id, mdl.id, "appears_in", doc, ref);
      for (const f of firms) add(f.id, mdl.id, "appears_in", doc, ref);
      for (const p of parties) add(p.id, mdl.id, "appears_in", doc, ref);
      for (const p of products) add(p.id, mdl.id, "appears_in", doc, ref);
      for (const r of [...regs, ...statutes]) add(mdl.id, r.id, "cites", doc, ref);
      const transferee = typeof mdl.attributes.transfereeCourt === "string" ? courtEntityFor(mdl.attributes.transfereeCourt as string) : null;
      const target = transferee ?? (doc.kind === "mdl" ? court : null);
      if (target) add(mdl.id, target.id, "transferred_to", doc, ref);
    } else if (court && doc.kind === "opinion") {
      for (const r of [...regs, ...statutes]) add(court.id, r.id, "cites", doc, ref);
    }
    // Counsel: firm membership (attribute or adjacency in the text), co-counsel on the same side, representation.
    const text = attorneys.length && firms.length ? getDocumentText(doc.id) ?? "" : "";
    const paired = new Set<string>();
    for (const a of attorneys) {
      const firmId = typeof a.attributes.firmId === "string" ? (a.attributes.firmId as string) : undefined;
      if (firmId && entityById.has(firmId)) { add(a.id, firmId, "employed_by", doc, ref); paired.add(a.id); }
    }
    for (const [a, f] of pairCounsel(text, attorneys.filter((a) => !paired.has(a.id)), firms)) add(a.id, f.id, "employed_by", doc, ref);
    const side = (e: IntelEntity) => sideOf(roleOf(e));
    for (let i = 0; i < attorneys.length; i++) for (let j = i + 1; j < attorneys.length; j++) { const sa = side(attorneys[i]), sb = side(attorneys[j]); if (sa && sa === sb) add(attorneys[i].id, attorneys[j].id, "co_counsel", doc, ref); }
    for (const a of attorneys) { const sa = side(a); if (!sa) continue; for (const p of parties) if (side(p) === sa) add(a.id, p.id, "represents", doc, ref); }
    for (const f of firms) { const sf = side(f) ?? (typeof f.attributes.side === "string" ? sideOf(`${f.attributes.side}s`) : undefined); if (!sf) continue; for (const p of parties) if (side(p) === sf) add(f.id, p.id, "represents", doc, ref); }
    const plaintiffs = parties.filter((p) => side(p) === "plaintiff"), defendants = parties.filter((p) => side(p) === "defendant");
    let pairs = 0;
    for (const p of plaintiffs) for (const d of defendants) { if (pairs++ > 24) break; add(p.id, d.id, "opposes", doc, ref); }
    // Regulators, recalls and manufacturers.
    for (const ag of agencies) {
      for (const r of regs) if (doc.kind === "regulation" || doc.kind === "register_notice") add(ag.id, r.id, "regulates", doc, ref);
      for (const p of products) add(ag.id, p.id, "regulates", doc, ref);
    }
    if (doc.kind === "recall" || doc.kind === "adverse_event") {
      for (const p of products) for (const m of parties.filter((x) => /manufactur/.test(roleOf(x) ?? ""))) add(m.id, p.id, doc.kind === "recall" ? "recalled" : "manufactures", doc, ref);
    }
    for (const p of products) {
      const maker = typeof p.attributes.manufacturer === "string" ? findEntity("party", p.attributes.manufacturer as string) : null;
      if (maker) add(maker.id, p.id, "manufactures", doc, ref);
    }
  }

  const col = intelRelations();
  const existing = new Map(col.all().map((r) => [r.id, r]));
  const touched = new Set<string>();
  let created = 0, updated = 0;
  const rows: IntelRelation[] = [];
  for (const a of acc.values()) {
    const id = relationId(a.from, a.to, a.type);
    const prev = opts.reset ? undefined : existing.get(id);
    const evidenceMap = new Map<string, IntelEntitySourceRef>();
    for (const e of prev?.evidence ?? []) evidenceMap.set(e.docId, e);
    for (const [docId, ref] of a.docs) evidenceMap.set(docId, ref);
    const evidence = Array.from(evidenceMap.values()).slice(-12);
    const weight = evidenceMap.size;
    const avgConf = a.confidences.reduce((x, y) => x + y, 0) / Math.max(1, a.confidences.length);
    const confidence = Math.min(0.97, Math.max(0.2, (0.5 + 0.1 * (weight - 1)) * Math.min(1, avgConf / 0.8)));
    const dates = [...a.dates, ...(prev ? [prev.firstSeen, prev.lastSeen] : [])].filter(Boolean).sort();
    const row: IntelRelation = { id, from: a.from, to: a.to, type: a.type, evidence, confidence: Number(confidence.toFixed(3)), weight, firstSeen: dates[0] ?? prev?.firstSeen ?? now, lastSeen: dates[dates.length - 1] ?? now };
    touched.add(id);
    if (!prev) created++;
    else if (JSON.stringify({ ...prev, evidence: prev.evidence.length }) !== JSON.stringify({ ...row, evidence: row.evidence.length })) updated++;
    rows.push(row);
  }
  if (opts.reset) for (const id of existing.keys()) if (!touched.has(id)) col.delete(id);
  if (rows.length) col.putMany(rows);
  return { total: col.count(), created, updated };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface NeighborhoodOptions { types?: IntelRelationType[]; minWeight?: number; limit?: number; entityTypes?: IntelEntity["type"][] }

export function relationsOf(entityId: string, opts: NeighborhoodOptions = {}): IntelRelation[] {
  return intelRelations().find((r) => (r.from === entityId || r.to === entityId) && (!opts.types?.length || opts.types.includes(r.type)) && r.weight >= (opts.minWeight ?? 1)).sort((a, b) => b.weight - a.weight || b.confidence - a.confidence);
}

/** BFS neighborhood up to `depth` hops (default 1), bounded by `limit` nodes (default 60). */
export function neighborhood(entityId: string, depth = 1, opts: NeighborhoodOptions = {}): { nodes: IntelEntity[]; edges: IntelRelation[] } {
  const limit = opts.limit ?? 60;
  const start = intelEntities().get(entityId);
  if (!start) return { nodes: [], edges: [] };
  const nodes = new Map<string, IntelEntity>([[start.id, start]]);
  const edges = new Map<string, IntelRelation>();
  let frontier = [start.id];
  for (let d = 0; d < Math.max(0, depth) && frontier.length && nodes.size < limit; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const r of relationsOf(id, opts)) {
        const other = r.from === id ? r.to : r.from;
        const e = intelEntities().get(other);
        if (!e || (opts.entityTypes?.length && !opts.entityTypes.includes(e.type))) continue;
        edges.set(r.id, r);
        if (!nodes.has(other)) { if (nodes.size >= limit) continue; nodes.set(other, e); next.push(other); }
      }
    }
    frontier = next;
  }
  // Edges among the collected nodes that BFS did not traverse (closing triangles) keep the picture honest.
  for (const r of intelRelations().all()) if (nodes.has(r.from) && nodes.has(r.to) && !edges.has(r.id) && (!opts.types?.length || opts.types.includes(r.type)) && r.weight >= (opts.minWeight ?? 1)) edges.set(r.id, r);
  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
}

export interface GraphExportOptions extends NeighborhoodOptions { entityId?: string; depth?: number; limit?: number }

/** Node/link export for d3-force: a neighborhood when `entityId` is set, else the most connected entities. */
export function graphExport(opts: GraphExportOptions = {}): GraphExport {
  const limit = opts.limit ?? 80;
  const depth = opts.depth ?? 1;
  let nodes: IntelEntity[];
  let edges: IntelRelation[];
  let truncated = false;
  if (opts.entityId) {
    const n = neighborhood(opts.entityId, depth, { ...opts, limit });
    nodes = n.nodes; edges = n.edges;
    truncated = n.nodes.length >= limit;
  } else {
    const degree = new Map<string, number>();
    const all = intelRelations().find((r) => (!opts.types?.length || opts.types.includes(r.type)) && r.weight >= (opts.minWeight ?? 1));
    for (const r of all) { degree.set(r.from, (degree.get(r.from) ?? 0) + r.weight); degree.set(r.to, (degree.get(r.to) ?? 0) + r.weight); }
    const ranked = Array.from(degree.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => intelEntities().get(id)).filter((e): e is IntelEntity => Boolean(e) && (!opts.entityTypes?.length || opts.entityTypes.includes(e!.type)));
    truncated = ranked.length > limit;
    nodes = ranked.slice(0, limit);
    const keep = new Set(nodes.map((n) => n.id));
    edges = all.filter((r) => keep.has(r.from) && keep.has(r.to));
  }
  const deg = new Map<string, number>();
  for (const r of edges) { deg.set(r.from, (deg.get(r.from) ?? 0) + 1); deg.set(r.to, (deg.get(r.to) ?? 0) + 1); }
  const out: GraphNodeExport[] = nodes.map((e) => ({ id: e.id, label: e.name, type: e.type, degree: deg.get(e.id) ?? 0, mentionCount: e.mentionCount, documents: e.docIds.length, flagged: Boolean(e.flags?.length) }));
  const links: GraphLinkExport[] = edges.map((r) => ({ id: r.id, source: r.from, target: r.to, type: r.type, weight: r.weight, confidence: r.confidence, evidence: r.evidence.slice(0, 5) }));
  return { nodes: out, links, center: opts.entityId, depth, truncated };
}
