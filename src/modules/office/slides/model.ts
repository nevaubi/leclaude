/**
 * Slides content model (isomorphic: client, server, tests).
 *
 * Coordinates are slide pixels on a fixed 1280×720 (16:9) canvas; font sizes
 * are points (PowerPoint units) — the renderer multiplies by 4/3 to get px on
 * the 1280-wide canvas, and the exporter writes them 1:1 on a 13.333"×7.5" page.
 * Colors are "#RRGGBB" or a theme token (bg | fg | accent | accent2 | muted | surface).
 */
import { nanoid } from "nanoid";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export const PT_TO_PX = 4 / 3;
export const GRID = 16;

export type SlideLayout = "title" | "section" | "bullets" | "two_column" | "comparison" | "timeline" | "chart" | "table" | "quote" | "image" | "blank" | "agenda";
export const SLIDE_LAYOUTS: SlideLayout[] = ["title", "section", "bullets", "two_column", "comparison", "timeline", "chart", "table", "quote", "image", "agenda", "blank"];
export const LAYOUT_LABEL: Record<SlideLayout, string> = { title: "Title", section: "Section header", bullets: "Title & bullets", two_column: "Two columns", comparison: "Comparison", timeline: "Timeline", chart: "Chart", table: "Table", quote: "Quote", image: "Image", agenda: "Agenda", blank: "Blank" };

export type ElementType = "text" | "image" | "shape" | "table" | "chart" | "line";
export type ShapeKind = "rect" | "ellipse" | "arrow" | "line";
export type ThemeColorToken = "bg" | "fg" | "accent" | "accent2" | "muted" | "surface";
export type PlaceholderRole = "title" | "subtitle" | "body" | "left" | "right" | "leftTitle" | "rightTitle" | "quote" | "attribution" | "caption" | "number" | "date" | "kicker" | "logo" | "footer" | "item" | "chart" | "table" | "image" | "decor";

export interface ElementStyle {
  fontSize?: number; // pt
  fontFamily?: string; // "heading" | "body" | explicit face
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  opacity?: number; // 0..1
  lineHeight?: number; // multiple
  letterSpacing?: number; // px
  padding?: number; // px inset for text boxes
  /** Images: how the bitmap fits its box. */
  fit?: "contain" | "cover" | "fill";
  /** Lines: "down" = top-left → bottom-right, "up" = bottom-left → top-right. */
  lineDir?: "down" | "up";
  arrowEnd?: boolean;
  /** Tables */
  headerFill?: string;
  headerColor?: string;
  banded?: boolean;
}

export interface ChartSpec {
  type: "bar" | "line" | "pie";
  categories: string[];
  series: { name: string; values: number[] }[];
  title?: string;
  showLegend?: boolean;
  showValues?: boolean;
  unit?: string; // "$", "%", "ng/L"
}

export interface TableSpec {
  header: string[];
  rows: string[][];
  /** Column width fractions (sum ≈ 1). */
  colWidths?: number[];
}

export interface DeckElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  z: number;
  style: ElementStyle;
  /** Markdown-lite: **bold**, *italic*, bullet lines "- ", numbered "1. ", indent with two spaces. */
  text?: string;
  src?: string;
  alt?: string;
  shape?: ShapeKind;
  table?: TableSpec;
  chart?: ChartSpec;
  role?: PlaceholderRole;
  name?: string;
  locked?: boolean;
  groupId?: string;
}

export interface SlideBackground { color?: string; imageUrl?: string }

export interface DeckSlide {
  id: string;
  layout: SlideLayout;
  background?: SlideBackground;
  elements: DeckElement[];
  notes: string;
  transition?: "none" | "fade" | "push" | "wipe";
  hidden?: boolean;
  name?: string;
}

export interface DeckTheme {
  id: string;
  name: string;
  fonts: { heading: string; body: string };
  colors: { bg: string; fg: string; accent: string; muted: string; accent2: string; surface?: string };
  logoText?: string;
  /** Title slides use a darker/accent background in some themes. */
  titleBg?: string;
  titleFg?: string;
}

