import "server-only";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { blobs } from "@/lib/db";
import { SLIDE_W, getTheme, makeElement, newSlideId, type ChartSpec, type DeckContent, type DeckElement, type DeckSlide, type PlaceholderRole, type SlideLayout } from "./model";

export const EMU_PER_INCH = 914400;
/** Default PowerPoint 16:9 slide width (13.333in). */
export const DEFAULT_SLIDE_CX = 12192000;

/** EMU → canvas px, scaling the source slide width onto the 1280 px canvas. */
export function emuToPx(emu: number, slideCx: number = DEFAULT_SLIDE_CX): number {
  return Math.round((emu * SLIDE_W) / (slideCx || DEFAULT_SLIDE_CX));
}

/** Font size in hundredths of a point → pt, scaled like the geometry. */
export function szToPt(sz: number, slideCx: number = DEFAULT_SLIDE_CX): number {
  const scale = (SLIDE_W / 96) / (slideCx / EMU_PER_INCH); // canvas inches / source inches
  return Math.max(6, Math.round((sz / 100) * scale * 10) / 10);
}

type X = Record<string, unknown>;
const ARRAY_TAGS = new Set(["p:sp", "p:pic", "p:grpSp", "p:graphicFrame", "p:cxnSp", "a:p", "a:r", "a:br", "a:fld", "a:tr", "a:tc", "p:sldId", "Relationship", "c:ser", "c:pt", "a:gridCol"]);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", parseTagValue: false, trimValues: false, isArray: (name) => ARRAY_TAGS.has(name) });

const asArr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const attr = (node: unknown, name: string): string | undefined => (node && typeof node === "object" ? ((node as X)[`@_${name}`] as string | undefined) : undefined);
const get = (node: unknown, ...path: string[]): unknown => path.reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as X)[k] : undefined), node);

interface Xfrm { x: number; y: number; w: number; h: number; rot?: number; flipV?: boolean }

function readXfrm(xfrm: unknown, cx: number, group?: GroupTransform): Xfrm | null {
  const off = get(xfrm, "a:off"), ext = get(xfrm, "a:ext");
  if (!off || !ext) return null;
  let x = Number(attr(off, "x") ?? 0), y = Number(attr(off, "y") ?? 0), w = Number(attr(ext, "cx") ?? 0), h = Number(attr(ext, "cy") ?? 0);
  if (group) { x = group.offX + (x - group.chOffX) * group.scaleX; y = group.offY + (y - group.chOffY) * group.scaleY; w *= group.scaleX; h *= group.scaleY; }
  const rot = attr(xfrm, "rot");
  return { x: emuToPx(x, cx), y: emuToPx(y, cx), w: emuToPx(w, cx), h: emuToPx(h, cx), rot: rot ? Math.round(Number(rot) / 60000) : undefined, flipV: attr(xfrm, "flipV") === "1" };
}

interface GroupTransform { offX: number; offY: number; chOffX: number; chOffY: number; scaleX: number; scaleY: number }

function groupTransform(grpSpPr: unknown, parent?: GroupTransform): GroupTransform | undefined {
  const xfrm = get(grpSpPr, "a:xfrm");
  if (!xfrm) return parent;
  const off = get(xfrm, "a:off"), ext = get(xfrm, "a:ext"), chOff = get(xfrm, "a:chOff"), chExt = get(xfrm, "a:chExt");
  if (!off || !ext) return parent;
  let offX = Number(attr(off, "x") ?? 0), offY = Number(attr(off, "y") ?? 0);
  const extX = Number(attr(ext, "cx") ?? 0), extY = Number(attr(ext, "cy") ?? 0);
  const chOffX = Number(attr(chOff, "x") ?? 0), chOffY = Number(attr(chOff, "y") ?? 0);
  const chExtX = Number(attr(chExt, "cx") ?? extX) || extX, chExtY = Number(attr(chExt, "cy") ?? extY) || extY;
  let scaleX = chExtX ? extX / chExtX : 1, scaleY = chExtY ? extY / chExtY : 1;
  if (parent) { offX = parent.offX + (offX - parent.chOffX) * parent.scaleX; offY = parent.offY + (offY - parent.chOffY) * parent.scaleY; scaleX *= parent.scaleX; scaleY *= parent.scaleY; }
  return { offX, offY, chOffX, chOffY, scaleX, scaleY };
}

