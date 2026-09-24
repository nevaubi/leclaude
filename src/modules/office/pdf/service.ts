import "server-only";
/**
 * Server-side PDF document service: loading models with their source bytes,
 * lazy materialization of template/seed documents, text extraction caching,
 * burn-in (bake the model into a new source), merge/split/compress, Word
 * conversion and export.
 */
import { nanoid } from "nanoid";
import { blobs, db } from "@/lib/db";
import type { LibraryItem, OfficeDocument } from "@/lib/types/domain";
import { createOfficeDoc, getOfficeDoc, saveOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { LIBRARY_FOLDERS, matterFolderId } from "@/modules/library/ids";
import { applyModel, compressPdf, extractPages, mergePdfs, type ApplyOptions } from "./apply";
import { extractPdf, invalidateExtraction, readPageSizes, type Extraction } from "./extract";
import { generatePdf } from "./generate";
import { activePages, buildModel, normalizeModel, textOfModel, type PdfAnnotation, type PdfModel } from "./model";
import { searchRuns } from "./text-search";
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

/** Build a model from PDF bytes (stores the blob) and extract its text. */
export async function modelFromBytes(bytes: Uint8Array, opts: { name?: string; title?: string; blobId?: string; meta?: PdfModel["meta"] } = {}): Promise<{ model: PdfModel; extraction: Extraction; blobId: string }> {
  const rec = blobs.put(bytes, "application/pdf", { id: opts.blobId, name: opts.name, meta: { kind: "pdf" } });
  const sizes = await readPageSizes(bytes);
  const extraction = await extractPdf(bytes, rec.id);
  const model = buildModel({ sourceBlobId: rec.id, pageSizes: sizes, textIndex: extraction.pages.map((p) => ({ page: p.page, text: p.text })), meta: { ...(opts.meta ?? {}), title: opts.title ?? extraction.meta.title ?? opts.name?.replace(/\.pdf$/i, ""), originalName: opts.name, sourceSize: bytes.byteLength, outline: extraction.outline, fields: extraction.fields, hasForm: extraction.fields.length > 0, producer: extraction.meta.producer, extractedAt: extraction.extractedAt } });
  return { model, extraction, blobId: rec.id };
}

/** Resolve annotations that carry a `quote` but no rects (seeded/agent) against the extraction. */
export function resolveQuotedAnnotations(model: PdfModel, extraction: Extraction): PdfModel {
  const annotations = model.annotations.map((a) => {
    if (a.rects.length || !a.quote) return a;
    const page = extraction.pages.find((p) => p.page === a.page);
    if (!page) return a;
    const hits = searchRuns(page.runs, a.quote, { limit: 1 });
    if (!hits.length) return a;
    const r = hits[0].rects;
    if (a.type === "note" || a.type === "stamp" || a.type === "text") {
      const b = r[0];
      const w = a.type === "note" ? 20 : a.type === "stamp" ? 190 : 200, h = a.type === "note" ? 20 : a.type === "stamp" ? 44 : 60;
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
export async function materialize(docId: string): Promise<LoadedPdf | null> {
  const loaded = loadPdf(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  if (!model.meta.pending) return loaded;
  const specId = String(model.meta.specId ?? "");
  const builder = SPEC_BUILDERS[specId];
  if (!builder) throw new Error(`Unknown PDF spec "${specId}"`);
  const spec = builder({ matterId: doc.matterId, title: doc.title });
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

/** Apply a model to its source and return the exported bytes. */
export async function exportPdf(req: ExportRequest): Promise<{ bytes: Uint8Array; title: string }> {
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
  const raster: Record<number, Uint8Array> = {};
  for (const [k, v] of Object.entries(rasterizedPages ?? {})) { const b = dataUrlToBytes(v); if (b) raster[Number(k)] = b; }
  const bytes = await applyModel(src.bytes, model, { ...rest, rasterizedPages: Object.keys(raster).length ? raster : undefined, title });
  return { bytes, title };
}

export function dataUrlToBytes(v: string): Uint8Array | null {
  const i = v.indexOf(",");
  if (i < 0) return null;
  try { return Uint8Array.from(Buffer.from(v.slice(i + 1), "base64")); } catch { return null; }
}

/**
 * Burn the model into a new source PDF (redactions, stamps, Bates, form
 * values, page operations…). The document then starts fresh from the new
 * bytes; burned annotations are dropped from the model, Bates is kept and
 * flagged `applied` so it is not stamped twice.
 */
export async function burnIn(docId: string, opts: { applyRedactions?: boolean; flattenAnnotations?: boolean; flattenForms?: boolean; bates?: boolean; rasterizedPages?: Record<number, string>; keepNotes?: boolean; label?: string } = {}): Promise<LoadedPdf | null> {
  const loaded = await materialize(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  const src = sourceBytes(model);
  if (!src) throw new Error("Source PDF bytes are missing");
  const raster: Record<number, Uint8Array> = {};
  for (const [k, v] of Object.entries(opts.rasterizedPages ?? {})) { const b = dataUrlToBytes(v); if (b) raster[Number(k)] = b; }
  const flatten = opts.flattenAnnotations ?? true;
  const bytes = await applyModel(src.bytes, model, { flattenAnnotations: flatten, applyRedactions: opts.applyRedactions ?? true, flattenForms: opts.flattenForms ?? false, bates: opts.bates ?? Boolean(model.bates && !model.bates.applied), rasterizedPages: Object.keys(raster).length ? raster : undefined, title: doc.title });
  const { model: fresh, extraction } = await modelFromBytes(bytes, { name: `${safeName(doc.title)}.pdf`, title: doc.title, meta: { templateId: model.meta.templateId, specId: model.meta.specId, burnedFrom: src.id, burnedAt: new Date().toISOString() } });
  // Sticky notes survive as native annotations; keep them in the model so the panel still lists them (display page → new source page).
  const keep: PdfAnnotation[] = [];
  if (opts.keepNotes !== false) {
    const order = activePages(model);
    for (const a of model.annotations) {
      if (a.type !== "note" || a.resolved) continue;
      const display = order.findIndex((p) => p.index === a.page);
      if (display >= 0) keep.push({ ...a, page: display + 1, applied: true });
    }
  }
  const next: PdfModel = { ...fresh, annotations: keep, bates: model.bates ? { ...model.bates, applied: true } : undefined, meta: { ...fresh.meta, redactionsApplied: (Number(model.meta.redactionsApplied ?? 0) + model.annotations.filter((a) => a.type === "redaction").length) || undefined, rasterizedPages: Object.keys(raster).length || undefined } };
  const saved = savePdfModel(docId, resolveQuotedAnnotations(next, extraction), { label: opts.label ?? "Applied edits to source", summary: `Burned ${model.annotations.length} annotation${model.annotations.length === 1 ? "" : "s"}${model.bates && !model.bates.applied ? ", Bates numbers" : ""}${Object.keys(raster).length ? ` and ${Object.keys(raster).length} rasterized page(s)` : ""} into the PDF`, force: true });
  if (!saved) return null;
  for (const li of db().library.find((l) => l.officeDocId === docId)) db().library.update(li.id, { size: bytes.byteLength, updatedAt: saved.updatedAt });
  return { doc: saved, model: next };
}

/** Append other PDFs to the document's source. */
export async function mergeInto(docId: string, others: { bytes: Uint8Array; name?: string }[]): Promise<LoadedPdf | null> {
  const loaded = await materialize(docId);
  if (!loaded) return null;
  const { doc, model } = loaded;
  const src = sourceBytes(model);
  if (!src) throw new Error("Source PDF bytes are missing");
  const { bytes, added } = await mergePdfs(src.bytes, others.map((o) => o.bytes));
  const rec = blobs.put(bytes, "application/pdf", { name: `${safeName(doc.title)}.pdf`, meta: { kind: "pdf", mergedFrom: [src.id, ...others.map((o) => o.name ?? "upload")] } });
  const extraction = await extractPdf(bytes, rec.id);
  const base = model.pageCount;
  const newPages = added.map((p, i) => ({ id: `pg_${base + i + 1}`, index: base + i + 1, rotation: 0 as const, width: p.width, height: p.height, order: 0 }));
  const active = model.pages.filter((p) => !p.deleted).sort((a, b) => a.order - b.order);
  const deleted = model.pages.filter((p) => p.deleted);
  const pages = [...active, ...newPages, ...deleted].map((p, i) => ({ ...p, order: i }));
  const next: PdfModel = { ...model, sourceBlobId: rec.id, pageCount: base + added.length, pages, textIndex: extraction.pages.map((p) => ({ page: p.page, text: p.text })), meta: { ...model.meta, sourceSize: bytes.byteLength, outline: extraction.outline, fields: extraction.fields, hasForm: extraction.fields.length > 0, extractedAt: extraction.extractedAt, mergedCount: (Number(model.meta.mergedCount ?? 0) + others.length) } };
  const saved = savePdfModel(docId, next, { label: "Merged PDF", summary: `Appended ${added.length} page${added.length === 1 ? "" : "s"} from ${others.map((o) => o.name ?? "upload").join(", ")}`, force: true });
  if (!saved) return null;
  return { doc: saved, model: next };
}

/** Extract display pages into a new document (shares no bytes with the original). */
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
  // carry annotations on the extracted pages (renumber to the new source numbers)
  const map = new Map(sourceNos.map((s, i) => [s, i + 1]));
  fresh.annotations = model.annotations.filter((a) => map.has(a.page)).map((a) => ({ ...a, page: map.get(a.page)! }));
  const created = createOfficeDoc({ kind: "pdf", title: newTitle, content: fresh, matterId: doc.matterId, folderId: doc.folderId, meta: { originalName: `${safeName(newTitle)}.pdf` } });
  putLibraryItem(created, bytes.byteLength);
  return { doc: created, url: `/office/pdf/${created.id}` };
}

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
