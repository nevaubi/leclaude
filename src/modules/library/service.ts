import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import type { LibraryItem, LibraryItemType, OfficeDocument, PracticeArea } from "@/lib/types/domain";
import { hybridSearch, indexDocument, indexDocuments, indexStats, removeDocument } from "@/lib/ai/vector-store";
import { VECTOR_COLLECTIONS, extractPlainText } from "@/lib/ai/toolkit/internal";
import { aiConfig } from "@/lib/ai/config";
import { generateJSON, generateText } from "@/lib/ai/agent";
import { FIRM_NAME, LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import { createOfficeDoc, deleteOfficeDoc, getOfficeDoc, saveOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { activityCollection, clauseMetaCollection, indexTextFor, versionsCollection } from "./data";
import { LIBRARY_FOLDERS, LIBRARY_USER, isSystemFolder, matterFolderId } from "./ids";
import { breadcrumbsFor, buildTree, descendantIds, folderSort, validateMove } from "./tree";
import { clauseDiffSummary, extractVariables, fillClause, variableSpecs } from "./clauses";
import { orphanedOfficeEntries, planOfficeDocMerge } from "./merge";
import { CLAUSE_CATEGORIES, OFFICE_KIND_BY_TYPE, PRACTICE_AREAS, TYPE_BY_OFFICE_KIND, type ActivityAction, type ActivityEntry, type ClauseMeta, type CreateItemInput, type LibraryFilters, type LibraryItemDetail, type LibraryItemView, type LibraryListResponse, type LibrarySearchHit, type LibrarySearchResponse, type LibraryTreeResponse, type UpdateItemInput } from "./types";

const OFFICE_VECTORS = "office_documents";
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Office-document sync (merge editor-created docs into the tree at read time)
// ---------------------------------------------------------------------------
let lastSyncSignature = "";

export function syncOfficeDocs(force = false): { created: number; updated: number; orphaned: number } {
  const d = db();
  const docs = d.officeDocs.all();
  const sig = `${docs.length}:${docs.reduce((m, x) => (x.updatedAt > m ? x.updatedAt : m), "")}:${d.library.count()}`;
  const orphans = orphanedOfficeEntries(new Set(docs.map((x) => x.id)), d.library.all()).length;
  if (!force && sig === lastSyncSignature) return { created: 0, updated: 0, orphaned: orphans };
  const items = d.library.all();
  const plan = planOfficeDocMerge(docs, items, { now: now() });
  if (plan.create.length) d.library.putMany(plan.create);
  for (const u of plan.update) d.library.update(u.id, u.patch);
  lastSyncSignature = `${docs.length}:${docs.reduce((m, x) => (x.updatedAt > m ? x.updatedAt : m), "")}:${d.library.count()}`;
  return { created: plan.create.length, updated: plan.update.length, orphaned: orphans };
}

/** Library rows whose office document exists (or that are not office-backed). */
function liveItems(): LibraryItem[] {
  const d = db();
  return d.library.all().filter((i) => !i.officeDocId || d.officeDocs.has(i.officeDocId));
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------
interface ViewCtx {
  items: Map<string, LibraryItem>;
  people: Map<string, string>;
  matters: Map<string, { name: string; shortName: string }>;
  clauses: Map<string, ClauseMeta>;
  childCounts: Map<string, number>;
}

function viewCtx(items: LibraryItem[]): ViewCtx {
  const d = db();
  const childCounts = new Map<string, number>();
  for (const i of items) if (i.parentId) childCounts.set(i.parentId, (childCounts.get(i.parentId) ?? 0) + 1);
  return {
    items: new Map(items.map((i) => [i.id, i])),
    people: new Map(d.people.all().map((p) => [p.id, p.name])),
    matters: new Map(d.matters.all().map((m) => [m.id, { name: m.name, shortName: m.shortName }])),
    clauses: new Map(clauseMetaCollection().all().map((c) => [c.id, c])),
    childCounts,
  };
}

function stripMarkdown(md: string) {
  return md.replace(/^#+\s*/gm, "").replace(/[*_`>|]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\{\{\s*([^}]+?)\s*\}\}/g, "[$1]").replace(/\s+/g, " ").trim();
}

function templateIdFromUrl(url?: string) {
  if (!url) return undefined;
  const m = url.match(/[?&]template=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export function toView(item: LibraryItem, ctx: ViewCtx): LibraryItemView {
  const matter = item.matterId ? ctx.matters.get(item.matterId) : undefined;
  const officeKind = OFFICE_KIND_BY_TYPE[item.type];
  const doc = item.officeDocId ? db().officeDocs.get(item.officeDocId) : null;
  return {
    ...item,
    ownerName: item.ownerId ? ctx.people.get(item.ownerId) : undefined,
    matterName: matter?.name,
    matterShortName: matter?.shortName,
    path: breadcrumbsFor(ctx.items, item.parentId ?? null),
    clause: item.type === "clause" ? ctx.clauses.get(item.id) : undefined,
    officeKind,
    childCount: item.type === "folder" ? ctx.childCounts.get(item.id) ?? 0 : undefined,
    excerpt: item.content ? stripMarkdown(item.content).slice(0, 260) : item.description?.slice(0, 260),
    templateId: item.type === "template" ? templateIdFromUrl(item.url) : undefined,
    contentVersion: doc?.contentVersion,
    updatedAt: doc && doc.updatedAt > item.updatedAt ? doc.updatedAt : item.updatedAt,
    size: doc?.size ?? item.size,
  };
}

function nearestMatterId(items: Map<string, LibraryItem>, parentId: string | null | undefined): string | undefined {
  let cur = parentId ? items.get(parentId) : null;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.matterId) return cur.matterId;
    cur = cur.parentId ? items.get(cur.parentId) ?? null : null;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Activity + versions
// ---------------------------------------------------------------------------
export function logActivity(item: Pick<LibraryItem, "id" | "name">, action: ActivityAction, detail?: string): ActivityEntry {
  const entry: ActivityEntry = { id: `lact_${nanoid(10)}`, itemId: item.id, itemName: item.name, actorId: LIBRARY_USER.id, actorName: LIBRARY_USER.name, action, detail, at: now() };
  activityCollection().put(entry);
  return entry;
}

export function listActivity(opts: { itemId?: string; limit?: number } = {}) {
  return activityCollection().list({ where: (a) => !opts.itemId || a.itemId === opts.itemId, sortBy: (a, b) => b.at.localeCompare(a.at), limit: opts.limit ?? 50 });
}

function snapshotVersion(item: LibraryItem, summary?: string) {
  if (!item.content) return;
  versionsCollection().put({ id: `lver_${nanoid(10)}`, itemId: item.id, version: item.version ?? 1, content: item.content, authorName: LIBRARY_USER.name, summary, at: now() });
}

export function listVersions(itemId: string) {
  return versionsCollection().list({ where: (v) => v.itemId === itemId, sortBy: (a, b) => b.version - a.version }).map(({ content: _c, ...rest }) => { void _c; return rest; });
}

export function getVersion(itemId: string, version: number) {
  return versionsCollection().findOne((v) => v.itemId === itemId && v.version === version);
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------
async function reindexItem(item: LibraryItem) {
  if (item.type === "folder") { removeDocument(VECTOR_COLLECTIONS.library, item.id); return; }
  try {
    await indexDocument(VECTOR_COLLECTIONS.library, item.id, indexTextFor(item), { type: item.type, matterId: item.matterId, practiceArea: item.practiceArea, parentId: item.parentId }, { embed: aiConfig().hasKey });
  } catch (e) { console.warn("[library] reindex failed", (e as Error).message); }
}

export function indexStatus() {
  const lib = indexStats(VECTOR_COLLECTIONS.library);
  const office = indexStats(OFFICE_VECTORS);
  return { docs: lib.docs, chunks: lib.chunks, embedded: lib.embedded, officeDocs: office.docs, officeEmbedded: office.embedded };
}

export async function rebuildIndex(opts: { embed?: boolean; includeOffice?: boolean } = {}) {
  const embed = opts.embed ?? aiConfig().hasKey;
  const items = liveItems().filter((i) => i.type !== "folder" && !i.officeDocId);
  const lib = await indexDocuments(VECTOR_COLLECTIONS.library, items.map((i) => ({ id: i.id, text: indexTextFor(i), meta: { type: i.type, matterId: i.matterId, practiceArea: i.practiceArea, parentId: i.parentId } })), { embed });
  let office = { docs: 0, chunks: 0, embedded: 0 };
  if (opts.includeOffice !== false) {
    const docs = db().officeDocs.all();
    office = await indexDocuments(OFFICE_VECTORS, docs.map((doc) => ({ id: doc.id, text: `${doc.title}\n${extractPlainText(doc.content)}`, meta: { kind: doc.kind, title: doc.title, matterId: doc.matterId } })), { embed });
  }
  return { embed, library: lib, office, status: indexStatus() };
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------
export function treeResponse(): LibraryTreeResponse {
  syncOfficeDocs();
  const d = db();
  const items = liveItems();
  const roots = buildTree(items);
  const nonFolder = items.filter((i) => i.type !== "folder");
  const tagCounts = new Map<string, number>();
  for (const i of nonFolder) for (const t of i.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const recentCutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  return {
    roots,
    views: {
      starred: items.filter((i) => i.starred).length,
      recent: nonFolder.filter((i) => i.updatedAt >= recentCutoff).length,
      shared: nonFolder.filter((i) => i.ownerId && i.ownerId !== LIBRARY_USER.id && (i.sharedWith ?? []).some((s) => s !== "private")).length,
      all: nonFolder.length,
    },
    matters: d.matters.list({ sortBy: "shortName" }).map((m) => ({ id: m.id, shortName: m.shortName, name: m.name, practiceArea: m.practiceArea, folderId: matterFolderId(m.id) })),
    people: d.people.list({ where: (p) => p.role === "attorney" || p.role === "paralegal" || p.role === "staff", sortBy: "name" }).map((p) => ({ id: p.id, name: p.name })),
    tags: Array.from(tagCounts.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 80),
    practiceAreas: PRACTICE_AREAS,
    index: indexStatus(),
    aiConfigured: aiConfig().hasKey,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------
function matchesFilters(i: LibraryItem, f: LibraryFilters) {
  if (f.type) {
    if (f.type === "office") { if (!i.officeDocId) return false; }
    else if (i.type !== f.type) return false;
  }
  if (f.matterId && i.matterId !== f.matterId) return false;
  if (f.practiceArea && i.practiceArea !== f.practiceArea) return false;
  if (f.tag && !(i.tags ?? []).some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
  if (f.ownerId && i.ownerId !== f.ownerId) return false;
  if (f.status && i.status !== f.status) return false;
  if (f.from && i.updatedAt.slice(0, 10) < f.from) return false;
  if (f.to && i.updatedAt.slice(0, 10) > f.to) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = `${i.name} ${i.description ?? ""} ${(i.tags ?? []).join(" ")} ${i.url ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const hasFilter = (f: LibraryFilters) => Boolean(f.type || f.matterId || f.practiceArea || f.tag || f.ownerId || f.from || f.to || f.q || f.status);

const TYPE_ORDER: Record<LibraryItemType, number> = { folder: 0, docx: 1, xlsx: 2, pptx: 3, pdf: 4, template: 5, clause: 6, note: 7, link: 8 };

export function sortItems<T extends LibraryItem>(items: T[], sort: LibraryFilters["sort"] = "name", dir: "asc" | "desc" = "asc"): T[] {
  const mul = dir === "desc" ? -1 : 1;
  const cmp = (a: T, b: T): number => {
    switch (sort) {
      case "updated": return a.updatedAt.localeCompare(b.updatedAt) * mul;
      case "created": return a.createdAt.localeCompare(b.createdAt) * mul;
      case "size": return ((a.size ?? 0) - (b.size ?? 0)) * mul;
      case "type": return (TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name)) * mul;
      default: return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * mul;
    }
  };
  // Folders always first regardless of direction.
  return [...items].sort((a, b) => {
    const fa = a.type === "folder" ? 0 : 1, fb = b.type === "folder" ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (fa === 0 && sort === "name") return folderSort(a, b) * mul;
    return cmp(a, b);
  });
}

export function listItems(f: LibraryFilters = {}): LibraryListResponse {
  syncOfficeDocs();
  const items = liveItems();
  const ctx = viewCtx(items);
  const view = f.view ?? "folder";
  const folderId = f.folder ?? null;
  const folder = folderId ? ctx.items.get(folderId) ?? null : null;
  let scope: LibraryItem[];
  const recentCutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  switch (view) {
    case "starred": scope = items.filter((i) => i.starred); break;
    case "recent": scope = items.filter((i) => i.type !== "folder" && i.updatedAt >= recentCutoff); break;
    case "shared": scope = items.filter((i) => i.type !== "folder" && i.ownerId && i.ownerId !== LIBRARY_USER.id && (i.sharedWith ?? []).some((s) => s !== "private")); break;
    case "all": scope = items.filter((i) => i.type !== "folder"); break;
    default: {
      if (folderId && !folder) return { items: [], folder: null, breadcrumbs: [], total: 0, view };
      if (hasFilter(f) && folderId) { const ids = new Set(descendantIds(items, folderId)); scope = items.filter((i) => ids.has(i.id) && i.type !== "folder"); }
      else if (hasFilter(f) && !folderId) scope = items.filter((i) => i.type !== "folder");
      else scope = items.filter((i) => (i.parentId ?? null) === folderId);
    }
  }
  const filtered = scope.filter((i) => matchesFilters(i, f));
  const sort = f.sort ?? (view === "recent" ? "updated" : "name");
  const dir = f.dir ?? (sort === "updated" || sort === "created" ? "desc" : "asc");
  const sorted = sortItems(filtered, sort, dir);
  const limited = view === "recent" && !hasFilter(f) ? sorted.slice(0, 60) : sorted;
  return { items: limited.map((i) => toView(i, ctx)), folder: folder ? toView(folder, ctx) : null, breadcrumbs: breadcrumbsFor(ctx.items, folderId), total: filtered.length, view };
}

export function getItemView(id: string): LibraryItemView | null {
  syncOfficeDocs();
  const items = liveItems();
  const ctx = viewCtx(items);
  const it = ctx.items.get(id);
  return it ? toView(it, ctx) : null;
}

export function getItemDetail(id: string): LibraryItemDetail | null {
  syncOfficeDocs();
  const d = db();
  const items = liveItems();
  const ctx = viewCtx(items);
  const it = ctx.items.get(id);
  if (!it) return null;
  const item = toView(it, ctx);
  const detail: LibraryItemDetail = { item, activity: listActivity({ itemId: id, limit: 25 }), versions: listVersions(id) };
  if (it.type === "folder") detail.children = sortItems(items.filter((c) => c.parentId === id)).map((c) => toView(c, ctx));
  if (it.officeDocId) {
    const doc = d.officeDocs.get(it.officeDocId);
    if (doc) {
      const text = extractPlainText(doc.content);
      detail.office = { id: doc.id, kind: doc.kind, title: doc.title, contentVersion: doc.contentVersion, updatedAt: doc.updatedAt, versionCount: d.officeVersions.count((v) => v.docId === doc.id), commentCount: d.officeComments.count((c) => c.docId === doc.id && !c.resolved), words: text ? text.split(/\s+/).length : 0, text: text.slice(0, 6000) };
    }
  }
  if (item.clause?.standardId) { const s = ctx.items.get(item.clause.standardId); detail.standard = s ? toView(s, ctx) : null; }
  return detail;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function createItem(input: CreateItemInput): LibraryItemView {
  const d = db();
  const items = liveItems();
  const ctx = viewCtx(items);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (input.parentId) {
    const parent = ctx.items.get(input.parentId);
    if (!parent) throw new Error("Parent folder does not exist");
    if (parent.type !== "folder") throw new Error("Parent must be a folder");
  }
  if (input.type === "link" && !input.url?.trim()) throw new Error("A link needs a URL");
  const ts = now();
  const item: LibraryItem = {
    id: `lib_${nanoid(10)}`,
    parentId: input.parentId ?? null,
    name,
    type: input.type,
    matterId: input.matterId ?? nearestMatterId(ctx.items, input.parentId),
    description: input.description?.trim() || undefined,
    content: input.type === "note" || input.type === "clause" ? (input.content ?? "") : undefined,
    url: input.url?.trim() || undefined,
    tags: dedupeTags(input.tags),
    practiceArea: input.practiceArea,
    ownerId: LIBRARY_USER.id,
    sharedWith: input.sharedWith ?? [input.parentId === LIBRARY_FOLDERS.myFiles ? "private" : (input.matterId ?? nearestMatterId(ctx.items, input.parentId)) ? "matter-team" : "firm"],
    size: input.size ?? input.content?.length,
    status: input.status ?? (input.type === "clause" ? "draft" : undefined),
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
  d.library.put(item);
  if (item.type === "clause") {
    const meta: ClauseMeta = { id: item.id, category: input.clause?.category && CLAUSE_CATEGORIES.includes(input.clause.category) ? input.clause.category : "confidentiality", variables: variableSpecs(item.content ?? "", input.clause?.variables ?? []), stance: input.clause?.stance ?? "neutral", governingLaw: input.clause?.governingLaw, notes: input.clause?.notes, standardId: input.clause?.standardId, lastReviewedAt: ts.slice(0, 10), reviewedBy: LIBRARY_USER.name, useCount: 0 };
    clauseMetaCollection().put(meta);
  }
  snapshotVersion(item, "Created");
  logActivity(item, "created", item.type);
  void reindexItem(item);
  return toView(item, viewCtx(liveItems()));
}

function dedupeTags(tags?: string[]) {
  if (!tags) return undefined;
  const out: string[] = [];
  for (const t of tags) { const c = t.trim(); if (c && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c); }
  return out.length ? out : undefined;
}

export function updateItem(id: string, patch: UpdateItemInput): LibraryItemView | null {
  const d = db();
  const items = liveItems();
  const ctx = viewCtx(items);
  const cur = ctx.items.get(id);
  if (!cur) return null;
  const next: LibraryItem = { ...cur };
  const ts = now();
  const changes: string[] = [];

  if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== cur.name) {
    next.name = patch.name.trim();
    logActivity({ id, name: next.name }, "renamed", `from "${cur.name}"`);
    if (cur.officeDocId) saveOfficeDoc(cur.officeDocId, { title: next.name });
  }
  if (patch.parentId !== undefined && (patch.parentId ?? null) !== (cur.parentId ?? null)) {
    const v = validateMove(ctx.items, [id], patch.parentId ?? null);
    if (!v.ok) throw new Error(v.reason ?? "Invalid move");
    next.parentId = patch.parentId ?? null;
    const inherited = nearestMatterId(ctx.items, next.parentId);
    if (patch.matterId === undefined && cur.type !== "folder") next.matterId = inherited ?? cur.matterId;
    const targetName = next.parentId ? ctx.items.get(next.parentId)?.name ?? "folder" : "root";
    logActivity(cur, "moved", `to ${targetName}`);
    if (next.parentId === LIBRARY_FOLDERS.myFiles) next.sharedWith = ["private"];
  }
  if (patch.matterId !== undefined) { next.matterId = patch.matterId ?? undefined; changes.push("matter"); }
  if (cur.officeDocId && (next.matterId ?? null) !== (cur.matterId ?? null)) saveOfficeDoc(cur.officeDocId, { matterId: next.matterId ?? null });
  if (patch.restoreVersion !== undefined) {
    const v = getVersion(id, patch.restoreVersion);
    if (!v) throw new Error(`Version ${patch.restoreVersion} not found`);
    next.content = v.content;
    next.version = (cur.version ?? 1) + 1;
    next.size = v.content.length;
    snapshotVersion(next, `Restored v${v.version}`);
    logActivity(cur, "restored", `v${v.version} → v${next.version}`);
  } else if (patch.content !== undefined && patch.content !== cur.content && (cur.type === "note" || cur.type === "clause")) {
    next.content = patch.content;
    next.version = (cur.version ?? 1) + 1;
    next.size = patch.content.length;
    snapshotVersion(next, patch.versionSummary ?? "Edited");
    changes.push("content");
  }
  if (patch.url !== undefined) { next.url = patch.url.trim() || undefined; changes.push("url"); }
  if (patch.description !== undefined) { next.description = patch.description.trim() || undefined; changes.push("description"); }
  if (patch.tags !== undefined) { next.tags = dedupeTags(patch.tags); logActivity(cur, "tagged", (next.tags ?? []).join(", ") || "cleared"); }
  if (patch.practiceArea !== undefined) { next.practiceArea = patch.practiceArea ?? undefined; changes.push("practice area"); }
  if (patch.status !== undefined) { next.status = patch.status; changes.push(`status ${patch.status}`); }
  if (patch.sharedWith !== undefined) { next.sharedWith = patch.sharedWith; logActivity(cur, "shared", (patch.sharedWith ?? []).join(", ")); }
  if (patch.starred !== undefined && Boolean(patch.starred) !== Boolean(cur.starred)) { next.starred = patch.starred; logActivity(cur, patch.starred ? "starred" : "unstarred"); }
  if (cur.type === "clause" && (patch.clause || patch.content !== undefined)) {
    const meta = clauseMetaCollection().get(id) ?? { id, category: "confidentiality" as const, variables: [], stance: "neutral" as const, useCount: 0 };
    const merged: ClauseMeta = { ...meta, ...(patch.clause ?? {}), id, variables: variableSpecs(next.content ?? "", patch.clause?.variables ?? meta.variables), lastReviewedAt: patch.clause ? ts.slice(0, 10) : meta.lastReviewedAt, reviewedBy: patch.clause ? LIBRARY_USER.name : meta.reviewedBy };
    if (!CLAUSE_CATEGORIES.includes(merged.category)) merged.category = meta.category;
    clauseMetaCollection().put(merged);
  }
  if (changes.length) logActivity(cur, "updated", changes.join(", "));
  next.updatedAt = ts;
  d.library.put(next);
  if (changes.length || patch.name !== undefined || patch.tags !== undefined) void reindexItem(next);
  return toView(next, viewCtx(liveItems()));
}

export function moveItems(ids: string[], targetId: string | null): { moved: string[] } {
  const items = liveItems();
  const v = validateMove(items, ids, targetId);
  if (!v.ok) throw new Error(v.reason ?? "Invalid move");
  for (const id of v.ids) updateItem(id, { parentId: targetId });
  return { moved: v.ids };
}

export function deleteItem(id: string): { deleted: string[] } {
  const d = db();
  const items = liveItems();
  const map = new Map(items.map((i) => [i.id, i]));
  const it = map.get(id);
  if (!it) return { deleted: [] };
  if (it.type === "folder" && isSystemFolder(id)) throw new Error(`"${it.name}" is a system folder and cannot be deleted`);
  const ids = it.type === "folder" ? [...descendantIds(items, id), id] : [id];
  const deleted: string[] = [];
  for (const target of ids) {
    const row = map.get(target);
    if (!row) continue;
    if (row.type === "folder" && isSystemFolder(row.id)) continue;
    if (row.officeDocId) deleteOfficeDoc(row.officeDocId); // also removes the library row(s)
    d.library.delete(row.id);
    removeDocument(VECTOR_COLLECTIONS.library, row.id);
    for (const v of versionsCollection().find((v) => v.itemId === row.id)) versionsCollection().delete(v.id);
    deleted.push(row.id);
  }
  logActivity(it, "deleted", it.type === "folder" ? `${deleted.length - 1} item${deleted.length === 2 ? "" : "s"} inside` : undefined);
  syncOfficeDocs(true);
  return { deleted };
}

export function duplicateItem(id: string, opts: { parentId?: string | null } = {}): LibraryItemView | null {
  const d = db();
  const items = liveItems();
  const ctx = viewCtx(items);
  const src = ctx.items.get(id);
  if (!src) return null;
  const ts = now();
  const parentId = opts.parentId === undefined ? src.parentId ?? null : opts.parentId;
  const copyName = (n: string) => (/^Copy of /.test(n) ? n.replace(/^Copy of /, "Copy (2) of ") : `Copy of ${n}`);
  const clone = (row: LibraryItem, target: string | null): LibraryItem => {
    const nid = `lib_${nanoid(10)}`;
    if (row.officeDocId) {
      const doc = getOfficeDoc(row.officeDocId);
      if (!doc) throw new Error("Source document is missing");
      const copy = createOfficeDoc({ kind: doc.kind, title: copyName(doc.title), content: JSON.parse(JSON.stringify(doc.content)), matterId: doc.matterId, folderId: target ?? undefined, templateId: doc.templateId, tags: doc.tags, meta: doc.meta });
      const item: LibraryItem = { ...row, id: nid, parentId: target, name: copy.title, officeDocId: copy.id, ownerId: LIBRARY_USER.id, starred: false, version: 1, size: copy.size, createdAt: ts, updatedAt: ts };
      d.library.put(item);
      return item;
    }
    const item: LibraryItem = { ...row, id: nid, parentId: target, name: copyName(row.name), ownerId: LIBRARY_USER.id, starred: false, version: 1, createdAt: ts, updatedAt: ts };
    d.library.put(item);
    if (row.type === "clause") { const meta = clauseMetaCollection().get(row.id); if (meta) clauseMetaCollection().put({ ...meta, id: nid, useCount: 0 }); }
    snapshotVersion(item, "Duplicated");
    void reindexItem(item);
    if (row.type === "folder") for (const child of items.filter((c) => c.parentId === row.id)) clone(child, nid);
    return item;
  };
  const out = clone(src, parentId);
  logActivity(src, "duplicated", `as "${out.name}"`);
  return toView(out, viewCtx(liveItems()));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function passageAround(text: string, query: string, radius = 220) {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  if (idx < 0) return clean(text.slice(0, radius * 2));
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return (start > 0 ? "…" : "") + clean(text.slice(start, end)) + (end < text.length ? "…" : "");
}

export async function searchLibrary(query: string, f: LibraryFilters = {}, k = 30): Promise<LibrarySearchResponse> {
  const started = Date.now();
  syncOfficeDocs();
  const q = query.trim();
  const items = liveItems();
  const ctx = viewCtx(items);
  if (!q) return { hits: [], query: q, took: 0, mode: "keyword" };
  const scopeIds = f.folder ? new Set(descendantIds(items, f.folder)) : null;
  const inScope = (i: LibraryItem) => i.type !== "folder" && (!scopeIds || scopeIds.has(i.id)) && matchesFilters(i, { ...f, q: undefined, folder: undefined });
  const byDoc = new Map<string, LibraryItem>();
  for (const i of items) if (i.officeDocId) byDoc.set(i.officeDocId, i);

  const [libHits, officeHits] = await Promise.all([
    hybridSearch(VECTOR_COLLECTIONS.library, q, { k, perDoc: 1, filter: (_m, id) => { const it = ctx.items.get(id); return !!it && !it.officeDocId && inScope(it); } }),
    hybridSearch(OFFICE_VECTORS, q, { k, perDoc: 1, filter: (_m, docId) => { const it = byDoc.get(docId); return !!it && inScope(it); } }),
  ]);
  const hits: LibrarySearchHit[] = [];
  for (const h of libHits) { const it = ctx.items.get(h.docId); if (it) hits.push({ item: toView(it, ctx), score: h.score, passage: passageAround(h.text, q), source: "library", semantic: h.semantic, keyword: h.keyword }); }
  for (const h of officeHits) { const it = byDoc.get(h.docId); if (it) hits.push({ item: toView(it, ctx), score: h.score * 0.95, passage: passageAround(h.text, q), source: "office", semantic: h.semantic, keyword: h.keyword }); }
  if (!hits.length) {
    // Keyword fallback over live content (covers items indexed after the last rebuild).
    const terms = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    for (const it of items) {
      if (!inScope(it)) continue;
      const text = it.officeDocId ? `${it.name}\n${extractPlainText(db().officeDocs.get(it.officeDocId)?.content).slice(0, 40_000)}` : indexTextFor(it);
      const lower = text.toLowerCase();
      let score = 0;
      for (const t of terms) { let i = 0; let n = 0; while ((i = lower.indexOf(t, i)) >= 0 && n < 20) { n++; i += t.length; } score += n * (it.name.toLowerCase().includes(t) ? 3 : 1); }
      if (score > 0) hits.push({ item: toView(it, ctx), score, passage: passageAround(text, q), source: it.officeDocId ? "office" : "library" });
    }
    const max = Math.max(...hits.map((h) => h.score), 1);
    for (const h of hits) h.score = h.score / max;
  }
  const seen = new Set<string>();
  const merged = hits.sort((a, b) => b.score - a.score).filter((h) => { if (seen.has(h.item.id)) return false; seen.add(h.item.id); return true; }).slice(0, k);
  const status = indexStatus();
  return { hits: merged, query: q, took: Date.now() - started, mode: aiConfig().hasKey && (status.embedded > 0 || status.officeEmbedded > 0) ? "hybrid" : "keyword" };
}

// ---------------------------------------------------------------------------
// Clause bank
// ---------------------------------------------------------------------------
export function listClauses(opts: { category?: string; q?: string } = {}) {
  const items = liveItems();
  const ctx = viewCtx(items);
  const clauses = items.filter((i) => i.type === "clause").map((i) => toView(i, ctx)).filter((c) => (!opts.category || c.clause?.category === opts.category) && (!opts.q || `${c.name} ${c.description ?? ""} ${c.content ?? ""}`.toLowerCase().includes(opts.q.toLowerCase())));
  const categories = CLAUSE_CATEGORIES.map((category) => ({ category, count: items.filter((i) => i.type === "clause" && ctx.clauses.get(i.id)?.category === category).length })).filter((c) => c.count > 0);
  return { clauses: sortItems(clauses, "name"), categories };
}

export interface FillClauseOptions { values: Record<string, string>; createDoc?: boolean; matterId?: string; folderId?: string | null; title?: string; copyOnly?: boolean }

export function fillClauseItem(id: string, opts: FillClauseOptions) {
  const d = db();
  const items = liveItems();
  const ctx = viewCtx(items);
  const it = ctx.items.get(id);
  if (!it || it.type !== "clause") throw new Error("Clause not found");
  const result = fillClause(it.content ?? "", opts.values);
  const meta = ctx.clauses.get(id);
  const out: { markdown: string; filled: string[]; missing: string[]; doc?: Omit<OfficeDocument, "content">; url?: string; libraryItemId?: string } = { markdown: result.text, ...result };
  if (opts.createDoc) {
    const title = opts.title?.trim() || it.name;
    const matterId = opts.matterId ?? it.matterId;
    const folderId = opts.folderId ?? (matterId && ctx.items.has(matterFolderId(matterId)) ? matterFolderId(matterId) : LIBRARY_FOLDERS.myFiles);
    const doc = createOfficeDoc({ kind: "word", title, content: markdownToDoc(result.text), matterId, folderId, tags: ["clause", meta?.category ?? "clause"], meta: { sourceClauseId: id, missingVariables: result.missing } });
    const ts = now();
    const row: LibraryItem = { id: `lib_office_${doc.id}`, parentId: folderId, name: doc.title, type: TYPE_BY_OFFICE_KIND.word, matterId, officeDocId: doc.id, size: doc.size, tags: doc.tags, ownerId: LIBRARY_USER.id, sharedWith: [matterId ? "matter-team" : "private"], createdAt: ts, updatedAt: ts, version: 1, status: "draft" };
    d.library.put(row);
    const { content: _c, ...rest } = doc; void _c;
    out.doc = rest;
    out.url = `/office/word/${doc.id}`;
    out.libraryItemId = row.id;
    logActivity(it, "inserted", `into new document "${doc.title}"`);
  } else if (!opts.copyOnly) {
    logActivity(it, "inserted", "copied to clipboard");
  }
  if (meta) clauseMetaCollection().put({ ...meta, useCount: (meta.useCount ?? 0) + 1 });
  return out;
}

// ---------------------------------------------------------------------------
// AI helpers (all fail gracefully without a key)
// ---------------------------------------------------------------------------
export class NoApiKeyError extends Error { code = "no_api_key"; status = 503; constructor() { super("OpenAI key required. Add OPENAI_API_KEY to .env.local to enable AI features."); this.name = "NoApiKeyError"; } }

function itemText(it: LibraryItem, max = 24_000) {
  let text = it.content ?? "";
  if (!text && it.officeDocId) text = extractPlainText(db().officeDocs.get(it.officeDocId)?.content);
  if (!text) text = `${it.name}\n${it.description ?? ""}\n${it.url ?? ""}`;
  return text.length > max ? text.slice(0, max) + "\n…[truncated]" : text;
}

export async function summarizeItem(id: string): Promise<{ summary: string; cached: boolean }> {
  const d = db();
  const it = d.library.get(id);
  if (!it) throw new Error("Item not found");
  if (!aiConfig().hasKey) throw new NoApiKeyError();
  const key = `library:summary:${id}:${it.updatedAt}:${it.version ?? 0}`;
  const cached = d.kv.get<string>(key);
  if (cached) return { summary: cached, cached: true };
  const matter = it.matterId ? d.matters.get(it.matterId) : null;
  const res = await generateText({
    fast: true,
    instructions: `You are the ${FIRM_NAME} knowledge-management assistant. ${todayLine()}\nSummarize the library item for a busy lawyer: 3–6 bullet points covering what it is, what it says or does, key dates/parties/authorities, and when to use it. Then one line "Watch out:" with the main risk or caveat. Do not invent facts or citations. Use Markdown.${matter ? `\nMatter context: ${matter.name} (${matter.caption ?? matter.shortName}), client ${matter.client}.` : ""}\n${LEGAL_STYLE_RULES}`,
    input: `Item type: ${it.type}\nName: ${it.name}\n${it.description ? `Description: ${it.description}\n` : ""}${it.tags?.length ? `Tags: ${it.tags.join(", ")}\n` : ""}\n---\n${itemText(it)}`,
    maxOutputTokens: 700,
  });
  d.kv.set(key, res.text);
  logActivity(it, "summarized");
  return { summary: res.text, cached: false };
}

export async function autoTagItem(id: string): Promise<{ skipped: boolean; reason?: string; tags?: string[]; practiceArea?: PracticeArea; description?: string }> {
  const d = db();
  const it = d.library.get(id);
  if (!it) throw new Error("Item not found");
  if (!aiConfig().hasKey) return { skipped: true, reason: "no_api_key" };
  const out = await generateJSON<{ tags: string[]; practiceArea: PracticeArea | null; description: string }>({
    fast: true,
    name: "library_autotag",
    instructions: `You classify documents for a law firm's shared library. Return 3–7 short lowercase tags (topics, document type, parties, jurisdiction), the best-fit practice area from the allowed list or null, and a one-sentence description. Never invent facts that are not in the text.`,
    input: `Allowed practice areas: ${PRACTICE_AREAS.join(" | ")}\nFile name: ${it.name}\nType: ${it.type}\n---\n${itemText(it, 12_000)}`,
    schema: { type: "object", properties: { tags: { type: "array", items: { type: "string" } }, practiceArea: { type: "string", enum: PRACTICE_AREAS }, description: { type: "string" } }, required: ["tags", "description"] },
    maxOutputTokens: 300,
  });
  const tags = dedupeTags([...(it.tags ?? []), ...out.tags.slice(0, 7)]);
  const practiceArea = out.practiceArea && PRACTICE_AREAS.includes(out.practiceArea) ? out.practiceArea : it.practiceArea;
  d.library.update(id, { tags, practiceArea, description: it.description ?? out.description, updatedAt: now() });
  logActivity(it, "tagged", `auto: ${out.tags.slice(0, 7).join(", ")}`);
  const updated = d.library.get(id);
  if (updated) void reindexItem(updated);
  return { skipped: false, tags, practiceArea, description: it.description ?? out.description };
}

export async function compareClause(id: string, opts: { text?: string; againstId?: string }): Promise<{ analysis: string; mode: "ai" | "heuristic"; standardName?: string }> {
  const d = db();
  const it = d.library.get(id);
  if (!it || it.type !== "clause") throw new Error("Clause not found");
  const meta = clauseMetaCollection().get(id);
  const standardId = opts.againstId ?? meta?.standardId;
  const standard = standardId ? d.library.get(standardId) : null;
  const candidateText = opts.text?.trim();
  // Three shapes: (1) our clause vs. its firm standard, (2) pasted text vs. this clause, (3) this clause vs. another chosen clause.
  const left = candidateText ? { name: "Your text", text: candidateText } : { name: it.name, text: it.content ?? "" };
  const right = candidateText ? { name: it.name, text: it.content ?? "" } : standard ? { name: standard.name, text: standard.content ?? "" } : null;
  if (!right) throw new Error("Nothing to compare against: this clause has no firm standard. Paste text to compare, or pick another clause.");
  if (!aiConfig().hasKey) {
    const diff = clauseDiffSummary(right.text, left.text);
    const md = [
      `**Heuristic comparison** (OpenAI key required for a substantive analysis).`,
      ``,
      `| | ${left.name} | ${right.name} |`,
      `| --- | --- | --- |`,
      `| Words | ${diff.wordsCandidate} | ${diff.wordsStandard} |`,
      `| Variables | ${extractVariables(left.text).length} | ${extractVariables(right.text).length} |`,
      ``,
      `**Sentences only in ${right.name}** (${diff.onlyInStandard.length}):`,
      ...diff.onlyInStandard.slice(0, 8).map((s) => `- ${s.slice(0, 220)}${s.length > 220 ? "…" : ""}`),
      ``,
      `**Sentences only in ${left.name}** (${diff.onlyInCandidate.length}):`,
      ...diff.onlyInCandidate.slice(0, 8).map((s) => `- ${s.slice(0, 220)}${s.length > 220 ? "…" : ""}`),
    ].join("\n");
    return { analysis: md, mode: "heuristic", standardName: right.name };
  }
  const res = await generateText({
    instructions: `You are a senior ${FIRM_NAME} transactional and litigation drafter comparing two clauses. ${todayLine()}\nProduce a Markdown report with: (1) a two-sentence verdict on which is more favorable to our client and why; (2) a table of material differences (topic | ${left.name} | ${right.name} | risk to client: low/medium/high); (3) missing protections in ${left.name} that ${right.name} has; (4) recommended redlines as concrete replacement language. Treat {{Variable}} placeholders as fill-ins, not differences. Be precise and do not invent terms that are not in either text.\n${LEGAL_STYLE_RULES}`,
    input: `${meta?.notes ? `Drafting notes on the firm clause: ${meta.notes}\n\n` : ""}=== ${left.name} ===\n${left.text.slice(0, 16_000)}\n\n=== ${right.name} ===\n${right.text.slice(0, 16_000)}`,
    maxOutputTokens: 1800,
    reasoningEffort: "low",
  });
  return { analysis: res.text, mode: "ai", standardName: right.name };
}
