import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import type { OfficeComment, OfficeDocument, OfficeKind, OfficeVersion } from "@/lib/types/domain";
import { indexDocument, VECTOR_COLLECTIONS_OFFICE } from "./indexing";

const CURRENT_USER = { id: "p_jwhitfield", name: "Jordan Whitfield" };
const AUTOSAVE_VERSION_INTERVAL_MS = 10 * 60 * 1000;

export function listOfficeDocs(opts: { kind?: OfficeKind; matterId?: string; limit?: number } = {}) {
  return db().officeDocs.list({ where: (d) => (!opts.kind || d.kind === opts.kind) && (!opts.matterId || d.matterId === opts.matterId), sortBy: "updatedAt", direction: "desc", limit: opts.limit });
}

export function createOfficeDoc(input: { kind: OfficeKind; title?: string; content: unknown; matterId?: string; folderId?: string; templateId?: string; meta?: Record<string, unknown>; id?: string; tags?: string[] }): OfficeDocument {
  const now = new Date().toISOString();
  const doc: OfficeDocument = {
    id: input.id ?? nanoid(12),
    kind: input.kind,
    title: input.title?.trim() || defaultTitle(input.kind),
    matterId: input.matterId,
    folderId: input.folderId,
    content: input.content,
    contentVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdById: CURRENT_USER.id,
    updatedById: CURRENT_USER.id,
    templateId: input.templateId,
    tags: input.tags,
    meta: input.meta,
    size: JSON.stringify(input.content ?? null).length,
  };
  db().officeDocs.put(doc);
  db().officeVersions.put({ id: nanoid(10), docId: doc.id, version: 1, label: "Created", summary: input.templateId ? `Created from template ${input.templateId}` : "Created", authorId: CURRENT_USER.id, authorName: CURRENT_USER.name, createdAt: now, content: input.content });
  void reindex(doc);
  return doc;
}

export function getOfficeDoc(id: string) {
  return db().officeDocs.get(id);
}

export interface SaveOptions {
  title?: string;
  content?: unknown;
  meta?: Record<string, unknown>;
  matterId?: string | null;
  tags?: string[];
  /** Force a version snapshot with this label/summary (agent edits, checkpoints). */
  version?: { label?: string; summary?: string; authorName?: string; force?: boolean };
}

