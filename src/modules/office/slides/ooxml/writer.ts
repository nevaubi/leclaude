/**
 * PresentationML writers used by the package-preserving exporter:
 *  - fresh shapes for elements authored in LeClaude (text, shape, line, picture, table, chart);
 *  - text-body regeneration for edited imported shapes, reusing the source paragraphs' pPr/rPr as templates so
 *    placeholder inheritance, fonts and colors survive an edit;
 *  - chart parts and notes slides.
 * Colors are written theme-aware (schemeClr) for theme tokens, so a restyled theme part recolors new content too.
 */
import {
  hexForExport, parseMarkdownLite, resolveColor, resolveFontFace,
  type ChartSpec, type DeckElement, type DeckTheme, type ElementStyle, type TableCell, type TextLine,
} from "../model";
import { EMU_PER_PT, NS } from "./package";
import { tokenToScheme } from "./theme";
import { attr, clone, els, escAttr, escText, frag, insertKid, insertOrdered, kid, kids, mk, removeKid, setAttr, setKids, type XEl, type XNode } from "./xml";
import type { CanvasMap } from "./reader";

export const pxToEmuX = (px: number, m: CanvasMap) => Math.round((px - m.offX) / m.scale);
export const pxToEmuY = (px: number, m: CanvasMap) => Math.round((px - m.offY) / m.scale);
export const pxToEmuLen = (px: number, m: CanvasMap) => Math.max(0, Math.round(px / m.scale));
const ptFactor = (m: CanvasMap) => (m.scale * 914400) / 96;
/** Canvas pt → hundredths of a source pt. */
export const canvasPtToSz = (pt: number, m: CanvasMap) => Math.max(100, Math.round((pt / ptFactor(m)) * 100));

export interface WriteCtx { theme: DeckTheme; map: CanvasMap }

/** DrawingML color element for a model color ("#hex" or theme token). */
export function colorXml(value: string | undefined, ctx: WriteCtx): string {
  if (!value) return "";
  const scheme = tokenToScheme(value);
  if (scheme) return `<a:schemeClr val="${scheme}"/>`;
  return `<a:srgbClr val="${hexForExport(value, ctx.theme, "000000")}"/>`;
}
const solid = (value: string | undefined, ctx: WriteCtx) => (value && resolveColor(value, ctx.theme, "") && resolveColor(value, ctx.theme, "") !== "transparent" ? `<a:solidFill>${colorXml(value, ctx)}</a:solidFill>` : "");

export function xfrmXml(e: Pick<DeckElement, "x" | "y" | "w" | "h" | "rotation" | "flipH" | "flipV">, ctx: WriteCtx, tag = "a:xfrm"): string {
  const rot = e.rotation ? ` rot="${Math.round(e.rotation * 60000)}"` : "";
  const fh = e.flipH ? ` flipH="1"` : "", fv = e.flipV ? ` flipV="1"` : "";
  return `<${tag}${rot}${fh}${fv}><a:off x="${pxToEmuX(e.x, ctx.map)}" y="${pxToEmuY(e.y, ctx.map)}"/><a:ext cx="${pxToEmuLen(e.w, ctx.map)}" cy="${pxToEmuLen(Math.max(0, e.h), ctx.map)}"/></${tag}>`;
}

const fontFace = (family: string | undefined, theme: DeckTheme) => (!family || family === "body" ? "+mn-lt" : family === "heading" ? "+mj-lt" : resolveFontFace(family, theme));

function rPrXml(o: { size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; font?: string }, ctx: WriteCtx, tag = "a:rPr"): string {
  const a = [`lang="en-US"`];
  if (o.size) a.push(`sz="${canvasPtToSz(o.size, ctx.map)}"`);
  if (o.bold !== undefined) a.push(`b="${o.bold ? 1 : 0}"`);
  if (o.italic !== undefined) a.push(`i="${o.italic ? 1 : 0}"`);
  if (o.underline) a.push(`u="sng"`);
  a.push(`dirty="0"`);
  const inner = `${solid(o.color, ctx)}${o.font ? `<a:latin typeface="${escAttr(o.font)}"/>` : ""}`;
  return inner ? `<${tag} ${a.join(" ")}>${inner}</${tag}>` : `<${tag} ${a.join(" ")}/>`;
}

