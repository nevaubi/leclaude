/**
 * PDF agent tools. Read tools answer from the snapshot (cached text index)
 * and, when rectangles are needed, from the server-side extraction of the
 * source bytes. Edit tools apply an operation to the snapshot model (so later
 * reads see the new state) AND register it as an EditProposal the user
 * applies in the editor. Side-effecting dependencies are injected.
 */
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import type { Extraction } from "./extract";
import { ANNOTATION_LABEL, DEFAULT_COLOR, DEFAULT_OPACITY, REDACTION_REASONS, STAMP_PRESETS, activePages, displayToSource, formatBates, newAnnotationId, pageBySource, parsePageRange, sourceToDisplay, textOfModel, type AnnotationType, type BatesPosition, type PdfAnnotation, type PdfBookmark, type PdfModel, type PdfRect } from "./model";
import { applyOp, opTitle, resolvePages, type PdfOp } from "./proposals";
import { pageText, type PdfSnapshot } from "./snapshot";
import { PII_PATTERNS, PRIVILEGE_MARKERS, buildPattern, searchRuns, snippetAround, type TextMatch } from "./text-search";

export interface PdfToolDeps {
  /** Positioned text for the snapshot's source (for rectangles). Null when bytes are unavailable. */
  extraction?: () => Promise<Extraction | null>;
  summarize?: (text: string, focus: string | undefined, context: { title: string; matter?: string }) => Promise<string>;
  extractTable?: (text: string, hint: string | undefined) => Promise<{ columns: string[]; rows: string[][]; caption?: string }>;
  describeImage?: (dataUrl: string, prompt: string) => Promise<string>;
  createWordDocument?: (title: string, markdown: string) => Promise<{ id: string; url: string }>;
  otherDocumentText?: (docId: string) => Promise<{ title: string; text: string } | null>;
  diffTexts?: (a: string, b: string) => { added: number; removed: number; changes: { kind: "added" | "removed"; text: string }[] };
  /** Page images attached by the client (display page → data URL). */
  pageImages?: Record<number, string>;
}

type Ctx = OfficeAgentContext<PdfSnapshot>;
const AUTHOR = "Drafting assistant";

export function isPdfEditingTool(name: string) {
  return /^(add_|set_|rotate_|delete_|reorder_|insert_|fill_|bates_|create_|remove_)/.test(name);
}

function preview(t: string, n = 140) { return t.length > n ? `${t.slice(0, n)}…` : t; }

function pagesArg(model: PdfModel, pages: string | number | number[] | undefined | null): number[] | "all" {
  if (pages === undefined || pages === null || pages === "" || pages === "all") return "all";
  const max = activePages(model).length;
  if (typeof pages === "number") return [pages];
  if (Array.isArray(pages)) return pages.map(Number).filter((n) => n >= 1 && n <= max);
  return parsePageRange(String(pages), max);
}

export function pdfAgentTools(ctx: Ctx, deps: PdfToolDeps = {}): ToolDef<never, unknown>[] {
  const s = ctx.snapshot;
  const model = () => s.model;
  let extractionPromise: Promise<Extraction | null> | null = null;
  const extraction = () => { if (!extractionPromise) extractionPromise = deps.extraction ? deps.extraction().catch(() => null) : Promise.resolve(null); return extractionPromise; };

  const commit = (op: PdfOp, meta: { title?: string; summary?: string; target?: string; targetLabel?: string; risk?: EditProposal["risk"] } = {}): EditProposal => {
    s.model = applyOp(s.model, op);
    return ctx.propose({ kind: op.op, title: meta.title ?? opTitle(op), summary: meta.summary, target: meta.target, targetLabel: meta.targetLabel, risk: meta.risk ?? "low", payload: op as unknown as Record<string, unknown> });
  };

  const toSource = (display: number) => {
    const src = displayToSource(model(), display);
    if (src == null) throw new Error(`No page ${display} (document has ${activePages(model()).length} pages)`);
    return src;
  };

  /** Find matches with rectangles on a set of display pages. */
  const findMatches = async (query: string, opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; pages?: number[] | "all"; limit?: number }): Promise<{ display: number; source: number; match: TextMatch; hasRects: boolean }[]> => {
    const m = model();
    const ex = await extraction();
    const sources = resolvePages(m, opts.pages);
    const out: { display: number; source: number; match: TextMatch; hasRects: boolean }[] = [];
    const limit = opts.limit ?? 200;
    for (const source of sources) {
      const page = pageBySource(m, source);
      if (!page || page.blank) continue;
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

  const tools: ToolDef<never, unknown>[] = [];
  const add = <A,>(t: ToolDef<A, unknown>) => tools.push(t as unknown as ToolDef<never, unknown>);

  // ---------------------------------------------------------------- read
  add(defineTool<{ from?: number; to?: number; max_chars?: number }>({
    name: "get_pages_text",
    description: "Full extracted text of a page range (display page numbers, 1-based, inclusive). Use this to read pages the snapshot truncated.",
    parameters: { type: "object", properties: { from: { type: "integer", description: "First page (default 1)" }, to: { type: "integer", description: "Last page (default = from, max from+9)" }, max_chars: { type: "integer", description: "Cap per page (default 12000)" } } },
    label: (a) => `Reading pages ${a.from ?? 1}–${a.to ?? a.from ?? 1}`,
    execute: ({ from, to, max_chars }) => {
      const m = model();
      const active = activePages(m);
      const a = Math.max(1, from ?? 1), b = Math.min(active.length, Math.max(a, Math.min(to ?? a, a + 9)));
      const cap = max_chars ?? 12_000;
      const pages = [];
      for (let d = a; d <= b; d++) { const p = active[d - 1]; const text = p.blank ? "" : pageText(m, p.index); pages.push({ page: d, chars: text.length, text: text.length > cap ? `${text.slice(0, cap)}… [truncated]` : text, rotation: p.rotation || undefined, blank: p.blank || undefined }); }
      return { pages, totalPages: active.length };
    },
  }));

  add(defineTool<{ query: string; regex?: boolean; case_sensitive?: boolean; whole_word?: boolean; pages?: string; limit?: number }>({
    name: "find_text",
    description: "Search the document for a term or regular expression. Returns page, snippet and the rectangles (PDF points) of each hit, which add_highlight / add_redaction can reuse.",
    parameters: { type: "object", properties: { query: { type: "string" }, regex: { type: "boolean" }, case_sensitive: { type: "boolean" }, whole_word: { type: "boolean" }, pages: { type: "string", description: "Page range like \"1-3, 7\" (display numbers). Default all." }, limit: { type: "integer", description: "Max hits (default 60)" } }, required: ["query"] },
    label: (a) => `Searching “${a.query}”`,
    execute: async ({ query, regex, case_sensitive, whole_word, pages, limit }) => {
      const hits = await findMatches(query, { regex, caseSensitive: case_sensitive, wholeWord: whole_word, pages: pagesArg(model(), pages), limit: limit ?? 60 });
      const byPage: Record<number, number> = {};
      for (const h of hits) byPage[h.display] = (byPage[h.display] ?? 0) + 1;
      return { total: hits.length, byPage, hits: hits.slice(0, limit ?? 60).map((h) => ({ page: h.display, text: h.match.text, snippet: h.match.snippet, rects: h.match.rects.map((r) => ({ x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1) })) })), note: hits.some((h) => !h.hasRects) ? "Some hits have no rectangles (source bytes unavailable); highlight/redaction by query will still resolve in the editor." : undefined };
    },
  }));

  add(defineTool<{ page?: number; type?: string; include_resolved?: boolean }>({
    name: "get_annotations",
    description: "List annotations (highlights, notes, stamps, redactions…) with ids, display page numbers, text and authors.",
    parameters: { type: "object", properties: { page: { type: "integer", description: "Display page filter" }, type: { type: "string", description: "highlight | underline | strikeout | note | text | rect | ellipse | freehand | stamp | redaction | link | signature" }, include_resolved: { type: "boolean" } } },
    execute: ({ page, type, include_resolved }) => {
      const m = model();
      const list = m.annotations.filter((a) => (!page || sourceToDisplay(m, a.page) === page) && (!type || a.type === type) && (include_resolved || !a.resolved));
      return { count: list.length, annotations: list.slice(0, 200).map((a) => ({ id: a.id, page: sourceToDisplay(m, a.page), type: a.type, text: a.text, quote: a.quote, reason: a.reason, color: a.color, author: a.author, createdAt: a.createdAt, resolved: a.resolved ?? false, applied: a.applied ?? false, rects: a.rects.slice(0, 4) })) };
    },
  }));

  add(defineTool<Record<string, never>>({
    name: "get_outline",
    description: "Document outline (bookmarks from the PDF) plus bookmarks added in this editor, with display page numbers, and the page list with sizes/rotation/deleted state.",
    parameters: { type: "object", properties: {} },
    execute: () => {
      const m = model();
      return { outline: m.meta.outline ?? [], bookmarks: (m.bookmarks ?? []).map((b) => ({ id: b.id, title: b.title, page: sourceToDisplay(m, b.page) })), pages: m.pages.sort((a, b) => a.order - b.order).map((p) => ({ display: p.deleted ? null : sourceToDisplay(m, p.index), source: p.index, width: Math.round(p.width), height: Math.round(p.height), rotation: p.rotation, deleted: p.deleted ?? false, blank: p.blank ?? false })), bates: m.bates ?? null, decorations: m.decorations ?? null };
    },
  }));

  add(defineTool<Record<string, never>>({
    name: "get_form_fields",
    description: "AcroForm fields (name, type, current value, options, page) and the values pending in this editor.",
    parameters: { type: "object", properties: {} },
    execute: () => { const m = model(); return { hasForm: Boolean(m.meta.hasForm), fields: (m.meta.fields ?? []).map((f) => ({ ...f, page: f.page ? sourceToDisplay(m, f.page) : undefined, pendingValue: m.formValues?.[f.name] })), pendingValues: m.formValues ?? {} }; },
  }));

  add(defineTool<{ page: number; question?: string }>({
    name: "describe_page_image",
    description: "Describe the visual content of a page (layout, signatures, stamps, handwriting, tables). Works when the editor attached a rendering of that page (it always attaches the page currently on screen; the user can also attach screenshots); otherwise returns the page text with a note.",
    parameters: { type: "object", properties: { page: { type: "integer", description: "Display page number" }, question: { type: "string", description: "What to look for" } }, required: ["page"] },
    label: (a) => `Looking at page ${a.page}`,
    execute: async ({ page, question }) => {
      const img = deps.pageImages?.[page];
      const src = toSource(page);
      if (img && deps.describeImage) {
        const text = await deps.describeImage(img, `${question ?? "Describe this PDF page precisely: layout, headings, tables, stamps, signatures, handwriting, redaction boxes, images."} Transcribe any text that is not machine-readable.`);
        return { page, source: "image", description: text };
      }
      return { page, source: "text", note: img ? "Vision model unavailable; falling back to text." : "No rendering of this page was attached. Ask the user to navigate to the page (the viewer attaches the visible page) or paste a screenshot.", text: pageText(model(), src).slice(0, 6000) };
    },
  }));

  // ---------------------------------------------------------------- edit: markups
  add(defineTool<{ page?: number; query?: string; regex?: boolean; pages?: string; rects?: PdfRect[]; color?: string; note?: string; kind?: "highlight" | "underline" | "strikeout"; all_matches?: boolean }>({
    name: "add_highlight",
    description: "Highlight (or underline / strike out) text. Give a `query` (every match on `pages`, or on `page`) or explicit `rects` on `page`. Optional note text becomes the annotation comment.",
    parameters: { type: "object", properties: { page: { type: "integer", description: "Display page (required with rects; optional with query)" }, query: { type: "string", description: "Text or regex to mark" }, regex: { type: "boolean" }, pages: { type: "string", description: "Page range for query mode, e.g. \"1-4\" (default all)" }, rects: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] } }, color: { type: "string", description: "Hex color, e.g. #FACC15 yellow, #4ADE80 green, #60A5FA blue, #F472B6 pink" }, note: { type: "string" }, kind: { type: "string", enum: ["highlight", "underline", "strikeout"] }, all_matches: { type: "boolean", description: "Mark every match (default true); false marks only the first" } }, required: [] },
    label: (a) => `Highlighting ${a.query ? `“${a.query}”` : `page ${a.page}`}`,
    execute: async ({ page, query, regex, pages, rects, color, note, kind, all_matches }) => {
      const type = kind ?? "highlight";
      const anns: PdfAnnotation[] = [];
      if (rects?.length) { if (!page) throw new Error("page is required with rects"); anns.push(markup(type, toSource(page), rects, { color, text: note })); }
      else if (query) {
        const hits = await findMatches(query, { regex, pages: page ? [page] : pagesArg(model(), pages), limit: all_matches === false ? 1 : 300 });
        if (!hits.length) return { added: 0, message: `No matches for “${query}”` };
        for (const h of hits) anns.push(markup(type, h.source, h.match.rects, { color, text: note, quote: h.match.text }));
      } else throw new Error("Provide query or rects");
      const p = commit({ op: "add_annotations", annotations: anns }, { title: `${ANNOTATION_LABEL[type]} ${anns.length > 1 ? `${anns.length} matches` : query ? `“${preview(query, 40)}”` : `on p. ${page}`}`, summary: note ?? (query ? `Marks every occurrence of “${query}”` : undefined), target: `page:${sourceToDisplay(model(), anns[0].page)}`, targetLabel: `p. ${sourceToDisplay(model(), anns[0].page)}` });
      return { added: anns.length, proposalId: p.id, pages: Array.from(new Set(anns.map((a) => sourceToDisplay(model(), a.page)))) };
    },
  }));

  add(defineTool<{ page: number; text: string; x?: number; y?: number; near?: string; color?: string }>({
    name: "add_note",
    description: "Add a sticky note (comment icon) on a page. Position with x/y in points from the top-left corner, or `near` a quoted phrase; default is the top-right margin.",
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
      return { added: 1, proposalId: p.id, annotationId: a.id };
    },
  }));

  add(defineTool<{ page: number; text: string; x?: number; y?: number; width?: number; height?: number; font_size?: number; color?: string }>({
    name: "add_text_box",
    description: "Add a free text box (typed text drawn on the page). x/y are points from the top-left corner. Default: a 260×60 box in the top margin.",
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
    description: `Stamp text (e.g. ${STAMP_PRESETS.slice(0, 5).join(", ")}, or custom like "EXHIBIT 14") on pages. Default: top-right of every page.`,
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

  add(defineTool<{ query?: string; regex?: boolean; preset?: string; pages?: string; page?: number; rects?: PdfRect[]; reason?: string }>({
    name: "add_redaction",
    description: `Propose redaction boxes over text matching a query/regex, a PII preset (${PII_PATTERNS.map((p) => p.id).join(" | ")}), or explicit rects. Redactions are drawn as black boxes on export; text under them is only removed when the user applies redactions (rasterized burn-in). Reasons: ${REDACTION_REASONS.join(", ")}.`,
    parameters: { type: "object", properties: { query: { type: "string" }, regex: { type: "boolean" }, preset: { type: "string", description: "PII preset id: ssn, account, card, phone, email, dob, ein" }, pages: { type: "string" }, page: { type: "integer", description: "Required with rects" }, rects: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] } }, reason: { type: "string" } }, required: [] },
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
      const p = commit({ op: "add_annotations", annotations: anns }, { title: `Redact ${anns.length} ${preset ? PII_PATTERNS.find((x) => x.id === preset)?.label.toLowerCase() : query ? `match${anns.length === 1 ? "" : "es"} of “${preview(query, 30)}”` : "region"}`, summary: reason ? `Reason: ${reason}` : undefined, target: `page:${sourceToDisplay(model(), anns[0].page)}`, targetLabel: `p. ${sourceToDisplay(model(), anns[0].page)}`, risk: "medium" });
      return { added: anns.length, proposalId: p.id, pages: Array.from(new Set(anns.map((a) => sourceToDisplay(model(), a.page)))), note: "Proposed only. The user must apply redactions (Apply → Redactions) to remove the underlying text." };
    },
  }));

  add(defineTool<{ ids: string[] }>({
    name: "remove_annotations",
    description: "Remove annotations by id (see get_annotations).",
    parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
    execute: ({ ids }) => { const p = commit({ op: "remove_annotations", ids }); return { removed: ids.length, proposalId: p.id }; },
  }));

  // ---------------------------------------------------------------- edit: production
  add(defineTool<{ prefix: string; start: number; digits?: number; position?: BatesPosition; legend?: string; font_size?: number }>({
    name: "bates_stamp",
    description: "Configure Bates numbering for every active page in order (applied on export or burn-in). Position: bottom-right (default), bottom-left, bottom-center, top-right, top-left, top-center. Optional confidentiality legend goes in the opposite corner.",
    parameters: { type: "object", properties: { prefix: { type: "string", description: "e.g. MFC-" }, start: { type: "integer" }, digits: { type: "integer", description: "Zero padding, default 7" }, position: { type: "string", enum: ["top-right", "bottom-right", "bottom-center", "top-left", "bottom-left", "top-center"] }, legend: { type: "string", description: "e.g. CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER" }, font_size: { type: "number" } }, required: ["prefix", "start"] },
    label: (a) => `Bates ${a.prefix}${a.start}`,
    execute: ({ prefix, start, digits, position, legend, font_size }) => {
      const cfg = { prefix, start, digits: digits ?? 7, position: position ?? "bottom-right", legend, fontSize: font_size };
      const n = activePages(model()).length;
      const p = commit({ op: "set_bates", bates: cfg }, { title: `Bates ${formatBates(cfg, 0)} – ${formatBates(cfg, n - 1)}`, summary: `${n} pages, ${cfg.position}${legend ? `, legend “${legend}”` : ""}`, targetLabel: "all pages" });
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

  // ---------------------------------------------------------------- edit: pages
  add(defineTool<{ pages: string; degrees: 90 | 180 | 270 | -90 }>({
    name: "rotate_pages",
    description: "Rotate pages (display numbers or range) by 90, 180, 270 or -90 degrees.",
    parameters: { type: "object", properties: { pages: { type: "string" }, degrees: { type: "integer", enum: [90, 180, 270, -90] } }, required: ["pages", "degrees"] },
    execute: ({ pages, degrees }) => { const src = resolvePages(model(), pagesArg(model(), pages)); const p = commit({ op: "rotate_pages", sourcePages: src, delta: degrees }, { targetLabel: pages }); return { rotated: src.length, proposalId: p.id }; },
  }));

  add(defineTool<{ pages: string }>({
    name: "delete_pages",
    description: "Delete pages (display numbers or range). Pages are removed on export; the user can restore them until then.",
    parameters: { type: "object", properties: { pages: { type: "string" } }, required: ["pages"] },
    execute: ({ pages }) => { const src = resolvePages(model(), pagesArg(model(), pages)); const p = commit({ op: "delete_pages", sourcePages: src }, { targetLabel: pages, risk: "medium" }); return { deleted: src.length, proposalId: p.id, remaining: activePages(model()).length }; },
  }));

  add(defineTool<{ order: number[] }>({
    name: "reorder_pages",
    description: "Reorder pages. `order` lists current display page numbers in their new sequence (pages omitted keep their relative order at the end).",
    parameters: { type: "object", properties: { order: { type: "array", items: { type: "integer" } } }, required: ["order"] },
    execute: ({ order }) => { const m = model(); const src = order.map((d) => toSource(d)); const p = commit({ op: "reorder_pages", order: src }, { summary: `New order: ${order.join(", ")}${order.length < activePages(m).length ? ", …" : ""}` }); return { proposalId: p.id, order: activePages(model()).map((pg) => pg.index) }; },
  }));

  add(defineTool<{ after_page: number; count?: number }>({
    name: "insert_blank_page",
    description: "Insert blank page(s) after a display page (0 = at the beginning).",
    parameters: { type: "object", properties: { after_page: { type: "integer" }, count: { type: "integer" } }, required: ["after_page"] },
    execute: ({ after_page, count }) => { const p = commit({ op: "insert_blank_page", afterDisplay: after_page, count: count ?? 1 }); return { proposalId: p.id, pages: activePages(model()).length }; },
  }));

  add(defineTool<{ values: Record<string, string | boolean> }>({
    name: "fill_form",
    description: "Fill AcroForm fields by name (see get_form_fields). Checkboxes take true/false; dropdowns take an option label.",
    parameters: { type: "object", properties: { values: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "boolean" }] }, description: "field name → value" } }, required: ["values"] },
    strict: false,
    execute: ({ values }) => {
      const fields = new Set((model().meta.fields ?? []).map((f) => f.name));
      const unknown = Object.keys(values).filter((k) => !fields.has(k));
      const known = Object.fromEntries(Object.entries(values).filter(([k]) => fields.has(k)));
      if (!Object.keys(known).length) throw new Error(`No matching fields. Available: ${Array.from(fields).slice(0, 30).join(", ") || "none"}`);
      const p = commit({ op: "fill_form", values: known }, { summary: Object.entries(known).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("; ").slice(0, 200) });
      return { filled: Object.keys(known), unknown, proposalId: p.id };
    },
  }));

  add(defineTool<{ page: number; title: string; level?: number }>({
    name: "add_bookmark",
    description: "Add an outline bookmark pointing at a display page.",
    parameters: { type: "object", properties: { page: { type: "integer" }, title: { type: "string" }, level: { type: "integer", description: "1 (default) or 2 (nested under the previous level-1 bookmark)" } }, required: ["page", "title"] },
    execute: ({ page, title, level }) => { const bm: PdfBookmark = { id: `bm_${Math.random().toString(36).slice(2, 8)}`, page: toSource(page), title, level: level ?? 1 }; const p = commit({ op: "add_bookmark", bookmark: bm }, { target: `page:${page}`, targetLabel: `p. ${page}` }); return { proposalId: p.id, bookmarkId: bm.id }; },
  }));

  // ---------------------------------------------------------------- analysis
  add(defineTool<{ focus?: string; pages?: string; max_words?: number }>({
    name: "summarize_document",
    description: "Summarize the document (or a page range) with the model; optionally focus on deadlines, obligations, parties, defined terms, etc. Returns text you should relay (and may refine).",
    parameters: { type: "object", properties: { focus: { type: "string" }, pages: { type: "string" }, max_words: { type: "integer" } } },
    label: "Summarizing document",
    execute: async ({ focus, pages }) => {
      const m = model();
      const sources = resolvePages(m, pagesArg(m, pages));
      const text = sources.map((src) => `--- Page ${sourceToDisplay(m, src)} ---\n${pageText(m, src)}`).join("\n\n").slice(0, 120_000);
      if (!text.trim()) return { summary: "", note: "No extractable text." };
      if (!deps.summarize) return { summary: text.slice(0, 6000), note: "Model summarization unavailable; returning the text for you to summarize." };
      const summary = await deps.summarize(text, focus, { title: s.title, matter: ctx.matter?.name });
      return { summary, pages: sources.length };
    },
  }));

  add(defineTool<{ page: number; hint?: string }>({
    name: "extract_table",
    description: "Extract a table from a page's text into a markdown table (columns + rows). Give a hint about which table when a page has several.",
    parameters: { type: "object", properties: { page: { type: "integer" }, hint: { type: "string" } }, required: ["page"] },
    label: (a) => `Extracting table from page ${a.page}`,
    execute: async ({ page, hint }) => {
      const text = pageText(model(), toSource(page));
      if (!text.trim()) throw new Error("No text on that page");
      if (!deps.extractTable) return { markdown: "", note: "Model extraction unavailable; page text follows.", text: text.slice(0, 6000) };
      const t = await deps.extractTable(text, hint);
      const md = [`| ${t.columns.join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${t.columns.map((_, i) => (r[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
      return { caption: t.caption, columns: t.columns, rowCount: t.rows.length, markdown: md };
    },
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
    description: "Scan every page for PII patterns (SSN, account numbers, cards, phones, e-mails, DOB, EIN) and privilege markers; returns hits by page with snippets and whether each is already covered by a redaction.",
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
      return { total: out.length, byKind, unredacted: out.filter((o) => !o.redacted).length, hits: out.slice(0, 120) };
    },
  }));

  return tools;
}
