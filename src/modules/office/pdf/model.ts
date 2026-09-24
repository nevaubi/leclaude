/**
 * PDF editor content model. Shared by the client editor, the export pipeline
 * (pdf-lib) and the agent. Coordinates are PDF user space (points, origin at
 * the bottom-left of the unrotated page); `page` on annotations is the 1-based
 * SOURCE page number, which stays stable when pages are reordered or deleted.
 * Users and the agent talk in DISPLAY page numbers (position in the current
 * page order); use `displayToSource`/`sourceToDisplay` to translate.
 */
import { nanoid } from "nanoid";

export type AnnotationType = "highlight" | "underline" | "strikeout" | "note" | "text" | "rect" | "ellipse" | "freehand" | "stamp" | "redaction" | "link" | "signature";

export interface PdfRect { x: number; y: number; w: number; h: number }
export interface PdfPoint { x: number; y: number }

export interface PdfPage {
  /** Stable id used by the UI for keys / drag-and-drop. */
  id: string;
  /** 1-based source page number; inserted blank pages get a synthetic number ≥ 10000. */
  index: number;
  rotation: 0 | 90 | 180 | 270;
  width: number;
  height: number;
  deleted?: boolean;
  order: number;
  /** Inserted blank page (no source content). */
  blank?: boolean;
}

export interface PdfAnnotation {
  id: string;
  /** Source page number (see file header). */
  page: number;
  type: AnnotationType;
  rects: PdfRect[];
  color: string; // hex
  opacity: number; // 0..1
  /** Note body / text-box text / stamp label / link label. */
  text?: string;
  /** Quoted document text for text markups. */
  quote?: string;
  /** Freehand paths (PDF space). */
  paths?: PdfPoint[][];
  /** Font size for text boxes (points). */
  fontSize?: number;
  /** Border width for shapes. */
  strokeWidth?: number;
  /** Link target. */
  href?: string;
  /** PNG data URL for signatures. */
  imageDataUrl?: string;
  /** Redaction reason / exemption code (e.g. "PII", "Privilege — AC"). */
  reason?: string;
  author: string;
  createdAt: string;
  resolved?: boolean;
  /** Set on redactions/stamps that were burned into the source blob. */
  applied?: boolean;
}

export type BatesPosition = "top-right" | "bottom-right" | "bottom-center" | "top-left" | "bottom-left" | "top-center";

export interface BatesConfig {
  prefix: string;
  start: number;
  digits: number;
  position: BatesPosition;
  fontSize?: number;
  /** Optional confidentiality legend on the opposite corner ("CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER"). */
  legend?: string;
  applied?: boolean;
}

export interface PdfDecorations {
  header?: { text: string; position?: "top-left" | "top-center" | "top-right"; fontSize?: number };
  footer?: { text: string; position?: "bottom-left" | "bottom-center" | "bottom-right"; fontSize?: number };
  pageNumbers?: { format: string; position: BatesPosition; fontSize?: number; startAt?: number };
  watermark?: { text: string; opacity?: number; fontSize?: number; angle?: number; color?: string };
}

export interface PdfBookmark { id: string; page: number; title: string; level?: number }

export interface PdfFormField {
  name: string;
  type: "text" | "checkbox" | "radio" | "dropdown" | "option" | "button" | "signature";
  value?: string | boolean;
  options?: string[];
  page?: number;
  rect?: PdfRect;
  readOnly?: boolean;
}

export interface PdfOutlineItem { title: string; page: number | null; children?: PdfOutlineItem[] }

export interface PdfModel {
  version: 1;
  sourceBlobId: string;
  pageCount: number;
  pages: PdfPage[];
  annotations: PdfAnnotation[];
  bates?: BatesConfig;
  formValues?: Record<string, string | boolean>;
  /** Cached extraction, keyed by source page number. */
  textIndex?: { page: number; text: string }[];
  decorations?: PdfDecorations;
  bookmarks?: PdfBookmark[];
  meta: {
    title?: string;
    originalName?: string;
    sourceSize?: number;
    templateId?: string;
    /** Template documents are generated lazily on first open. */
    pending?: boolean;
    fields?: PdfFormField[];
    outline?: PdfOutlineItem[];
    extractedAt?: string;
    producer?: string;
    hasForm?: boolean;
    [k: string]: unknown;
  };
}