const LVL_EMU = 400050;
function bulletXml(kind: TextLine["kind"]): string {
  return kind === "bullet" ? `<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>` : kind === "number" ? `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>` : `<a:buNone/>`;
}

/** Paragraphs for markdown-lite text with element-level style (fresh shapes). */
export function paragraphsXml(text: string | undefined, style: ElementStyle, ctx: WriteCtx): string {
  const algn = style.align === "center" ? "ctr" : style.align === "right" ? "r" : undefined;
  const lnPct = style.lineHeight ? Math.round((style.lineHeight / 1.2) * 100000) : undefined;
  const base = { size: style.fontSize, color: style.color, font: fontFace(style.fontFamily, ctx.theme) };
  return parseMarkdownLite(text).map((line) => {
    const marL = line.kind === "para" ? line.indent * LVL_EMU : 342900 + line.indent * LVL_EMU;
    const indent = line.kind === "para" ? 0 : -342900;
    const pPr = `<a:pPr lvl="${line.indent}" marL="${marL}" indent="${indent}"${algn ? ` algn="${algn}"` : ""}>${lnPct ? `<a:lnSpc><a:spcPct val="${lnPct}"/></a:lnSpc>` : ""}${bulletXml(line.kind)}</a:pPr>`;
    const runs = line.runs.filter((r) => r.text.length).map((r) => `<a:r>${rPrXml({ ...base, bold: style.bold || r.bold ? true : undefined, italic: style.italic || r.italic ? true : undefined, underline: style.underline || r.underline }, ctx)}<a:t>${escText(r.text)}</a:t></a:r>`).join("");
    return `<a:p>${pPr}${runs}${rPrXml(base, ctx, "a:endParaRPr")}</a:p>`;
  }).join("") || `<a:p>${rPrXml(base, ctx, "a:endParaRPr")}</a:p>`;
}

function bodyPrXml(style: ElementStyle, ctx: WriteCtx, anchorDefault = "t"): string {
  const ins = pxToEmuLen(style.padding ?? 8, ctx.map);
  const anchor = style.valign === "middle" ? "ctr" : style.valign === "bottom" ? "b" : style.valign === "top" ? "t" : anchorDefault;
  return `<a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0"><a:normAutofit/></a:bodyPr>`;
}

function lnXml(stroke: string | undefined, width: number | undefined, ctx: WriteCtx, extra = ""): string {
  if (!stroke) return `<a:ln><a:noFill/></a:ln>`;
  return `<a:ln w="${Math.round((width ?? 1) * EMU_PER_PT)}">${solid(stroke, ctx)}${extra}</a:ln>`;
}

const PH_TYPE: Partial<Record<NonNullable<DeckElement["role"]>, string>> = { title: "title", subtitle: "subTitle", body: "body", date: "dt", footer: "ftr" };

export interface NewShapeRefs { imageRid?: string; chartRid?: string; imageSize?: { w: number; h: number } }

