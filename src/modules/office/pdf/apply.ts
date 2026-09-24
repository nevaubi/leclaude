/**
 * Apply a PdfModel to its source bytes with pdf-lib: form fill/flatten, page
 * rasterization (true redaction), annotation drawing or native annotation
 * objects, page reorder/delete/rotate/blank insertion, Bates numbering,
 * headers/footers/page numbers/watermarks and bookmarks.
 */
import { BlendMode, LineCapStyle, PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { activePages, formatBates, hexToRgb, type PdfAnnotation, type PdfModel, type PdfRect } from "./model";
import { addInkAnnotation, addLinkAnnotation, addMarkupAnnotation, addShapeAnnotation, addTextAnnotation, clearAnnotations, colorOf, drawAnchoredText, drawWatermark, finalRotation, sanitizeWinAnsi, setOutline, wrapLine, type TextAnchor } from "./pdf-lib-utils";

export interface ApplyOptions {
  /** Burn annotations into page content (default true). When false, markups/notes/shapes/ink/links become native PDF annotations. */
  flattenAnnotations?: boolean;
  /** Draw redaction boxes (default true). */
  applyRedactions?: boolean;
  /** PNG renderings (by SOURCE page number) of redacted pages; the page content is replaced by the image so text underneath is really removed. */
  rasterizedPages?: Record<number, Uint8Array>;
  /** Stamp Bates numbers from model.bates (default: true when configured and not already applied). */
  bates?: boolean;
  /** Fill AcroForm fields from model.formValues (default true). */
  fillForms?: boolean;
  /** Flatten form fields into static content. */
  flattenForms?: boolean;
  /** Headers/footers/page numbers/watermark (default true). */
  decorations?: boolean;
  /** Write model.bookmarks as the outline (default true when present). */
  bookmarks?: boolean;
  /** Skip annotations flagged `resolved`. */
  skipResolved?: boolean;
  title?: string;
}

interface Fonts { sans: PDFFont; sansBold: PDFFont; serif: PDFFont; mono: PDFFont }

const NOTE_SIZE = 20;

/** Inverse of toUserSpace for rasterized pages: user-space rect → displayed-space rect. */
function rectToDisplayed(r: PdfRect, w: number, h: number, rot: number): PdfRect {
  const map = (x: number, y: number): [number, number] => {
    switch (rot) {
      case 90: return [y, w - x];
      case 180: return [w - x, h - y];
      case 270: return [h - y, x];
      default: return [x, y];
    }
  };
  const [ax, ay] = map(r.x, r.y), [bx, by] = map(r.x + r.w, r.y + r.h);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

export async function applyModel(source: Uint8Array, model: PdfModel, opts: ApplyOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { ignoreEncryption: true });
  const fonts: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica), sansBold: await doc.embedFont(StandardFonts.HelveticaBold), serif: await doc.embedFont(StandardFonts.TimesRoman), mono: await doc.embedFont(StandardFonts.Courier),
  };
  const flatten = opts.flattenAnnotations !== false;

  // 1. Forms
  if (opts.fillForms !== false && model.formValues && Object.keys(model.formValues).length) fillForm(doc, model.formValues);
  if (opts.flattenForms) { try { doc.getForm().flatten(); } catch { /* no form */ } }
  else if (opts.fillForms !== false && model.formValues && Object.keys(model.formValues).length) { try { doc.getForm().updateFieldAppearances(fonts.sans); } catch { /* ignore */ } }

  // 2. Rasterized (redacted) pages replace the original content.
  const rasterized = new Map<number, { rot: number; w: number; h: number }>();
  if (opts.rasterizedPages && opts.applyRedactions !== false) {
    for (const [k, png] of Object.entries(opts.rasterizedPages)) {
      const sourceNo = Number(k);
      const idx = sourceNo - 1;
      const pages = doc.getPages();
      if (!pages[idx] || !png?.length) continue;
      const old = pages[idx];
      const mp = model.pages.find((p) => p.index === sourceNo);
      const rot = finalRotation(old, mp?.rotation ?? 0);
      const w = old.getWidth(), h = old.getHeight();
      const disp = rot === 90 || rot === 270 ? [h, w] : [w, h];
      const img = await doc.embedPng(png);
      const fresh = doc.insertPage(idx, [disp[0], disp[1]]);
      fresh.drawImage(img, { x: 0, y: 0, width: disp[0], height: disp[1] });
      doc.removePage(idx + 1);
      rasterized.set(sourceNo, { rot, w, h });
    }
  }

  // 3. Annotations on source pages
  const annotations = model.annotations.filter((a) => !(opts.skipResolved && a.resolved));
  const srcPages = doc.getPages();
  for (const a of annotations) {
    const page = srcPages[a.page - 1];
    if (!page) continue;
    const ras = rasterized.get(a.page);
    if (ras && a.type === "redaction") continue; // already burned into the raster
    const ann = ras ? { ...a, rects: a.rects.map((r) => rectToDisplayed(r, ras.w, ras.h, ras.rot)), paths: a.paths?.map((p) => p.map((pt) => { const r = rectToDisplayed({ x: pt.x, y: pt.y, w: 0, h: 0 }, ras.w, ras.h, ras.rot); return { x: r.x, y: r.y }; })) } : a;
    if (ann.type === "redaction" && opts.applyRedactions === false) continue;
    await drawAnnotation(doc, page, ann, fonts, flatten);
  }

  // 4. Page order / blank pages / deletions
  const ordered = activePages(model);
  const outputPages: { page: PDFPage; model: (typeof ordered)[number] }[] = [];
  for (const mp of ordered) {
    if (mp.blank) { outputPages.push({ page: doc.addPage([mp.width, mp.height]), model: mp }); continue; }
    const p = srcPages[mp.index - 1];
    if (p) outputPages.push({ page: p, model: mp });
  }
  const changedOrder = outputPages.length !== srcPages.length || outputPages.some((o, i) => o.page !== srcPages[i]);
  if (changedOrder) {
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    for (const o of outputPages) doc.addPage(o.page);
  }

  // 5. Rotation
  for (const o of outputPages) {
    if (rasterized.has(o.model.index)) continue;
    if (o.model.rotation) o.page.setRotation(degrees(finalRotation(o.page, o.model.rotation)));
  }

  // 6. Bates + decorations
  const doBates = opts.bates ?? Boolean(model.bates && !model.bates.applied);
  if (doBates && model.bates) {
    const b = model.bates;
    outputPages.forEach((o, i) => {
      drawAnchoredText(o.page, { text: formatBates(b, i), font: fonts.sans, size: b.fontSize ?? 9, anchor: b.position, margin: 20, background: true });
      if (b.legend) drawAnchoredText(o.page, { text: b.legend, font: fonts.sans, size: Math.max(6.5, (b.fontSize ?? 9) - 1.5), anchor: oppositeCorner(b.position), margin: 20, color: rgb(0.25, 0.25, 0.25), background: true });
    });
  }
  if (opts.decorations !== false && model.decorations) {
    const d = model.decorations;
    const total = outputPages.length;
    outputPages.forEach((o, i) => {
      const sub = (t: string) => t.replace(/\{page\}|\{n\}/g, String(i + (d.pageNumbers?.startAt ?? 1))).replace(/\{pages\}|\{total\}/g, String(total)).replace(/\{date\}/g, new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));
      if (d.header?.text) drawAnchoredText(o.page, { text: sub(d.header.text), font: fonts.sans, size: d.header.fontSize ?? 9, anchor: d.header.position ?? "top-center", margin: 22, color: rgb(0.25, 0.25, 0.25) });
      if (d.footer?.text) drawAnchoredText(o.page, { text: sub(d.footer.text), font: fonts.sans, size: d.footer.fontSize ?? 9, anchor: d.footer.position ?? "bottom-center", margin: 22, color: rgb(0.25, 0.25, 0.25) });
      if (d.pageNumbers) drawAnchoredText(o.page, { text: sub(d.pageNumbers.format || "Page {page} of {pages}"), font: fonts.sans, size: d.pageNumbers.fontSize ?? 9, anchor: d.pageNumbers.position, margin: 22, color: rgb(0.2, 0.2, 0.2) });
      if (d.watermark?.text) drawWatermark(o.page, { text: d.watermark.text, font: fonts.sansBold, size: d.watermark.fontSize, angle: d.watermark.angle, opacity: d.watermark.opacity, color: d.watermark.color ? colorOf(d.watermark.color) : undefined });
    });
  }

  // 7. Bookmarks
  if (opts.bookmarks !== false && model.bookmarks?.length) {
    const items = model.bookmarks
      .map((b) => ({ title: b.title, page: outputPages.findIndex((o) => o.model.index === b.page) + 1, level: b.level ?? 1 }))
      .filter((b) => b.page > 0);
    // nest level-2 items under the previous level-1 item
    const nested: { title: string; page: number; children?: { title: string; page: number }[] }[] = [];
    for (const it of items) {
      if (it.level >= 2 && nested.length) { const parent = nested[nested.length - 1]; (parent.children ??= []).push({ title: it.title, page: it.page }); }
      else nested.push({ title: it.title, page: it.page });
    }
    if (nested.length) setOutline(doc, nested);
  }

  if (opts.title ?? model.meta.title) doc.setTitle(String(opts.title ?? model.meta.title));
  doc.setProducer("LeClaude PDF (pdf-lib)");
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: true });
}

