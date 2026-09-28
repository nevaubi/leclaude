/**
 * DrawingML charts: build basic bar / line / area / pie / scatter chart parts
 * (with value caches from the engine) and parse imported chart parts back to
 * the SheetChart model. Anchors convert between grid pixels and cell offsets.
 */
import { colToLetter, normalizeRange, parseRange, quoteSheet, toA1, type RangeRef } from "../a1";
import type { Computed } from "../engine";
import { toNumber } from "../format";
import { colWidth, rowHeight, type ChartType, type Sheet, type SheetChart } from "../model";
import { attrs, child, children, esc, parseXml, text, type XNode } from "./xml";

export const EMU_PER_PX = 9525;

export interface Anchor { from: { col: number; colOff: number; row: number; rowOff: number }; to: { col: number; colOff: number; row: number; rowOff: number } }

/** Pixel rectangle (grid origin = A1 top-left) → two-cell anchor. */
export function pxToAnchor(sheet: Sheet, pos: SheetChart["position"]): Anchor {
  const locate = (px: number, size: (i: number) => number) => { let i = 0, acc = 0; while (i < 16_383 && acc + size(i) <= px) { acc += size(i); i++; } return { idx: i, off: Math.round((px - acc) * EMU_PER_PX) }; };
  const c0 = locate(pos.x, (i) => colWidth(sheet, i)), r0 = locate(pos.y, (i) => rowHeight(sheet, i));
  const c1 = locate(pos.x + pos.w, (i) => colWidth(sheet, i)), r1 = locate(pos.y + pos.h, (i) => rowHeight(sheet, i));
  return { from: { col: c0.idx, colOff: c0.off, row: r0.idx, rowOff: r0.off }, to: { col: c1.idx, colOff: c1.off, row: r1.idx, rowOff: r1.off } };
}

export function anchorToPx(sheet: Sheet, a: Anchor): SheetChart["position"] {
  const sum = (n: number, size: (i: number) => number) => { let acc = 0; for (let i = 0; i < n; i++) acc += size(i); return acc; };
  const x = sum(a.from.col, (i) => colWidth(sheet, i)) + a.from.colOff / EMU_PER_PX;
  const y = sum(a.from.row, (i) => rowHeight(sheet, i)) + a.from.rowOff / EMU_PER_PX;
  const x2 = sum(a.to.col, (i) => colWidth(sheet, i)) + a.to.colOff / EMU_PER_PX;
  const y2 = sum(a.to.row, (i) => rowHeight(sheet, i)) + a.to.rowOff / EMU_PER_PX;
  return { x: Math.round(x), y: Math.round(y), w: Math.max(40, Math.round(x2 - x)), h: Math.max(40, Math.round(y2 - y)) };
}

export function anchorXml(a: Anchor, inner: string): string {
  const pt = (tag: string, p: Anchor["from"]) => `<xdr:${tag}><xdr:col>${p.col}</xdr:col><xdr:colOff>${p.colOff}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${p.rowOff}</xdr:rowOff></xdr:${tag}>`;
  return `<xdr:twoCellAnchor editAs="oneCell">${pt("from", a.from)}${pt("to", a.to)}${inner}<xdr:clientData/></xdr:twoCellAnchor>`;
}

export function chartFrameXml(id: number, name: string, rid: string): string {
  return `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
}

export const DRAWING_OPEN = '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">';

// ------------------------------------------------------------------ build

interface Series { name?: { ref: string; value: string }; cat?: { ref: string; values: string[]; numeric: boolean }; val: { ref: string; values: (number | null)[] } }

function absRange(sheetName: string, r: RangeRef): string {
  const a = `$${colToLetter(r.start.col)}$${r.start.row + 1}`;
  const b = `$${colToLetter(r.end.col)}$${r.end.row + 1}`;
  return `${quoteSheet(sheetName)}!${a === b ? a : `${a}:${b}`}`;
}

/** Series for a chart, following the same header/category conventions as the grid renderer. */
export function chartSeries(chart: SheetChart, sheet: Sheet, value: (ref: string) => unknown): Series[] {
  let data: RangeRef;
  try { data = normalizeRange(parseRange(chart.range)); } catch { return []; }
  let cats: RangeRef | null = null;
  try { if (chart.categoryRange) cats = normalizeRange(parseRange(chart.categoryRange)); } catch { cats = null; }
  const hasHeader = chart.hasHeader !== false;
  const firstRow = data.start.row + (hasHeader ? 1 : 0);
  if (firstRow > data.end.row) return [];
  const nRows = data.end.row - firstRow + 1;
  let cat: Series["cat"];
  if (cats) {
    const skip = cats.end.row - cats.start.row + 1 > nRows && hasHeader ? 1 : 0;
    const cr: RangeRef = { start: { row: cats.start.row + skip, col: cats.start.col }, end: { row: Math.min(cats.end.row, cats.start.row + skip + nRows - 1), col: cats.start.col } };
    const values: string[] = [];
    let numeric = true;
    for (let r = cr.start.row; r <= cr.end.row; r++) { const v = value(toA1(r, cr.start.col)); values.push(v === null || v === undefined ? "" : String(v)); if (typeof v !== "number") numeric = false; }
    cat = { ref: absRange(sheet.name, cr), values, numeric: numeric && chart.type === "scatter" };
  }
  const out: Series[] = [];
  for (let c = data.start.col; c <= data.end.col; c++) {
    const vr: RangeRef = { start: { row: firstRow, col: c }, end: { row: data.end.row, col: c } };
    const values: (number | null)[] = [];
    for (let r = firstRow; r <= data.end.row; r++) values.push(toNumber(value(toA1(r, c)) as never));
    const s: Series = { val: { ref: absRange(sheet.name, vr), values }, cat };
    if (hasHeader) { const hv = value(toA1(data.start.row, c)); s.name = { ref: absRange(sheet.name, { start: { row: data.start.row, col: c }, end: { row: data.start.row, col: c } }), value: hv === null || hv === undefined ? "" : String(hv) }; }
    out.push(s);
  }
  return out;
}

function strCache(values: string[]): string {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
}
function numCache(values: (number | null)[]): string {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => (v === null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("")}</c:numCache>`;
}