/** XML for an element authored in LeClaude. `ph` places it in the layout placeholder of that type. */
export function elementXml(e: DeckElement, spid: number, ctx: WriteCtx, refs: NewShapeRefs = {}, ph?: { type: string; idx?: string }): string | null {
  const st = e.style;
  const name = escAttr(e.name ?? `${e.role ?? e.type} ${spid}`);
  switch (e.type) {
    case "text": {
      const phXml = ph ? `<p:ph type="${ph.type}"${ph.idx ? ` idx="${ph.idx}"` : ""}/>` : "";
      const geom = st.radius && st.fill ? "roundRect" : "rect";
      return `<p:sp><p:nvSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvSpPr${ph ? "><a:spLocks noGrp=\"1\"/></p:cNvSpPr>" : ` txBox="1"/>`}<p:nvPr>${phXml}</p:nvPr></p:nvSpPr><p:spPr>${xfrmXml(e, ctx)}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${st.fill ? solid(st.fill, ctx) : "<a:noFill/>"}${st.stroke ? lnXml(st.stroke, st.strokeWidth, ctx) : ""}</p:spPr><p:txBody>${bodyPrXml(st, ctx)}<a:lstStyle/>${paragraphsXml(e.text, st, ctx)}</p:txBody></p:sp>`;
    }
    case "shape": {
      const prst = e.shape === "ellipse" ? "ellipse" : e.shape === "arrow" ? "rightArrow" : st.radius ? "roundRect" : "rect";
      const tx = e.text?.trim() ? `<p:txBody>${bodyPrXml({ ...st, valign: st.valign ?? "middle" }, ctx, "ctr")}<a:lstStyle/>${paragraphsXml(e.text, { ...st, align: st.align ?? "center" }, ctx)}</p:txBody>` : "";
      return `<p:sp><p:nvSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(e, ctx)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${st.fill ? solid(st.fill, ctx) : "<a:noFill/>"}${lnXml(st.stroke, st.strokeWidth, ctx)}</p:spPr>${tx}</p:sp>`;
    }
    case "line": {
      const flipV = e.flipV ?? st.lineDir === "up";
      const tail = st.arrowEnd ? `<a:tailEnd type="triangle"/>` : "";
      return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrmXml({ ...e, flipV }, ctx)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lnXml(st.stroke ?? "muted", st.strokeWidth ?? 2, ctx, tail)}</p:spPr></p:cxnSp>`;
    }
    case "image": {
      if (!refs.imageRid) return null;
      let box = { ...e };
      let crop = e.crop;
      const size = refs.imageSize;
      if (size && size.w > 0 && size.h > 0 && !crop && st.fit !== "fill") {
        const imgR = size.w / size.h, boxR = e.w / Math.max(1, e.h);
        if (st.fit === "cover") {
          if (imgR > boxR) { const keep = boxR / imgR; crop = { l: (1 - keep) / 2, r: (1 - keep) / 2, t: 0, b: 0 }; }
          else if (imgR < boxR) { const keep = imgR / boxR; crop = { t: (1 - keep) / 2, b: (1 - keep) / 2, l: 0, r: 0 }; }
        } else if (imgR > boxR) { const h = e.w / imgR; box = { ...e, y: e.y + (e.h - h) / 2, h }; }
        else if (imgR < boxR) { const w = e.h * imgR; box = { ...e, x: e.x + (e.w - w) / 2, w }; }
      }
      const src = crop ? `<a:srcRect l="${Math.round(crop.l * 100000)}" t="${Math.round(crop.t * 100000)}" r="${Math.round(crop.r * 100000)}" b="${Math.round(crop.b * 100000)}"/>` : "";
      return `<p:pic><p:nvPicPr><p:cNvPr id="${spid}" name="${name}"${e.alt ? ` descr="${escAttr(e.alt)}"` : ""}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${refs.imageRid}"/>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(box, ctx)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${st.stroke ? lnXml(st.stroke, st.strokeWidth, ctx) : ""}</p:spPr></p:pic>`;
    }
    case "table": {
      if (!e.table) return null;
      return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${spid}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrmXml(e, ctx, "p:xfrm")}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${tableXml(e, ctx)}</a:graphicData></a:graphic></p:graphicFrame>`;
    }
    case "chart": {
      if (!refs.chartRid) return null;
      return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${spid}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrmXml(e, ctx, "p:xfrm")}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="${NS.c}" xmlns:r="${NS.r}" r:id="${refs.chartRid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
    }
  }
  return null;
}

/** Cell grid for a table element (header row first); synthesized from header/rows when no imported grid exists. */
export function tableGrid(e: DeckElement): TableCell[][] {
  const t = e.table!;
  const texts = [t.header, ...t.rows];
  const cols = Math.max(1, ...texts.map((r) => r.length));
  if (t.cells && t.cells.length === texts.length && t.cells.every((r) => r.length === cols)) return t.cells.map((r, ri) => r.map((c, ci) => ({ ...c, text: texts[ri][ci] ?? "" })));
  return texts.map((r) => Array.from({ length: cols }, (_, ci) => ({ text: r[ci] ?? "" })));
}

function borderXml(tag: string, b: TableCell["borders"] extends infer T ? T extends Record<string, infer B> ? B | undefined : never : never, fallback: string | undefined, ctx: WriteCtx): string {
  if (b?.none) return `<${tag} w="0"><a:noFill/></${tag}>`;
  const color = b?.color ?? fallback;
  if (!color) return "";
  return `<${tag} w="${Math.round((b?.width ?? 0.75) * EMU_PER_PT)}">${solid(color, ctx)}</${tag}>`;
}

export function tableXml(e: DeckElement, ctx: WriteCtx): string {
  const t = e.table!;
  const grid = tableGrid(e);
  const cols = grid[0]?.length ?? 1;
  const totalW = pxToEmuLen(e.w, ctx.map), totalH = pxToEmuLen(e.h, ctx.map);
  const fr = t.colWidths && t.colWidths.length === cols ? t.colWidths : Array.from({ length: cols }, () => 1 / cols);
  const sum = fr.reduce((a, b) => a + b, 0) || 1;
  const widths = fr.map((f) => Math.round((totalW * f) / sum));
  const rh = t.rowHeights && t.rowHeights.length === grid.length ? t.rowHeights : grid.map(() => 1 / grid.length);
  const rs = rh.reduce((a, b) => a + b, 0) || 1;
  const st = e.style;
  const headerFill = st.headerFill ?? "accent";
  const headerColor = st.headerColor ?? "bg";
  const rows = grid.map((row, ri) => {
    const h = Math.max(Math.round(EMU_PER_PT * 14), Math.round((totalH * rh[ri]) / rs));
    const cells = row.map((c) => {
      const header = ri === 0 && t.firstRow !== false;
      const fill = c.fill ?? (header ? headerFill : st.banded !== false && ri % 2 === 0 && ri > 0 ? "surface" : undefined);
      const color = header ? headerColor : st.color ?? "fg";
      const a = [c.gridSpan && c.gridSpan > 1 ? ` gridSpan="${c.gridSpan}"` : "", c.rowSpan && c.rowSpan > 1 ? ` rowSpan="${c.rowSpan}"` : "", c.hMerge ? ` hMerge="1"` : "", c.vMerge ? ` vMerge="1"` : ""].join("");
      const cellStyle: ElementStyle = { fontSize: st.fontSize ?? 14, color, bold: header || c.bold ? true : undefined, align: c.align, fontFamily: st.fontFamily };
      const lines = c.text.split("\n").map((l) => l).join("\n");
      const b = c.borders ?? {};
      const stroke = st.stroke ?? "muted";
      const tcPr = `<a:tcPr marL="${pxToEmuLen(6, ctx.map)}" marR="${pxToEmuLen(6, ctx.map)}" marT="${pxToEmuLen(4, ctx.map)}" marB="${pxToEmuLen(4, ctx.map)}" anchor="${header ? "ctr" : "t"}">${borderXml("a:lnL", b.l, stroke, ctx)}${borderXml("a:lnR", b.r, stroke, ctx)}${borderXml("a:lnT", b.t, stroke, ctx)}${borderXml("a:lnB", b.b, stroke, ctx)}${fill ? solid(fill, ctx) : "<a:noFill/>"}</a:tcPr>`;
      return `<a:tc${a}><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphsXml(lines, cellStyle, ctx)}</a:txBody>${tcPr}</a:tc>`;
    }).join("");
    return `<a:tr h="${h}">${cells}</a:tr>`;
  }).join("");
  return `<a:tbl><a:tblPr${t.firstRow !== false ? ` firstRow="1"` : ""}${st.banded !== false ? ` bandRow="1"` : ""}/><a:tblGrid>${widths.map((w) => `<a:gridCol w="${w}"/>`).join("")}</a:tblGrid>${rows}</a:tbl>`;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const CHART_TOKENS = ["accent", "accent2", "muted", "#5B8DEF", "#9BB0C9", "#C97B7B", "#7BC9A4"];
const colLetter = (i: number) => String.fromCharCode(66 + i);

export function chartPartXml(chart: ChartSpec, ctx: WriteCtx): string {
  const cats = chart.categories;
  const strCache = (vals: string[]) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${escText(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const numCache = (vals: number[]) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v) || 0}</c:v></c:pt>`).join("")}</c:numCache>`;
  const series = chart.type === "pie" ? chart.series.slice(0, 1) : chart.series;
  const dLbls = `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="${chart.showValues && chart.type !== "pie" ? 1 : 0}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${chart.type === "pie" && chart.showValues !== false ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>`;
  const ser = series.map((s, i) => {
    const color = CHART_TOKENS[i % CHART_TOKENS.length];
    const spPr = chart.type === "line" ? `<c:spPr><a:ln w="28575">${solid(color, ctx)}</a:ln></c:spPr>` : `<c:spPr>${solid(color, ctx)}</c:spPr>`;
    const dPt = chart.type === "pie" ? cats.map((_, ci) => `<c:dPt><c:idx val="${ci}"/><c:bubble3D val="0"/><c:spPr>${solid(CHART_TOKENS[ci % CHART_TOKENS.length], ctx)}</c:spPr></c:dPt>`).join("") : "";
    const tx = `<c:tx><c:strRef><c:f>Sheet1!$${colLetter(i)}$1</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
    const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${cats.length + 1}</c:f>${strCache(cats)}</c:strRef></c:cat>`;
    const val = `<c:val><c:numRef><c:f>Sheet1!$${colLetter(i)}$2:$${colLetter(i)}$${cats.length + 1}</c:f>${numCache(cats.map((_, ci) => s.values[ci] ?? 0))}</c:numRef></c:val>`;
    if (chart.type === "bar") return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr}<c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
    if (chart.type === "line") return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr}<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${dPt}${cat}${val}</c:ser>`;
  }).join("");
  const axes = `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const plot = chart.type === "bar"
    ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}${dLbls}<c:gapWidth val="60"/><c:axId val="500000001"/><c:axId val="500000002"/></c:barChart>${axes}`
    : chart.type === "line"
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}${dLbls}<c:marker val="1"/><c:axId val="500000001"/><c:axId val="500000002"/></c:lineChart>${axes}`
      : `<c:pieChart><c:varyColors val="1"/>${ser}${dLbls}<c:firstSliceAng val="0"/></c:pieChart>`;
  const title = chart.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escText(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : `<c:autoTitleDeleted val="1"/>`;
  const legend = chart.showLegend ?? (series.length > 1 || chart.type === "pie") ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

// ---------------------------------------------------------------------------
// Editing imported text bodies
// ---------------------------------------------------------------------------

const RPR_AFTER_FILL = ["a:effectLst", "a:effectDag", "a:highlight", "a:uLnTx", "a:uLn", "a:uFillTx", "a:uFill", "a:latin", "a:ea", "a:cs", "a:sym", "a:hlinkClick", "a:hlinkMouseOver", "a:rtl", "a:extLst"];
const RPR_AFTER_LATIN = ["a:ea", "a:cs", "a:sym", "a:hlinkClick", "a:hlinkMouseOver", "a:rtl", "a:extLst"];
const FILL_NAMES = ["a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill", "a:grpFill"];

function setRunColor(rPr: XEl, color: string, ctx: WriteCtx) {
  for (const f of els(rPr).filter((k) => FILL_NAMES.includes(k.name))) removeKid(rPr, f);
  insertOrdered(rPr, frag(`<a:solidFill>${colorXml(color, ctx)}</a:solidFill>`), RPR_AFTER_FILL);
}
function setRunFont(rPr: XEl, face: string) {
  const cur = kid(rPr, "a:latin");
  if (cur) setAttr(cur, "typeface", face); else insertOrdered(rPr, mk("a:latin", { typeface: face }), RPR_AFTER_LATIN);
}

export type StyleDiff = Partial<Pick<ElementStyle, "fontSize" | "bold" | "italic" | "underline" | "color" | "fontFamily" | "align" | "valign">>;

export function styleDiff(style: ElementStyle, base: ElementStyle): StyleDiff {
  const d: StyleDiff = {};
  for (const k of ["fontSize", "bold", "italic", "underline", "color", "fontFamily", "align", "valign"] as const) {
    const a = style[k] ?? (k === "bold" || k === "italic" || k === "underline" ? false : undefined);
    const b = base[k] ?? (k === "bold" || k === "italic" || k === "underline" ? false : undefined);
    if (a !== b) (d as Record<string, unknown>)[k] = style[k] ?? (typeof b === "boolean" ? false : undefined);
  }
  return d;
}

/** Apply element-level style changes to every run of an existing text body. */
export function applyStyleDiff(txBody: XEl, diff: StyleDiff, ctx: WriteCtx) {
  if (!Object.keys(diff).length) return;
  for (const p of kids(txBody, "a:p")) {
    if (diff.align !== undefined) {
      let pPr = kid(p, "a:pPr");
      if (!pPr) { pPr = mk("a:pPr"); insertKid(p, 0, pPr); }
      setAttr(pPr, "algn", diff.align === "center" ? "ctr" : diff.align === "right" ? "r" : "l");
    }
    const rPrs: XEl[] = [];
    for (const r of els(p)) {
      if (r.name === "a:r" || r.name === "a:fld") {
        let rPr = kid(r, "a:rPr");
        if (!rPr) { rPr = mk("a:rPr", { lang: "en-US", dirty: "0" }); insertKid(r, 0, rPr); }
        rPrs.push(rPr);
      } else if (r.name === "a:endParaRPr") rPrs.push(r);
    }
    for (const rPr of rPrs) {
      if (diff.fontSize !== undefined) setAttr(rPr, "sz", canvasPtToSz(diff.fontSize, ctx.map));
      if (diff.bold !== undefined) setAttr(rPr, "b", diff.bold ? "1" : "0");
      if (diff.italic !== undefined) setAttr(rPr, "i", diff.italic ? "1" : "0");
      if (diff.underline !== undefined) setAttr(rPr, "u", diff.underline ? "sng" : "none");
      if (diff.color) setRunColor(rPr, diff.color, ctx);
      if (diff.fontFamily) setRunFont(rPr, fontFace(diff.fontFamily, ctx.theme));
    }
  }
  const bodyPr = kid(txBody, "a:bodyPr");
  if (bodyPr && diff.valign) setAttr(bodyPr, "anchor", diff.valign === "middle" ? "ctr" : diff.valign === "bottom" ? "b" : "t");
  if (bodyPr && diff.fontSize !== undefined) clearAutofitScale(bodyPr);
}

export function clearAutofitScale(bodyPr: XEl) {
  const norm = kid(bodyPr, "a:normAutofit");
  if (norm) { setAttr(norm, "fontScale", undefined); setAttr(norm, "lnSpcReduction", undefined); }
}

const BULLET_NAMES = ["a:buClrTx", "a:buClr", "a:buSzTx", "a:buSzPct", "a:buSzPts", "a:buFontTx", "a:buFont", "a:buNone", "a:buAutoNum", "a:buChar", "a:buBlip"];
const PPR_AFTER_BULLET = ["a:tabLst", "a:defRPr", "a:extLst"];

/**
 * Rebuild the paragraphs of an imported text body from edited markdown. Each new paragraph borrows pPr/rPr from the
 * source paragraph at the same position (or the last one at the same level), so inherited formatting survives.
 */
export function rebuildParagraphs(txBody: XEl, markdown: string, el: DeckElement, ctx: WriteCtx) {
  const srcPs = kids(txBody, "a:p");
  const srcKinds = parseMarkdownLite(el.rich?.markdown ?? "").map((l) => l.kind);
  const baseBold = Boolean(el.ooxml?.base.style.bold), baseItalic = Boolean(el.ooxml?.base.style.italic), baseU = Boolean(el.ooxml?.base.style.underline);
  const wantB = Boolean(el.style.bold), wantI = Boolean(el.style.italic), wantU = Boolean(el.style.underline);
  const lines = parseMarkdownLite(markdown);
  const next: XNode[] = [];
  lines.forEach((line, i) => {
    const tplIdx = i < srcPs.length ? i : Math.max(0, srcPs.length - 1 - [...srcPs].reverse().findIndex((p) => Number(attr(kid(p, "a:pPr"), "lvl") ?? 0) === line.indent));
    const tpl = srcPs[Math.min(tplIdx, srcPs.length - 1)];
    const tplKind = srcKinds[Math.min(tplIdx, srcKinds.length - 1)] ?? "para";
    const pPr = tpl && kid(tpl, "a:pPr") ? clone(kid(tpl, "a:pPr")!) : mk("a:pPr");
    pPr.dirty = true;
    setAttr(pPr, "lvl", line.indent ? line.indent : undefined);
    if (line.kind !== tplKind) {
      for (const b of els(pPr).filter((k) => BULLET_NAMES.includes(k.name))) removeKid(pPr, b);
      for (const b of els(frag(`<x>${bulletXml(line.kind)}</x>`))) insertOrdered(pPr, b, PPR_AFTER_BULLET);
      if (line.kind === "para") { setAttr(pPr, "indent", "0"); setAttr(pPr, "marL", String(line.indent * LVL_EMU)); }
      else if (!attr(pPr, "marL")) { setAttr(pPr, "marL", String(342900 + line.indent * LVL_EMU)); setAttr(pPr, "indent", "-342900"); }
    }
    const tplRun = tpl ? els(tpl).find((k) => k.name === "a:r") : undefined;
    const tplRPr = tplRun && kid(tplRun, "a:rPr") ? kid(tplRun, "a:rPr")! : undefined;
    const p = mk("a:p", {}, [pPr]);
    for (const r of line.runs) {
      if (!r.text) continue;
      const rPr = tplRPr ? clone(tplRPr) : mk("a:rPr", { lang: "en-US", dirty: "0" });
      rPr.dirty = true;
      const b = wantB || Boolean(r.bold), it = wantI || Boolean(r.italic), u = wantU || Boolean(r.underline);
      const tb = attr(tplRPr, "b") !== undefined ? attr(tplRPr, "b") === "1" : baseBold;
      const ti = attr(tplRPr, "i") !== undefined ? attr(tplRPr, "i") === "1" : baseItalic;
      const tu = attr(tplRPr, "u") !== undefined ? attr(tplRPr, "u") !== "none" : baseU;
      if (b !== tb) setAttr(rPr, "b", b ? "1" : "0");
      if (it !== ti) setAttr(rPr, "i", it ? "1" : "0");
      if (u !== tu) setAttr(rPr, "u", u ? "sng" : "none");
      for (const h of els(rPr).filter((k) => k.name === "a:hlinkClick" || k.name === "a:hlinkMouseOver")) removeKid(rPr, h);
      appendRun(p, rPr, r.text);
    }
    const end = tpl ? kid(tpl, "a:endParaRPr") : undefined;
    if (end) p.kids.push(clone(end));
    next.push(p);
  });
  const others = txBody.kids.filter((k) => !(k.t === "el" && k.name === "a:p"));
  setKids(txBody, [...others, ...next]);
  const bodyPr = kid(txBody, "a:bodyPr");
  if (bodyPr) clearAutofitScale(bodyPr);
}

function appendRun(p: XEl, rPr: XEl, text: string) {
  p.kids.push(mk("a:r", {}, [rPr, mk("a:t", {}, [text])]));
}

/** Replace a notes slide's body text with plain paragraphs (one per line). */
export function setNotesParagraphs(txBody: XEl, text: string) {
  const srcP = kids(txBody, "a:p")[0];
  const tplRPr = srcP ? kid(els(srcP).find((k) => k.name === "a:r") ?? mk("x"), "a:rPr") : undefined;
  const paras = text.split("\n").map((line) => {
    const p = mk("a:p");
    if (line) p.kids.push(mk("a:r", {}, [tplRPr ? clone(tplRPr) : mk("a:rPr", { lang: "en-US", dirty: "0" }), mk("a:t", {}, [line])]));
    return p;
  });
  const others = txBody.kids.filter((k) => !(k.t === "el" && k.name === "a:p"));
  setKids(txBody, [...others, ...(paras.length ? paras : [mk("a:p")])]);
}

export function notesSlideXml(text: string): string {
  const paras = text.split("\n").map((l) => (l ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escText(l)}</a:t></a:r></a:p>` : "<a:p/>")).join("") || "<a:p/>";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

export function notesMasterXml(): string {
  const sp = (id: number, name: string, ph: string, x: number, y: number, cx: number, cy: number, body: boolean) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${body ? `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>` : ""}</p:sp>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notesMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${sp(2, "Slide Image Placeholder 1", `<p:ph type="sldImg" idx="2"/>`, 685800, 1143000, 5486400, 3086100, false)}${sp(3, "Notes Placeholder 2", `<p:ph type="body" sz="quarter" idx="3"/>`, 685800, 4400550, 5486400, 3600450, true)}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
}

/** Sniff pixel dimensions of PNG / JPEG / GIF bytes (for contain/cover placement). */
export function imageDimensions(b: Uint8Array): { w: number; h: number } | undefined {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return undefined;
}
