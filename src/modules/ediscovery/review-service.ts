import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { audit, listAudit } from "@/lib/integrity/audit";
import { currentUser } from "@/lib/current-user";
import type { CodingDecision, EDocument, ProductionSet, Redaction, ReviewBatch, ReviewLayout, SavedSearchRecord, SearchTermReport, SearchTermReportRow } from "@/lib/types/domain";
import { batchProgress, deriveBatchStatus, disagreementReport, makeQcDecision, nextQc, nextUncoded, sampleIds } from "./batch-pure";
import { detectNearDuplicates, nearDuplicateMap } from "./near-dup";
import { assignBates, canTransition, isProductionReady, nextBatesNumber, productionOrder, qcProduction } from "./production-pure";
import { compareBates, highlightRegex, matchesQuery, parseQuery } from "./query";
import { applyTextRedactions, defaultRedactionLabel, validateRedaction } from "./redaction-pure";
import { batches, layouts, productions, redactions, redactionsForDoc, redactionsForMatter, savedSearches, termReports } from "./review-store";
import { applyFilters, matterDocs, searchDocuments, toSearchable } from "./service";
import type { BatchCreateInput, DocHistoryEntry, ProductionCreateInput, ProductionSummary2, RedactionInput, ReviewBatchSummary, ReviewLayoutInput, SavedSearchInput, SearchFilters, SearchTermReportRequest } from "./types";

const now = () => new Date().toISOString();
const me = () => currentUser((id) => db().people.get(id)?.name);
const personName = (id?: string) => (id ? db().people.get(id)?.name : undefined);

export class ReviewError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "ReviewError"; }
}

// ---------------------------------------------------------------------------
// Document sets (shared by batches and productions)
// ---------------------------------------------------------------------------

async function resolveDocSet(input: { matterId: string; ids?: string[]; q?: string; view?: string; filters?: SearchFilters; savedSearchId?: string }): Promise<{ docs: EDocument[]; source: ReviewBatch["source"] }> {
  const all = matterDocs(input.matterId);
  if (input.ids?.length) {
    const set = new Set(input.ids);
    return { docs: all.filter((d) => set.has(d.id)).sort((a, b) => compareBates(a.bates, b.bates)), source: { kind: "selection" } };
  }
  let q = input.q, view = input.view, filters = input.filters;
  if (input.savedSearchId) {
    const s = savedSearches().get(input.savedSearchId);
    if (!s) throw new ReviewError(`No saved search ${input.savedSearchId}`, 404);
    q = s.q; view = s.view ?? view; filters = (s.filters as SearchFilters | undefined) ?? filters;
  }
  if (!q && !view && !filters) return { docs: [...all].sort((a, b) => compareBates(a.bates, b.bates)), source: { kind: "all" } };
  const res = await searchDocuments({ matterId: input.matterId, q, view: view as never, filters, limit: 5000, sort: "bates" });
  const ids = new Set(res.hits.map((h) => h.id));
  return { docs: all.filter((d) => ids.has(d.id)).sort((a, b) => compareBates(a.bates, b.bates)), source: { kind: "search", q, view, filters: filters as Record<string, string[]> | undefined, savedSearchId: input.savedSearchId } };
}

// ---------------------------------------------------------------------------
// Review batches
// ---------------------------------------------------------------------------

function summarize(b: ReviewBatch): ReviewBatchSummary {
  const progress = batchProgress(b, (id) => db().edocs.get(id)?.coding);
  return { ...b, status: deriveBatchStatus(b, progress), progress, assigneeName: personName(b.assigneeId), createdByName: personName(b.createdBy) };
}

export function listBatches(matterId: string, opts: { assigneeId?: string; status?: ReviewBatch["status"] } = {}): ReviewBatchSummary[] {
  return batches()
    .find((b) => b.matterId === matterId && (!opts.assigneeId || b.assigneeId === opts.assigneeId))
    .map(summarize)
    .filter((b) => !opts.status || b.status === opts.status)
    .sort((a, b) => Number(a.status === "complete") - Number(b.status === "complete") || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || a.createdAt.localeCompare(b.createdAt));
}

export function getBatch(id: string): (ReviewBatchSummary & { disagreements: ReturnType<typeof disagreementReport> }) | null {
  const b = batches().get(id);
  if (!b) return null;
  return { ...summarize(b), disagreements: disagreementReport(b) };
}

