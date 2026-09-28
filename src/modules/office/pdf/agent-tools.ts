/**
 * PDF agent tools. Read tools answer from the snapshot (page-indexed text) and,
 * when positions are needed, from the server-side extraction of the source
 * bytes (cached per blob). Edit tools apply an operation to the snapshot model
 * (so later reads see the new state) AND register it as an EditProposal the
 * user applies in the editor; every proposal carries its base (source blob and
 * the annotation ids it touches) so a stale one is rejected, never re-targeted.
 *
 * Modes (constitution §31): Ask gets the read-only toolset (edit tools are not
 * offered at all); Review gets the read tools plus annotation tools
 * (highlight / note); Draft gets everything.
 *
 * Text claims: image-only pages ("needs OCR") are excluded from search, quotes
 * and summaries; quotes are verified by code against the extracted text.
 */
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import type { Extraction } from "./extract";
import { detectHeadings, extractTables, pickTable, tableToMarkdown } from "./layout";
import { ANNOTATION_LABEL, BATES_FONTS, DEFAULT_COLOR, DEFAULT_OPACITY, REDACTION_REASONS, STAMP_PRESETS, activePages, displayToSource, formatBates, newAnnotationId, pageBySource, pageNeedsOcr, parsePageRange, sourceToDisplay, textOfModel, type AnnotationType, type BatesFont, type BatesPosition, type PdfAnnotation, type PdfBookmark, type PdfModel, type PdfPage, type PdfRect } from "./model";
import { applyOp, opTitle, resolvePages, type PdfOp } from "./proposals";
import { pageText, type PdfSnapshot } from "./snapshot";
import { PII_PATTERNS, PRIVILEGE_MARKERS, buildPattern, searchRuns, snippetAround, type TextMatch } from "./text-search";

export interface PdfToolDeps {
  /** Positioned text for the snapshot's source (for rectangles). Null when bytes are unavailable. */
  extraction?: () => Promise<Extraction | null>;
  summarize?: (text: string, focus: string | undefined, context: { title: string; matter?: string }) => Promise<string>;
  /** Summary as bullets, each citing a display page and an exact quote (verified by code afterwards). */
  summarizeCited?: (text: string, focus: string | undefined, context: { title: string; matter?: string }) => Promise<{ bullets: { text: string; page: number; quote: string }[] }>;
  /** Model fallback for tables the deterministic extractor cannot find. */
  extractTable?: (text: string, hint: string | undefined) => Promise<{ columns: string[]; rows: string[][]; caption?: string }>;
  describeImage?: (dataUrl: string, prompt: string) => Promise<string>;
  createWordDocument?: (title: string, markdown: string) => Promise<{ id: string; url: string }>;
  otherDocumentText?: (docId: string) => Promise<{ title: string; text: string } | null>;
  diffTexts?: (a: string, b: string) => { added: number; removed: number; changes: { kind: "added" | "removed"; text: string }[] };
  /** Create a new library PDF from display pages of this document (non-destructive). */
  splitDocument?: (displayPages: number[], title: string | undefined) => Promise<{ id: string; url: string; title: string; pages: number }>;
  /** Build (server-side, authorized) a merged source: this document + the given library PDFs. */
  mergeDocuments?: (docIds: string[]) => Promise<{ sourceBlobId: string; pageCount: number; pages: PdfPage[]; names: string[] }>;
  /** Page images attached by the client (display page → data URL). */
  pageImages?: Record<number, string>;
}

type Ctx = OfficeAgentContext<PdfSnapshot>;
const AUTHOR = "Drafting assistant";

/** Tools that never change anything (the Ask-mode toolset). */
export const PDF_READ_TOOLS = new Set([
  "get_pages_text", "search_text", "find_text", "verify_quote", "get_annotations", "get_outline", "get_form_fields", "list_form_fields",
  "describe_page_image", "summarize_document", "summarize_with_page_cites", "extract_table", "compare_to_document", "check_pii_and_privilege", "privilege_log_entry",
]);
/** Annotation-only tools allowed in Review mode (comments and markups; no content, page or production changes). */
export const PDF_ANNOTATION_TOOLS = new Set(["add_highlight", "highlight_matches", "add_note"]);

export function isPdfEditingTool(name: string) { return !PDF_READ_TOOLS.has(name) && name !== "report_finding"; }

function preview(t: string, n = 140) { return t.length > n ? `${t.slice(0, n)}…` : t; }

function pagesArg(model: PdfModel, pages: string | number | number[] | undefined | null): number[] | "all" {
  if (pages === undefined || pages === null || pages === "" || pages === "all") return "all";
  const max = activePages(model).length;
  if (typeof pages === "number") return [pages];
  if (Array.isArray(pages)) return pages.map(Number).filter((n) => n >= 1 && n <= max);
  return parsePageRange(String(pages), max);
}

const round = (r: PdfRect) => ({ x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1) });
/** QuadPoints (TL, TR, BL, BR) of a line rect, as PDF annotations store them. */
const quad = (r: PdfRect) => [r.x, r.y + r.h, r.x + r.w, r.y + r.h, r.x, r.y, r.x + r.w, r.y].map((v) => +v.toFixed(1));

/** Whitespace/quote/dash-insensitive normalization for quote verification. */
export function normalizeForQuote(s: string) {
  return s.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

const rectSchema = { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] } };