function oppositeCorner(p: TextAnchor): TextAnchor {
  switch (p) {
    case "bottom-right": return "bottom-left";
    case "bottom-left": return "bottom-right";
    case "top-right": return "top-left";
    case "top-left": return "top-right";
    case "bottom-center": return "top-center";
    case "top-center": return "bottom-center";
    default: return "bottom-left";
  }
}

export function fillForm(doc: PDFDocument, values: Record<string, string | boolean>) {
  let form: ReturnType<PDFDocument["getForm"]>;
  try { form = doc.getForm(); } catch { return; }
  for (const [name, value] of Object.entries(values)) {
    let field: ReturnType<typeof form.getField> | null = null;
    try { field = form.getField(name); } catch { field = null; }
    if (!field) continue;
    const ctor = field.constructor.name;
    try {
      if (ctor === "PDFTextField") (field as import("pdf-lib").PDFTextField).setText(sanitizeWinAnsi(String(value ?? "")));
      else if (ctor === "PDFCheckBox") { const cb = field as import("pdf-lib").PDFCheckBox; if (value === true || value === "true" || value === "Yes" || value === "on") cb.check(); else cb.uncheck(); }
      else if (ctor === "PDFRadioGroup") { const r = field as import("pdf-lib").PDFRadioGroup; if (typeof value === "string" && r.getOptions().includes(value)) r.select(value); }
      else if (ctor === "PDFDropdown") { const d = field as import("pdf-lib").PDFDropdown; if (typeof value === "string") { if (!d.getOptions().includes(value)) d.addOptions([value]); d.select(value); } }
      else if (ctor === "PDFOptionList") { const d = field as import("pdf-lib").PDFOptionList; if (typeof value === "string" && d.getOptions().includes(value)) d.select(value); }
    } catch { /* skip invalid value */ }
  }
}

