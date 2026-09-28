/**
 * .pptx → deck model with full fidelity metadata.
 *
 * Reads the slide masters, layouts and placeholders (type/idx inheritance for geometry, text styles, bullets and
 * body properties), the theme (color + font scheme, clrMap), slide size, and every slide: shapes with exact EMU
 * geometry (group transforms, rotation, flips), text bodies (levels, bullets/numbering, alignment, spacing,
 * autofit, runs with font/size/bold/italic/underline/color/hyperlinks, breaks and fields), tables (grid, merges,
 * cell fills/borders), pictures (media + crop), connectors, groups, charts (data from the chart cache; the part
 * itself is preserved), speaker notes, backgrounds, hidden slides, sections and transitions.
 *
 * Each element keeps an `ooxml` link (shape id, EMU geometry, import fingerprint) and each slide its source part,
 * so the package-preserving exporter can write unchanged content back byte-for-byte.
 */
import JSZip from "jszip";
import { nanoid } from "nanoid";
import {
  PT_TO_PX, SLIDE_H, SLIDE_W, makeElement, newSlideId, normalizeElement, plainText,
  type ChartSpec, type DeckContent, type DeckElement, type DeckSlide, type ElementOoxml, type ElementStyle, type EmuRect, type PlaceholderRole,
  type PptxLayoutInfo, type PptxMeta, type RichParagraph, type RichRun, type RichText, type SlideBackground, type SlideLayout, type TableBorder, type TableCell,
} from "../model";
import { elementDataFp, elementFingerprint, slideFingerprint, themeFingerprint } from "../fingerprint";
import { fnv1a64 } from "@/lib/integrity/hash-pure";
import { DEFAULT_SLIDE_CX, DEFAULT_SLIDE_CY, EMU_PER_INCH, EMU_PER_PT, IMAGE_MIME, REL, RelSet, applyColorMods, readXmlPart } from "./package";
import { deckThemeFromScheme, parseTheme, schemeToToken, type ParsedTheme } from "./theme";
import { attr, els, kid, kids, numAttr, path, textContent, type XDoc, type XEl } from "./xml";

export interface ReadOptions {
  /** Store a media part and return the src the editor should use (e.g. "/api/blobs/<id>"). */
  putMedia?: (bytes: Uint8Array, mime: string, name: string) => string;
  sha256?: string;
}

export interface CanvasMap { scale: number; offX: number; offY: number }

export function canvasMap(cx: number, cy: number): CanvasMap {
  const scale = Math.min(SLIDE_W / cx, SLIDE_H / cy);
  return { scale, offX: (SLIDE_W - cx * scale) / 2, offY: (SLIDE_H - cy * scale) / 2 };
}
export const emuToCanvasX = (emu: number, m: CanvasMap) => Math.round(emu * m.scale + m.offX);
export const emuToCanvasY = (emu: number, m: CanvasMap) => Math.round(emu * m.scale + m.offY);
export const emuToCanvasLen = (emu: number, m: CanvasMap) => Math.round(emu * m.scale);
/** Points in the source → points on the canvas (1 pt on a 13.333in page = 1 pt). */
export const ptFactor = (m: CanvasMap) => (m.scale * EMU_PER_INCH) / 96;

// ---------------------------------------------------------------------------
// Placeholders, masters and layouts
// ---------------------------------------------------------------------------

interface PhData { type: string; idx?: string; name?: string; emu?: EmuRect; lstStyle?: XEl; bodyPr?: XEl; spPr?: XEl }
interface MasterData { part: string; phs: PhData[]; titleStyle?: XEl; bodyStyle?: XEl; otherStyle?: XEl; clrMap: Record<string, string>; bg?: XEl; themePart?: string }
interface LayoutData { part: string; name: string; type?: string; master?: MasterData; phs: PhData[]; bg?: XEl; clrMapOvr?: Record<string, string> }

const phClass = (t: string | undefined) => (t === "title" || t === "ctrTitle" ? "title" : !t || t === "obj" || t === "body" || t === "subTitle" ? "body" : t);

function readXfrmEmu(xfrm: XEl | undefined): EmuRect | undefined {
  const off = kid(xfrm, "a:off"), ext = kid(xfrm, "a:ext");
  if (!off || !ext) return undefined;
  const r: EmuRect = { x: numAttr(off, "x"), y: numAttr(off, "y"), cx: numAttr(ext, "cx"), cy: numAttr(ext, "cy") };
  const rot = attr(xfrm, "rot"); if (rot && Number(rot)) r.rot = Number(rot);
  if (attr(xfrm, "flipH") === "1" || attr(xfrm, "flipH") === "true") r.flipH = true;
  if (attr(xfrm, "flipV") === "1" || attr(xfrm, "flipV") === "true") r.flipV = true;
  return r;
}

function readPlaceholders(tree: XEl | undefined): PhData[] {
  const out: PhData[] = [];
  for (const sp of kids(tree, "p:sp")) {
    const ph = path(sp, "p:nvSpPr", "p:nvPr", "p:ph");
    if (!ph) continue;
    const spPr = kid(sp, "p:spPr");
    out.push({ type: attr(ph, "type") ?? "obj", idx: attr(ph, "idx"), name: attr(path(sp, "p:nvSpPr", "p:cNvPr"), "name"), emu: readXfrmEmu(kid(spPr, "a:xfrm")), lstStyle: path(sp, "p:txBody", "a:lstStyle"), bodyPr: path(sp, "p:txBody", "a:bodyPr"), spPr });
  }
  return out;
}

function readClrMap(el: XEl | undefined): Record<string, string> {
  const map: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
  if (el) for (const a of el.attrs) map[a.n] = a.v;
  return map;
}

function matchPh(list: PhData[] | undefined, type: string | undefined, idx: string | undefined, byIdx = true): PhData | undefined {
  if (!list) return undefined;
  if (byIdx && idx !== undefined) { const m = list.find((p) => p.idx === idx); if (m && phClass(m.type) === phClass(type)) return m; if (m && !["title", "ctrTitle"].includes(type ?? "")) return m; }
  const cls = phClass(type);
  return list.find((p) => p.type === (type ?? "obj")) ?? list.find((p) => phClass(p.type) === cls);
}

// ---------------------------------------------------------------------------
// Reader state
// ---------------------------------------------------------------------------

interface SlideRead {
  zip: JSZip;
  map: CanvasMap;
  theme: ParsedTheme;
  clrMap: Record<string, string>;
  layout?: LayoutData;
  master?: MasterData;
  defaultTextStyle?: XEl;
  rels: RelSet;
  part: string;
  elements: DeckElement[];
  z: number;
  opts: ReadOptions;
  mediaCache: Map<string, string>;
  warnings: string[];
  slideIndex: number;
}

interface GroupT { spids: number[]; offX: number; offY: number; chOffX: number; chOffY: number; scaleX: number; scaleY: number }