export function pdfAgentTools(ctx: Ctx, deps: PdfToolDeps = {}): ToolDef<never, unknown>[] {
  const s = ctx.snapshot;
  const model = () => s.model;
  let extractionPromise: Promise<Extraction | null> | null = null;
  const extraction = () => { if (!extractionPromise) extractionPromise = deps.extraction ? deps.extraction().catch(() => null) : Promise.resolve(null); return extractionPromise; };
  /** Redaction previews of this turn (id → match), so `apply` redacts exactly what was previewed. */
  const previews = new Map<string, { source: number; display: number; text: string; rects: PdfRect[]; label: string }>();

  const commit = (op: PdfOp, meta: { title?: string; summary?: string; target?: string; targetLabel?: string; risk?: EditProposal["risk"]; annotationIds?: string[] } = {}): EditProposal => {
    const withBase = { ...op, base: { sourceBlobId: s.model.sourceBlobId || undefined, annotationIds: meta.annotationIds } } as PdfOp;
    s.model = applyOp(s.model, withBase);
    return ctx.propose({ kind: op.op, title: meta.title ?? opTitle(op), summary: meta.summary, target: meta.target, targetLabel: meta.targetLabel, risk: meta.risk ?? "low", payload: withBase as unknown as Record<string, unknown> });
  };

  const toSource = (display: number) => {
    const src = displayToSource(model(), display);
    if (src == null) throw new Error(`No page ${display} (document has ${activePages(model()).length} pages)`);
    return src;
  };
  const ocrPages = () => activePages(model()).filter((p) => !p.blank && pageNeedsOcr(model(), p.index)).map((p) => sourceToDisplay(model(), p.index)!);

  /** Find matches with rectangles on a set of display pages (image-only pages are skipped: they have no text). */
  const findMatches = async (query: string, opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; pages?: number[] | "all"; limit?: number }): Promise<{ display: number; source: number; match: TextMatch; hasRects: boolean }[]> => {
    const m = model();
    const ex = await extraction();
    const sources = resolvePages(m, opts.pages);
    const out: { display: number; source: number; match: TextMatch; hasRects: boolean }[] = [];
    const limit = opts.limit ?? 200;
    for (const source of sources) {
      const page = pageBySource(m, source);
      if (!page || page.blank || pageNeedsOcr(m, source)) continue;
      const display = sourceToDisplay(m, source) ?? 0;
      const exPage = ex?.pages.find((p) => p.page === source);
      if (exPage) {
        for (const match of searchRuns(exPage.runs, query, { regex: opts.regex, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord, limit })) { out.push({ display, source, match, hasRects: match.rects.length > 0 }); if (out.length >= limit) return out; }
      } else {
        const re = buildPattern(query, { regex: opts.regex, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord });
        const text = pageText(m, source);
        if (!re) continue;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(text)) && out.length < limit) { if (!mm[0]) { re.lastIndex++; continue; } out.push({ display, source, match: { start: mm.index, end: mm.index + mm[0].length, text: mm[0], rects: [], snippet: snippetAround(text, mm.index, mm.index + mm[0].length), line: "" }, hasRects: false }); }
      }
    }
    return out;
  };

  const markup = (type: AnnotationType, page: number, rects: PdfRect[], extra: Partial<PdfAnnotation>): PdfAnnotation => ({ id: newAnnotationId(), page, type, rects, color: extra.color ?? DEFAULT_COLOR[type], opacity: extra.opacity ?? DEFAULT_OPACITY[type], author: AUTHOR, createdAt: new Date().toISOString(), ...extra });

  const pageDims = (source: number) => { const p = pageBySource(model(), source); return { w: p?.width ?? 612, h: p?.height ?? 792 }; };

  const all: ToolDef<never, unknown>[] = [];
  const add = <A,>(t: ToolDef<A, unknown>) => all.push(t as unknown as ToolDef<never, unknown>);

  // ======================================================================== read
  add(defineTool<{ from?: number; to?: number; max_chars?: number }>({
    name: "get_pages_text",
    description: "Full extracted text of a page range (display page numbers, 1-based, inclusive; at most 10 pages per call). Read the pages you will quote. Pages flagged needs_ocr are image-only: they have no text and must not be quoted or characterized from text.",
    parameters: { type: "object", properties: { from: { type: "integer", description: "First page (default 1)" }, to: { type: "integer", description: "Last page (default = from, max from+9)" }, max_chars: { type: "integer", description: "Cap per page (default 12000)" } } },
    label: (a) => `Reading pages ${a.from ?? 1}–${a.to ?? a.from ?? 1}`,
    execute: ({ from, to, max_chars }) => {
      const m = model();
      const active = activePages(m);
      const a = Math.max(1, from ?? 1), b = Math.min(active.length, Math.max(a, Math.min(to ?? a, a + 9)));
      const cap = max_chars ?? 12_000;
      const labels = m.meta.pageLabels;
      const pages = [];
      for (let d = a; d <= b; d++) {
        const p = active[d - 1];
        const ocr = !p.blank && pageNeedsOcr(m, p.index);
        const text = p.blank || ocr ? "" : pageText(m, p.index);
        pages.push({ page: d, label: labels?.[p.index - 1], chars: text.length, text: text.length > cap ? `${text.slice(0, cap)}… [truncated]` : text, rotation: p.rotation || undefined, blank: p.blank || undefined, needs_ocr: ocr || undefined });
      }
      return { pages, totalPages: active.length, note: pages.some((p) => p.needs_ocr) ? "needs_ocr pages are image-only scans: no machine-readable text is available (no OCR engine is configured)." : undefined };
    },
  }));

  const searchTool = (name: "search_text" | "find_text", description: string) => add(defineTool<{ query: string; regex?: boolean; case_sensitive?: boolean; whole_word?: boolean; pages?: string; limit?: number }>({
    name,
    description,
    parameters: { type: "object", properties: { query: { type: "string", description: "Literal text, or a JavaScript regular expression when regex=true" }, regex: { type: "boolean" }, case_sensitive: { type: "boolean" }, whole_word: { type: "boolean" }, pages: { type: "string", description: "Page range like \"1-3, 7\" (display numbers). Default all." }, limit: { type: "integer", description: "Max hits (default 60)" } }, required: ["query"] },
    label: (a) => `Searching “${a.query}”`,
    execute: async ({ query, regex, case_sensitive, whole_word, pages, limit }) => {
      const hits = await findMatches(query, { regex, caseSensitive: case_sensitive, wholeWord: whole_word, pages: pagesArg(model(), pages), limit: limit ?? 60 });
      const byPage: Record<number, number> = {};
      for (const h of hits) byPage[h.display] = (byPage[h.display] ?? 0) + 1;
      const skipped = ocrPages();
      return {
        total: hits.length,
        byPage,
        hits: hits.slice(0, limit ?? 60).map((h) => ({ page: h.display, text: h.match.text, snippet: h.match.snippet, rects: h.match.rects.map(round), ...(name === "search_text" ? { quads: h.match.rects.map(quad) } : {}) })),
        note: [hits.some((h) => !h.hasRects) ? "Some hits have no rectangles (source bytes unavailable); highlight/redaction by query will still resolve in the editor." : "", skipped.length ? `Pages ${skipped.join(", ")} are image-only (needs OCR) and were not searched.` : ""].filter(Boolean).join(" ") || undefined,
      };
    },
  }));
  searchTool("search_text", "Search the document for text or a regular expression. Returns every hit with its display page, the exact matched text, a snippet, rectangles (PDF points) and QuadPoints — reuse them for highlights/redactions. Image-only pages are not searchable.");
  searchTool("find_text", "Alias of search_text (rectangles only).");

  add(defineTool<{ page: number; quote: string }>({
    name: "verify_quote",
    description: "Verify, by exact comparison with the extracted text, that a quote appears on a display page (whitespace, curly quotes and dashes normalized; case-insensitive). Use before quoting the document in an answer; if it is not found, fix or drop the quote. Also reports other pages where it occurs.",
    parameters: { type: "object", properties: { page: { type: "integer" }, quote: { type: "string" } }, required: ["page", "quote"] },
    execute: ({ page, quote }) => {
      const m = model();
      const q = normalizeForQuote(quote);
      if (q.length < 3) throw new Error("quote is too short to verify");
      const where = activePages(m).map((p, i) => ({ display: i + 1, p })).filter(({ p }) => !p.blank && !pageNeedsOcr(m, p.index) && normalizeForQuote(pageText(m, p.index)).includes(q)).map((x) => x.display);
      const src = displayToSource(m, page);
      const ocr = src != null && pageNeedsOcr(m, src);
      return { page, found: where.includes(page), status: where.includes(page) ? "verified" : ocr ? "unverifiable_needs_ocr" : where.length ? "wrong_page" : "not_found", foundOnPages: where };
    },
  }));

  add(defineTool<{ page?: number; type?: string; include_resolved?: boolean }>({
    name: "get_annotations",
    description: "List annotations (highlights, notes, stamps, redactions…) with ids, display page numbers, text, authors and whether they already exist in the PDF file (native) or were added in this editor.",
    parameters: { type: "object", properties: { page: { type: "integer", description: "Display page filter" }, type: { type: "string", description: "highlight | underline | strikeout | note | text | rect | ellipse | freehand | stamp | redaction | link | signature" }, include_resolved: { type: "boolean" } } },
    execute: ({ page, type, include_resolved }) => {
      const m = model();
      const list = m.annotations.filter((a) => (!page || sourceToDisplay(m, a.page) === page) && (!type || a.type === type) && (include_resolved || !a.resolved));
      return { count: list.length, annotations: list.slice(0, 200).map((a) => ({ id: a.id, page: sourceToDisplay(m, a.page), type: a.type, text: a.text, quote: a.quote, reason: a.reason, color: a.color, author: a.author, createdAt: a.createdAt, resolved: a.resolved ?? false, applied: a.applied ?? false, inPdf: Boolean(a.native), rects: a.rects.slice(0, 4).map(round) })) };
    },
  }));

  add(defineTool<Record<string, never>>({
    name: "get_outline",
    description: "Document outline (bookmarks from the PDF) plus bookmarks added in this editor, with display page numbers; page list with sizes/rotation/deleted state, page labels, and pages that need OCR.",
    parameters: { type: "object", properties: {} },
    execute: () => {
      const m = model();
      return { outline: m.meta.outline ?? [], bookmarks: (m.bookmarks ?? []).map((b) => ({ id: b.id, title: b.title, level: b.level ?? 1, page: sourceToDisplay(m, b.page) })), pages: [...m.pages].sort((a, b) => a.order - b.order).map((p) => ({ display: p.deleted ? null : sourceToDisplay(m, p.index), source: p.index, label: m.meta.pageLabels?.[p.index - 1], width: Math.round(p.width), height: Math.round(p.height), rotation: p.rotation, deleted: p.deleted ?? false, blank: p.blank ?? false, needsOcr: !p.blank && pageNeedsOcr(m, p.index) })), bates: m.bates ?? null, decorations: m.decorations ?? null, metadata: { ...(m.meta.docInfo ?? {}), pending: m.metadata ?? null } };
    },
  }));

  const formFields = () => { const m = model(); return { hasForm: Boolean(m.meta.hasForm), flattenOnExport: Boolean(m.formFlatten), fields: (m.meta.fields ?? []).map((f) => ({ ...f, page: f.page ? sourceToDisplay(m, f.page) : undefined, pendingValue: m.formValues?.[f.name] })), pendingValues: m.formValues ?? {} }; };
  add(defineTool<Record<string, never>>({ name: "list_form_fields", description: "AcroForm fields: name, type (text, checkbox, radio, dropdown, option, signature), current value, options, display page and the values pending in this editor.", parameters: { type: "object", properties: {} }, execute: formFields }));
  add(defineTool<Record<string, never>>({ name: "get_form_fields", description: "Alias of list_form_fields.", parameters: { type: "object", properties: {} }, execute: formFields }));

  add(defineTool<{ page: number; question?: string }>({
    name: "describe_page_image",
    description: "Describe the visual content of a page (layout, signatures, stamps, handwriting, tables). Works when the editor attached a rendering of that page (it attaches the page on screen; the user can also paste screenshots); otherwise returns the page text with a note. A description of an image is not OCR: do not quote it as document text.",
    parameters: { type: "object", properties: { page: { type: "integer", description: "Display page number" }, question: { type: "string", description: "What to look for" } }, required: ["page"] },
    label: (a) => `Looking at page ${a.page}`,
    execute: async ({ page, question }) => {
      const img = deps.pageImages?.[page];
      const src = toSource(page);
      if (img && deps.describeImage) {
        const text = await deps.describeImage(img, `${question ?? "Describe this PDF page precisely: layout, headings, tables, stamps, signatures, handwriting, redaction boxes, images."} Transcribe any text that is not machine-readable.`);
        return { page, source: "image", description: text, note: "Visual description (model), not verified document text." };
      }
      return { page, source: "text", note: img ? "Vision model unavailable; falling back to text." : "No rendering of this page was attached. Ask the user to navigate to the page (the viewer attaches the visible page) or paste a screenshot.", text: pageNeedsOcr(model(), src) ? "" : pageText(model(), src).slice(0, 6000), needs_ocr: pageNeedsOcr(model(), src) || undefined };
    },
  }));

  // ======================================================================== annotations (draft + review)
  const highlight = async ({ page, query, regex, pages, rects, color, note, kind, all_matches, preset }: { page?: number; query?: string; regex?: boolean; pages?: string; rects?: PdfRect[]; color?: string; note?: string; kind?: "highlight" | "underline" | "strikeout"; all_matches?: boolean; preset?: string }) => {
    const type = kind ?? "highlight";
    const anns: PdfAnnotation[] = [];
    const pat = preset ? PII_PATTERNS.find((p) => p.id === preset) : null;
    if (preset && !pat) throw new Error(`Unknown preset ${preset}; use ${PII_PATTERNS.map((p) => p.id).join(", ")}`);
    const q = pat ? pat.pattern : query;
    if (rects?.length) { if (!page) throw new Error("page is required with rects"); anns.push(markup(type, toSource(page), rects, { color, text: note })); }
    else if (q) {
      const hits = await findMatches(q, { regex: pat ? true : regex, pages: page ? [page] : pagesArg(model(), pages), limit: all_matches === false ? 1 : 300 });
      if (!hits.length) return { added: 0, message: `No matches for ${pat ? pat.label : `“${q}”`}` };
      for (const h of hits) anns.push(markup(type, h.source, h.match.rects, { color, text: note, quote: h.match.text }));
    } else throw new Error("Provide query, preset or rects");
    const p = commit({ op: "add_annotations", annotations: anns }, { title: `${ANNOTATION_LABEL[type]} ${anns.length > 1 ? `${anns.length} matches` : q ? `“${preview(query ?? pat?.label ?? "", 40)}”` : `on p. ${page}`}`, summary: note ?? (q ? `Marks every occurrence of ${pat ? pat.label.toLowerCase() : `“${query}”`}` : undefined), target: `page:${sourceToDisplay(model(), anns[0].page)}`, targetLabel: `p. ${sourceToDisplay(model(), anns[0].page)}` });
    return { added: anns.length, proposalId: p.id, annotationIds: anns.map((a) => a.id), pages: Array.from(new Set(anns.map((a) => sourceToDisplay(model(), a.page)))) };
  };
  const highlightParams = { type: "object", properties: { page: { type: "integer", description: "Display page (required with rects; optional with query)" }, query: { type: "string", description: "Text or regex to mark" }, regex: { type: "boolean" }, preset: { type: "string", description: `Pattern preset instead of a query: ${PII_PATTERNS.map((p) => p.id).join(", ")}` }, pages: { type: "string", description: "Page range for query mode, e.g. \"1-4\" (default all)" }, rects: rectSchema, color: { type: "string", description: "Hex color, e.g. #FACC15 yellow, #4ADE80 green, #60A5FA blue, #F472B6 pink" }, note: { type: "string", description: "Comment text attached to each markup" }, kind: { type: "string", enum: ["highlight", "underline", "strikeout"] }, all_matches: { type: "boolean", description: "Mark every match (default true); false marks only the first" } }, required: [] };
  add(defineTool<Parameters<typeof highlight>[0]>({
    name: "add_highlight",
    description: "Highlight (or underline / strike out) text. Give a `query` (every match on `pages`, or on `page`) or explicit `rects` on `page`. Optional note text becomes the annotation comment. Written to the PDF as a real Highlight/Underline/StrikeOut annotation with QuadPoints.",
    parameters: highlightParams,
    label: (a) => `Highlighting ${a.query ? `“${a.query}”` : `page ${a.page}`}`,
    execute: highlight,
  }));
  add(defineTool<Parameters<typeof highlight>[0]>({
    name: "highlight_matches",
    description: "Highlight every match of a literal, regex or pattern preset across a page range in one proposal (one annotation per match, each quoting the exact matched text).",
    parameters: highlightParams,
    label: (a) => `Highlighting matches of ${a.preset ?? a.query ?? "pattern"}`,
    execute: highlight,
  }));

  add(defineTool<{ page: number; text: string; x?: number; y?: number; near?: string; color?: string }>({
    name: "add_note",
    description: "Add a sticky note (a PDF Text annotation: comment icon + popup text) on a page. Position with x/y in points from the top-left corner, or `near` a quoted phrase; default is the top-right margin.",
    parameters: { type: "object", properties: { page: { type: "integer" }, text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, near: { type: "string", description: "Phrase on the page to anchor the note next to" }, color: { type: "string" } }, required: ["page", "text"] },
    label: (a) => `Adding note on page ${a.page}`,
    execute: async ({ page, text, x, y, near, color }) => {
      const source = toSource(page);
      const { w, h } = pageDims(source);
      let rect: PdfRect = { x: w - 60, y: h - 60, w: 20, h: 20 };
      let quote: string | undefined;
      if (typeof x === "number" && typeof y === "number") rect = { x: Math.max(0, Math.min(w - 20, x)), y: Math.max(0, Math.min(h - 20, h - y - 20)), w: 20, h: 20 };
      else if (near) { const hits = await findMatches(near, { pages: [page], limit: 1 }); const r = hits[0]?.match.rects[0]; if (r) { rect = { x: Math.min(w - 24, r.x + r.w + 4), y: r.y + r.h - 20, w: 20, h: 20 }; quote = hits[0].match.text; } }
      const a = markup("note", source, [rect], { text, color, quote });
      const p = commit({ op: "add_annotations", annotations: [a] }, { title: `Note on p. ${page}`, summary: preview(text), target: `page:${page}`, targetLabel: `p. ${page}` });
      return { added: 1, proposalId: p.id, annotationId: a.id, anchored: Boolean(quote) };
    },
  }));

  // ======================================================================== draft: content annotations
  add(defineTool<{ page: number; text: string; x?: number; y?: number; width?: number; height?: number; font_size?: number; color?: string }>({
    name: "add_text_box",
    description: "Add a free text box (a PDF FreeText annotation). x/y are points from the top-left corner. Default: a 260×60 box in the top margin.",
    parameters: { type: "object", properties: { page: { type: "integer" }, text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, font_size: { type: "number" }, color: { type: "string" } }, required: ["page", "text"] },
    execute: ({ page, text, x, y, width, height, font_size, color }) => {
      const source = toSource(page);
      const { w, h } = pageDims(source);
      const bw = width ?? 260, bh = height ?? 60;
      const rect: PdfRect = { x: Math.max(0, Math.min(w - bw, x ?? (w - bw) / 2)), y: Math.max(0, Math.min(h - bh, h - (y ?? 24) - bh)), w: bw, h: bh };
      const a = markup("text", source, [rect], { text, fontSize: font_size ?? 11, color });
      const p = commit({ op: "add_annotations", annotations: [a] }, { title: `Text box on p. ${page}`, summary: preview(text), target: `page:${page}`, targetLabel: `p. ${page}` });
      return { added: 1, proposalId: p.id };
    },
  }));

  add(defineTool<{ text: string; pages?: string; position?: "top-left" | "top-center" | "top-right" | "center" | "bottom-center"; color?: string }>({
    name: "add_stamp",
    description: `Stamp text (e.g. ${STAMP_PRESETS.slice(0, 5).join(", ")}, or custom like "EXHIBIT 14") on pages. Default: top-right of every page. Only stamp an endorsement the user asked for.`,
    parameters: { type: "object", properties: { text: { type: "string" }, pages: { type: "string", description: "Page range, default all" }, position: { type: "string", enum: ["top-left", "top-center", "top-right", "center", "bottom-center"] }, color: { type: "string" } }, required: ["text"] },
    label: (a) => `Stamping “${a.text}”`,
    execute: ({ text, pages, position, color }) => {
      const m = model();
      const sources = resolvePages(m, pagesArg(m, pages));
      const anns = sources.map((source) => {
        const { w, h } = pageDims(source);
        const sw = Math.min(w - 40, Math.max(120, text.length * 12 + 30)), sh = 40;
        const pos = position ?? "top-right";
        const x = pos.endsWith("left") ? 24 : pos.endsWith("right") ? w - sw - 24 : (w - sw) / 2;
        const y = pos.startsWith("top") ? h - sh - 18 : pos.startsWith("bottom") ? 30 : (h - sh) / 2;
        return markup("stamp", source, [{ x, y, w: sw, h: sh }], { text: text.toUpperCase(), color });
      });
      const p = commit({ op: "add_annotations", annotations: anns }, { title: `Stamp “${text.toUpperCase()}” on ${anns.length === activePages(m).length ? "every page" : `${anns.length} page${anns.length === 1 ? "" : "s"}`}`, target: `page:${sourceToDisplay(m, anns[0].page)}`, targetLabel: pages ?? "all pages" });
      return { added: anns.length, proposalId: p.id };
    },
  }));

  // ======================================================================== draft: redaction
  const REDACTION_NOTE = "Proposed only. When the user applies the redactions (Pages → Apply edits to source, or export), the text under each box is REMOVED from the page content, annotations/fields/metadata repeating it are scrubbed, and the file is re-extracted to verify it is gone. Until then nothing is removed.";
  add(defineTool<{ query?: string; regex?: boolean; preset?: string; pages?: string; page?: number; rects?: PdfRect[]; reason?: string }>({
    name: "add_redaction",
    description: `Propose redaction boxes over text matching a query/regex, a PII preset (${PII_PATTERNS.map((p) => p.id).join(" | ")}), or explicit rects. Prefer redact_pattern (preview first) for PII sweeps. Reasons: ${REDACTION_REASONS.join(", ")}.`,
    parameters: { type: "object", properties: { query: { type: "string" }, regex: { type: "boolean" }, preset: { type: "string", description: "PII preset id: ssn, account, card, phone, email, dob, ein" }, pages: { type: "string" }, page: { type: "integer", description: "Required with rects" }, rects: rectSchema, reason: { type: "string" } }, required: [] },
    label: (a) => `Redacting ${a.preset ?? a.query ?? "region"}`,
    execute: async ({ query, regex, preset, pages, page, rects, reason }) => {
      const anns: PdfAnnotation[] = [];
      if (rects?.length) { if (!page) throw new Error("page is required with rects"); anns.push(markup("redaction", toSource(page), rects, { reason })); }
      else {
        const pat = preset ? PII_PATTERNS.find((p) => p.id === preset) : null;
        if (preset && !pat) throw new Error(`Unknown preset ${preset}; use ${PII_PATTERNS.map((p) => p.id).join(", ")}`);
        const q = pat ? pat.pattern : query;
        if (!q) throw new Error("Provide query, preset or rects");
        const hits = await findMatches(q, { regex: pat ? true : regex, pages: page ? [page] : pagesArg(model(), pages), limit: 300 });
        if (!hits.length) return { added: 0, message: `No matches for ${pat ? pat.label : `“${query}”`}` };
        for (const h of hits) anns.push(markup("redaction", h.source, h.match.rects, { reason: reason ?? (pat ? pat.label : undefined), quote: h.match.text }));
      }
      const p = commit({ op: "add_annotations", annotations: anns }, { title: `Redact ${anns.length} ${preset ? PII_PATTERNS.find((x) => x.id === preset)?.label.toLowerCase() : query ? `match${anns.length === 1 ? "" : "es"} of “${preview(query, 30)}”` : "region"}`, summary: reason ? `Reason: ${reason}` : undefined, target: `page:${sourceToDisplay(model(), anns[0].page)}`, targetLabel: `p. ${sourceToDisplay(model(), anns[0].page)}`, risk: "high" });
      return { added: anns.length, proposalId: p.id, pages: Array.from(new Set(anns.map((a) => sourceToDisplay(model(), a.page)))), note: REDACTION_NOTE };
    },
  }));

  add(defineTool<{ presets?: string[]; regex?: string; pages?: string; action?: "preview" | "apply"; match_ids?: string[]; reason?: string }>({
    name: "redact_pattern",
    description: `Two-step PII redaction. Step 1 action="preview" (default): list every match of the presets (${PII_PATTERNS.map((p) => `${p.id} = ${p.label.toLowerCase()}`).join("; ")}) and/or a custom regex, with ids, pages and snippets — show the user what will be redacted. Step 2 action="apply": propose redaction boxes for the previewed matches (all, or only match_ids). Image-only pages cannot be searched and are reported.`,
    parameters: { type: "object", properties: { presets: { type: "array", items: { type: "string", enum: PII_PATTERNS.map((p) => p.id) } }, regex: { type: "string", description: "Custom JavaScript regular expression" }, pages: { type: "string" }, action: { type: "string", enum: ["preview", "apply"] }, match_ids: { type: "array", items: { type: "string" }, description: "Subset of previewed match ids to redact (apply)" }, reason: { type: "string" } }, required: [] },
    label: (a) => `${a.action === "apply" ? "Redacting" : "Previewing"} ${[...(a.presets ?? []), a.regex ? "custom pattern" : ""].filter(Boolean).join(", ") || "patterns"}`,
    execute: async ({ presets, regex, pages, action, match_ids, reason }) => {
      const pats = (presets ?? []).map((id) => { const p = PII_PATTERNS.find((x) => x.id === id); if (!p) throw new Error(`Unknown preset ${id}`); return p; });
      if (regex) { try { new RegExp(regex); } catch (e) { throw new Error(`Invalid regex: ${(e as Error).message}`); } pats.push({ id: "custom", label: "Custom pattern", pattern: regex }); }
      if (action === "apply" && match_ids?.length) {
        const chosen = match_ids.map((id) => previews.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
        if (!chosen.length) throw new Error("Unknown match ids; run action=preview first in this turn");
        return applyMatches(chosen, reason);
      }
      if (!pats.length) throw new Error("Give presets and/or regex");
      const found: { id: string; source: number; display: number; text: string; rects: PdfRect[]; label: string; snippet: string }[] = [];
      const seen = new Set<string>();
      for (const pat of pats) {
        for (const h of await findMatches(pat.pattern, { regex: true, pages: pagesArg(model(), pages), limit: 300 })) {
          const key = `${h.source}:${h.match.start}:${h.match.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const id = `m${previews.size + 1}`;
          const rec = { source: h.source, display: h.display, text: h.match.text, rects: h.match.rects, label: pat.label };
          previews.set(id, rec);
          found.push({ id, ...rec, snippet: h.match.snippet });
        }
      }
      const skipped = ocrPages();
      if (action === "apply") return found.length ? applyMatches(found, reason) : { added: 0, message: "No matches" };
      return { action: "preview", total: found.length, matches: found.slice(0, 150).map((f) => ({ id: f.id, page: f.display, kind: f.label, text: f.text, snippet: f.snippet, locatable: f.rects.length > 0 })), unsearchablePages: skipped.length ? skipped : undefined, next: found.length ? "Show the user these matches, then call redact_pattern with action=\"apply\" (optionally match_ids) to propose the boxes." : undefined };
    },
  }));
  const applyMatches = (matches: { source: number; text: string; rects: PdfRect[]; label: string }[], reason: string | undefined) => {
    const locatable = matches.filter((m) => m.rects.length);
    if (!locatable.length) return { added: 0, message: "Matches have no positions (source bytes unavailable); cannot place boxes." };
    const anns = locatable.map((m) => markup("redaction", m.source, m.rects, { reason: reason ?? m.label, quote: m.text }));
    const p = commit({ op: "add_annotations", annotations: anns }, { title: `Redact ${anns.length} match${anns.length === 1 ? "" : "es"} (${Array.from(new Set(locatable.map((m) => m.label.toLowerCase()))).join(", ")})`, summary: reason ? `Reason: ${reason}` : undefined, target: `page:${sourceToDisplay(model(), anns[0].page)}`, targetLabel: `p. ${sourceToDisplay(model(), anns[0].page)}`, risk: "high" });
    return { added: anns.length, proposalId: p.id, pages: Array.from(new Set(anns.map((a) => sourceToDisplay(model(), a.page)))), unplaced: matches.length - locatable.length || undefined, note: REDACTION_NOTE };
  };

  add(defineTool<{ page: number; x?: number; y?: number; width?: number; height?: number; rects?: PdfRect[]; reason?: string }>({
    name: "redact_region",
    description: "Propose a redaction box over a rectangular region of a page (e.g. a signature, photo, handwritten note or a whole table). Give x/y/width/height in points from the page's TOP-LEFT corner, or `rects` in PDF points (origin bottom-left, as returned by search_text). Images under the box are handled by rasterizing that page when the redaction is applied.",
    parameters: { type: "object", properties: { page: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, rects: rectSchema, reason: { type: "string" } }, required: ["page"] },
    execute: ({ page, x, y, width, height, rects, reason }) => {
      const source = toSource(page);
      const { w, h } = pageDims(source);
      let rs: PdfRect[];
      if (rects?.length) rs = rects;
      else if ([x, y, width, height].every((v) => typeof v === "number")) rs = [{ x: x!, y: h - y! - height!, w: width!, h: height! }];
      else throw new Error("Give x, y, width, height (top-left origin) or rects");
      rs = rs.map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(r.w, w - Math.max(0, r.x)), h: Math.min(r.h, h - Math.max(0, r.y)) })).filter((r) => r.w > 0 && r.h > 0);
      if (!rs.length) throw new Error("Region is outside the page");
      const a = markup("redaction", source, rs, { reason });
      const p = commit({ op: "add_annotations", annotations: [a] }, { title: `Redact region on p. ${page}`, summary: reason ? `Reason: ${reason}` : undefined, target: `page:${page}`, targetLabel: `p. ${page}`, risk: "high" });
      return { added: 1, proposalId: p.id, annotationId: a.id, note: REDACTION_NOTE };
    },
  }));

  add(defineTool<{ ids: string[] }>({
    name: "remove_annotations",
    description: "Remove annotations by id (see get_annotations). Annotations that already exist in the PDF are removed from the file on export.",
    parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
    execute: ({ ids }) => {
      const have = new Set(model().annotations.map((a) => a.id));
      const unknown = ids.filter((id) => !have.has(id));
      if (unknown.length) throw new Error(`Unknown annotation ids: ${unknown.slice(0, 5).join(", ")}`);
      const p = commit({ op: "remove_annotations", ids }, { annotationIds: ids });
      return { removed: ids.length, proposalId: p.id };
    },
  }));

  // ======================================================================== draft: production
  add(defineTool<{ prefix: string; start: number; digits?: number; position?: BatesPosition; legend?: string; font_size?: number; font?: BatesFont; pages?: string }>({
    name: "bates_stamp",
    description: `Configure Bates numbering (drawn on export / apply). Numbers run consecutively over the stamped pages in display order (default every active page; \`pages\` limits to a range). Position: bottom-right (default), bottom-left, bottom-center, top-right, top-left, top-center. Fonts: ${BATES_FONTS.join(", ")}. Add a \`legend\` endorsement (e.g. CONFIDENTIAL) ONLY when the user asked for one.`,
    parameters: { type: "object", properties: { prefix: { type: "string", description: "e.g. ABC-" }, start: { type: "integer" }, digits: { type: "integer", description: "Zero padding, default 7" }, position: { type: "string", enum: ["top-right", "bottom-right", "bottom-center", "top-left", "bottom-left", "top-center"] }, legend: { type: "string", description: "Endorsement the user asked for, e.g. CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER" }, font_size: { type: "number" }, font: { type: "string", enum: BATES_FONTS }, pages: { type: "string", description: "Display page range to stamp, default all" } }, required: ["prefix", "start"] },
    label: (a) => `Bates ${a.prefix}${a.start}`,
    execute: ({ prefix, start, digits, position, legend, font_size, font, pages }) => {
      if (model().bates?.applied) throw new Error(`This document already carries applied Bates numbers (${model().bates?.first ?? model().bates?.prefix}); ask the user before re-stamping`);
      const total = activePages(model()).length;
      const only = pages ? parsePageRange(pages, total) : undefined;
      const cfg = { prefix, start, digits: digits ?? 7, position: position ?? "bottom-right", legend: legend?.trim() || undefined, fontSize: font_size, font, pages: only };
      const n = only?.length ?? total;
      const p = commit({ op: "set_bates", bates: cfg }, { title: `Bates ${formatBates(cfg, 0)} – ${formatBates(cfg, n - 1)}`, summary: `${n} page${n === 1 ? "" : "s"}, ${cfg.position}${legend ? `, endorsement “${legend}”` : ""}${font ? `, ${font}` : ""}`, targetLabel: pages ?? "all pages" });
      return { proposalId: p.id, first: formatBates(cfg, 0), last: formatBates(cfg, n - 1), pages: n };
    },
  }));

  add(defineTool<{ header?: string; footer?: string; page_numbers?: string; watermark?: string; watermark_opacity?: number }>({
    name: "set_header_footer",
    description: "Set header/footer text, a page-number format (use {page} and {pages}) and/or a diagonal watermark (e.g. DRAFT, CONFIDENTIAL). Empty string clears an item.",
    parameters: { type: "object", properties: { header: { type: "string" }, footer: { type: "string" }, page_numbers: { type: "string", description: "e.g. \"Page {page} of {pages}\"" }, watermark: { type: "string" }, watermark_opacity: { type: "number" } }, required: [] },
    execute: ({ header, footer, page_numbers, watermark, watermark_opacity }) => {
      const cur = model().decorations ?? {};
      const next = { ...cur };
      if (header !== undefined) next.header = header ? { text: header, position: "top-center" } : undefined;
      if (footer !== undefined) next.footer = footer ? { text: footer, position: "bottom-center" } : undefined;
      if (page_numbers !== undefined) next.pageNumbers = page_numbers ? { format: page_numbers, position: "bottom-center" } : undefined;
      if (watermark !== undefined) next.watermark = watermark ? { text: watermark, opacity: watermark_opacity ?? 0.15 } : undefined;
      const p = commit({ op: "set_decorations", decorations: Object.values(next).some(Boolean) ? next : null });
      return { proposalId: p.id, decorations: next };
    },
  }));

  add(defineTool<{ title?: string; author?: string; subject?: string; keywords?: string }>({
    name: "set_metadata",
    description: "Set document properties (Title, Author, Subject, Keywords) written on export. Never put privileged or redacted content in metadata.",
    parameters: { type: "object", properties: { title: { type: "string" }, author: { type: "string" }, subject: { type: "string" }, keywords: { type: "string", description: "Comma-separated" } }, required: [] },
    execute: (md) => {
      const metadata = Object.fromEntries(Object.entries(md).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      if (!Object.keys(metadata).length) throw new Error("Give at least one of title, author, subject, keywords");
      const p = commit({ op: "set_metadata", metadata }, { summary: Object.entries(metadata).map(([k, v]) => `${k}: ${preview(v, 60)}`).join("; ") });
      return { proposalId: p.id, metadata };
    },
  }));

  // ======================================================================== draft: pages
  add(defineTool<{ pages: string; degrees: 90 | 180 | 270 | -90 }>({
    name: "rotate_pages",
    description: "Rotate pages (display numbers or range) by 90, 180, 270 or -90 degrees. Annotations stay on their pages.",
    parameters: { type: "object", properties: { pages: { type: "string" }, degrees: { type: "integer", enum: [90, 180, 270, -90] } }, required: ["pages", "degrees"] },
    execute: ({ pages, degrees }) => { const src = resolvePages(model(), pagesArg(model(), pages)); const p = commit({ op: "rotate_pages", sourcePages: src, delta: degrees }, { targetLabel: pages }); return { rotated: src.length, proposalId: p.id }; },
  }));

  add(defineTool<{ pages: string }>({
    name: "delete_pages",
    description: "Delete pages (display numbers or range). On export the pages and their content are removed from the file and bookmarks pointing at them lose their target.",
    parameters: { type: "object", properties: { pages: { type: "string" } }, required: ["pages"] },
    execute: ({ pages }) => { const src = resolvePages(model(), pagesArg(model(), pages)); const p = commit({ op: "delete_pages", sourcePages: src }, { targetLabel: pages, risk: "medium" }); return { deleted: src.length, proposalId: p.id, remaining: activePages(model()).length }; },
  }));

  add(defineTool<{ order: number[] }>({
    name: "reorder_pages",
    description: "Reorder pages. `order` lists current display page numbers in their new sequence (pages omitted keep their relative order at the end). Bookmarks and annotations follow their pages.",
    parameters: { type: "object", properties: { order: { type: "array", items: { type: "integer" } } }, required: ["order"] },
    execute: ({ order }) => { const m = model(); const src = order.map((d) => toSource(d)); const p = commit({ op: "reorder_pages", order: src }, { summary: `New order: ${order.join(", ")}${order.length < activePages(m).length ? ", …" : ""}` }); return { proposalId: p.id, order: activePages(model()).map((pg) => pg.index) }; },
  }));

  add(defineTool<{ after_page: number; count?: number }>({
    name: "insert_blank_page",
    description: "Insert blank page(s) after a display page (0 = at the beginning).",
    parameters: { type: "object", properties: { after_page: { type: "integer" }, count: { type: "integer" } }, required: ["after_page"] },
    execute: ({ after_page, count }) => { const p = commit({ op: "insert_blank_page", afterDisplay: after_page, count: count ?? 1 }); return { proposalId: p.id, pages: activePages(model()).length }; },
  }));

  add(defineTool<{ ranges: string[]; titles?: string[] }>({
    name: "split_pdf",
    description: "Split pages into NEW library documents (this document is unchanged): one new PDF per range, e.g. [\"1-3\", \"4-9\"]. Bookmarks and annotations on those pages come along. Returns the new documents' links.",
    parameters: { type: "object", properties: { ranges: { type: "array", items: { type: "string" } }, titles: { type: "array", items: { type: "string" } } }, required: ["ranges"] },
    label: "Splitting PDF",
    execute: async ({ ranges, titles }) => {
      if (!deps.splitDocument) throw new Error("Splitting is unavailable in this context");
      const max = activePages(model()).length;
      const out = [];
      for (let i = 0; i < ranges.length && i < 20; i++) {
        const pages = parsePageRange(ranges[i], max);
        if (!pages.length) throw new Error(`No valid pages in "${ranges[i]}"`);
        const r = await deps.splitDocument(pages, titles?.[i]);
        ctx.emit({ type: "artifact", artifact: { kind: "link", title: r.title, data: { url: r.url, id: r.id, kind: "pdf" } } });
        out.push({ range: ranges[i], ...r });
      }
      return { created: out };
    },
  }));

  add(defineTool<{ pages: string; title?: string }>({
    name: "extract_pages",
    description: "Copy the given pages into ONE new library PDF (this document is unchanged). Returns the link.",
    parameters: { type: "object", properties: { pages: { type: "string" }, title: { type: "string" } }, required: ["pages"] },
    label: (a) => `Extracting pages ${a.pages}`,
    execute: async ({ pages, title }) => {
      if (!deps.splitDocument) throw new Error("Extraction is unavailable in this context");
      const list = parsePageRange(pages, activePages(model()).length);
      if (!list.length) throw new Error(`No valid pages in "${pages}"`);
      const r = await deps.splitDocument(list, title);
      ctx.emit({ type: "artifact", artifact: { kind: "link", title: r.title, data: { url: r.url, id: r.id, kind: "pdf" } } });
      return r;
    },
  }));

  add(defineTool<{ doc_ids: string[] }>({
    name: "merge_pdfs",
    description: "Propose appending other library PDFs (by document id) to the end of this document. Their bookmarks nest under one bookmark per document; their annotations come along. The merged file is built server-side; the user applies the proposal.",
    parameters: { type: "object", properties: { doc_ids: { type: "array", items: { type: "string" } } }, required: ["doc_ids"] },
    label: "Merging PDFs",
    execute: async ({ doc_ids }) => {
      if (!deps.mergeDocuments) throw new Error("Merging is unavailable in this context");
      if (!doc_ids.length || doc_ids.length > 20) throw new Error("Give 1–20 document ids");
      const r = await deps.mergeDocuments(doc_ids);
      const p = commit({ op: "append_pages", pages: r.pages, sourceBlobId: r.sourceBlobId, pageCount: r.pageCount }, { title: `Append ${r.pages.length} page${r.pages.length === 1 ? "" : "s"} from ${r.names.join(", ")}`, risk: "medium" });
      return { proposalId: p.id, appendedPages: r.pages.length, totalPages: activePages(model()).length };
    },
  }));

  // ======================================================================== draft: forms, bookmarks
  add(defineTool<{ values: Record<string, string | boolean> }>({
    name: "fill_form",
    description: "Fill AcroForm fields by name (see list_form_fields). Checkboxes take true/false; dropdowns take an option label.",
    parameters: { type: "object", properties: { values: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "boolean" }] }, description: "field name → value" } }, required: ["values"] },
    strict: false,
    execute: ({ values }) => {
      const fields = new Map((model().meta.fields ?? []).map((f) => [f.name, f]));
      const unknown = Object.keys(values).filter((k) => !fields.has(k));
      const invalid: string[] = [];
      const known: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(values)) {
        const f = fields.get(k);
        if (!f) continue;
        if (f.readOnly) { invalid.push(`${k} (read-only)`); continue; }
        if ((f.type === "radio" || f.type === "option") && typeof v === "string" && f.options && !f.options.includes(v)) { invalid.push(`${k} (not an option: ${f.options.slice(0, 8).join(", ")})`); continue; }
        known[k] = f.type === "checkbox" ? v === true || v === "true" || v === "Yes" : v;
      }
      if (!Object.keys(known).length) throw new Error(`No fillable fields. ${unknown.length ? `Unknown: ${unknown.join(", ")}. ` : ""}${invalid.length ? `Invalid: ${invalid.join("; ")}. ` : ""}Available: ${Array.from(fields.keys()).slice(0, 30).join(", ") || "none"}`);
      const p = commit({ op: "fill_form", values: known }, { summary: Object.entries(known).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("; ").slice(0, 200) });
      return { filled: Object.keys(known), unknown, invalid, proposalId: p.id };
    },
  }));

  add(defineTool<{ flatten?: boolean }>({
    name: "flatten_form",
    description: "Flatten form fields on export (values become static page content; fields are no longer editable). flatten=false keeps them editable.",
    parameters: { type: "object", properties: { flatten: { type: "boolean" } }, required: [] },
    execute: ({ flatten }) => {
      if (!model().meta.hasForm) throw new Error("This document has no form fields");
      const p = commit({ op: "flatten_form", flatten: flatten !== false }, { risk: "medium" });
      return { proposalId: p.id, flatten: flatten !== false };
    },
  }));

  add(defineTool<{ page: number; title: string; level?: number }>({
    name: "add_bookmark",
    description: "Add an outline bookmark pointing at a display page (appended after the document's existing outline).",
    parameters: { type: "object", properties: { page: { type: "integer" }, title: { type: "string" }, level: { type: "integer", description: "1 (default) or 2 (nested under the previous level-1 bookmark)" } }, required: ["page", "title"] },
    execute: ({ page, title, level }) => { const bm: PdfBookmark = { id: `bm_${Math.random().toString(36).slice(2, 8)}`, page: toSource(page), title, level: level ?? 1 }; const p = commit({ op: "add_bookmark", bookmark: bm }, { target: `page:${page}`, targetLabel: `p. ${page}` }); return { proposalId: p.id, bookmarkId: bm.id }; },
  }));

  add(defineTool<{ pages?: string; max_level?: number }>({
    name: "add_bookmarks",
    description: "Detect section headings from the text layout (larger type, numbered or all-caps heading lines) and propose one bookmark per heading on its page, nested by numbering depth. Deterministic; review the list it returns.",
    parameters: { type: "object", properties: { pages: { type: "string", description: "Page range (default all)" }, max_level: { type: "integer", description: "1 or 2 (default 2)" } }, required: [] },
    label: "Bookmarking headings",
    execute: async ({ pages, max_level }) => {
      const ex = await extraction();
      if (!ex) throw new Error("Text positions are unavailable (source bytes missing)");
      const m = model();
      const maxLevel = Math.max(1, Math.min(2, max_level ?? 2));
      const existing = new Set([...(m.bookmarks ?? []).map((b) => `${b.page}:${b.title.toLowerCase()}`), ...flatOutline(m.meta.outline ?? []).map((o) => `${o.page}:${o.title.toLowerCase()}`)]);
      const bookmarks: PdfBookmark[] = [];
      for (const source of resolvePages(m, pagesArg(m, pages))) {
        const exPage = ex.pages.find((p) => p.page === source);
        if (!exPage || pageNeedsOcr(m, source)) continue;
        for (const h of detectHeadings(exPage.runs)) {
          if (h.level > maxLevel || existing.has(`${source}:${h.title.toLowerCase()}`)) continue;
          bookmarks.push({ id: `bm_${Math.random().toString(36).slice(2, 8)}`, page: source, title: h.title, level: h.level });
        }
      }
      if (!bookmarks.length) return { added: 0, message: "No new headings detected" };
      const p = commit({ op: "add_bookmarks", bookmarks: bookmarks.slice(0, 200) }, { summary: bookmarks.slice(0, 6).map((b) => `p.${sourceToDisplay(m, b.page)} ${b.title}`).join(" · ") });
      return { proposalId: p.id, added: bookmarks.length, bookmarks: bookmarks.slice(0, 60).map((b) => ({ page: sourceToDisplay(m, b.page), title: b.title, level: b.level })) };
    },
  }));

  // ======================================================================== analysis (read)
  add(defineTool<{ focus?: string; pages?: string; max_words?: number }>({
    name: "summarize_document",
    description: "Summarize the document (or a page range) with the model; optionally focus on deadlines, obligations, parties, defined terms, etc. Prefer summarize_with_page_cites when the user needs citations.",
    parameters: { type: "object", properties: { focus: { type: "string" }, pages: { type: "string" }, max_words: { type: "integer" } } },
    label: "Summarizing document",
    execute: async ({ focus, pages }) => {
      const m = model();
      const sources = resolvePages(m, pagesArg(m, pages)).filter((src) => !pageNeedsOcr(m, src));
      const text = sources.map((src) => `--- Page ${sourceToDisplay(m, src)} ---\n${pageText(m, src)}`).join("\n\n").slice(0, 120_000);
      if (!text.trim()) return { summary: "", note: "No extractable text." };
      if (!deps.summarize) return { summary: text.slice(0, 6000), note: "Model summarization unavailable; returning the text for you to summarize." };
      const summary = await deps.summarize(text, focus, { title: s.title, matter: ctx.matter?.name });
      const skipped = ocrPages();
      return { summary, pages: sources.length, excludedNeedsOcr: skipped.length ? skipped : undefined };
    },
  }));

  add(defineTool<{ focus?: string; pages?: string }>({
    name: "summarize_with_page_cites",
    description: "Summarize with a citation per point: each bullet carries a display page and an exact supporting quote, and every quote is VERIFIED by code against that page's extracted text. Relay verified bullets with (p. N); drop or flag unverified ones. Image-only pages are excluded.",
    parameters: { type: "object", properties: { focus: { type: "string" }, pages: { type: "string" } } },
    label: "Summarizing with page citations",
    execute: async ({ focus, pages }) => {
      const m = model();
      const active = activePages(m);
      const sources = resolvePages(m, pagesArg(m, pages)).filter((src) => !pageNeedsOcr(m, src));
      const text = sources.map((src) => `--- Page ${sourceToDisplay(m, src)} ---\n${pageText(m, src)}`).join("\n\n").slice(0, 120_000);
      if (!text.trim()) return { bullets: [], note: "No extractable text." };
      if (!deps.summarizeCited) return { bullets: [], note: "Model summarization unavailable; read the pages and cite them yourself (verify quotes with verify_quote).", text: text.slice(0, 6000) };
      const r = await deps.summarizeCited(text, focus, { title: s.title, matter: ctx.matter?.name });
      const allowed = new Set(sources.map((src) => sourceToDisplay(m, src)));
      const bullets = (r.bullets ?? []).slice(0, 40).map((b) => {
        const page = Number(b.page);
        const p = active[page - 1];
        const onPage = Boolean(p && allowed.has(page) && b.quote && normalizeForQuote(pageText(m, p.index)).includes(normalizeForQuote(b.quote)));
        const elsewhere = !onPage && b.quote ? active.map((x, i) => ({ i: i + 1, x })).filter(({ x, i }) => allowed.has(i) && normalizeForQuote(pageText(m, x.index)).includes(normalizeForQuote(b.quote))).map((y) => y.i) : [];
        return { text: b.text, page, quote: b.quote, cite: `p. ${page}`, status: onPage ? "verified" : elsewhere.length ? "wrong_page" : "unsupported", foundOnPages: elsewhere.length ? elsewhere : undefined };
      });
      const skipped = ocrPages();
      return { bullets, verified: bullets.filter((b) => b.status === "verified").length, unverified: bullets.filter((b) => b.status !== "verified").length, excludedNeedsOcr: skipped.length ? skipped : undefined };
    },
  }));

  add(defineTool<{ page: number; hint?: string }>({
    name: "extract_table",
    description: "Extract a table from a page deterministically from text positions (columns from x-aligned cells). Give a hint when a page has several tables. Falls back to the model only when no aligned table is found (marked).",
    parameters: { type: "object", properties: { page: { type: "integer" }, hint: { type: "string" } }, required: ["page"] },
    label: (a) => `Extracting table from page ${a.page}`,
    execute: async ({ page, hint }) => {
      const src = toSource(page);
      if (pageNeedsOcr(model(), src)) throw new Error(`Page ${page} is image-only (needs OCR); no text table can be extracted`);
      const ex = await extraction();
      const exPage = ex?.pages.find((p) => p.page === src);
      const t = exPage ? pickTable(extractTables(exPage.runs), hint) : null;
      if (t) return { page, method: "layout", columns: t.columns, rowCount: t.rows.length, markdown: tableToMarkdown(t), bbox: round(t.bbox) };
      const text = pageText(model(), src);
      if (!text.trim()) throw new Error("No text on that page");
      if (!deps.extractTable) return { page, method: "none", markdown: "", note: "No aligned table found; page text follows.", text: text.slice(0, 6000) };
      const mt = await deps.extractTable(text, hint);
      return { page, method: "model", caption: mt.caption, columns: mt.columns, rowCount: mt.rows.length, markdown: tableToMarkdown(mt), note: "Model reading of unaligned text — verify cells against the page." };
    },
  }));

  add(defineTool<Record<string, never>>({
    name: "privilege_log_entry",
    description: "Draft a privilege-log entry for this document from its metadata and header fields (date, type, author, recipients, cc, Bates) with a description that does NOT disclose privileged substance. Deterministic; the privilege basis always requires attorney review.",
    parameters: { type: "object", properties: {} },
    label: "Drafting privilege log entry",
    execute: () => privilegeLogEntry(model(), s.title),
  }));

  add(defineTool<{ title: string; markdown?: string; from_text?: boolean }>({
    name: "create_word_document",
    description: "Create a Word document in the library, either from markdown you provide (summary, memo, extracted table…) or from the PDF's full extracted text (from_text = true). Returns the URL.",
    parameters: { type: "object", properties: { title: { type: "string" }, markdown: { type: "string" }, from_text: { type: "boolean" } }, required: ["title"] },
    label: (a) => `Creating “${a.title}”`,
    execute: async ({ title, markdown, from_text }) => {
      if (!deps.createWordDocument) throw new Error("Word conversion is unavailable in this context");
      const md = from_text || !markdown ? `# ${s.title}\n\n${textOfModel(model())}` : markdown;
      const r = await deps.createWordDocument(title, md);
      ctx.emit({ type: "artifact", artifact: { kind: "link", title, data: { url: r.url, id: r.id, kind: "word" } } });
      return { created: r.id, url: r.url, title };
    },
  }));

  add(defineTool<{ other_doc_id: string; max_changes?: number }>({
    name: "compare_to_document",
    description: "Compare this PDF's text with another library document (PDF or Word) by id and summarize the differences (added/removed lines).",
    parameters: { type: "object", properties: { other_doc_id: { type: "string" }, max_changes: { type: "integer" } }, required: ["other_doc_id"] },
    label: "Comparing documents",
    execute: async ({ other_doc_id, max_changes }) => {
      if (!deps.otherDocumentText || !deps.diffTexts) throw new Error("Comparison is unavailable in this context");
      const other = await deps.otherDocumentText(other_doc_id);
      if (!other) throw new Error(`Document ${other_doc_id} not found`);
      const mine = textOfModel(model(), { markers: false });
      const d = deps.diffTexts(mine, other.text);
      const n = max_changes ?? 40;
      return { other: { id: other_doc_id, title: other.title, chars: other.text.length }, thisChars: mine.length, addedLines: d.added, removedLines: d.removed, identical: d.added === 0 && d.removed === 0, changes: d.changes.slice(0, n).map((c) => ({ kind: c.kind, text: preview(c.text, 220) })), truncated: d.changes.length > n };
    },
  }));

  add(defineTool<Record<string, never>>({
    name: "check_pii_and_privilege",
    description: "Scan every page for PII patterns (SSN, account numbers, cards, phones, e-mails, DOB, EIN) and privilege markers; returns hits by page with snippets and whether each is already covered by a redaction. Image-only pages cannot be scanned and are listed.",
    parameters: { type: "object", properties: {} },
    label: "Scanning for PII and privilege markers",
    execute: async () => {
      const m = model();
      const out: { kind: string; label: string; page: number; text: string; snippet: string; redacted: boolean }[] = [];
      const redactions = m.annotations.filter((a) => a.type === "redaction");
      const covered = (source: number, r: PdfRect[]) => redactions.some((a) => a.page === source && a.rects.some((rr) => r.some((x) => x.x >= rr.x - 2 && x.x + x.w <= rr.x + rr.w + 2 && x.y >= rr.y - 2 && x.y + x.h <= rr.y + rr.h + 2)));
      for (const pat of PII_PATTERNS) for (const h of await findMatches(pat.pattern, { regex: true, limit: 50 })) out.push({ kind: pat.id, label: pat.label, page: h.display, text: h.match.text, snippet: h.match.snippet, redacted: h.hasRects ? covered(h.source, h.match.rects) : false });
      for (const marker of PRIVILEGE_MARKERS) for (const h of await findMatches(marker, { limit: 20 })) out.push({ kind: "privilege", label: `Privilege marker: ${marker}`, page: h.display, text: h.match.text, snippet: h.match.snippet, redacted: h.hasRects ? covered(h.source, h.match.rects) : false });
      const byKind: Record<string, number> = {};
      for (const o of out) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
      const skipped = ocrPages();
      return { total: out.length, byKind, unredacted: out.filter((o) => !o.redacted).length, hits: out.slice(0, 120), unscannedNeedsOcr: skipped.length ? skipped : undefined };
    },
  }));

  // Mode-scoped toolset: Ask = read-only; Review = read + annotation tools; Draft = all.
  if (ctx.mode === "ask") return all.filter((t) => PDF_READ_TOOLS.has(t.name));
  if (ctx.mode === "review") return all.filter((t) => PDF_READ_TOOLS.has(t.name) || PDF_ANNOTATION_TOOLS.has(t.name));
  return all;
}

