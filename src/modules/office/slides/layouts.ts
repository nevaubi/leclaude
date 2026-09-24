/**
 * Layout builders: turn structured slide content into positioned, themed
 * elements on the 1280×720 canvas, and the inverse (extract content from a
 * slide so a new layout can re-flow it). Also the outline DSL parser used by
 * templates, seeds and the agent's generate_deck tool.
 */
import { nanoid } from "nanoid";
import {
  SLIDE_H, SLIDE_W, fitFontSize, findByRole, makeElement, newSlideId, parseMarkdownLite, plainText, bulletLines,
  type ChartSpec, type DeckElement, type DeckSlide, type DeckTheme, type ElementStyle, type SlideLayout, type TableSpec, SLIDE_LAYOUTS,
} from "./model";

export interface TimelineItem { date: string; label: string; detail?: string }

export interface SlideContent {
  title?: string;
  subtitle?: string;
  kicker?: string;
  date?: string;
  number?: string;
  body?: string; // markdown-lite
  left?: string;
  right?: string;
  leftTitle?: string;
  rightTitle?: string;
  quote?: string;
  attribution?: string;
  caption?: string;
  imageUrl?: string;
  imageAlt?: string;
  table?: TableSpec;
  chart?: ChartSpec;
  timeline?: TimelineItem[];
  agenda?: string[];
  notes?: string;
  background?: string;
}

export interface BuildOptions { id?: string; notes?: string; hidden?: boolean; footer?: boolean; slideNumber?: number }

const M = 72; // margin
const CONTENT_W = SLIDE_W - M * 2;
const TITLE_Y = 48;
const TITLE_H = 92;
const BODY_Y = 168;
const BODY_H = 480;

let zCounter = 0;
const el = (partial: Partial<DeckElement> & { type: DeckElement["type"] }): DeckElement => makeElement({ z: zCounter++, ...partial });

function text(role: DeckElement["role"], value: string | undefined, rect: { x: number; y: number; w: number; h: number }, style: ElementStyle, name?: string): DeckElement {
  return el({ type: "text", role, text: value ?? "", ...rect, style: { padding: 8, ...style }, name });
}

function titleEl(theme: DeckTheme, value: string | undefined, opts: { y?: number; h?: number; size?: number; color?: string; align?: ElementStyle["align"] } = {}): DeckElement {
  const e = text("title", value, { x: M, y: opts.y ?? TITLE_Y, w: CONTENT_W, h: opts.h ?? TITLE_H }, { fontFamily: "heading", fontSize: opts.size ?? 34, bold: true, color: opts.color ?? "fg", valign: "middle", align: opts.align ?? "left", lineHeight: 1.1 }, "Title");
  e.style.fontSize = fitFontSize(e, theme, opts.size ?? 34, 22);
  return e;
}

function accentRule(theme: DeckTheme, y = TITLE_Y + TITLE_H + 4): DeckElement {
  void theme;
  return el({ type: "shape", shape: "rect", role: "decor", x: M, y, w: 72, h: 4, style: { fill: "accent2" }, name: "Rule" });
}

function footerEls(theme: DeckTheme, slideNumber?: number): DeckElement[] {
  const out = [text("footer", `${theme.logoText ?? "Seeger Weiss LLP"}  ·  Privileged & Confidential  ·  Attorney Work Product`, { x: M, y: SLIDE_H - 44, w: 800, h: 28 }, { fontSize: 10, color: "muted", valign: "middle", padding: 0 }, "Footer")];
  if (slideNumber) out.push(text("footer", String(slideNumber), { x: SLIDE_W - M - 60, y: SLIDE_H - 44, w: 60, h: 28 }, { fontSize: 10, color: "muted", align: "right", valign: "middle", padding: 0 }, "Slide number"));
  return out;
}

function bodyEl(theme: DeckTheme, role: DeckElement["role"], value: string | undefined, rect: { x: number; y: number; w: number; h: number }, max = 24, min = 14): DeckElement {
  const e = text(role, value, rect, { fontFamily: "body", fontSize: max, color: "fg", valign: "top", lineHeight: 1.3 }, role === "body" ? "Body" : role === "left" ? "Left column" : role === "right" ? "Right column" : "Text");
  e.style.fontSize = fitFontSize(e, theme, max, min);
  return e;
}

