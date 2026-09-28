import "server-only";
/**
 * Server-side PDF document service: loading models with their source bytes,
 * lazy materialization of template/seed documents, text extraction caching,
 * burn-in (bake the model into a new source), merge/split/compress, Word
 * conversion and export.
 */
import { nanoid } from "nanoid";
import { PDFDocument } from "pdf-lib";
import { blobs, db } from "@/lib/db";
import type { LibraryItem, OfficeDocument } from "@/lib/types/domain";
import { createOfficeDoc, getOfficeDoc, saveOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { LIBRARY_FOLDERS, matterFolderId } from "@/modules/library/ids";
import { applyModelWithReport, compressPdf, rectToDisplayed, extractPages, mergePdfs, stampBatesBytes, type ApplyOptions, type ApplyReport } from "./apply";
import { readNativeAnnotations } from "./annotations";
import { extractPdf, invalidateExtraction, readPageSizes, type Extraction } from "./extract";
import { generatePdf } from "./generate";
import { activePages, buildModel, formatBates, normalizeModel, parsePageRange, textOfModel, type BatesConfig, type PdfModel } from "./model";
import { makeRasterizer } from "./raster";
import { redactionRegions, type RedactionReport, type RedactionVerification } from "./redaction";
import { charsInsideRects, countOccurrences, searchRuns, textUnderRects } from "./text-search";
import { SPEC_BUILDERS } from "./template-specs";

export interface LoadedPdf { doc: OfficeDocument; model: PdfModel }

export function loadPdf(docId: string): LoadedPdf | null {
  const doc = getOfficeDoc(docId);
  if (!doc || doc.kind !== "pdf") return null;
  return { doc, model: normalizeModel(doc.content) };
}

/** Source bytes for a model (falls back to the import route's originalBlobId). */
export function sourceBytes(model: PdfModel): { id: string; bytes: Uint8Array } | null {
  const ids = [model.sourceBlobId, model.meta.originalBlobId as string | undefined].filter((x): x is string => Boolean(x));
  for (const id of ids) { const b = blobs.get(id); if (b) return { id, bytes: b.bytes }; }
  return null;
}

function savePdfModel(docId: string, model: PdfModel, version?: { label?: string; summary?: string; force?: boolean }) {
  return saveOfficeDoc(docId, { content: model, version });
}

/** Build a model from PDF bytes (stores the blob), extract its text and read its own annotations, labels and metadata. */
export async function modelFromBytes(bytes: Uint8Array, opts: { name?: string; title?: string; blobId?: string; meta?: PdfModel["meta"] } = {}): Promise<{ model: PdfModel; extraction: Extraction; blobId: string }> {
  const rec = blobs.put(bytes, "application/pdf", { id: opts.blobId, name: opts.name, meta: { kind: "pdf" } });
  const sizes = await readPageSizes(bytes);
  const extraction = await extractPdf(bytes, rec.id);
  let native: PdfModel["annotations"] = [];
  try { native = readNativeAnnotations(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })); } catch { native = []; }
  const needsOcr = extraction.pages.filter((p) => p.needsOcr).map((p) => p.page);
  const em = extraction.meta;
  const model = buildModel({
    sourceBlobId: rec.id,
    pageSizes: sizes,
    textIndex: extraction.pages.map((p) => (p.needsOcr ? { page: p.page, text: p.text, needsOcr: true } : { page: p.page, text: p.text })),
    meta: {
      ...(opts.meta ?? {}),
      title: opts.title ?? em.title ?? opts.name?.replace(/\.pdf$/i, ""),
      originalName: opts.name, sourceSize: bytes.byteLength, outline: extraction.outline, fields: extraction.fields, hasForm: extraction.fields.length > 0, producer: em.producer, extractedAt: extraction.extractedAt,
      docInfo: { title: em.title, author: em.author, subject: em.subject, keywords: em.keywords, creator: em.creator, producer: em.producer, created: em.created, modified: em.modified },
      pageLabels: extraction.pageLabels ?? undefined,
      nativeAnnotations: true,
      needsOcr: needsOcr.length ? needsOcr : undefined,
    },
  });
  model.annotations = native;
  return { model, extraction, blobId: rec.id };
}

