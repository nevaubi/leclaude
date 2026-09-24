import "server-only";
/**
 * Server-side text extraction with pdf.js (legacy build, no canvas). Returns
 * positioned runs per page (PDF user space), plain text, the outline and
 * document metadata. Extractions are cached per blob id so the agent's
 * find/highlight/redact tools can resolve rectangles without re-parsing.
 */
import { PDFDocument } from "pdf-lib";
import type { PdfFormField, PdfOutlineItem } from "./model";
import { runsToText, type TextRun } from "./text-search";

export interface ExtractedPage { page: number; width: number; height: number; rotation: number; text: string; runs: TextRun[] }

export interface Extraction {
  pageCount: number;
  pages: ExtractedPage[];
  outline: PdfOutlineItem[];
  meta: { title?: string; author?: string; subject?: string; producer?: string; creator?: string; created?: string; hasForm?: boolean; version?: string };
  fields: PdfFormField[];
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
    const runs: TextRun[] = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const t = it.transform as number[];
      const fontH = Math.hypot(t[2], t[3]) || it.height || 10;
      runs.push({ s: it.str, x: t[4], y: t[5], w: it.width, h: fontH, eol: it.hasEOL });
    }
    pages.push({ page: i, width: vp.width, height: vp.height, rotation: page.rotate, text: runsToText(runs), runs });
    page.cleanup();
  }
  const outline = await readOutline(doc);
  let meta: Extraction["meta"] = {};
  try {
    const m = await doc.getMetadata();
    const info = (m.info ?? {}) as Record<string, unknown>;
    meta = { title: str(info.Title), author: str(info.Author), subject: str(info.Subject), producer: str(info.Producer), creator: str(info.Creator), created: str(info.CreationDate), hasForm: Boolean(info.IsAcroFormPresent), version: str(info.PDFFormatVersion) };
  } catch { /* ignore */ }
  await task.destroy();
  const fields = await readFormFields(bytes).catch(() => [] as PdfFormField[]);
  return { pageCount: pages.length, pages, outline, meta: { ...meta, hasForm: meta.hasForm || fields.length > 0 }, fields, extractedAt: new Date().toISOString() };
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

/** Page sizes (points) and intrinsic rotation via pdf-lib (cheap; no text parsing). */
export async function readPageSizes(bytes: Uint8Array): Promise<{ width: number; height: number; rotation: number }[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle }));
}