export interface DeckContent {
  version: 1;
  theme: DeckTheme;
  size: { w: 1280; h: 720 };
  slides: DeckSlide[];
  meta?: { createdWith?: string; sourceFile?: string };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export const THEMES: DeckTheme[] = [
  { id: "calloway-navy", name: "Calloway Navy", fonts: { heading: "Georgia", body: "Calibri" }, colors: { bg: "#FFFFFF", fg: "#14213D", accent: "#1F3A6B", muted: "#6B7280", accent2: "#C8A24A", surface: "#F3F5F9" }, logoText: "Calloway & Reyes LLP", titleBg: "#14213D", titleFg: "#FFFFFF" },
  { id: "counsel-slate", name: "Counsel Slate", fonts: { heading: "Segoe UI", body: "Segoe UI" }, colors: { bg: "#F7F8FA", fg: "#1E2430", accent: "#2F6F8F", muted: "#6E7787", accent2: "#D97706", surface: "#FFFFFF" }, logoText: "Calloway & Reyes LLP", titleBg: "#1E2430", titleFg: "#F7F8FA" },
  { id: "courtroom-serif", name: "Courtroom Serif", fonts: { heading: "Times New Roman", body: "Georgia" }, colors: { bg: "#FBF8F1", fg: "#2B2118", accent: "#7A1F1F", muted: "#7C6F64", accent2: "#B08D57", surface: "#F3EDE0" }, logoText: "Calloway & Reyes LLP", titleBg: "#2B2118", titleFg: "#FBF8F1" },
  { id: "modern-mono", name: "Modern Mono", fonts: { heading: "Consolas", body: "Arial" }, colors: { bg: "#111318", fg: "#F2F4F8", accent: "#7CC4FF", muted: "#9AA3B2", accent2: "#FFB454", surface: "#1B1F27" }, logoText: "C&R", titleBg: "#0B0D12", titleFg: "#F2F4F8" },
  { id: "client-light", name: "Client Light", fonts: { heading: "Calibri", body: "Calibri" }, colors: { bg: "#FFFFFF", fg: "#222222", accent: "#0F766E", muted: "#6B7280", accent2: "#F59E0B", surface: "#F0FDFA" }, logoText: "Calloway & Reyes LLP", titleBg: "#0F766E", titleFg: "#FFFFFF" },
  { id: "verdict-ember", name: "Verdict Ember", fonts: { heading: "Cambria", body: "Arial" }, colors: { bg: "#1C1917", fg: "#FAFAF9", accent: "#F97316", muted: "#A8A29E", accent2: "#FBBF24", surface: "#292524" }, logoText: "Calloway & Reyes LLP", titleBg: "#0C0A09", titleFg: "#FAFAF9" },
];

export const DEFAULT_THEME_ID = "calloway-navy";

export function getTheme(id: string | undefined | null): DeckTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

const FONT_STACKS: Record<string, string> = {
  Georgia: "Georgia, 'Source Serif 4 Variable', 'Times New Roman', serif",
  "Times New Roman": "'Times New Roman', Times, 'Source Serif 4 Variable', serif",
  Cambria: "Cambria, Georgia, 'Source Serif 4 Variable', serif",
  Garamond: "Garamond, 'EB Garamond', Georgia, serif",
  Calibri: "Calibri, 'Inter Variable', 'Segoe UI', system-ui, sans-serif",
  "Segoe UI": "'Segoe UI', 'Inter Variable', system-ui, sans-serif",
  Arial: "Arial, Helvetica, 'Inter Variable', sans-serif",
  Helvetica: "Helvetica, Arial, 'Inter Variable', sans-serif",
  "Trebuchet MS": "'Trebuchet MS', 'Inter Variable', sans-serif",
  Verdana: "Verdana, Geneva, 'Inter Variable', sans-serif",
  Consolas: "Consolas, 'JetBrains Mono Variable', 'Courier New', monospace",
  "Courier New": "'Courier New', 'JetBrains Mono Variable', monospace",
};
export const FONT_FACES = Object.keys(FONT_STACKS);

export function resolveFontFace(family: string | undefined, theme: DeckTheme, fallback: "heading" | "body" = "body"): string {
  if (!family || family === "body") return theme.fonts.body;
  if (family === "heading") return theme.fonts.heading;
  return family;
}

export function fontStack(face: string): string {
  return FONT_STACKS[face] ?? `'${face}', 'Inter Variable', system-ui, sans-serif`;
}

const TOKENS: ThemeColorToken[] = ["bg", "fg", "accent", "accent2", "muted", "surface"];
export function isColorToken(v: string | undefined): v is ThemeColorToken {
  return Boolean(v) && (TOKENS as string[]).includes(v as string);
}

export function resolveColor(value: string | undefined, theme: DeckTheme, fallback = "transparent"): string {
  if (!value) return fallback;
  if (isColorToken(value)) return value === "surface" ? (theme.colors.surface ?? theme.colors.bg) : theme.colors[value];
  return value;
}

/** Hex → "RRGGBB" for pptxgenjs; tokens resolved first. */
export function hexForExport(value: string | undefined, theme: DeckTheme, fallback = "000000"): string {
  const v = resolveColor(value, theme, "");
  const m = v.match(/^#?([0-9a-f]{6})$/i);
  if (m) return m[1].toUpperCase();
  const short = v.match(/^#?([0-9a-f]{3})$/i);
  if (short) return short[1].split("").map((c) => c + c).join("").toUpperCase();
  return fallback;
}

export function isDark(hex: string): boolean {
  const m = hex.replace("#", "");
  if (m.length < 6) return false;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

// ---------------------------------------------------------------------------
// Ids and factories
// ---------------------------------------------------------------------------

export const newSlideId = () => `sl_${nanoid(8)}`;
export const newElementId = () => `el_${nanoid(8)}`;

export function emptyDeck(themeId: string = DEFAULT_THEME_ID): DeckContent {
  return { version: 1, theme: getTheme(themeId), size: { w: SLIDE_W, h: SLIDE_H }, slides: [] };
}

export function makeElement(partial: Partial<DeckElement> & { type: ElementType }): DeckElement {
  return { id: newElementId(), x: 80, y: 80, w: 400, h: 120, z: 0, style: {}, ...partial };
}

export function makeSlide(layout: SlideLayout, elements: DeckElement[] = [], extra: Partial<DeckSlide> = {}): DeckSlide {
  return { id: newSlideId(), layout, elements: elements.map((e, i) => ({ ...e, z: e.z ?? i })), notes: "", ...extra };
}

export function cloneDeck(deck: DeckContent): DeckContent {
  return JSON.parse(JSON.stringify(deck)) as DeckContent;
}

/** Deep copy of a slide with fresh ids (elements and slide). */
export function cloneSlide(slide: DeckSlide, opts: { keepIds?: boolean } = {}): DeckSlide {
  const copy = JSON.parse(JSON.stringify(slide)) as DeckSlide;
  if (opts.keepIds) return copy;
  copy.id = newSlideId();
  const groupMap = new Map<string, string>();
  copy.elements = copy.elements.map((e) => {
    const next: DeckElement = { ...e, id: newElementId() };
    if (e.groupId) { if (!groupMap.has(e.groupId)) groupMap.set(e.groupId, `g_${nanoid(6)}`); next.groupId = groupMap.get(e.groupId); }
    return next;
  });
  return copy;
}

// ---------------------------------------------------------------------------
// Markdown-lite
// ---------------------------------------------------------------------------

export interface TextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean }
export interface TextLine { indent: number; kind: "para" | "bullet" | "number"; runs: TextRun[] }

/** Parse markdown-lite into lines: "- " bullets, "1. " numbers, two-space indents, **bold**, *italic*, __underline__. */
export function parseMarkdownLite(text: string | undefined): TextLine[] {
  const out: TextLine[] = [];
  for (const raw of (text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const m = raw.match(/^(\s*)(?:([-•*])\s+|(\d+)[.)]\s+)?(.*)$/);
    const spaces = m?.[1] ?? "";
    const indent = Math.min(4, Math.floor(spaces.replace(/\t/g, "  ").length / 2));
    const kind: TextLine["kind"] = m?.[2] ? "bullet" : m?.[3] ? "number" : "para";
    out.push({ indent, kind, runs: parseInline(m?.[4] ?? raw) });
  }
  return out;
}

export function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1]) runs.push({ text: m[2], bold: true });
    else if (m[3]) runs.push({ text: m[4], underline: true });
    else runs.push({ text: m[6], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text: "" }];
}