export const ANNOTATION_LABEL: Record<AnnotationType, string> = {
  highlight: "Highlight", underline: "Underline", strikeout: "Strikeout", note: "Sticky note", text: "Text box", rect: "Rectangle", ellipse: "Ellipse", freehand: "Freehand", stamp: "Stamp", redaction: "Redaction", link: "Link", signature: "Signature",
};

export const ANNOTATION_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "yellow", label: "Yellow", hex: "#FACC15" },
  { id: "green", label: "Green", hex: "#4ADE80" },
  { id: "blue", label: "Blue", hex: "#60A5FA" },
  { id: "pink", label: "Pink", hex: "#F472B6" },
  { id: "orange", label: "Orange", hex: "#FB923C" },
  { id: "purple", label: "Purple", hex: "#A78BFA" },
  { id: "red", label: "Red", hex: "#EF4444" },
  { id: "black", label: "Black", hex: "#111111" },
];

export const STAMP_PRESETS = ["CONFIDENTIAL", "HIGHLY CONFIDENTIAL — AEO", "DRAFT", "FILED", "EXHIBIT A", "EXHIBIT B", "RECEIVED", "PRIVILEGED", "SUBJECT TO PROTECTIVE ORDER", "COPY", "VOID"] as const;

export const REDACTION_REASONS = ["PII", "PHI", "Privilege — attorney-client", "Privilege — work product", "Trade secret", "Financial account", "SSN", "Minor", "Non-responsive"] as const;

export const DEFAULT_COLOR: Record<AnnotationType, string> = {
  highlight: "#FACC15", underline: "#EF4444", strikeout: "#EF4444", note: "#FACC15", text: "#111111", rect: "#EF4444", ellipse: "#2563EB", freehand: "#2563EB", stamp: "#B91C1C", redaction: "#111111", link: "#2563EB", signature: "#111111",
};

export const DEFAULT_OPACITY: Record<AnnotationType, number> = {
  highlight: 0.4, underline: 1, strikeout: 1, note: 1, text: 1, rect: 1, ellipse: 1, freehand: 1, stamp: 0.9, redaction: 1, link: 1, signature: 1,
};

export const LETTER: [number, number] = [612, 792];

export function newAnnotationId() { return `an_${nanoid(8)}`; }
export function newPageId() { return `pg_${nanoid(6)}`; }

/** Build a fresh model for a source with the given page sizes (points). */
export function buildModel(input: { sourceBlobId: string; pageSizes: { width: number; height: number; rotation?: number }[]; meta?: PdfModel["meta"]; textIndex?: { page: number; text: string }[] }): PdfModel {
  return {
    version: 1,
    sourceBlobId: input.sourceBlobId,
    pageCount: input.pageSizes.length,
    pages: input.pageSizes.map((p, i) => ({ id: `pg_${i + 1}`, index: i + 1, rotation: 0, width: p.width, height: p.height, order: i })),
    annotations: [],
    textIndex: input.textIndex,
    meta: input.meta ?? {},
  };
}

export function emptyModel(): PdfModel {
  return { version: 1, sourceBlobId: "", pageCount: 0, pages: [], annotations: [], meta: {} };
}