function flatOutline(items: { title: string; page: number | null; children?: unknown[] }[]): { title: string; page: number }[] {
  const out: { title: string; page: number }[] = [];
  for (const it of items) { if (it.page) out.push({ title: it.title, page: it.page }); if (Array.isArray(it.children)) out.push(...flatOutline(it.children as typeof items)); }
  return out;
}

const ATTORNEY_HINT = /\b(esq\.?|counsel|attorney|law(?:yer)?s?\b|legal\b|@[\w.-]*(?:law|llp|legal)[\w.-]*)/i;

/**
 * Deterministic privilege-log entry: header fields from the first page (From/To/CC/Date/Subject lines of an e-mail
 * or memo) and document metadata. The description names the document type, participants and date, and states the
 * claimed basis generically — never the subject line or body. Constitution §44 (PRIVILEGE CC): an attorney merely
 * copied on a business communication is not a basis for privilege; without a privilege marker or an attorney as
 * author/recipient the basis is `requires_review`.
 */
export function privilegeLogEntry(model: PdfModel, title: string) {
  const first = activePages(model).find((p) => !p.blank && !pageNeedsOcr(model, p.index));
  const text = first ? pageText(model, first.index) : "";
  const all = activePages(model).filter((p) => !p.blank && !pageNeedsOcr(model, p.index)).map((p) => pageText(model, p.index)).join("\n");
  const field = (name: string) => text.match(new RegExp(`^\\s*(?:${name})\\s*:\\s*(.+)$`, "im"))?.[1]?.trim();
  const from = field("From"), to = field("To"), cc = field("Cc|CC"), dateLine = field("Date|Sent");
  const isEmail = Boolean(from && to);
  const isMemo = /\bMEMORANDUM\b/.test(text) || (/^\s*(To|From|Re)\s*:/im.test(text) && !isEmail);
  const docType = isEmail ? "Email" : isMemo ? "Memorandum" : /\bLetter\b|^Dear\s/m.test(text) ? "Letter" : "Document";
  const info = model.meta.docInfo ?? {};
  const author = from ?? info.author ?? null;
  const date = dateLine ?? (info.created ? info.created.replace(/^D:(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3") : null);
  const markers = PRIVILEGE_MARKERS.filter((mk) => all.toLowerCase().includes(mk));
  const workProduct = markers.some((mk) => mk.includes("work product"));
  const acMarker = markers.some((mk) => !mk.includes("work product"));
  const attorneyPrincipal = [from, to].some((x) => x && ATTORNEY_HINT.test(x));
  const attorneyOnlyCc = !attorneyPrincipal && Boolean(cc && ATTORNEY_HINT.test(cc));
  const basis: string[] = [];
  if (acMarker || attorneyPrincipal) basis.push("Attorney-Client Privilege");
  if (workProduct) basis.push("Attorney Work Product");
  const warnings: string[] = [];
  if (attorneyOnlyCc && !markers.length) warnings.push("An attorney appears only in CC and no privilege marker was found. Copying counsel on a business communication does not by itself make it privileged.");
  if (!basis.length) warnings.push("No privilege basis could be established from the document; attorney review required before logging.");
  if (!first) warnings.push("No machine-readable text (image-only pages need OCR); header fields could not be read.");
  const participants = [author ? `from ${author}` : "", to ? `to ${to}` : "", cc ? `copying ${cc}` : ""].filter(Boolean).join(", ");
  const description = `${docType}${participants ? ` ${participants}` : ""}${date ? `, dated ${date}` : ""}, ${basis.includes("Attorney Work Product") && !basis.includes("Attorney-Client Privilege") ? "prepared in anticipation of litigation" : basis.length ? "reflecting a confidential communication for the purpose of obtaining or providing legal advice" : "[privilege basis to be determined by reviewing attorney]"}.`;
  const bates = model.bates ? { first: formatBates(model.bates, 0), last: model.bates.last ?? formatBates(model.bates, Math.max(0, (model.bates.pages?.length ?? activePages(model).length) - 1)), applied: Boolean(model.bates.applied) } : null;
  return {
    entry: { document: title, bates, date, docType, author, recipients: to ?? null, cc: cc ?? null, basis: basis.length ? basis.join("; ") : null, description },
    status: "requires_review" as const,
    markersFound: markers,
    warnings,
    note: "Description is generated from header fields only and discloses no content. Privilege is a high-risk call (constitution §24): an attorney must confirm the basis before this entry is served.",
  };
}