export function serializeMarkdownLite(lines: TextLine[]): string {
  return lines
    .map((l) => {
      const prefix = "  ".repeat(l.indent) + (l.kind === "bullet" ? "- " : l.kind === "number" ? "1. " : "");
      return prefix + l.runs.map((r) => { let t = r.text; if (r.bold) t = `**${t}**`; if (r.italic) t = `*${t}*`; if (r.underline) t = `__${t}__`; return t; }).join("");
    })
    .join("\n");
}

/** Plain text (markers stripped), one line per paragraph. */
export function plainText(text: string | undefined): string {
  return parseMarkdownLite(text).map((l) => l.runs.map((r) => r.text).join("")).join("\n");
}

export function wordCount(text: string | undefined): number {
  return plainText(text).split(/\s+/).filter(Boolean).length;
}

/** Bullet lines of a text element (plain). */
export function bulletLines(text: string | undefined): string[] {
  return parseMarkdownLite(text).filter((l) => l.runs.some((r) => r.text.trim())).map((l) => l.runs.map((r) => r.text).join("").trim());
}

// ---------------------------------------------------------------------------
// Slide text helpers
// ---------------------------------------------------------------------------

export function findByRole(slide: DeckSlide, role: PlaceholderRole): DeckElement | undefined {
  return slide.elements.find((e) => e.role === role && e.type === "text");
}

