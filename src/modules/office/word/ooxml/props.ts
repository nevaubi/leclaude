/**
 * Run (w:rPr) and paragraph (w:pPr) property mapping between OOXML and the editor model.
 *
 * The reader maps the properties the editor can show/edit onto marks and node attrs and keeps the complete raw
 * property XML beside them (`docxRun.rpr`, `docx.pPr`). The writer regenerates a property element per property
 * group only when the editor value differs from what the raw XML maps to, and otherwise re-emits the raw child
 * element byte-for-byte — so unmapped properties (theme colors, w14 effects, revisions, borders…) survive edits.
 */
import { HIGHLIGHT_COLORS, FONT_FAMILIES } from "../constants";
import type { PMNode } from "../doc-model";
import { escAttr, kids, parseXml, raw, wval, onOff, type XEl } from "./xml";

type Mark = NonNullable<PMNode["marks"]>[number];

/** Schema order of CT_RPr children. */
export const RPR_ORDER = ["w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath", "w:ins", "w:del", "w:rPrChange"];
/** Schema order of CT_PPr children. */
export const PPR_ORDER = ["w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl", "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap", "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange"];

/** Word's 16 highlight colors (name → CSS). The editor palette wins where it defines a name. */
const WORD_HIGHLIGHT: Record<string, string> = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff" };
for (const h of HIGHLIGHT_COLORS) WORD_HIGHLIGHT[h.docx] = h.css;
const HIGHLIGHT_BY_CSS: Record<string, string> = Object.fromEntries(Object.entries(WORD_HIGHLIGHT).map(([k, v]) => [v.toLowerCase(), k]));
for (const h of HIGHLIGHT_COLORS) HIGHLIGHT_BY_CSS[h.css.toLowerCase()] = h.docx;

export function highlightCss(name: string): string | null { return WORD_HIGHLIGHT[name] ?? null; }
export function highlightName(css: string): string | null { return HIGHLIGHT_BY_CSS[css.toLowerCase()] ?? null; }

/** The mapped run-property values (what the editor can show/edit). */
export interface RunValues {
  bold: boolean; italic: boolean; underline: boolean; strike: boolean; caps: boolean; smallCaps: boolean;
  superscript: boolean; subscript: boolean; color: string | null; size: string | null; font: string | null; highlight: string | null; code: boolean;
}

const EMPTY_RUN: RunValues = { bold: false, italic: false, underline: false, strike: false, caps: false, smallCaps: false, superscript: false, subscript: false, color: null, size: null, font: null, highlight: null, code: false };

