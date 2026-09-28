/**
 * styles.xml ⇄ CellStyle. Reading resolves fonts, fills, borders, alignment,
 * protection and number formats (built-in ids and custom numFmts) with theme,
 * indexed and tinted colors. Writing either builds a complete stylesheet
 * (new workbooks) or appends only the new entries to an imported stylesheet
 * so the original cellXfs indices (and their unmodeled features) stay valid.
 */
import type { BorderEdge, BorderLineStyle, CellBorders, CellStyle, HAlign, VAlign } from "../model";
import { attrs, child, children, el, esc, parseXml, splitTopLevel, text, XML_DECL, type XNode } from "./xml";

// ------------------------------------------------------------------ number formats

export const BUILTIN_NUMFMTS: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
  5: '"$"#,##0_);\\("$"#,##0\\)', 6: '"$"#,##0_);[Red]\\("$"#,##0\\)', 7: '"$"#,##0.00_);\\("$"#,##0.00\\)', 8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
  14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
};

const BUILTIN_BY_CODE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const [id, code] of Object.entries(BUILTIN_NUMFMTS)) if (!m.has(code)) m.set(code, Number(id));
  m.set("mm-dd-yy", 14);
  return m;
})();

/** Model numFmt (undefined = General, "text" = @) from a format code. */
export function modelNumFmt(code: string | undefined): string | undefined {
  if (!code || code === "General") return undefined;
  if (code === "@") return "text";
  if (code === "mm-dd-yy") return "m/d/yyyy";
  return code;
}

/** OOXML format code for a model numFmt. */
export function codeForNumFmt(fmt: string | undefined): string {
  if (!fmt || fmt === "General") return "General";
  if (fmt === "text") return "@";
  return fmt;
}

/** A date-only format (no time part, not elapsed time) — numbers with it import as ISO dates. */
export function isDateOnlyFormat(code: string | undefined): boolean {
  if (!code) return false;
  const f = code.toLowerCase().replace(/"[^"]*"|\\./g, "").replace(/\[\$[^\]]*\]/g, "");
  if (/\[[hms]+\]/.test(f) || /[hs]/.test(f.replace(/\[[^\]]*\]/g, ""))) return false;
  if (/[#0?]/.test(f.replace(/\[[^\]]*\]/g, ""))) return false;
  return /y/.test(f) || /d/.test(f);
}

// ------------------------------------------------------------------ colors

const INDEXED: string[] = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF", "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

export const DEFAULT_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];

/** Theme palette in SpreadsheetML index order: lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink. */
export function parseTheme(xml: string | undefined): string[] {
  if (!xml) return DEFAULT_THEME;
  try {
    const doc = parseXml(xml);
    const scheme = child(child(child(doc, "theme"), "themeElements"), "clrScheme");
    if (!scheme) return DEFAULT_THEME;
    const colorOf = (name: string, fallback: string) => {
      const n = child(scheme, name);
      const srgb = child(n, "srgbClr"), sys = child(n, "sysClr");
      return (attrs(srgb).val ?? attrs(sys).lastClr ?? fallback).toUpperCase();
    };
    const names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
    return names.map((n, i) => colorOf(n, DEFAULT_THEME[i]));
  } catch { return DEFAULT_THEME; }
}

function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let rr = l, gg = l, bb = l;
  if (s) { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; rr = hue(p, q, h + 1 / 3); gg = hue(p, q, h); bb = hue(p, q, h - 1 / 3); }
  return [rr, gg, bb].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Resolve a CT_Color node to "#RRGGBB" (undefined for auto / system colors without a value). */
export function resolveColor(node: XNode | undefined, theme: string[]): string | undefined {
  if (!node) return undefined;
  const a = attrs(node);
  let hex: string | undefined;
  if (a.rgb) hex = a.rgb.length === 8 ? a.rgb.slice(2) : a.rgb.slice(-6);
  else if (a.theme !== undefined) hex = theme[Number(a.theme)] ?? undefined;
  else if (a.indexed !== undefined) { const i = Number(a.indexed); if (i >= 64) return undefined; hex = INDEXED[i]; } // 64/65 = system foreground/background (auto)
  else if (a.auto === "1" || a.auto === "true") return undefined;
  if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return undefined;
  if (a.tint) hex = applyTint(hex.toUpperCase(), Number(a.tint));
  return `#${hex.toUpperCase()}`;
}