export function slideTitle(slide: DeckSlide): string {
  const t = findByRole(slide, "title") ?? findByRole(slide, "quote") ?? slide.elements.filter((e) => e.type === "text" && e.role !== "footer" && e.role !== "logo" && e.text?.trim()).sort((a, b) => a.y - b.y)[0];
  return plainText(t?.text).split("\n")[0]?.trim() ?? "";
}

export function slideBodyText(slide: DeckSlide): string {
  return slide.elements
    .filter((e) => e.type === "text" && e.text?.trim() && e.role !== "title" && e.role !== "footer" && e.role !== "logo")
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((e) => plainText(e.text))
    .join("\n");
}

export function slidePlainText(slide: DeckSlide): string {
  const parts = [slideTitle(slide), slideBodyText(slide)];
  for (const e of slide.elements) {
    if (e.type === "table" && e.table) parts.push([e.table.header.join(" | "), ...e.table.rows.map((r) => r.join(" | "))].join("\n"));
    if (e.type === "chart" && e.chart) parts.push(`${e.chart.title ?? "Chart"}: ${e.chart.categories.join(", ")}`);
  }
  if (slide.notes) parts.push(slide.notes);
  return parts.filter(Boolean).join("\n");
}

export function deckPlainText(deck: DeckContent): string {
  return deck.slides.map((s, i) => `Slide ${i + 1}\n${slidePlainText(s)}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }

export function clampToSlide(el: DeckElement): DeckElement {
  const w = Math.max(8, Math.min(SLIDE_W, el.w));
  const h = Math.max(8, Math.min(SLIDE_H, el.h));
  const x = Math.max(-w + 8, Math.min(SLIDE_W - 8, el.x));
  const y = Math.max(-h + 8, Math.min(SLIDE_H - 8, el.y));
  return { ...el, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function withinSlide(el: Rect, tolerance = 0): boolean {
  return el.x >= -tolerance && el.y >= -tolerance && el.x + el.w <= SLIDE_W + tolerance && el.y + el.h <= SLIDE_H + tolerance && el.w > 0 && el.h > 0;
}

export function unionRect(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x1 = Math.min(...rects.map((r) => r.x)), y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Rough text-fit estimate: how many wrapped lines the text needs at a font size
 * versus how many fit in the box. Used by restyle/review and the overflow badge.
 */
export function estimateTextFit(el: DeckElement, theme: DeckTheme): { needed: number; available: number; overflow: boolean; fontSize: number } {
  const fontSize = el.style.fontSize ?? 18;
  const pxSize = fontSize * PT_TO_PX;
  const pad = el.style.padding ?? 8;
  const face = resolveFontFace(el.style.fontFamily, theme);
  const charW = pxSize * (/(Georgia|Times|Cambria|Garamond)/.test(face) ? 0.5 : /Consolas|Courier/.test(face) ? 0.6 : 0.52);
  const lineH = pxSize * (el.style.lineHeight ?? 1.25);
  const usableW = Math.max(20, el.w - pad * 2);
  const lines = parseMarkdownLite(el.text);
  let needed = 0;
  for (const l of lines) {
    const text = l.runs.map((r) => r.text).join("");
    const indentPx = l.indent * 28 + (l.kind !== "para" ? 26 : 0);
    const perLine = Math.max(4, Math.floor((usableW - indentPx) / charW));
    needed += Math.max(1, Math.ceil(text.length / perLine));
  }
  const available = Math.max(1, Math.floor((el.h - pad * 2) / lineH));
  return { needed, available, overflow: needed > available, fontSize };
}

/** Largest font size (≥ min) at which the text fits the box. */
export function fitFontSize(el: DeckElement, theme: DeckTheme, max: number, min: number): number {
  for (let size = max; size >= min; size -= 1) {
    const fit = estimateTextFit({ ...el, style: { ...el.style, fontSize: size } }, theme);
    if (!fit.overflow) return size;
  }
  return min;
}

export function normalizeDeck(raw: unknown): DeckContent {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<DeckContent>;
  const theme = d.theme && typeof d.theme === "object" && (d.theme as DeckTheme).colors ? { ...getTheme((d.theme as DeckTheme).id), ...(d.theme as DeckTheme) } : getTheme(DEFAULT_THEME_ID);
  const slides = Array.isArray(d.slides) ? d.slides.map((s, i) => normalizeSlide(s, i)) : [];
  return { version: 1, theme, size: { w: SLIDE_W, h: SLIDE_H }, slides, meta: d.meta };
}

export function normalizeSlide(raw: unknown, index = 0): DeckSlide {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<DeckSlide>;
  const layout = (SLIDE_LAYOUTS as string[]).includes(String(s.layout)) ? (s.layout as SlideLayout) : "blank";
  const elements = Array.isArray(s.elements) ? s.elements.map((e, i) => normalizeElement(e, i)) : [];
  return { id: typeof s.id === "string" && s.id ? s.id : `sl_seed_${index}_${nanoid(4)}`, layout, background: s.background, elements, notes: typeof s.notes === "string" ? s.notes : "", transition: s.transition, hidden: Boolean(s.hidden), name: s.name };
}

export function normalizeElement(raw: unknown, index = 0): DeckElement {
  const e = (raw && typeof raw === "object" ? raw : {}) as Partial<DeckElement>;
  const type: ElementType = (["text", "image", "shape", "table", "chart", "line"] as string[]).includes(String(e.type)) ? (e.type as ElementType) : "text";
  return {
    id: typeof e.id === "string" && e.id ? e.id : newElementId(),
    type,
    x: num(e.x, 80), y: num(e.y, 80), w: num(e.w, 400), h: num(e.h, 120),
    rotation: e.rotation ? num(e.rotation, 0) : undefined,
    z: num(e.z, index),
    style: e.style && typeof e.style === "object" ? e.style : {},
    text: typeof e.text === "string" ? e.text : type === "text" ? "" : undefined,
    src: typeof e.src === "string" ? e.src : undefined,
    alt: typeof e.alt === "string" ? e.alt : undefined,
    shape: e.shape,
    table: e.table && Array.isArray(e.table.header) ? { header: e.table.header.map(String), rows: (e.table.rows ?? []).map((r) => (Array.isArray(r) ? r.map(String) : [])), colWidths: e.table.colWidths } : undefined,
    chart: e.chart && Array.isArray(e.chart.categories) ? { type: (["bar", "line", "pie"] as string[]).includes(e.chart.type) ? e.chart.type : "bar", categories: e.chart.categories.map(String), series: (e.chart.series ?? []).map((s) => ({ name: String(s.name ?? "Series"), values: (s.values ?? []).map((v) => Number(v) || 0) })), title: e.chart.title, showLegend: e.chart.showLegend, showValues: e.chart.showValues, unit: e.chart.unit } : undefined,
    role: e.role,
    name: e.name,
    locked: e.locked,
    groupId: e.groupId,
  };
}

function num(v: unknown, d: number) { const n = Number(v); return Number.isFinite(n) ? n : d; }

export function deckStats(deck: DeckContent) {
  const slides = deck.slides.length;
  const hidden = deck.slides.filter((s) => s.hidden).length;
  const words = deck.slides.reduce((n, s) => n + s.elements.filter((e) => e.type === "text").reduce((m, e) => m + wordCount(e.text), 0), 0);
  const notes = deck.slides.filter((s) => s.notes.trim()).length;
  const images = deck.slides.reduce((n, s) => n + s.elements.filter((e) => e.type === "image").length, 0);
  const charts = deck.slides.reduce((n, s) => n + s.elements.filter((e) => e.type === "chart").length, 0);
  const tables = deck.slides.reduce((n, s) => n + s.elements.filter((e) => e.type === "table").length, 0);
  return { slides, hidden, words, notes, images, charts, tables };
}