const PALETTE = ["1F3A5F", "4472C4", "ED7D31", "A5A5A5", "70AD47", "5B9BD5", "FFC000", "264478"];

export function buildChartXml(chart: SheetChart, sheet: Sheet, computed: Computed): string {
  const value = (ref: string) => { const c = sheet.cells[ref]; if (!c) return null; return c.f ? computed[sheet.id]?.[ref]?.v ?? c.v ?? null : c.v ?? null; };
  const series = chartSeries(chart, sheet, value);
  const type: ChartType = chart.type;
  const serXml = series.map((s, i) => {
    const tx = s.name ? `<c:tx><c:strRef><c:f>${esc(s.name.ref)}</c:f>${strCache([s.name.value])}</c:strRef></c:tx>` : "";
    const color = PALETTE[i % PALETTE.length];
    const spPr = type === "line" || type === "scatter"
      ? `<c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr>`
      : type === "pie" ? "" : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;
    const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr}`;
    if (type === "scatter") {
      const x = s.cat ? `<c:xVal>${s.cat.numeric ? `<c:numRef><c:f>${esc(s.cat.ref)}</c:f>${numCache(s.cat.values.map((v) => (v === "" ? null : Number(v))))}</c:numRef>` : `<c:strRef><c:f>${esc(s.cat.ref)}</c:f>${strCache(s.cat.values)}</c:strRef>`}</c:xVal>` : "";
      return `<c:ser>${head}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${x}<c:yVal><c:numRef><c:f>${esc(s.val.ref)}</c:f>${numCache(s.val.values)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
    }
    const cat = s.cat ? `<c:cat><c:strRef><c:f>${esc(s.cat.ref)}</c:f>${strCache(s.cat.values)}</c:strRef></c:cat>` : "";
    const val = `<c:val><c:numRef><c:f>${esc(s.val.ref)}</c:f>${numCache(s.val.values)}</c:numRef></c:val>`;
    if (type === "bar") return `<c:ser>${head}<c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
    if (type === "line") return `<c:ser>${head}<c:marker><c:symbol val="none"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    if (type === "pie") return `<c:ser>${head}${series.length ? s.val.values.map((_, j) => `<c:dPt><c:idx val="${j}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${PALETTE[j % PALETTE.length]}"/></a:solidFill></c:spPr></c:dPt>`).join("") : ""}${cat}${val}</c:ser>`;
    return `<c:ser>${head}${cat}${val}</c:ser>`;
  }).join("");
  const grouping = chart.stacked ? "stacked" : type === "bar" ? "clustered" : "standard";
  const axIds = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  let plot = "";
  if (type === "bar") plot = `<c:barChart><c:barDir val="${chart.horizontal ? "bar" : "col"}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${serXml}<c:gapWidth val="150"/>${chart.stacked ? '<c:overlap val="100"/>' : ""}${axIds}</c:barChart>`;
  else if (type === "line") plot = `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${serXml}<c:marker val="1"/>${axIds}</c:lineChart>`;
  else if (type === "area") plot = `<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${serXml}${axIds}</c:areaChart>`;
  else if (type === "pie") plot = `<c:pieChart><c:varyColors val="1"/>${serXml}<c:firstSliceAng val="0"/></c:pieChart>`;
  else plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${serXml}${axIds}</c:scatterChart>`;
  const catAx = type === "scatter"
    ? '<c:valAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>'
    : `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${chart.horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${chart.horizontal ? "b" : "l"}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const axes = type === "pie" ? "" : catAx + valAx;
  const title = chart.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<c:roundedCorners val="0"/>'
    + `<c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + "</c:chartSpace>";
}

// ------------------------------------------------------------------ parse

const TYPE_TAGS: [string, ChartType][] = [["barChart", "bar"], ["bar3DChart", "bar"], ["lineChart", "line"], ["line3DChart", "line"], ["pieChart", "pie"], ["pie3DChart", "pie"], ["doughnutChart", "pie"], ["areaChart", "area"], ["area3DChart", "area"], ["scatterChart", "scatter"]];

function refOf(node: XNode | undefined): string | undefined {
  const r = child(node, "numRef") ?? child(node, "strRef");
  const f = text(child(r, "f")).trim();
  return f || undefined;
}

function splitRef(f: string): { sheet?: string; range: string } {
  const bang = f.lastIndexOf("!");
  if (bang < 0) return { range: f.replace(/\$/g, "") };
  let sh = f.slice(0, bang);
  if (sh.startsWith("'") && sh.endsWith("'")) sh = sh.slice(1, -1).replace(/''/g, "'");
  return { sheet: sh, range: f.slice(bang + 1).replace(/\$/g, "") };
}

function richText(node: XNode | undefined): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === "$") continue;
      if (k === "t") { for (const t of Array.isArray(v) ? v : [v]) out.push(text(t)); continue; }
      if (Array.isArray(v)) v.forEach(walk); else walk(v);
    }
  };
  walk(node);
  return out.join("");
}

/** Parse a chart part into the model (null when the chart type or data refs cannot be mapped). */
export function parseChartXml(xml: string, sheetName: string): Omit<SheetChart, "id" | "position"> | null {
  const doc = parseXml(xml);
  const chart = child(child(doc, "chartSpace"), "chart");
  const plot = child(chart, "plotArea");
  if (!plot) return null;
  let tag: string | null = null, type: ChartType | null = null;
  for (const [t, ty] of TYPE_TAGS) if (child(plot, t)) { tag = t; type = ty; break; }
  if (!tag || !type) return null;
  const node = child(plot, tag)!;
  const sers = children(node, "ser");
  if (!sers.length) return null;
  const vals: RangeRef[] = [];
  let valSheet: string | undefined;
  let names = 0, namesAbove = 0;
  let catRef: string | undefined;
  for (const s of sers) {
    const vf = refOf(child(s, "val") ?? child(s, "yVal"));
    if (!vf) return null;
    const { sheet, range } = splitRef(vf);
    valSheet = valSheet ?? sheet;
    let r: RangeRef;
    try { r = normalizeRange(parseRange(range)); } catch { return null; }
    vals.push(r);
    const tf = refOf(child(s, "tx"));
    if (tf) {
      names++;
      try { const t = normalizeRange(parseRange(splitRef(tf).range)); if (t.start.col === r.start.col && t.start.row === r.start.row - 1) namesAbove++; } catch { /* literal name */ }
    }
    if (!catRef) catRef = refOf(child(s, "cat") ?? child(s, "xVal"));
  }
  const hasHeader = names > 0 && namesAbove === sers.length;
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  for (const r of vals) { r0 = Math.min(r0, r.start.row); r1 = Math.max(r1, r.end.row); c0 = Math.min(c0, r.start.col); c1 = Math.max(c1, r.end.col); }
  if (hasHeader) r0 -= 1;
  const prefix = valSheet && valSheet !== sheetName ? `${quoteSheet(valSheet)}!` : "";
  const range = `${prefix}${toA1(r0, c0)}:${toA1(r1, c1)}`;
  let categoryRange: string | undefined;
  if (catRef) { const c = splitRef(catRef); categoryRange = `${c.sheet && c.sheet !== sheetName ? `${quoteSheet(c.sheet)}!` : ""}${c.range}`; }
  const titleNode = child(chart, "title");
  let title = titleNode ? richText(child(titleNode, "tx")) : "";
  if (!title && titleNode && sers.length === 1) title = text(child(child(child(child(child(sers[0], "tx"), "strRef"), "strCache"), "pt"), "v"));
  const grouping = attrs(child(node, "grouping")).val;
  const out: Omit<SheetChart, "id" | "position"> = { type, title, range, hasHeader };
  if (categoryRange) out.categoryRange = categoryRange;
  if (grouping === "stacked" || grouping === "percentStacked") out.stacked = true;
  if (attrs(child(node, "barDir")).val === "bar") out.horizontal = true;
  return out;
}