function composeGroup(grpSpPr: XEl | undefined, spid: number, parent?: GroupT): GroupT | undefined {
  const xfrm = kid(grpSpPr, "a:xfrm");
  const off = kid(xfrm, "a:off"), ext = kid(xfrm, "a:ext"), chOff = kid(xfrm, "a:chOff"), chExt = kid(xfrm, "a:chExt");
  if (!off || !ext) return parent ? { ...parent, spids: [...parent.spids, spid] } : { spids: [spid], offX: 0, offY: 0, chOffX: 0, chOffY: 0, scaleX: 1, scaleY: 1 };
  let offX = numAttr(off, "x"), offY = numAttr(off, "y");
  const extX = numAttr(ext, "cx"), extY = numAttr(ext, "cy");
  const chOffX = numAttr(chOff, "x"), chOffY = numAttr(chOff, "y");
  const chExtX = numAttr(chExt, "cx", extX) || extX || 1, chExtY = numAttr(chExt, "cy", extY) || extY || 1;
  let scaleX = extX / chExtX, scaleY = extY / chExtY;
  if (parent) { offX = parent.offX + (offX - parent.chOffX) * parent.scaleX; offY = parent.offY + (offY - parent.chOffY) * parent.scaleY; scaleX *= parent.scaleX; scaleY *= parent.scaleY; }
  return { spids: [...(parent?.spids ?? []), spid], offX, offY, chOffX, chOffY, scaleX, scaleY };
}

function toAbsolute(r: EmuRect, g?: GroupT): EmuRect {
  if (!g) return r;
  return { ...r, x: Math.round(g.offX + (r.x - g.chOffX) * g.scaleX), y: Math.round(g.offY + (r.y - g.chOffY) * g.scaleY), cx: Math.round(r.cx * g.scaleX), cy: Math.round(r.cy * g.scaleY) };
}

// ---------------------------------------------------------------------------
// Colors and text styles
// ---------------------------------------------------------------------------

/** Resolve the color inside a fill/color parent (a:solidFill or an element containing one). */
function colorOf(ctx: SlideRead, holder: XEl | undefined): { hex?: string; token?: string; raw?: string } {
  if (!holder) return {};
  const fill = holder.name === "a:solidFill" ? holder : kid(holder, "a:solidFill");
  const c = fill ? els(fill)[0] : els(holder).find((e) => /^a:(srgbClr|schemeClr|sysClr|prstClr|scrgbClr)$/.test(e.name));
  if (!c) return {};
  const mods = els(c).filter((m) => /^a:(lumMod|lumOff|tint|shade|alpha)$/.test(m.name));
  const modStr = mods.filter((m) => m.name !== "a:alpha").map((m) => `~${m.name.slice(2)}:${attr(m, "val")}`).join("");
  if (c.name === "a:srgbClr") { const hex = `#${(attr(c, "val") ?? "000000").toUpperCase()}`; return { hex: applyColorMods(hex, c), raw: hex + modStr }; }
  if (c.name === "a:sysClr") { const hex = `#${(attr(c, "lastClr") ?? "000000").toUpperCase()}`; return { hex: applyColorMods(hex, c), raw: hex + modStr }; }
  if (c.name === "a:prstClr") { const hex = ({ black: "#000000", white: "#FFFFFF", red: "#FF0000", blue: "#0000FF", green: "#008000" } as Record<string, string>)[attr(c, "val") ?? ""] ?? "#000000"; return { hex, raw: hex }; }
  if (c.name === "a:schemeClr") {
    const val = attr(c, "val") ?? "tx1";
    if (val === "phClr") return {};
    const slot = ctx.clrMap[val] ?? val;
    const base = ctx.theme.scheme[slot];
    if (!base) return {};
    const hex = applyColorMods(base, c);
    const token = mods.filter((m) => m.name !== "a:alpha").length ? undefined : schemeToToken(slot);
    return { hex, token, raw: `scheme:${val}${modStr}` };
  }
  return {};
}

const displayColor = (c: { hex?: string; token?: string }) => c.token ?? c.hex;

interface LvlProps { algn?: string; bullet?: RichParagraph["bullet"]; sz?: number; b?: boolean; i?: boolean; u?: boolean; color?: { hex?: string; token?: string }; font?: string; lnSpcPct?: number }

function lvlProps(ctx: SlideRead, lst: XEl | undefined, level: number): LvlProps {
  const p = kid(lst, `a:lvl${level + 1}pPr`);
  if (!p) return {};
  const out: LvlProps = {};
  const algn = attr(p, "algn"); if (algn) out.algn = algn;
  if (kid(p, "a:buNone")) out.bullet = "none"; else if (kid(p, "a:buAutoNum")) out.bullet = "number"; else if (kid(p, "a:buChar") || kid(p, "a:buBlip")) out.bullet = "char";
  const d = kid(p, "a:defRPr");
  if (d) {
    const sz = attr(d, "sz"); if (sz) out.sz = Number(sz) / 100;
    const b = attr(d, "b"); if (b !== undefined) out.b = b === "1" || b === "true";
    const i = attr(d, "i"); if (i !== undefined) out.i = i === "1" || i === "true";
    const u = attr(d, "u"); if (u !== undefined) out.u = u !== "none";
    const c = colorOf(ctx, d); if (c.hex) out.color = c;
    const latin = attr(kid(d, "a:latin"), "typeface"); if (latin) out.font = latin;
  }
  const lnPct = attr(path(p, "a:lnSpc", "a:spcPct"), "val"); if (lnPct) out.lnSpcPct = Number(lnPct) / 100000;
  return out;
}

/** Style chain for a shape: its own lstStyle, then layout → master placeholder, then master text styles. */
function styleChain(ctx: SlideRead, own: XEl | undefined, ph?: { type?: string; idx?: string }): XEl[] {
  const chain: XEl[] = [];
  if (own) chain.push(own);
  if (ph) {
    const lp = matchPh(ctx.layout?.phs, ph.type, ph.idx);
    if (lp?.lstStyle) chain.push(lp.lstStyle);
    const mp = matchPh(ctx.master?.phs, lp?.type ?? ph.type, undefined, false);
    if (mp?.lstStyle) chain.push(mp.lstStyle);
    const cls = phClass(ph.type);
    const ms = cls === "title" ? ctx.master?.titleStyle : cls === "body" ? ctx.master?.bodyStyle : ctx.master?.otherStyle;
    if (ms) chain.push(ms);
  } else if (ctx.defaultTextStyle) chain.push(ctx.defaultTextStyle);
  return chain;
}

function effectiveLvl(ctx: SlideRead, chain: XEl[], level: number): LvlProps {
  const out: LvlProps = {};
  for (const lst of chain) {
    const p = lvlProps(ctx, lst, level);
    for (const k of Object.keys(p) as (keyof LvlProps)[]) if (out[k] === undefined) (out as Record<string, unknown>)[k] = p[k];
  }
  return out;
}

function bodyPrChain(ctx: SlideRead, own: XEl | undefined, ph?: { type?: string; idx?: string }): XEl[] {
  const chain: XEl[] = [];
  if (own) chain.push(own);
  if (ph) {
    const lp = matchPh(ctx.layout?.phs, ph.type, ph.idx);
    if (lp?.bodyPr) chain.push(lp.bodyPr);
    const mp = matchPh(ctx.master?.phs, lp?.type ?? ph.type, undefined, false);
    if (mp?.bodyPr) chain.push(mp.bodyPr);
  }
  return chain;
}
const firstAttr = (chain: XEl[], name: string) => { for (const e of chain) { const v = attr(e, name); if (v !== undefined) return v; } return undefined; };

