import "server-only";
/**
 * Server-side text extraction with pdf.js (legacy build, no canvas). Returns
 * positioned runs per page (PDF user space), plain text, the outline and
 * document metadata. Extractions are cached per blob id so the agent's
 * find/highlight/redact tools can resolve rectangles without re-parsing.
 */
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from "pdf-lib";
import type { PdfFormField, PdfOutlineItem } from "./model";
import { runsToText, type TextRun } from "./text-search";

export interface ExtractedPage {
  page: number; width: number; height: number; rotation: number; text: string; runs: TextRun[];
  /** Page draws at least one image. */
  hasImages?: boolean;
  /** Image-only page: no machine-readable text (needs OCR; excluded from text-based claims). */
  needsOcr?: boolean;
}

export interface Extraction {
  pageCount: number;
  pages: ExtractedPage[];
  outline: PdfOutlineItem[];
  meta: { title?: string; author?: string; subject?: string; keywords?: string; producer?: string; creator?: string; created?: string; modified?: string; hasForm?: boolean; version?: string };
  fields: PdfFormField[];
  /** Page labels (/PageLabels) by page index, or null when the document defines none. */
  pageLabels: string[] | null;
  extractedAt: string;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

type G = typeof globalThis & { __leclaudePdfExtract?: Map<string, Promise<Extraction>> };
function cache() {
  const g = globalThis as G;
  if (!g.__leclaudePdfExtract) g.__leclaudePdfExtract = new Map();
  return g.__leclaudePdfExtract;
}

/** Extract everything from PDF bytes. `key` (blob id) enables caching. */
export function extractPdf(bytes: Uint8Array, key?: string): Promise<Extraction> {
  if (!key) return doExtract(bytes);
  const c = cache();
  const hit = c.get(key);
  if (hit) return hit;
  const p = doExtract(bytes).catch((e) => { c.delete(key); throw e; });
  c.set(key, p);
  if (c.size > 24) { const first = c.keys().next().value; if (first) c.delete(first); }
  return p;
}

export function invalidateExtraction(key: string) { cache().delete(key); }

async function doExtract(bytes: Uint8Array): Promise<Extraction> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1, rotation: 0 });
    const tc = await page.getTextContent();
    const glyphWidths = await fontGlyphWidths(lib, page).catch(() => new Map<string, Map<string, number>>());
    const runs: TextRun[] = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const t = it.transform as number[];
      const fontH = Math.hypot(t[2], t[3]) || it.height || 10;
      const run: TextRun = { s: it.str, x: t[4], y: t[5], w: it.width, h: fontH, eol: it.hasEOL };
      const cw = relativeWidths(it.str, glyphWidths.get(it.fontName));
      if (cw) run.cw = cw;
      runs.push(run);
    }
    pages.push({ page: i, width: vp.width, height: vp.height, rotation: page.rotate, text: runsToText(runs), runs });
    page.cleanup();
  }
  const outline = await readOutline(doc);
  let meta: Extraction["meta"] = {};
  try {
    const m = await doc.getMetadata();
    const info = (m.info ?? {}) as Record<string, unknown>;
    meta = { title: str(info.Title), author: str(info.Author), subject: str(info.Subject), keywords: str(info.Keywords), producer: str(info.Producer), creator: str(info.Creator), created: str(info.CreationDate), modified: str(info.ModDate), hasForm: Boolean(info.IsAcroFormPresent), version: str(info.PDFFormatVersion) };
  } catch { /* ignore */ }
  let pageLabels: string[] | null = null;
  try { pageLabels = (await doc.getPageLabels()) ?? null; } catch { pageLabels = null; }
  await task.destroy();
  const fields = await readFormFields(bytes).catch(() => [] as PdfFormField[]);
  const images = await pageImageFlags(bytes).catch(() => [] as boolean[]);
  for (const p of pages) {
    p.hasImages = images[p.page - 1] || undefined;
    if (p.hasImages && p.text.replace(/\s+/g, "").length < 16) p.needsOcr = true;
  }
  return { pageCount: pages.length, pages, outline, meta: { ...meta, hasForm: meta.hasForm || fields.length > 0 }, fields, pageLabels, extractedAt: new Date().toISOString() };
}

/**
 * Glyph advance widths per font (pdf.js loaded font name → character → width in glyph units), read from the page's
 * operator list, so match rectangles follow real glyph positions instead of an average character width.
 */
async function fontGlyphWidths(lib: PdfJs, page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }> }): Promise<Map<string, Map<string, number>>> {
  const ops = await page.getOperatorList();
  const OPS = lib.OPS as Record<string, number>;
  const out = new Map<string, Map<string, number>>();
  let font = "";
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.setFont) font = String(args?.[0] ?? "");
    else if (fn === OPS.showText && Array.isArray(args?.[0])) {
      let m = out.get(font);
      if (!m) { m = new Map(); out.set(font, m); }
      for (const g of args[0] as unknown[]) {
        if (!g || typeof g !== "object") continue;
        const gg = g as { unicode?: string; width?: number };
        if (typeof gg.unicode === "string" && typeof gg.width === "number" && gg.unicode) {
          const chars = Array.from(gg.unicode);
          for (const ch of chars) if (!m.has(ch)) m.set(ch, gg.width / chars.length);
        }
      }
    }
  }
  return out;
}

/** Per-character width fractions for a text item, or undefined when too few glyph widths are known. */
function relativeWidths(s: string, widths: Map<string, number> | undefined): number[] | undefined {
  if (!widths || !s) return undefined;
  const chars = s.split("");
  const known = chars.map((c) => widths.get(c));
  const have = known.filter((w): w is number => typeof w === "number" && w > 0);
  if (have.length < chars.length * 0.6) return undefined;
  const avg = have.reduce((a, b) => a + b, 0) / have.length;
  const ws = known.map((w, i) => (typeof w === "number" && w > 0 ? w : chars[i] === " " ? avg * 0.5 : avg));
  const total = ws.reduce((a, b) => a + b, 0);
  return total > 0 ? ws.map((w) => w / total) : undefined;
}

function str(v: unknown) { return typeof v === "string" && v.trim() ? v.trim() : undefined; }

type PdfJsDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type OutlineNode = { title: string; dest: unknown; items: OutlineNode[] };

async function readOutline(doc: PdfJsDoc): Promise<PdfOutlineItem[]> {
  let items: OutlineNode[] | null = null;
  try { items = (await doc.getOutline()) as OutlineNode[] | null; } catch { return []; }
  if (!items?.length) return [];
  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      let d = dest;
      if (typeof d === "string") d = await doc.getDestination(d);
      if (Array.isArray(d) && d[0] && typeof d[0] === "object") return (await doc.getPageIndex(d[0] as { num: number; gen: number })) + 1;
      if (Array.isArray(d) && typeof d[0] === "number") return (d[0] as number) + 1;
    } catch { /* unresolved */ }
    return null;
  };
  const walk = async (list: OutlineNode[], depth: number): Promise<PdfOutlineItem[]> => {
    const out: PdfOutlineItem[] = [];
    for (const it of list.slice(0, 200)) {
      const page = await resolve(it.dest);
      const children = depth < 3 && it.items?.length ? await walk(it.items, depth + 1) : undefined;
      out.push({ title: it.title, page, children: children?.length ? children : undefined });
    }
    return out;
  };
  return walk(items, 0);
}

/** AcroForm fields with values, options and widget rectangles (pdf-lib). */
export async function readFormFields(bytes: Uint8Array): Promise<PdfFormField[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  let fields: ReturnType<ReturnType<PDFDocument["getForm"]>["getFields"]> = [];
  try { fields = doc.getForm().getFields(); } catch { return []; }
  const pages = doc.getPages();
  const out: PdfFormField[] = [];
  for (const f of fields) {
    const name = f.getName();
    const ctor = f.constructor.name;
    let type: PdfFormField["type"] = "text";
    let value: string | boolean | undefined;
    let options: string[] | undefined;
    try {
      if (ctor === "PDFTextField") { type = "text"; value = (f as import("pdf-lib").PDFTextField).getText() ?? ""; }
      else if (ctor === "PDFCheckBox") { type = "checkbox"; value = (f as import("pdf-lib").PDFCheckBox).isChecked(); }
      else if (ctor === "PDFRadioGroup") { type = "radio"; const r = f as import("pdf-lib").PDFRadioGroup; options = r.getOptions(); value = r.getSelected() ?? ""; }
      else if (ctor === "PDFDropdown") { type = "dropdown"; const d = f as import("pdf-lib").PDFDropdown; options = d.getOptions(); value = d.getSelected()[0] ?? ""; }
      else if (ctor === "PDFOptionList") { type = "option"; const d = f as import("pdf-lib").PDFOptionList; options = d.getOptions(); value = d.getSelected()[0] ?? ""; }
      else if (ctor === "PDFButton") type = "button";
      else if (ctor === "PDFSignature") type = "signature";
    } catch { /* keep defaults */ }
    let page: number | undefined, rect: PdfFormField["rect"];
    try {
      const widget = f.acroField.getWidgets()[0];
      if (widget) {
        const r = widget.getRectangle();
        rect = { x: r.x, y: r.y, w: r.width, h: r.height };
        const pRef = widget.P();
        const idx = pRef ? pages.findIndex((p) => p.ref === pRef) : -1;
        if (idx >= 0) page = idx + 1;
        else {
          // fall back: find the page whose Annots contains this widget
          for (let i = 0; i < pages.length; i++) {
            const annots = pages[i].node.Annots();
            if (annots && annots.asArray().some((a) => a === widget.dict || (doc.context.lookup(a) === widget.dict))) { page = i + 1; break; }
          }
        }
      }
    } catch { /* no widget */ }
    out.push({ name, type, value, options, page, rect, readOnly: f.isReadOnly() || undefined });
  }
  return out;
}

/** Per page: whether the page (or a form XObject it draws, one level deep) uses an image XObject. */
export async function pageImageFlags(bytes: Uint8Array): Promise<boolean[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const lk = (o: PDFObject | undefined) => (o instanceof PDFRef ? doc.context.lookup(o) : o);
  const hasImage = (res: PDFObject | undefined, depth: number): boolean => {
    const r = lk(res);
    if (!(r instanceof PDFDict)) return false;
    const xo = lk(r.get(PDFName.of("XObject")));
    if (!(xo instanceof PDFDict)) return false;
    for (const [, v] of xo.entries()) {
      const s = lk(v);
      if (!(s instanceof PDFStream)) continue;
      const sub = s.dict.lookup(PDFName.of("Subtype"));
      if (sub instanceof PDFName && sub.decodeText() === "Image") return true;
      if (depth < 2 && sub instanceof PDFName && sub.decodeText() === "Form" && hasImage(s.dict.get(PDFName.of("Resources")), depth + 1)) return true;
    }
    return false;
  };
  return doc.getPages().map((p) => hasImage(p.node.Resources(), 0));
}

/** Page sizes (points) and intrinsic rotation via pdf-lib (cheap; no text parsing). */
export async function readPageSizes(bytes: Uint8Array): Promise<{ width: number; height: number; rotation: number }[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle }));
}