function solidFill(node: unknown): string | undefined {
  const srgb = attr(get(node, "a:solidFill", "a:srgbClr"), "val");
  if (srgb) return `#${srgb.toUpperCase()}`;
  const scheme = attr(get(node, "a:solidFill", "a:schemeClr"), "val");
  if (scheme) return ({ tx1: "fg", tx2: "fg", bg1: "bg", bg2: "surface", accent1: "accent", accent2: "accent2", accent3: "muted", dk1: "fg", dk2: "fg", lt1: "bg", lt2: "surface" } as Record<string, string>)[scheme];
  return undefined;
}

interface ParsedText { text: string; fontSize?: number; bold?: boolean; italic?: boolean; color?: string; align?: "left" | "center" | "right"; font?: string }

function readTextBody(txBody: unknown, cx: number): ParsedText {
  const lines: string[] = [];
  let fontSize: number | undefined, bold = false, italic = false, color: string | undefined, align: ParsedText["align"], font: string | undefined;
  let runCount = 0, boldRuns = 0, italicRuns = 0;
  for (const p of asArr(get(txBody, "a:p"))) {
    const pPr = get(p, "a:pPr");
    const lvl = Number(attr(pPr, "lvl") ?? 0);
    const algn = attr(pPr, "algn");
    if (algn && !align) align = algn === "ctr" ? "center" : algn === "r" ? "right" : "left";
    const bulleted = Boolean(get(pPr, "a:buChar") || get(pPr, "a:buAutoNum")) || (lvl > 0 && !get(pPr, "a:buNone"));
    const numbered = Boolean(get(pPr, "a:buAutoNum"));
    const parts: string[] = [];
    // preserve run order: fast-xml-parser groups by tag, so walk r/br/fld in document order when preserveOrder is off is not possible; approximate by runs then fields.
    const runs = asArr(get(p, "a:r"));
    const flds = asArr(get(p, "a:fld"));
    for (const r of [...runs, ...flds]) {
      const t = get(r, "a:t");
      const text = typeof t === "string" ? t : typeof t === "object" && t ? String((t as X)["#text"] ?? "") : "";
      const rPr = get(r, "a:rPr");
      const sz = attr(rPr, "sz");
      if (sz && !fontSize) fontSize = szToPt(Number(sz), cx);
      const b = attr(rPr, "b") === "1", i = attr(rPr, "i") === "1";
      runCount++; if (b) boldRuns++; if (i) italicRuns++;
      const c = solidFill(rPr); if (c && !color) color = c;
      const latin = attr(get(rPr, "a:latin"), "typeface"); if (latin && !font) font = latin;
      let piece = text.replace(/\*/g, "");
      if (b && !i && piece.trim()) piece = `**${piece}**`; else if (i && !b && piece.trim()) piece = `*${piece}*`;
      parts.push(piece);
    }
    const brs = asArr(get(p, "a:br")).length;
    let line = parts.join("");
    if (brs && parts.length > 1) line = parts.join("\n");
    const prefix = "  ".repeat(Math.min(4, lvl)) + (numbered ? "1. " : bulleted ? "- " : "");
    lines.push(prefix + line);
  }
  if (runCount && boldRuns === runCount) bold = true;
  if (runCount && italicRuns === runCount) italic = true;
  let text = lines.join("\n");
  if (bold) text = text.replace(/\*\*/g, "");
  if (italic) text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1$2");
  return { text: text.replace(/\n+$/, ""), fontSize, bold, italic, color, align, font };
}

const PH_ROLE: Record<string, PlaceholderRole> = { title: "title", ctrTitle: "title", subTitle: "subtitle", body: "body", obj: "body", dt: "date", ftr: "footer", sldNum: "footer", pic: "image", tbl: "table", chart: "chart" };
const PH_DEFAULT_RECT: Record<string, Xfrm> = { title: { x: 72, y: 48, w: 1136, h: 92 }, ctrTitle: { x: 96, y: 216, w: 1080, h: 200 }, subTitle: { x: 96, y: 428, w: 1080, h: 96 }, body: { x: 72, y: 168, w: 1136, h: 480 }, obj: { x: 72, y: 168, w: 1136, h: 480 }, dt: { x: 72, y: 676, w: 300, h: 28 }, ftr: { x: 400, y: 676, w: 480, h: 28 }, sldNum: { x: 1148, y: 676, w: 60, h: 28 } };