async function drawAnnotation(doc: PDFDocument, page: PDFPage, a: PdfAnnotation, fonts: Fonts, flatten: boolean) {
  const color = colorOf(a.color);
  const opacity = a.opacity ?? 1;
  const rects = a.rects ?? [];
  switch (a.type) {
    case "highlight":
      if (flatten) for (const r of rects) page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color, opacity: Math.min(0.55, opacity || 0.4), blendMode: BlendMode.Multiply });
      else addMarkupAnnotation(doc, page, "Highlight", rects, { author: a.author, contents: a.text, color: a.color, opacity, date: a.createdAt });
      return;
    case "underline":
      if (flatten) for (const r of rects) page.drawLine({ start: { x: r.x, y: r.y + 1 }, end: { x: r.x + r.w, y: r.y + 1 }, thickness: 1.2, color, opacity });
      else addMarkupAnnotation(doc, page, "Underline", rects, { author: a.author, contents: a.text, color: a.color, opacity, date: a.createdAt });
      return;
    case "strikeout":
      if (flatten) for (const r of rects) page.drawLine({ start: { x: r.x, y: r.y + r.h * 0.45 }, end: { x: r.x + r.w, y: r.y + r.h * 0.45 }, thickness: 1.2, color, opacity });
      else addMarkupAnnotation(doc, page, "StrikeOut", rects, { author: a.author, contents: a.text, color: a.color, opacity, date: a.createdAt });
      return;
    case "note": {
      const r = rects[0] ?? { x: 36, y: page.getHeight() - 56, w: NOTE_SIZE, h: NOTE_SIZE };
      // Sticky notes are comments: always keep a native /Text annotation so the body survives; draw the icon when flattening.
      addTextAnnotation(doc, page, { x: r.x, y: r.y }, { author: a.author, contents: a.text ?? "", color: a.color, date: a.createdAt });
      if (flatten) {
        page.drawRectangle({ x: r.x, y: r.y, width: NOTE_SIZE, height: NOTE_SIZE, color, opacity: 0.9, borderColor: rgb(0.3, 0.25, 0), borderWidth: 0.8 });
        page.drawText("…", { x: r.x + 4.5, y: r.y + 7, size: 12, font: fonts.sansBold, color: rgb(0.2, 0.15, 0) });
      }
      return;
    }
    case "text": {
      const r = rects[0];
      if (!r) return;
      const size = a.fontSize ?? 11;
      const lines = (a.text ?? "").split("\n").flatMap((l) => wrapLine(fonts.sans, size, l, Math.max(10, r.w - 6)));
      let y = r.y + r.h - size - 3;
      for (const line of lines) { if (y < r.y - size * 0.2) break; page.drawText(line, { x: r.x + 3, y, size, font: fonts.sans, color, opacity }); y -= size * 1.25; }
      return;
    }
    case "rect":
      for (const r of rects) {
        if (flatten) page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: color, borderWidth: a.strokeWidth ?? 1.5, borderOpacity: opacity });
        else addShapeAnnotation(doc, page, "Square", r, { author: a.author, contents: a.text, color: a.color, opacity, strokeWidth: a.strokeWidth, date: a.createdAt });
      }
      return;
    case "ellipse":
      for (const r of rects) {
        if (flatten) page.drawEllipse({ x: r.x + r.w / 2, y: r.y + r.h / 2, xScale: r.w / 2, yScale: r.h / 2, borderColor: color, borderWidth: a.strokeWidth ?? 1.5, borderOpacity: opacity });
        else addShapeAnnotation(doc, page, "Circle", r, { author: a.author, contents: a.text, color: a.color, opacity, strokeWidth: a.strokeWidth, date: a.createdAt });
      }
      return;
    case "freehand": {
      const paths = a.paths ?? [];
      if (!flatten && rects[0]) { addInkAnnotation(doc, page, rects[0], paths, { author: a.author, contents: a.text, color: a.color, opacity, strokeWidth: a.strokeWidth, date: a.createdAt }); return; }
      for (const p of paths) for (let i = 1; i < p.length; i++) page.drawLine({ start: p[i - 1], end: p[i], thickness: a.strokeWidth ?? 1.8, color, opacity, lineCap: LineCapStyle.Round });
      return;
    }
    case "stamp": {
      const r = rects[0];
      if (!r) return;
      const text = sanitizeWinAnsi((a.text ?? "STAMP").toUpperCase());
      let size = Math.min(r.h * 0.6, 28);
      while (size > 6 && fonts.sansBold.widthOfTextAtSize(text, size) > r.w - 14) size -= 1;
      const tw = fonts.sansBold.widthOfTextAtSize(text, size);
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: color, borderWidth: 2, borderOpacity: opacity, color: rgb(1, 1, 1), opacity: 0.001 });
      page.drawText(text, { x: r.x + (r.w - tw) / 2, y: r.y + (r.h - size * 0.72) / 2, size, font: fonts.sansBold, color, opacity });
      return;
    }
    case "redaction": {
      const { r: cr, g: cg, b: cb } = hexToRgb(a.color || "#111111");
      for (const r of rects) {
        page.drawRectangle({ x: r.x - 0.5, y: r.y - 0.5, width: r.w + 1, height: r.h + 1, color: rgb(cr, cg, cb) });
        if (a.reason) {
          const size = 6.5;
          const label = sanitizeWinAnsi(a.reason);
          if (fonts.sans.widthOfTextAtSize(label, size) < r.w - 4 && r.h > size + 2) page.drawText(label, { x: r.x + 2, y: r.y + (r.h - size) / 2 + 1, size, font: fonts.sans, color: rgb(1, 1, 1) });
        }
      }
      return;
    }
    case "link": {
      const r = rects[0];
      if (!r || !a.href) return;
      addLinkAnnotation(doc, page, r, a.href, { color: a.color, border: false });
      if (flatten) page.drawLine({ start: { x: r.x, y: r.y + 1 }, end: { x: r.x + r.w, y: r.y + 1 }, thickness: 0.8, color, opacity: 0.8 });
      return;
    }
    case "signature": {
      const r = rects[0];
      if (!r || !a.imageDataUrl) return;
      const bytes = dataUrlBytes(a.imageDataUrl);
      if (!bytes) return;
      const img = a.imageDataUrl.startsWith("data:image/jpeg") ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      const scale = Math.min(r.w / img.width, r.h / img.height);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, width: w, height: h, opacity });
      return;
    }
  }
}