function normColor(c: string | null | undefined): string | null {
  if (!c) return null;
  const s = String(c).trim().toLowerCase();
  if (!s || s === "auto") return null;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
  return s;
}
function normSize(s: string | null | undefined): string | null {
  if (!s) return null;
  const n = parseFloat(String(s));
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n * 2) / 2}pt`;
}
function normFont(f: string | null | undefined): string | null {
  if (!f) return null;
  const hit = FONT_FAMILIES.find((x) => x.css === f || x.label === f);
  const name = hit ? hit.docx : String(f).split(",")[0].replace(/['"]/g, "").trim();
  return name || null;
}

/** Run values from a raw w:rPr element (direct formatting only). */
export function runValuesFromRPr(rPr: XEl | null): RunValues {
  const v: RunValues = { ...EMPTY_RUN };
  if (!rPr) return v;
  for (const c of kids(rPr)) {
    switch (c.name) {
      case "w:b": v.bold = onOff(c) ?? false; break;
      case "w:i": v.italic = onOff(c) ?? false; break;
      case "w:u": { const u = wval(c); v.underline = Boolean(u && u !== "none"); break; }
      case "w:strike": if (onOff(c)) v.strike = true; break;
      case "w:dstrike": if (onOff(c)) v.strike = true; break;
      case "w:caps": v.caps = onOff(c) ?? false; break;
      case "w:smallCaps": v.smallCaps = onOff(c) ?? false; break;
      case "w:vertAlign": { const a = wval(c); v.superscript = a === "superscript"; v.subscript = a === "subscript"; break; }
      case "w:color": v.color = normColor(wval(c)); break;
      case "w:sz": { const hp = Number(wval(c)); v.size = Number.isFinite(hp) && hp > 0 ? normSize(String(hp / 2)) : null; break; }
      case "w:rFonts": v.font = c.attrs["w:ascii"] ?? c.attrs["w:hAnsi"] ?? c.attrs["w:cs"] ?? null; break;
      case "w:highlight": { const h = wval(c); v.highlight = h && h !== "none" ? (highlightCss(h) ?? null) : null; break; }
    }
  }
  return v;
}

/** Run values from editor marks. */
export function runValuesFromMarks(marks: Mark[] | undefined): RunValues {
  const v: RunValues = { ...EMPTY_RUN };
  for (const m of marks ?? []) {
    switch (m.type) {
      case "bold": v.bold = true; break;
      case "italic": v.italic = true; break;
      case "underline": v.underline = true; break;
      case "strike": v.strike = true; break;
      case "caps": v.caps = true; break;
      case "smallCaps": v.smallCaps = true; break;
      case "superscript": v.superscript = true; break;
      case "subscript": v.subscript = true; break;
      case "code": v.code = true; break;
      case "highlight": v.highlight = normColor(String(m.attrs?.color ?? "#fff3a3")); break;
      case "textStyle":
        if (m.attrs?.color) v.color = normColor(String(m.attrs.color));
        if (m.attrs?.fontSize) v.size = normSize(String(m.attrs.fontSize));
        if (m.attrs?.fontFamily) v.font = normFont(String(m.attrs.fontFamily));
        break;
    }
  }
  return v;
}

/** Editor marks for run values (reader side). */
export function marksFromRunValues(v: RunValues): Mark[] {
  const out: Mark[] = [];
  if (v.bold) out.push({ type: "bold" });
  if (v.italic) out.push({ type: "italic" });
  if (v.underline) out.push({ type: "underline" });
  if (v.strike) out.push({ type: "strike" });
  if (v.caps) out.push({ type: "caps" });
  if (v.smallCaps) out.push({ type: "smallCaps" });
  if (v.superscript) out.push({ type: "superscript" });
  if (v.subscript) out.push({ type: "subscript" });
  if (v.highlight) out.push({ type: "highlight", attrs: { color: v.highlight } });
  if (v.color || v.size || v.font) out.push({ type: "textStyle", attrs: { color: v.color, fontSize: v.size, fontFamily: v.font } });
  return out;
}

type RunGroup = "bold" | "italic" | "underline" | "strike" | "caps" | "smallCaps" | "vert" | "color" | "size" | "font" | "highlight";
const RUN_GROUP_OF: Record<string, RunGroup> = { "w:b": "bold", "w:i": "italic", "w:u": "underline", "w:strike": "strike", "w:dstrike": "strike", "w:caps": "caps", "w:smallCaps": "smallCaps", "w:vertAlign": "vert", "w:color": "color", "w:sz": "size", "w:rFonts": "font", "w:highlight": "highlight" };

function groupEqual(g: RunGroup, a: RunValues, b: RunValues): boolean {
  switch (g) {
    case "vert": return a.superscript === b.superscript && a.subscript === b.subscript;
    default: return a[g] === b[g];
  }
}

function freshRunElements(g: RunGroup, v: RunValues): [string, string][] {
  switch (g) {
    case "bold": return v.bold ? [["w:b", "<w:b/>"]] : [];
    case "italic": return v.italic ? [["w:i", "<w:i/>"]] : [];
    case "underline": return v.underline ? [["w:u", `<w:u w:val="single"/>`]] : [];
    case "strike": return v.strike ? [["w:strike", "<w:strike/>"]] : [];
    case "caps": return v.caps ? [["w:caps", "<w:caps/>"]] : [];
    case "smallCaps": return v.smallCaps ? [["w:smallCaps", "<w:smallCaps/>"]] : [];
    case "vert": return v.superscript ? [["w:vertAlign", `<w:vertAlign w:val="superscript"/>`]] : v.subscript ? [["w:vertAlign", `<w:vertAlign w:val="subscript"/>`]] : [];
    case "color": return v.color && /^#[0-9a-f]{6}$/.test(v.color) ? [["w:color", `<w:color w:val="${v.color.slice(1).toUpperCase()}"/>`]] : [];
    case "size": { const pt = v.size ? parseFloat(v.size) : NaN; return Number.isFinite(pt) ? [["w:sz", `<w:sz w:val="${Math.round(pt * 2)}"/>`], ["w:szCs", `<w:szCs w:val="${Math.round(pt * 2)}"/>`]] : []; }
    case "font": return v.font ? [["w:rFonts", `<w:rFonts w:ascii="${escAttr(v.font)}" w:hAnsi="${escAttr(v.font)}" w:cs="${escAttr(v.font)}"/>`]] : [];
    case "highlight": {
      if (!v.highlight) return [];
      const name = highlightName(v.highlight);
      return name ? [["w:highlight", `<w:highlight w:val="${name}"/>`]] : [["w:shd", `<w:shd w:val="clear" w:color="auto" w:fill="${v.highlight.replace("#", "").toUpperCase()}"/>`]];
    }
  }
}