export function saveOfficeDoc(id: string, opts: SaveOptions): OfficeDocument | null {
  const d = db();
  const cur = d.officeDocs.get(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  const contentChanged = opts.content !== undefined && JSON.stringify(opts.content) !== JSON.stringify(cur.content);
  const next: OfficeDocument = {
    ...cur,
    title: opts.title?.trim() || cur.title,
    content: opts.content !== undefined ? opts.content : cur.content,
    meta: opts.meta ? { ...(cur.meta ?? {}), ...opts.meta } : cur.meta,
    matterId: opts.matterId === undefined ? cur.matterId : (opts.matterId ?? undefined),
    tags: opts.tags ?? cur.tags,
    contentVersion: contentChanged ? cur.contentVersion + 1 : cur.contentVersion,
    updatedAt: now,
    updatedById: CURRENT_USER.id,
    size: opts.content !== undefined ? JSON.stringify(opts.content ?? null).length : cur.size,
  };
  d.officeDocs.put(next);
  const explicitVersion = Boolean(opts.version?.force || opts.version?.label || opts.version?.summary);
  if (contentChanged || explicitVersion) {
    const versions = d.officeVersions.find((v) => v.docId === id).sort((a, b) => b.version - a.version);
    const last = versions[0];
    const stale = !last || Date.now() - new Date(last.createdAt).getTime() > AUTOSAVE_VERSION_INTERVAL_MS;
    if (explicitVersion || stale) {
      d.officeVersions.put({ id: nanoid(10), docId: id, version: (last?.version ?? 0) + 1, label: opts.version?.label, summary: opts.version?.summary ?? "Saved changes", authorId: CURRENT_USER.id, authorName: opts.version?.authorName ?? CURRENT_USER.name, createdAt: now, content: next.content, changedFields: countChangedFields(last?.content, next.content) });
    }
    if (contentChanged) void reindex(next);
  }
  return next;
}

export function deleteOfficeDoc(id: string) {
  const d = db();
  const ok = d.officeDocs.delete(id);
  for (const v of d.officeVersions.find((v) => v.docId === id)) d.officeVersions.delete(v.id);
  for (const c of d.officeComments.find((c) => c.docId === id)) d.officeComments.delete(c.id);
  for (const li of d.library.find((l) => l.officeDocId === id)) d.library.delete(li.id);
  return ok;
}

export function listVersions(docId: string): Omit<OfficeVersion, "content">[] {
  return db().officeVersions.find((v) => v.docId === docId).sort((a, b) => b.version - a.version).map(({ content: _c, ...rest }) => { void _c; return rest; });
}

export function getVersion(docId: string, versionId: string) {
  const v = db().officeVersions.get(versionId);
  return v && v.docId === docId ? v : null;
}

export function checkpoint(docId: string, label: string) {
  const d = db();
  const cur = d.officeDocs.get(docId);
  if (!cur) return null;
  const versions = d.officeVersions.find((v) => v.docId === docId).sort((a, b) => b.version - a.version);
  const v: OfficeVersion = { id: nanoid(10), docId, version: (versions[0]?.version ?? 0) + 1, label, summary: "Checkpoint", authorId: CURRENT_USER.id, authorName: CURRENT_USER.name, createdAt: new Date().toISOString(), content: cur.content };
  d.officeVersions.put(v);
  return v;
}

/** Restore a version: current content is saved first as a new version, then the old content becomes current (also a new version). */
export function restoreVersion(docId: string, versionId: string) {
  const d = db();
  const v = getVersion(docId, versionId);
  const cur = d.officeDocs.get(docId);
  if (!v || !cur) return null;
  checkpoint(docId, `Before restoring v${v.version}`);
  return saveOfficeDoc(docId, { content: v.content, version: { force: true, label: `Restored v${v.version}`, summary: `Restored from version ${v.version}${v.label ? ` (${v.label})` : ""}` } });
}

export function listComments(docId: string) {
  return db().officeComments.find((c) => c.docId === docId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function addComment(docId: string, input: { anchor: string; body: string; quote?: string; source?: "user" | "agent"; authorName?: string }): OfficeComment {
  const c: OfficeComment = { id: nanoid(10), docId, anchor: input.anchor, quote: input.quote, body: input.body, authorId: input.source === "agent" ? undefined : CURRENT_USER.id, authorName: input.authorName ?? (input.source === "agent" ? "Drafting assistant" : CURRENT_USER.name), createdAt: new Date().toISOString(), source: input.source ?? "user", replies: [] };
  db().officeComments.put(c);
  return c;
}

export function updateComment(id: string, patch: Partial<Pick<OfficeComment, "resolved" | "body">> & { reply?: string }) {
  return db().officeComments.update(id, (c) => ({ ...c, resolved: patch.resolved ?? c.resolved, body: patch.body ?? c.body, replies: patch.reply ? [...(c.replies ?? []), { id: nanoid(6), body: patch.reply, authorName: CURRENT_USER.name, createdAt: new Date().toISOString() }] : c.replies }));
}

export function deleteComment(id: string) {
  return db().officeComments.delete(id);
}

function defaultTitle(kind: OfficeKind) {
  return { word: "Untitled document", sheet: "Untitled workbook", slides: "Untitled deck", pdf: "Untitled PDF" }[kind];
}

function countChangedFields(a: unknown, b: unknown): number {
  const fa = flatten(a), fb = flatten(b);
  let n = 0;
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  for (const k of keys) if (fa[k] !== fb[k]) n++;
  return n;
}

function flatten(v: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (v == null || typeof v !== "object") { out[prefix] = String(v); return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out)); return out; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

async function reindex(doc: OfficeDocument) {
  try {
    const { extractPlainText } = await import("@/lib/ai/toolkit/internal");
    const text = `${doc.title}\n${extractPlainText(doc.content)}`;
    await indexDocument(VECTOR_COLLECTIONS_OFFICE, doc.id, text, { kind: doc.kind, title: doc.title, matterId: doc.matterId });
  } catch (e) {
    console.warn("[office] reindex failed", (e as Error).message);
  }
}