function spacing(el: XEl | undefined): string | undefined {
  const pts = attr(kid(el, "a:spcPts"), "val"); if (pts !== undefined) return `${Number(pts) / 100}pt`;
  const pct = attr(kid(el, "a:spcPct"), "val"); if (pct !== undefined) return `${Number(pct) / 1000}%`;
  return undefined;
}

function readRun(ctx: SlideRead, r: XEl, kind: "r" | "fld"): RichRun {
  const rPr = kid(r, "a:rPr");
  const run: RichRun = { text: textContent(kid(r, "a:t") ?? { t: "text", v: "" }) };
  if (kind === "fld") run.field = attr(r, "type") ?? "field";
  if (rPr) {
    const sz = attr(rPr, "sz"); if (sz) run.size = Number(sz) / 100;
    const b = attr(rPr, "b"); if (b !== undefined) run.bold = b === "1" || b === "true";
    const i = attr(rPr, "i"); if (i !== undefined) run.italic = i === "1" || i === "true";
    const u = attr(rPr, "u"); if (u !== undefined) run.underline = u !== "none";
    const c = colorOf(ctx, rPr); if (c.raw) run.color = c.raw;
    const latin = attr(kid(rPr, "a:latin"), "typeface"); if (latin) run.font = latin;
    const link = kid(rPr, "a:hlinkClick");
    if (link) { const rid = attr(link, "r:id"); const rel = rid ? ctx.rels.get(rid) : undefined; run.link = rel?.target ?? attr(link, "action") ?? ""; }
  }
  return run;
}

interface TextRead { rich: RichText; markdown: string; style: ElementStyle; plain: string }

function readTextBody(ctx: SlideRead, txBody: XEl | undefined, ph?: { type?: string; idx?: string }, shapeFontColor?: { hex?: string; token?: string }): TextRead {
  const lst = kid(txBody, "a:lstStyle");
  const chain = styleChain(ctx, lst && els(lst).length ? lst : undefined, ph);
  const bpChain = bodyPrChain(ctx, kid(txBody, "a:bodyPr"), ph);
  const bodyPr = kid(txBody, "a:bodyPr");
  const rich: RichText = { paragraphs: [], markdown: "" };
  const norm = kid(bodyPr, "a:normAutofit");
  if (norm) { rich.autofit = "norm"; const fs = attr(norm, "fontScale"); if (fs) rich.fontScale = Number(fs) / 100000; }
  else if (kid(bodyPr, "a:spAutoFit")) rich.autofit = "shape";
  else if (kid(bodyPr, "a:noAutofit")) rich.autofit = "none";
  const anchor = attr(bodyPr, "anchor"); if (anchor === "t" || anchor === "ctr" || anchor === "b") rich.anchor = anchor;
  const wrap = attr(bodyPr, "wrap"); if (wrap) rich.wrap = wrap !== "none";
  if (["lIns", "tIns", "rIns", "bIns"].some((k) => attr(bodyPr, k) !== undefined)) rich.insets = [numAttr(bodyPr, "lIns", 91440), numAttr(bodyPr, "tIns", 45720), numAttr(bodyPr, "rIns", 91440), numAttr(bodyPr, "bIns", 45720)];

  const effRuns: { text: string; b: boolean; i: boolean; u: boolean }[][] = [];
  const kinds: { level: number; kind: "para" | "bullet" | "number" }[] = [];
  let firstSize: number | undefined, firstColor: { hex?: string; token?: string } | undefined, firstFont: string | undefined, firstAlign: string | undefined, firstLn: number | undefined;
  for (const p of kids(txBody, "a:p")) {
    const pPr = kid(p, "a:pPr");
    const level = Math.min(8, numAttr(pPr, "lvl", 0));
    const eff = effectiveLvl(ctx, chain, level);
    const para: RichParagraph = { level, bullet: "inherit", runs: [] };
    if (kid(pPr, "a:buNone")) para.bullet = "none";
    else if (kid(pPr, "a:buAutoNum")) { para.bullet = "number"; para.numScheme = attr(kid(pPr, "a:buAutoNum"), "type"); }
    else if (kid(pPr, "a:buChar")) { para.bullet = "char"; para.bulletChar = attr(kid(pPr, "a:buChar"), "char"); }
    const algn = attr(pPr, "algn"); if (algn) para.align = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";
    const sb = spacing(kid(pPr, "a:spcBef")); if (sb) para.spaceBefore = sb;
    const sa = spacing(kid(pPr, "a:spcAft")); if (sa) para.spaceAfter = sa;
    const ls = spacing(kid(pPr, "a:lnSpc")); if (ls) para.lineSpacing = ls;
    const effBullet = para.bullet !== "inherit" ? para.bullet : eff.bullet ?? "none";
    const line: { text: string; b: boolean; i: boolean; u: boolean }[] = [];
    for (const k of els(p)) {
      if (k.name === "a:r" || k.name === "a:fld") {
        const run = readRun(ctx, k, k.name === "a:r" ? "r" : "fld");
        para.runs.push(run);
        const b = run.bold ?? eff.b ?? false, i = run.italic ?? eff.i ?? false, u = run.underline ?? eff.u ?? false;
        line.push({ text: run.text, b, i, u });
        if (firstSize === undefined && run.text.trim()) {
          firstSize = run.size ?? eff.sz;
          const rc = colorOf(ctx, kid(k, "a:rPr"));
          firstColor = rc.hex ? rc : eff.color ?? shapeFontColor;
          firstFont = run.font ?? eff.font;
        }
      } else if (k.name === "a:br") { para.runs.push({ text: "", br: true }); line.push({ text: "\n", b: false, i: false, u: false }); }
    }
    if (firstAlign === undefined) firstAlign = attr(pPr, "algn") ?? eff.algn;
    if (firstLn === undefined) { const pct = attr(path(pPr, "a:lnSpc", "a:spcPct"), "val"); firstLn = pct ? Number(pct) / 100000 : eff.lnSpcPct; }
    if (firstSize === undefined) { const end = kid(p, "a:endParaRPr"); const sz = attr(end, "sz"); if (sz) firstSize = Number(sz) / 100; }
    rich.paragraphs.push(para);
    effRuns.push(line);
    kinds.push({ level, kind: effBullet === "number" ? "number" : effBullet === "char" ? "bullet" : "para" });
  }
  // element-level emphasis when every non-empty run carries it
  const nonEmpty = effRuns.flat().filter((r) => r.text.trim() && r.text !== "\n");
  const allB = nonEmpty.length > 0 && nonEmpty.every((r) => r.b);
  const allI = nonEmpty.length > 0 && nonEmpty.every((r) => r.i);
  const allU = nonEmpty.length > 0 && nonEmpty.every((r) => r.u);
  const lines = effRuns.map((runs, pi) => {
    const { level, kind } = kinds[pi];
    const prefix = "  ".repeat(Math.min(4, level)) + (kind === "bullet" ? "- " : kind === "number" ? "1. " : "");
    const body = runs.map((r) => {
      if (r.text === "\n") return "\n" + "  ".repeat(Math.min(4, level));
      let t = r.text;
      if (!t.trim()) return t;
      const lead = t.match(/^\s*/)?.[0] ?? "", trail = t.match(/\s*$/)?.[0] ?? "";
      t = t.trim();
      if (r.b && !allB) t = `**${t}**`;
      if (r.i && !allI) t = `*${t}*`;
      if (r.u && !allU) t = `__${t}__`;
      return lead + t + trail;
    }).join("");
    return prefix + body;
  });
  lines.forEach((l, i) => { rich.paragraphs[i].md = l; });
  const markdown = lines.join("\n").replace(/\n+$/, "");
  rich.markdown = markdown;
  const factor = ptFactor(ctx.map);
  const effAnchor = firstAttr(bpChain, "anchor");
  const lIns = Number(firstAttr(bpChain, "lIns") ?? 91440);
  const style: ElementStyle = {};
  const sz = (firstSize ?? effectiveLvl(ctx, chain, 0).sz ?? 18) * (rich.fontScale ?? 1) * factor;
  style.fontSize = Math.max(6, Math.round(sz * 10) / 10);
  if (allB) style.bold = true;
  if (allI) style.italic = true;
  if (allU) style.underline = true;
  const col = firstColor ?? effectiveLvl(ctx, chain, 0).color ?? shapeFontColor;
  if (col) style.color = displayColor(col);
  const face = firstFont ?? effectiveLvl(ctx, chain, 0).font;
  style.fontFamily = face === "+mj-lt" || face === ctx.theme.fonts.major ? "heading" : face === "+mn-lt" || !face || face === ctx.theme.fonts.minor ? "body" : face;
  if (firstAlign) style.align = firstAlign === "ctr" ? "center" : firstAlign === "r" ? "right" : "left";
  style.valign = effAnchor === "ctr" ? "middle" : effAnchor === "b" ? "bottom" : "top";
  style.padding = Math.max(0, Math.round(emuToCanvasLen(lIns, ctx.map)));
  style.lineHeight = Math.round(1.2 * (firstLn ?? 1) * 100) / 100;
  return { rich, markdown, style, plain: plainText(markdown) };
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const PH_ROLE: Record<string, PlaceholderRole> = { title: "title", ctrTitle: "title", subTitle: "subtitle", body: "body", obj: "body", dt: "date", ftr: "footer", sldNum: "footer", pic: "image", tbl: "table", chart: "chart", media: "image", clipArt: "image" };

function geometry(ctx: SlideRead, emu: EmuRect) {
  return { x: emuToCanvasX(emu.x, ctx.map), y: emuToCanvasY(emu.y, ctx.map), w: Math.max(1, emuToCanvasLen(emu.cx, ctx.map)), h: Math.max(0, emuToCanvasLen(emu.cy, ctx.map)), rotation: emu.rot ? Math.round((emu.rot / 60000) * 100) / 100 : undefined, flipH: emu.flipH || undefined, flipV: emu.flipV || undefined };
}

function strokeWidthPx(ln: XEl | undefined): number | undefined {
  const w = attr(ln, "w");
  return w ? Math.max(0.5, Math.round((Number(w) / EMU_PER_PT) * 100) / 100) : undefined;
}

function finish(ctx: SlideRead, el: DeckElement, meta: Omit<ElementOoxml, "fp" | "base">): DeckElement {
  const n = normalizeElement(el);
  n.ooxml = { ...meta, base: { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation, flipH: n.flipH, flipV: n.flipV, style: { ...n.style }, src: n.src, crop: n.crop }, fp: "" };
  n.ooxml.fp = elementFingerprint(n);
  n.ooxml.dataFp = elementDataFp(n);
  ctx.elements.push(n);
  return n;
}

function spFill(ctx: SlideRead, sp: XEl, spPr: XEl | undefined): { fill?: string; stroke?: string; strokeWidth?: number; fontColor?: { hex?: string; token?: string } } {
  const out: { fill?: string; stroke?: string; strokeWidth?: number; fontColor?: { hex?: string; token?: string } } = {};
  const style = kid(sp, "p:style");
  if (kid(spPr, "a:solidFill")) out.fill = displayColor(colorOf(ctx, kid(spPr, "a:solidFill")));
  else if (kid(spPr, "a:gradFill")) { const gs = path(spPr, "a:gradFill", "a:gsLst"); const first = kids(gs, "a:gs")[0]; if (first) out.fill = displayColor(colorOf(ctx, first)); }
  else if (!kid(spPr, "a:noFill") && style && numAttr(kid(style, "a:fillRef"), "idx") > 0) out.fill = displayColor(colorOf(ctx, kid(style, "a:fillRef")));
  const ln = kid(spPr, "a:ln");
  if (ln && !kid(ln, "a:noFill")) { const c = colorOf(ctx, ln); if (c.hex) out.stroke = displayColor(c); out.strokeWidth = strokeWidthPx(ln); }
  else if (!ln && style && numAttr(kid(style, "a:lnRef"), "idx") > 0) { const c = colorOf(ctx, kid(style, "a:lnRef")); if (c.hex) { out.stroke = displayColor(c); out.strokeWidth = 0.75; } }
  if (style && kid(style, "a:fontRef")) { const c = colorOf(ctx, kid(style, "a:fontRef")); if (c.hex) out.fontColor = c; }
  return out;
}

async function readSp(ctx: SlideRead, sp: XEl, group?: GroupT) {
  const cNvPr = path(sp, "p:nvSpPr", "p:cNvPr");
  const spid = numAttr(cNvPr, "id", 0);
  const name = attr(cNvPr, "name");
  const phEl = path(sp, "p:nvSpPr", "p:nvPr", "p:ph");
  const ph = phEl ? { type: attr(phEl, "type"), idx: attr(phEl, "idx") } : undefined;
  const spPr = kid(sp, "p:spPr");
  let emu = readXfrmEmu(kid(spPr, "a:xfrm"));
  let inherited = false;
  if (!emu && ph) {
    const lp = matchPh(ctx.layout?.phs, ph.type, ph.idx);
    emu = lp?.emu ?? matchPh(ctx.master?.phs, lp?.type ?? ph.type, undefined, false)?.emu;
    inherited = Boolean(emu);
  }
  if (!emu) { ctx.warnings.push(`slide ${ctx.slideIndex + 1}: shape "${name ?? spid}" has no geometry`); return; }
  const abs = inherited ? emu : toAbsolute(emu, group);
  const g = geometry(ctx, abs);
  const prst = attr(kid(spPr, "a:prstGeom"), "prst") ?? (kid(spPr, "a:custGeom") ? "custom" : "rect");
  const paint = spFill(ctx, sp, spPr);
  const txBody = kid(sp, "p:txBody");
  const text = txBody ? readTextBody(ctx, txBody, ph, paint.fontColor) : undefined;
  const hasText = Boolean(text?.plain.trim());
  const meta = { spid, kind: "sp" as const, name, ph: ph ? { type: ph.type, idx: ph.idx } : undefined, emu: abs, inherited: inherited || undefined, group: group ? { ...group } : undefined };
  const groupId = group ? `g_${ctx.slideIndex}_${group.spids[0]}` : undefined;
  const roleFromName = name && /^lc:([a-zA-Z]+)$/.exec(name)?.[1];
  let role: PlaceholderRole | undefined = ph ? PH_ROLE[ph.type ?? "obj"] ?? "body" : (roleFromName as PlaceholderRole | undefined);
  if (ph && role === "body" && ph.idx && ctx.layout?.type && /^(twoObj|twoTxTwoObj|objTx|txObj)$/.test(ctx.layout.type)) {
    const bodies = (ctx.layout.phs ?? []).filter((p) => phClass(p.type) === "body" && p.type !== "subTitle" && p.emu).sort((a, b) => (a.emu!.x - b.emu!.x));
    const i = bodies.findIndex((p) => p.idx === ph.idx);
    if (bodies.length === 2 && i >= 0) role = i === 0 ? "left" : "right";
  }
  if (prst === "line" || prst === "straightConnector1") {
    finish(ctx, makeElement({ type: "line", ...g, z: ctx.z++, name, groupId, style: { stroke: paint.stroke ?? "muted", strokeWidth: paint.strokeWidth ?? 1, lineDir: g.flipV ? "up" : "down", arrowEnd: Boolean(path(spPr, "a:ln", "a:tailEnd") && attr(path(spPr, "a:ln", "a:tailEnd"), "type") !== "none") } }), meta);
    return;
  }
  const isShapeGeom = !["rect", "roundRect", "custom"].includes(prst) || (prst === "roundRect" && !ph);
  if (!ph && !hasText) {
    const shape: DeckElement["shape"] = prst === "ellipse" ? "ellipse" : /arrow/i.test(prst) ? "arrow" : "rect";
    finish(ctx, makeElement({ type: "shape", shape, ...g, z: ctx.z++, name, groupId, style: { fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth, radius: prst === "roundRect" ? 12 : undefined } }), meta);
    return;
  }
  if (ph && !hasText && (ph.type === "pic" || ph.type === "tbl" || ph.type === "chart" || ph.type === "media" || ph.type === "clipArt")) {
    // empty content placeholder: keep it (invisible in slide show) so the layout stays intact
    finish(ctx, makeElement({ type: "text", role: undefined, text: "", ...g, z: ctx.z++, name, groupId, style: { ...(text?.style ?? {}), padding: text?.style.padding ?? 8 } }), meta);
    return;
  }
  const style: ElementStyle = { ...(text?.style ?? { fontSize: 18 }) };
  if (paint.fill) style.fill = paint.fill;
  if (paint.stroke) { style.stroke = paint.stroke; style.strokeWidth = paint.strokeWidth; }
  if (prst === "roundRect") style.radius = 12;
  if (!ph && isShapeGeom && hasText) {
    const shape: DeckElement["shape"] = prst === "ellipse" ? "ellipse" : /arrow/i.test(prst) ? "arrow" : "rect";
    finish(ctx, makeElement({ type: "shape", shape, text: text?.markdown ?? "", rich: text?.rich, ...g, z: ctx.z++, name, groupId, style }), meta);
    return;
  }
  finish(ctx, makeElement({ type: "text", role, text: text?.markdown ?? "", rich: text?.rich, ...g, z: ctx.z++, name, groupId, style }), meta);
}

function readCxn(ctx: SlideRead, cxn: XEl, group?: GroupT) {
  const cNvPr = path(cxn, "p:nvCxnSpPr", "p:cNvPr");
  const spPr = kid(cxn, "p:spPr");
  const emu = readXfrmEmu(kid(spPr, "a:xfrm"));
  if (!emu) return;
  const abs = toAbsolute(emu, group);
  const g = geometry(ctx, abs);
  const paint = spFill(ctx, cxn, spPr);
  const tail = path(spPr, "a:ln", "a:tailEnd");
  finish(ctx, makeElement({ type: "line", ...g, w: Math.max(1, g.w), z: ctx.z++, name: attr(cNvPr, "name"), groupId: group ? `g_${ctx.slideIndex}_${group.spids[0]}` : undefined, style: { stroke: paint.stroke ?? "muted", strokeWidth: paint.strokeWidth ?? 1, lineDir: g.flipV ? "up" : "down", arrowEnd: Boolean(tail && attr(tail, "type") !== "none") } }), { spid: numAttr(cNvPr, "id", 0), kind: "cxnSp", name: attr(cNvPr, "name"), emu: abs, group: group ? { ...group } : undefined });
}

async function mediaSrc(ctx: SlideRead, part: string): Promise<string> {
  const cached = ctx.mediaCache.get(part);
  if (cached !== undefined) return cached;
  const file = ctx.zip.file(part);
  let src = "";
  if (file && ctx.opts.putMedia) {
    const bytes = await file.async("uint8array");
    const ext = part.split(".").pop()?.toLowerCase() ?? "png";
    src = ctx.opts.putMedia(bytes, IMAGE_MIME[ext] ?? `image/${ext}`, part.split("/").pop() ?? part);
  }
  ctx.mediaCache.set(part, src);
  return src;
}

async function readPic(ctx: SlideRead, pic: XEl, group?: GroupT) {
  const cNvPr = path(pic, "p:nvPicPr", "p:cNvPr");
  const spPr = kid(pic, "p:spPr");
  const phEl = path(pic, "p:nvPicPr", "p:nvPr", "p:ph");
  let emu = readXfrmEmu(kid(spPr, "a:xfrm"));
  let inherited = false;
  if (!emu && phEl) { const lp = matchPh(ctx.layout?.phs, attr(phEl, "type"), attr(phEl, "idx")); emu = lp?.emu; inherited = Boolean(emu); }
  if (!emu) return;
  const abs = inherited ? emu : toAbsolute(emu, group);
  const g = geometry(ctx, abs);
  const blip = path(pic, "p:blipFill", "a:blip");
  const rid = attr(blip, "r:embed");
  const rel = rid ? ctx.rels.get(rid) : undefined;
  const media = rel && !rel.external ? rel.target : undefined;
  const src = media ? await mediaSrc(ctx, media) : "";
  const srcRect = path(pic, "p:blipFill", "a:srcRect");
  const crop = srcRect && ["l", "t", "r", "b"].some((k) => numAttr(srcRect, k) !== 0) ? { l: numAttr(srcRect, "l") / 100000, t: numAttr(srcRect, "t") / 100000, r: numAttr(srcRect, "r") / 100000, b: numAttr(srcRect, "b") / 100000 } : undefined;
  const stretch = Boolean(path(pic, "p:blipFill", "a:stretch"));
  const paint = spFill(ctx, pic, spPr);
  finish(ctx, makeElement({ type: "image", src, alt: attr(cNvPr, "descr") ?? attr(cNvPr, "name"), ...g, crop, z: ctx.z++, name: attr(cNvPr, "name"), groupId: group ? `g_${ctx.slideIndex}_${group.spids[0]}` : undefined, style: { fit: stretch ? "fill" : "contain", stroke: paint.stroke, strokeWidth: paint.strokeWidth } }), { spid: numAttr(cNvPr, "id", 0), kind: "pic", name: attr(cNvPr, "name"), ph: phEl ? { type: attr(phEl, "type"), idx: attr(phEl, "idx") } : undefined, emu: abs, inherited: inherited || undefined, group: group ? { ...group } : undefined, media });
}

function readBorder(ctx: SlideRead, ln: XEl | undefined): TableBorder | undefined {
  if (!ln) return undefined;
  if (kid(ln, "a:noFill")) return { none: true };
  const c = colorOf(ctx, ln);
  const w = attr(ln, "w");
  return { color: c.token ?? c.hex, width: w ? Math.round((Number(w) / EMU_PER_PT) * 100) / 100 : undefined };
}

async function readFrame(ctx: SlideRead, gf: XEl, group?: GroupT) {
  const cNvPr = path(gf, "p:nvGraphicFramePr", "p:cNvPr");
  const spid = numAttr(cNvPr, "id", 0);
  const name = attr(cNvPr, "name");
  const phEl = path(gf, "p:nvGraphicFramePr", "p:nvPr", "p:ph");
  let emu = readXfrmEmu(kid(gf, "p:xfrm"));
  if (!emu && phEl) emu = matchPh(ctx.layout?.phs, attr(phEl, "type"), attr(phEl, "idx"))?.emu;
  if (!emu) return;
  const abs = toAbsolute(emu, group);
  const g = geometry(ctx, abs);
  const groupId = group ? `g_${ctx.slideIndex}_${group.spids[0]}` : undefined;
  const meta = { spid, kind: "graphicFrame" as const, name, ph: phEl ? { type: attr(phEl, "type"), idx: attr(phEl, "idx") } : undefined, emu: abs, group: group ? { ...group } : undefined };
  const data = path(gf, "a:graphic", "a:graphicData");
  const tbl = kid(data, "a:tbl");
  if (tbl) {
    const gridCols = kids(kid(tbl, "a:tblGrid"), "a:gridCol").map((c) => numAttr(c, "w"));
    const trs = kids(tbl, "a:tr");
    const cells: TableCell[][] = [];
    let fontSize: number | undefined;
    for (const tr of trs) {
      const row: TableCell[] = [];
      for (const tc of kids(tr, "a:tc")) {
        const t = readTextBody(ctx, kid(tc, "a:txBody"));
        if (fontSize === undefined && t.plain.trim()) fontSize = t.style.fontSize;
        const cell: TableCell = { text: t.plain };
        const gs = numAttr(tc, "gridSpan", 1); if (gs > 1) cell.gridSpan = gs;
        const rs = numAttr(tc, "rowSpan", 1); if (rs > 1) cell.rowSpan = rs;
        if (attr(tc, "hMerge") === "1" || attr(tc, "hMerge") === "true") cell.hMerge = true;
        if (attr(tc, "vMerge") === "1" || attr(tc, "vMerge") === "true") cell.vMerge = true;
        const tcPr = kid(tc, "a:tcPr");
        if (kid(tcPr, "a:solidFill")) { const c = colorOf(ctx, kid(tcPr, "a:solidFill")); cell.fill = c.token ?? c.hex; }
        const borders = { l: readBorder(ctx, kid(tcPr, "a:lnL")), r: readBorder(ctx, kid(tcPr, "a:lnR")), t: readBorder(ctx, kid(tcPr, "a:lnT")), b: readBorder(ctx, kid(tcPr, "a:lnB")) };
        if (borders.l || borders.r || borders.t || borders.b) cell.borders = Object.fromEntries(Object.entries(borders).filter(([, v]) => v)) as TableCell["borders"];
        if (t.style.bold) cell.bold = true;
        if (t.style.align && t.style.align !== "left") cell.align = t.style.align;
        row.push(cell);
      }
      cells.push(row);
    }
    const total = gridCols.reduce((a, b) => a + b, 0);
    const heights = trs.map((tr) => numAttr(tr, "h"));
    const hTotal = heights.reduce((a, b) => a + b, 0);
    const tblPr = kid(tbl, "a:tblPr");
    const texts = cells.map((r) => r.map((c) => c.text));
    finish(ctx, makeElement({
      type: "table", role: "table", ...g, z: ctx.z++, name, groupId,
      table: { header: texts[0] ?? [], rows: texts.slice(1), colWidths: total ? gridCols.map((c) => c / total) : undefined, cells, rowHeights: hTotal ? heights.map((h) => h / hTotal) : undefined, firstRow: attr(tblPr, "firstRow") === "1" || undefined, bandRow: attr(tblPr, "bandRow") === "1" || undefined },
      style: { fontSize: fontSize ?? 14, color: "fg", headerFill: "accent", headerColor: "bg", stroke: "muted", banded: attr(tblPr, "bandRow") === "1" },
    }), meta);
    return;
  }
  const chartRid = attr(kid(data, "c:chart"), "r:id");
  const chartRel = chartRid ? ctx.rels.get(chartRid) : undefined;
  if (chartRel && !chartRel.external) {
    const chart = await readChart(ctx, chartRel.target);
    if (chart) { finish(ctx, makeElement({ type: "chart", role: "chart", chart, ...g, z: ctx.z++, name, groupId, style: { fill: "surface", radius: 0, padding: 8 } }), { ...meta, chartPart: chartRel.target }); return; }
  }
  const uri = attr(data, "uri") ?? "";
  const kind = /diagram/.test(uri) ? "SmartArt" : /ole/i.test(uri) ? "embedded object" : /chart/.test(uri) ? "chart" : "object";
  finish(ctx, makeElement({ type: "shape", shape: "rect", ...g, z: ctx.z++, name, groupId, text: `[${kind}]`, style: { fill: "surface", stroke: "muted", color: "muted", fontSize: 12, align: "center", valign: "middle" } }), { ...meta, opaque: true });
}

async function readChart(ctx: SlideRead, part: string): Promise<ChartSpec | null> {
  const doc = await readXmlPart(ctx.zip, part);
  if (!doc) return null;
  const chart = path(doc.root, "c:chart");
  const plot = kid(chart, "c:plotArea");
  const kinds: { key: string; type: ChartSpec["type"] }[] = [{ key: "c:barChart", type: "bar" }, { key: "c:bar3DChart", type: "bar" }, { key: "c:lineChart", type: "line" }, { key: "c:line3DChart", type: "line" }, { key: "c:areaChart", type: "line" }, { key: "c:pieChart", type: "pie" }, { key: "c:pie3DChart", type: "pie" }, { key: "c:doughnutChart", type: "pie" }];
  const pts = (cache: XEl | undefined) => kids(cache, "c:pt").sort((a, b) => numAttr(a, "idx") - numAttr(b, "idx")).map((pt) => textContent(kid(pt, "c:v") ?? { t: "text", v: "" }));
  for (const k of kinds) {
    const node = kid(plot, k.key);
    if (!node) continue;
    const series = kids(node, "c:ser").map((ser) => {
      const txCache = path(ser, "c:tx", "c:strRef", "c:strCache");
      const name = pts(txCache)[0] ?? (kid(kid(ser, "c:tx"), "c:v") ? textContent(kid(kid(ser, "c:tx"), "c:v")!) : "Series");
      const cat = kid(ser, "c:cat");
      const cats = pts(path(cat, "c:strRef", "c:strCache")).length ? pts(path(cat, "c:strRef", "c:strCache")) : pts(path(cat, "c:numRef", "c:numCache")).length ? pts(path(cat, "c:numRef", "c:numCache")) : pts(path(cat, "c:strLit")).length ? pts(path(cat, "c:strLit")) : pts(kids(path(cat, "c:multiLvlStrRef", "c:multiLvlStrCache"), "c:lvl")[0]);
      const vals = (pts(path(ser, "c:val", "c:numRef", "c:numCache")).length ? pts(path(ser, "c:val", "c:numRef", "c:numCache")) : pts(path(ser, "c:val", "c:numLit"))).map((v) => Number(v) || 0);
      return { name, cats, values: vals };
    });
    if (!series.length) continue;
    const titleTx = path(chart, "c:title", "c:tx", "c:rich");
    const title = titleTx ? kids(titleTx, "a:p").map((p) => textContent(p)).join(" ").trim() : undefined;
    const showVal = attr(path(node, "c:dLbls", "c:showVal"), "val") === "1" || kids(node, "c:ser").some((s) => attr(path(s, "c:dLbls", "c:showVal"), "val") === "1");
    return { type: k.type, categories: series[0].cats, series: series.map((s) => ({ name: s.name, values: s.values })), title: title || undefined, showLegend: Boolean(kid(chart, "c:legend")), showValues: showVal };
  }
  return null;
}

async function walkTree(ctx: SlideRead, tree: XEl | undefined, group?: GroupT) {
  for (const k of els(tree)) {
    try {
      if (k.name === "p:sp") await readSp(ctx, k, group);
      else if (k.name === "p:cxnSp") readCxn(ctx, k, group);
      else if (k.name === "p:pic") await readPic(ctx, k, group);
      else if (k.name === "p:graphicFrame") await readFrame(ctx, k, group);
      else if (k.name === "p:grpSp") { const id = numAttr(path(k, "p:nvGrpSpPr", "p:cNvPr"), "id", 0); await walkTree(ctx, k, composeGroup(kid(k, "p:grpSpPr"), id, group)); }
      else if (k.name === "mc:AlternateContent") { const choice = kid(k, "mc:Fallback") ?? kid(k, "mc:Choice"); if (choice) await walkTree(ctx, choice, group); }
    } catch (e) { ctx.warnings.push(`slide ${ctx.slideIndex + 1}: ${(e as Error).message}`); }
  }
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

async function readBackground(ctx: SlideRead, bg: XEl | undefined): Promise<SlideBackground | undefined> {
  if (!bg) return undefined;
  const bgPr = kid(bg, "p:bgPr");
  if (bgPr) {
    if (kid(bgPr, "a:solidFill")) { const c = colorOf(ctx, kid(bgPr, "a:solidFill")); const v = displayColor(c); return v ? { color: v } : undefined; }
    if (kid(bgPr, "a:gradFill")) { const first = kids(path(bgPr, "a:gradFill", "a:gsLst"), "a:gs")[0]; const v = displayColor(colorOf(ctx, first)); return v ? { color: v } : undefined; }
    const blip = path(bgPr, "a:blipFill", "a:blip");
    const rid = attr(blip, "r:embed");
    const rel = rid ? ctx.rels.get(rid) : undefined;
    if (rel && !rel.external) { const src = await mediaSrc(ctx, rel.target); return src ? { imageUrl: src } : undefined; }
  }
  const ref = kid(bg, "p:bgRef");
  if (ref) { const v = displayColor(colorOf(ctx, ref)); return v ? { color: v } : undefined; }
  return undefined;
}

function readTransition(sld: XEl): DeckSlide["transition"] | undefined {
  let tr = kid(sld, "p:transition");
  const alt = kid(sld, "mc:AlternateContent");
  if (!tr && alt) tr = kid(kid(alt, "mc:Fallback"), "p:transition") ?? kid(kid(alt, "mc:Choice"), "p:transition");
  if (!tr) return undefined;
  const child = els(tr)[0]?.name ?? "";
  if (/fade/i.test(child)) return "fade";
  if (/push/i.test(child)) return "push";
  if (/wipe/i.test(child)) return "wipe";
  return child ? "fade" : "none";
}

function layoutToApp(type: string | undefined, elements: DeckElement[], index: number): SlideLayout {
  switch (type) {
    case "title": return "title";
    case "secHead": return "section";
    case "twoObj": case "twoTxTwoObj": return elements.some((e) => e.role === "left") ? (type === "twoTxTwoObj" ? "comparison" : "two_column") : "bullets";
    case "tbl": return "table";
    case "chart": return "chart";
    case "picTx": return "image";
  }
  if (elements.some((e) => e.type === "chart")) return "chart";
  if (elements.some((e) => e.type === "table")) return "table";
  const bodies = elements.filter((e) => e.type === "text" && (e.role === "body" || e.role === "left" || e.role === "right" || (!e.role && e.text?.trim())));
  if (elements.some((e) => e.type === "image") && bodies.length === 0) return "image";
  const hasTitle = elements.some((e) => e.role === "title");
  if (hasTitle && bodies.length === 0) return index === 0 ? "title" : "section";
  if (bodies.length) return "bullets";
  void type;
  return "blank";
}

/** Files without placeholders (e.g. pptxgenjs decks): largest top text → title, largest remaining text → body. */
function tagRoles(elements: DeckElement[]) {
  if (elements.some((e) => e.role === "title")) return;
  const texts = elements.filter((e) => e.type === "text" && e.text?.trim() && !e.role);
  const title = [...texts].filter((e) => e.y < 320 && (e.style.fontSize ?? 0) >= 20).sort((a, b) => (b.style.fontSize ?? 0) - (a.style.fontSize ?? 0) || a.y - b.y)[0];
  if (title) { title.role = "title"; }
  const body = texts.filter((e) => e !== title && (e.style.fontSize ?? 0) <= 28).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (body && body.w * body.h > 60_000) body.role = "body";
}

async function readMaster(zip: JSZip, part: string): Promise<MasterData> {
  const doc = await readXmlPart(zip, part);
  const root = doc?.root;
  const rels = await RelSet.load(zip, part);
  const tx = kid(root, "p:txStyles");
  return { part, phs: readPlaceholders(path(root, "p:cSld", "p:spTree")), titleStyle: kid(tx, "p:titleStyle"), bodyStyle: kid(tx, "p:bodyStyle"), otherStyle: kid(tx, "p:otherStyle"), clrMap: readClrMap(kid(root, "p:clrMap")), bg: path(root, "p:cSld", "p:bg"), themePart: rels.byType(REL.theme)[0]?.target };
}

async function readLayout(zip: JSZip, part: string, masters: Map<string, MasterData>): Promise<LayoutData> {
  const doc = await readXmlPart(zip, part);
  const root = doc?.root;
  const rels = await RelSet.load(zip, part);
  const masterPart = rels.byType(REL.slideMaster)[0]?.target;
  let master = masterPart ? masters.get(masterPart) : undefined;
  if (!master && masterPart) { master = await readMaster(zip, masterPart); masters.set(masterPart, master); }
  const ovr = path(root, "p:clrMapOvr", "a:overrideClrMapping");
  return { part, name: attr(kid(root, "p:cSld"), "name") ?? part.split("/").pop() ?? part, type: attr(root, "type"), master, phs: readPlaceholders(path(root, "p:cSld", "p:spTree")), bg: path(root, "p:cSld", "p:bg"), clrMapOvr: ovr ? readClrMap(ovr) : undefined };
}

function readSections(pres: XEl | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const ext = kids(kid(pres, "p:extLst"), "p:ext");
  for (const e of ext) {
    const lst = kid(e, "p14:sectionLst");
    if (!lst) continue;
    for (const sec of kids(lst, "p14:section")) {
      const name = attr(sec, "name") ?? "Section";
      for (const id of kids(kid(sec, "p14:sldIdLst"), "p14:sldId")) out.set(attr(id, "id") ?? "", name);
    }
  }
  return out;
}

async function readNotes(zip: JSZip, rels: RelSet): Promise<string> {
  const rel = rels.byType(REL.notesSlide)[0];
  if (!rel) return "";
  const doc = await readXmlPart(zip, rel.target);
  if (!doc) return "";
  const shapes = kids(path(doc.root, "p:cSld", "p:spTree"), "p:sp");
  const body = shapes.find((sp) => attr(path(sp, "p:nvSpPr", "p:nvPr", "p:ph"), "type") === "body") ?? shapes.find((sp) => kid(sp, "p:txBody") && !path(sp, "p:nvSpPr", "p:nvPr", "p:ph"));
  if (!body) return "";
  return notesText(kid(body, "p:txBody"));
}

/** Plain notes text: one line per paragraph, a:br as newline. */
export function notesText(txBody: XEl | undefined): string {
  return kids(txBody, "a:p").map((p) => els(p).map((k) => (k.name === "a:br" ? "\n" : k.name === "a:r" || k.name === "a:fld" ? textContent(kid(k, "a:t") ?? { t: "text", v: "" }) : "")).join("")).join("\n").replace(/\n+$/, "");
}

export interface ReadResult { title: string; deck: DeckContent; warnings: string[] }

export async function readPptx(bytes: Uint8Array, filename: string, opts: ReadOptions = {}): Promise<ReadResult> {
  const zip = await JSZip.loadAsync(bytes);
  const presDoc: XDoc | null = await readXmlPart(zip, "ppt/presentation.xml");
  if (!presDoc) throw new Error("Not a PowerPoint file (missing ppt/presentation.xml)");
  const pres = presDoc.root;
  const sldSz = kid(pres, "p:sldSz");
  const cx = numAttr(sldSz, "cx", DEFAULT_SLIDE_CX) || DEFAULT_SLIDE_CX;
  const cy = numAttr(sldSz, "cy", DEFAULT_SLIDE_CY) || DEFAULT_SLIDE_CY;
  const map = canvasMap(cx, cy);
  const presRels = await RelSet.load(zip, "ppt/presentation.xml");
  const warnings: string[] = [];

  const masters = new Map<string, MasterData>();
  for (const r of presRels.byType(REL.slideMaster)) masters.set(r.target, await readMaster(zip, r.target));
  const layouts = new Map<string, LayoutData>();
  for (const m of [...masters.values()]) {
    const mrels = await RelSet.load(zip, m.part);
    for (const r of mrels.byType(REL.slideLayout)) if (!layouts.has(r.target)) layouts.set(r.target, await readLayout(zip, r.target, masters));
  }
  const firstMaster = [...masters.values()][0];
  const themePart = firstMaster?.themePart ?? presRels.byType(REL.theme)[0]?.target;
  const parsedTheme = parseTheme(themePart ? await readXmlPart(zip, themePart) : null);
  const themeId = `pptx-${nanoid(6)}`;
  const deckTheme = deckThemeFromScheme(parsedTheme, themeId);

  const sections = readSections(pres);
  const pkgId = opts.sha256 ?? `pkg_${nanoid(10)}`;
  const sldIds = kids(kid(pres, "p:sldIdLst"), "p:sldId").map((s) => ({ id: attr(s, "id") ?? "", rid: attr(s, "r:id") ?? "" }));
  const mediaCache = new Map<string, string>();
  const slides: DeckSlide[] = [];

  for (const [index, sid] of sldIds.entries()) {
    const rel = presRels.get(sid.rid);
    if (!rel) { warnings.push(`slide id ${sid.id}: missing relationship ${sid.rid}`); continue; }
    const part = rel.target;
    const xmlText = await zip.file(part)?.async("string");
    const doc = xmlText ? await readXmlPart(zip, part) : null;
    if (!doc || !xmlText) { warnings.push(`slide ${index + 1}: missing part ${part}`); continue; }
    const rels = await RelSet.load(zip, part);
    const layoutPart = rels.byType(REL.slideLayout)[0]?.target;
    let layout = layoutPart ? layouts.get(layoutPart) : undefined;
    if (!layout && layoutPart) { layout = await readLayout(zip, layoutPart, masters); layouts.set(layoutPart, layout); }
    const master = layout?.master ?? firstMaster;
    const sld = doc.root;
    const slideOvr = path(sld, "p:clrMapOvr", "a:overrideClrMapping");
    const clrMap = slideOvr ? readClrMap(slideOvr) : layout?.clrMapOvr ?? master?.clrMap ?? readClrMap(undefined);
    const ctx: SlideRead = { zip, map, theme: parsedTheme, clrMap, layout, master, defaultTextStyle: kid(pres, "p:defaultTextStyle"), rels, part, elements: [], z: 0, opts, mediaCache, warnings, slideIndex: index };
    await walkTree(ctx, path(sld, "p:cSld", "p:spTree"));
    tagRoles(ctx.elements);
    for (const e of ctx.elements) if (e.ooxml) e.ooxml.fp = elementFingerprint(e);
    const own = await readBackground(ctx, path(sld, "p:cSld", "p:bg"));
    const inheritedBg = own ? undefined : (await readBackground(ctx, layout?.bg)) ?? (await readBackground(ctx, master?.bg));
    const background = own ?? inheritedBg;
    const notes = await readNotes(zip, rels);
    const hidden = attr(sld, "show") === "0" || attr(sld, "show") === "false";
    const transition = readTransition(sld);
    const slide: DeckSlide = { id: newSlideId(), layout: layoutToApp(layout?.type, ctx.elements, index), background, elements: ctx.elements, notes, hidden, transition, name: attr(kid(sld, "p:cSld"), "name") };
    const section = sections.get(sid.id); if (section) slide.section = section;
    slide.ooxml = { part, layoutPart, layoutName: layout?.name, fp: "", pkg: pkgId, xmlHash: fnv1a64(xmlText), notes0: notes, hidden0: hidden, transition0: transition, background0: background };
    slide.ooxml.fp = slideFingerprint(slide);
    slides.push(slide);
  }

  const layoutInfos: PptxLayoutInfo[] = [...layouts.values()].map((l) => ({ part: l.part, name: l.name, type: l.type, master: l.master?.part ?? "", placeholders: l.phs.map((p) => ({ type: p.type, idx: p.idx, name: p.name, emu: p.emu ?? matchPh(l.master?.phs, p.type, undefined, false)?.emu })) }));
  const pptx: PptxMeta = { sourceFile: filename, sha256: opts.sha256, pkgId, slideSize: { cx, cy }, map, layouts: layoutInfos, themePart, scheme: parsedTheme.scheme, fonts: parsedTheme.fonts, themeFp: themeFingerprint(deckTheme), sections: [...new Set(sections.values())], warnings: warnings.slice(0, 50) };
  let title = filename.replace(/\.[^.]+$/, "");
  const core = await zip.file("docProps/core.xml")?.async("string");
  const m = core?.match(/<dc:title>([^<]*)<\/dc:title>/);
  if (m?.[1]?.trim()) title = m[1].trim();
  const deck: DeckContent = { version: 1, theme: deckTheme, size: { w: SLIDE_W, h: SLIDE_H }, slides, meta: { createdWith: "import", sourceFile: filename, pptx } };
  void PT_TO_PX;
  return { title, deck, warnings };
}