/** Defensive normalization for models coming from storage or the client. */
export function normalizeModel(raw: unknown): PdfModel {
  const m = (raw && typeof raw === "object" ? raw : {}) as Partial<PdfModel>;
  const pages = Array.isArray(m.pages) ? m.pages : [];
  const normPages: PdfPage[] = pages
    .filter((p): p is PdfPage => Boolean(p) && typeof p === "object")
    .map((p, i) => ({
      id: typeof p.id === "string" && p.id ? p.id : `pg_${p.index ?? i + 1}`,
      index: Number(p.index ?? i + 1),
      rotation: ([0, 90, 180, 270] as const).includes((Number(p.rotation) as 0 | 90 | 180 | 270) ?? 0) ? (Number(p.rotation) as 0 | 90 | 180 | 270) : 0,
      width: Number(p.width) > 0 ? Number(p.width) : LETTER[0],
      height: Number(p.height) > 0 ? Number(p.height) : LETTER[1],
      deleted: Boolean(p.deleted) || undefined,
      order: typeof p.order === "number" ? p.order : i,
      blank: Boolean(p.blank) || undefined,
    }))
    .sort((a, b) => a.order - b.order)
    .map((p, i) => ({ ...p, order: i }));
  const annotations = (Array.isArray(m.annotations) ? m.annotations : [])
    .filter((a): a is PdfAnnotation => Boolean(a) && typeof a === "object" && typeof (a as PdfAnnotation).type === "string")
    .map((a) => ({ ...a, id: a.id || newAnnotationId(), rects: Array.isArray(a.rects) ? a.rects : [], color: a.color || DEFAULT_COLOR[a.type] || "#FACC15", opacity: typeof a.opacity === "number" ? a.opacity : DEFAULT_OPACITY[a.type] ?? 1, author: a.author || "Unknown", createdAt: a.createdAt || new Date(0).toISOString() }));
  return {
    version: 1,
    sourceBlobId: typeof m.sourceBlobId === "string" ? m.sourceBlobId : "",
    pageCount: typeof m.pageCount === "number" ? m.pageCount : normPages.filter((p) => !p.blank).length,
    pages: normPages,
    annotations,
    bates: m.bates && typeof m.bates === "object" ? { prefix: String(m.bates.prefix ?? ""), start: Number(m.bates.start ?? 1), digits: Number(m.bates.digits ?? 6), position: m.bates.position ?? "bottom-right", fontSize: m.bates.fontSize, legend: m.bates.legend, applied: m.bates.applied } : undefined,
    formValues: m.formValues && typeof m.formValues === "object" ? m.formValues : undefined,
    textIndex: Array.isArray(m.textIndex) ? m.textIndex.filter((t) => t && typeof t.page === "number").map((t) => ({ page: t.page, text: String(t.text ?? "") })) : undefined,
    decorations: m.decorations && typeof m.decorations === "object" ? m.decorations : undefined,
    bookmarks: Array.isArray(m.bookmarks) ? m.bookmarks : undefined,
    meta: m.meta && typeof m.meta === "object" ? m.meta : {},
  };
}

/** Pages in display order, excluding deleted ones. */
export function activePages(model: PdfModel): PdfPage[] {
  return [...model.pages].filter((p) => !p.deleted).sort((a, b) => a.order - b.order);
}

/** Display page number (1-based) → source page number, or null. */
export function displayToSource(model: PdfModel, display: number): number | null {
  const p = activePages(model)[display - 1];
  return p ? p.index : null;
}

/** Source page number → display page number (1-based), or null when deleted. */
export function sourceToDisplay(model: PdfModel, source: number): number | null {
  const i = activePages(model).findIndex((p) => p.index === source);
  return i >= 0 ? i + 1 : null;
}

export function pageBySource(model: PdfModel, source: number): PdfPage | undefined {
  return model.pages.find((p) => p.index === source);
}

/** Parse "1-3, 5, 8-10" into display page numbers within [1, max]. */
export function parsePageRange(input: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of input.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i);
  }
  return Array.from(out).sort((x, y) => x - y);
}

export function formatBates(cfg: Pick<BatesConfig, "prefix" | "start" | "digits">, i: number) {
  return `${cfg.prefix}${String(cfg.start + i).padStart(cfg.digits, "0")}`;
}

/** Union bounding box of rects. */
export function boundsOf(rects: PdfRect[]): PdfRect | null {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Plain text of the whole (active) document from the cached index, with page markers. */
export function textOfModel(model: PdfModel, opts: { markers?: boolean } = {}): string {
  const idx = new Map((model.textIndex ?? []).map((t) => [t.page, t.text]));
  return activePages(model)
    .map((p, i) => { const t = p.blank ? "" : idx.get(p.index) ?? ""; return opts.markers === false ? t : `--- Page ${i + 1} ---\n${t}`; })
    .join("\n\n");
}

/** Summary counts by annotation type. */
export function annotationStats(model: PdfModel) {
  const byType: Partial<Record<AnnotationType, number>> = {};
  for (const a of model.annotations) byType[a.type] = (byType[a.type] ?? 0) + 1;
  return { total: model.annotations.length, byType, unresolved: model.annotations.filter((a) => !a.resolved).length };
}

export function pageLabel(model: PdfModel, source: number) {
  const d = sourceToDisplay(model, source);
  return d ? `p. ${d}` : `p. ${source} (deleted)`;
}