export function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const i = dataUrl.indexOf(",");
  if (i < 0) return null;
  try { return Uint8Array.from(Buffer.from(dataUrl.slice(i + 1), dataUrl.slice(0, i).includes(";base64") ? "base64" : "utf8")); } catch { return null; }
}

/** Append every page of `others` to `base`. Returns bytes and the sizes of the appended pages. */
export async function mergePdfs(base: Uint8Array, others: Uint8Array[]): Promise<{ bytes: Uint8Array; added: { width: number; height: number; rotation: number }[] }> {
  const doc = await PDFDocument.load(base, { ignoreEncryption: true });
  const added: { width: number; height: number; rotation: number }[] = [];
  for (const o of others) {
    const src = await PDFDocument.load(o, { ignoreEncryption: true });
    const pages = await doc.copyPages(src, src.getPageIndices());
    for (const p of pages) { doc.addPage(p); added.push({ width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle }); }
  }
  return { bytes: await doc.save({ useObjectStreams: true }), added };
}

/** New document from a list of 1-based source page numbers (in the given order). */
export async function extractPages(source: Uint8Array, sourcePageNumbers: number[], title?: string): Promise<Uint8Array> {
  const src = await PDFDocument.load(source, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = sourcePageNumbers.map((n) => n - 1).filter((i) => i >= 0 && i < src.getPageCount());
  const pages = await out.copyPages(src, idx);
  for (const p of pages) out.addPage(p);
  if (title) out.setTitle(title);
  out.setProducer("LeClaude PDF (pdf-lib)");
  return out.save({ useObjectStreams: true });
}

/** Re-save with object streams; strips XMP metadata and unused objects. */
export async function compressPdf(source: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, doc.getPageIndices());
  for (const p of pages) out.addPage(p);
  try { const t = doc.getTitle(); if (t) out.setTitle(t); } catch { /* ignore */ }
  out.setProducer("LeClaude PDF (pdf-lib, compressed)");
  return out.save({ useObjectStreams: true, addDefaultPage: false });
}

/** Fill (and optionally flatten) form fields; returns new bytes. */
export async function fillFormFields(source: Uint8Array, values: Record<string, string | boolean>, flatten = false): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { ignoreEncryption: true });
  fillForm(doc, values);
  try { if (flatten) doc.getForm().flatten(); else doc.getForm().updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica)); } catch { /* no form */ }
  return doc.save({ useObjectStreams: true });
}

/** Strip every annotation object from all pages (used after flattening). */
export async function stripAnnotations(source: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { ignoreEncryption: true });
  for (const p of doc.getPages()) clearAnnotations(p);
  return doc.save({ useObjectStreams: true });
}