function orderIndex(order: string[], name: string) { const i = order.indexOf(name); return i < 0 ? order.length : i; }

function joinOrdered(order: string[], parts: [string, string][]): string {
  return parts.map((p, i) => ({ p, i })).sort((a, b) => orderIndex(order, a.p[0]) - orderIndex(order, b.p[0]) || a.i - b.i).map((x) => x.p[1]).join("");
}

/**
 * Build a w:rPr for a run: raw children kept where the editor value is unchanged, fresh elements elsewhere.
 * `extra` adds fixed elements (e.g. rStyle for footnote references) when the raw rPr has none of that name.
 */
export function buildRPr(marks: Mark[] | undefined, rawRPr: string | null | undefined, extra: [string, string][] = [], opts: { stripRevisions?: boolean } = {}): string {
  const cur = runValuesFromMarks(marks);
  let rawEl: XEl | null = null; let src = "";
  if (rawRPr) { try { const p = parseXml(rawRPr); rawEl = p.root; src = p.src; } catch { rawEl = null; } }
  const base = runValuesFromRPr(rawEl);
  const parts: [string, string][] = [];
  const handled = new Set<RunGroup>();
  if (rawEl) {
    for (const c of kids(rawEl)) {
      if (opts.stripRevisions && /^w:(rPrChange|ins|del|moveFrom|moveTo)$/.test(c.name)) continue;
      const g = RUN_GROUP_OF[c.name];
      if (!g) { parts.push([c.name, raw(src, c)]); continue; }
      if (groupEqual(g, base, cur)) parts.push([c.name, raw(src, c)]);
      else if (!handled.has(g)) { parts.push(...freshRunElements(g, cur)); handled.add(g); }
      handled.add(g);
    }
  }
  for (const g of ["bold", "italic", "underline", "strike", "caps", "smallCaps", "vert", "color", "size", "font", "highlight"] as RunGroup[]) {
    if (handled.has(g)) continue;
    if (!groupEqual(g, base, cur)) parts.push(...freshRunElements(g, cur));
  }
  if (cur.code && !parts.some((p) => p[0] === "w:rFonts")) parts.push(["w:rFonts", `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>`]);
  if (cur.code && !parts.some((p) => p[0] === "w:shd")) parts.push(["w:shd", `<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>`]);
  for (const e of extra) if (!parts.some((p) => p[0] === e[0])) parts.push(e);
  if (!parts.length) return "";
  return `<w:rPr>${joinOrdered(RPR_ORDER, parts)}</w:rPr>`;
}

// ---------------------------------------------------------------------------
// Paragraph properties
// ---------------------------------------------------------------------------

export interface ParaValues {
  styleId: string | null;
  align: string | null; // left(null) | center | right | justify
  spacingBefore: number | null; // pt
  spacingAfter: number | null; // pt
  lineHeight: number | null; // multiplier (auto rule only)
  indent: number | null; // 0.5in units (left indent)
}

const JC_TO_ALIGN: Record<string, string | null> = { left: null, start: null, center: "center", right: "right", end: "right", both: "justify", distribute: "justify", thaiDistribute: "justify", lowKashida: "justify", mediumKashida: "justify", highKashida: "justify" };
const ALIGN_TO_JC: Record<string, string> = { center: "center", right: "right", justify: "both", left: "left" };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function paraValuesFromPPr(pPr: XEl | null): ParaValues {
  const v: ParaValues = { styleId: null, align: null, spacingBefore: null, spacingAfter: null, lineHeight: null, indent: null };
  if (!pPr) return v;
  for (const c of kids(pPr)) {
    switch (c.name) {
      case "w:pStyle": v.styleId = wval(c) ?? null; break;
      case "w:jc": { const j = wval(c) ?? "left"; v.align = j in JC_TO_ALIGN ? JC_TO_ALIGN[j] : null; break; }
      case "w:spacing": {
        const b = c.attrs["w:before"], a = c.attrs["w:after"], l = c.attrs["w:line"], rule = c.attrs["w:lineRule"];
        if (b != null && Number.isFinite(Number(b))) v.spacingBefore = round2(Number(b) / 20);
        if (a != null && Number.isFinite(Number(a))) v.spacingAfter = round2(Number(a) / 20);
        if (l != null && (!rule || rule === "auto") && Number.isFinite(Number(l))) v.lineHeight = round2(Number(l) / 240);
        break;
      }
      case "w:ind": {
        const left = c.attrs["w:left"] ?? c.attrs["w:start"];
        if (left != null && Number.isFinite(Number(left)) && Number(left) !== 0) v.indent = round2(Number(left) / 720);
        break;
      }
    }
  }
  return v;
}