function colorXml(tag: string, hex: string | undefined): string {
  if (!hex) return "";
  return el(tag, { rgb: `FF${hex.replace("#", "").toUpperCase().padStart(6, "0").slice(-6)}` });
}

// ------------------------------------------------------------------ parsing

export interface ParsedStyles {
  /** Style of each cellXfs entry (index = xf id). */
  xfs: CellStyle[];
  /** Differential formats (conditional formatting), index = dxfId. */
  dxfs: CellStyle[];
  numFmtCodes: Record<number, string>;
  /** Number format code of each xf (for date detection). */
  xfNumFmtCode: (string | undefined)[];
  defaultFont: { name?: string; size?: number; color?: string };
}

interface FontInfo { bold?: boolean; italic?: boolean; underline?: boolean; underlineStyle?: CellStyle["underlineStyle"]; strike?: boolean; size?: number; name?: string; color?: string; vertAlign?: CellStyle["vertAlign"] }

function parseFont(f: XNode | undefined, theme: string[]): FontInfo {
  if (!f) return {};
  const out: FontInfo = {};
  const on = (n: string) => { const c = child(f, n); if (!c) return false; const v = attrs(c).val; return v === undefined || v === "1" || v === "true"; };
  if (on("b")) out.bold = true;
  if (on("i")) out.italic = true;
  if (on("strike")) out.strike = true;
  const u = child(f, "u");
  if (u) { const v = attrs(u).val ?? "single"; if (v !== "none") { out.underline = true; if (v !== "single") out.underlineStyle = v as CellStyle["underlineStyle"]; } }
  const sz = attrs(child(f, "sz")).val; if (sz) out.size = Number(sz);
  const name = attrs(child(f, "name")).val; if (name) out.name = name;
  const color = resolveColor(child(f, "color"), theme); if (color) out.color = color;
  const va = attrs(child(f, "vertAlign")).val; if (va === "superscript" || va === "subscript") out.vertAlign = va;
  return out;
}

