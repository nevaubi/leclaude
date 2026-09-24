"use client";
/** Browser-only helpers: downloads, export/burn calls, page text cache and search, thumbnails, rasterization for true redaction. */
import { activePages, type PdfModel, type PdfRect } from "./model";
import { pageRuns, rectToViewport, renderPageToDataUrl, type PDFDocumentProxy } from "./pdfjs";
import type { SearchHit } from "./store";
import { searchRuns, type SearchOptions, type TextRun } from "./text-search";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(title: string) { return title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "document"; }

export function fmtBytes(n: number) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }

async function readError(res: Response) { const j = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }; return j.error ?? res.statusText; }

export interface ExportOptions { flattenAnnotations?: boolean; applyRedactions?: boolean; bates?: boolean; fillForms?: boolean; flattenForms?: boolean; decorations?: boolean; bookmarks?: boolean; skipResolved?: boolean; rasterizedPages?: Record<number, string> }

export async function exportPdfBytes(body: { docId?: string; content: PdfModel; title: string; options: ExportOptions }): Promise<Blob> {
  const res = await fetch("/api/office/pdf/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res));
  return res.blob();
}

export async function downloadExport(body: { docId?: string; content: PdfModel; title: string; options: ExportOptions }, suffix = "") {
  const blob = await exportPdfBytes(body);
  downloadBlob(blob, `${safeFilename(body.title)}${suffix}.pdf`);
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Page text cache + search
// ---------------------------------------------------------------------------
const runsCache = new Map<string, Promise<TextRun[]>>();

export function cachedRuns(pdfDoc: PDFDocumentProxy, key: string, source: number): Promise<TextRun[]> {
  const k = `${key}:${source}`;
  let p = runsCache.get(k);
  if (!p) { p = pdfDoc.getPage(source).then(pageRuns).catch(() => [] as TextRun[]); runsCache.set(k, p); }
  return p;
}

export function clearRunsCache(key?: string) { for (const k of Array.from(runsCache.keys())) if (!key || k.startsWith(`${key}:`)) runsCache.delete(k); }

/** Search every active page (in display order). */
export async function searchDocument(pdfDoc: PDFDocumentProxy, key: string, model: PdfModel, query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const pages = activePages(model);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.blank) continue;
    const runs = await cachedRuns(pdfDoc, key, p.index);
    for (const match of searchRuns(runs, query, { ...opts, limit: 300 })) hits.push({ display: i + 1, source: p.index, match });
    if (hits.length > 2000) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------
const thumbCache = new Map<string, Promise<string>>();
let thumbQueue: Promise<unknown> = Promise.resolve();

export function thumbnail(pdfDoc: PDFDocumentProxy, key: string, source: number, rotation: number, width = 160): Promise<string> {
  const k = `${key}:${source}:${rotation}:${width}`;
  let p = thumbCache.get(k);
  if (!p) {
    p = (thumbQueue = thumbQueue.then(async () => {
      const page = await pdfDoc.getPage(source);
      const r = await renderPageToDataUrl(page, { width, rotation: (page.rotate + rotation) % 360, type: "image/jpeg", quality: 0.82 });
      return r.dataUrl;
    })) as Promise<string>;
    thumbCache.set(k, p);
    p.catch(() => thumbCache.delete(k));
  }
  return p;
}

export function clearThumbCache(key?: string) { for (const k of Array.from(thumbCache.keys())) if (!key || k.startsWith(`${key}:`)) thumbCache.delete(k); }

// ---------------------------------------------------------------------------
// True redaction: rasterize pages that carry redactions, painting the boxes.
// ---------------------------------------------------------------------------
export async function rasterizeRedactedPages(pdfDoc: PDFDocumentProxy, model: PdfModel, opts: { scale?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<Record<number, string>> {
  const sources = Array.from(new Set(model.annotations.filter((a) => a.type === "redaction" && !a.applied).map((a) => a.page)));
  const out: Record<number, string> = {};
  let done = 0;
  for (const source of sources) {
    const page = await pdfDoc.getPage(source);
    const mp = model.pages.find((p) => p.index === source);
    const boxes: PdfRect[] = model.annotations.filter((a) => a.type === "redaction" && a.page === source).flatMap((a) => a.rects.map((r) => ({ ...r, color: a.color }) as PdfRect & { color?: string }));
    const rotation = (page.rotate + (mp?.rotation ?? 0)) % 360;
    const r = await renderPageToDataUrl(page, { scale: opts.scale ?? 2, rotation, type: "image/png", paint: (ctx, vp) => {
      for (const b of boxes) {
        const c = rectToViewport(vp, b);
        ctx.fillStyle = (b as { color?: string }).color || "#111111";
        ctx.fillRect(Math.floor(c.left - 1), Math.floor(c.top - 1), Math.ceil(c.width + 2), Math.ceil(c.height + 2));
      }
    } });
    out[source] = r.dataUrl;
    done++;
    opts.onProgress?.(done, sources.length);
  }
  return out;
}

/** Rendering of a display page as a JPEG data URL for the agent's describe_page_image (kept small). */
export async function pageImageForAgent(pdfDoc: PDFDocumentProxy, model: PdfModel, display: number): Promise<string | null> {
  const p = activePages(model)[display - 1];
  if (!p || p.blank) return null;
  try {
    const page = await pdfDoc.getPage(p.index);
    const r = await renderPageToDataUrl(page, { width: 1000, rotation: (page.rotate + p.rotation) % 360, type: "image/jpeg", quality: 0.7 });
    return r.dataUrl;
  } catch { return null; }
}