export function paraValuesFromAttrs(a: Record<string, unknown> | undefined): ParaValues {
  const num = (x: unknown) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : round2(Number(x)));
  const align = a?.textAlign && a.textAlign !== "left" ? String(a.textAlign) : null;
  const indent = num(a?.indent);
  return { styleId: a?.styleId ? String(a.styleId) : null, align, spacingBefore: num(a?.spacingBefore), spacingAfter: num(a?.spacingAfter), lineHeight: num(a?.lineHeight), indent: indent === 0 ? null : indent };
}

export interface PPrOptions {
  /** Style id to write (already resolved by the writer; null = none). */
  styleId: string | null;
  /** numPr to write: null = none, undefined = keep raw state. */
  numPr?: { numId: string; ilvl: number } | null;
  /** Extra elements the writer adds when absent (keepNext for headings, tabs for TOC entries…). */
  extra?: [string, string][];
  /** Paragraph-mark revision (tracked insertion/deletion of the whole paragraph). */
  markRevision?: string | null;
  /** Drop revision markup from the raw properties (changes accepted export). */
  stripRevisions?: boolean;
  /** Default line spacing (multiplier) of the document; values equal to it are not written as direct formatting. */
  defaultLine?: number | null;
}

const PARA_GROUP_OF: Record<string, "style" | "align" | "spacing" | "indent" | "numPr"> = { "w:pStyle": "style", "w:jc": "align", "w:spacing": "spacing", "w:ind": "indent", "w:numPr": "numPr" };

function mergeAttrs(src: string, el: XEl, set: Record<string, string | null>): string {
  const attrs: Record<string, string> = { ...el.attrs };
  for (const [k, v] of Object.entries(set)) { if (v === null) delete attrs[k]; else attrs[k] = v; }
  const keys = Object.keys(attrs).filter((k) => !k.startsWith("xmlns"));
  void src;
  return keys.length ? `<${el.name} ${keys.map((k) => `${k}="${escAttr(attrs[k])}"`).join(" ")}/>` : "";
}

const REVISION_RE = /<w:(rPrChange|pPrChange|ins|del|moveFrom|moveTo|numberingChange)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g;

