/**
 * PDF edit proposals: the operation vocabulary shared by the agent tools
 * (server, which mutates the snapshot model so later reads see the change)
 * and the editor store (client, which applies accepted proposals as undoable
 * edits). Every op is pure: `applyOp` returns a new model.
 */
import { activePages, displayToSource, newAnnotationId, newPageId, normalizeModel, type BatesConfig, type PdfAnnotation, type PdfBookmark, type PdfDecorations, type PdfModel, type PdfPage } from "./model";

export type PdfOp =
  | { op: "add_annotations"; annotations: PdfAnnotation[] }
  | { op: "update_annotation"; id: string; patch: Partial<PdfAnnotation> }
  | { op: "remove_annotations"; ids: string[] }
  | { op: "resolve_annotations"; ids: string[]; resolved: boolean }
  | { op: "set_bates"; bates: BatesConfig | null }
  | { op: "rotate_pages"; sourcePages: number[]; delta: 90 | 180 | 270 | -90 }
  | { op: "delete_pages"; sourcePages: number[] }
  | { op: "restore_pages"; sourcePages: number[] }
  | { op: "reorder_pages"; order: number[] } // source page numbers in the new display order (active pages only)
  | { op: "insert_blank_page"; afterDisplay: number; width?: number; height?: number; count?: number; id?: string }
  | { op: "fill_form"; values: Record<string, string | boolean> }
  | { op: "add_bookmark"; bookmark: PdfBookmark }
  | { op: "remove_bookmark"; id: string }
  | { op: "set_decorations"; decorations: PdfDecorations | null }
  | { op: "append_pages"; pages: PdfPage[]; sourceBlobId: string; pageCount: number }
  | { op: "replace_model"; model: PdfModel };

export function opTitle(op: PdfOp): string {
  switch (op.op) {
    case "add_annotations": return op.annotations.length === 1 ? `Add ${op.annotations[0].type}` : `Add ${op.annotations.length} annotations`;
    case "update_annotation": return "Update annotation";
    case "remove_annotations": return `Remove ${op.ids.length} annotation${op.ids.length === 1 ? "" : "s"}`;
    case "resolve_annotations": return op.resolved ? "Resolve annotations" : "Reopen annotations";
    case "set_bates": return op.bates ? `Bates stamp ${op.bates.prefix}${String(op.bates.start).padStart(op.bates.digits, "0")}…` : "Remove Bates numbering";
    case "rotate_pages": return `Rotate ${op.sourcePages.length} page${op.sourcePages.length === 1 ? "" : "s"} ${op.delta > 0 ? "clockwise" : "counter-clockwise"}`;
    case "delete_pages": return `Delete ${op.sourcePages.length} page${op.sourcePages.length === 1 ? "" : "s"}`;
    case "restore_pages": return `Restore ${op.sourcePages.length} page${op.sourcePages.length === 1 ? "" : "s"}`;
    case "reorder_pages": return "Reorder pages";
    case "insert_blank_page": return `Insert blank page after p. ${op.afterDisplay}`;
    case "fill_form": return `Fill ${Object.keys(op.values).length} form field${Object.keys(op.values).length === 1 ? "" : "s"}`;
    case "add_bookmark": return `Add bookmark “${op.bookmark.title}”`;
    case "remove_bookmark": return "Remove bookmark";
    case "set_decorations": return op.decorations ? "Set header/footer/watermark" : "Clear header/footer/watermark";
    case "append_pages": return `Append ${op.pages.length} page${op.pages.length === 1 ? "" : "s"}`;
    case "replace_model": return "Replace document";
  }
}

