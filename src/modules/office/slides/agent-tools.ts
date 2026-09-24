/**
 * Slides agent tools. Read tools answer from the snapshot deck; edit tools
 * apply an operation to the snapshot (so later reads see the new state) AND
 * register the same operation as an EditProposal the user can apply in the
 * editor. Side-effecting dependencies (image generation, model-based
 * condensing / notes) are injected so the tools stay testable.
 */
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import { applyLayout, buildSlide, deckToOutline, extractContent, parseOutline, restyleSlide, splitSlide, type SlideContent, type TimelineItem } from "./layouts";
import {
  LAYOUT_LABEL, SLIDE_H, SLIDE_LAYOUTS, SLIDE_W, THEMES, bulletLines, clampToSlide, cloneSlide, estimateTextFit, getTheme, makeElement, plainText, slideBodyText, slideTitle, wordCount,
  type ChartSpec, type DeckElement, type DeckSlide, type ElementStyle, type PlaceholderRole, type ShapeKind, type SlideLayout,
} from "./model";
import { applyOp, type SlidesOp } from "./proposals";
import { renderSlide, type SlidesSnapshot } from "./snapshot";

export interface SlidesToolDeps {
  generateImage?: (prompt: string, size: "1024x1024" | "1536x1024" | "1024x1536") => Promise<{ url: string; blobId?: string }>;
  condenseSlides?: (slides: { id: string; title: string; body: string }[], goals: string[], limits: { maxBullets: number; maxWords: number }, context: { deckTitle: string; matter?: string }) => Promise<{ id: string; title?: string; body: string }[]>;
  generateNotes?: (slides: { id: string; index: number; title: string; body: string; layout: string }[], style: string, context: { deckTitle: string; matter?: string }) => Promise<{ id: string; notes: string }[]>;
}

type Ctx = OfficeAgentContext<SlidesSnapshot>;

const PLACEHOLDERS: PlaceholderRole[] = ["title", "subtitle", "body", "left", "right", "leftTitle", "rightTitle", "quote", "attribution", "caption", "kicker", "date", "number"];

export function isSlidesEditingTool(name: string) {
  return !/^(get_|find_text$)/.test(name);
}

function preview(t: string, n = 140) { return t.length > n ? `${t.slice(0, n)}…` : t; }