const BORDER_STYLES = new Set<BorderLineStyle>(["thin", "medium", "thick", "dashed", "dotted", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"]);

function parseBorder(b: XNode | undefined, theme: string[]): CellBorders | undefined {
  if (!b) return undefined;
  const out: CellBorders = {};
  const edge = (name: string): BorderEdge | undefined => {
    const e = child(b, name) ?? (name === "left" ? child(b, "start") : name === "right" ? child(b, "end") : undefined);
    const st = attrs(e).style as BorderLineStyle | undefined;
    if (!st || !BORDER_STYLES.has(st)) return undefined;
    const color = resolveColor(child(e, "color"), theme);
    return color ? { style: st, color } : { style: st };
  };
  for (const side of ["top", "right", "bottom", "left", "diagonal"] as const) { const e = edge(side); if (e) out[side] = e; }
  const a = attrs(b);
  if (out.diagonal) { if (a.diagonalUp === "1" || a.diagonalUp === "true") out.diagonalUp = true; if (a.diagonalDown === "1" || a.diagonalDown === "true") out.diagonalDown = true; }
  return Object.keys(out).length ? out : undefined;
}

function parseFill(f: XNode | undefined, theme: string[], dxf = false): Pick<CellStyle, "fill" | "fillPattern" | "fillBg"> {
  const pf = child(f, "patternFill");
  if (!pf) return {};
  const type = attrs(pf).patternType ?? (dxf ? "solid" : "none");
  if (type === "none") return {};
  const fg = resolveColor(child(pf, "fgColor"), theme);
  const bg = resolveColor(child(pf, "bgColor"), theme);
  if (type === "solid") { const c = dxf ? (bg ?? fg) : (fg ?? bg); return c ? { fill: c } : {}; }
  if (type === "gray125" && !dxf) return {};
  const out: Pick<CellStyle, "fill" | "fillPattern" | "fillBg"> = { fillPattern: type };
  if (fg) out.fill = fg;
  if (bg) out.fillBg = bg;
  return out;
}

const H_ALIGN: Record<string, HAlign> = { left: "left", center: "center", right: "right", justify: "justify", fill: "fill", centerContinuous: "centerContinuous", distributed: "distributed" };
const V_ALIGN: Record<string, VAlign> = { top: "top", center: "middle", bottom: "bottom", justify: "justify", distributed: "distributed" };

function fontToStyle(font: FontInfo, def: FontInfo, st: CellStyle) {
  if (font.bold) st.bold = true;
  if (font.italic) st.italic = true;
  if (font.underline) st.underline = true;
  if (font.underlineStyle) st.underlineStyle = font.underlineStyle;
  if (font.strike) st.strike = true;
  if (font.vertAlign) st.vertAlign = font.vertAlign;
  if (font.size !== undefined && font.size !== def.size) st.fontSize = font.size;
  if (font.name && font.name !== def.name) st.fontFamily = font.name;
  if (font.color && font.color !== def.color && !(font.color === "#000000" && !def.color)) st.color = font.color;
}

export function parseStyles(xml: string | undefined, theme: string[]): ParsedStyles {
  const empty: ParsedStyles = { xfs: [], dxfs: [], numFmtCodes: {}, xfNumFmtCode: [], defaultFont: {} };
  if (!xml) return empty;
  const doc = child(parseXml(xml), "styleSheet");
  if (!doc) return empty;
  const numFmtCodes: Record<number, string> = {};
  for (const n of children(child(doc, "numFmts"), "numFmt")) { const a = attrs(n); numFmtCodes[Number(a.numFmtId)] = a.formatCode ?? ""; }
  const fonts = children(child(doc, "fonts"), "font").map((f) => parseFont(f, theme));
  const fills = children(child(doc, "fills"), "fill");
  const borders = children(child(doc, "borders"), "border");
  const def = fonts[0] ?? {};
  const xfs: CellStyle[] = [];
  const xfNumFmtCode: (string | undefined)[] = [];
  for (const xf of children(child(doc, "cellXfs"), "xf")) {
    const a = attrs(xf);
    const st: CellStyle = {};
    fontToStyle(fonts[Number(a.fontId ?? 0)] ?? {}, def, st);
    Object.assign(st, parseFill(fills[Number(a.fillId ?? 0)], theme));
    const b = parseBorder(borders[Number(a.borderId ?? 0)], theme);
    if (b) { const legacy = legacyBorder(b); if (legacy) st.border = legacy; else st.borders = b; }
    const id = Number(a.numFmtId ?? 0);
    const code = numFmtCodes[id] ?? BUILTIN_NUMFMTS[id];
    xfNumFmtCode.push(code);
    const nf = modelNumFmt(code);
    if (nf) st.numFmt = nf;
    const al = attrs(child(xf, "alignment"));
    if (al.horizontal && H_ALIGN[al.horizontal]) st.align = H_ALIGN[al.horizontal];
    if (al.vertical && V_ALIGN[al.vertical]) st.valign = V_ALIGN[al.vertical];
    if (al.wrapText === "1" || al.wrapText === "true") st.wrap = true;
    if (al.indent && Number(al.indent)) st.indent = Number(al.indent);
    if (al.textRotation && Number(al.textRotation)) st.rotation = Number(al.textRotation);
    if (al.shrinkToFit === "1" || al.shrinkToFit === "true") st.shrink = true;
    const pr = attrs(child(xf, "protection"));
    if (pr.locked === "0" || pr.locked === "false") st.locked = false;
    if (pr.hidden === "1" || pr.hidden === "true") st.hideFormula = true;
    xfs.push(st);
  }
  const dxfs: CellStyle[] = children(child(doc, "dxfs"), "dxf").map((d) => {
    const st: CellStyle = {};
    const f = child(d, "font");
    if (f) fontToStyle(parseFont(f, theme), {}, st);
    Object.assign(st, parseFill(child(d, "fill"), theme, true));
    const b = parseBorder(child(d, "border"), theme); if (b) st.borders = b;
    const nf = child(d, "numFmt"); if (nf) { const m = modelNumFmt(attrs(nf).formatCode); if (m) st.numFmt = m; }
    return st;
  });
  return { xfs, dxfs, numFmtCodes, xfNumFmtCode, defaultFont: { name: def.name, size: def.size, color: def.color } };
}

/** Per-edge borders that exactly match one of the app's shorthand values (auto colour) collapse to it. */
function legacyBorder(b: CellBorders): CellStyle["border"] | undefined {
  if (b.diagonal) return undefined;
  const edges = [b.top, b.right, b.bottom, b.left];
  if (edges.some((e) => e?.color)) return undefined;
  const all = (st: BorderLineStyle) => edges.every((e) => e?.style === st);
  if (all("thin")) return "thin";
  if (all("medium")) return "medium";
  if (all("thick")) return "thick";
  if (b.bottom?.style === "thin" && !b.top && !b.left && !b.right) return "bottom";
  if (b.top?.style === "thin" && !b.bottom && !b.left && !b.right) return "top";
  return undefined;
}

// ------------------------------------------------------------------ writing

function dxfKey(st: CellStyle): string { return JSON.stringify(Object.keys(st).sort().map((k) => [k, (st as Record<string, unknown>)[k]])); }

/** Legacy `border` shorthand → per-edge borders. */
export function effectiveBorders(st: CellStyle): CellBorders | undefined {
  if (st.borders && Object.keys(st.borders).length) return st.borders;
  const thin: BorderEdge = { style: "thin" };
  switch (st.border) {
    case "thin": case "all": case "outline": return { top: thin, right: thin, bottom: thin, left: thin };
    case "medium": return { top: { style: "medium" }, right: { style: "medium" }, bottom: { style: "medium" }, left: { style: "medium" } };
    case "thick": return { top: { style: "thick" }, right: { style: "thick" }, bottom: { style: "thick" }, left: { style: "thick" } };
    case "bottom": return { bottom: thin };
    case "top": return { top: thin };
    default: return undefined;
  }
}

function fontXml(st: CellStyle, def: { name: string; size: number }, dxf = false): string {
  let inner = "";
  if (st.bold) inner += "<b/>";
  if (st.italic) inner += "<i/>";
  if (st.strike) inner += "<strike/>";
  if (st.underline) inner += st.underlineStyle ? el("u", { val: st.underlineStyle }) : "<u/>";
  if (st.vertAlign) inner += el("vertAlign", { val: st.vertAlign });
  if (!dxf || st.fontSize) inner += el("sz", { val: st.fontSize ?? def.size });
  if (st.color) inner += colorXml("color", st.color);
  if (!dxf || st.fontFamily) inner += el("name", { val: st.fontFamily ?? def.name });
  if (!dxf) inner += el("family", { val: 2 });
  return `<font>${inner}</font>`;
}

function fillXml(st: CellStyle, dxf = false): string | null {
  if (!st.fill && !st.fillPattern) return null;
  if (!st.fillPattern || st.fillPattern === "solid") {
    return dxf
      ? `<fill><patternFill patternType="solid">${colorXml("bgColor", st.fill)}</patternFill></fill>`
      : `<fill><patternFill patternType="solid">${colorXml("fgColor", st.fill)}<bgColor indexed="64"/></patternFill></fill>`;
  }
  return `<fill>${el("patternFill", { patternType: st.fillPattern }, `${colorXml("fgColor", st.fill)}${colorXml("bgColor", st.fillBg)}`)}</fill>`;
}

function borderXml(b: CellBorders | undefined): string | null {
  if (!b) return null;
  const edge = (tag: string, e?: BorderEdge) => (e ? el(tag, { style: e.style }, colorXml("color", e.color) || el("color", { indexed: 64 })) : `<${tag}/>`);
  return `<border${b.diagonalUp ? ' diagonalUp="1"' : ""}${b.diagonalDown ? ' diagonalDown="1"' : ""}>${edge("left", b.left)}${edge("right", b.right)}${edge("top", b.top)}${edge("bottom", b.bottom)}${edge("diagonal", b.diagonal)}</border>`;
}

const H_OUT: Record<string, string> = { left: "left", center: "center", right: "right", justify: "justify", fill: "fill", centerContinuous: "centerContinuous", distributed: "distributed" };
const V_OUT: Record<string, string> = { top: "top", middle: "center", bottom: "bottom", justify: "justify", distributed: "distributed" };

function alignmentXml(st: CellStyle): string {
  const a = { horizontal: st.align ? H_OUT[st.align] : undefined, vertical: st.valign ? V_OUT[st.valign] : undefined, wrapText: st.wrap || undefined, indent: st.indent || undefined, textRotation: st.rotation || undefined, shrinkToFit: st.shrink || undefined };
  return Object.values(a).some((v) => v !== undefined) ? el("alignment", a) : "";
}

interface Container { tag: string; items: string[]; newItems: string[]; baseCount: number }

/**
 * Builds cellXfs / dxfs for a workbook. `original` = an imported styles.xml: its entries are kept and new ones
 * appended, so existing xf indices remain valid; otherwise a complete stylesheet is produced.
 */
export class StylesBuilder {
  private numFmts = new Map<string, number>();
  private newNumFmts: { id: number; code: string }[] = [];
  private nextNumFmt = 164;
  private fonts: Container = { tag: "fonts", items: [], newItems: [], baseCount: 0 };
  private fills: Container = { tag: "fills", items: [], newItems: [], baseCount: 0 };
  private borders: Container = { tag: "borders", items: [], newItems: [], baseCount: 0 };
  private xfs: Container = { tag: "cellXfs", items: [], newItems: [], baseCount: 0 };
  private dxfs: Container = { tag: "dxfs", items: [], newItems: [], baseCount: 0 };
  private index = new Map<string, number>(); // "<tag>|<xml>" → index
  private def = { name: "Calibri", size: 11 };

  /** styleKey → original dxfs index, so unchanged conditional formats keep their differential format. */
  private originalDxf = new Map<string, number>();

  constructor(private original?: string, originalDxfStyles?: CellStyle[]) {
    originalDxfStyles?.forEach((st, i) => { const k = dxfKey(st); if (!this.originalDxf.has(k)) this.originalDxf.set(k, i); });
    if (original) {
      const doc = child(parseXml(original), "styleSheet");
      for (const n of children(child(doc, "numFmts"), "numFmt")) { const a = attrs(n); const id = Number(a.numFmtId); this.numFmts.set(a.formatCode ?? "", id); this.nextNumFmt = Math.max(this.nextNumFmt, id + 1); }
      this.fonts.baseCount = children(child(doc, "fonts"), "font").length;
      this.fills.baseCount = children(child(doc, "fills"), "fill").length;
      this.borders.baseCount = children(child(doc, "borders"), "border").length;
      this.xfs.baseCount = children(child(doc, "cellXfs"), "xf").length;
      this.dxfs.baseCount = children(child(doc, "dxfs"), "dxf").length;
      const f0 = children(child(doc, "fonts"), "font")[0];
      const name = attrs(child(f0, "name")).val, sz = attrs(child(f0, "sz")).val;
      if (name) this.def.name = name;
      if (sz) this.def.size = Number(sz);
    } else {
      this.add(this.fonts, fontXml({}, this.def));
      this.add(this.fills, '<fill><patternFill patternType="none"/></fill>');
      this.add(this.fills, '<fill><patternFill patternType="gray125"/></fill>');
      this.add(this.borders, "<border><left/><right/><top/><bottom/><diagonal/></border>");
      this.add(this.xfs, '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    }
  }

  /** True when the stylesheet differs from the original (always true for a fresh build). */
  get changed(): boolean {
    return !this.original || [this.fonts, this.fills, this.borders, this.xfs, this.dxfs].some((c) => c.newItems.length) || this.newNumFmts.length > 0;
  }

  private add(c: Container, xml: string): number {
    const key = `${c.tag}|${xml}`;
    const hit = this.index.get(key);
    if (hit !== undefined) return hit;
    const idx = c.baseCount + c.items.length + c.newItems.length;
    if (this.original) c.newItems.push(xml); else c.items.push(xml);
    this.index.set(key, idx);
    return idx;
  }

  numFmtId(fmt: string | undefined): number {
    const code = codeForNumFmt(fmt);
    const builtin = BUILTIN_BY_CODE.get(code);
    if (builtin !== undefined) return builtin;
    const existing = this.numFmts.get(code);
    if (existing !== undefined) return existing;
    const id = this.nextNumFmt++;
    this.numFmts.set(code, id);
    this.newNumFmts.push({ id, code });
    return id;
  }

  /** cellXfs index for a style (0 = default). */
  xf(st: CellStyle | undefined): number {
    if (!st || !Object.keys(st).length) return 0;
    const hasFont = st.bold || st.italic || st.underline || st.strike || st.color || st.fontSize || st.fontFamily || st.vertAlign;
    const fontId = hasFont ? this.add(this.fonts, fontXml(st, this.def)) : 0;
    const fx = fillXml(st);
    const fillId = fx ? this.add(this.fills, fx) : 0;
    const bx = borderXml(effectiveBorders(st));
    const borderId = bx ? this.add(this.borders, bx) : 0;
    const numFmtId = this.numFmtId(st.numFmt);
    const align = alignmentXml(st);
    const prot = st.locked === false || st.hideFormula ? el("protection", { locked: st.locked === false ? "0" : undefined, hidden: st.hideFormula || undefined }) : "";
    const xml = el("xf", {
      numFmtId, fontId, fillId, borderId, xfId: 0,
      applyNumberFormat: numFmtId ? 1 : undefined, applyFont: fontId ? 1 : undefined, applyFill: fillId ? 1 : undefined, applyBorder: borderId ? 1 : undefined,
      applyAlignment: align ? 1 : undefined, applyProtection: prot ? 1 : undefined,
    }, `${align}${prot}`);
    return this.add(this.xfs, xml);
  }

  /** dxfs index for a conditional-format style. */
  dxf(st: CellStyle): number {
    const hit = this.originalDxf.get(dxfKey(st));
    if (hit !== undefined) return hit;
    let inner = "";
    if (st.bold || st.italic || st.underline || st.strike || st.color || st.fontSize || st.fontFamily) inner += fontXml(st, this.def, true);
    if (st.numFmt) inner += el("numFmt", { numFmtId: this.numFmtId(st.numFmt), formatCode: codeForNumFmt(st.numFmt) });
    const fx = fillXml(st, true); if (fx) inner += fx;
    const bx = borderXml(effectiveBorders(st)); if (bx) inner += bx;
    return this.add(this.dxfs, `<dxf>${inner}</dxf>`);
  }

  toXml(): string {
    if (!this.original) return this.fresh();
    if (!this.changed) return this.original;
    return this.appended(this.original);
  }

  private numFmtsXml(list: { id: number; code: string }[]): string {
    return list.map((n) => el("numFmt", { numFmtId: n.id, formatCode: n.code })).join("");
  }

  private fresh(): string {
    const c = (x: Container, inner = x.items.join("")) => `<${x.tag} count="${x.items.length}">${inner}</${x.tag}>`;
    return `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + (this.newNumFmts.length ? `<numFmts count="${this.newNumFmts.length}">${this.numFmtsXml(this.newNumFmts)}</numFmts>` : "")
      + c(this.fonts) + c(this.fills) + c(this.borders)
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + c(this.xfs)
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + `<dxfs count="${this.dxfs.items.length}">${this.dxfs.items.join("")}</dxfs>`
      + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
      + "</styleSheet>";
  }

  private appended(original: string): string {
    const top = splitTopLevel(original);
    const ORDER = ["numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles", "dxfs", "tableStyles", "colors", "extLst"];
    const kids = top.children.map((c) => ({ ...c }));
    const patch = (tag: string, newXml: string, addCount: number) => {
      if (!newXml) return;
      const i = kids.findIndex((k) => k.local === tag);
      if (i >= 0) {
        const k = kids[i];
        let xml = k.xml;
        const countM = /\scount="(\d+)"/.exec(xml.slice(0, xml.indexOf(">") + 1));
        const nextCount = (countM ? Number(countM[1]) : 0) + addCount;
        if (xml.endsWith("/>")) xml = `${xml.slice(0, -2)}>${newXml}</${k.name}>`;
        else { const close = xml.lastIndexOf("</"); xml = `${xml.slice(0, close)}${newXml}${xml.slice(close)}`; }
        const startEnd = xml.indexOf(">");
        let start = xml.slice(0, startEnd);
        start = /\scount="\d+"/.test(start) ? start.replace(/\scount="\d+"/, ` count="${nextCount}"`) : `${start} count="${nextCount}"`;
        kids[i] = { ...k, xml: start + xml.slice(startEnd) };
      } else {
        const pos = ORDER.indexOf(tag);
        let at = kids.findIndex((k) => ORDER.indexOf(k.local) > pos || ORDER.indexOf(k.local) < 0);
        if (at < 0) at = kids.length;
        const prefix = top.rootName.includes(":") ? `${top.rootName.split(":")[0]}:` : "";
        kids.splice(at, 0, { name: prefix + tag, local: tag, xml: `<${prefix}${tag} count="${addCount}">${newXml}</${prefix}${tag}>` });
      }
    };
    const prefix = top.rootName.includes(":") ? `${top.rootName.split(":")[0]}:` : "";
    const px = (xml: string) => (prefix ? xml.replace(/<(\/?)([a-zA-Z])/g, `<$1${prefix}$2`) : xml);
    patch("numFmts", px(this.numFmtsXml(this.newNumFmts)), this.newNumFmts.length);
    patch("fonts", px(this.fonts.newItems.join("")), this.fonts.newItems.length);
    patch("fills", px(this.fills.newItems.join("")), this.fills.newItems.length);
    patch("borders", px(this.borders.newItems.join("")), this.borders.newItems.length);
    patch("cellXfs", px(this.xfs.newItems.join("")), this.xfs.newItems.length);
    patch("dxfs", px(this.dxfs.newItems.join("")), this.dxfs.newItems.length);
    return `${top.prolog}${top.rootStart}${kids.map((k) => k.xml).join("")}${top.rootEnd}`;
  }
}

export { esc, text };
