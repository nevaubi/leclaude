/**
 * Agent snapshot of a PDF document: the content model (with the cached text
 * index) plus editor state. `renderSnapshot` produces the prompt text with
 * page markers, truncated per page and overall.
 */
import type { OfficeScope } from "@/modules/office/shared/types";
import { ANNOTATION_LABEL, activePages, annotationStats, normalizeModel, sourceToDisplay, type PdfModel } from "./model";

export interface PdfSnapshot {
  model: PdfModel;
  title: string;
  docId?: string;
  matterId?: string | null;
  /** Current display page in the viewer. */
  currentPage?: number;
  /** Selected text in the viewer, if any. */
  selection?: { page: number; text: string } | null;
  comments?: { id: string; anchor: string; body: string; author: string; resolved?: boolean }[];
}

export const PAGE_CHARS = 2000;
export const TOTAL_CHARS = 35_000;

export function parseSnapshot(raw: unknown): PdfSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("snapshot must be an object");
  const r = raw as Partial<PdfSnapshot>;
  const model = normalizeModel(r.model);
  return {
    model,
    title: typeof r.title === "string" ? r.title : "Untitled PDF",
    docId: typeof r.docId === "string" ? r.docId : undefined,
    matterId: typeof r.matterId === "string" ? r.matterId : null,
    currentPage: typeof r.currentPage === "number" ? r.currentPage : undefined,
    selection: r.selection && typeof r.selection === "object" && typeof r.selection.text === "string" ? { page: Number(r.selection.page) || 1, text: r.selection.text.slice(0, 8000) } : null,
    comments: Array.isArray(r.comments) ? r.comments.slice(0, 100) : [],
  };
}

/** Display page number of a "page:N" scope id, or null. */
export function scopePage(scope: OfficeScope | null): number | null {
  if (!scope || scope.kind !== "page") return null;
  const m = scope.id.match(/^page:(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function pageText(model: PdfModel, source: number): string {
  return model.textIndex?.find((t) => t.page === source)?.text ?? "";
}

export function renderSnapshot(s: PdfSnapshot, scope: OfficeScope | null): string {
  const { model } = s;
  const pages = activePages(model);
  const stats = annotationStats(model);
  const head: string[] = [];
  head.push(`TITLE: ${s.title}`);
  head.push(`PAGES: ${pages.length} active (${model.pages.filter((p) => p.deleted).length} deleted, ${pages.filter((p) => p.blank).length} blank inserted). Page numbers below are DISPLAY numbers (current order). Sizes: ${summarizeSizes(pages)}.`);
  if (model.meta.originalName) head.push(`FILE: ${model.meta.originalName}${model.meta.sourceSize ? ` (${Math.round(Number(model.meta.sourceSize) / 1024)} KB)` : ""}`);
  if (!model.textIndex?.length) head.push("TEXT: not extracted yet (call get_pages_text; the server extracts on demand).");
  if (model.bates) head.push(`BATES: ${model.bates.prefix}${String(model.bates.start).padStart(model.bates.digits, "0")} onward, ${model.bates.position}${model.bates.applied ? " (burned into source)" : " (pending export)"}${model.bates.legend ? `, legend "${model.bates.legend}"` : ""}`);
  if (model.decorations) head.push(`DECORATIONS: ${Object.entries(model.decorations).filter(([, v]) => v).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("; ")}`);
  if (model.meta.fields?.length) head.push(`FORM FIELDS: ${model.meta.fields.length} (${model.meta.fields.slice(0, 12).map((f) => `${f.name}:${f.type}${f.value !== undefined && f.value !== "" ? `=${JSON.stringify(f.value)}` : ""}`).join(", ")}${model.meta.fields.length > 12 ? ", …" : ""}). Pending values: ${JSON.stringify(model.formValues ?? {})}`);
  if (model.meta.outline?.length) head.push(`OUTLINE: ${flattenOutline(model.meta.outline).slice(0, 30).join(" | ")}`);
  if (model.bookmarks?.length) head.push(`BOOKMARKS (added): ${model.bookmarks.map((b) => `p.${sourceToDisplay(model, b.page) ?? "?"} ${b.title}`).join(" | ")}`);
  head.push(`ANNOTATIONS: ${stats.total} total, ${stats.unresolved} open — ${Object.entries(stats.byType).map(([t, n]) => `${n} ${ANNOTATION_LABEL[t as keyof typeof ANNOTATION_LABEL].toLowerCase()}`).join(", ") || "none"}.`);
  const annLines = model.annotations.slice(0, 60).map((a) => `  [${a.id}] p.${sourceToDisplay(model, a.page) ?? "deleted"} ${a.type}${a.text ? ` "${a.text.slice(0, 80)}"` : ""}${a.quote ? ` quote="${a.quote.slice(0, 60)}"` : ""}${a.reason ? ` reason=${a.reason}` : ""} by ${a.author}${a.resolved ? " (resolved)" : ""}${a.applied ? " (applied)" : ""}`);
  if (annLines.length) head.push(annLines.join("\n"));
  if (s.comments?.length) head.push(`COMMENTS: ${s.comments.filter((c) => !c.resolved).slice(0, 20).map((c) => `[${c.id}] ${c.anchor} ${c.author}: "${c.body.slice(0, 100)}"`).join(" | ")}`);
  if (s.currentPage) head.push(`VIEWER: user is looking at page ${s.currentPage}.`);
  if (s.selection?.text) head.push(`SELECTION (p.${s.selection.page}): "${s.selection.text.slice(0, 1500)}"`);

  const scoped = scopePage(scope);
  const body: string[] = [];
  let budget = TOTAL_CHARS;
  const list = scoped ? pages.filter((_, i) => i + 1 === scoped) : pages;
  const perPage = scoped ? 12_000 : PAGE_CHARS;
  for (const p of list) {
    const display = pages.indexOf(p) + 1;
    const raw = p.blank ? "(blank inserted page)" : pageText(model, p.index);
    const t = raw.length > perPage ? `${raw.slice(0, perPage)} … [truncated ${raw.length - perPage} chars; use get_pages_text for the full page]` : raw || "(no text on this page — scanned image or empty)";
    const block = `=== Page ${display}${p.rotation ? ` (rotated ${p.rotation}°)` : ""} ===\n${t}`;
    if (block.length > budget) { body.push(`… [${list.length - list.indexOf(p)} more pages omitted; use get_pages_text]`); break; }
    body.push(block);
    budget -= block.length;
  }
  return `${head.join("\n")}\n\nTEXT${scoped ? ` (scoped to page ${scoped})` : ""}:\n${body.join("\n\n")}`;
}

function summarizeSizes(pages: { width: number; height: number }[]) {
  const key = (p: { width: number; height: number }) => `${Math.round(p.width)}×${Math.round(p.height)}`;
  const counts = new Map<string, number>();
  for (const p of pages) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  return Array.from(counts.entries()).map(([k, n]) => `${k} pt${n > 1 ? ` ×${n}` : ""}`).join(", ") || "n/a";
}

function flattenOutline(items: { title: string; page: number | null; children?: { title: string; page: number | null; children?: unknown[] }[] }[], depth = 0): string[] {
  const out: string[] = [];
  for (const it of items) {
    out.push(`${"  ".repeat(depth)}${it.title}${it.page ? ` (p.${it.page})` : ""}`);
    if (it.children?.length) out.push(...flattenOutline(it.children as typeof items, depth + 1));
  }
  return out;
}