/** Apply one operation, returning a new model (input untouched). Throws on invalid targets. */
export function applyOp(model: PdfModel, raw: PdfOp | Record<string, unknown>): PdfModel {
  const op = raw as PdfOp;
  const next: PdfModel = { ...model, pages: [...model.pages].sort((a, b) => a.order - b.order).map((p) => ({ ...p })), annotations: model.annotations.map((a) => ({ ...a })), bookmarks: model.bookmarks ? [...model.bookmarks] : undefined, meta: { ...model.meta } };
  const known = new Set(next.pages.map((p) => p.index));
  const requirePages = (list: number[]) => { for (const n of list) if (!known.has(n)) throw new Error(`No page with source number ${n}`); };
  switch (op.op) {
    case "add_annotations": {
      for (const a of op.annotations) {
        if (!known.has(a.page)) throw new Error(`Annotation targets unknown page ${a.page}`);
        next.annotations.push({ ...a, id: a.id && !next.annotations.some((x) => x.id === a.id) ? a.id : newAnnotationId() });
      }
      return next;
    }
    case "update_annotation": {
      const i = next.annotations.findIndex((a) => a.id === op.id);
      if (i < 0) throw new Error(`No annotation ${op.id}`);
      next.annotations[i] = { ...next.annotations[i], ...op.patch, id: op.id };
      return next;
    }
    case "remove_annotations": {
      const ids = new Set(op.ids);
      next.annotations = next.annotations.filter((a) => !ids.has(a.id));
      return next;
    }
    case "resolve_annotations": {
      const ids = new Set(op.ids);
      next.annotations = next.annotations.map((a) => (ids.has(a.id) ? { ...a, resolved: op.resolved } : a));
      return next;
    }
    case "set_bates":
      next.bates = op.bates ? { ...op.bates, applied: false } : undefined;
      return next;
    case "rotate_pages": {
      requirePages(op.sourcePages);
      const set = new Set(op.sourcePages);
      next.pages = next.pages.map((p) => (set.has(p.index) ? { ...p, rotation: (((p.rotation + op.delta) % 360 + 360) % 360) as PdfPage["rotation"] } : p));
      return next;
    }
    case "delete_pages": {
      requirePages(op.sourcePages);
      const set = new Set(op.sourcePages);
      const remaining = next.pages.filter((p) => !p.deleted && !set.has(p.index));
      if (!remaining.length) throw new Error("Cannot delete every page");
      // Deleted pages keep their position so a restore puts them back where they were.
      next.pages = next.pages.map((p) => (set.has(p.index) ? { ...p, deleted: true } : p));
      return renumber(next);
    }
    case "restore_pages": {
      const set = new Set(op.sourcePages);
      next.pages = next.pages.map((p) => (set.has(p.index) ? { ...p, deleted: undefined } : p));
      return renumber(next);
    }
    case "reorder_pages": {
      const active = activePages(next);
      const activeSet = new Set(active.map((p) => p.index));
      const seen = new Set<number>();
      for (const n of op.order) { if (!activeSet.has(n)) throw new Error(`Page ${n} is not an active page`); if (seen.has(n)) throw new Error(`Page ${n} listed twice`); seen.add(n); }
      const tail = active.filter((p) => !seen.has(p.index)).map((p) => p.index);
      const order = [...op.order, ...tail];
      const rank = new Map(order.map((n, i) => [n, i]));
      const deleted = next.pages.filter((p) => p.deleted);
      next.pages = [...next.pages.filter((p) => !p.deleted).sort((a, b) => (rank.get(a.index) ?? 0) - (rank.get(b.index) ?? 0)), ...deleted];
      return renumber(next);
    }
    case "insert_blank_page": {
      const active = activePages(next);
      const after = Math.max(0, Math.min(active.length, op.afterDisplay));
      const ref = active[after - 1] ?? active[0];
      const width = op.width ?? ref?.width ?? 612, height = op.height ?? ref?.height ?? 792;
      const count = Math.max(1, Math.min(50, op.count ?? 1));
      const maxIdx = Math.max(9999, ...next.pages.map((p) => p.index));
      const blanks: PdfPage[] = Array.from({ length: count }, (_, i) => ({ id: i === 0 && op.id ? op.id : newPageId(), index: maxIdx + 1 + i, rotation: 0, width, height, order: 0, blank: true }));
      // Insert into the full list right after the reference active page (or at the very start).
      const at = after === 0 ? 0 : next.pages.findIndex((p) => p.id === active[after - 1].id) + 1;
      next.pages.splice(at, 0, ...blanks);
      return renumber(next);
    }
    case "fill_form":
      next.formValues = { ...(next.formValues ?? {}), ...op.values };
      return next;
    case "add_bookmark": {
      if (!known.has(op.bookmark.page)) throw new Error(`No page with source number ${op.bookmark.page}`);
      const list = (next.bookmarks ?? []).filter((b) => b.id !== op.bookmark.id);
      list.push({ ...op.bookmark, id: op.bookmark.id || `bm_${Math.random().toString(36).slice(2, 8)}` });
      next.bookmarks = list;
      return next;
    }
    case "remove_bookmark":
      next.bookmarks = (next.bookmarks ?? []).filter((b) => b.id !== op.id);
      return next;
    case "set_decorations":
      next.decorations = op.decorations ?? undefined;
      return next;
    case "append_pages": {
      next.sourceBlobId = op.sourceBlobId;
      next.pageCount = op.pageCount;
      const deleted = next.pages.filter((p) => p.deleted);
      next.pages = [...next.pages.filter((p) => !p.deleted), ...op.pages.map((p) => ({ ...p })), ...deleted];
      return renumber(next);
    }
    case "replace_model":
      return normalizeModel(op.model);
    default:
      throw new Error(`Unknown operation ${(op as { op?: string }).op ?? "?"}`);
  }
}

/** Array position is authoritative: recompute `order` sequentially (deleted pages keep their slot). */
function renumber(m: PdfModel): PdfModel {
  m.pages = m.pages.map((p, i) => ({ ...p, order: i }));
  return m;
}

/** Resolve a list of display page numbers (or "all") into source page numbers. */
export function resolvePages(model: PdfModel, pages: number[] | "all" | undefined): number[] {
  const active = activePages(model);
  if (!pages || pages === "all") return active.map((p) => p.index);
  const out: number[] = [];
  for (const d of pages) {
    const s = displayToSource(model, d);
    if (s == null) throw new Error(`No page ${d} (document has ${active.length} pages)`);
    out.push(s);
  }
  return out;
}
