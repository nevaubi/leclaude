/**
 * True redaction over pdf-lib documents: content-stream glyph removal per page
 * (see content-stream.ts), removal of annotations and form fields under the
 * regions, scrubbing of the redacted strings from document metadata, outline
 * titles and annotation contents, and a page-level report. Pages that cannot
 * be edited safely are returned as `needsRaster` so the caller rasterizes them
 * (the content is then replaced by an image with the boxes painted in).
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, decodePDFRawStream, PDFRawStream, type PDFPage } from "pdf-lib";
import { intersects, pdfText, redactPageContent } from "./content-stream";
import type { PdfAnnotation, PdfModel, PdfRect } from "./model";

export interface RedactionRegion { rects: PdfRect[]; color: string; reasons: string[]; quotes: string[]; annotationIds: string[] }

export interface RedactionPageReport {
  /** 1-based source page number. */
  page: number;
  method: "content-stream" | "rasterized" | "none";
  removedGlyphs: number;
  removedAnnotations: number;
  removedFields: string[];
  /** Why content-stream editing was not safe (method = rasterized). */
  reason?: string;
}

export interface RedactionReport {
  pages: RedactionPageReport[];
  /** Strings that were under the boxes (from the pre-redaction text layer), for scrubbing and verification. */
  strings: string[];
  scrubbed: { metadataKeys: string[]; xmpRemoved: boolean; outlineTitles: number; annotationContents: number };
  /** Filled by the service after re-extraction. */
  verification?: RedactionVerification;
}

export interface RedactionVerification {
  status: "verified" | "failed";
  checkedAt: string;
  /** Per output page: strings that should be gone and were still found. */
  leaks: { page: number; text: string }[];
  /** Characters still extracted inside a redaction box (excluding the reason label). */
  glyphsInsideBoxes: number;
}

/** Unapplied redaction regions per source page. */
export function redactionRegions(model: PdfModel, include?: (a: PdfAnnotation) => boolean): Map<number, RedactionRegion> {
  const out = new Map<number, RedactionRegion>();
  for (const a of model.annotations) {
    if (a.type !== "redaction" || a.applied || !a.rects.length) continue;
    if (include && !include(a)) continue;
    const cur = out.get(a.page) ?? { rects: [], color: a.color || "#111111", reasons: [], quotes: [], annotationIds: [] };
    cur.rects.push(...a.rects);
    if (a.reason) cur.reasons.push(a.reason);
    if (a.quote) cur.quotes.push(a.quote);
    cur.annotationIds.push(a.id);
    out.set(a.page, cur);
  }
  return out;
}

function annotRect(dict: PDFDict): PdfRect | null {
  const r = dict.lookup(PDFName.of("Rect"));
  if (!(r instanceof PDFArray) || r.size() < 4) return null;
  const v = r.asArray().map((x) => Number((x as { asNumber?: () => number }).asNumber?.() ?? NaN));
  if (v.some((x) => !Number.isFinite(x))) return null;
  return { x: Math.min(v[0], v[2]), y: Math.min(v[1], v[3]), w: Math.abs(v[2] - v[0]), h: Math.abs(v[3] - v[1]) };
}

/** Remove non-widget annotations (and their popups) that overlap a region; returns how many were removed. */
export function removeAnnotationsUnder(doc: PDFDocument, page: PDFPage, regions: PdfRect[]): number {
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return 0;
  const entries = annots.asArray().map((raw) => ({ raw, dict: raw instanceof PDFRef ? doc.context.lookup(raw) : raw, drop: false }));
  const popups = new Set<string>();
  for (const e of entries) {
    if (!(e.dict instanceof PDFDict)) continue;
    const sub = e.dict.lookup(PDFName.of("Subtype"));
    const subtype = sub instanceof PDFName ? sub.decodeText() : "";
    if (subtype === "Widget" || subtype === "Popup") continue;
    const r = annotRect(e.dict);
    if (r && regions.some((g) => intersects(r, g))) {
      e.drop = true;
      const popup = e.dict.get(PDFName.of("Popup"));
      if (popup instanceof PDFRef) popups.add(popup.toString());
    }
  }
  for (const e of entries) if (e.raw instanceof PDFRef && popups.has(e.raw.toString())) e.drop = true;
  const removed = entries.filter((e) => e.drop).length;
  if (removed) page.node.set(PDFName.of("Annots"), doc.context.obj(entries.filter((e) => !e.drop).map((e) => e.raw)));
  return removed;
}

/** Remove AcroForm fields that have a widget overlapping a region on the given page (their values are content too). */
export function removeFieldsUnder(doc: PDFDocument, pageIndex: number, regions: PdfRect[]): string[] {
  let form: ReturnType<PDFDocument["getForm"]>;
  try {
    if (!doc.catalog.has(PDFName.of("AcroForm"))) return [];
    form = doc.getForm();
  } catch { return []; }
  const page = doc.getPages()[pageIndex];
  const removed: string[] = [];
  for (const f of form.getFields()) {
    let hit = false;
    for (const w of f.acroField.getWidgets()) {
      const pRef = w.P();
      const onPage = pRef ? pRef === page.ref : (page.node.Annots()?.asArray() ?? []).some((a) => a === doc.context.getObjectRef(w.dict));
      if (!onPage) continue;
      const r = w.getRectangle();
      if (regions.some((g) => intersects({ x: r.x, y: r.y, w: r.width, h: r.height }, g))) { hit = true; break; }
    }
    if (hit) { const name = f.getName(); try { form.removeField(f); removed.push(name); } catch { /* keep going */ } }
  }
  return removed;
}

