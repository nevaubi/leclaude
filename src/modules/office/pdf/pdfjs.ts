"use client";
/**
 * Browser-side pdf.js loader. The library is imported lazily (it touches DOM
 * globals). The worker is served by /api/office/pdf/worker (reading the
 * pdfjs-dist bundle at request time); set NEXT_PUBLIC_PDFJS_WORKER_URL to
 * serve it statically instead (see scripts/copy-worker.mjs).
 */
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import type { PdfRect } from "./model";
import type { TextRun } from "./text-search";

export type { PDFDocumentProxy, PDFPageProxy, PageViewport };
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let libPromise: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  if (!libPromise) {
    // The legacy build carries the polyfills (e.g. Map.prototype.getOrInsertComputed) that the modern bundle assumes.
    libPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
      if (!lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = process.env.NEXT_PUBLIC_PDFJS_WORKER_URL || "/api/office/pdf/worker";
      }
      return lib;
    });
  }
  return libPromise;
}

export async function openPdf(source: string | Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await loadPdfjs();
  const task = typeof source === "string" ? lib.getDocument({ url: source, withCredentials: true }) : lib.getDocument({ data: new Uint8Array(source) });
  return task.promise;
}

/** Positioned text runs of a page in PDF user space (same shape as the server extraction). */
export async function pageRuns(page: PDFPageProxy): Promise<TextRun[]> {
  const tc = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    const t = it.transform as number[];
    const fontH = Math.hypot(t[2], t[3]) || it.height || 10;
    runs.push({ s: it.str, x: t[4], y: t[5], w: it.width, h: fontH, eol: it.hasEOL });
  }
  return runs;
}

/** PDF user-space rect → CSS rect inside the page element for the given viewport. */
export function rectToViewport(vp: PageViewport, r: PdfRect): { left: number; top: number; width: number; height: number } {
  const [x1, y1] = vp.convertToViewportPoint(r.x, r.y) as [number, number];
  const [x2, y2] = vp.convertToViewportPoint(r.x + r.w, r.y + r.h) as [number, number];
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** CSS point inside the page element → PDF user space. */
export function pointToPdf(vp: PageViewport, x: number, y: number): { x: number; y: number } {
  const [px, py] = vp.convertToPdfPoint(x, y) as [number, number];
  return { x: px, y: py };
}

/** CSS rect → PDF user-space rect (normalized). */
export function cssRectToPdf(vp: PageViewport, left: number, top: number, width: number, height: number): PdfRect {
  const a = pointToPdf(vp, left, top), b = pointToPdf(vp, left + width, top + height);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Render a page to a PNG data URL (used for thumbnails and for rasterizing redacted pages). */
export async function renderPageToDataUrl(page: PDFPageProxy, opts: { scale?: number; width?: number; rotation?: number; paint?: (ctx: CanvasRenderingContext2D, vp: PageViewport) => void; type?: "image/png" | "image/jpeg"; quality?: number } = {}): Promise<{ dataUrl: string; width: number; height: number }> {
  const base = page.getViewport({ scale: 1, rotation: opts.rotation ?? page.rotate });
  const scale = opts.scale ?? (opts.width ? opts.width / base.width : 1);
  const vp = page.getViewport({ scale, rotation: opts.rotation ?? page.rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  opts.paint?.(ctx, vp);
  return { dataUrl: canvas.toDataURL(opts.type ?? "image/png", opts.quality), width: canvas.width, height: canvas.height };
}