interface SlideCtx { cx: number; zip: JSZip; rels: Record<string, string>; slideDir: string; elements: DeckElement[]; z: number }

async function walkTree(tree: unknown, ctx: SlideCtx, group?: GroupTransform) {
  for (const sp of asArr(get(tree, "p:sp"))) await readShape(sp, ctx, group);
  for (const cxn of asArr(get(tree, "p:cxnSp"))) readConnector(cxn, ctx, group);
  for (const pic of asArr(get(tree, "p:pic"))) await readPicture(pic, ctx, group);
  for (const gf of asArr(get(tree, "p:graphicFrame"))) await readGraphicFrame(gf, ctx, group);
  for (const grp of asArr(get(tree, "p:grpSp"))) await walkTree(grp, ctx, groupTransform(get(grp, "p:grpSpPr"), group));
}

async function readShape(sp: unknown, ctx: SlideCtx, group?: GroupTransform) {
  const ph = get(sp, "p:nvSpPr", "p:nvPr", "p:ph");
  const phType = ph ? (attr(ph, "type") ?? "body") : undefined;
  const spPr = get(sp, "p:spPr");
  const xfrm = readXfrm(get(spPr, "a:xfrm"), ctx.cx, group) ?? (phType ? PH_DEFAULT_RECT[phType] ?? PH_DEFAULT_RECT.body : null);
  if (!xfrm) return;
  const prst = attr(get(spPr, "a:prstGeom"), "prst") ?? "rect";
  const txBody = get(sp, "p:txBody");
  const parsed = txBody ? readTextBody(txBody, ctx.cx) : { text: "" };
  const fill = solidFill(spPr);
  const lineColor = solidFill(get(spPr, "a:ln"));
  const lineW = attr(get(spPr, "a:ln"), "w");
  const hasText = parsed.text.trim().length > 0;
  const role = phType ? PH_ROLE[phType] : undefined;
  if (!hasText && (fill || lineColor) && !phType) {
    const shape: DeckElement["shape"] = prst === "ellipse" ? "ellipse" : /arrow/i.test(prst) ? "arrow" : prst === "line" ? "line" : "rect";
    if (shape === "line") { ctx.elements.push(makeElement({ type: "line", x: xfrm.x, y: xfrm.y, w: xfrm.w, h: xfrm.h, z: ctx.z++, style: { stroke: lineColor ?? "muted", strokeWidth: lineW ? Math.max(1, Math.round(Number(lineW) / 12700)) : 2, lineDir: xfrm.flipV ? "up" : "down" } })); return; }
    ctx.elements.push(makeElement({ type: "shape", shape, x: xfrm.x, y: xfrm.y, w: xfrm.w, h: xfrm.h, rotation: xfrm.rot, z: ctx.z++, style: { fill: fill ?? undefined, stroke: lineColor, strokeWidth: lineW ? Math.max(1, Math.round(Number(lineW) / 12700)) : undefined, radius: prst === "roundRect" ? 12 : undefined } }));
    return;
  }
  if (!hasText && !phType) return;
  const isTitle = role === "title";
  const bodyPr = get(txBody, "a:bodyPr");
  const anchor = attr(bodyPr, "anchor");
  ctx.elements.push(makeElement({
    type: "text", role: role === "footer" ? "footer" : role, text: parsed.text, x: xfrm.x, y: xfrm.y, w: xfrm.w, h: xfrm.h, rotation: xfrm.rot, z: ctx.z++,
    name: attr(get(sp, "p:nvSpPr", "p:cNvPr"), "name"),
    style: { fontSize: parsed.fontSize ?? (isTitle ? 32 : role === "subtitle" ? 20 : role === "footer" ? 10 : 18), fontFamily: isTitle ? "heading" : parsed.font && !/^\+/.test(parsed.font) ? parsed.font : "body", bold: isTitle || parsed.bold || undefined, italic: parsed.italic || undefined, color: parsed.color ?? (role === "footer" ? "muted" : "fg"), align: parsed.align, valign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : isTitle ? "middle" : "top", fill: fill && fill !== "bg" ? fill : undefined, stroke: lineColor, padding: 8, lineHeight: 1.25 },
  }));
}