/** Build a w:pPr: raw children kept where unchanged; spacing/ind merged attribute-wise; numPr from list context. */
export function buildPPr(attrs: Record<string, unknown> | undefined, rawPPr: string | null | undefined, opts: PPrOptions): string {
  const cur = paraValuesFromAttrs(attrs);
  cur.styleId = opts.styleId;
  let rawEl: XEl | null = null; let src = "";
  if (rawPPr) { try { const p = parseXml(rawPPr); rawEl = p.root; src = p.src; } catch { rawEl = null; } }
  const base = paraValuesFromPPr(rawEl);
  const parts: [string, string][] = [];
  const handled = new Set<string>();
  const fresh = {
    style: (): [string, string][] => (cur.styleId ? [["w:pStyle", `<w:pStyle w:val="${escAttr(cur.styleId)}"/>`]] : []),
    align: (): [string, string][] => (cur.align ? [["w:jc", `<w:jc w:val="${ALIGN_TO_JC[cur.align] ?? "left"}"/>`]] : []),
    spacing: (): [string, string][] => {
      const set: string[] = [];
      if (cur.spacingBefore != null) set.push(`w:before="${Math.round(cur.spacingBefore * 20)}"`);
      if (cur.spacingAfter != null) set.push(`w:after="${Math.round(cur.spacingAfter * 20)}"`);
      if (cur.lineHeight != null && cur.lineHeight !== opts.defaultLine) set.push(`w:line="${Math.round(cur.lineHeight * 240)}" w:lineRule="auto"`);
      return set.length ? [["w:spacing", `<w:spacing ${set.join(" ")}/>`]] : [];
    },
    indent: (): [string, string][] => (cur.indent ? [["w:ind", `<w:ind w:left="${Math.round(cur.indent * 720)}"/>`]] : []),
    numPr: (): [string, string][] => (opts.numPr ? [["w:numPr", `<w:numPr><w:ilvl w:val="${opts.numPr.ilvl}"/><w:numId w:val="${escAttr(opts.numPr.numId)}"/></w:numPr>`]] : []),
  };
  const rawNum = rawEl ? kids(rawEl, "w:numPr")[0] : null;
  const rawNumVal = rawNum ? { numId: wval(kids(rawNum, "w:numId")[0]) ?? "", ilvl: Number(wval(kids(rawNum, "w:ilvl")[0]) ?? 0) } : null;
  const numUnchanged = opts.numPr === undefined || (opts.numPr === null ? !rawNumVal : Boolean(rawNumVal && rawNumVal.numId === opts.numPr.numId && rawNumVal.ilvl === opts.numPr.ilvl));
  if (rawEl) {
    for (const c of kids(rawEl)) {
      let x = raw(src, c);
      if (opts.stripRevisions) { x = x.replace(REVISION_RE, ""); if (c.name === "w:pPrChange") continue; }
      const g = PARA_GROUP_OF[c.name];
      if (c.name === "w:rPr" && opts.markRevision) { handled.add("markRev"); x = x.replace(/<w:(ins|del)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g, "").replace(/<\/w:rPr>$/, `${opts.markRevision}</w:rPr>`).replace(/^<w:rPr\/>$/, `<w:rPr>${opts.markRevision}</w:rPr>`); }
      if (!g) { parts.push([c.name, x]); continue; }
      if (handled.has(g)) continue;
      handled.add(g);
      if (g === "numPr") { if (numUnchanged) parts.push([c.name, x]); else parts.push(...fresh.numPr()); continue; }
      if (g === "style") { if (base.styleId === cur.styleId) parts.push([c.name, x]); else parts.push(...fresh.style()); continue; }
      if (g === "align") { if (base.align === cur.align) parts.push([c.name, x]); else parts.push(...fresh.align()); continue; }
      if (g === "spacing") {
        if (base.spacingBefore === cur.spacingBefore && base.spacingAfter === cur.spacingAfter && base.lineHeight === cur.lineHeight) parts.push([c.name, x]);
        else {
          const set: Record<string, string | null> = {
            "w:before": cur.spacingBefore != null ? String(Math.round(cur.spacingBefore * 20)) : null,
            "w:after": cur.spacingAfter != null ? String(Math.round(cur.spacingAfter * 20)) : null,
          };
          if (base.lineHeight !== cur.lineHeight) { set["w:line"] = cur.lineHeight != null ? String(Math.round(cur.lineHeight * 240)) : null; set["w:lineRule"] = cur.lineHeight != null ? "auto" : null; }
          const merged = mergeAttrs(src, c, set);
          if (merged) parts.push([c.name, merged]);
        }
        continue;
      }
      if (g === "indent") {
        if (base.indent === cur.indent) parts.push([c.name, x]);
        else { const key = c.attrs["w:start"] != null ? "w:start" : "w:left"; const merged = mergeAttrs(src, c, { [key]: cur.indent ? String(Math.round(cur.indent * 720)) : null }); if (merged) parts.push([c.name, merged]); }
        continue;
      }
    }
  }
  if (!handled.has("style") && base.styleId !== cur.styleId) parts.push(...fresh.style());
  if (!handled.has("align") && base.align !== cur.align) parts.push(...fresh.align());
  if (!handled.has("spacing") && (base.spacingBefore !== cur.spacingBefore || base.spacingAfter !== cur.spacingAfter || base.lineHeight !== cur.lineHeight)) parts.push(...fresh.spacing());
  if (!handled.has("indent") && base.indent !== cur.indent) parts.push(...fresh.indent());
  if (!handled.has("numPr") && !numUnchanged) parts.push(...fresh.numPr());
  if (opts.markRevision && !handled.has("markRev")) parts.push(["w:rPr", `<w:rPr>${opts.markRevision}</w:rPr>`]);
  for (const e of opts.extra ?? []) if (!parts.some((p) => p[0] === e[0])) parts.push(e);
  if (!parts.length) return "";
  return `<w:pPr>${joinOrdered(PPR_ORDER, parts)}</w:pPr>`;
}

export function stripRevisionMarkup(xml: string): string { return xml.replace(REVISION_RE, ""); }