export async function createBatches(input: BatchCreateInput, createdBy = me().id): Promise<ReviewBatch[]> {
  if (!input.name?.trim()) throw new ReviewError("`name` is required");
  const { docs, source } = await resolveDocSet(input);
  const pool = (input.uncodedOnly ?? true) && !input.ids?.length ? docs.filter((d) => d.coding.responsive == null || input.secondPass) : docs;
  if (!pool.length) throw new ReviewError("No documents match the batch definition");
  const size = input.size && input.size > 0 ? Math.floor(input.size) : pool.length;
  const chunks: EDocument[][] = [];
  for (let i = 0; i < pool.length; i += size) chunks.push(pool.slice(i, i + size));
  const ts = now();
  const out: ReviewBatch[] = chunks.map((chunk, i) => {
    const id = `rb_${nanoid(8)}`;
    const docIds = chunk.map((d) => d.id);
    const pct = Math.max(0, Math.min(100, input.qcSamplePercent ?? 0));
    return {
      id, matterId: input.matterId, name: chunks.length > 1 ? `${input.name.trim()} ${String(i + 1).padStart(2, "0")}` : input.name.trim(), description: input.description?.trim() || undefined,
      docIds, source, assigneeId: input.assigneeId || undefined, priority: input.priority ?? "normal", dueAt: input.dueAt || undefined, status: "open",
      qcSamplePercent: pct, qcSampleIds: sampleIds(docIds, pct, id), secondPass: !!input.secondPass, qcDecisions: {}, createdBy, createdAt: ts, updatedAt: ts,
    };
  });
  batches().putMany(out);
  audit("create", { kind: "reviewBatch", id: out[0].id, label: `${out.length} review batch${out.length === 1 ? "" : "es"} (${pool.length} docs)`, matterId: input.matterId }, { names: out.map((b) => b.name), assigneeId: input.assigneeId, qcSamplePercent: input.qcSamplePercent, source }, me());
  return out;
}

export function updateBatch(id: string, patch: Partial<Pick<ReviewBatch, "name" | "description" | "assigneeId" | "priority" | "dueAt" | "status" | "qcSamplePercent" | "secondPass">>): ReviewBatch | null {
  const cur = batches().get(id);
  if (!cur) return null;
  const next: ReviewBatch = { ...cur, ...patch, updatedAt: now() };
  if (patch.qcSamplePercent != null && patch.qcSamplePercent !== cur.qcSamplePercent) next.qcSampleIds = sampleIds(cur.docIds, patch.qcSamplePercent, cur.id);
  if (patch.status === "complete" && !cur.completedAt) next.completedAt = now();
  if (patch.status && patch.status !== "complete") delete next.completedAt;
  batches().put(next);
  audit("update", { kind: "reviewBatch", id, label: next.name, matterId: next.matterId }, { patch }, me());
  return next;
}

export function deleteBatch(id: string): boolean {
  const cur = batches().get(id);
  if (!cur) return false;
  batches().delete(id);
  audit("delete", { kind: "reviewBatch", id, label: cur.name, matterId: cur.matterId }, undefined, me());
  return true;
}

/** Next document to review inside a batch (QC sample when `qc`). */
export function nextInBatch(batchId: string, currentId: string | null, qc = false): { id: string | null; remaining: number } {
  const b = batches().get(batchId);
  if (!b) throw new ReviewError(`No batch ${batchId}`, 404);
  if (qc) return { id: nextQc(b, currentId), remaining: b.qcSampleIds.filter((x) => !b.qcDecisions[x]).length };
  const coding = (id: string) => db().edocs.get(id)?.coding;
  const id = nextUncoded(b.docIds, currentId, coding);
  return { id, remaining: b.docIds.filter((x) => coding(x)?.responsive == null).length };
}