function readConnector(cxn: unknown, ctx: SlideCtx, group?: GroupTransform) {
  const spPr = get(cxn, "p:spPr");
  const xfrm = readXfrm(get(spPr, "a:xfrm"), ctx.cx, group);
  if (!xfrm) return;
  const ln = get(spPr, "a:ln");
  ctx.elements.push(makeElement({ type: "line", x: xfrm.x, y: xfrm.y, w: Math.max(1, xfrm.w), h: xfrm.h, z: ctx.z++, style: { stroke: solidFill(ln) ?? "muted", strokeWidth: attr(ln, "w") ? Math.max(1, Math.round(Number(attr(ln, "w")) / 12700)) : 2, lineDir: xfrm.flipV ? "up" : "down", arrowEnd: Boolean(get(ln, "a:tailEnd")) } }));
}

async function readPicture(pic: unknown, ctx: SlideCtx, group?: GroupTransform) {
  const xfrm = readXfrm(get(pic, "p:spPr", "a:xfrm"), ctx.cx, group);
  if (!xfrm) return;
  const embed = attr(get(pic, "p:blipFill", "a:blip"), "r:embed");
  const target = embed ? ctx.rels[embed] : undefined;
  let src = "";
  if (target) {
    const path = resolvePath(ctx.slideDir, target);
    const file = ctx.zip.file(path);
    if (file) {
      const bytes = await file.async("uint8array");
      const ext = path.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : ext === "emf" || ext === "wmf" ? "image/x-emf" : `image/${ext}`;
      const rec = blobs.put(bytes, mime, { name: path.split("/").pop(), meta: { source: "pptx-import" } });
      src = `/api/blobs/${rec.id}`;
    }
  }
  const stretch = Boolean(get(pic, "p:blipFill", "a:stretch"));
  ctx.elements.push(makeElement({ type: "image", src, alt: attr(get(pic, "p:nvPicPr", "p:cNvPr"), "descr") ?? attr(get(pic, "p:nvPicPr", "p:cNvPr"), "name"), x: xfrm.x, y: xfrm.y, w: xfrm.w, h: xfrm.h, rotation: xfrm.rot, z: ctx.z++, style: { fit: stretch ? "fill" : "contain" } }));
}

async function readGraphicFrame(gf: unknown, ctx: SlideCtx, group?: GroupTransform) {
  const xfrm = readXfrm(get(gf, "p:xfrm"), ctx.cx, group);
  if (!xfrm) return;
  const data = get(gf, "a:graphic", "a:graphicData");
  const tbl = get(data, "a:tbl");
  if (tbl) {
    const rows = asArr(get(tbl, "a:tr")).map((tr) => asArr(get(tr, "a:tc")).map((tc) => readTextBody(get(tc, "a:txBody"), ctx.cx).text.replace(/\*\*/g, "")));
    if (rows.length) {
      const cols = asArr(get(tbl, "a:tblGrid", "a:gridCol")).map((c) => Number(attr(c, "w") ?? 0));
      const total = cols.reduce((a, b) => a + b, 0);
      ctx.elements.push(makeElement({ type: "table", role: "table", table: { header: rows[0], rows: rows.slice(1), colWidths: total ? cols.map((c) => c / total) : undefined }, x: xfrm.x, y: xfrm.y, w: xfrm.w, h: xfrm.h, z: ctx.z++, style: { fontSize: 13, color: "fg", headerFill: "accent", headerColor: "bg", stroke: "muted", banded: true } }));
    }
    return;
  }
  const chartRef = attr(get(data, "c:chart"), "r:id");
  if (chartRef && ctx.rels[chartRef]) {
    const chart = await readChart(ctx.zip, resolvePath(ctx.slideDir, ctx.rels[chartRef]));
    if (chart) { ctx.elements.push(makeElement({ type: "chart", role: "chart", chart, x: xfrm.x, y: xfrm.y, w: xfrm.w, h: xfrm.h, z: ctx.z++, style: { fill: "surface", radius: 12, padding: 16 } })); return; }
  }
  ctx.elements.push(makeElement({ type: "shape", shape: "rect", x: xfrm.x, y: xfrm.y, w: xfrm.w, h: xfrm.h, z: ctx.z++, text: "[embedded object]", style: { fill: "surface", stroke: "muted", color: "muted", fontSize: 12, align: "center", valign: "middle" } }));
}