/** Build a slide for a layout from structured content. */
export function buildSlide(layout: SlideLayout, c: SlideContent, theme: DeckTheme, opts: BuildOptions = {}): DeckSlide {
  zCounter = 0;
  const elements: DeckElement[] = [];
  let background: DeckSlide["background"] | undefined = c.background ? { color: c.background } : undefined;
  const withFooter = opts.footer !== false;

  switch (layout) {
    case "title": {
      background = { color: theme.titleBg ?? theme.colors.accent };
      const fg = theme.titleFg ?? theme.colors.bg;
      elements.push(el({ type: "shape", shape: "rect", role: "decor", x: 0, y: 0, w: 14, h: SLIDE_H, style: { fill: "accent2" }, name: "Edge bar" }));
      if (c.kicker) elements.push(text("kicker", c.kicker.toUpperCase(), { x: 96, y: 168, w: 1080, h: 40 }, { fontSize: 14, color: "accent2", bold: true, letterSpacing: 2, valign: "middle" }, "Kicker"));
      const t = text("title", c.title, { x: 96, y: 216, w: 1080, h: 200 }, { fontFamily: "heading", fontSize: 48, bold: true, color: fg, valign: "middle", lineHeight: 1.08 }, "Title");
      t.style.fontSize = fitFontSize(t, theme, 48, 30);
      elements.push(t);
      if (c.subtitle) { const s = text("subtitle", c.subtitle, { x: 96, y: 428, w: 1080, h: 96 }, { fontSize: 22, color: fg, opacity: 0.85, valign: "top", lineHeight: 1.3 }, "Subtitle"); s.style.fontSize = fitFontSize(s, theme, 22, 16); elements.push(s); }
      elements.push(text("date", c.date ?? "", { x: 96, y: 580, w: 700, h: 36 }, { fontSize: 15, color: fg, opacity: 0.75, valign: "middle" }, "Date / presenter"));
      elements.push(text("logo", theme.logoText ?? "Seeger Weiss LLP", { x: 96, y: 636, w: 600, h: 36 }, { fontFamily: "heading", fontSize: 16, bold: true, color: fg, valign: "middle", letterSpacing: 1 }, "Firm"));
      elements.push(text("footer", "PRIVILEGED & CONFIDENTIAL · ATTORNEY WORK PRODUCT", { x: 700, y: 636, w: 484, h: 36 }, { fontSize: 10, color: fg, opacity: 0.6, align: "right", valign: "middle", letterSpacing: 1 }, "Confidentiality"));
      break;
    }
    case "section": {
      elements.push(el({ type: "shape", shape: "rect", role: "decor", x: 0, y: SLIDE_H - 12, w: SLIDE_W, h: 12, style: { fill: "accent" }, name: "Bottom bar" }));
      if (c.number) elements.push(text("number", c.number, { x: M, y: 150, w: 400, h: 140 }, { fontFamily: "heading", fontSize: 96, bold: true, color: "accent2", valign: "middle", padding: 0 }, "Section number"));
      const t = text("title", c.title, { x: M, y: 300, w: CONTENT_W, h: 120 }, { fontFamily: "heading", fontSize: 44, bold: true, color: "fg", valign: "middle", lineHeight: 1.1 }, "Title");
      t.style.fontSize = fitFontSize(t, theme, 44, 28);
      elements.push(t);
      elements.push(accentRule(theme, 428));
      const s = text("subtitle", c.subtitle ?? "", { x: M, y: 448, w: CONTENT_W, h: 120 }, { fontSize: 20, color: "muted", valign: "top", lineHeight: 1.35 }, "Subtitle");
      s.style.fontSize = fitFontSize(s, theme, 20, 14);
      elements.push(s);
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "bullets": {
      elements.push(titleEl(theme, c.title), accentRule(theme));
      elements.push(bodyEl(theme, "body", c.body, { x: M, y: BODY_Y, w: CONTENT_W, h: BODY_H }));
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "two_column": {
      elements.push(titleEl(theme, c.title), accentRule(theme));
      const colW = (CONTENT_W - 40) / 2;
      elements.push(bodyEl(theme, "left", c.left ?? c.body, { x: M, y: BODY_Y, w: colW, h: BODY_H }, 22, 13));
      elements.push(bodyEl(theme, "right", c.right, { x: M + colW + 40, y: BODY_Y, w: colW, h: BODY_H }, 22, 13));
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "comparison": {
      elements.push(titleEl(theme, c.title), accentRule(theme));
      const colW = (CONTENT_W - 32) / 2;
      const cols: { x: number; head: string | undefined; body: string | undefined; role: "left" | "right"; headRole: "leftTitle" | "rightTitle" }[] = [
        { x: M, head: c.leftTitle ?? "Plaintiffs' position", body: c.left ?? c.body, role: "left", headRole: "leftTitle" },
        { x: M + colW + 32, head: c.rightTitle ?? "Our position", body: c.right, role: "right", headRole: "rightTitle" },
      ];
      for (const col of cols) {
        elements.push(el({ type: "shape", shape: "rect", role: "decor", x: col.x, y: BODY_Y, w: colW, h: BODY_H, style: { fill: "surface", radius: 12 }, name: "Card" }));
        elements.push(el({ type: "shape", shape: "rect", role: "decor", x: col.x, y: BODY_Y, w: colW, h: 6, style: { fill: col.role === "left" ? "muted" : "accent", radius: 3 }, name: "Card accent" }));
        elements.push(text(col.headRole, col.head, { x: col.x + 16, y: BODY_Y + 18, w: colW - 32, h: 48 }, { fontFamily: "heading", fontSize: 20, bold: true, color: col.role === "left" ? "muted" : "accent", valign: "middle" }, "Column heading"));
        elements.push(bodyEl(theme, col.role, col.body, { x: col.x + 16, y: BODY_Y + 72, w: colW - 32, h: BODY_H - 88 }, 20, 12));
      }
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "timeline": {
      elements.push(titleEl(theme, c.title), accentRule(theme));
      const items = (c.timeline?.length ? c.timeline : bulletLines(c.body).map(parseTimelineLine)).slice(0, 8);
      const lineY = 400;
      elements.push(el({ type: "line", role: "decor", x: M + 20, y: lineY, w: CONTENT_W - 40, h: 0, style: { stroke: "muted", strokeWidth: 3, lineDir: "down" }, name: "Axis" }));
      const n = Math.max(1, items.length);
      const step = (CONTENT_W - 80) / n;
      items.forEach((it, i) => {
        const cx = M + 40 + step * i + step / 2;
        elements.push(el({ type: "shape", shape: "ellipse", role: "decor", x: cx - 12, y: lineY - 12, w: 24, h: 24, style: { fill: "accent", stroke: "bg", strokeWidth: 3 }, name: `Marker ${i + 1}` }));
        const above = i % 2 === 0;
        const boxW = Math.min(260, step + 40);
        const rect = above ? { x: cx - boxW / 2, y: lineY - 24 - 150, w: boxW, h: 140 } : { x: cx - boxW / 2, y: lineY + 24, w: boxW, h: 150 };
        const body = `**${it.date}**\n${it.label}${it.detail ? `\n${it.detail}` : ""}`;
        const t = text("item", body, rect, { fontSize: 14, color: "fg", align: "center", valign: above ? "bottom" : "top", lineHeight: 1.25 }, `Event ${i + 1}`);
        t.style.fontSize = fitFontSize(t, theme, 15, 10);
        elements.push(t);
      });
      if (c.caption) elements.push(text("caption", c.caption, { x: M, y: SLIDE_H - 92, w: CONTENT_W, h: 40 }, { fontSize: 13, color: "muted", align: "left", valign: "middle" }, "Caption"));
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "chart": {
      elements.push(titleEl(theme, c.title), accentRule(theme));
      const chart: ChartSpec = c.chart ?? { type: "bar", categories: ["2024", "2025", "2026"], series: [{ name: "Series", values: [0, 0, 0] }], showLegend: true };
      const hasCaption = Boolean(c.caption || c.body);
      elements.push(el({ type: "chart", role: "chart", chart, x: M, y: BODY_Y, w: hasCaption ? 760 : CONTENT_W, h: BODY_H, style: { fill: "surface", radius: 12, padding: 16 }, name: "Chart" }));
      if (hasCaption) elements.push(bodyEl(theme, "body", c.body ?? c.caption, { x: M + 792, y: BODY_Y, w: CONTENT_W - 792, h: BODY_H }, 18, 12));
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "table": {
      elements.push(titleEl(theme, c.title), accentRule(theme));
      const table: TableSpec = c.table ?? { header: ["Item", "Detail"], rows: [["", ""]] };
      const rowsH = Math.min(BODY_H - (c.caption ? 56 : 0), 44 + table.rows.length * 40);
      elements.push(el({ type: "table", role: "table", table, x: M, y: BODY_Y, w: CONTENT_W, h: rowsH, style: { fontSize: table.rows.length > 8 ? 12 : 14, color: "fg", headerFill: "accent", headerColor: "bg", stroke: "muted", banded: true }, name: "Table" }));
      if (c.caption) elements.push(text("caption", c.caption, { x: M, y: BODY_Y + rowsH + 12, w: CONTENT_W, h: 40 }, { fontSize: 13, color: "muted", valign: "top" }, "Caption"));
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "quote": {
      elements.push(el({ type: "text", role: "decor", text: "“", x: 88, y: 96, w: 160, h: 200, style: { fontFamily: "heading", fontSize: 160, color: "accent2", opacity: 0.6, valign: "top", padding: 0 }, name: "Quote mark" }));
      const q = text("quote", c.quote ?? c.title ?? "", { x: 180, y: 180, w: 920, h: 300 }, { fontFamily: "heading", fontSize: 30, italic: true, color: "fg", valign: "middle", lineHeight: 1.3 }, "Quote");
      q.style.fontSize = fitFontSize(q, theme, 30, 18);
      elements.push(q);
      elements.push(el({ type: "shape", shape: "rect", role: "decor", x: 180, y: 500, w: 60, h: 4, style: { fill: "accent" }, name: "Rule" }));
      elements.push(text("attribution", c.attribution ?? "", { x: 180, y: 516, w: 920, h: 72 }, { fontSize: 16, color: "muted", valign: "top", lineHeight: 1.3 }, "Attribution"));
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "image": {
      elements.push(titleEl(theme, c.title), accentRule(theme));
      const withCaption = Boolean(c.caption);
      elements.push(el({ type: "image", role: "image", src: c.imageUrl ?? "", alt: c.imageAlt ?? c.caption ?? c.title ?? "Image", x: M, y: BODY_Y, w: CONTENT_W, h: withCaption ? BODY_H - 52 : BODY_H, style: { fit: "contain", radius: 8, fill: "surface" }, name: "Image" }));
      if (withCaption) elements.push(text("caption", c.caption, { x: M, y: BODY_Y + BODY_H - 44, w: CONTENT_W, h: 40 }, { fontSize: 13, color: "muted", align: "center", valign: "middle" }, "Caption"));
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "agenda": {
      elements.push(titleEl(theme, c.title ?? "Agenda"), accentRule(theme));
      const items = (c.agenda?.length ? c.agenda : bulletLines(c.body)).slice(0, 8);
      const rowH = Math.min(72, Math.floor(BODY_H / Math.max(1, items.length)));
      items.forEach((it, i) => {
        const y = BODY_Y + i * rowH;
        elements.push(el({ type: "text", role: "decor", text: String(i + 1).padStart(2, "0"), x: M, y: y + (rowH - 44) / 2, w: 52, h: 44, style: { fontFamily: "heading", fontSize: 16, bold: true, color: "bg", fill: "accent", radius: 22, align: "center", valign: "middle", padding: 0 }, name: `Badge ${i + 1}` }));
        const t = text("item", it, { x: M + 72, y, w: CONTENT_W - 72, h: rowH }, { fontSize: rowH >= 64 ? 22 : 18, color: "fg", valign: "middle" }, `Item ${i + 1}`);
        t.style.fontSize = fitFontSize(t, theme, rowH >= 64 ? 22 : 18, 12);
        elements.push(t);
        if (i < items.length - 1) elements.push(el({ type: "line", role: "decor", x: M + 72, y: y + rowH, w: CONTENT_W - 72, h: 0, style: { stroke: "surface", strokeWidth: 1 }, name: "Divider" }));
      });
      if (withFooter) elements.push(...footerEls(theme, opts.slideNumber));
      break;
    }
    case "blank":
    default:
      if (c.title) elements.push(titleEl(theme, c.title));
      if (c.body) elements.push(bodyEl(theme, "body", c.body, { x: M, y: BODY_Y, w: CONTENT_W, h: BODY_H }));
      break;
  }

  return { id: opts.id ?? newSlideId(), layout, background, elements, notes: opts.notes ?? c.notes ?? "", hidden: opts.hidden };
}

export function parseTimelineLine(line: string): TimelineItem {
  const m = line.match(/^\**(.+?)\**\s*(?:\s[—–-]\s|—|–|:\s)\s*(.+?)(?:\s+[—–-]\s+(.+))?$/);
  if (m) return { date: m[1].replace(/\*/g, "").trim(), label: m[2].trim(), detail: m[3]?.trim() };
  return { date: "", label: line };
}

/** Structured content of an existing slide (by placeholder roles, with heuristics for untagged slides). */
export function extractContent(slide: DeckSlide): SlideContent {
  const c: SlideContent = { notes: slide.notes };
  const texts = slide.elements.filter((e) => e.type === "text");
  const byRole = (r: DeckElement["role"]) => texts.filter((e) => e.role === r);
  const one = (r: DeckElement["role"]) => byRole(r)[0]?.text;
  c.title = one("title");
  c.subtitle = one("subtitle");
  c.kicker = one("kicker");
  c.date = one("date");
  c.number = one("number");
  c.body = one("body");
  c.left = one("left");
  c.right = one("right");
  c.leftTitle = one("leftTitle");
  c.rightTitle = one("rightTitle");
  c.quote = one("quote");
  c.attribution = one("attribution");
  c.caption = one("caption");
  const items = byRole("item").map((e) => plainText(e.text));
  if (items.length) {
    if (slide.layout === "timeline") c.timeline = items.map((t) => { const [date, ...rest] = t.split("\n"); return { date: date.trim(), label: rest[0]?.trim() ?? "", detail: rest.slice(1).join(" ").trim() || undefined }; });
    else c.agenda = items;
  }
  const img = slide.elements.find((e) => e.type === "image");
  if (img) { c.imageUrl = img.src; c.imageAlt = img.alt; }
  const table = slide.elements.find((e) => e.type === "table");
  if (table?.table) c.table = table.table;
  const chart = slide.elements.find((e) => e.type === "chart");
  if (chart?.chart) c.chart = chart.chart;
  if (slide.background?.color && slide.layout !== "title") c.background = slide.background.color;

  // Untagged text (imports, free-form slides): biggest top text → title, rest → body.
  const untagged = texts.filter((e) => !e.role && e.text?.trim());
  if (untagged.length) {
    const sorted = [...untagged].sort((a, b) => (b.style.fontSize ?? 18) - (a.style.fontSize ?? 18) || a.y - b.y);
    if (!c.title) { c.title = plainText(sorted[0].text).split("\n")[0]; sorted.shift(); }
    const rest = sorted.sort((a, b) => a.y - b.y || a.x - b.x).map((e) => e.text ?? "").filter(Boolean);
    if (rest.length) c.body = [c.body, ...rest].filter(Boolean).join("\n");
  }
  // Fold columns / items into body when the target layout has no such placeholders.
  const merged: string[] = [];
  if (!c.body) {
    if (c.left) merged.push(c.leftTitle ? `**${plainText(c.leftTitle)}**\n${c.left}` : c.left);
    if (c.right) merged.push(c.rightTitle ? `**${plainText(c.rightTitle)}**\n${c.right}` : c.right);
    if (c.agenda?.length) merged.push(c.agenda.map((a) => `- ${a}`).join("\n"));
    if (c.timeline?.length) merged.push(c.timeline.map((t) => `- **${t.date}** — ${t.label}${t.detail ? ` — ${t.detail}` : ""}`).join("\n"));
    if (c.quote && !c.title) merged.push(c.quote);
    if (merged.length) c.body = merged.join("\n");
  }
  if (!c.left && c.body && (c.agenda || c.timeline)) { /* keep */ }
  if (!c.agenda && c.body) c.agenda = bulletLines(c.body);
  if (!c.timeline && c.body) c.timeline = bulletLines(c.body).map(parseTimelineLine).filter((t) => t.date);
  if (!c.quote && c.body && !c.title) c.quote = plainText(c.body);
  if (!c.right && c.body && !c.left) {
    // split bullets across two columns for two_column / comparison targets
    const lines = parseMarkdownLite(c.body).filter((l) => l.runs.some((r) => r.text.trim()));
    if (lines.length >= 2) {
      const half = Math.ceil(lines.length / 2);
      const ser = (ls: typeof lines) => ls.map((l) => "  ".repeat(l.indent) + (l.kind === "bullet" ? "- " : l.kind === "number" ? "1. " : "") + l.runs.map((r) => (r.bold ? `**${r.text}**` : r.italic ? `*${r.text}*` : r.text)).join("")).join("\n");
      c.left = ser(lines.slice(0, half));
      c.right = ser(lines.slice(half));
    } else c.left = c.body;
  }
  return c;
}

/** Re-flow a slide into a new layout, keeping user-added (role-less) images/shapes/text. */
export function applyLayout(slide: DeckSlide, layout: SlideLayout, theme: DeckTheme, slideNumber?: number): DeckSlide {
  const content = extractContent(slide);
  const next = buildSlide(layout, content, theme, { id: slide.id, notes: slide.notes, hidden: slide.hidden, slideNumber });
  const usedImage = next.elements.some((e) => e.type === "image");
  const usedTable = next.elements.some((e) => e.type === "table");
  const usedChart = next.elements.some((e) => e.type === "chart");
  const extras = slide.elements.filter((e) => {
    if (e.role && e.role !== "decor") return false;
    if (e.role === "decor") return false;
    if (e.type === "text") return false; // text folded into placeholders above
    if (e.type === "image" && usedImage) return false;
    if (e.type === "table" && usedTable) return false;
    if (e.type === "chart" && usedChart) return false;
    return true;
  });
  let z = next.elements.length;
  next.elements.push(...extras.map((e) => ({ ...e, z: z++ })));
  next.transition = slide.transition;
  next.name = slide.name;
  return next;
}

/** Normalize hierarchy, sizes and spacing: rebuild with the same layout and auto-fit text. */
export function restyleSlide(slide: DeckSlide, theme: DeckTheme, goals: string[] = []): DeckSlide {
  const next = slide.layout === "blank" ? { ...slide, elements: slide.elements.map((e) => ({ ...e })) } : applyLayout(slide, slide.layout, theme);
  const shrink = goals.some((g) => /shrink|fit|overflow|smaller/i.test(g));
  for (const e of next.elements) {
    if (e.type !== "text" || !e.text?.trim()) continue;
    const max = e.role === "title" ? 36 : e.role === "quote" ? 30 : e.role === "body" || e.role === "left" || e.role === "right" ? 24 : e.style.fontSize ?? 18;
    const min = e.role === "title" ? 22 : 11;
    e.style.fontSize = fitFontSize(e, theme, shrink ? Math.min(max, e.style.fontSize ?? max) : max, min);
  }
  next.elements = next.elements.filter((e) => !(e.type === "text" && !e.text?.trim() && e.role !== "date" && e.role !== "subtitle" && e.role !== "attribution" && e.role !== "body" && e.role !== "left" && e.role !== "right"));
  return next;
}

/** Split an overloaded bullets slide into two. */
export function splitSlide(slide: DeckSlide, theme: DeckTheme): [DeckSlide, DeckSlide] {
  const c = extractContent(slide);
  const lines = parseMarkdownLite(c.body ?? "").filter((l) => l.runs.some((r) => r.text.trim()));
  const half = Math.ceil(lines.length / 2);
  const ser = (ls: typeof lines) => ls.map((l) => "  ".repeat(l.indent) + (l.kind === "bullet" ? "- " : l.kind === "number" ? "1. " : "") + l.runs.map((r) => (r.bold ? `**${r.text}**` : r.italic ? `*${r.text}*` : r.text)).join("")).join("\n");
  const layout: SlideLayout = slide.layout === "two_column" || slide.layout === "comparison" ? "bullets" : slide.layout === "blank" ? "bullets" : slide.layout;
  const a = buildSlide(layout === "timeline" || layout === "agenda" || layout === "chart" || layout === "table" || layout === "image" || layout === "quote" || layout === "section" || layout === "title" ? "bullets" : layout, { ...c, body: ser(lines.slice(0, half)), left: undefined, right: undefined, agenda: undefined, timeline: undefined }, theme, { id: slide.id, notes: slide.notes });
  const b = buildSlide("bullets", { ...c, title: `${plainText(c.title ?? "")} (cont.)`, body: ser(lines.slice(half)), left: undefined, right: undefined, agenda: undefined, timeline: undefined }, theme, { notes: "" });
  return [a, b];
}

/** Retag a slide's placeholder text after the user edited it in place (keeps roles). */
export function setPlaceholderText(slide: DeckSlide, role: NonNullable<DeckElement["role"]>, text: string): DeckSlide {
  const target = findByRole(slide, role);
  if (!target) return slide;
  return { ...slide, elements: slide.elements.map((e) => (e.id === target.id ? { ...e, text } : e)) };
}

// ---------------------------------------------------------------------------
// Outline DSL
// ---------------------------------------------------------------------------

/**
 * Outline grammar (one slide per "# Heading"):
 *   theme: client-light                (optional, before the first slide)
 *   # Slide title
 *   layout: bullets | title | section | two_column | comparison | timeline | chart | table | quote | image | agenda | blank
 *   subtitle: … | kicker: … | date: … | number: 01 | caption: … | image: url | background: #hex
 *   - bullet / "  - " nested bullet / "1. " numbered
 *   left: Column heading   (following bullets go to the left column)
 *   right: Column heading
 *   quote: "…"  / by: attribution
 *   chart: bar | Q1, Q2, Q3 | Revenue: 1, 2, 3 | Cost: 2, 3, 4      (chart-title: …, unit: $)
 *   | Header | Header |  (pipe table; a |---| separator row is optional)
 *   timeline:  then "- 2024-03-01 — Event — detail" lines
 *   notes: speaker notes (rest of the block)
 */
export function parseOutline(outline: string, theme: DeckTheme, opts: { footer?: boolean } = {}): { themeId?: string; slides: DeckSlide[] } {
  const lines = outline.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[][] = [];
  let themeId: string | undefined;
  let cur: string[] | null = null;
  for (const line of lines) {
    if (/^#\s+/.test(line)) { cur = [line]; blocks.push(cur); continue; }
    if (!cur) { const m = line.match(/^theme:\s*(\S+)/i); if (m) themeId = m[1]; continue; }
    cur.push(line);
  }
  const slides: DeckSlide[] = [];
  blocks.forEach((block, index) => {
    const c: SlideContent = {};
    let layout: SlideLayout | undefined;
    c.title = block[0].replace(/^#\s+/, "").trim();
    let target: "body" | "left" | "right" | "timeline" | "notes" = "body";
    const tableRows: string[][] = [];
    const timeline: TimelineItem[] = [];
    const notes: string[] = [];
    const bullets: Record<"body" | "left" | "right", string[]> = { body: [], left: [], right: [] };
    for (const raw of block.slice(1)) {
      if (target === "notes") { notes.push(raw); continue; }
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) continue;
      const d = line.match(/^([a-z][a-z-]*):\s?(.*)$/i);
      if (d && !/^\s/.test(line)) {
        const key = d[1].toLowerCase(), val = d[2].trim();
        switch (key) {
          case "layout": if ((SLIDE_LAYOUTS as string[]).includes(val)) layout = val as SlideLayout; continue;
          case "subtitle": c.subtitle = val; continue;
          case "kicker": c.kicker = val; continue;
          case "date": c.date = val; continue;
          case "number": c.number = val; continue;
          case "caption": c.caption = val; continue;
          case "image": c.imageUrl = val; continue;
          case "alt": c.imageAlt = val; continue;
          case "background": c.background = val; continue;
          case "quote": c.quote = val.replace(/^["“]|["”]$/g, ""); continue;
          case "by": case "attribution": c.attribution = val; continue;
          case "left": c.leftTitle = val || undefined; target = "left"; continue;
          case "right": c.rightTitle = val || undefined; target = "right"; continue;
          case "timeline": target = "timeline"; continue;
          case "notes": target = "notes"; if (val) notes.push(val); continue;
          case "chart": c.chart = parseChartSpec(val, c.chart); continue;
          case "chart-title": c.chart = { ...(c.chart ?? { type: "bar", categories: [], series: [] }), title: val }; continue;
          case "unit": c.chart = { ...(c.chart ?? { type: "bar", categories: [], series: [] }), unit: val }; continue;
          case "agenda": target = "body"; layout = layout ?? "agenda"; continue;
          default: break; // fall through: not a directive (e.g. "Note: something" inside a bullet)
        }
      }
      if (/^\|.*\|\s*$/.test(line)) {
        if (/^\|?\s*:?-{2,}/.test(line)) continue;
        tableRows.push(line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim()));
        continue;
      }
      if (target === "timeline") { const t = line.replace(/^\s*[-*•]\s+/, ""); if (t) timeline.push(parseTimelineLine(t)); continue; }
      if (c.chart && !/^\s*[-*•]\s|^\s*\d+[.)]\s/.test(line)) { const sr = parseSeriesLine(line.trim()); if (sr) { c.chart = { ...c.chart, series: [...c.chart.series, sr] }; continue; } }
      if (target === "body" || target === "left" || target === "right") bullets[target].push(line);
    }
    if (c.chart && !c.chart.series.length) c.chart = { ...c.chart, series: [{ name: "Series", values: c.chart.categories.map(() => 0) }] };
    if (c.chart) c.chart = { ...c.chart, showLegend: c.chart.series.length > 1 || c.chart.type === "pie" };
    if (bullets.body.length) c.body = bullets.body.join("\n");
    if (bullets.left.length) c.left = bullets.left.join("\n");
    if (bullets.right.length) c.right = bullets.right.join("\n");
    if (timeline.length) c.timeline = timeline;
    if (tableRows.length) c.table = { header: tableRows[0], rows: tableRows.slice(1) };
    if (notes.length) c.notes = notes.join("\n").trim();
    if (!layout) layout = inferLayout(c, index);
    if (layout === "agenda" && !c.agenda) c.agenda = bulletLines(c.body);
    slides.push(buildSlide(layout, c, theme, { footer: opts.footer, slideNumber: index + 1 }));
  });
  return { themeId, slides };
}

export function inferLayout(c: SlideContent, index: number): SlideLayout {
  if (c.timeline?.length) return "timeline";
  if (c.chart) return "chart";
  if (c.table) return "table";
  if (c.quote) return "quote";
  if (c.imageUrl) return "image";
  if (c.leftTitle && c.rightTitle) return "comparison";
  if (c.left || c.right) return "two_column";
  if (index === 0 && !c.body) return "title";
  if (c.number) return "section";
  if (/^(agenda|roadmap|overview|contents|today)\b/i.test(c.title ?? "") && c.body) return "agenda";
  if (!c.body && c.subtitle) return "section";
  if (!c.body && !c.title) return "blank";
  return "bullets";
}

/**
 * Chart directive forms:
 *   "bar | A, B, C | Series 1: 1, 2, 3 | Series 2: 4, 5, 6"   (inline series)
 *   "bar | A | B | C"  or  "bar | A, B, C"                     (categories only; series follow on "Name: 1, 2, 3" lines)
 */
export function parseChartSpec(spec: string, base?: ChartSpec): ChartSpec {
  const parts = spec.split("|").map((p) => p.trim()).filter(Boolean);
  const type = (["bar", "line", "pie"] as const).find((t) => t === parts[0]?.toLowerCase()) ?? base?.type ?? "bar";
  const inlineSeries = parts.length > 2 && parts.slice(2).every((p) => /:\s*-?[\d$%.,\s]+$/.test(p));
  const categories = inlineSeries || parts.length === 2 ? (parts[1] ? parts[1].split(",").map((s) => s.trim()).filter(Boolean) : base?.categories ?? []) : parts.slice(1);
  const series = inlineSeries ? parts.slice(2).map((p) => parseSeriesLine(p)!).filter(Boolean) : [];
  return { ...(base ?? {}), type, categories, series: series.length ? series : base?.series ?? [], showLegend: base?.showLegend ?? (series.length > 1 || type === "pie"), showValues: base?.showValues ?? true };
}

/** "Revenue: 1, 2, 3" → { name, values } (null when the value list is not numeric). */
export function parseSeriesLine(line: string): { name: string; values: number[] } | null {
  const m = line.match(/^([^:|]{1,80}):\s*(-?[\d$%.,\s]+)$/);
  if (!m) return null;
  const values = m[2].split(",").map((v) => v.trim()).filter(Boolean).map((v) => Number(v.replace(/[^0-9.\-]/g, "")));
  if (!values.length || values.some((v) => Number.isNaN(v))) return null;
  return { name: m[1].trim(), values };
}

/** Serialize a deck back to the outline grammar (for the agent's condense/review tools and exports). */
export function deckToOutline(slides: DeckSlide[]): string {
  return slides.map((s) => {
    const c = extractContent(s);
    const out: string[] = [`# ${plainText(c.title ?? "").split("\n")[0] || "(untitled)"}`, `layout: ${s.layout}`];
    if (c.subtitle) out.push(`subtitle: ${plainText(c.subtitle)}`);
    if (c.kicker) out.push(`kicker: ${plainText(c.kicker)}`);
    if (c.number) out.push(`number: ${plainText(c.number)}`);
    if (s.layout === "two_column" || s.layout === "comparison") {
      out.push(`left: ${plainText(c.leftTitle ?? "")}`); if (c.left) out.push(c.left);
      out.push(`right: ${plainText(c.rightTitle ?? "")}`); if (c.right) out.push(c.right);
    } else if (s.layout === "timeline" && c.timeline?.length) {
      out.push("timeline:"); out.push(...c.timeline.map((t) => `- ${t.date} — ${t.label}${t.detail ? ` — ${t.detail}` : ""}`));
    } else if (s.layout === "quote") {
      out.push(`quote: ${plainText(c.quote ?? "")}`); if (c.attribution) out.push(`by: ${plainText(c.attribution)}`);
    } else if (s.layout === "agenda" && c.agenda?.length) {
      out.push(...c.agenda.map((a) => `- ${a}`));
    } else if (c.body) out.push(c.body);
    if (c.table) out.push(`| ${c.table.header.join(" | ")} |`, ...c.table.rows.map((r) => `| ${r.join(" | ")} |`));
    if (c.chart) out.push(`chart: ${c.chart.type} | ${c.chart.categories.join(", ")} | ${c.chart.series.map((sr) => `${sr.name}: ${sr.values.join(", ")}`).join(" | ")}`);
    if (c.caption) out.push(`caption: ${plainText(c.caption)}`);
    if (s.notes.trim()) out.push(`notes: ${s.notes.trim()}`);
    return out.join("\n");
  }).join("\n\n");
}

export const groupIdFactory = () => `g_${nanoid(6)}`;