/** Record a QC reviewer's call against the first-pass coding (called before the QC coding is saved). */
export function recordQcDecision(batchId: string, docId: string, qc: Pick<CodingDecision, "responsive" | "privileged" | "hot" | "issues">, reviewerId = me().id): ReviewBatch {
  const b = batches().get(batchId);
  if (!b) throw new ReviewError(`No batch ${batchId}`, 404);
  const doc = db().edocs.get(docId);
  if (!doc) throw new ReviewError(`No document ${docId}`, 404);
  if (!b.qcSampleIds.includes(docId)) throw new ReviewError(`${doc.bates} is not in the QC sample of ${b.name}`, 409);
  const decision = makeQcDecision(doc.coding, qc, reviewerId, now());
  const next: ReviewBatch = { ...b, qcDecisions: { ...b.qcDecisions, [docId]: decision }, updatedAt: now() };
  batches().put(next);
  audit("coding.change", { kind: "reviewBatch", id: b.id, label: `QC ${doc.bates} (${decision.agree ? "agree" : "disagree"})`, matterId: b.matterId }, { docId, agree: decision.agree, firstPass: decision.firstPass, qc: decision.qc }, { id: reviewerId, name: personName(reviewerId) ?? reviewerId });
  return next;
}

export function batchesForDoc(docId: string): { id: string; name: string; qc: boolean }[] {
  return batches().find((b) => b.docIds.includes(docId)).map((b) => ({ id: b.id, name: b.name, qc: b.qcSampleIds.includes(docId) }));
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

export function listSavedSearches(matterId: string, userId = me().id): SavedSearchRecord[] {
  return savedSearches().find((s) => s.matterId === matterId && (s.shared || s.ownerId === userId)).sort((a, b) => a.name.localeCompare(b.name));
}

export function createSavedSearch(input: SavedSearchInput, ownerId = me().id): SavedSearchRecord {
  if (!input.name?.trim()) throw new ReviewError("`name` is required");
  if (!input.q?.trim() && !input.view && !input.filters) throw new ReviewError("A saved search needs a query, a view or filters");
  const parsed = parseQuery(input.q ?? "");
  if (parsed.warnings.length) throw new ReviewError(`Query problems: ${parsed.warnings.join("; ")}`, 422);
  const ts = now();
  const rec: SavedSearchRecord = { id: `ss_${nanoid(8)}`, matterId: input.matterId, name: input.name.trim(), description: input.description?.trim() || undefined, q: input.q ?? "", view: input.view, filters: input.filters, sort: input.sort, dir: input.dir, semantic: input.semantic, ownerId, shared: !!input.shared, createdAt: ts, updatedAt: ts };
  savedSearches().put(rec);
  audit("create", { kind: "savedSearch", id: rec.id, label: rec.name, matterId: rec.matterId }, { q: rec.q, shared: rec.shared }, me());
  return rec;
}

export function updateSavedSearch(id: string, patch: Partial<Omit<SavedSearchRecord, "id" | "matterId" | "ownerId" | "createdAt">>): SavedSearchRecord | null {
  const cur = savedSearches().get(id);
  if (!cur) return null;
  if (patch.q != null) { const parsed = parseQuery(patch.q); if (parsed.warnings.length) throw new ReviewError(`Query problems: ${parsed.warnings.join("; ")}`, 422); }
  const next = savedSearches().put({ ...cur, ...patch, updatedAt: now() });
  audit("update", { kind: "savedSearch", id, label: next.name, matterId: next.matterId }, { patch }, me());
  return next;
}

export function deleteSavedSearch(id: string): boolean {
  const cur = savedSearches().get(id);
  if (!cur) return false;
  savedSearches().delete(id);
  audit("delete", { kind: "savedSearch", id, label: cur.name, matterId: cur.matterId }, undefined, me());
  return true;
}

/** Run a saved search and record its count. */
export async function runSavedSearch(id: string): Promise<{ search: SavedSearchRecord; total: number }> {
  const s = savedSearches().get(id);
  if (!s) throw new ReviewError(`No saved search ${id}`, 404);
  const res = await searchDocuments({ matterId: s.matterId, q: s.q, view: s.view as never, filters: s.filters as SearchFilters | undefined, semantic: s.semantic, limit: 1 });
  const next = savedSearches().put({ ...s, lastRunCount: res.total, lastRunAt: now() });
  return { search: next, total: res.total };
}

// ---------------------------------------------------------------------------
// Grid layouts (per user)
// ---------------------------------------------------------------------------

export function listLayouts(userId = me().id, matterId?: string): ReviewLayout[] {
  return layouts().find((l) => l.userId === userId && (!l.matterId || !matterId || l.matterId === matterId)).sort((a, b) => a.name.localeCompare(b.name));
}

export function saveLayout(input: ReviewLayoutInput, userId = me().id): ReviewLayout {
  if (!input.name?.trim()) throw new ReviewError("`name` is required");
  const name = input.name.trim().slice(0, 60);
  const existing = layouts().findOne((l) => l.userId === userId && l.name.toLowerCase() === name.toLowerCase() && (l.matterId ?? "") === (input.matterId ?? ""));
  const ts = now();
  const rec: ReviewLayout = { id: existing?.id ?? `rl_${nanoid(8)}`, userId, matterId: input.matterId || undefined, name, hiddenColumns: [...(input.hiddenColumns ?? [])], columnWidths: { ...(input.columnWidths ?? {}) }, density: input.density === "comfortable" ? "comfortable" : "compact", createdAt: existing?.createdAt ?? ts, updatedAt: ts };
  return layouts().put(rec);
}

export function deleteLayout(id: string, userId = me().id): boolean {
  const cur = layouts().get(id);
  if (!cur || cur.userId !== userId) return false;
  return layouts().delete(id);
}

// ---------------------------------------------------------------------------
// Redactions
// ---------------------------------------------------------------------------

export function listRedactions(opts: { docId?: string; matterId?: string }): Redaction[] {
  if (opts.docId) return redactionsForDoc(opts.docId);
  if (opts.matterId) return redactionsForMatter(opts.matterId);
  return [];
}

export function createRedaction(input: RedactionInput, createdBy = me().id): Redaction {
  const doc = db().edocs.get(input.docId);
  if (!doc) throw new ReviewError(`No document ${input.docId}`, 404);
  const problem = validateRedaction(input, doc.text.length, doc.pages ?? 1);
  if (problem) throw new ReviewError(problem, 422);
  const label = input.label?.trim() || defaultRedactionLabel(input.reason);
  const rec: Redaction = {
    id: `rd_${nanoid(8)}`, matterId: doc.matterId, docId: doc.id, kind: input.kind, reason: input.reason, label, note: input.note?.trim() || undefined, createdBy, createdAt: now(),
    ...(input.kind === "text" ? { start: input.start, end: input.end, quote: doc.text.slice(input.start!, input.end!).slice(0, 400) } : { page: input.page, rect: input.rect }),
  };
  redactions().put(rec);
  audit("update", { kind: "edoc", id: doc.id, label: `${doc.bates} redaction`, matterId: doc.matterId }, { redaction: rec.id, kind: rec.kind, reason: rec.reason, label: rec.label, start: rec.start, end: rec.end, page: rec.page }, { id: createdBy, name: personName(createdBy) ?? createdBy });
  return rec;
}

export function deleteRedaction(id: string): boolean {
  const cur = redactions().get(id);
  if (!cur) return false;
  redactions().delete(id);
  const doc = db().edocs.get(cur.docId);
  audit("update", { kind: "edoc", id: cur.docId, label: `${doc?.bates ?? cur.docId} redaction removed`, matterId: cur.matterId }, { redaction: id, reason: cur.reason }, me());
  return true;
}

/** The document text with its text redactions applied (what a production would carry). */
export function redactedText(doc: EDocument): { text: string; applied: number } {
  return applyTextRedactions(doc.text, redactionsForDoc(doc.id));
}

// ---------------------------------------------------------------------------
// Productions
// ---------------------------------------------------------------------------

function summarizeProduction(p: ProductionSet): ProductionSummary2 {
  const values = Object.values(p.bates);
  const pageCount = values.reduce((n, b) => n + b.pages, 0);
  const sorted = [...values].sort((a, b) => compareBates(a.begin, b.begin));
  const redacted = new Set(redactionsForMatter(p.matterId).map((r) => r.docId));
  return { ...p, docCount: p.docIds.length, pageCount, batesRange: sorted.length ? { begin: sorted[0].begin, end: sorted[sorted.length - 1].end } : null, redactedDocs: p.docIds.filter((id) => redacted.has(id)).length, createdByName: personName(p.createdBy) };
}

export function listProductions(matterId: string): ProductionSummary2[] {
  return productions().find((p) => p.matterId === matterId).map(summarizeProduction).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getProduction(id: string): ProductionSummary2 | null {
  const p = productions().get(id);
  return p ? summarizeProduction(p) : null;
}

export async function createProduction(input: ProductionCreateInput, createdBy = me().id): Promise<ProductionSet> {
  if (!input.name?.trim()) throw new ReviewError("`name` is required");
  if (!input.prefix?.trim()) throw new ReviewError("`prefix` is required");
  const { docs, source } = await resolveDocSet(input);
  const ready = productionOrder(docs.filter(isProductionReady));
  if (!ready.length) throw new ReviewError("No production-ready documents (responsive, not privileged, not exact duplicates) in the set");
  const prefix = input.prefix.trim().toUpperCase();
  const startNumber = input.startNumber && input.startNumber > 0 ? Math.floor(input.startNumber) : nextBatesNumber(productions().find((p) => p.matterId === input.matterId), prefix, 1);
  const { bates } = assignBates(ready, { prefix, padding: input.padding ?? 7, startNumber });
  const existing = productions().count((p) => p.matterId === input.matterId);
  const ts = now();
  const rec: ProductionSet = {
    id: `pr_${nanoid(8)}`, matterId: input.matterId, name: input.name.trim(), volume: input.volume?.trim() || `VOL${String(existing + 1).padStart(3, "0")}`, status: "draft",
    prefix, padding: Math.max(4, Math.min(10, input.padding ?? 7)), startNumber, stampText: input.stampText?.trim() ?? "CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER",
    docIds: ready.map((d) => d.id), bates, source, createdBy, createdAt: ts, updatedAt: ts, notes: input.notes?.trim() || undefined,
  };
  productions().put(rec);
  audit("create", { kind: "production", id: rec.id, label: `${rec.name} (${rec.docIds.length} docs, ${rec.prefix})`, matterId: rec.matterId }, { volume: rec.volume, startNumber, source }, me());
  return rec;
}

export function runProductionQc(id: string): ProductionSet {
  const p = productions().get(id);
  if (!p) throw new ReviewError(`No production ${id}`, 404);
  const qc = qcProduction({ production: p, docs: matterDocs(p.matterId), redactions: redactionsForMatter(p.matterId) });
  const next = productions().put({ ...p, qc, updatedAt: now() });
  audit("scan.run", { kind: "production", id, label: `QC ${p.name}`, matterId: p.matterId }, { ok: qc.ok, privilegedInSet: qc.privilegedInSet.length, missingFamily: qc.missingFamily.length, unredactedPii: qc.unredactedPii.length, uncoded: qc.uncoded.length }, me());
  return next;
}

export function updateProduction(id: string, patch: Partial<Pick<ProductionSet, "name" | "status" | "stampText" | "notes" | "volume">>): ProductionSet {
  const p = productions().get(id);
  if (!p) throw new ReviewError(`No production ${id}`, 404);
  let next: ProductionSet = { ...p, updatedAt: now() };
  if (patch.name != null) next.name = patch.name.trim() || p.name;
  if (patch.volume != null && p.status !== "final") next.volume = patch.volume.trim() || p.volume;
  if (patch.stampText != null && p.status !== "final") next.stampText = patch.stampText.trim();
  if (patch.notes != null) next.notes = patch.notes.trim() || undefined;
  if (patch.status && patch.status !== p.status) {
    if (patch.status === "qc" || patch.status === "final") next = { ...next, qc: qcProduction({ production: p, docs: matterDocs(p.matterId), redactions: redactionsForMatter(p.matterId) }) };
    const t = canTransition(p.status, patch.status, next.qc);
    if (!t.ok) throw new ReviewError(t.reason ?? "Transition not allowed", 409);
    next.status = patch.status;
    if (patch.status === "final") next.finalizedAt = now();
  }
  productions().put(next);
  audit(patch.status === "final" ? "export" : "update", { kind: "production", id, label: next.name, matterId: next.matterId }, { patch, status: next.status }, me());
  return next;
}

/** Remove documents from a draft production and renumber. */
export function removeFromProduction(id: string, docIds: string[]): ProductionSet {
  const p = productions().get(id);
  if (!p) throw new ReviewError(`No production ${id}`, 404);
  if (p.status !== "draft") throw new ReviewError("Only draft productions can change their document set", 409);
  const drop = new Set(docIds);
  const keep = p.docIds.filter((x) => !drop.has(x)).map((x) => db().edocs.get(x)).filter((x): x is EDocument => !!x);
  const { bates } = assignBates(keep, { prefix: p.prefix, padding: p.padding, startNumber: p.startNumber });
  const next = productions().put({ ...p, docIds: keep.map((d) => d.id), bates, qc: undefined, updatedAt: now() });
  audit("update", { kind: "production", id, label: `${p.name}: removed ${docIds.length}`, matterId: p.matterId }, { removed: docIds.slice(0, 50) }, me());
  return next;
}

export function deleteProduction(id: string): boolean {
  const p = productions().get(id);
  if (!p) return false;
  if (p.status === "final") throw new ReviewError("A final production cannot be deleted", 409);
  productions().delete(id);
  audit("delete", { kind: "production", id, label: p.name, matterId: p.matterId }, undefined, me());
  return true;
}

/** Rows of a production for the grid (production Bates, original Bates, family, redaction count, coding). */
export function productionRows(id: string): { docId: string; bates: string; begin: string; end: string; pages: number; subject: string; custodianName: string; type: string; date: string; redactions: number; privileged: boolean; responsive: boolean | null; confidentiality?: string }[] {
  const p = productions().get(id);
  if (!p) return [];
  const counts = new Map<string, number>();
  for (const r of redactionsForMatter(p.matterId)) counts.set(r.docId, (counts.get(r.docId) ?? 0) + 1);
  return p.docIds.map((docId) => {
    const d = db().edocs.get(docId);
    const b = p.bates[docId];
    return { docId, bates: d?.bates ?? docId, begin: b?.begin ?? "", end: b?.end ?? "", pages: b?.pages ?? 1, subject: d?.subject ?? "", custodianName: d?.custodianName ?? "", type: d?.type ?? "Other", date: d?.date ?? "", redactions: counts.get(docId) ?? 0, privileged: d?.coding.privileged === true, responsive: d?.coding.responsive ?? null, confidentiality: d?.coding.confidentiality };
  });
}

// ---------------------------------------------------------------------------
// Search-term reports
// ---------------------------------------------------------------------------

export function searchTermReport(req: SearchTermReportRequest, opts: { save?: boolean } = {}): SearchTermReport {
  const all = matterDocs(req.matterId);
  const byId = new Map(all.map((d) => [d.id, d]));
  const base = applyFilters(all, req.filters);
  const terms = req.terms.map((t) => t.trim()).filter(Boolean).slice(0, 200);
  const unique = new Set<string>();
  const withFam = new Set<string>();
  const familyOf = (d: EDocument) => { const root = d.family?.parentId && byId.has(d.family.parentId) ? byId.get(d.family.parentId)! : d; return [root, ...(root.family?.attachmentIds ?? []).map((x) => byId.get(x)).filter((x): x is EDocument => !!x)]; };
  const rows: SearchTermReportRow[] = terms.map((term) => {
    const parsed = parseQuery(term);
    const matched = parsed.ast.kind === "empty" ? [] : base.filter((d) => matchesQuery(toSearchable(d), parsed.ast));
    const rx = highlightRegex(parsed.terms);
    let hits = 0;
    const fams = new Set<string>();
    const fam = new Set<string>();
    for (const d of matched) {
      hits += rx ? (toSearchable(d).haystack.match(rx)?.length ?? 1) : 1;
      unique.add(d.id);
      const members = familyOf(d);
      fams.add(members[0].id);
      for (const m of members) { fam.add(m.id); withFam.add(m.id); }
    }
    return { term, hits, uniqueDocs: matched.length, withFamilies: fam.size, families: fams.size, warnings: parsed.warnings.length ? parsed.warnings : undefined };
  });
  const report: SearchTermReport = { matterId: req.matterId, ranAt: now(), rows, totalUnique: unique.size, totalWithFamilies: withFam.size, corpus: base.length };
  if (opts.save) {
    const id = `str_${nanoid(8)}`;
    termReports().put({ ...report, id });
    report.id = id;
    audit("create", { kind: "searchTermReport", id, label: `${terms.length} terms`, matterId: req.matterId }, { totalUnique: report.totalUnique }, me());
  }
  return report;
}

export function listTermReports(matterId: string): (SearchTermReport & { id: string })[] {
  return termReports().find((r) => r.matterId === matterId).sort((a, b) => b.ranAt.localeCompare(a.ranAt)).slice(0, 20);
}

export function searchTermReportCsv(report: SearchTermReport): string {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ["Term,Hits,Unique documents,Families,Documents with families,Warnings", ...report.rows.map((r) => [r.term, r.hits, r.uniqueDocs, r.families, r.withFamilies, (r.warnings ?? []).join("; ")].map(esc).join(","))];
  lines.push(["TOTAL (unique)", "", report.totalUnique, "", report.totalWithFamilies, `corpus ${report.corpus}`].map(esc).join(","));
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Per-document audit history
// ---------------------------------------------------------------------------

const FIELD_LABEL: Record<string, string> = { responsive: "Responsive", privileged: "Privileged", privilegeBasis: "Privilege basis", hot: "Hot", confidentiality: "Confidentiality", issues: "Issue codes", notes: "Notes" };

export function docHistory(docId: string, limit = 100): DocHistoryEntry[] {
  const doc = db().edocs.get(docId);
  if (!doc) return [];
  const events = listAudit({ targetId: docId, limit });
  return events.map((e) => {
    const meta = (e.meta ?? {}) as { fields?: string[]; before?: Record<string, unknown>; after?: Record<string, unknown>; source?: string; applied?: boolean; redaction?: string; reason?: string; kind?: string; surface?: string; score?: number };
    let summary: string = e.action;
    if (e.action === "coding.change") {
      if (meta.source === "ai-suggestion") summary = meta.applied ? "Applied the AI suggestion" : "AI suggestion held for review (written to notes)";
      else if (meta.fields?.length) summary = `Coded: ${meta.fields.map((f) => { const v = meta.after?.[f]; return `${FIELD_LABEL[f] ?? f} → ${fmtValue(v)}`; }).join(", ")}`;
      else summary = "Coding updated";
    } else if (e.action === "create") summary = "Document collected";
    else if (e.action === "ai.generate") summary = `AI ${meta.surface?.replace("ediscovery.", "") ?? "generation"}${meta.score != null ? ` · score ${meta.score}` : ""}`;
    else if (e.action === "update" && meta.redaction) summary = /removed/.test(e.target.label ?? "") ? `Redaction removed (${meta.reason})` : `Redaction added (${meta.kind}, ${meta.reason})`;
    else if (e.action === "export") summary = "Exported";
    return { id: e.id, ts: e.ts, actorId: e.actorId, actorName: e.actorName, action: e.action, summary, fields: meta.fields, before: meta.before, after: meta.after };
  });
}

function fmtValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

// ---------------------------------------------------------------------------
// Near-duplicates
// ---------------------------------------------------------------------------

/** Detect near-duplicates in a matter with MinHash/shingling and populate nearDuplicateIds/nearDuplicateScores (idempotent; seeded links are kept). */
export function refreshNearDuplicates(matterId: string, opts: { threshold?: number } = {}): { pairs: number; updated: number; groups: number } {
  const docs = matterDocs(matterId);
  const res = detectNearDuplicates(docs.map((d) => ({ id: d.id, text: d.text })), { threshold: opts.threshold ?? 0.5 });
  const map = nearDuplicateMap(res.pairs.filter((p) => { const a = docs.find((d) => d.id === p.a), b = docs.find((d) => d.id === p.b); return !(a?.isDuplicateOf === p.b || b?.isDuplicateOf === p.a || (a?.hash && a.hash === b?.hash)); }));
  const updates: EDocument[] = [];
  for (const d of docs) {
    const detected = map.get(d.id) ?? {};
    const ids = Array.from(new Set([...(d.nearDuplicateIds ?? []), ...Object.keys(detected)])).filter((x) => x !== d.id);
    const scores: Record<string, number> = { ...(d.nearDuplicateScores ?? {}) };
    for (const [id, score] of Object.entries(detected)) scores[id] = score;
    for (const id of ids) if (scores[id] == null) scores[id] = 0.9; // hand-linked drafts/versions carry a nominal score
    const same = JSON.stringify(ids.slice().sort()) === JSON.stringify((d.nearDuplicateIds ?? []).slice().sort()) && JSON.stringify(scores) === JSON.stringify(d.nearDuplicateScores ?? {});
    if (!same) updates.push({ ...d, nearDuplicateIds: ids.length ? ids : undefined, nearDuplicateScores: ids.length ? scores : undefined });
  }
  if (updates.length) db().edocs.putMany(updates);
  return { pairs: res.pairs.length, updated: updates.length, groups: res.groups.length };
}