/** Resolve annotations that carry a `quote` but no rects (seeded/agent) against the extraction. */
export function resolveQuotedAnnotations(model: PdfModel, extraction: Extraction): PdfModel {
  const annotations = model.annotations.map((a0) => {
    let a = a0;
    if (a.rects.length || !a.quote) return a;
    // Search the annotation's page first, then the rest of the document (seeded quotes may sit on a neighbouring page).
    const ordered = [...extraction.pages].sort((x, y) => (x.page === a.page ? -1 : y.page === a.page ? 1 : x.page - y.page));
    let page: (typeof ordered)[number] | undefined;
    let hit: ReturnType<typeof searchRuns>[number] | undefined;
    for (const p of ordered) { const hits = searchRuns(p.runs, a.quote, { limit: 1 }); if (hits.length) { page = p; hit = hits[0]; break; } }
    if (!page || !hit) return a;
    if (page.page !== a.page) a = { ...a, page: page.page };
    const r = hit.rects;
    if (a.type === "stamp") {
      // Stamps sit in the top-right corner of the page the quote is on (never over the quoted text).
      const text = (a.text ?? "STAMP").toUpperCase();
      const w = Math.min(page.width - 48, Math.max(120, text.length * 12 + 30)), h = 40;
      return { ...a, rects: [{ x: page.width - w - 24, y: page.height - h - 18, w, h }] };
    }
    if (a.type === "note" || a.type === "text") {
      const b = r[0];
      const w = a.type === "note" ? 20 : 200, h = a.type === "note" ? 20 : 60;
      return { ...a, rects: [{ x: Math.min(b.x + b.w + 6, page.width - w - 20), y: b.y + b.h - h + (a.type === "note" ? 0 : 10), w, h }] };
    }
    return { ...a, rects: r };
  });
  return { ...model, annotations };
}

/**
 * Generate the PDF for a pending template/seed document and populate the
 * model (pages, text index, resolved annotations). Idempotent.
 */
/** "New PDF → Blank": a document with no source gets one blank US Letter page, so it can be viewed, annotated and exported. */
async function materializeBlank(docId: string, doc: OfficeDocument, model: PdfModel): Promise<LoadedPdf | null> {
  const bytes = await generatePdf({ title: doc.title, blocks: [{ type: "spacer", height: 1 }], outline: false });
  const { model: fresh } = await modelFromBytes(bytes, { name: `${safeName(doc.title)}.pdf`, title: doc.title, meta: { blank: true } });
  const next: PdfModel = { ...fresh, annotations: model.annotations, meta: { ...fresh.meta, ...model.meta } };
  const saved = savePdfModel(docId, next, { summary: "Created blank PDF", force: false });
  return saved ? { doc: saved, model: next } : null;
}