async function readChart(zip: JSZip, path: string): Promise<ChartSpec | null> {
  const file = zip.file(path);
  if (!file) return null;
  try {
    const xml = parser.parse(await file.async("string")) as X;
    const plot = get(xml, "c:chartSpace", "c:chart", "c:plotArea");
    const kinds: { key: string; type: ChartSpec["type"] }[] = [{ key: "c:barChart", type: "bar" }, { key: "c:bar3DChart", type: "bar" }, { key: "c:lineChart", type: "line" }, { key: "c:pieChart", type: "pie" }, { key: "c:doughnutChart", type: "pie" }, { key: "c:areaChart", type: "line" }];
    for (const k of kinds) {
      const node = get(plot, k.key);
      if (!node) continue;
      const series = asArr(get(node, "c:ser")).map((ser) => {
        const name = ptValues(get(ser, "c:tx", "c:strRef", "c:strCache"))[0] ?? (typeof get(ser, "c:tx", "c:v") === "string" ? String(get(ser, "c:tx", "c:v")) : "Series");
        const cats = [get(ser, "c:cat", "c:strRef", "c:strCache"), get(ser, "c:cat", "c:multiLvlStrRef", "c:multiLvlStrCache", "c:lvl"), get(ser, "c:cat", "c:numRef", "c:numCache")].map((n) => ptValues(Array.isArray(n) ? n[0] : n)).find((v) => v.length) ?? [];
        const vals = ptValues(get(ser, "c:val", "c:numRef", "c:numCache")).map((v) => Number(v) || 0);
        return { name, cats, values: vals };
      });
      if (!series.length) continue;
      const titleNode = get(xml, "c:chartSpace", "c:chart", "c:title", "c:tx", "c:rich");
      const title = titleNode ? readTextBody(titleNode, DEFAULT_SLIDE_CX).text.replace(/\*\*/g, "") : undefined;
      return { type: k.type, categories: series[0].cats, series: series.map((s) => ({ name: s.name, values: s.values })), title: title || undefined, showLegend: Boolean(get(xml, "c:chartSpace", "c:chart", "c:legend")), showValues: true };
    }
  } catch { /* fall through */ }
  return null;
}

function ptValues(cache: unknown): string[] {
  return asArr(get(cache, "c:pt")).sort((a, b) => Number(attr(a, "idx") ?? 0) - Number(attr(b, "idx") ?? 0)).map((pt) => { const v = get(pt, "c:v"); return typeof v === "string" ? v : typeof v === "object" && v ? String((v as X)["#text"] ?? "") : String(v ?? ""); });
}

function resolvePath(fromDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
}

async function readRels(zip: JSZip, relsPath: string): Promise<Record<string, string>> {
  const file = zip.file(relsPath);
  if (!file) return {};
  const xml = parser.parse(await file.async("string")) as X;
  const out: Record<string, string> = {};
  for (const r of asArr(get(xml, "Relationships", "Relationship"))) { const id = attr(r, "Id"), target = attr(r, "Target"); if (id && target) out[id] = target; }
  return out;
}

/** Files without placeholders (e.g. generated decks): tag the largest top text as the title and the largest remaining text as the body. */
function tagRoles(elements: DeckElement[]) {
  if (elements.some((e) => e.role === "title")) return;
  const texts = elements.filter((e) => e.type === "text" && e.text?.trim() && !e.role);
  const title = [...texts].filter((e) => e.y < 320 && (e.style.fontSize ?? 0) >= 20).sort((a, b) => (b.style.fontSize ?? 0) - (a.style.fontSize ?? 0) || a.y - b.y)[0];
  if (title) { title.role = "title"; title.style.fontFamily = "heading"; }
  const body = texts.filter((e) => e !== title && (e.style.fontSize ?? 0) <= 28).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (body && body.w * body.h > 60_000) body.role = "body";
}

function inferLayout(elements: DeckElement[], index: number): SlideLayout {
  const roles = new Set(elements.map((e) => e.role));
  if (elements.some((e) => e.type === "chart")) return "chart";
  if (elements.some((e) => e.type === "table")) return "table";
  const bodies = elements.filter((e) => e.type === "text" && (e.role === "body" || (!e.role && e.text?.trim())));
  if (elements.some((e) => e.type === "image") && bodies.length === 0) return "image";
  if (roles.has("title") && bodies.length === 0) return index === 0 ? "title" : "section";
  if (bodies.length >= 2 && roles.has("title")) return "two_column";
  if (bodies.length) return "bullets";
  return elements.length ? "blank" : "blank";
}

/** Import a .pptx into the deck model. Images become blobs; charts, tables, notes and hidden flags are preserved. */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  const zip = await JSZip.loadAsync(bytes);
  const presFile = zip.file("ppt/presentation.xml");
  if (!presFile) throw new Error("Not a PowerPoint file (missing ppt/presentation.xml)");
  const pres = parser.parse(await presFile.async("string")) as X;
  const cx = Number(attr(get(pres, "p:presentation", "p:sldSz"), "cx") ?? DEFAULT_SLIDE_CX) || DEFAULT_SLIDE_CX;
  const presRels = await readRels(zip, "ppt/_rels/presentation.xml.rels");
  const slideIds = asArr(get(pres, "p:presentation", "p:sldIdLst", "p:sldId")).map((s) => attr(s, "r:id")).filter((v): v is string => Boolean(v));
  const slidePaths = slideIds.map((rid) => presRels[rid]).filter(Boolean).map((t) => resolvePath("ppt", t));
  const fallbackPaths = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/(\d+)/)?.[1]) - Number(b.match(/(\d+)/)?.[1]));
  const paths = slidePaths.length ? slidePaths : fallbackPaths;
  const slides: DeckSlide[] = [];
  let warnings = 0;
  for (const [index, path] of paths.entries()) {
    const file = zip.file(path);
    if (!file) { warnings++; continue; }
    const xml = parser.parse(await file.async("string")) as X;
    const slideDir = path.split("/").slice(0, -1).join("/");
    const rels = await readRels(zip, `${slideDir}/_rels/${path.split("/").pop()}.rels`);
    const ctx: SlideCtx = { cx, zip, rels, slideDir, elements: [], z: 0 };
    const sld = get(xml, "p:sld");
    try { await walkTree(get(sld, "p:cSld", "p:spTree"), ctx); } catch { warnings++; }
    const bg = solidFill(get(sld, "p:cSld", "p:bg", "p:bgPr"));
    let notes = "";
    const notesRel = Object.values(rels).find((t) => /notesSlide\d+\.xml$/.test(t));
    if (notesRel) {
      const nf = zip.file(resolvePath(slideDir, notesRel));
      if (nf) {
        const nx = parser.parse(await nf.async("string")) as X;
        const shapes = asArr(get(nx, "p:notes", "p:cSld", "p:spTree", "p:sp"));
        const body = shapes.find((sp) => attr(get(sp, "p:nvSpPr", "p:nvPr", "p:ph"), "type") === "body") ?? shapes.find((sp) => get(sp, "p:txBody"));
        if (body) notes = readTextBody(get(body, "p:txBody"), cx).text.replace(/\*\*/g, "").replace(/^- /gm, "");
      }
    }
    tagRoles(ctx.elements);
    slides.push({ id: newSlideId(), layout: inferLayout(ctx.elements, index), background: bg && bg !== "bg" ? { color: bg } : undefined, elements: ctx.elements, notes, hidden: attr(sld, "show") === "0" });
  }
  let title = filename.replace(/\.[^.]+$/, "");
  const core = zip.file("docProps/core.xml");
  if (core) { const m = (await core.async("string")).match(/<dc:title>([^<]*)<\/dc:title>/); if (m?.[1]?.trim()) title = m[1].trim(); }
  const content: DeckContent = { version: 1, theme: getTheme("calloway-navy"), size: { w: 1280, h: 720 }, slides, meta: { createdWith: "import", sourceFile: filename } };
  return { title, content, meta: { imported: { slides: slides.length, warnings, sourceWidthEmu: cx } } };
}