function containsAny(text: string, strings: string[]) {
  const norm = text.replace(/\s+/g, " ").toLowerCase();
  return strings.some((s) => s.length >= 3 && norm.includes(s.toLowerCase()));
}

function scrubText(text: string, strings: string[]): string {
  let out = text;
  for (const s of strings) {
    if (s.length < 3) continue;
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    out = out.replace(new RegExp(esc, "gi"), "[REDACTED]");
  }
  return out;
}

/**
 * Remove the redacted strings from places other than page content: Info
 * dictionary fields, XMP metadata (removed entirely when it contains one),
 * outline titles and annotation Contents / T fields.
 */
export function scrubDocument(doc: PDFDocument, strings: string[]): RedactionReport["scrubbed"] {
  const out: RedactionReport["scrubbed"] = { metadataKeys: [], xmpRemoved: false, outlineTitles: 0, annotationContents: 0 };
  const list = Array.from(new Set(strings.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 3)));
  if (!list.length) return out;
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const key of ["Title", "Author", "Subject", "Keywords", "Creator"]) {
      const v = pdfText(info.lookup(PDFName.of(key)));
      if (v && containsAny(v, list)) { info.set(PDFName.of(key), PDFHexString.fromText(scrubText(v, list))); out.metadataKeys.push(key); }
    }
  }
  const md = doc.catalog.lookup(PDFName.of("Metadata"));
  if (md instanceof PDFStream) {
    let xml = "";
    try { xml = new TextDecoder("utf-8").decode(md instanceof PDFRawStream ? decodePDFRawStream(md).decode() : new Uint8Array()); } catch { xml = ""; }
    if (!xml || containsAny(xml, list)) { doc.catalog.delete(PDFName.of("Metadata")); out.xmpRemoved = true; }
  }
  // Outline titles
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"));
  const walk = (item: PDFDict | undefined, depth: number) => {
    let cur = item;
    let guard = 0;
    while (cur instanceof PDFDict && guard++ < 5000) {
      const title = pdfText(cur.lookup(PDFName.of("Title")));
      if (title && containsAny(title, list)) { cur.set(PDFName.of("Title"), PDFHexString.fromText(scrubText(title, list))); out.outlineTitles++; }
      if (depth < 8) walk(cur.lookup(PDFName.of("First")) as PDFDict | undefined, depth + 1);
      cur = cur.lookup(PDFName.of("Next")) as PDFDict | undefined;
    }
  };
  if (outlines instanceof PDFDict) walk(outlines.lookup(PDFName.of("First")) as PDFDict | undefined, 0);
  // Annotation contents on every page
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (const x of annots.asArray()) {
      const d = x instanceof PDFRef ? doc.context.lookup(x) : x;
      if (!(d instanceof PDFDict)) continue;
      for (const key of ["Contents", "T", "Subj", "RC"]) {
        const v = pdfText(d.lookup(PDFName.of(key)));
        if (v && containsAny(v, list)) { d.set(PDFName.of(key), PDFHexString.fromText(scrubText(v, list))); out.annotationContents++; }
      }
    }
  }
  return out;
}

export { scrubText };

/**
 * Redact the given source pages of a loaded document in place. Pages whose
 * content cannot be edited safely are listed in `needsRaster` (nothing is
 * changed on them here). Annotations and form fields under the regions are
 * removed on every redacted page regardless of the method.
 */
export function redactDocument(doc: PDFDocument, regions: Map<number, RedactionRegion>, opts: { forceRaster?: Set<number> } = {}): { pages: RedactionPageReport[]; needsRaster: number[] } {
  const pages = doc.getPages();
  const report: RedactionPageReport[] = [];
  const needsRaster: number[] = [];
  for (const [sourcePage, region] of regions) {
    const page = pages[sourcePage - 1];
    if (!page) continue;
    const removedFields = removeFieldsUnder(doc, sourcePage - 1, region.rects);
    const removedAnnotations = removeAnnotationsUnder(doc, page, region.rects);
    if (opts.forceRaster?.has(sourcePage)) { report.push({ page: sourcePage, method: "rasterized", removedGlyphs: 0, removedAnnotations, removedFields, reason: "rasterization requested" }); needsRaster.push(sourcePage); continue; }
    const r = redactPageContent(doc, page, region.rects);
    if (r.unsafe) { report.push({ page: sourcePage, method: "rasterized", removedGlyphs: 0, removedAnnotations, removedFields, reason: r.unsafe }); needsRaster.push(sourcePage); continue; }
    report.push({ page: sourcePage, method: r.changed ? "content-stream" : "none", removedGlyphs: r.removedGlyphs, removedAnnotations, removedFields });
  }
  return { pages: report.sort((a, b) => a.page - b.page), needsRaster: needsRaster.sort((a, b) => a - b) };
}
