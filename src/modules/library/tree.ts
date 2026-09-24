import type { LibraryItem } from "@/lib/types/domain";
import type { FolderNode, PathSegment } from "./types";
import { NEWS_CLIPPINGS_FOLDER, SYSTEM_FOLDER_ORDER, isSystemFolder, matterIdFromFolderId } from "./ids";

/**
 * Pure folder-tree helpers shared by the server (counts, breadcrumbs, move
 * validation) and the client (optimistic updates). No db access here.
 */

export function childrenOf(items: LibraryItem[], parentId: string | null) {
  return items.filter((i) => (i.parentId ?? null) === parentId);
}

/** Build the folder tree with direct and recursive counts of non-folder items. */
export function buildTree(items: LibraryItem[]): FolderNode[] {
  const folders = items.filter((i) => i.type === "folder");
  const byParent = new Map<string | null, LibraryItem[]>();
  for (const it of items) {
    const key = it.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(it);
  }
  const build = (folder: LibraryItem, depth: number, seen: Set<string>): FolderNode => {
    seen.add(folder.id);
    const kids = (byParent.get(folder.id) ?? []).filter((k) => !seen.has(k.id));
    const childFolders = kids.filter((k) => k.type === "folder").sort(folderSort);
    const children = childFolders.map((f) => build(f, depth + 1, seen));
    const count = kids.filter((k) => k.type !== "folder").length;
    const totalCount = count + children.reduce((n, c) => n + c.totalCount, 0);
    return { id: folder.id, name: folder.name, parentId: folder.parentId ?? null, depth, count, totalCount, children, matterId: folder.matterId ?? matterIdFromFolderId(folder.id) ?? undefined, system: isSystemFolder(folder.id), description: folder.description };
  };
  const seen = new Set<string>();
  const roots = folders.filter((f) => !f.parentId).sort(folderSort).map((f) => build(f, 0, seen));
  return roots;
}

/** Sort: system folders in canonical order first, then alphabetical. */
export function folderSort(a: LibraryItem, b: LibraryItem) {
  const ai = SYSTEM_FOLDER_ORDER.indexOf(a.id), bi = SYSTEM_FOLDER_ORDER.indexOf(b.id);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  if (a.id === NEWS_CLIPPINGS_FOLDER) return 1;
  if (b.id === NEWS_CLIPPINGS_FOLDER) return -1;
  return a.name.localeCompare(b.name);
}

export function breadcrumbsFor(items: LibraryItem[] | Map<string, LibraryItem>, folderId: string | null): PathSegment[] {
  const map = items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
  const out: PathSegment[] = [];
  let cur = folderId ? map.get(folderId) ?? null : null;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? map.get(cur.parentId) ?? null : null;
  }
  return out;
}

export function isDescendant(items: LibraryItem[] | Map<string, LibraryItem>, candidateId: string, ancestorId: string): boolean {
  const map = items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
  let cur = map.get(candidateId) ?? null;
  const guard = new Set<string>();
  while (cur && cur.parentId && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.parentId === ancestorId) return true;
    cur = map.get(cur.parentId) ?? null;
  }
  return false;
}

export interface MoveValidation { ok: boolean; reason?: string; ids: string[] }

/**
 * Validate moving `ids` under `targetId` (null = root). Rejects unknown ids,
 * non-folder targets, moving a folder into itself or its own descendant,
 * moving system folders, and no-op moves (already there).
 */
export function validateMove(items: LibraryItem[] | Map<string, LibraryItem>, ids: string[], targetId: string | null): MoveValidation {
  const map = items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
  if (targetId) {
    const target = map.get(targetId);
    if (!target) return { ok: false, reason: "Target folder does not exist", ids: [] };
    if (target.type !== "folder") return { ok: false, reason: `"${target.name}" is not a folder`, ids: [] };
  }
  const moved: string[] = [];
  for (const id of ids) {
    const it = map.get(id);
    if (!it) return { ok: false, reason: `Item ${id} does not exist`, ids: [] };
    if (it.type === "folder" && isSystemFolder(it.id)) return { ok: false, reason: `"${it.name}" is a system folder and cannot be moved`, ids: [] };
    if (targetId === it.id) return { ok: false, reason: `Cannot move "${it.name}" into itself`, ids: [] };
    if (targetId && it.type === "folder" && isDescendant(map, targetId, it.id)) return { ok: false, reason: `Cannot move "${it.name}" into one of its own subfolders`, ids: [] };
    if ((it.parentId ?? null) === targetId) continue; // already there
    moved.push(id);
  }
  if (!moved.length) return { ok: false, reason: "Nothing to move", ids: [] };
  return { ok: true, ids: moved };
}

/** All descendant ids of a folder (folders and items), depth-first. */
export function descendantIds(items: LibraryItem[], folderId: string): string[] {
  const byParent = new Map<string, LibraryItem[]>();
  for (const it of items) { if (!it.parentId) continue; if (!byParent.has(it.parentId)) byParent.set(it.parentId, []); byParent.get(it.parentId)!.push(it); }
  const out: string[] = [];
  const stack = [folderId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    for (const k of byParent.get(id) ?? []) { if (seen.has(k.id)) continue; seen.add(k.id); out.push(k.id); if (k.type === "folder") stack.push(k.id); }
  }
  return out;
}

/** Flatten the tree (pre-order) for keyboard navigation and move dialogs. */
export function flattenTree(roots: FolderNode[], expanded?: Set<string>): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (n: FolderNode) => { out.push(n); if (!expanded || expanded.has(n.id)) n.children.forEach(walk); };
  roots.forEach(walk);
  return out;
}

export function findNode(roots: FolderNode[], id: string): FolderNode | null {
  for (const r of roots) { if (r.id === id) return r; const f = findNode(r.children, id); if (f) return f; }
  return null;
}