export async function materialize(docId: string): Promise<LoadedPdf | null> {
  const loaded = loadPdf(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  if (!model.meta.pending && !model.sourceBlobId && model.pageCount === 0) return materializeBlank(docId, doc, model);
  if (!model.meta.pending) return loaded;
  const specId = String(model.meta.specId ?? "");
  const builder = SPEC_BUILDERS[specId];
  if (!builder) throw new Error(`Unknown PDF spec "${specId}"`);
  const matter = doc.matterId ? db().matters.get(doc.matterId) : undefined;
  const spec = builder({ matterId: doc.matterId, title: doc.title, demo: model.meta.seeded === true, matter: matter ? { name: matter.name, caption: matter.caption, court: matter.court, judge: matter.judge, client: matter.client } : undefined });
  const bytes = await generatePdf(spec);
  const blobId = typeof model.meta.blobId === "string" && model.meta.blobId ? model.meta.blobId : `blob_pdf_${nanoid(10)}`;
  const { model: fresh, extraction } = await modelFromBytes(bytes, { name: `${safeName(doc.title)}.pdf`, title: doc.title, blobId, meta: { templateId: model.meta.templateId, specId } });
  const merged: PdfModel = { ...fresh, annotations: model.annotations, bates: model.bates, decorations: model.decorations, bookmarks: model.bookmarks, formValues: model.formValues, meta: { ...fresh.meta, ...stripPending(model.meta), pending: undefined } };
  const resolved = resolveQuotedAnnotations(merged, extraction);
  const saved = savePdfModel(docId, resolved, { summary: "Generated PDF from template", force: false });
  if (!saved) return null;
  return { doc: saved, model: resolved };
}

function stripPending(meta: PdfModel["meta"]): PdfModel["meta"] {
  const { pending: _p, ...rest } = meta; void _p;
  return rest;
}

/** Ensure the text index / outline / fields are cached on the model. Returns the extraction too. */
export async function ensureExtracted(docId: string, force = false): Promise<{ loaded: LoadedPdf; extraction: Extraction } | null> {
  const loaded = await materialize(docId);
  if (!loaded) return null;
  const src = sourceBytes(loaded.model);
  if (!src) throw new Error("Source PDF bytes are missing for this document");
  if (force) invalidateExtraction(src.id);
  const extraction = await extractPdf(src.bytes, src.id);
  const model = loaded.model;
  const stale = force || !model.textIndex?.length;
  const needsFields = !model.meta.fields && extraction.fields.length > 0;
  if (stale || needsFields || !model.meta.outline) {
    const next: PdfModel = resolveQuotedAnnotations({ ...model, sourceBlobId: src.id, textIndex: extraction.pages.map((p) => ({ page: p.page, text: p.text })), meta: { ...model.meta, outline: extraction.outline, fields: extraction.fields, hasForm: extraction.fields.length > 0, producer: extraction.meta.producer ?? model.meta.producer, extractedAt: extraction.extractedAt } }, extraction);
    const saved = savePdfModel(docId, next);
    return { loaded: { doc: saved ?? loaded.doc, model: next }, extraction };
  }
  return { loaded, extraction };
}

/** Extraction for arbitrary bytes keyed by blob id (agent tools use this for find_text rects). */
export async function extractionForModel(model: PdfModel): Promise<Extraction | null> {
  const src = sourceBytes(model);
  if (!src) return null;
  return extractPdf(src.bytes, src.id);
}

export interface ExportRequest { docId?: string; content?: unknown; title?: string; options?: ApplyOptions & { rasterizedPages?: Record<number, string> } }

/** Exported bytes plus what was done (redaction methods per page, verification). */
export interface ExportResult { bytes: Uint8Array; title: string; report: ApplyReport }

function rasterFromDataUrls(input: Record<number, string> | undefined): Record<number, Uint8Array> {
  const raster: Record<number, Uint8Array> = {};
  for (const [k, v] of Object.entries(input ?? {})) { const b = dataUrlToBytes(v); if (b) raster[Number(k)] = b; }
  return raster;
}

/** Text under every pending redaction box, read from the source's text layer (scrubbed elsewhere and verified gone). */
function redactedStringsFor(model: PdfModel, extraction: Extraction | null): string[] {
  if (!extraction) return [];
  const out: string[] = [];
  for (const [page, region] of redactionRegions(model)) {
    const ex = extraction.pages.find((p) => p.page === page);
    if (ex) out.push(...textUnderRects(ex.runs, region.rects));
    out.push(...region.quotes);
  }
  return Array.from(new Set(out.map((x) => x.trim()).filter((x) => x.length >= 2)));
}

/**
 * Re-extract the output and prove the redaction: no characters remain inside
 * any box (except the drawn reason labels and production stamps), and no
 * redacted string occurs more often on its page than its uncovered
 * occurrences in the source.
 */
export async function verifyRedaction(out: Uint8Array, model: PdfModel, before: Extraction, report: ApplyReport): Promise<RedactionVerification> {
  const after = await extractPdf(out);
  const regions = redactionRegions(model);
  const leaks: { page: number; text: string }[] = [];
  let inside = 0;
  const reasons = new Set(model.annotations.filter((a) => a.type === "redaction" && a.reason).map((a) => a.reason!.trim()));
  const legend = model.bates?.legend?.trim();
  const allowed = (s: string) => !s || reasons.has(s) || (model.bates ? s.startsWith(model.bates.prefix) : false) || (legend ? s === legend : false);
  const rasterized = new Set(report.redaction?.pages.filter((p) => p.method === "rasterized").map((p) => p.page) ?? []);
  for (const [src, region] of regions) {
    const outPage = report.pageMap[src];
    if (!outPage) continue; // page deleted: nothing of it is in the output
    const a = after.pages[outPage - 1];
    const b = before.pages.find((p) => p.page === src);
    if (!a) continue;
    if (!b) continue;
    // A rasterized page is re-laid in display orientation: map the boxes the same way.
    const rot = (((b.rotation + (model.pages.find((p) => p.index === src)?.rotation ?? 0)) % 360) + 360) % 360;
    const boxes = rasterized.has(src) ? region.rects.map((r) => rectToDisplayed(r, b.width, b.height, rot)) : region.rects;
    inside += charsInsideRects(a.runs, boxes, allowed, 0.5).length;
    for (const s of textUnderRects(b.runs, region.rects)) {
      if (s.replace(/\s+/g, "").length < 4) continue;
      const total = countOccurrences(b.text, s);
      const covered = searchRuns(b.runs, s, { limit: 200 }).filter((h) => h.rects.length && h.rects.every((r) => region.rects.some((g) => r.x + r.w / 2 >= g.x - 1 && r.x + r.w / 2 <= g.x + g.w + 1 && r.y + r.h / 2 >= g.y - 1 && r.y + r.h / 2 <= g.y + g.h + 1))).length;
      const remaining = countOccurrences(a.text, s);
      if (remaining > Math.max(0, total - Math.max(1, covered))) leaks.push({ page: outPage, text: s });
    }
  }
  return { status: leaks.length || inside ? "failed" : "verified", checkedAt: new Date().toISOString(), leaks, glyphsInsideBoxes: inside };
}

async function applyVerified(model: PdfModel, src: { id: string; bytes: Uint8Array }, options: ApplyOptions): Promise<{ bytes: Uint8Array; report: ApplyReport }> {
  const hasRedactions = options.applyRedactions !== false && redactionRegions(model).size > 0;
  const before = hasRedactions ? await extractPdf(src.bytes, src.id) : null;
  const { bytes, report } = await applyModelWithReport(src.bytes, model, { ...options, rasterize: options.rasterize ?? makeRasterizer(src.bytes), redactedStrings: [...(options.redactedStrings ?? []), ...redactedStringsFor(model, before)] });
  if (hasRedactions && before && report.redaction) {
    report.redaction.verification = await verifyRedaction(bytes, model, before, report);
    if (report.redaction.verification.status !== "verified") {
      const v = report.redaction.verification;
      throw new Error(`Redaction verification failed: ${v.glyphsInsideBoxes} character(s) still inside redaction boxes${v.leaks.length ? `; still present: ${v.leaks.map((l) => `p. ${l.page}`).join(", ")}` : ""}. Nothing was exported.`);
    }
  }
  return { bytes, report };
}

/** Apply a model to its source and return the exported bytes (redactions are applied and verified). */
export async function exportPdf(req: ExportRequest): Promise<ExportResult> {
  let model: PdfModel | null = null;
  let title = req.title ?? "document";
  if (req.docId) {
    const loaded = await materialize(req.docId);
    if (!loaded) throw new Error("Document not found");
    model = req.content ? normalizeModel(req.content) : loaded.model;
    title = req.title ?? loaded.doc.title;
    if (!model.sourceBlobId) model.sourceBlobId = loaded.model.sourceBlobId;
  } else if (req.content) model = normalizeModel(req.content);
  if (!model) throw new Error("`docId` or `content` is required");
  const src = sourceBytes(model);
  if (!src) throw new Error("Source PDF bytes are missing");
  const { rasterizedPages, ...rest } = req.options ?? {};
  const raster = rasterFromDataUrls(rasterizedPages);
  const { bytes, report } = await applyVerified(model, src, { ...rest, rasterizedPages: Object.keys(raster).length ? raster : undefined, title });
  return { bytes, title, report };
}

export function dataUrlToBytes(v: string): Uint8Array | null {
  const i = v.indexOf(",");
  if (i < 0) return null;
  try { return Uint8Array.from(Buffer.from(v.slice(i + 1), "base64")); } catch { return null; }
}

export interface BurnOptions { applyRedactions?: boolean; flattenAnnotations?: boolean; flattenForms?: boolean; bates?: boolean; decorations?: boolean; rasterizedPages?: Record<number, string>; forceRasterize?: boolean; keepNotes?: boolean; label?: string }

/**
 * Bake the model into a new source PDF (redactions, annotations, Bates, form
 * values, page operations…). The document then starts fresh from the new
 * bytes: annotations written as native PDF annotations are read back from the
 * file (same ids), Bates is kept and flagged `applied` so it is not stamped
 * twice. Redactions are verified by re-extraction before anything is saved.
 */
export async function burnIn(docId: string, opts: BurnOptions = {}): Promise<(LoadedPdf & { report: ApplyReport }) | null> {
  const loaded = await materialize(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  const src = sourceBytes(model);
  if (!src) throw new Error("Source PDF bytes are missing");
  const raster = rasterFromDataUrls(opts.rasterizedPages);
  const flatten = opts.flattenAnnotations ?? true;
  const stampBates = opts.bates ?? Boolean(model.bates && !model.bates.applied);
  const { bytes, report } = await applyVerified(model, src, { flattenAnnotations: flatten, applyRedactions: opts.applyRedactions ?? true, flattenForms: opts.flattenForms ?? false, bates: stampBates, decorations: opts.decorations ?? true, rasterizedPages: Object.keys(raster).length ? raster : undefined, forceRasterize: opts.forceRasterize, title: doc.title });
  const { model: fresh, extraction } = await modelFromBytes(bytes, { name: `${safeName(doc.title)}.pdf`, title: doc.title, meta: { templateId: model.meta.templateId, specId: model.meta.specId, burnedFrom: src.id, burnedAt: new Date().toISOString() } });
  const redactionCount = model.annotations.filter((a) => a.type === "redaction" && !a.applied).length;
  const n = activePages(model).filter((p) => !p.blank).length;
  const bates: BatesConfig | undefined = model.bates ? (stampBates ? { ...model.bates, applied: true, first: formatBates(model.bates, 0), last: formatBates(model.bates, Math.max(0, (model.bates.pages?.length ?? n) - 1)) } : model.bates) : undefined;
  const next: PdfModel = {
    ...fresh,
    bates,
    decorations: opts.decorations === false ? model.decorations : undefined,
    meta: { ...fresh.meta, redactionsApplied: (Number(model.meta.redactionsApplied ?? 0) + (opts.applyRedactions === false ? 0 : redactionCount)) || undefined, rasterizedPages: report.redaction?.pages.filter((p) => p.method === "rasterized").length || undefined, lastRedaction: report.redaction ?? model.meta.lastRedaction },
  };
  const parts = [`${report.writtenAnnotations} annotation${report.writtenAnnotations === 1 ? "" : "s"}`];
  if (report.redaction) parts.push(`${report.redaction.pages.length} redacted page${report.redaction.pages.length === 1 ? "" : "s"} (${report.redaction.pages.map((p) => `p.${p.page} ${p.method}`).join(", ")}; verified)`);
  if (stampBates && model.bates && !model.bates.applied) parts.push("Bates numbers");
  const saved = savePdfModel(docId, resolveQuotedAnnotations(next, extraction), { label: opts.label ?? "Applied edits to source", summary: `Applied ${parts.join(", ")} to the PDF`, force: true });
  if (!saved) return null;
  for (const li of db().library.find((l) => l.officeDocId === docId)) db().library.update(li.id, { size: bytes.byteLength, updatedAt: saved.updatedAt });
  return { doc: saved, model: next, report };
}

/** Apply only the pending redactions (true removal + verification); other annotations stay editable as native annotations. */
export function applyRedactionsToSource(docId: string, opts: { forceRasterize?: boolean; rasterizedPages?: Record<number, string> } = {}) {
  return burnIn(docId, { applyRedactions: true, flattenAnnotations: false, bates: false, decorations: false, forceRasterize: opts.forceRasterize, rasterizedPages: opts.rasterizedPages, label: "Applied redactions" });
}

/** Append other PDFs to the document's source (their outlines nest under a bookmark per document; their annotations come along). */
export async function mergeInto(docId: string, others: { bytes: Uint8Array; name?: string }[]): Promise<LoadedPdf | null> {
  const loaded = await materialize(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  const src = sourceBytes(model);
  if (!src) throw new Error("Source PDF bytes are missing");
  const { bytes, added } = await mergePdfs(src.bytes, others.map((o) => o.bytes), others.map((o) => (o.name ?? "").replace(/\.pdf$/i, "")));
  const rec = blobs.put(bytes, "application/pdf", { name: `${safeName(doc.title)}.pdf`, meta: { kind: "pdf", mergedFrom: [src.id, ...others.map((o) => o.name ?? "upload")] } });
  const extraction = await extractPdf(bytes, rec.id);
  const base = model.pageCount;
  const newPages = added.map((p, i) => ({ id: `pg_${base + i + 1}`, index: base + i + 1, rotation: 0 as const, width: p.width, height: p.height, order: 0 }));
  const active = model.pages.filter((p) => !p.deleted).sort((a, b) => a.order - b.order);
  const deleted = model.pages.filter((p) => p.deleted);
  const pages = [...active, ...newPages, ...deleted].map((p, i) => ({ ...p, order: i }));
  let appendedNative: PdfModel["annotations"] = [];
  try { appendedNative = readNativeAnnotations(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).filter((a) => a.page > base); } catch { appendedNative = []; }
  const textIndex = extraction.pages.map((p) => (p.needsOcr ? { page: p.page, text: p.text, needsOcr: true } : { page: p.page, text: p.text }));
  const next: PdfModel = { ...model, sourceBlobId: rec.id, pageCount: base + added.length, pages, annotations: [...model.annotations, ...appendedNative], textIndex, meta: { ...model.meta, sourceSize: bytes.byteLength, outline: extraction.outline, fields: extraction.fields, hasForm: extraction.fields.length > 0, extractedAt: extraction.extractedAt, pageLabels: extraction.pageLabels ?? undefined, needsOcr: extraction.pages.filter((p) => p.needsOcr).map((p) => p.page), mergedCount: (Number(model.meta.mergedCount ?? 0) + others.length) } };
  const saved = savePdfModel(docId, next, { label: "Merged PDF", summary: `Appended ${added.length} page${added.length === 1 ? "" : "s"} from ${others.map((o) => o.name ?? "upload").join(", ")}`, force: true });
  if (!saved) return null;
  return { doc: saved, model: next };
}

/** Extract display pages into a new document (shares no bytes with the original); bookmarks and annotations on those pages come along. */
export async function splitToNewDocument(docId: string, displayPages: number[], title?: string): Promise<{ doc: OfficeDocument; url: string } | null> {
  const loaded = await materialize(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  const src = sourceBytes(model);
  if (!src) throw new Error("Source PDF bytes are missing");
  const active = activePages(model);
  const sourceNos = displayPages.map((d) => active[d - 1]).filter((p): p is NonNullable<typeof p> => Boolean(p) && !p.blank).map((p) => p.index);
  if (!sourceNos.length) throw new Error("No pages selected");
  const newTitle = title?.trim() || `${doc.title} — pages ${displayPages[0]}${displayPages.length > 1 ? `–${displayPages[displayPages.length - 1]}` : ""}`;
  const bytes = await extractPages(src.bytes, sourceNos, newTitle);
  const { model: fresh } = await modelFromBytes(bytes, { name: `${safeName(newTitle)}.pdf`, title: newTitle, meta: { splitFrom: docId } });
  // Native annotations come with the copied pages (read by modelFromBytes); editor annotations are renumbered to the new source pages.
  const map = new Map(sourceNos.map((s, i) => [s, i + 1]));
  fresh.annotations = [...fresh.annotations, ...model.annotations.filter((a) => !a.native && map.has(a.page)).map((a) => ({ ...a, page: map.get(a.page)! }))];
  fresh.bookmarks = (model.bookmarks ?? []).filter((b) => map.has(b.page)).map((b) => ({ ...b, page: map.get(b.page)! }));
  if (!fresh.bookmarks.length) fresh.bookmarks = undefined;
  const created = createOfficeDoc({ kind: "pdf", title: newTitle, content: fresh, matterId: doc.matterId, folderId: doc.folderId, meta: { originalName: `${safeName(newTitle)}.pdf` } });
  putLibraryItem(created, bytes.byteLength);
  return { doc: created, url: `/office/pdf/${created.id}` };
}

export interface BatesSetRequest {
  docIds: string[];
  prefix: string;
  start: number;
  digits?: number;
  position?: BatesConfig["position"];
  fontSize?: number;
  font?: BatesConfig["font"];
  /** Endorsement (e.g. CONFIDENTIAL). Only stamped when the user chose one. */
  legend?: string;
  legendPosition?: BatesConfig["position"];
  /** Optional display page range per document ("1-3, 7"); default every active page. */
  ranges?: Record<string, string>;
  /** Re-stamp documents that already carry applied Bates numbers. */
  force?: boolean;
}

export interface BatesSetResult { docId: string; title: string; status: "stamped" | "skipped"; first?: string; last?: string; pages: number; reason?: string }

/**
 * Bates-stamp a production set: one continuous sequence across the documents
 * in the given order, drawn onto each document's ORIGINAL bytes (nothing else
 * is flattened; pending annotations and page edits stay pending).
 */
export async function batesStampDocuments(req: BatesSetRequest): Promise<{ results: BatesSetResult[]; next: number }> {
  if (!req.prefix?.trim() && req.prefix !== "") throw new Error("prefix is required");
  if (!Number.isInteger(req.start) || req.start < 0) throw new Error("start must be a non-negative integer");
  let next = req.start;
  const results: BatesSetResult[] = [];
  for (const id of req.docIds) {
    const loaded = await materialize(id);
    if (!loaded) { results.push({ docId: id, title: id, status: "skipped", pages: 0, reason: "not found" }); continue; }
    const { doc, model } = loaded;
    if (model.bates?.applied && !req.force) { results.push({ docId: id, title: doc.title, status: "skipped", pages: 0, reason: `already stamped ${model.bates.first ?? model.bates.prefix}` }); continue; }
    const src = sourceBytes(model);
    if (!src) { results.push({ docId: id, title: doc.title, status: "skipped", pages: 0, reason: "source bytes missing" }); continue; }
    const active = activePages(model).filter((p) => !p.blank);
    const range = req.ranges?.[id];
    const displays = range ? parsePageRange(range, active.length) : active.map((_, i) => i + 1);
    const sourcePages = displays.map((d) => active[d - 1]?.index).filter((x): x is number => typeof x === "number");
    if (!sourcePages.length) { results.push({ docId: id, title: doc.title, status: "skipped", pages: 0, reason: "no pages in range" }); continue; }
    const cfg: BatesConfig = { prefix: req.prefix, start: next, digits: req.digits ?? 7, position: req.position ?? "bottom-right", fontSize: req.fontSize, font: req.font, legend: req.legend?.trim() || undefined, legendPosition: req.legendPosition };
    const { bytes, labels } = await stampBatesBytes(src.bytes, sourcePages, cfg);
    const rec = blobs.put(bytes, "application/pdf", { name: `${safeName(doc.title)}.pdf`, meta: { kind: "pdf", batesFrom: src.id } });
    const extraction = await extractPdf(bytes, rec.id);
    const first = labels[0].label, last = labels[labels.length - 1].label;
    const nextModel: PdfModel = { ...model, sourceBlobId: rec.id, textIndex: extraction.pages.map((p) => (p.needsOcr ? { page: p.page, text: p.text, needsOcr: true } : { page: p.page, text: p.text })), bates: { ...cfg, applied: true, first, last }, meta: { ...model.meta, sourceSize: bytes.byteLength, extractedAt: extraction.extractedAt } };
    const saved = savePdfModel(id, nextModel, { label: "Bates stamped", summary: `Bates ${first} – ${last}${cfg.legend ? `, endorsed “${cfg.legend}”` : ""}`, force: true });
    if (!saved) { results.push({ docId: id, title: doc.title, status: "skipped", pages: 0, reason: "save failed" }); continue; }
    for (const li of db().library.find((l) => l.officeDocId === id)) db().library.update(li.id, { size: bytes.byteLength, updatedAt: saved.updatedAt });
    results.push({ docId: id, title: doc.title, status: "stamped", first, last, pages: labels.length });
    next += labels.length;
  }
  return { results, next };
}

export type { RedactionReport };

/** Re-save the source with object streams (drops unused objects). */
export async function compressDocument(docId: string): Promise<{ loaded: LoadedPdf; before: number; after: number } | null> {
  const loaded = await materialize(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  const src = sourceBytes(model);
  if (!src) throw new Error("Source PDF bytes are missing");
  const bytes = await compressPdf(src.bytes);
  const before = src.bytes.byteLength, after = bytes.byteLength;
  if (after >= before) return { loaded, before, after: before };
  const rec = blobs.put(bytes, "application/pdf", { name: `${safeName(doc.title)}.pdf`, meta: { kind: "pdf", compressedFrom: src.id } });
  const next: PdfModel = { ...model, sourceBlobId: rec.id, meta: { ...model.meta, sourceSize: after } };
  invalidateExtraction(rec.id);
  const saved = savePdfModel(docId, next, { label: "Compressed", summary: `Compressed ${fmtBytes(before)} → ${fmtBytes(after)}`, force: true });
  if (!saved) return null;
  for (const li of db().library.find((l) => l.officeDocId === docId)) db().library.update(li.id, { size: after, updatedAt: saved.updatedAt });
  return { loaded: { doc: saved, model: next }, before, after };
}

/** Plain text of the document (page markers optional). */
export async function documentText(docId: string, markers = true): Promise<{ text: string; title: string } | null> {
  const r = await ensureExtracted(docId);
  if (!r) return null;
  return { text: textOfModel(r.loaded.model, { markers }), title: r.loaded.doc.title };
}

/** Markdown rendering of the extracted text (headings for pages, paragraphs by blank lines). */
export function textToMarkdown(model: PdfModel, title: string): string {
  const idx = new Map((model.textIndex ?? []).map((t) => [t.page, t.text]));
  const parts: string[] = [`# ${title}`];
  activePages(model).forEach((p, i) => {
    const t = p.blank ? "" : idx.get(p.index) ?? "";
    parts.push(`## Page ${i + 1}`);
    const paras = t.split(/\n{2,}/).map((s) => s.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    parts.push(paras.length ? paras.join("\n\n") : "*(no extractable text)*");
  });
  return parts.join("\n\n");
}

/** Create a Word document from the PDF's text (or supplied markdown). */
export async function convertToWord(docId: string, opts: { title?: string; markdown?: string } = {}): Promise<{ doc: OfficeDocument; url: string } | null> {
  const r = await ensureExtracted(docId);
  if (!r) return null;
  const { doc, model } = r.loaded;
  const title = opts.title?.trim() || `${doc.title} (converted)`;
  const md = opts.markdown ?? textToMarkdown(model, doc.title);
  const content = markdownToDoc(md.replace(/^# .*\n+/, ""), { title: doc.title });
  const created = createOfficeDoc({ kind: "word", title, content, matterId: doc.matterId, folderId: doc.folderId, meta: { convertedFrom: docId, source: "pdf" } });
  putLibraryItem(created, created.size ?? 0);
  return { doc: created, url: `/office/word/${created.id}` };
}

/** Create a PDF document from an existing blob (the ?blob= flow). */
export async function createFromBlob(blobId: string, opts: { matterId?: string; title?: string; folderId?: string } = {}): Promise<{ doc: OfficeDocument; url: string }> {
  const b = blobs.get(blobId);
  if (!b) throw new Error("Blob not found");
  const existing = db().officeDocs.findOne((d) => d.kind === "pdf" && (d.content as PdfModel | null)?.sourceBlobId === blobId);
  if (existing) return { doc: existing, url: `/office/pdf/${existing.id}` };
  const name = b.name ?? "document.pdf";
  const { model } = await modelFromBytes(b.bytes, { name, title: opts.title, blobId, meta: { originalBlobId: blobId } });
  const doc = createOfficeDoc({ kind: "pdf", title: opts.title ?? model.meta.title ?? name.replace(/\.pdf$/i, ""), content: model, matterId: opts.matterId, folderId: opts.folderId, meta: { originalBlobId: blobId, originalName: name } });
  putLibraryItem(doc, b.size);
  return { doc, url: `/office/pdf/${doc.id}` };
}

export function putLibraryItem(doc: OfficeDocument, size: number) {
  const now = new Date().toISOString();
  const ext = ({ word: "docx", sheet: "xlsx", slides: "pptx", pdf: "pdf" } as const)[doc.kind];
  const item: LibraryItem = { id: `lib_${nanoid(10)}`, parentId: doc.folderId ?? (doc.matterId ? matterFolderId(doc.matterId) : LIBRARY_FOLDERS.myFiles), name: doc.title, type: ext, matterId: doc.matterId, officeDocId: doc.id, size, createdAt: now, updatedAt: now, ownerId: doc.createdById, sharedWith: ["firm"] };
  db().library.put(item);
  return item;
}

export function safeName(title: string) { return title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "document"; }
export function fmtBytes(n: number) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }
