/**
 * Slides agent tools. Read tools answer from the snapshot deck; edit tools apply an operation to the snapshot (so
 * later reads see the new state) AND register the same operation as an EditProposal the user can apply.
 *
 * Contract (constitution §31, §44, §52):
 *  - modes are enforced here, not by prompt: Ask gets read tools only, Review gets read tools + comments, Draft gets
 *    everything; `commit` refuses outside Draft as a second line of defence;
 *  - every proposal carries its base (slide / element / order / theme fingerprints + deck version) and the ids it
 *    targets, so the editor rejects it once the target changed (stale proposal);
 *  - text edits are verified against the box geometry with the deterministic text-fit estimate; overflow is fixed by
 *    growing/shrinking (proposed alongside) or reported for condensing;
 *  - matter data (chronology, exhibits, documents, library images) comes through injected, authorization-checked
 *    accessors bound to the deck's own matter; unresolved Bates numbers are errors, never substituted.
 */
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import { checkConsistency, documentOutline, exhibitSlide, fitTextPlan, outlineToSlides, timelineSlide, type ExhibitDoc, type TimelineEventInput } from "./deck-builders";
import { applyLayout, buildSlide, deckToOutline, extractContent, parseOutline, restyleSlide, splitSlide, type SlideContent, type TimelineItem } from "./layouts";
import {
  LAYOUT_LABEL, SLIDE_H, SLIDE_LAYOUTS, SLIDE_W, THEMES, bulletLines, clampToSlide, cloneSlide, estimateTextFit, getTheme, makeElement, newSlideId, plainText, slideBodyText, slideTitle, wordCount,
  type ChartSpec, type DeckElement, type DeckSlide, type DeckTheme, type ElementStyle, type PlaceholderRole, type PptxLayoutInfo, type ShapeKind, type SlideLayout, type TableCell,
} from "./model";
import { applyOp, baseFor, type SlidesOp } from "./proposals";
import { renderSlide, type SlidesSnapshot } from "./snapshot";

/** Authorization-checked data access for matter-aware tools (server implementation in agent.ts). */
export interface SlidesDataAccess {
  /** The deck's matter, resolved server-side from the stored document; null when the deck has none. */
  matterId: () => string | null;
  timeline: (matterId: string) => TimelineEventInput[];
  /** Exact Bates resolution inside one matter (start number or within a range); null when unresolved. */
  exhibitByBates: (matterId: string, bates: string) => ExhibitDoc | null;
  officeDoc: (docId: string) => { id: string; title: string; kind: string; matterId?: string; content: unknown } | null;
  libraryItem: (id: string) => { id: string; name: string; type: string; matterId?: string; sharedWith?: string[]; content?: string; url?: string } | null;
  blob: (blobId: string) => { id: string; mime: string; name?: string; matterId?: string } | null;
  /** True when a library item visible to the matter (same matter or firm-shared) links this blob. */
  libraryLinksBlob: (blobId: string, matterId: string | null) => boolean;
}

export interface SlidesToolDeps {
  generateImage?: (prompt: string, size: "1024x1024" | "1536x1024" | "1024x1536") => Promise<{ url: string; blobId?: string }>;
  condenseSlides?: (slides: { id: string; title: string; body: string }[], goals: string[], limits: { maxBullets: number; maxWords: number }, context: { deckTitle: string; matter?: string }) => Promise<{ id: string; title?: string; body: string }[]>;
  generateNotes?: (slides: { id: string; index: number; title: string; body: string; layout: string }[], style: string, context: { deckTitle: string; matter?: string }) => Promise<{ id: string; notes: string }[]>;
  /** Fast-model rewrite of one text box to a word/bullet budget (meaning, cites, dates and figures preserved). */
  rewriteText?: (input: { markdown: string; maxWords: number; maxBullets: number; instruction?: string }, context: { deckTitle: string; matter?: string }) => Promise<string>;
  data?: SlidesDataAccess;
}

type Ctx = OfficeAgentContext<SlidesSnapshot>;

const PLACEHOLDERS: PlaceholderRole[] = ["title", "subtitle", "body", "left", "right", "leftTitle", "rightTitle", "quote", "attribution", "caption", "kicker", "date", "number"];

/** Read-only tools: the only ones available in Ask mode. */
export const SLIDES_READ_TOOLS = new Set(["get_deck_outline", "get_slide", "get_slides", "find_text", "get_theme", "get_layouts", "get_selection", "get_comments", "check_consistency", "check_text_fit"]);
/** Review mode adds comments (findings) but no edits. */
export const SLIDES_REVIEW_TOOLS = new Set([...SLIDES_READ_TOOLS, "add_review_comment"]);

export function isSlidesEditingTool(name: string) {
  return !SLIDES_REVIEW_TOOLS.has(name);
}

function preview(t: string, n = 140) { return t.length > n ? `${t.slice(0, n)}…` : t; }

/** Placeholder geometry of an imported layout in canvas px. */
function layoutRect(layout: PptxLayoutInfo | undefined, match: (p: PptxLayoutInfo["placeholders"][number]) => boolean, map: { scale: number; offX: number; offY: number } | undefined) {
  const p = layout?.placeholders.find(match);
  if (!p?.emu || !map) return undefined;
  return { x: Math.round(p.emu.x * map.scale + map.offX), y: Math.round(p.emu.y * map.scale + map.offY), w: Math.round(p.emu.cx * map.scale), h: Math.round(p.emu.cy * map.scale), ph: { type: p.type, idx: p.idx } };
}

export function slidesAgentTools(ctx: Ctx, deps: SlidesToolDeps = {}): ToolDef<never, unknown>[] {
  const s = ctx.snapshot;
  const deck = () => s.deck;
  const theme = () => s.deck.theme;
  const pptx = () => s.deck.meta?.pptx;

  const findSlide = (ref: string | number | undefined): { slide: DeckSlide; index: number } => {
    const d = deck();
    if (ref === undefined || ref === null || ref === "") { if (s.selection?.slideId) { const i = d.slides.findIndex((x) => x.id === s.selection?.slideId); if (i >= 0) return { slide: d.slides[i], index: i }; } throw new Error("slide_id is required (use get_deck_outline for ids)"); }
    const asNum = typeof ref === "number" ? ref : /^\d+$/.test(String(ref)) ? Number(ref) : NaN;
    if (!Number.isNaN(asNum)) { const i = asNum - 1; if (!d.slides[i]) throw new Error(`No slide number ${asNum} (deck has ${d.slides.length})`); return { slide: d.slides[i], index: i }; }
    const i = d.slides.findIndex((x) => x.id === ref);
    if (i < 0) throw new Error(`No slide with id "${ref}". Use get_deck_outline to look up ids.`);
    return { slide: d.slides[i], index: i };
  };
  const findEl = (slide: DeckSlide, index: number, id: string) => { const e = slide.elements.find((x) => x.id === id); if (!e) throw new Error(`No element "${id}" on Slide ${index + 1}`); return e; };
  const label = (index: number) => `Slide ${index + 1}`;
  const context = () => ({ deckTitle: s.title, matter: ctx.matter?.name });

  /** Apply an op to the snapshot and register the proposal with its base fingerprints. */
  const commit = (op: SlidesOp, meta: { title: string; summary?: string; target?: string; targetLabel?: string; risk?: EditProposal["risk"] }): EditProposal => {
    if (ctx.mode !== "draft") throw new Error(`Editing is disabled in ${ctx.mode} mode.`);
    const base = baseFor(s.deck, op);
    const payload = { ...op, base } as SlidesOp & { base: typeof base };
    s.deck = applyOp(s.deck, payload);
    return ctx.propose({ kind: op.op, title: meta.title, summary: meta.summary, target: meta.target, targetLabel: meta.targetLabel, risk: meta.risk ?? "low", payload: payload as unknown as Record<string, unknown> });
  };

  /** Verify step: text-fit of the given elements after an edit; grow/shrink fixes are proposed automatically. */
  const verifyFit = (slideId: string, elementIds: string[], opts: { autoFix?: boolean } = {}) => {
    const out: { element_id: string; status: "fits" | "fixed" | "overflow"; fix?: string; needed?: number; available?: number }[] = [];
    for (const id of elementIds) {
      const i = deck().slides.findIndex((x) => x.id === slideId);
      const slide = deck().slides[i];
      const e = slide?.elements.find((x) => x.id === id);
      if (!e || (e.type !== "text" && e.type !== "shape") || !e.text?.trim()) continue;
      const plan = fitTextPlan(slide, e, theme());
      if (plan.action === "none") { out.push({ element_id: id, status: "fits" }); continue; }
      if (opts.autoFix !== false && plan.action !== "condense" && Object.keys(plan.patch).length) {
        commit({ op: "set_element", slideId, elementId: id, patch: plan.patch }, { title: `Fit text on ${label(i)}`, summary: `${plan.action === "grow" ? "Taller box" : plan.action === "shrink" ? `Font ${e.style.fontSize}→${plan.patch.style?.fontSize} pt` : `Taller box, font ${e.style.fontSize}→${plan.patch.style?.fontSize} pt`} so the text fits (was ~${plan.before.needed} lines in ${plan.before.available})`, target: `${slideId}/${id}`, targetLabel: label(i) });
        out.push({ element_id: id, status: "fixed", fix: plan.action });
      } else out.push({ element_id: id, status: "overflow", needed: plan.after.needed, available: plan.after.available, fix: `Still overflows at ${plan.minFont} pt: condense with rewrite_for_brevity (or split_slide).` });
    }
    return out;
  };

  const placeholderSummary = (e: DeckElement) => ({ id: e.id, role: e.role ?? e.type, ...(e.ooxml?.ph ? { ph: e.ooxml.ph } : {}), words: wordCount(e.text), ...(e.type === "text" && e.text?.trim() && estimateTextFit(e, theme()).overflow ? { overflow: true } : {}) });

  const slideSummary = (sl: DeckSlide, i: number) => {
    const body = slideBodyText(sl);
    const bullets = bulletLines(sl.elements.find((e) => e.role === "body" || e.role === "left")?.text);
    const overflow = sl.elements.filter((e) => e.type === "text" && e.text?.trim() && estimateTextFit(e, theme()).overflow).map((e) => e.id);
    return {
      index: i + 1, id: sl.id, layout: sl.layout, ...(sl.ooxml?.layoutName ? { pptx_layout: sl.ooxml.layoutName } : {}), ...(sl.section ? { section: sl.section } : {}), hidden: sl.hidden ?? false,
      title: slideTitle(sl), bullets: bullets.length, words: wordCount(body) + wordCount(slideTitle(sl)), longest_bullet_words: Math.max(0, ...bullets.map((b) => b.split(/\s+/).length)), has_notes: Boolean(sl.notes.trim()),
      elements: sl.elements.filter((e) => e.role !== "decor" && e.role !== "footer" && e.role !== "logo").map(placeholderSummary), overflow_elements: overflow,
    };
  };

  const slideDetail = (slide: DeckSlide, index: number) => ({
    index: index + 1, id: slide.id, layout: slide.layout, ...(slide.ooxml?.layoutName ? { pptx_layout: slide.ooxml.layoutName } : {}), hidden: slide.hidden ?? false, background: slide.background,
    elements: slide.elements.filter((e) => e.role !== "decor").map((e) => {
      const fit = (e.type === "text" || e.type === "shape") && e.text?.trim() ? estimateTextFit(e, theme()) : undefined;
      return { id: e.id, type: e.type, role: e.role, ...(e.ooxml?.ph ? { ph: e.ooxml.ph } : {}), x: e.x, y: e.y, w: e.w, h: e.h, ...(e.rotation ? { rotation: e.rotation } : {}), z: e.z, style: e.style, text: e.text, src: e.src, table: e.table ? { header: e.table.header, rows: e.table.rows } : undefined, chart: e.chart, shape: e.shape, ...(fit ? { fit: { needed_lines: fit.needed, available_lines: fit.available, overflow: fit.overflow } } : {}) };
    }),
    notes: slide.notes,
  });

  // ------------------------------------------------------------------ reads
  const get_deck_outline = defineTool<Record<string, never>>({
    name: "get_deck_outline",
    description: "Compact outline of the whole deck: every slide's index, id, layout (and source PowerPoint layout), section, title, placeholders with element ids and word counts, notes flag and overflow warnings. No geometry — read slides with get_slide / get_slides.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading deck outline",
    execute: () => ({ title: s.title, theme: theme().id, slide_count: deck().slides.length, imported: Boolean(pptx()), slides: deck().slides.map(slideSummary) }),
  });

  const get_slide = defineTool<{ slide_id: string }>({
    name: "get_slide",
    description: "Full content of one slide: every element with id, type, role, placeholder (type/idx for imported decks), position/size (px on a 1280×720 canvas), style (pt sizes), raw markdown-lite text, table/chart data, text-fit (needed vs available lines), and notes.",
    parameters: { type: "object", properties: { slide_id: { type: "string", description: "Slide id or 1-based slide number" } }, required: ["slide_id"] },
    label: (a) => `Reading slide ${a.slide_id}`,
    execute: ({ slide_id }) => {
      const { slide, index } = findSlide(slide_id);
      return { ...slideDetail(slide, index), rendered: renderSlide(deck(), slide, index), content: extractContent(slide) };
    },
  });

  const get_slides = defineTool<{ slide_ids: string[] }>({
    name: "get_slides",
    description: "Read several slides in one call (same shape as get_slide, without the rendered outline). Prefer this over repeated get_slide calls.",
    parameters: { type: "object", properties: { slide_ids: { type: "array", items: { type: "string" }, description: "Slide ids or 1-based numbers (max 12)" } }, required: ["slide_ids"] },
    label: (a) => `Reading ${a.slide_ids.length} slides`,
    execute: ({ slide_ids }) => ({ slides: slide_ids.slice(0, 12).map((r) => { try { const { slide, index } = findSlide(r); return slideDetail(slide, index); } catch (e) { return { ref: r, error: (e as Error).message }; } }) }),
  });

  const find_text = defineTool<{ query: string; include_notes?: boolean }>({
    name: "find_text",
    description: "Case-insensitive search across slide text (and optionally notes). Returns slide index/id, element id and the matching line.",
    parameters: { type: "object", properties: { query: { type: "string" }, include_notes: { type: "boolean" } }, required: ["query"] },
    label: (a) => `Searching "${preview(a.query, 40)}"`,
    execute: ({ query, include_notes }) => {
      const q = query.toLowerCase();
      const out: { slide: number; slide_id: string; element_id?: string; where: string; line: string }[] = [];
      deck().slides.forEach((sl, i) => {
        for (const e of sl.elements) {
          if ((e.type === "text" || e.type === "shape") && e.text) for (const line of plainText(e.text).split("\n")) if (line.toLowerCase().includes(q)) out.push({ slide: i + 1, slide_id: sl.id, element_id: e.id, where: e.role ?? e.type, line });
          if (e.type === "table" && e.table) for (const row of [e.table.header, ...e.table.rows]) if (row.join(" | ").toLowerCase().includes(q)) out.push({ slide: i + 1, slide_id: sl.id, element_id: e.id, where: "table", line: row.join(" | ") });
        }
        if (include_notes !== false && sl.notes.toLowerCase().includes(q)) out.push({ slide: i + 1, slide_id: sl.id, where: "notes", line: preview(sl.notes, 200) });
      });
      return { count: out.length, matches: out.slice(0, 60) };
    },
  });

  const get_theme = defineTool<Record<string, never>>({
    name: "get_theme",
    description: "Current theme (fonts, colors) plus the built-in themes and layouts.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading theme",
    execute: () => ({ current: theme(), themes: THEMES.map((t) => ({ id: t.id, name: t.name, fonts: t.fonts, colors: t.colors })), layouts: SLIDE_LAYOUTS.map((l) => ({ id: l, label: LAYOUT_LABEL[l] })), canvas: { w: SLIDE_W, h: SLIDE_H, units: "px; font sizes in pt" } }),
  });

  const get_layouts = defineTool<Record<string, never>>({
    name: "get_layouts",
    description: "Slide layouts available for add_slide_from_layout: the imported PowerPoint template's layouts (name, type, placeholders with type/idx) when the deck came from a .pptx, plus the built-in layouts.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading layouts",
    execute: () => ({
      pptx_layouts: (pptx()?.layouts ?? []).map((l) => ({ name: l.name, type: l.type, placeholders: l.placeholders.filter((p) => !["dt", "ftr", "sldNum"].includes(p.type)).map((p) => ({ type: p.type, idx: p.idx })) })),
      builtin_layouts: SLIDE_LAYOUTS.map((l) => ({ id: l, label: LAYOUT_LABEL[l] })),
    }),
  });

  const get_selection = defineTool<Record<string, never>>({
    name: "get_selection",
    description: "The slide and elements the user currently has selected in the editor.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading selection",
    execute: () => {
      if (!s.selection?.slideId) return { slide: null, note: "No selection." };
      const { slide, index } = findSlide(s.selection.slideId);
      return { slide: index + 1, slide_id: slide.id, element_ids: s.selection.elementIds, elements: slide.elements.filter((e) => s.selection?.elementIds.includes(e.id)).map((e) => ({ id: e.id, type: e.type, role: e.role, text: e.text })) };
    },
  });

  const get_comments = defineTool<{ include_resolved?: boolean }>({
    name: "get_comments",
    description: "Comments on the deck (anchored to slides).",
    parameters: { type: "object", properties: { include_resolved: { type: "boolean" } }, required: [] },
    label: () => "Reading comments",
    execute: ({ include_resolved }) => ({ comments: (s.comments ?? []).filter((c) => include_resolved || !c.resolved).map((c) => ({ ...c, slide: deck().slides.findIndex((x) => `slide:${x.id}` === c.anchor) + 1 })) }),
  });

  const check_consistency = defineTool<{ max_bullets?: number; max_words_per_bullet?: number }>({
    name: "check_consistency",
    description: "Deterministic deck lint: title/body font size, font family, alignment and position outliers against the deck's dominant style; text overflow; bullet density; out-of-bounds elements; missing titles; empty placeholders. Run it before finishing any edit.",
    parameters: { type: "object", properties: { max_bullets: { type: "integer" }, max_words_per_bullet: { type: "integer" } }, required: [] },
    label: () => "Checking consistency",
    execute: ({ max_bullets, max_words_per_bullet }) => {
      const { issues, norms } = checkConsistency(deck(), { maxBullets: max_bullets, maxWordsPerBullet: max_words_per_bullet });
      return { issue_count: issues.length, norms, issues: issues.slice(0, 80) };
    },
  });

  const check_text_fit = defineTool<{ slide_id?: string }>({
    name: "check_text_fit",
    description: "Deterministic text-fit check (greedy word wrap with per-glyph widths against the box height) for one slide or the whole deck. Lists every text box that overflows with needed vs available lines.",
    parameters: { type: "object", properties: { slide_id: { type: "string" } }, required: [] },
    label: () => "Checking text fit",
    execute: ({ slide_id }) => {
      const slides = slide_id ? [findSlide(slide_id)] : deck().slides.map((slide, index) => ({ slide, index }));
      const out = slides.flatMap(({ slide, index }) => slide.elements.filter((e) => (e.type === "text" || e.type === "shape") && e.text?.trim()).map((e) => ({ slide: index + 1, slide_id: slide.id, element_id: e.id, role: e.role, ...estimateTextFit(e, theme()) })).filter((x) => x.overflow));
      return { overflowing: out.length, elements: out.map(({ neededPx, availablePx, ...rest }) => { void neededPx; void availablePx; return rest; }) };
    },
  });

  // ------------------------------------------------------------------ review comments
  const add_review_comment = defineTool<{ slide_id: string; element_id?: string; comment: string; severity?: "info" | "low" | "medium" | "high" | "critical"; category?: string; suggestion?: string }>({
    name: "add_review_comment",
    description: "Review mode: attach a comment to a slide (optionally an element). Does not change the deck.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" }, comment: { type: "string" }, severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] }, category: { type: "string" }, suggestion: { type: "string" } }, required: ["slide_id", "comment"] },
    label: (a) => `Commenting on slide ${a.slide_id}`,
    execute: ({ slide_id, element_id, comment, severity, category, suggestion }) => {
      const { slide, index } = findSlide(slide_id);
      if (element_id) findEl(slide, index, element_id);
      const f = ctx.finding({ severity: severity ?? "low", category: category ?? "comment", title: preview(comment, 80), detail: comment, target: `slide:${slide.id}${element_id ? `/${element_id}` : ""}`, targetLabel: label(index), suggestion });
      return { recorded: f.id };
    },
  });

  // ------------------------------------------------------------------ slide creation
  const insertIndex = (after_id: string | undefined) => {
    const d = deck();
    let afterId: string | null;
    if (!after_id || after_id === "end") afterId = d.slides.at(-1)?.id ?? null;
    else if (after_id === "start") afterId = null;
    else afterId = findSlide(after_id).slide.id;
    return { afterId, index: afterId ? d.slides.findIndex((x) => x.id === afterId) + 1 : 0 };
  };
  const addSlideOp = (slide: DeckSlide, afterId: string | null, index: number, title: string) => {
    // add_slide inserts after afterId; "start" means before the first slide
    if (afterId === null && deck().slides.length) {
      commit({ op: "add_slide", afterId: deck().slides.at(-1)!.id, slide }, { title, summary: preview(slideBodyText(slide).replace(/\n/g, " · "), 220) || undefined, target: slide.id, targetLabel: `Slide ${index + 1}` });
      commit({ op: "reorder_slides", ids: [slide.id, ...deck().slides.filter((x) => x.id !== slide.id).map((x) => x.id)] }, { title: `Move new slide to the start`, target: slide.id, targetLabel: "Slide 1" });
    } else commit({ op: "add_slide", afterId, slide }, { title, summary: preview(slideBodyText(slide).replace(/\n/g, " · "), 220) || undefined, target: slide.id, targetLabel: `Slide ${index + 1}` });
  };
  const idsOf = (sl: DeckSlide) => sl.elements.filter((e) => e.role && e.role !== "decor" && e.role !== "footer").map((e) => ({ id: e.id, role: e.role }));

  const add_slide = defineTool<{ after_id?: string; layout: SlideLayout; title?: string; body_markdown?: string; subtitle?: string; notes?: string; kicker?: string; date?: string; number?: string; left_title?: string; left_markdown?: string; right_title?: string; right_markdown?: string; quote?: string; attribution?: string; caption?: string; image_url?: string; table?: { header: string[]; rows: string[][] }; chart?: { type: "bar" | "line" | "pie"; categories: string[]; series: { name: string; values: number[] }[]; title?: string; unit?: string }; timeline?: { date: string; label: string; detail?: string }[]; hidden?: boolean }>({
    name: "add_slide",
    description: "Insert a new slide built from a built-in layout with theme styling. after_id = slide id/number to insert after (omit or \"end\" = end of deck; \"start\" = beginning). Provide the placeholders the layout uses: bullets→title+body_markdown; two_column/comparison→left_*/right_*; timeline→timeline[]; chart→chart; table→table; quote→quote+attribution; image→image_url+caption; agenda→body_markdown bullets; section→title+subtitle+number; title→title+subtitle+kicker+date. For imported PowerPoint decks prefer add_slide_from_layout so the slide uses the template's own layout.",
    parameters: {
      type: "object",
      properties: {
        after_id: { type: "string" }, layout: { type: "string", enum: SLIDE_LAYOUTS }, title: { type: "string" }, body_markdown: { type: "string" }, subtitle: { type: "string" }, notes: { type: "string" }, kicker: { type: "string" }, date: { type: "string" }, number: { type: "string" },
        left_title: { type: "string" }, left_markdown: { type: "string" }, right_title: { type: "string" }, right_markdown: { type: "string" }, quote: { type: "string" }, attribution: { type: "string" }, caption: { type: "string" }, image_url: { type: "string" },
        table: { type: "object", properties: { header: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["header", "rows"] },
        chart: { type: "object", properties: { type: { type: "string", enum: ["bar", "line", "pie"] }, categories: { type: "array", items: { type: "string" } }, series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } }, title: { type: "string" }, unit: { type: "string" } }, required: ["type", "categories", "series"] },
        timeline: { type: "array", items: { type: "object", properties: { date: { type: "string" }, label: { type: "string" }, detail: { type: "string" } }, required: ["date", "label"] } },
        hidden: { type: "boolean" },
      },
      required: ["layout"],
    },
    label: (a) => `Adding ${LAYOUT_LABEL[a.layout] ?? a.layout} slide${a.title ? `: ${preview(a.title, 40)}` : ""}`,
    execute: (a) => {
      const content: SlideContent = { title: a.title, subtitle: a.subtitle, body: a.body_markdown, notes: a.notes, kicker: a.kicker, date: a.date, number: a.number, leftTitle: a.left_title, left: a.left_markdown, rightTitle: a.right_title, right: a.right_markdown, quote: a.quote, attribution: a.attribution, caption: a.caption, imageUrl: a.image_url, table: a.table, chart: a.chart ? { showLegend: a.chart.series.length > 1 || a.chart.type === "pie", showValues: true, ...a.chart } : undefined, timeline: a.timeline as TimelineItem[] | undefined };
      if (a.layout === "agenda" && a.body_markdown) content.agenda = bulletLines(a.body_markdown);
      const { afterId, index } = insertIndex(a.after_id);
      const slide = buildSlide(a.layout, content, theme(), { hidden: a.hidden, slideNumber: index + 1 });
      addSlideOp(slide, afterId, index, `Add slide ${index + 1}: ${preview(a.title ?? LAYOUT_LABEL[a.layout], 50)}`);
      return { added: { index: index + 1, id: slide.id, layout: slide.layout, element_ids: idsOf(slide) }, slide_count: deck().slides.length, verify: verifyFit(slide.id, slide.elements.map((e) => e.id)) };
    },
  });

  const add_slide_from_layout = defineTool<{ layout: string; after_id?: string; title?: string; subtitle?: string; body_markdown?: string; left_markdown?: string; right_markdown?: string; notes?: string }>({
    name: "add_slide_from_layout",
    description: "Insert a slide from one of the deck's layouts. For imported PowerPoint decks `layout` is a template layout name or type from get_layouts (e.g. \"Title and Content\", \"twoObj\"): the slide is linked to that layout and its placeholders are filled at the layout's positions, so it exports as a native slide of the template. For other decks `layout` is a built-in layout id.",
    parameters: { type: "object", properties: { layout: { type: "string" }, after_id: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" }, body_markdown: { type: "string" }, left_markdown: { type: "string" }, right_markdown: { type: "string" }, notes: { type: "string" } }, required: ["layout"] },
    label: (a) => `Adding slide from layout ${a.layout}`,
    execute: (a) => {
      const { afterId, index } = insertIndex(a.after_id);
      const meta = pptx();
      const pl = meta?.layouts.find((l) => l.name.toLowerCase() === a.layout.toLowerCase()) ?? meta?.layouts.find((l) => l.type === a.layout);
      if (!pl) {
        if (!(SLIDE_LAYOUTS as string[]).includes(a.layout)) throw new Error(`Unknown layout "${a.layout}". Use get_layouts.`);
        const slide = buildSlide(a.layout as SlideLayout, { title: a.title, subtitle: a.subtitle, body: a.body_markdown, left: a.left_markdown, right: a.right_markdown, notes: a.notes }, theme(), { slideNumber: index + 1 });
        addSlideOp(slide, afterId, index, `Add slide ${index + 1}: ${preview(a.title ?? LAYOUT_LABEL[a.layout as SlideLayout], 50)}`);
        return { added: { index: index + 1, id: slide.id, layout: slide.layout, element_ids: idsOf(slide) }, verify: verifyFit(slide.id, slide.elements.map((e) => e.id)) };
      }
      const map = meta!.map;
      const elements: DeckElement[] = [];
      const titleR = layoutRect(pl, (p) => p.type === "title" || p.type === "ctrTitle", map);
      const subR = layoutRect(pl, (p) => p.type === "subTitle", map);
      const bodies = pl.placeholders.filter((p) => (p.type === "body" || p.type === "obj") && p.emu).sort((x, y) => x.emu!.x - y.emu!.x);
      const bodyR = (i: number) => layoutRect(pl, (p) => p === bodies[i], map);
      const push = (role: PlaceholderRole, text: string | undefined, r: ReturnType<typeof layoutRect>, style: ElementStyle) => { if (text === undefined || !r) return; elements.push(makeElement({ type: "text", role, text, x: r.x, y: r.y, w: r.w, h: r.h, z: elements.length, style: { padding: 8, ...style } })); };
      push("title", a.title ?? "", titleR, { fontFamily: "heading", fontSize: pl.type === "title" ? 40 : 32, bold: true, color: "fg", valign: pl.type === "title" ? "bottom" : "middle", align: pl.type === "title" ? "center" : "left" });
      push("subtitle", a.subtitle, subR, { fontFamily: "body", fontSize: 22, color: "muted", align: "center", valign: "top" });
      if (bodies.length >= 2 && (a.left_markdown !== undefined || a.right_markdown !== undefined)) {
        push("left", a.left_markdown ?? "", bodyR(0), { fontFamily: "body", fontSize: 22, color: "fg", valign: "top", lineHeight: 1.25 });
        push("right", a.right_markdown ?? "", bodyR(1), { fontFamily: "body", fontSize: 22, color: "fg", valign: "top", lineHeight: 1.25 });
      } else push("body", a.body_markdown, bodyR(0), { fontFamily: "body", fontSize: 24, color: "fg", valign: "top", lineHeight: 1.25 });
      const slide: DeckSlide = { id: newSlideId(), layout: pl.type === "title" ? "title" : pl.type === "secHead" ? "section" : bodies.length >= 2 ? "two_column" : elements.some((e) => e.role === "body") ? "bullets" : "blank", elements, notes: a.notes ?? "", ooxml: { part: "", layoutPart: pl.part, layoutName: pl.name, fp: "", notes0: "", hidden0: false } };
      addSlideOp(slide, afterId, index, `Add slide ${index + 1} (${pl.name}): ${preview(a.title ?? "", 50)}`);
      return { added: { index: index + 1, id: slide.id, pptx_layout: pl.name, element_ids: idsOf(slide) }, verify: verifyFit(slide.id, slide.elements.map((e) => e.id)) };
    },
  });

  // ------------------------------------------------------------------ text edits
  const setText = (slide: DeckSlide, index: number, target: DeckElement, markdown: string, what: string) => {
    const before = plainText(target.text);
    commit({ op: "set_element", slideId: slide.id, elementId: target.id, patch: { text: markdown } }, { title: `${what} on ${label(index)}`, summary: `${preview(before.replace(/\n/g, " · "), 90) || "(empty)"}\n→ ${preview(plainText(markdown).replace(/\n/g, " · "), 160)}`, target: `${slide.id}/${target.id}`, targetLabel: label(index) });
    return verifyFit(slide.id, [target.id]);
  };
  const createPlaceholder = (slide: DeckSlide, index: number, role: PlaceholderRole, markdown: string) => {
    const imported = slide.ooxml?.layoutPart ? pptx()?.layouts.find((l) => l.part === slide.ooxml?.layoutPart) : undefined;
    const fromLayout = imported ? layoutRect(imported, (p) => (role === "title" ? p.type === "title" || p.type === "ctrTitle" : role === "subtitle" ? p.type === "subTitle" : p.type === "body" || p.type === "obj"), pptx()?.map) : undefined;
    const rect = fromLayout ?? (role === "title" ? { x: 72, y: 48, w: 1136, h: 92 } : role === "subtitle" ? { x: 72, y: 150, w: 1136, h: 60 } : role === "caption" ? { x: 72, y: 620, w: 1136, h: 40 } : role === "right" ? { x: 660, y: 168, w: 548, h: 480 } : role === "left" ? { x: 72, y: 168, w: 548, h: 480 } : { x: 72, y: 168, w: 1136, h: 480 });
    const style: ElementStyle = role === "title" ? { fontFamily: "heading", fontSize: 34, bold: true, color: "fg", valign: "middle", padding: 8 } : role === "caption" ? { fontSize: 13, color: "muted", padding: 8 } : { fontFamily: "body", fontSize: 22, color: "fg", valign: "top", lineHeight: 1.3, padding: 8 };
    const element = makeElement({ type: "text", role, text: markdown, x: rect.x, y: rect.y, w: rect.w, h: rect.h, style, z: slide.elements.length });
    commit({ op: "add_element", slideId: slide.id, element }, { title: `Add ${role} to ${label(index)}`, summary: preview(plainText(markdown), 160), target: `${slide.id}/${element.id}`, targetLabel: label(index) });
    return { created: element.id, role, verify: verifyFit(slide.id, [element.id]) };
  };

  const set_slide_text = defineTool<{ slide_id: string; element_id?: string; placeholder?: PlaceholderRole; markdown: string }>({
    name: "set_slide_text",
    description: "Replace the text of a text element (by element_id) or of a placeholder role (title | subtitle | body | left | right | leftTitle | rightTitle | quote | attribution | caption | kicker | date | number). Markdown-lite. If the placeholder does not exist on the slide, a text box is created for it. The result includes a text-fit verification.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" }, placeholder: { type: "string", enum: PLACEHOLDERS }, markdown: { type: "string" } }, required: ["slide_id", "markdown"] },
    label: (a) => `Editing ${a.placeholder ?? "text"} on slide ${a.slide_id}`,
    execute: ({ slide_id, element_id, placeholder, markdown }) => {
      const { slide, index } = findSlide(slide_id);
      let target = element_id ? findEl(slide, index, element_id) : undefined;
      if (!target && placeholder) target = slide.elements.find((e) => e.type === "text" && e.role === placeholder);
      if (!target && !placeholder) throw new Error("Provide element_id or placeholder");
      if (target && target.type !== "text" && target.type !== "shape") throw new Error(`Element ${target.id} is a ${target.type}, not text`);
      if (target) {
        const verify = setText(slide, index, target, markdown, placeholder ?? target.role ?? "Text");
        const overflow = verify.find((v) => v.status === "overflow");
        return { updated: target.id, overflow: overflow ? `Text needs ~${overflow.needed} lines but the box fits ${overflow.available}; condense with rewrite_for_brevity or split_slide` : false, verify };
      }
      return createPlaceholder(slide, index, placeholder!, markdown);
    },
  });

  const set_placeholder_text = defineTool<{ slide_id: string; placeholder: string; markdown: string }>({
    name: "set_placeholder_text",
    description: "Fill a placeholder by role (title, subtitle, body, left, right, caption…) or, for imported PowerPoint slides, by placeholder type/idx as \"type:title\" / \"idx:2\". Creates the placeholder at the layout's position when the slide lacks it. Result includes text-fit verification.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, placeholder: { type: "string" }, markdown: { type: "string" } }, required: ["slide_id", "placeholder", "markdown"] },
    label: (a) => `Filling ${a.placeholder} on slide ${a.slide_id}`,
    execute: ({ slide_id, placeholder, markdown }) => {
      const { slide, index } = findSlide(slide_id);
      const m = /^(type|idx):(.+)$/.exec(placeholder);
      const target = m
        ? slide.elements.find((e) => e.ooxml?.ph && (m[1] === "idx" ? e.ooxml.ph.idx === m[2] : (e.ooxml.ph.type ?? "obj") === m[2] || (m[2] === "title" && e.ooxml.ph.type === "ctrTitle")))
        : slide.elements.find((e) => (e.type === "text" || e.type === "shape") && e.role === placeholder);
      if (target) return { updated: target.id, verify: setText(slide, index, target, markdown, placeholder) };
      const role = (m ? (m[2] === "title" || m[2] === "ctrTitle" ? "title" : m[2] === "subTitle" ? "subtitle" : "body") : placeholder) as PlaceholderRole;
      if (!PLACEHOLDERS.includes(role)) throw new Error(`Unknown placeholder "${placeholder}"`);
      return createPlaceholder(slide, index, role, markdown);
    },
  });

  const rewrite_for_brevity = defineTool<{ slide_id: string; element_id: string; max_words?: number; max_bullets?: number; instruction?: string }>({
    name: "rewrite_for_brevity",
    description: "Rewrite one text box shorter with the fast model (≤ max_bullets bullets of ≤ max_words words; meaning, defined terms, cites, Bates numbers, dates and figures preserved), then verify it fits the box. Use for overflow or dense slides.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" }, max_words: { type: "integer" }, max_bullets: { type: "integer" }, instruction: { type: "string" } }, required: ["slide_id", "element_id"] },
    label: (a) => `Tightening text on slide ${a.slide_id}`,
    timeoutMs: 60_000,
    execute: async ({ slide_id, element_id, max_words, max_bullets, instruction }) => {
      const { slide, index } = findSlide(slide_id);
      const e = findEl(slide, index, element_id);
      if (!e.text?.trim()) throw new Error("The element has no text");
      const limits = { maxWords: max_words ?? 12, maxBullets: max_bullets ?? 5 };
      if (!deps.rewriteText) return { changed: false, needs_rewrite: { slide_id: slide.id, element_id, text: e.text, ...limits }, instruction: "Model rewrite unavailable; rewrite it yourself with set_slide_text within the limits." };
      ctx.emit({ type: "status", message: `Tightening ${label(index)}…` });
      const next = (await deps.rewriteText({ markdown: e.text, ...limits, instruction }, context())).trim();
      if (!next || next === e.text) return { changed: false, note: "Already concise." };
      const verify = setText(slide, index, e, next, "Tighten text");
      return { changed: true, words_before: wordCount(e.text), words_after: wordCount(next), verify };
    },
  });

  const fit_text = defineTool<{ slide_id: string; element_id?: string; strategy?: "auto" | "grow" | "shrink" | "condense"; min_font?: number }>({
    name: "fit_text",
    description: "Make overflowing text fit its box (deterministic text-fit estimate). auto: grow the box into free space below, then shrink the font to a floor (titles 24 pt, body 14 pt), then condense with the fast model if it still overflows. Omit element_id to fix every overflowing box on the slide.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" }, strategy: { type: "string", enum: ["auto", "grow", "shrink", "condense"] }, min_font: { type: "number" } }, required: ["slide_id"] },
    label: (a) => `Fitting text on slide ${a.slide_id}`,
    timeoutMs: 60_000,
    execute: async ({ slide_id, element_id, strategy, min_font }) => {
      const { slide, index } = findSlide(slide_id);
      const targets = element_id ? [findEl(slide, index, element_id)] : slide.elements.filter((e) => (e.type === "text" || e.type === "shape") && e.text?.trim() && estimateTextFit(e, theme()).overflow);
      const results: unknown[] = [];
      for (const t of targets) {
        const cur = deck().slides[index].elements.find((x) => x.id === t.id)!;
        const st = strategy ?? "auto";
        const plan = st === "condense" ? null : fitTextPlan(deck().slides[index], cur, theme(), { minFont: min_font, allowGrow: st !== "shrink", allowShrink: st !== "grow" });
        if (plan && plan.action === "none") { results.push({ element_id: t.id, status: "fits" }); continue; }
        if (plan && Object.keys(plan.patch).length) commit({ op: "set_element", slideId: slide.id, elementId: t.id, patch: plan.patch }, { title: `Fit text on ${label(index)}`, summary: `${plan.action}: ~${plan.before.needed}→${plan.after.needed} lines in ${plan.after.available}`, target: `${slide.id}/${t.id}`, targetLabel: label(index) });
        if (plan && plan.action !== "condense") { results.push({ element_id: t.id, status: "fixed", action: plan.action, patch: plan.patch }); continue; }
        if (!deps.rewriteText) { results.push({ element_id: t.id, status: "overflow", fix: "Condense the text with set_slide_text (model rewrite unavailable)." }); continue; }
        const now = deck().slides[index].elements.find((x) => x.id === t.id)!;
        const fitNow = estimateTextFit(now, theme());
        const budget = Math.max(3, Math.floor(wordCount(now.text) * (fitNow.available / Math.max(1, fitNow.needed)) * 0.9));
        const next = (await deps.rewriteText({ markdown: now.text ?? "", maxWords: 12, maxBullets: 6, instruction: `Keep the whole text under ${budget} words so it fits the box.` }, context())).trim();
        if (next && next !== now.text) { const verify = setText(deck().slides[index], index, now, next, "Condense to fit"); results.push({ element_id: t.id, status: verify[0]?.status ?? "fixed", action: "condense", words_after: wordCount(next) }); }
        else results.push({ element_id: t.id, status: "overflow" });
      }
      return { results };
    },
  });

  const set_notes = defineTool<{ slide_id: string; text: string }>({
    name: "set_notes",
    description: "Set the speaker notes of a slide (plain text; replaces existing notes).",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, text: { type: "string" } }, required: ["slide_id", "text"] },
    label: (a) => `Writing notes for slide ${a.slide_id}`,
    execute: ({ slide_id, text }) => {
      const { slide, index } = findSlide(slide_id);
      commit({ op: "set_slide", slideId: slide.id, patch: { notes: text } }, { title: `Speaker notes for ${label(index)}`, summary: preview(text, 200), target: slide.id, targetLabel: label(index) });
      return { ok: true };
    },
  });

  const templateNotes = (sl: DeckSlide, i: number) => {
    const next = deck().slides[i + 1];
    const bullets = bulletLines(slideBodyText(sl)).slice(0, 4);
    return [`${slideTitle(sl) || `Slide ${i + 1}`}.`, bullets.length ? `Walk through: ${bullets.join("; ")}.` : "", next ? `Transition: "${slideTitle(next)}".` : "Close and invite questions."].filter(Boolean).join(" ");
  };

  const add_speaker_notes = defineTool<{ slide_id: string; style?: string; overwrite?: boolean }>({
    name: "add_speaker_notes",
    description: "Generate speaker notes for one slide from its content (fast model; presenter-facing, what to emphasize, which cite to read aloud, transition). Keeps existing notes unless overwrite=true.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, style: { type: "string" }, overwrite: { type: "boolean" } }, required: ["slide_id"] },
    label: (a) => `Drafting notes for slide ${a.slide_id}`,
    timeoutMs: 60_000,
    execute: async ({ slide_id, style, overwrite }) => {
      const { slide, index } = findSlide(slide_id);
      if (slide.notes.trim() && !overwrite) return { changed: false, note: "Slide already has notes (pass overwrite=true to replace)." };
      let notes = templateNotes(slide, index), by = "template";
      if (deps.generateNotes) {
        const r = await deps.generateNotes([{ id: slide.id, index: index + 1, title: slideTitle(slide), body: slideBodyText(slide), layout: slide.layout }], style ?? "concise, presenter-facing", context());
        if (r[0]?.notes?.trim()) { notes = r[0].notes.trim(); by = "model"; }
      }
      commit({ op: "set_slide", slideId: slide.id, patch: { notes } }, { title: `Speaker notes for ${label(index)}`, summary: preview(notes, 200), target: slide.id, targetLabel: label(index) });
      return { changed: true, generated_by: by, words: wordCount(notes) };
    },
  });

  const update_slide = defineTool<{ slide_id: string; hidden?: boolean; transition?: "none" | "fade" | "push" | "wipe"; name?: string; background_color?: string }>({
    name: "update_slide",
    description: "Slide-level settings: hide/unhide, transition, internal name, background color (hex or theme token bg|surface|accent).",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, hidden: { type: "boolean" }, transition: { type: "string", enum: ["none", "fade", "push", "wipe"] }, name: { type: "string" }, background_color: { type: "string" } }, required: ["slide_id"] },
    label: (a) => `Updating slide ${a.slide_id}`,
    execute: ({ slide_id, hidden, transition, name, background_color }) => {
      const { slide, index } = findSlide(slide_id);
      const patch: SlidesOp & { op: "set_slide" } = { op: "set_slide", slideId: slide.id, patch: {} };
      if (hidden !== undefined) patch.patch.hidden = hidden;
      if (transition !== undefined) patch.patch.transition = transition;
      if (name !== undefined) patch.patch.name = name;
      if (background_color !== undefined) patch.patch.background = { ...(slide.background ?? {}), color: background_color };
      commit(patch, { title: `Update ${label(index)} settings`, summary: Object.entries(patch.patch).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", "), target: slide.id, targetLabel: label(index) });
      return { ok: true };
    },
  });

  // ------------------------------------------------------------------ structure
  const reorder_slides = defineTool<{ ids_in_order: string[] }>({
    name: "reorder_slides",
    description: "Reorder the deck. Give every slide id (or number) in the desired order; slides omitted keep their relative order at the end.",
    parameters: { type: "object", properties: { ids_in_order: { type: "array", items: { type: "string" } } }, required: ["ids_in_order"] },
    label: () => "Reordering slides",
    execute: ({ ids_in_order }) => {
      const ids = ids_in_order.map((r) => findSlide(r).slide.id);
      if (new Set(ids).size !== ids.length) throw new Error("ids_in_order lists a slide twice");
      commit({ op: "reorder_slides", ids }, { title: "Reorder slides", summary: ids.map((id) => `${deck().slides.findIndex((x) => x.id === id) + 1}`).join(" → "), risk: "medium" });
      return { order: deck().slides.map((x, i) => ({ index: i + 1, id: x.id, title: slideTitle(x) })) };
    },
  });

  const move_slide = defineTool<{ slide_id: string; after_id?: string }>({
    name: "move_slide",
    description: "Move one slide after another (after_id = slide id/number, \"start\" to make it first).",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, after_id: { type: "string" } }, required: ["slide_id"] },
    label: (a) => `Moving slide ${a.slide_id}`,
    execute: ({ slide_id, after_id }) => {
      const { slide, index } = findSlide(slide_id);
      const rest = deck().slides.filter((x) => x.id !== slide.id);
      const at = !after_id || after_id === "start" ? 0 : rest.findIndex((x) => x.id === findSlide(after_id).slide.id) + 1;
      rest.splice(at, 0, slide);
      commit({ op: "reorder_slides", ids: rest.map((x) => x.id) }, { title: `Move ${label(index)} to position ${at + 1}`, target: slide.id, targetLabel: `Slide ${at + 1}` });
      return { new_index: at + 1 };
    },
  });

  const delete_slide = defineTool<{ slide_id: string }>({
    name: "delete_slide",
    description: "Delete a slide.",
    parameters: { type: "object", properties: { slide_id: { type: "string" } }, required: ["slide_id"] },
    label: (a) => `Deleting slide ${a.slide_id}`,
    execute: ({ slide_id }) => {
      const { slide, index } = findSlide(slide_id);
      commit({ op: "delete_slide", slideId: slide.id }, { title: `Delete ${label(index)}: ${preview(slideTitle(slide), 50)}`, target: slide.id, targetLabel: label(index), risk: "medium" });
      return { deleted: slide.id, slide_count: deck().slides.length };
    },
  });

  const duplicate_slide = defineTool<{ slide_id: string }>({
    name: "duplicate_slide",
    description: "Duplicate a slide (inserted right after it). Returns the new slide id and element ids so you can edit the copy.",
    parameters: { type: "object", properties: { slide_id: { type: "string" } }, required: ["slide_id"] },
    label: (a) => `Duplicating slide ${a.slide_id}`,
    execute: ({ slide_id }) => {
      const { slide, index } = findSlide(slide_id);
      const copy = cloneSlide(slide);
      commit({ op: "duplicate_slide", slideId: slide.id, slide: copy }, { title: `Duplicate ${label(index)}`, target: copy.id, targetLabel: `Slide ${index + 2}` });
      return { new_slide_id: copy.id, index: index + 2, elements: copy.elements.filter((e) => e.role && e.role !== "decor").map((e) => ({ id: e.id, role: e.role, type: e.type })) };
    },
  });

  const apply_theme = defineTool<{ theme_id: string }>({
    name: "apply_theme",
    description: "Switch the deck to a built-in theme (fonts + palette). Elements use theme color tokens so everything restyles; imported decks get their theme part rewritten on export. Ids: " + THEMES.map((t) => `${t.id} (${t.name})`).join(", "),
    parameters: { type: "object", properties: { theme_id: { type: "string", enum: THEMES.map((t) => t.id) } }, required: ["theme_id"] },
    label: (a) => `Applying theme ${a.theme_id}`,
    execute: ({ theme_id }) => {
      const t = THEMES.find((x) => x.id === theme_id);
      if (!t) throw new Error(`Unknown theme ${theme_id}`);
      commit({ op: "apply_theme", theme: t }, { title: `Apply theme: ${t.name}`, summary: `${t.fonts.heading} / ${t.fonts.body}; accent ${t.colors.accent}` });
      for (const sl of deck().slides) if (sl.layout === "title" && sl.background?.color && sl.background.color !== t.titleBg && !sl.ooxml) commit({ op: "set_slide", slideId: sl.id, patch: { background: { color: t.titleBg ?? t.colors.accent } } }, { title: `Title background for ${label(deck().slides.indexOf(sl))}`, target: sl.id });
      return { theme: t.id };
    },
  });

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const restyle_deck = defineTool<{ theme_id?: string; colors?: { accent?: string; accent2?: string; fg?: string; bg?: string; muted?: string; surface?: string }; fonts?: { heading?: string; body?: string } }>({
    name: "restyle_deck",
    description: "Restyle the whole deck by changing theme colors and/or fonts (optionally starting from a built-in theme). Colors are hex (#RRGGBB) for the slots accent, accent2, fg (text), bg (background), muted, surface; fonts heading/body are font face names. Every element using theme tokens follows; imported PowerPoint decks get their theme part (color + font scheme) rewritten on export.",
    parameters: { type: "object", properties: { theme_id: { type: "string", enum: THEMES.map((t) => t.id) }, colors: { type: "object", properties: { accent: { type: "string" }, accent2: { type: "string" }, fg: { type: "string" }, bg: { type: "string" }, muted: { type: "string" }, surface: { type: "string" } }, required: [] }, fonts: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } }, required: [] } }, required: [] },
    label: () => "Restyling deck",
    execute: ({ theme_id, colors, fonts }) => {
      const start: DeckTheme = theme_id ? { ...getTheme(theme_id) } : { ...theme(), colors: { ...theme().colors }, fonts: { ...theme().fonts } };
      for (const [k, v] of Object.entries(colors ?? {})) { if (v === undefined || v === null || v === "") continue; if (!HEX.test(v)) throw new Error(`colors.${k} must be #RRGGBB`); (start.colors as Record<string, string>)[k] = v.toUpperCase(); }
      if (fonts?.heading) start.fonts.heading = fonts.heading;
      if (fonts?.body) start.fonts.body = fonts.body;
      const next: DeckTheme = { ...start, id: theme().id.startsWith("pptx-") && !theme_id ? theme().id : `${start.id.replace(/-custom$/, "")}${colors || fonts ? "-custom" : ""}`, name: colors || fonts ? `${start.name} (custom)` : start.name };
      commit({ op: "apply_theme", theme: next }, { title: `Restyle deck: ${next.name}`, summary: `${next.fonts.heading} / ${next.fonts.body}; accent ${next.colors.accent}, accent2 ${next.colors.accent2}`, risk: "medium" });
      return { theme: { id: next.id, fonts: next.fonts, colors: next.colors }, imported_theme_part_rewritten_on_export: Boolean(pptx()) };
    },
  });

  const set_layout = defineTool<{ slide_id: string; layout: SlideLayout }>({
    name: "set_layout",
    description: "Apply a different built-in layout to a slide; existing text is re-flowed into the new placeholders (bullets ↔ columns, items ↔ timeline, etc.). User-added images/shapes are kept.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, layout: { type: "string", enum: SLIDE_LAYOUTS } }, required: ["slide_id", "layout"] },
    label: (a) => `Applying ${LAYOUT_LABEL[a.layout] ?? a.layout} layout`,
    execute: ({ slide_id, layout }) => {
      const { slide, index } = findSlide(slide_id);
      const next = applyLayout(slide, layout, theme(), index + 1);
      commit({ op: "replace_slide", slideId: slide.id, slide: next }, { title: `${label(index)}: layout → ${LAYOUT_LABEL[layout]}`, target: slide.id, targetLabel: label(index), risk: "medium" });
      return { slide_id: slide.id, layout, elements: next.elements.filter((e) => e.role && e.role !== "decor").map((e) => ({ id: e.id, role: e.role, type: e.type })) };
    },
  });

  // ------------------------------------------------------------------ inserts
  const matterOf = () => deps.data?.matterId() ?? null;
  const authorizeBlob = (blobId: string) => {
    const data = deps.data;
    if (!data) throw new Error("Library/matter images are unavailable here");
    const b = data.blob(blobId);
    if (!b) throw new Error(`No file ${blobId}`);
    if (!b.mime.startsWith("image/")) throw new Error(`File ${blobId} is not an image (${b.mime})`);
    const matter = matterOf();
    const ok = (b.matterId && b.matterId === matter) || data.libraryLinksBlob(blobId, matter);
    if (!ok) throw new Error(`Not authorized: file ${blobId} does not belong to this deck's matter or the firm library`);
    return `/api/blobs/${b.id}`;
  };

  const insert_image = defineTool<{ slide_id: string; prompt?: string; url?: string; blob_id?: string; library_item_id?: string; alt?: string; x?: number; y?: number; w?: number; h?: number; fit?: "contain" | "cover" }>({
    name: "insert_image",
    description: "Insert an image on a slide. Give one of: library_item_id (an image in the matter's or firm's library), blob_id (a matter file), url (public http(s) image), or prompt (generated illustration — for demonstratives only, never as evidence). Position/size in px (defaults: right half of the body area).",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, prompt: { type: "string" }, url: { type: "string" }, blob_id: { type: "string" }, library_item_id: { type: "string" }, alt: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, fit: { type: "string", enum: ["contain", "cover"] } }, required: ["slide_id"] },
    label: (a) => (a.prompt ? `Generating image: ${preview(a.prompt, 40)}` : "Inserting image"),
    timeoutMs: 90_000,
    execute: async ({ slide_id, prompt, url, blob_id, library_item_id, alt, x, y, w, h, fit }) => {
      const { slide, index } = findSlide(slide_id);
      let src: string | undefined;
      let name = "Image";
      if (library_item_id) {
        const item = deps.data?.libraryItem(library_item_id);
        if (!item) throw new Error(`No library item ${library_item_id}`);
        const matter = matterOf();
        if (!((item.matterId && item.matterId === matter) || (!item.matterId && (item.sharedWith ?? []).includes("firm")))) throw new Error(`Not authorized: library item ${library_item_id} belongs to another matter`);
        const m = /^\/api\/blobs\/([A-Za-z0-9_-]+)/.exec(item.url ?? "");
        if (!m) throw new Error(`Library item ${library_item_id} is not an image file`);
        src = authorizeBlob(m[1]); name = item.name; alt = alt ?? item.name;
      } else if (blob_id) src = authorizeBlob(blob_id);
      else if (url) {
        const m = /^\/api\/blobs\/([A-Za-z0-9_-]+)/.exec(url);
        if (m) src = authorizeBlob(m[1]);
        else if (/^https:\/\//i.test(url)) src = url;
        else throw new Error("url must be https:// or a matter file (/api/blobs/…)");
      }
      let generated = false;
      if (!src && prompt) {
        if (!deps.generateImage) throw new Error("Image generation is not available (OpenAI key required)");
        ctx.emit({ type: "status", message: "Generating image…" });
        const width = w ?? 560, height = h ?? 420;
        const r = await deps.generateImage(prompt, width > height * 1.2 ? "1536x1024" : height > width * 1.2 ? "1024x1536" : "1024x1024");
        src = r.url; generated = true; name = "Generated image";
      }
      if (!src) throw new Error("Provide library_item_id, blob_id, url or prompt");
      const body = slide.elements.find((e) => e.role === "body" && e.text?.trim());
      const rect = { x: x ?? (body ? 660 : 72), y: y ?? 168, w: w ?? (body ? 548 : 1136), h: h ?? 460 };
      const element = clampToSlide(makeElement({ type: "image", src, alt: alt ?? prompt ?? "Image", ...rect, style: { fit: fit ?? "contain", radius: 8 }, z: slide.elements.length, name }));
      commit({ op: "add_element", slideId: slide.id, element }, { title: `Insert image on ${label(index)}`, summary: generated ? `Generated: ${preview(prompt ?? "", 120)}` : `${name}: ${src}`, target: `${slide.id}/${element.id}`, targetLabel: label(index) });
      if (body && body.w > 600 && x === undefined) {
        commit({ op: "set_element", slideId: slide.id, elementId: body.id, patch: { w: 548 } }, { title: `Narrow body text on ${label(index)} to make room`, target: `${slide.id}/${body.id}`, targetLabel: label(index) });
        return { element_id: element.id, src, verify: verifyFit(slide.id, [body.id]) };
      }
      return { element_id: element.id, src };
    },
  });

  const insert_chart = defineTool<{ slide_id: string; type: "bar" | "line" | "pie"; categories: string[]; series: { name: string; values: number[] }[]; title?: string; unit?: string; show_values?: boolean; x?: number; y?: number; w?: number; h?: number }>({
    name: "insert_chart",
    description: "Insert a chart (bar | line | pie) from data: categories and one or more numeric series. Rendered natively in the editor and exported as a native PowerPoint chart. Use only figures from the record; mark unverified numbers in the title/caption with [VERIFY].",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, type: { type: "string", enum: ["bar", "line", "pie"] }, categories: { type: "array", items: { type: "string" } }, series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } }, title: { type: "string" }, unit: { type: "string" }, show_values: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["slide_id", "type", "categories", "series"] },
    label: (a) => `Inserting ${a.type} chart`,
    execute: ({ slide_id, type, categories, series, title, unit, show_values, x, y, w, h }) => {
      const { slide, index } = findSlide(slide_id);
      if (!categories.length || !series.length) throw new Error("categories and series must not be empty");
      const bad = series.find((sr) => sr.values.length !== categories.length);
      if (bad) throw new Error(`Series "${bad.name}" has ${bad.values.length} values for ${categories.length} categories`);
      const chart: ChartSpec = { type, categories, series: series.map((sr) => ({ name: sr.name, values: sr.values.map((v) => Number(v) || 0) })), title, unit, showLegend: series.length > 1 || type === "pie", showValues: show_values ?? true };
      const hasBody = slide.elements.some((e) => e.role === "body" && e.text?.trim());
      const element = clampToSlide(makeElement({ type: "chart", chart, x: x ?? (hasBody ? 660 : 72), y: y ?? 168, w: w ?? (hasBody ? 548 : 1136), h: h ?? 460, style: { fill: "surface", radius: 12, padding: 16 }, z: slide.elements.length, name: "Chart" }));
      commit({ op: "add_element", slideId: slide.id, element }, { title: `Insert ${type} chart on ${label(index)}`, summary: `${title ?? ""} ${categories.join(", ")}`.trim(), target: `${slide.id}/${element.id}`, targetLabel: label(index) });
      return { element_id: element.id };
    },
  });

  const insert_table = defineTool<{ slide_id: string; header: string[]; rows: string[][]; merges?: { row: number; col: number; row_span?: number; col_span?: number }[]; x?: number; y?: number; w?: number; h?: number; font_size?: number }>({
    name: "insert_table",
    description: "Insert a table (header row + rows; ≤ 8 rows × 5 columns per slide for legibility). merges: cells spanning rows/columns (row 0 = header, 0-based). Use Bates numbers / dates in cells where relevant.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, header: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } }, merges: { type: "array", items: { type: "object", properties: { row: { type: "integer" }, col: { type: "integer" }, row_span: { type: "integer" }, col_span: { type: "integer" } }, required: ["row", "col"] } }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, font_size: { type: "number" } }, required: ["slide_id", "header", "rows"] },
    label: () => "Inserting table",
    execute: ({ slide_id, header, rows, merges, x, y, w, h, font_size }) => {
      const { slide, index } = findSlide(slide_id);
      const table = { header, rows: rows.map((r) => header.map((_, i) => r[i] ?? "")) } as DeckElement["table"] & object;
      if (merges?.length) {
        const grid: TableCell[][] = [table.header, ...table.rows].map((r) => r.map((t) => ({ text: t })));
        for (const m of merges) {
          const rs = Math.max(1, m.row_span ?? 1), cs = Math.max(1, m.col_span ?? 1);
          if (m.row < 0 || m.col < 0 || m.row + rs > grid.length || m.col + cs > header.length) throw new Error(`Merge at row ${m.row}, col ${m.col} is outside the table`);
          const cell = grid[m.row][m.col];
          if (cs > 1) cell.gridSpan = cs;
          if (rs > 1) cell.rowSpan = rs;
          for (let r = m.row; r < m.row + rs; r++) for (let c = m.col; c < m.col + cs; c++) { if (r === m.row && c === m.col) continue; if (c > m.col) grid[r][c].hMerge = true; if (r > m.row) grid[r][c].vMerge = true; }
        }
        table.cells = grid;
      }
      const element = clampToSlide(makeElement({ type: "table", table, x: x ?? 72, y: y ?? 168, w: w ?? 1136, h: h ?? Math.min(480, 44 + rows.length * 40), style: { fontSize: font_size ?? (rows.length > 8 ? 12 : 14), color: "fg", headerFill: "accent", headerColor: "bg", stroke: "muted", banded: true }, z: slide.elements.length, name: "Table" }));
      commit({ op: "add_element", slideId: slide.id, element }, { title: `Insert table on ${label(index)}`, summary: `${header.join(" | ")} (${rows.length} rows)`, target: `${slide.id}/${element.id}`, targetLabel: label(index) });
      return { element_id: element.id };
    },
  });

  const insert_shape = defineTool<{ slide_id: string; shape: ShapeKind; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; text?: string; text_color?: string; font_size?: number; radius?: number }>({
    name: "insert_shape",
    description: "Insert a shape (rect | ellipse | arrow | line) with optional fill/stroke (hex or theme token accent|accent2|muted|surface|fg|bg) and optional label text.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, shape: { type: "string", enum: ["rect", "ellipse", "arrow", "line"] }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, fill: { type: "string" }, stroke: { type: "string" }, text: { type: "string" }, text_color: { type: "string" }, font_size: { type: "number" }, radius: { type: "number" } }, required: ["slide_id", "shape", "x", "y", "w", "h"] },
    label: (a) => `Inserting ${a.shape}`,
    execute: ({ slide_id, shape, x, y, w, h, fill, stroke, text, text_color, font_size, radius }) => {
      const { slide, index } = findSlide(slide_id);
      const element = clampToSlide(shape === "line"
        ? makeElement({ type: "line", x, y, w, h, style: { stroke: stroke ?? "accent", strokeWidth: 3, lineDir: "down" }, z: slide.elements.length, name: "Line" })
        : makeElement({ type: "shape", shape, x, y, w, h, text, style: { fill: fill ?? "accent", stroke, radius: radius ?? (shape === "rect" ? 8 : undefined), color: text_color ?? "bg", fontSize: font_size ?? 16, align: "center", valign: "middle", bold: true }, z: slide.elements.length, name: shape[0].toUpperCase() + shape.slice(1) }));
      commit({ op: "add_element", slideId: slide.id, element }, { title: `Insert ${shape} on ${label(index)}`, summary: text, target: `${slide.id}/${element.id}`, targetLabel: label(index) });
      return { element_id: element.id, verify: text ? verifyFit(slide.id, [element.id], { autoFix: false }) : undefined };
    },
  });

  const update_element = defineTool<{ slide_id: string; element_id: string; x?: number; y?: number; w?: number; h?: number; rotation?: number; text?: string; style?: ElementStyle; src?: string; z?: number }>({
    name: "update_element",
    description: "Fine-grained element edit: move/resize (px), rotate, replace text, change style (fontSize pt, fontFamily heading|body|face, bold, italic, color, align, valign, fill, stroke, radius, opacity, lineHeight, fit), image src (https or a matter file), z-order.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, rotation: { type: "number" }, text: { type: "string" }, src: { type: "string" }, z: { type: "number" }, style: { type: "object", properties: { fontSize: { type: "number" }, fontFamily: { type: "string" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color: { type: "string" }, align: { type: "string", enum: ["left", "center", "right"] }, valign: { type: "string", enum: ["top", "middle", "bottom"] }, fill: { type: "string" }, stroke: { type: "string" }, strokeWidth: { type: "number" }, radius: { type: "number" }, opacity: { type: "number" }, lineHeight: { type: "number" }, fit: { type: "string", enum: ["contain", "cover", "fill"] } }, required: [] } }, required: ["slide_id", "element_id"] },
    label: (a) => `Updating element ${a.element_id}`,
    execute: ({ slide_id, element_id, style, src, ...rest }) => {
      const { slide, index } = findSlide(slide_id);
      const cur = findEl(slide, index, element_id);
      const patch: Partial<DeckElement> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) (patch as Record<string, unknown>)[k] = v;
      if (src !== undefined && src !== null) { const m = /^\/api\/blobs\/([A-Za-z0-9_-]+)/.exec(src); patch.src = m ? authorizeBlob(m[1]) : /^https:\/\//i.test(src) ? src : (() => { throw new Error("src must be https:// or a matter file"); })(); }
      if (style) patch.style = { ...cur.style, ...Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== null)) };
      const clamped = clampToSlide({ ...cur, ...patch });
      if (patch.x !== undefined) patch.x = clamped.x; if (patch.y !== undefined) patch.y = clamped.y; if (patch.w !== undefined) patch.w = clamped.w; if (patch.h !== undefined) patch.h = clamped.h;
      commit({ op: "set_element", slideId: slide.id, elementId: element_id, patch }, { title: `Update ${cur.role ?? cur.type} on ${label(index)}`, summary: Object.keys(patch).map((k) => (k === "style" ? `style: ${Object.keys(style ?? {}).join(", ")}` : `${k}: ${JSON.stringify((patch as Record<string, unknown>)[k]).slice(0, 60)}`)).join("; "), target: `${slide.id}/${element_id}`, targetLabel: label(index) });
      const textish = patch.text !== undefined || patch.w !== undefined || patch.h !== undefined || style?.fontSize !== undefined;
      return { ok: true, verify: textish ? verifyFit(slide.id, [element_id], { autoFix: false }) : undefined };
    },
  });

  const remove_element = defineTool<{ slide_id: string; element_id: string }>({
    name: "remove_element",
    description: "Remove an element from a slide.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" } }, required: ["slide_id", "element_id"] },
    label: (a) => `Removing element ${a.element_id}`,
    execute: ({ slide_id, element_id }) => {
      const { slide, index } = findSlide(slide_id);
      const cur = findEl(slide, index, element_id);
      commit({ op: "remove_element", slideId: slide.id, elementId: element_id }, { title: `Remove ${cur.role ?? cur.type} from ${label(index)}`, target: slide.id, targetLabel: label(index) });
      return { ok: true };
    },
  });

  const restyle_slide = defineTool<{ slide_id: string; goals?: string[] }>({
    name: "restyle_slide",
    description: "Normalize a slide's hierarchy, sizes and spacing: rebuilds it on its built-in layout grid with theme styles and auto-fits text. Goals (free text) such as \"fix hierarchy\", \"shrink to fit\", \"more whitespace\" steer it. On imported PowerPoint slides this replaces the template shapes — prefer fit_text / update_element there.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, goals: { type: "array", items: { type: "string" } } }, required: ["slide_id"] },
    label: (a) => `Restyling slide ${a.slide_id}`,
    execute: ({ slide_id, goals }) => {
      const { slide, index } = findSlide(slide_id);
      const next = restyleSlide(slide, theme(), goals ?? []);
      commit({ op: "replace_slide", slideId: slide.id, slide: next }, { title: `Restyle ${label(index)}`, summary: (goals ?? []).join(", ") || "Rebuilt on the layout grid; text auto-fitted", target: slide.id, targetLabel: label(index), risk: slide.ooxml ? "medium" : "low" });
      return { slide_id: slide.id, elements: next.elements.filter((e) => e.type === "text" && e.role && e.role !== "decor").map((e) => ({ id: e.id, role: e.role, fontSize: e.style.fontSize })) };
    },
  });

  const split_slide = defineTool<{ slide_id: string }>({
    name: "split_slide",
    description: "Split an overloaded slide into two: the first half of the bullets stays, the rest moves to a new \"(cont.)\" slide right after.",
    parameters: { type: "object", properties: { slide_id: { type: "string" } }, required: ["slide_id"] },
    label: (a) => `Splitting slide ${a.slide_id}`,
    execute: ({ slide_id }) => {
      const { slide, index } = findSlide(slide_id);
      const [a, b] = splitSlide(slide, theme());
      if (!bulletLines(b.elements.find((e) => e.role === "body")?.text).length) throw new Error("Not enough bullets to split");
      commit({ op: "replace_slide_with", slideId: slide.id, slides: [a, b] }, { title: `Split ${label(index)} into two`, summary: `${preview(slideTitle(a), 40)} / ${preview(slideTitle(b), 40)}`, target: slide.id, targetLabel: label(index), risk: "medium" });
      return { slides: [{ id: a.id, index: index + 1 }, { id: b.id, index: index + 2 }] };
    },
  });

  const condense_deck = defineTool<{ goals?: string[]; max_bullets?: number; max_words_per_bullet?: number; slide_ids?: string[] }>({
    name: "condense_deck",
    description: "Tighten every text slide (or the given slide_ids) to at most max_bullets bullets of at most max_words_per_bullet words each, preserving meaning, cites and defined terms. Uses the fast model when available; otherwise reports which slides exceed the limits so you can rewrite them with set_slide_text.",
    parameters: { type: "object", properties: { goals: { type: "array", items: { type: "string" } }, max_bullets: { type: "integer" }, max_words_per_bullet: { type: "integer" }, slide_ids: { type: "array", items: { type: "string" } } }, required: [] },
    label: () => "Condensing deck",
    timeoutMs: 120_000,
    execute: async ({ goals, max_bullets, max_words_per_bullet, slide_ids }) => {
      const limits = { maxBullets: max_bullets ?? 5, maxWords: max_words_per_bullet ?? 12 };
      const targets = (slide_ids?.length ? slide_ids.map((r) => findSlide(r).slide) : deck().slides).filter((sl) => sl.elements.some((e) => e.type === "text" && (e.role === "body" || e.role === "left" || e.role === "right") && e.text?.trim()));
      const offending = targets.map((sl) => { const body = sl.elements.find((e) => (e.role === "body" || e.role === "left") && e.text?.trim())!; const bl = bulletLines(body.text); const tooMany = bl.length > limits.maxBullets; const tooLong = bl.filter((b) => b.split(/\s+/).length > limits.maxWords); return { sl, body, tooMany, tooLong, bullets: bl.length }; }).filter((x) => x.tooMany || x.tooLong.length);
      if (!offending.length) return { changed: 0, note: "Every slide is already within the limits." };
      if (!deps.condenseSlides) return { changed: 0, needs_rewrite: offending.map((o) => ({ slide: deck().slides.findIndex((x) => x.id === o.sl.id) + 1, slide_id: o.sl.id, element_id: o.body.id, bullets: o.bullets, long_bullets: o.tooLong })), instruction: `Model-based condensing unavailable; rewrite each listed element with set_slide_text (≤${limits.maxBullets} bullets, ≤${limits.maxWords} words each).` };
      ctx.emit({ type: "status", message: `Condensing ${offending.length} slide${offending.length === 1 ? "" : "s"}…` });
      const rewrites = await deps.condenseSlides(offending.map((o) => ({ id: o.sl.id, title: slideTitle(o.sl), body: o.body.text ?? "" })), goals ?? [], limits, context());
      let changed = 0;
      for (const r of rewrites) {
        const o = offending.find((x) => x.sl.id === r.id);
        if (!o || !r.body.trim() || r.body === o.body.text) continue;
        const index = deck().slides.findIndex((x) => x.id === o.sl.id);
        commit({ op: "set_element", slideId: o.sl.id, elementId: o.body.id, patch: { text: r.body } }, { title: `Condense ${label(index)}`, summary: preview(plainText(r.body).replace(/\n/g, " · "), 200), target: `${o.sl.id}/${o.body.id}`, targetLabel: label(index) });
        changed++;
        if (r.title && r.title !== slideTitle(o.sl)) { const t = deck().slides[index].elements.find((e) => e.role === "title"); if (t) commit({ op: "set_element", slideId: o.sl.id, elementId: t.id, patch: { text: r.title } }, { title: `Retitle ${label(index)}`, summary: r.title, target: `${o.sl.id}/${t.id}`, targetLabel: label(index) }); }
      }
      return { changed, limits };
    },
  });

  // ------------------------------------------------------------------ whole-deck builders
  const addSlides = (slides: DeckSlide[], replace: boolean, t: DeckTheme | undefined, what: string) => {
    if (replace) commit({ op: "replace_deck", slides, theme: t }, { title: `${what} (${slides.length} slides)`, summary: slides.map((sl, i) => `${i + 1}. ${slideTitle(sl)}`).join("\n"), risk: deck().slides.length ? "high" : "low" });
    else {
      let afterId: string | null = deck().slides.at(-1)?.id ?? null;
      for (const sl of slides) { const i = deck().slides.length; commit({ op: "add_slide", afterId, slide: sl }, { title: `Add slide ${i + 1}: ${preview(slideTitle(sl), 50)}`, target: sl.id, targetLabel: `Slide ${i + 1}` }); afterId = sl.id; }
      if (t) commit({ op: "apply_theme", theme: t }, { title: `Apply theme: ${t.name}` });
    }
    const offset = replace ? 0 : deck().slides.length - slides.length;
    return slides.map((sl, i) => ({ index: offset + i + 1, id: sl.id, layout: sl.layout, title: slideTitle(sl), overflow: sl.elements.filter((e) => e.type === "text" && e.text?.trim() && estimateTextFit(e, deck().theme).overflow).map((e) => e.id) }));
  };

  const generate_deck = defineTool<{ outline_markdown: string; replace?: boolean; theme_id?: string }>({
    name: "generate_deck",
    description: `Build a whole deck from the outline DSL (one slide per "# Title" block). Grammar per slide: "layout: <id>" (optional; inferred), "subtitle:", "kicker:", "date:", "number:", "caption:", "image: url", bullets "- …" / "  - …", "left: Heading" + bullets, "right: Heading" + bullets, "quote: …" + "by: …", "chart: bar | Cat1, Cat2 | Series A: 1, 2 | Series B: 3, 4", pipe tables "| h1 | h2 |", "timeline:" followed by "- 2024-03-01 — Event — detail" lines, and "notes: …" (rest of block). replace=true replaces the current slides (default when the deck is empty), otherwise slides are appended.`,
    parameters: { type: "object", properties: { outline_markdown: { type: "string" }, replace: { type: "boolean" }, theme_id: { type: "string", enum: THEMES.map((t) => t.id) } }, required: ["outline_markdown"] },
    label: () => "Building deck from outline",
    execute: ({ outline_markdown, replace, theme_id }) => {
      const t = theme_id ? getTheme(theme_id) : theme();
      const { slides } = parseOutline(outline_markdown, t);
      if (!slides.length) throw new Error("Outline produced no slides — start each slide with \"# Title\"");
      const out = addSlides(slides, replace ?? deck().slides.length === 0, theme_id ? t : undefined, "Generate deck");
      return { slides: out, outline: deckToOutline(slides).slice(0, 4000) };
    },
  });

  const outline_to_deck = defineTool<{ outline: string; replace?: boolean; theme_id?: string }>({
    name: "outline_to_deck",
    description: "Turn a plain outline (markdown headings, or numbered/unindented lines, each followed by bullets) into slides, choosing each slide's layout deterministically: opening → title, agenda heading → agenda, dated bullets → timeline, 'label: number' lines → chart, pipe rows → table, two labelled groups (Pros/Cons, Ours/Theirs, Plaintiffs/Defense…) or 'X vs Y' → comparison, a quoted line → quote, heading only → section, > 7 bullets → two columns, else bullets. Returns the layout and the reason for each slide.",
    parameters: { type: "object", properties: { outline: { type: "string" }, replace: { type: "boolean" }, theme_id: { type: "string", enum: THEMES.map((t) => t.id) } }, required: ["outline"] },
    label: () => "Building slides from outline",
    execute: ({ outline, replace, theme_id }) => {
      const t = theme_id ? getTheme(theme_id) : theme();
      const { slides, plans } = outlineToSlides(outline, t);
      if (!slides.length) throw new Error("The outline has no slides");
      const out = addSlides(slides, replace ?? deck().slides.length === 0, theme_id ? t : undefined, "Outline to deck");
      return { slides: out.map((o, i) => ({ ...o, reason: plans[i].reason })) };
    },
  });

  const deck_from_document = defineTool<{ doc_id?: string; library_item_id?: string; markdown?: string; title?: string; replace?: boolean; max_bullets_per_slide?: number }>({
    name: "deck_from_document",
    description: "Build slides from a Word document (doc_id of a Word doc in this deck's matter or the firm library), a library note/research memo (library_item_id) or pasted markdown: headings become slides, list items and first sentences become bullets quoted from the source (not paraphrased), then layouts are chosen as in outline_to_deck. Condense afterwards with condense_deck / rewrite_for_brevity if needed.",
    parameters: { type: "object", properties: { doc_id: { type: "string" }, library_item_id: { type: "string" }, markdown: { type: "string" }, title: { type: "string" }, replace: { type: "boolean" }, max_bullets_per_slide: { type: "integer" } }, required: [] },
    label: () => "Building slides from document",
    execute: ({ doc_id, library_item_id, markdown, title, replace, max_bullets_per_slide }) => {
      const matter = matterOf();
      let outline: string;
      let source: string;
      if (doc_id) {
        const doc = deps.data?.officeDoc(doc_id);
        if (!doc) throw new Error(`No document ${doc_id}`);
        if (doc.matterId && doc.matterId !== matter) throw new Error(`Not authorized: document ${doc_id} belongs to another matter`);
        if (doc.kind !== "word") throw new Error(`Document ${doc_id} is a ${doc.kind} file; use a Word document or memo`);
        outline = documentOutline({ tiptap: doc.content, title: title ?? doc.title }, { maxBulletsPerSlide: max_bullets_per_slide });
        source = `Word: ${doc.title}`;
      } else if (library_item_id) {
        const item = deps.data?.libraryItem(library_item_id);
        if (!item) throw new Error(`No library item ${library_item_id}`);
        if (!((item.matterId && item.matterId === matter) || (!item.matterId && (item.sharedWith ?? []).includes("firm")))) throw new Error(`Not authorized: library item ${library_item_id} belongs to another matter`);
        if (!item.content?.trim()) throw new Error(`Library item ${library_item_id} has no text content`);
        outline = documentOutline({ markdown: item.content, title: title ?? item.name }, { maxBulletsPerSlide: max_bullets_per_slide });
        source = `Library: ${item.name}`;
      } else if (markdown?.trim()) {
        outline = documentOutline({ markdown, title }, { maxBulletsPerSlide: max_bullets_per_slide });
        source = "pasted text";
      } else throw new Error("Provide doc_id, library_item_id or markdown");
      const { slides, plans } = outlineToSlides(outline, theme());
      if (!slides.length) throw new Error("The document has no headings or text to turn into slides");
      if (slides[0]) slides[0].notes = `${slides[0].notes ? `${slides[0].notes}\n` : ""}Source: ${source}. Bullets are quoted from the source; verify before presenting.`;
      const out = addSlides(slides, replace ?? deck().slides.length === 0, undefined, "Deck from document");
      return { source, slides: out.map((o, i) => ({ ...o, reason: plans[i].reason })) };
    },
  });

  const timeline_slide = defineTool<{ after_id?: string; title?: string; from?: string; to?: string; max_events?: number }>({
    name: "timeline_slide",
    description: "Insert a timeline slide built from this deck's matter chronology (highest-significance events in the date range, oldest first), each with its Bates/cite; unverified or unsourced events are marked [VERIFY] and every event's sources go into the speaker notes.",
    parameters: { type: "object", properties: { after_id: { type: "string" }, title: { type: "string" }, from: { type: "string", description: "ISO date lower bound" }, to: { type: "string", description: "ISO date upper bound" }, max_events: { type: "integer" } }, required: [] },
    label: () => "Building timeline from the chronology",
    execute: ({ after_id, title, from, to, max_events }) => {
      const matter = matterOf();
      if (!deps.data || !matter) throw new Error("This deck is not linked to a matter, so there is no chronology to draw from");
      const events = deps.data.timeline(matter);
      if (!events.length) throw new Error("The matter chronology has no events");
      const { afterId, index } = insertIndex(after_id);
      const { slide, used, unverified } = timelineSlide(events, theme(), { title, from, to, max: max_events, slideNumber: index + 1 });
      if (!used.length) throw new Error("No chronology events fall in that date range");
      addSlideOp(slide, afterId, index, `Add timeline (${used.length} events)`);
      return { added: { index: index + 1, id: slide.id }, events: used.map((e) => ({ id: e.id, date: e.date, title: e.title, cite: e.sources.find((x) => x.bates)?.bates ?? e.sources.find((x) => x.cite)?.cite ?? null })), unverified };
    },
  });

  const exhibit_slide = defineTool<{ bates: string; after_id?: string; title?: string; quote?: string; exhibit_label?: string }>({
    name: "exhibit_slide",
    description: "Insert an exhibit callout slide for one document of this deck's matter, resolved by exact Bates number: title, Bates badge, date/custodian/type, a quote (verified verbatim against the document text; unverified quotes are flagged) or the labelled AI summary, and a source reference line. An unresolved Bates number is an error — never substitute another document.",
    parameters: { type: "object", properties: { bates: { type: "string" }, after_id: { type: "string" }, title: { type: "string" }, quote: { type: "string" }, exhibit_label: { type: "string", description: "e.g. \"PX-12\"" } }, required: ["bates"] },
    label: (a) => `Building exhibit slide for ${a.bates}`,
    execute: ({ bates, after_id, title, quote, exhibit_label }) => {
      const matter = matterOf();
      if (!deps.data || !matter) throw new Error("This deck is not linked to a matter, so Bates numbers cannot be resolved");
      const doc = deps.data.exhibitByBates(matter, bates.trim());
      if (!doc) throw new Error(`Bates ${bates} is not in this matter's record (unresolved — no document was substituted). Check the number with search_ediscovery.`);
      const { afterId, index } = insertIndex(after_id);
      const { slide, quoteVerified } = exhibitSlide(doc, theme(), { title, quote, exhibitLabel: exhibit_label, slideNumber: index + 1 });
      addSlideOp(slide, afterId, index, `Add exhibit slide ${doc.bates}`);
      return { added: { index: index + 1, id: slide.id }, document: { id: doc.id, bates: doc.bates, date: doc.date, subject: doc.subject }, quote: quote ? (quoteVerified ? "verified" : "not_found_in_document") : "none", verify: verifyFit(slide.id, slide.elements.map((e) => e.id)) };
    },
  });

  const add_speaker_notes_all = defineTool<{ style?: string; overwrite?: boolean }>({
    name: "add_speaker_notes_all",
    description: "Write speaker notes for every slide that lacks them (overwrite=true rewrites all). Style e.g. \"conversational, 60 seconds per slide, flag the cites to read aloud\".",
    parameters: { type: "object", properties: { style: { type: "string" }, overwrite: { type: "boolean" } }, required: [] },
    label: () => "Writing speaker notes",
    timeoutMs: 120_000,
    execute: async ({ style, overwrite }) => {
      const targets = deck().slides.map((sl, i) => ({ sl, i })).filter(({ sl }) => overwrite || !sl.notes.trim());
      if (!targets.length) return { changed: 0, note: "Every slide already has notes." };
      let notes: { id: string; notes: string }[];
      if (deps.generateNotes) {
        ctx.emit({ type: "status", message: `Drafting notes for ${targets.length} slides…` });
        notes = await deps.generateNotes(targets.map(({ sl, i }) => ({ id: sl.id, index: i + 1, title: slideTitle(sl), body: slideBodyText(sl), layout: sl.layout })), style ?? "concise, presenter-facing", context());
      } else notes = targets.map(({ sl, i }) => ({ id: sl.id, notes: templateNotes(sl, i) }));
      let changed = 0;
      for (const n of notes) { const i = deck().slides.findIndex((x) => x.id === n.id); if (i < 0 || !n.notes.trim()) continue; commit({ op: "set_slide", slideId: n.id, patch: { notes: n.notes } }, { title: `Speaker notes for ${label(i)}`, summary: preview(n.notes, 160), target: n.id, targetLabel: label(i) }); changed++; }
      return { changed, generated_by: deps.generateNotes ? "model" : "template" };
    },
  });

  const all = [
    get_deck_outline, get_slide, get_slides, find_text, get_theme, get_layouts, get_selection, get_comments, check_consistency, check_text_fit,
    add_review_comment,
    add_slide, add_slide_from_layout, set_slide_text, set_placeholder_text, rewrite_for_brevity, fit_text, set_notes, add_speaker_notes, add_speaker_notes_all, update_slide,
    reorder_slides, move_slide, delete_slide, duplicate_slide, apply_theme, restyle_deck, set_layout,
    insert_image, insert_chart, insert_table, insert_shape, update_element, remove_element, restyle_slide, split_slide, condense_deck,
    generate_deck, outline_to_deck, deck_from_document, timeline_slide, exhibit_slide,
  ] as unknown as ToolDef<never, unknown>[];
  const allowed = ctx.mode === "ask" ? SLIDES_READ_TOOLS : ctx.mode === "review" ? SLIDES_REVIEW_TOOLS : null;
  return allowed ? all.filter((t) => allowed.has(t.name)) : all.filter((t) => t.name !== "add_review_comment");
}