export function slidesAgentTools(ctx: Ctx, deps: SlidesToolDeps = {}): ToolDef<never, unknown>[] {
  const s = ctx.snapshot;
  const deck = () => s.deck;
  const theme = () => s.deck.theme;

  const findSlide = (ref: string | number | undefined): { slide: DeckSlide; index: number } => {
    const d = deck();
    if (ref === undefined || ref === null || ref === "") { if (s.selection?.slideId) { const i = d.slides.findIndex((x) => x.id === s.selection?.slideId); if (i >= 0) return { slide: d.slides[i], index: i }; } throw new Error("slide_id is required (use get_deck_outline for ids)"); }
    const asNum = typeof ref === "number" ? ref : /^\d+$/.test(String(ref)) ? Number(ref) : NaN;
    if (!Number.isNaN(asNum)) { const i = asNum - 1; if (!d.slides[i]) throw new Error(`No slide number ${asNum} (deck has ${d.slides.length})`); return { slide: d.slides[i], index: i }; }
    const i = d.slides.findIndex((x) => x.id === ref);
    if (i < 0) throw new Error(`No slide with id "${ref}". Use get_deck_outline to look up ids.`);
    return { slide: d.slides[i], index: i };
  };

  const label = (index: number) => `Slide ${index + 1}`;

  /** Apply an op to the snapshot and register the proposal. */
  const commit = (op: SlidesOp, meta: { title: string; summary?: string; target?: string; targetLabel?: string; risk?: EditProposal["risk"] }): EditProposal => {
    s.deck = applyOp(s.deck, op);
    return ctx.propose({ kind: op.op, title: meta.title, summary: meta.summary, target: meta.target, targetLabel: meta.targetLabel, risk: meta.risk ?? "low", payload: op as unknown as Record<string, unknown> });
  };

  const slideSummary = (sl: DeckSlide, i: number) => {
    const body = slideBodyText(sl);
    const bullets = bulletLines(sl.elements.find((e) => e.role === "body" || e.role === "left")?.text);
    const overflow = sl.elements.filter((e) => e.type === "text" && e.text?.trim() && estimateTextFit(e, theme()).overflow).map((e) => e.id);
    return { index: i + 1, id: sl.id, layout: sl.layout, hidden: sl.hidden ?? false, title: slideTitle(sl), bullets: bullets.length, words: wordCount(body) + wordCount(slideTitle(sl)), longest_bullet_words: Math.max(0, ...bullets.map((b) => b.split(/\s+/).length)), has_notes: Boolean(sl.notes.trim()), elements: sl.elements.filter((e) => e.role !== "decor" && e.role !== "footer" && e.role !== "logo").map((e) => ({ id: e.id, type: e.type, role: e.role })), overflow_elements: overflow };
  };

  // ------------------------------------------------------------------ reads
  const get_deck_outline = defineTool<Record<string, never>>({
    name: "get_deck_outline",
    description: "Outline of the whole deck: every slide with index, id, layout, title, bullet/word counts, notes flag, element ids and overflow warnings. Use slide ids (or 1-based numbers) in every other tool.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading deck outline",
    execute: () => ({ title: s.title, theme: theme().id, slide_count: deck().slides.length, slides: deck().slides.map(slideSummary) }),
  });

  const get_slide = defineTool<{ slide_id: string }>({
    name: "get_slide",
    description: "Full content of one slide: every element with id, type, role, position/size (px on a 1280×720 canvas), style (pt sizes), raw markdown-lite text, table/chart data, notes and overflow warnings.",
    parameters: { type: "object", properties: { slide_id: { type: "string", description: "Slide id or 1-based slide number" } }, required: ["slide_id"] },
    label: (a) => `Reading slide ${a.slide_id}`,
    execute: ({ slide_id }) => {
      const { slide, index } = findSlide(slide_id);
      return { index: index + 1, id: slide.id, layout: slide.layout, hidden: slide.hidden ?? false, background: slide.background, rendered: renderSlide(deck(), slide, index), elements: slide.elements.filter((e) => e.role !== "decor").map((e) => ({ id: e.id, type: e.type, role: e.role, x: e.x, y: e.y, w: e.w, h: e.h, z: e.z, style: e.style, text: e.text, src: e.src, table: e.table, chart: e.chart, shape: e.shape })), notes: slide.notes, content: extractContent(slide) };
    },
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
          if (e.type === "text" && e.text) for (const line of plainText(e.text).split("\n")) if (line.toLowerCase().includes(q)) out.push({ slide: i + 1, slide_id: sl.id, element_id: e.id, where: e.role ?? "text", line });
          if (e.type === "table" && e.table) for (const row of [e.table.header, ...e.table.rows]) if (row.join(" | ").toLowerCase().includes(q)) out.push({ slide: i + 1, slide_id: sl.id, element_id: e.id, where: "table", line: row.join(" | ") });
        }
        if (include_notes !== false && sl.notes.toLowerCase().includes(q)) out.push({ slide: i + 1, slide_id: sl.id, where: "notes", line: preview(sl.notes, 200) });
      });
      return { count: out.length, matches: out.slice(0, 60) };
    },
  });

  const get_theme = defineTool<Record<string, never>>({
    name: "get_theme",
    description: "Current theme (fonts, colors) plus the available themes and layouts.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading theme",
    execute: () => ({ current: theme(), themes: THEMES.map((t) => ({ id: t.id, name: t.name, fonts: t.fonts, colors: t.colors })), layouts: SLIDE_LAYOUTS.map((l) => ({ id: l, label: LAYOUT_LABEL[l] })), canvas: { w: SLIDE_W, h: SLIDE_H, units: "px; font sizes in pt" } }),
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

  // ------------------------------------------------------------------ edits
  const add_slide = defineTool<{ after_id?: string; layout: SlideLayout; title?: string; body_markdown?: string; subtitle?: string; notes?: string; kicker?: string; date?: string; number?: string; left_title?: string; left_markdown?: string; right_title?: string; right_markdown?: string; quote?: string; attribution?: string; caption?: string; image_url?: string; table?: { header: string[]; rows: string[][] }; chart?: { type: "bar" | "line" | "pie"; categories: string[]; series: { name: string; values: number[] }[]; title?: string; unit?: string }; timeline?: { date: string; label: string; detail?: string }[]; hidden?: boolean }>({
    name: "add_slide",
    description: "Insert a new slide built from a layout with theme styling. after_id = slide id/number to insert after (omit or \"end\" = end of deck; \"start\" = beginning). Provide the placeholders the layout uses: bullets→title+body_markdown; two_column/comparison→left_*/right_*; timeline→timeline[]; chart→chart; table→table; quote→quote+attribution; image→image_url+caption; agenda→body_markdown bullets; section→title+subtitle+number; title→title+subtitle+kicker+date. Body markdown-lite: \"- bullet\", \"  - sub-bullet\", **bold**.",
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
      const d = deck();
      let afterId: string | null;
      if (!a.after_id || a.after_id === "end") afterId = d.slides.at(-1)?.id ?? null;
      else if (a.after_id === "start") afterId = null;
      else afterId = findSlide(a.after_id).slide.id;
      const index = afterId ? d.slides.findIndex((x) => x.id === afterId) + 1 : 0;
      const slide = buildSlide(a.layout, content, theme(), { hidden: a.hidden, slideNumber: index + 1 });
      commit({ op: "add_slide", afterId, slide }, { title: `Add slide ${index + 1}: ${preview(a.title ?? LAYOUT_LABEL[a.layout], 50)}`, summary: preview(slideBodyText(slide).replace(/\n/g, " · "), 220) || undefined, target: slide.id, targetLabel: `Slide ${index + 1}` });
      return { added: { index: index + 1, id: slide.id, layout: slide.layout, element_ids: slide.elements.filter((e) => e.role && e.role !== "decor").map((e) => ({ id: e.id, role: e.role })) }, slide_count: deck().slides.length };
    },
  });

  const set_slide_text = defineTool<{ slide_id: string; element_id?: string; placeholder?: PlaceholderRole; markdown: string }>({
    name: "set_slide_text",
    description: "Replace the text of a text element (by element_id) or of a placeholder role (title | subtitle | body | left | right | leftTitle | rightTitle | quote | attribution | caption | kicker | date | number). Markdown-lite. If the placeholder does not exist on the slide, a text box is created for it.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" }, placeholder: { type: "string", enum: PLACEHOLDERS }, markdown: { type: "string" } }, required: ["slide_id", "markdown"] },
    label: (a) => `Editing ${a.placeholder ?? "text"} on slide ${a.slide_id}`,
    execute: ({ slide_id, element_id, placeholder, markdown }) => {
      const { slide, index } = findSlide(slide_id);
      let target = element_id ? slide.elements.find((e) => e.id === element_id) : undefined;
      if (element_id && !target) throw new Error(`No element "${element_id}" on ${label(index)}`);
      if (!target && placeholder) target = slide.elements.find((e) => e.type === "text" && e.role === placeholder);
      if (!target && !placeholder) throw new Error("Provide element_id or placeholder");
      if (target && target.type !== "text") throw new Error(`Element ${target.id} is a ${target.type}, not text`);
      if (target) {
        const before = plainText(target.text);
        commit({ op: "set_element", slideId: slide.id, elementId: target.id, patch: { text: markdown } }, { title: `${placeholder ?? target.role ?? "Text"} on ${label(index)}`, summary: `${preview(before.replace(/\n/g, " · "), 90) || "(empty)"}\n→ ${preview(plainText(markdown).replace(/\n/g, " · "), 160)}`, target: `${slide.id}/${target.id}`, targetLabel: label(index) });
        const fit = estimateTextFit({ ...target, text: markdown }, theme());
        return { updated: target.id, overflow: fit.overflow ? `Text needs ~${fit.needed} lines but the box fits ${fit.available}; consider split_slide or restyle_slide` : false };
      }
      // create the placeholder
      const rect = placeholder === "title" ? { x: 72, y: 48, w: 1136, h: 92 } : placeholder === "subtitle" ? { x: 72, y: 150, w: 1136, h: 60 } : placeholder === "caption" ? { x: 72, y: 620, w: 1136, h: 40 } : placeholder === "right" ? { x: 660, y: 168, w: 548, h: 480 } : placeholder === "left" ? { x: 72, y: 168, w: 548, h: 480 } : { x: 72, y: 168, w: 1136, h: 480 };
      const style: ElementStyle = placeholder === "title" ? { fontFamily: "heading", fontSize: 34, bold: true, color: "fg", valign: "middle", padding: 8 } : placeholder === "caption" ? { fontSize: 13, color: "muted", padding: 8 } : { fontFamily: "body", fontSize: 22, color: "fg", valign: "top", lineHeight: 1.3, padding: 8 };
      const element = makeElement({ type: "text", role: placeholder, text: markdown, ...rect, style, z: slide.elements.length });
      commit({ op: "add_element", slideId: slide.id, element }, { title: `Add ${placeholder} to ${label(index)}`, summary: preview(plainText(markdown), 160), target: `${slide.id}/${element.id}`, targetLabel: label(index) });
      return { created: element.id, role: placeholder };
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

  const reorder_slides = defineTool<{ ids_in_order: string[] }>({
    name: "reorder_slides",
    description: "Reorder the deck. Give every slide id (or number) in the desired order; slides omitted keep their relative order at the end.",
    parameters: { type: "object", properties: { ids_in_order: { type: "array", items: { type: "string" } } }, required: ["ids_in_order"] },
    label: () => "Reordering slides",
    execute: ({ ids_in_order }) => {
      const ids = ids_in_order.map((r) => findSlide(r).slide.id);
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
    description: "Switch the deck theme (fonts + palette). Elements use theme color tokens so everything restyles. Ids: " + THEMES.map((t) => `${t.id} (${t.name})`).join(", "),
    parameters: { type: "object", properties: { theme_id: { type: "string", enum: THEMES.map((t) => t.id) } }, required: ["theme_id"] },
    label: (a) => `Applying theme ${a.theme_id}`,
    execute: ({ theme_id }) => {
      const t = THEMES.find((x) => x.id === theme_id);
      if (!t) throw new Error(`Unknown theme ${theme_id}`);
      commit({ op: "apply_theme", theme: t }, { title: `Apply theme: ${t.name}`, summary: `${t.fonts.heading} / ${t.fonts.body}; accent ${t.colors.accent}` });
      // title slides carry the theme's title background
      for (const sl of deck().slides) if (sl.layout === "title" && sl.background?.color && sl.background.color !== t.titleBg) s.deck = applyOp(s.deck, { op: "set_slide", slideId: sl.id, patch: { background: { color: t.titleBg ?? t.colors.accent } } });
      return { theme: t.id };
    },
  });

  const set_layout = defineTool<{ slide_id: string; layout: SlideLayout }>({
    name: "set_layout",
    description: "Apply a different layout to a slide; existing text is re-flowed into the new placeholders (bullets ↔ columns, items ↔ timeline, etc.). User-added images/shapes are kept.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, layout: { type: "string", enum: SLIDE_LAYOUTS } }, required: ["slide_id", "layout"] },
    label: (a) => `Applying ${LAYOUT_LABEL[a.layout] ?? a.layout} layout`,
    execute: ({ slide_id, layout }) => {
      const { slide, index } = findSlide(slide_id);
      const next = applyLayout(slide, layout, theme(), index + 1);
      commit({ op: "replace_slide", slideId: slide.id, slide: next }, { title: `${label(index)}: layout → ${LAYOUT_LABEL[layout]}`, target: slide.id, targetLabel: label(index), risk: "medium" });
      return { slide_id: slide.id, layout, elements: next.elements.filter((e) => e.role && e.role !== "decor").map((e) => ({ id: e.id, role: e.role, type: e.type })) };
    },
  });

  const insert_image = defineTool<{ slide_id: string; prompt?: string; url?: string; blob_id?: string; alt?: string; x?: number; y?: number; w?: number; h?: number; fit?: "contain" | "cover" }>({
    name: "insert_image",
    description: "Insert an image on a slide. Give one of: prompt (generated with the OpenAI image model — use for demonstratives, diagrams, illustrative scenes; never for evidence), url (http(s) or /api/blobs/…), blob_id. Position/size in px (defaults: right half of the body area).",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, prompt: { type: "string" }, url: { type: "string" }, blob_id: { type: "string" }, alt: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, fit: { type: "string", enum: ["contain", "cover"] } }, required: ["slide_id"] },
    label: (a) => (a.prompt ? `Generating image: ${preview(a.prompt, 40)}` : "Inserting image"),
    execute: async ({ slide_id, prompt, url, blob_id, alt, x, y, w, h, fit }) => {
      const { slide, index } = findSlide(slide_id);
      let src = url ?? (blob_id ? `/api/blobs/${blob_id}` : undefined);
      let generated = false;
      if (!src && prompt) {
        if (!deps.generateImage) throw new Error("Image generation is not available (OpenAI key required)");
        ctx.emit({ type: "status", message: "Generating image…" });
        const width = w ?? 560, height = h ?? 420;
        const r = await deps.generateImage(prompt, width > height * 1.2 ? "1536x1024" : height > width * 1.2 ? "1024x1536" : "1024x1024");
        src = r.url; generated = true;
      }
      if (!src) throw new Error("Provide prompt, url or blob_id");
      const hasBody = slide.elements.some((e) => e.role === "body" && e.text?.trim());
      const rect = { x: x ?? (hasBody ? 660 : 72), y: y ?? 168, w: w ?? (hasBody ? 548 : 1136), h: h ?? 460 };
      const element = clampToSlide(makeElement({ type: "image", src, alt: alt ?? prompt ?? "Image", ...rect, style: { fit: fit ?? "contain", radius: 8 }, z: slide.elements.length, name: generated ? "Generated image" : "Image" }));
      commit({ op: "add_element", slideId: slide.id, element }, { title: `Insert image on ${label(index)}`, summary: generated ? `Generated: ${preview(prompt ?? "", 120)}` : src, target: `${slide.id}/${element.id}`, targetLabel: label(index) });
      if (hasBody) {
        const body = slide.elements.find((e) => e.role === "body")!;
        if (body.w > 600) s.deck = applyOp(s.deck, { op: "set_element", slideId: slide.id, elementId: body.id, patch: { w: 548 } });
        ctx.propose({ kind: "set_element", title: `Narrow body text on ${label(index)} to make room`, target: `${slide.id}/${body.id}`, targetLabel: label(index), payload: { op: "set_element", slideId: slide.id, elementId: body.id, patch: { w: 548 } }, risk: "low" });
      }
      return { element_id: element.id, src };
    },
  });

  const insert_chart = defineTool<{ slide_id: string; type: "bar" | "line" | "pie"; categories: string[]; series: { name: string; values: number[] }[]; title?: string; unit?: string; show_values?: boolean; x?: number; y?: number; w?: number; h?: number }>({
    name: "insert_chart",
    description: "Insert a chart (bar | line | pie) with categories and one or more series. Rendered natively in the editor and exported as an editable PowerPoint chart.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, type: { type: "string", enum: ["bar", "line", "pie"] }, categories: { type: "array", items: { type: "string" } }, series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } }, title: { type: "string" }, unit: { type: "string" }, show_values: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["slide_id", "type", "categories", "series"] },
    label: (a) => `Inserting ${a.type} chart`,
    execute: ({ slide_id, type, categories, series, title, unit, show_values, x, y, w, h }) => {
      const { slide, index } = findSlide(slide_id);
      if (!categories.length || !series.length) throw new Error("categories and series must not be empty");
      const chart: ChartSpec = { type, categories, series: series.map((sr) => ({ name: sr.name, values: categories.map((_, i) => Number(sr.values[i]) || 0) })), title, unit, showLegend: series.length > 1 || type === "pie", showValues: show_values ?? true };
      const hasBody = slide.elements.some((e) => e.role === "body" && e.text?.trim());
      const element = clampToSlide(makeElement({ type: "chart", chart, x: x ?? (hasBody ? 660 : 72), y: y ?? 168, w: w ?? (hasBody ? 548 : 1136), h: h ?? 460, style: { fill: "surface", radius: 12, padding: 16 }, z: slide.elements.length, name: "Chart" }));
      commit({ op: "add_element", slideId: slide.id, element }, { title: `Insert ${type} chart on ${label(index)}`, summary: `${title ?? ""} ${categories.join(", ")}`.trim(), target: `${slide.id}/${element.id}`, targetLabel: label(index) });
      return { element_id: element.id };
    },
  });

  const insert_table = defineTool<{ slide_id: string; header: string[]; rows: string[][]; x?: number; y?: number; w?: number; h?: number; font_size?: number }>({
    name: "insert_table",
    description: "Insert a table (header row + rows). Keep to ≤ 8 rows × 5 columns per slide for legibility; use Bates numbers / dates in cells where relevant.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, header: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, font_size: { type: "number" } }, required: ["slide_id", "header", "rows"] },
    label: () => "Inserting table",
    execute: ({ slide_id, header, rows, x, y, w, h, font_size }) => {
      const { slide, index } = findSlide(slide_id);
      const table = { header, rows: rows.map((r) => header.map((_, i) => r[i] ?? "")) };
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
      return { element_id: element.id };
    },
  });

  const update_element = defineTool<{ slide_id: string; element_id: string; x?: number; y?: number; w?: number; h?: number; rotation?: number; text?: string; style?: ElementStyle; src?: string; z?: number }>({
    name: "update_element",
    description: "Fine-grained element edit: move/resize (px), rotate, replace text, change style (fontSize pt, fontFamily heading|body|face, bold, italic, color, align, valign, fill, stroke, radius, opacity, lineHeight, fit), image src, z-order.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, rotation: { type: "number" }, text: { type: "string" }, src: { type: "string" }, z: { type: "number" }, style: { type: "object", properties: { fontSize: { type: "number" }, fontFamily: { type: "string" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color: { type: "string" }, align: { type: "string", enum: ["left", "center", "right"] }, valign: { type: "string", enum: ["top", "middle", "bottom"] }, fill: { type: "string" }, stroke: { type: "string" }, strokeWidth: { type: "number" }, radius: { type: "number" }, opacity: { type: "number" }, lineHeight: { type: "number" }, fit: { type: "string", enum: ["contain", "cover", "fill"] } }, required: [] } }, required: ["slide_id", "element_id"] },
    label: (a) => `Updating element ${a.element_id}`,
    execute: ({ slide_id, element_id, style, ...rest }) => {
      const { slide, index } = findSlide(slide_id);
      const cur = slide.elements.find((e) => e.id === element_id);
      if (!cur) throw new Error(`No element "${element_id}" on ${label(index)}`);
      const patch: Partial<DeckElement> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
      if (style) patch.style = { ...cur.style, ...style };
      const clamped = clampToSlide({ ...cur, ...patch });
      if (patch.x !== undefined) patch.x = clamped.x; if (patch.y !== undefined) patch.y = clamped.y; if (patch.w !== undefined) patch.w = clamped.w; if (patch.h !== undefined) patch.h = clamped.h;
      commit({ op: "set_element", slideId: slide.id, elementId: element_id, patch }, { title: `Update ${cur.role ?? cur.type} on ${label(index)}`, summary: Object.keys(patch).map((k) => (k === "style" ? `style: ${Object.keys(style ?? {}).join(", ")}` : `${k}: ${JSON.stringify((patch as Record<string, unknown>)[k]).slice(0, 60)}`)).join("; "), target: `${slide.id}/${element_id}`, targetLabel: label(index) });
      return { ok: true };
    },
  });

  const remove_element = defineTool<{ slide_id: string; element_id: string }>({
    name: "remove_element",
    description: "Remove an element from a slide.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, element_id: { type: "string" } }, required: ["slide_id", "element_id"] },
    label: (a) => `Removing element ${a.element_id}`,
    execute: ({ slide_id, element_id }) => {
      const { slide, index } = findSlide(slide_id);
      const cur = slide.elements.find((e) => e.id === element_id);
      if (!cur) throw new Error(`No element "${element_id}" on ${label(index)}`);
      commit({ op: "remove_element", slideId: slide.id, elementId: element_id }, { title: `Remove ${cur.role ?? cur.type} from ${label(index)}`, target: slide.id, targetLabel: label(index) });
      return { ok: true };
    },
  });

  const restyle_slide = defineTool<{ slide_id: string; goals?: string[] }>({
    name: "restyle_slide",
    description: "Normalize a slide's hierarchy, sizes and spacing: rebuilds it on its layout grid with theme styles and auto-fits text so nothing overflows. Goals (free text) such as \"fix hierarchy\", \"shrink to fit\", \"more whitespace\" steer it.",
    parameters: { type: "object", properties: { slide_id: { type: "string" }, goals: { type: "array", items: { type: "string" } } }, required: ["slide_id"] },
    label: (a) => `Restyling slide ${a.slide_id}`,
    execute: ({ slide_id, goals }) => {
      const { slide, index } = findSlide(slide_id);
      const next = restyleSlide(slide, theme(), goals ?? []);
      commit({ op: "replace_slide", slideId: slide.id, slide: next }, { title: `Restyle ${label(index)}`, summary: (goals ?? []).join(", ") || "Rebuilt on the layout grid; text auto-fitted", target: slide.id, targetLabel: label(index) });
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
    description: "Tighten every text slide (or the given slide_ids) to at most max_bullets bullets of at most max_words_per_bullet words each, preserving meaning, cites and defined terms. Uses the model when available; otherwise reports which slides exceed the limits so you can rewrite them with set_slide_text.",
    parameters: { type: "object", properties: { goals: { type: "array", items: { type: "string" } }, max_bullets: { type: "integer" }, max_words_per_bullet: { type: "integer" }, slide_ids: { type: "array", items: { type: "string" } } }, required: [] },
    label: () => "Condensing deck",
    execute: async ({ goals, max_bullets, max_words_per_bullet, slide_ids }) => {
      const limits = { maxBullets: max_bullets ?? 5, maxWords: max_words_per_bullet ?? 12 };
      const targets = (slide_ids?.length ? slide_ids.map((r) => findSlide(r).slide) : deck().slides).filter((sl) => sl.elements.some((e) => e.type === "text" && (e.role === "body" || e.role === "left" || e.role === "right") && e.text?.trim()));
      const offending = targets.map((sl) => { const body = sl.elements.find((e) => e.role === "body" || e.role === "left")!; const bl = bulletLines(body.text); const tooMany = bl.length > limits.maxBullets; const tooLong = bl.filter((b) => b.split(/\s+/).length > limits.maxWords); return { sl, body, tooMany, tooLong, bullets: bl.length }; }).filter((x) => x.tooMany || x.tooLong.length);
      if (!offending.length) return { changed: 0, note: "Every slide is already within the limits." };
      if (!deps.condenseSlides) return { changed: 0, needs_rewrite: offending.map((o) => ({ slide: deck().slides.findIndex((x) => x.id === o.sl.id) + 1, slide_id: o.sl.id, element_id: o.body.id, bullets: o.bullets, long_bullets: o.tooLong })), instruction: `Model-based condensing unavailable; rewrite each listed element with set_slide_text (≤${limits.maxBullets} bullets, ≤${limits.maxWords} words each).` };
      ctx.emit({ type: "status", message: `Condensing ${offending.length} slide${offending.length === 1 ? "" : "s"}…` });
      const rewrites = await deps.condenseSlides(offending.map((o) => ({ id: o.sl.id, title: slideTitle(o.sl), body: o.body.text ?? "" })), goals ?? [], limits, { deckTitle: s.title, matter: ctx.matter?.name });
      let changed = 0;
      for (const r of rewrites) {
        const o = offending.find((x) => x.sl.id === r.id);
        if (!o || !r.body.trim() || r.body === o.body.text) continue;
        const index = deck().slides.findIndex((x) => x.id === o.sl.id);
        commit({ op: "set_element", slideId: o.sl.id, elementId: o.body.id, patch: { text: r.body } }, { title: `Condense ${label(index)}`, summary: preview(plainText(r.body).replace(/\n/g, " · "), 200), target: `${o.sl.id}/${o.body.id}`, targetLabel: label(index) });
        changed++;
        if (r.title && r.title !== slideTitle(o.sl)) { const t = o.sl.elements.find((e) => e.role === "title"); if (t) commit({ op: "set_element", slideId: o.sl.id, elementId: t.id, patch: { text: r.title } }, { title: `Retitle ${label(index)}`, summary: r.title, target: `${o.sl.id}/${t.id}`, targetLabel: label(index) }); }
      }
      return { changed, limits };
    },
  });

  const generate_deck = defineTool<{ outline_markdown: string; replace?: boolean; theme_id?: string }>({
    name: "generate_deck",
    description: `Build a whole deck from an outline (one slide per "# Title" block). Grammar per slide: "layout: <id>" (optional; inferred), "subtitle:", "kicker:", "date:", "number:", "caption:", "image: url", bullets "- …" / "  - …", "left: Heading" + bullets, "right: Heading" + bullets, "quote: …" + "by: …", "chart: bar | Cat1, Cat2 | Series A: 1, 2 | Series B: 3, 4", pipe tables "| h1 | h2 |", "timeline:" followed by "- 2024-03-01 — Event — detail" lines, and "notes: …" (rest of block). A strong legal deck: title → agenda → case caption/posture → key facts → timeline → key documents (Bates) → issues/arguments → damages → risks & recommendations → next steps with dates. replace=true replaces the current slides (default when the deck is empty), otherwise slides are appended.`,
    parameters: { type: "object", properties: { outline_markdown: { type: "string" }, replace: { type: "boolean" }, theme_id: { type: "string", enum: THEMES.map((t) => t.id) } }, required: ["outline_markdown"] },
    label: () => "Building deck from outline",
    execute: ({ outline_markdown, replace, theme_id }) => {
      const t = theme_id ? getTheme(theme_id) : theme();
      const { slides } = parseOutline(outline_markdown, t);
      if (!slides.length) throw new Error("Outline produced no slides — start each slide with \"# Title\"");
      const doReplace = replace ?? deck().slides.length === 0;
      if (doReplace) commit({ op: "replace_deck", slides, theme: theme_id ? t : undefined }, { title: `Generate deck (${slides.length} slides)`, summary: slides.map((sl, i) => `${i + 1}. ${slideTitle(sl)}`).join("\n"), risk: deck().slides.length ? "high" : "low" });
      else {
        let afterId: string | null = deck().slides.at(-1)?.id ?? null;
        for (const sl of slides) { const i = deck().slides.length; commit({ op: "add_slide", afterId, slide: sl }, { title: `Add slide ${i + 1}: ${preview(slideTitle(sl), 50)}`, target: sl.id, targetLabel: `Slide ${i + 1}` }); afterId = sl.id; }
        if (theme_id) commit({ op: "apply_theme", theme: t }, { title: `Apply theme: ${t.name}` });
      }
      return { slides: slides.map((sl, i) => ({ index: (doReplace ? 0 : deck().slides.length - slides.length) + i + 1, id: sl.id, layout: sl.layout, title: slideTitle(sl) })), outline: deckToOutline(slides).slice(0, 4000) };
    },
  });

  const add_speaker_notes_all = defineTool<{ style?: string; overwrite?: boolean }>({
    name: "add_speaker_notes_all",
    description: "Write speaker notes for every slide that lacks them (overwrite=true rewrites all). Style e.g. \"conversational, 60 seconds per slide, flag the cites to read aloud\".",
    parameters: { type: "object", properties: { style: { type: "string" }, overwrite: { type: "boolean" } }, required: [] },
    label: () => "Writing speaker notes",
    execute: async ({ style, overwrite }) => {
      const targets = deck().slides.map((sl, i) => ({ sl, i })).filter(({ sl }) => overwrite || !sl.notes.trim());
      if (!targets.length) return { changed: 0, note: "Every slide already has notes." };
      let notes: { id: string; notes: string }[];
      if (deps.generateNotes) {
        ctx.emit({ type: "status", message: `Drafting notes for ${targets.length} slides…` });
        notes = await deps.generateNotes(targets.map(({ sl, i }) => ({ id: sl.id, index: i + 1, title: slideTitle(sl), body: slideBodyText(sl), layout: sl.layout })), style ?? "concise, presenter-facing", { deckTitle: s.title, matter: ctx.matter?.name });
      } else {
        notes = targets.map(({ sl, i }) => {
          const next = deck().slides[i + 1];
          const bullets = bulletLines(slideBodyText(sl)).slice(0, 4);
          return { id: sl.id, notes: [`${slideTitle(sl) || `Slide ${i + 1}`}.`, bullets.length ? `Walk through: ${bullets.join("; ")}.` : "", next ? `Transition: "${slideTitle(next)}".` : "Close and invite questions."].filter(Boolean).join(" ") };
        });
      }
      let changed = 0;
      for (const n of notes) { const i = deck().slides.findIndex((x) => x.id === n.id); if (i < 0 || !n.notes.trim()) continue; commit({ op: "set_slide", slideId: n.id, patch: { notes: n.notes } }, { title: `Speaker notes for ${label(i)}`, summary: preview(n.notes, 160), target: n.id, targetLabel: label(i) }); changed++; }
      return { changed, generated_by: deps.generateNotes ? "model" : "template" };
    },
  });

  return [
    get_deck_outline, get_slide, find_text, get_theme, get_selection, get_comments,
    add_slide, set_slide_text, set_notes, update_slide, reorder_slides, move_slide, delete_slide, duplicate_slide, apply_theme, set_layout,
    insert_image, insert_chart, insert_table, insert_shape, update_element, remove_element, restyle_slide, split_slide, condense_deck, generate_deck, add_speaker_notes_all,
  ] as unknown as ToolDef<never, unknown>[];
}
