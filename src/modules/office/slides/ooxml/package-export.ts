/**
 * Package-preserving .pptx export for imported decks.
 *
 * The original package is the base. Masters, layouts, themes, media, charts, custom XML and every part we do not
 * understand are carried over untouched. For each slide in the deck:
 *  - unchanged since import (fingerprint equal)  → the source slide part is kept byte-for-byte;
 *  - changed                                     → the source slide XML is patched surgically: only edited shapes are
 *                                                  rewritten (geometry, text body, fill/line, picture, table, chart),
 *                                                  deleted shapes removed, new shapes appended; untouched shapes keep
 *                                                  their exact bytes;
 *  - duplicated                                  → the slide part (and its notes/charts) is copied under a new name;
 *  - new                                         → a slide is written against the best matching layout of the package.
 * presentation.xml (slide list/order, sections), its relationships, [Content_Types].xml and docProps/app.xml are
 * updated only when the slide set changed; parts that become unreferenced are removed. The theme part is patched
 * only when the deck theme changed.
 */
import JSZip from "jszip";
import { fnv1a64 } from "@/lib/integrity/hash-pure";
import { type DeckContent, type DeckElement, type DeckSlide, type PptxLayoutInfo, type SlideBackground } from "../model";
import { elementDataFp, elementFingerprint, hashOf, slideFingerprint, themeFingerprint } from "../fingerprint";
import { CT, ContentTypes, EMU_PER_PT, NS, REL, RelSet, dirOf, extOfMime, nextPartName, readXmlPart, relsPathOf, resolvePart } from "./package";
import { patchTheme } from "./theme";
import {
  applyStyleDiff, canvasPtToSz, chartPartXml, clearAutofitScale, colorXml, elementXml, imageDimensions, notesMasterXml, notesSlideXml, paragraphsXml, pxToEmuLen, pxToEmuX, pxToEmuY,
  rebuildParagraphs, setNotesParagraphs, styleDiff, tableGrid, tableXml, type WriteCtx,
} from "./writer";
import {
  appendKid, attr, els, findAll, frag, insertKid, insertOrdered, kid, kids, mk, numAttr, parseXml, path, removeKid, replaceKid, serializeDoc, setAttr, setKids, textContent, upsertKid,
  type XDoc, type XEl,
} from "./xml";

export interface PackageExportOptions {
  /** Resolve an image src to a data URL (new or replaced pictures). */
  fetchImage?: (src: string) => Promise<string | null>;
  includeHidden?: boolean;
}

export interface PackageExportReport { kept: number; patched: number; created: number; copied: number; removed: number; notesWritten: number; themePatched: boolean }

const SHAPE_TAGS = new Set(["p:sp", "p:pic", "p:cxnSp", "p:graphicFrame"]);

interface Loc { node: XEl; parent: XEl; container: XEl; containerParent: XEl }

function cNvPrOf(node: XEl): XEl | undefined {
  const nv = els(node).find((k) => /^p:nv/.test(k.name));
  return kid(nv, "p:cNvPr");
}

/** Index shapes by cNvPr id (leaf shapes; groups and AlternateContent are containers). */
function indexShapes(tree: XEl, out = new Map<number, Loc>(), containerOf?: { el: XEl; parent: XEl }) {
  for (const k of els(tree)) {
    if (SHAPE_TAGS.has(k.name)) {
      const id = numAttr(cNvPrOf(k), "id", -1);
      if (id >= 0 && !out.has(id)) out.set(id, { node: k, parent: tree, container: containerOf?.el ?? k, containerParent: containerOf?.parent ?? tree });
    } else if (k.name === "p:grpSp") indexShapes(k, out);
    else if (k.name === "mc:AlternateContent") {
      const fb = kid(k, "mc:Fallback") ?? kid(k, "mc:Choice");
      if (fb) indexShapes(fb, out, { el: k, parent: tree });
    }
  }
  return out;
}

function maxShapeId(root: XEl): number {
  let max = 1;
  for (const c of findAll(root, (e) => e.name === "p:cNvPr")) max = Math.max(max, numAttr(c, "id", 0));
  return max;
}

const dataUrlBytes = (u: string): { bytes: Uint8Array; mime: string } | null => {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(u);
  if (!m) return null;
  const bytes = m[2] ? Uint8Array.from(Buffer.from(m[3], "base64")) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return { bytes, mime: m[1] };
};

export async function exportWithPackage(deck: DeckContent, pkg: Uint8Array, opts: PackageExportOptions = {}): Promise<{ bytes: Buffer; report: PackageExportReport }> {
  const meta = deck.meta?.pptx;
  if (!meta) throw new Error("Deck has no source package metadata");
  const zip = await JSZip.loadAsync(pkg);
  const wctx: WriteCtx = { theme: deck.theme, map: meta.map };
  const report: PackageExportReport = { kept: 0, patched: 0, created: 0, copied: 0, removed: 0, notesWritten: 0, themePatched: false };
  const ct = await ContentTypes.load(zip);
  const ctBefore = ct.xml();
  const presPart = "ppt/presentation.xml";
  const presDoc = await readXmlPart(zip, presPart);
  if (!presDoc) throw new Error("Package has no ppt/presentation.xml");
  const presBefore = serializeDoc(presDoc);
  const presRels = await RelSet.load(zip, presPart);
  const presRelsBefore = presRels.xml();
  const reserved = new Set<string>();
  const mediaBySrc = new Map<string, string>();
  const layoutsByPart = new Map(meta.layouts.map((l) => [l.part, l]));

  let sldIdLst = kid(presDoc.root, "p:sldIdLst");
  if (!sldIdLst) { sldIdLst = mk("p:sldIdLst"); insertOrdered(presDoc.root, sldIdLst, ["p:sldSz", "p:notesSz"]); }
  const orig = kids(sldIdLst, "p:sldId").map((n) => ({ node: n, id: attr(n, "id") ?? "", rid: attr(n, "r:id") ?? "", part: presRels.get(attr(n, "r:id") ?? "")?.target ?? "" }));
  const byPart = new Map(orig.map((o) => [o.part, o]));
  let maxId = Math.max(255, ...orig.map((o) => Number(o.id) || 0));
  const used = new Set<string>();
  const out: { id: string; rid: string; part: string; node?: XEl; section?: string }[] = [];

  // --- media helpers -------------------------------------------------------
  const addMedia = async (slideRels: RelSet, src: string): Promise<{ rid: string; size?: { w: number; h: number } } | null> => {
    let part = mediaBySrc.get(src);
    let size: { w: number; h: number } | undefined;
    if (!part) {
      const data = opts.fetchImage ? await opts.fetchImage(src) : null;
      const decoded = data ? dataUrlBytes(data) : null;
      if (!decoded) return null;
      const ext = extOfMime(decoded.mime);
      part = nextPartName(zip, "ppt/media", "image", ext, reserved);
      zip.file(part, decoded.bytes);
      ct.ensureDefault(ext, decoded.mime);
      mediaBySrc.set(src, part);
      size = imageDimensions(decoded.bytes);
    } else {
      const f = zip.file(part);
      if (f) size = imageDimensions(await f.async("uint8array"));
    }
    return { rid: slideRels.add(REL.image, part), size };
  };
  const addChart = (slideRels: RelSet, e: DeckElement): string => {
    const part = nextPartName(zip, "ppt/charts", "chart", "xml", reserved);
    zip.file(part, chartPartXml(e.chart!, wctx));
    ct.override(part, CT.chart);
    return slideRels.add(REL.chart, part);
  };

  // --- notes ---------------------------------------------------------------
  const ensureNotesMaster = async (): Promise<string> => {
    const existing = presRels.byType(REL.notesMaster)[0];
    if (existing) return existing.target;
    const part = nextPartName(zip, "ppt/notesMasters", "notesMaster", "xml", reserved);
    zip.file(part, notesMasterXml());
    ct.override(part, CT.notesMaster);
    const themeSrc = meta.themePart ?? "ppt/theme/theme1.xml";
    const themeBytes = await zip.file(themeSrc)?.async("uint8array");
    const nmRels = new RelSet(part);
    if (themeBytes) {
      const themePart = nextPartName(zip, "ppt/theme", "theme", "xml", reserved);
      zip.file(themePart, themeBytes);
      ct.override(themePart, "application/vnd.openxmlformats-officedocument.theme+xml");
      nmRels.add(REL.theme, themePart);
    }
    nmRels.save(zip);
    const rid = presRels.add(REL.notesMaster, part);
    const lst = mk("p:notesMasterIdLst", {}, [mk("p:notesMasterId", { "r:id": rid })]);
    insertOrdered(presDoc.root, lst, ["p:handoutMasterIdLst", "p:sldIdLst", "p:sldSz", "p:notesSz"]);
    return part;
  };

  const writeNotes = async (slidePart: string, slideRels: RelSet, text: string) => {
    const rel = slideRels.byType(REL.notesSlide)[0];
    if (rel) {
      const doc = await readXmlPart(zip, rel.target);
      const shapes = doc ? kids(path(doc.root, "p:cSld", "p:spTree"), "p:sp") : [];
      const body = shapes.find((sp) => attr(path(sp, "p:nvSpPr", "p:nvPr", "p:ph"), "type") === "body");
      const txBody = kid(body, "p:txBody");
      if (doc && txBody) { setNotesParagraphs(txBody, text); zip.file(rel.target, serializeDoc(doc)); report.notesWritten++; return; }
    }
    if (!text.trim()) return;
    const master = await ensureNotesMaster();
    const part = nextPartName(zip, "ppt/notesSlides", "notesSlide", "xml", reserved);
    zip.file(part, notesSlideXml(text));
    ct.override(part, CT.notesSlide);
    const nrels = new RelSet(part);
    nrels.add(REL.notesMaster, master);
    nrels.add(REL.slide, slidePart);
    nrels.save(zip);
    slideRels.add(REL.notesSlide, part);
    report.notesWritten++;
  };

  // --- slide-level XML ---------------------------------------------------------
  const setBackground = async (sld: XEl, slideRels: RelSet, bg: SlideBackground | undefined) => {
    const cSld = kid(sld, "p:cSld")!;
    const cur = kid(cSld, "p:bg");
    if (!bg || (!bg.color && !bg.imageUrl)) { if (cur) removeKid(cSld, cur); return; }
    let fill = "";
    if (bg.imageUrl) { const m = await addMedia(slideRels, bg.imageUrl); if (m) fill = `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${m.rid}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`; }
    if (!fill && bg.color) fill = `<a:solidFill>${colorXml(bg.color, wctx)}</a:solidFill>`;
    if (!fill) return;
    const node = frag(`<p:bg><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg>`);
    if (cur) replaceKid(cSld, cur, node); else insertKid(cSld, 0, node);
  };

  const setTransition = (sld: XEl, t: DeckSlide["transition"]) => {
    for (const alt of kids(sld, "mc:AlternateContent")) if (kid(kid(alt, "mc:Choice"), "p:transition") || kid(kid(alt, "mc:Fallback"), "p:transition")) removeKid(sld, alt);
    const cur = kid(sld, "p:transition");
    if (cur) removeKid(sld, cur);
    if (!t || t === "none") return;
    const inner = t === "fade" ? "<p:fade/>" : t === "push" ? `<p:push dir="u"/>` : `<p:wipe dir="r"/>`;
    insertOrdered(sld, frag(`<p:transition spd="med">${inner}</p:transition>`), ["p:timing", "p:extLst"]);
  };

  // --- element patching --------------------------------------------------------
  const patchGeometry = (node: XEl, e: DeckElement) => {
    const o = e.ooxml!;
    const b = o.base;
    const emu = o.emu;
    const absX = e.x === b.x ? emu.x : pxToEmuX(e.x, wctx.map);
    const absY = e.y === b.y ? emu.y : pxToEmuY(e.y, wctx.map);
    const cx = e.w === b.w ? emu.cx : pxToEmuLen(e.w, wctx.map);
    const cy = e.h === b.h ? emu.cy : pxToEmuLen(e.h, wctx.map);
    const rot = (e.rotation ?? 0) === (b.rotation ?? 0) ? emu.rot : e.rotation ? Math.round(e.rotation * 60000) : undefined;
    let x = absX, y = absY, w = cx, h = cy;
    if (o.group && !o.inherited) { const g = o.group; x = Math.round(g.chOffX + (absX - g.offX) / g.scaleX); y = Math.round(g.chOffY + (absY - g.offY) / g.scaleY); w = Math.round(cx / g.scaleX); h = Math.round(cy / g.scaleY); }
    let xfrm: XEl | undefined;
    if (node.name === "p:graphicFrame") {
      xfrm = kid(node, "p:xfrm");
      if (!xfrm) { xfrm = mk("p:xfrm"); insertOrdered(node, xfrm, ["a:graphic"]); }
    } else {
      const spPr = kid(node, "p:spPr") ?? (() => { const n = mk("p:spPr"); insertOrdered(node, n, ["p:style", "p:txBody"]); return n; })();
      xfrm = kid(spPr, "a:xfrm");
      if (!xfrm) { xfrm = mk("a:xfrm"); insertKid(spPr, 0, xfrm); }
    }
    let off = kid(xfrm, "a:off"), ext = kid(xfrm, "a:ext");
    if (!off) { off = mk("a:off"); insertKid(xfrm, 0, off); }
    if (!ext) { ext = mk("a:ext"); insertOrdered(xfrm, ext, ["a:chOff", "a:chExt"]); }
    setAttr(off, "x", x); setAttr(off, "y", y); setAttr(ext, "cx", w); setAttr(ext, "cy", h);
    setAttr(xfrm, "rot", rot ? String(rot) : undefined);
    setAttr(xfrm, "flipH", e.flipH ? "1" : undefined);
    setAttr(xfrm, "flipV", e.flipV ?? (e.type === "line" && e.style.lineDir === "up") ? "1" : undefined);
  };

  const FILL_NAMES = ["a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill", "a:grpFill"];
  const patchFillStroke = (node: XEl, e: DeckElement) => {
    const b = e.ooxml!.base.style;
    const spPr = kid(node, "p:spPr");
    if (!spPr) return;
    if (e.style.fill !== b.fill) {
      for (const f of els(spPr).filter((k) => FILL_NAMES.includes(k.name))) removeKid(spPr, f);
      insertOrdered(spPr, e.style.fill ? frag(`<a:solidFill>${colorXml(e.style.fill, wctx)}</a:solidFill>`) : mk("a:noFill"), ["a:ln", "a:effectLst", "a:effectDag", "a:scene3d", "a:sp3d", "a:extLst"]);
    }
    if (e.style.stroke !== b.stroke || e.style.strokeWidth !== b.strokeWidth) {
      let ln = kid(spPr, "a:ln");
      if (!ln) { ln = mk("a:ln"); insertOrdered(spPr, ln, ["a:effectLst", "a:effectDag", "a:scene3d", "a:sp3d", "a:extLst"]); }
      for (const f of els(ln).filter((k) => FILL_NAMES.includes(k.name))) removeKid(ln, f);
      if (e.style.stroke) { insertKid(ln, 0, frag(`<a:solidFill>${colorXml(e.style.stroke, wctx)}</a:solidFill>`)); setAttr(ln, "w", Math.round((e.style.strokeWidth ?? 1) * EMU_PER_PT)); }
      else insertKid(ln, 0, mk("a:noFill"));
    }
  };

  const patchText = (node: XEl, e: DeckElement) => {
    let txBody = kid(node, "p:txBody");
    const text = e.text ?? "";
    const textChanged = text !== (e.rich?.markdown ?? "");
    if (!txBody) {
      if (!text.trim()) return;
      txBody = frag(`<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphsXml(text, e.style, wctx)}</p:txBody>`);
      appendKid(node, txBody);
      return;
    }
    if (textChanged) rebuildParagraphs(txBody, text, e, wctx);
    applyStyleDiff(txBody, styleDiff(e.style, e.ooxml!.base.style), wctx);
  };

  const patchPicture = async (node: XEl, e: DeckElement, slideRels: RelSet) => {
    const b = e.ooxml!.base;
    const blipFill = kid(node, "p:blipFill");
    if (!blipFill) return;
    if (e.src && e.src !== b.src) {
      const m = await addMedia(slideRels, e.src);
      const blip = kid(blipFill, "a:blip");
      if (m && blip) setAttr(blip, "r:embed", m.rid);
    }
    if (hashOf(e.crop) !== hashOf(b.crop)) {
      const cur = kid(blipFill, "a:srcRect");
      const c = e.crop;
      const next = c ? mk("a:srcRect", { l: Math.round(c.l * 100000), t: Math.round(c.t * 100000), r: Math.round(c.r * 100000), b: Math.round(c.b * 100000) }) : mk("a:srcRect");
      if (cur) replaceKid(blipFill, cur, next); else insertOrdered(blipFill, next, ["a:tile", "a:stretch"]);
    }
  };

  const patchTable = (node: XEl, e: DeckElement) => {
    const tbl = path(node, "a:graphic", "a:graphicData", "a:tbl");
    if (!tbl || !e.table) return;
    const grid = tableGrid(e);
    const trs = kids(tbl, "a:tr");
    const sameShape = trs.length === grid.length && trs.every((tr, i) => kids(tr, "a:tc").length === grid[i].length);
    const diff = styleDiff(e.style, e.ooxml!.base.style);
    if (!sameShape) {
      const data = path(node, "a:graphic", "a:graphicData")!;
      replaceKid(data, tbl, frag(tableXml(e, wctx)));
      return;
    }
    trs.forEach((tr, ri) => kids(tr, "a:tc").forEach((tc, ci) => {
      const want = grid[ri][ci];
      const txBody = kid(tc, "a:txBody");
      if (!txBody) return;
      const cur = kids(txBody, "a:p").map((p) => textContent(p)).join("\n");
      if (cur !== want.text) setNotesParagraphs(txBody, want.text);
      if (want.gridSpan !== undefined || numAttr(tc, "gridSpan", 1) !== (want.gridSpan ?? 1)) setAttr(tc, "gridSpan", want.gridSpan && want.gridSpan > 1 ? want.gridSpan : undefined);
      if (numAttr(tc, "rowSpan", 1) !== (want.rowSpan ?? 1)) setAttr(tc, "rowSpan", want.rowSpan && want.rowSpan > 1 ? want.rowSpan : undefined);
      if ((attr(tc, "hMerge") === "1") !== Boolean(want.hMerge)) setAttr(tc, "hMerge", want.hMerge ? "1" : undefined);
      if ((attr(tc, "vMerge") === "1") !== Boolean(want.vMerge)) setAttr(tc, "vMerge", want.vMerge ? "1" : undefined);
      if (Object.keys(diff).length) applyStyleDiff(txBody, diff, wctx);
    }));
  };

  const patchElement = async (loc: Loc, e: DeckElement, slideRels: RelSet) => {
    const o = e.ooxml!;
    // An element inside mc:AlternateContent is flattened to its fallback before editing.
    const node = loc.node;
    if (loc.container !== loc.node) { replaceKid(loc.containerParent, loc.container, node); node.dirty = true; }
    const b = o.base;
    const geomChanged = e.x !== b.x || e.y !== b.y || e.w !== b.w || e.h !== b.h || (e.rotation ?? 0) !== (b.rotation ?? 0) || Boolean(e.flipH) !== Boolean(b.flipH) || Boolean(e.flipV) !== Boolean(b.flipV);
    if (geomChanged) patchGeometry(node, e);
    if (o.opaque) return;
    const dataChanged = elementDataFp(e) !== o.dataFp;
    if (node.name === "p:sp") {
      if (e.type === "text" || e.type === "shape") patchText(node, e);
      patchFillStroke(node, e);
      if (geomChanged) { const bp = path(node, "p:txBody", "a:bodyPr"); if (bp) clearAutofitScale(bp); }
    } else if (node.name === "p:cxnSp") patchFillStroke(node, e);
    else if (node.name === "p:pic") { await patchPicture(node, e, slideRels); patchFillStroke(node, e); }
    else if (node.name === "p:graphicFrame") {
      if (e.type === "table") patchTable(node, e);
      else if (e.type === "chart" && e.chart && dataChanged) {
        const rid = attr(path(node, "a:graphic", "a:graphicData", "c:chart"), "r:id");
        const rel = rid ? slideRels.get(rid) : undefined;
        if (rel && !rel.external) zip.file(rel.target, chartPartXml(e.chart, wctx));
      }
    }
  };

  // --- whole slides --------------------------------------------------------------
  const chooseLayout = (s: DeckSlide): PptxLayoutInfo | undefined => {
    if (s.ooxml?.layoutPart && layoutsByPart.has(s.ooxml.layoutPart) && zip.file(s.ooxml.layoutPart)) return layoutsByPart.get(s.ooxml.layoutPart);
    const want: Record<string, string[]> = { title: ["title"], section: ["secHead", "title"], two_column: ["twoObj", "obj"], comparison: ["twoTxTwoObj", "twoObj", "obj"], blank: ["blank", "titleOnly"], image: ["picTx", "titleOnly", "obj"], chart: ["chart", "titleOnly", "obj"], table: ["tbl", "titleOnly", "obj"], timeline: ["titleOnly", "obj"], quote: ["titleOnly", "blank"] };
    const order = want[s.layout] ?? ["obj", "tx", "titleOnly"];
    const avail = meta.layouts.filter((l) => zip.file(l.part));
    for (const t of order) { const l = avail.find((x) => x.type === t); if (l) return l; }
    return avail.find((l) => l.type === "obj") ?? avail.find((l) => l.type === "titleOnly") ?? avail[0];
  };

  const phFor = (layout: PptxLayoutInfo | undefined, e: DeckElement, usedPh: Set<string>): { type: string; idx?: string } | undefined => {
    if (!layout || e.type !== "text" || !e.role) return undefined;
    const take = (p: { type: string; idx?: string } | undefined) => { if (!p) return undefined; const k = `${p.type}:${p.idx ?? ""}`; if (usedPh.has(k)) return undefined; usedPh.add(k); return { type: p.type, idx: p.idx }; };
    const phs = layout.placeholders;
    if (e.role === "title") return take(phs.find((p) => p.type === "title" || p.type === "ctrTitle"));
    if (e.role === "subtitle") return take(phs.find((p) => p.type === "subTitle"));
    if (e.role === "body" || e.role === "left" || e.role === "right") {
      const bodies = phs.filter((p) => (p.type === "body" || p.type === "obj") && p.idx).sort((a, b) => (a.emu?.x ?? 0) - (b.emu?.x ?? 0));
      const pick = e.role === "right" ? bodies[1] : bodies[0];
      return take(pick);
    }
    return undefined;
  };

  const writeElementsInto = async (spTree: XEl, elements: DeckElement[], slideRels: RelSet, startId: number, layout?: PptxLayoutInfo, zByNode?: Map<XEl, number>) => {
    let id = startId;
    const usedPh = new Set<string>();
    for (const e of elements) {
      const refs: { imageRid?: string; chartRid?: string; imageSize?: { w: number; h: number } } = {};
      if (e.type === "image" && e.src) { const m = await addMedia(slideRels, e.src); if (!m) continue; refs.imageRid = m.rid; refs.imageSize = m.size; }
      if (e.type === "chart" && e.chart) refs.chartRid = addChart(slideRels, e);
      const xml = elementXml(e, ++id, wctx, refs, phFor(layout, e, usedPh));
      if (xml) { const node = frag(xml); node.dirty = true; insertOrdered(spTree, node, ["p:extLst"]); zByNode?.set(node, e.z); }
    }
    return id;
  };

  const createSlide = async (s: DeckSlide): Promise<string> => {
    const part = nextPartName(zip, "ppt/slides", "slide", "xml", reserved);
    const layout = chooseLayout(s);
    const rels = new RelSet(part);
    if (layout) rels.add(REL.slideLayout, layout.part);
    const doc = parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"${s.hidden ? ` show="0"` : ""}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    const sld = doc.root;
    if (s.background && (s.background.color || s.background.imageUrl)) await setBackground(sld, rels, s.background);
    const spTree = path(sld, "p:cSld", "p:spTree")!;
    const elements = [...s.elements].sort((a, b) => a.z - b.z).map((e) => ({ ...e, ooxml: undefined }));
    await writeElementsInto(spTree, elements, rels, 1, layout);
    if (s.transition && s.transition !== "none") setTransition(sld, s.transition);
    zip.file(part, serializeDoc(doc));
    ct.override(part, CT.slide);
    if (s.notes.trim()) await writeNotes(part, rels, s.notes);
    rels.save(zip);
    report.created++;
    return part;
  };

  const patchSlide = async (part: string, s: DeckSlide) => {
    const doc = await readXmlPart(zip, part);
    if (!doc) throw new Error(`Missing slide part ${part}`);
    const rels = await RelSet.load(zip, part);
    const relsBefore = rels.xml();
    const sld = doc.root;
    const spTree = path(sld, "p:cSld", "p:spTree")!;
    const o = s.ooxml!;
    const contentChanged = slideFingerprint(s) !== o.fp;
    if (contentChanged) {
      const index = indexShapes(spTree);
      const mapped = new Map<number, DeckElement>();
      const fresh: DeckElement[] = [];
      for (const e of [...s.elements].sort((a, b) => a.z - b.z)) {
        if (e.ooxml && index.has(e.ooxml.spid) && !mapped.has(e.ooxml.spid)) mapped.set(e.ooxml.spid, e);
        else fresh.push({ ...e, ooxml: undefined });
      }
      // deletions
      for (const [spid, loc] of index) if (!mapped.has(spid)) removeKid(loc.containerParent, loc.container);
      for (const g of findAll(spTree, (x) => x.name === "p:grpSp").reverse()) if (!els(g).some((k) => SHAPE_TAGS.has(k.name) || k.name === "p:grpSp" || k.name === "mc:AlternateContent")) { const parent = findAll(spTree, (x) => x.kids.includes(g))[0]; if (parent) removeKid(parent, g); }
      // edits
      for (const [spid, e] of mapped) if (elementFingerprint(e) !== e.ooxml!.fp) await patchElement(index.get(spid)!, e, rels);
      // additions
      const freshZ = new Map<XEl, number>();
      await writeElementsInto(spTree, fresh, rels, maxShapeId(sld), undefined, freshZ);
      // z-order of top-level items
      const top = els(spTree).filter((k) => k.name !== "p:nvGrpSpPr" && k.name !== "p:grpSpPr" && k.name !== "p:extLst");
      const zOf = (n: XEl): number => {
        const ids = findAll(n, (x) => x.name === "p:cNvPr").map((c) => numAttr(c, "id", -1));
        const zs = ids.map((id) => mapped.get(id)?.z).filter((z): z is number => typeof z === "number");
        if (zs.length) return Math.min(...zs);
        return freshZ.get(n) ?? Number.MAX_SAFE_INTEGER;
      };
      const zs = top.map((n, i) => ({ n, z: zOf(n), i }));
      const sorted = [...zs].sort((a, b) => a.z - b.z || a.i - b.i);
      if (sorted.some((x, i) => x.n !== zs[i].n) && zs.every((x) => x.z !== Number.MAX_SAFE_INTEGER)) {
        const head = spTree.kids.filter((k) => k.t !== "el" || k.name === "p:nvGrpSpPr" || k.name === "p:grpSpPr");
        const tail = els(spTree).filter((k) => k.name === "p:extLst");
        setKids(spTree, [...head, ...sorted.map((x) => x.n), ...tail]);
      }
      if (Boolean(s.hidden) !== Boolean(o.hidden0)) setAttr(sld, "show", s.hidden ? "0" : undefined);
      if (hashOf(s.background) !== hashOf(o.background0)) await setBackground(sld, rels, s.background);
      if ((s.transition ?? undefined) !== (o.transition0 ?? undefined)) setTransition(sld, s.transition);
      zip.file(part, serializeDoc(doc));
      report.patched++;
    }
    if ((s.notes ?? "") !== (o.notes0 ?? "")) await writeNotes(part, rels, s.notes ?? "");
    if (rels.xml() !== relsBefore) rels.save(zip);
    if (!contentChanged && (s.notes ?? "") === (o.notes0 ?? "")) report.kept++;
  };

  const copyPart = async (src: string, dest: string) => {
    const bytes = await zip.file(src)!.async("uint8array");
    zip.file(dest, bytes);
    const relsFile = zip.file(relsPathOf(src));
    if (relsFile) zip.file(relsPathOf(dest), await relsFile.async("uint8array"));
  };

  const copySlide = async (src: string): Promise<string> => {
    const dest = nextPartName(zip, "ppt/slides", "slide", "xml", reserved);
    await copyPart(src, dest);
    ct.override(dest, CT.slide);
    const rels = await RelSet.load(zip, dest);
    for (const r of rels.list()) {
      if (r.external) continue;
      if (r.type === REL.notesSlide) {
        const np = nextPartName(zip, "ppt/notesSlides", "notesSlide", "xml", reserved);
        await copyPart(r.target, np);
        ct.override(np, CT.notesSlide);
        const nrels = await RelSet.load(zip, np);
        const back = nrels.byType(REL.slide)[0];
        if (back) { nrels.remove(back.id); nrels.add(REL.slide, dest, { id: back.id }); nrels.save(zip); }
        rels.remove(r.id); rels.add(REL.notesSlide, np, { id: r.id });
      } else if (r.type === REL.chart) {
        const cp = nextPartName(zip, "ppt/charts", "chart", "xml", reserved);
        await copyPart(r.target, cp);
        ct.override(cp, CT.chart);
        rels.remove(r.id); rels.add(REL.chart, cp, { id: r.id });
      }
    }
    rels.save(zip);
    report.copied++;
    return dest;
  };

  // --- walk the deck -------------------------------------------------------------
  const pkgId = meta.pkgId;
  for (const s of deck.slides) {
    if (s.hidden && opts.includeHidden === false) continue;
    const srcPart = s.ooxml?.part && s.ooxml.pkg === pkgId && byPart.has(s.ooxml.part) ? s.ooxml.part : undefined;
    let ok = Boolean(srcPart);
    if (srcPart && s.ooxml?.xmlHash) { const xml = await zip.file(srcPart)?.async("string"); ok = Boolean(xml) && fnv1a64(xml!) === s.ooxml.xmlHash; }
    if (srcPart && ok && !used.has(srcPart)) {
      used.add(srcPart);
      await patchSlide(srcPart, s);
      const o = byPart.get(srcPart)!;
      out.push({ id: o.id, rid: o.rid, part: srcPart, node: o.node, section: s.section });
    } else if (srcPart && ok) {
      const dest = await copySlide(srcPart);
      await patchSlide(dest, s);
      out.push({ id: String(++maxId), rid: presRels.add(REL.slide, dest), part: dest, section: s.section });
    } else {
      const dest = await createSlide(s);
      out.push({ id: String(++maxId), rid: presRels.add(REL.slide, dest), part: dest, section: s.section });
    }
  }

  // --- removed slides ----------------------------------------------------------
  for (const o of orig) {
    if (used.has(o.part)) continue;
    const rels = await RelSet.load(zip, o.part);
    for (const n of rels.byType(REL.notesSlide)) { zip.remove(n.target); zip.remove(relsPathOf(n.target)); ct.removeOverride(n.target); }
    zip.remove(o.part); zip.remove(relsPathOf(o.part)); ct.removeOverride(o.part);
    presRels.remove(o.rid);
    report.removed++;
  }

  // --- presentation.xml slide list ------------------------------------------------
  const sameList = out.length === orig.length && out.every((x, i) => x.id === orig[i].id && x.rid === orig[i].rid);
  if (!sameList) setKids(sldIdLst, out.map((x) => x.node ?? mk("p:sldId", { id: x.id, "r:id": x.rid })));
  rebuildSections(presDoc, out.map((x) => ({ id: x.id, section: x.section })));

  // --- theme ------------------------------------------------------------------------
  if (themeFingerprint(deck.theme) !== meta.themeFp && meta.themePart) {
    const tdoc = await readXmlPart(zip, meta.themePart);
    if (tdoc) { patchTheme(tdoc, deck.theme); zip.file(meta.themePart, serializeDoc(tdoc)); report.themePatched = true; }
  }

  // --- orphans, app.xml, save -------------------------------------------------------
  await sweepOrphans(zip, ct);
  const count = out.length;
  const app = await zip.file("docProps/app.xml")?.async("string");
  if (app && !sameList) {
    const hidden = deck.slides.filter((s) => s.hidden && opts.includeHidden !== false).length;
    const next = app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${count}</Slides>`).replace(/<HiddenSlides>\d+<\/HiddenSlides>/, `<HiddenSlides>${hidden}</HiddenSlides>`);
    if (next !== app) zip.file("docProps/app.xml", next);
  }
  const presAfter = serializeDoc(presDoc);
  if (presAfter !== presBefore) zip.file(presPart, presAfter);
  if (presRels.xml() !== presRelsBefore) presRels.save(zip);
  const ctAfter = ct.xml();
  if (ctAfter !== ctBefore) zip.file("[Content_Types].xml", ctAfter);
  void canvasPtToSz; void resolvePart; void dirOf; void upsertKid;
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  return { bytes, report };
}

/** Rebuild p14:sectionLst from the deck's slide sections (only when it differs from the current list). */
function rebuildSections(presDoc: XDoc, slides: { id: string; section?: string }[]) {
  const extLst = kid(presDoc.root, "p:extLst");
  const ext = kids(extLst, "p:ext").find((e) => kid(e, "p14:sectionLst"));
  const lst = kid(ext, "p14:sectionLst");
  const anyNamed = slides.some((s) => s.section);
  if (!lst && !anyNamed) return;
  // fill gaps: a slide without a section joins the previous slide's section (or the next one at the start)
  const names: (string | undefined)[] = slides.map((s) => s.section);
  for (let i = 1; i < names.length; i++) if (!names[i]) names[i] = names[i - 1];
  for (let i = names.length - 2; i >= 0; i--) if (!names[i]) names[i] = names[i + 1];
  const groups: { name: string; ids: string[] }[] = [];
  names.forEach((n, i) => { const name = n ?? "Default Section"; const last = groups[groups.length - 1]; if (last && last.name === name) last.ids.push(slides[i].id); else groups.push({ name, ids: [slides[i].id] }); });
  const current = lst ? kids(lst, "p14:section").map((sec) => ({ name: attr(sec, "name") ?? "", ids: kids(kid(sec, "p14:sldIdLst"), "p14:sldId").map((x) => attr(x, "id") ?? ""), node: sec })) : [];
  if (current.length === groups.length && current.every((c, i) => c.name === groups[i].name && c.ids.join(",") === groups[i].ids.join(","))) return;
  const idByName = new Map(current.map((c) => [c.name, attr(c.node, "id")]));
  const guid = () => `{${"xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16).toUpperCase())}}`;
  const usedIds = new Set<string>();
  const sections = groups.map((g) => {
    let id = idByName.get(g.name);
    if (!id || usedIds.has(id)) id = guid();
    usedIds.add(id);
    return mk("p14:section", { name: g.name, id }, [mk("p14:sldIdLst", {}, g.ids.map((sid) => mk("p14:sldId", { id: sid })))]);
  });
  if (lst) setKids(lst, sections);
  else {
    const list = mk("p14:sectionLst", { "xmlns:p14": "http://schemas.microsoft.com/office/powerpoint/2010/main" }, sections);
    const e = mk("p:ext", { uri: "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}" }, [list]);
    if (extLst) appendKid(extLst, e); else appendKid(presDoc.root, mk("p:extLst", {}, [e]));
  }
}

/** Remove media/chart/embedding/notes parts no relationship points at any more. */
async function sweepOrphans(zip: JSZip, ct: ContentTypes) {
  const sweepDirs = /^ppt\/(media|charts|embeddings|notesSlides)\/[^/]+$/;
  for (let round = 0; round < 3; round++) {
    const referenced = new Set<string>();
    for (const name of Object.keys(zip.files)) {
      if (!name.endsWith(".rels")) continue;
      const isRoot = name === "_rels/.rels";
      const owner = isRoot ? "" : name.replace(/_rels\/([^/]+)\.rels$/, "$1");
      if (!isRoot && !zip.file(owner)) { zip.remove(name); continue; }
      const text = await zip.file(name)!.async("string");
      const dir = isRoot ? "" : dirOf(owner);
      for (const m of text.matchAll(/<Relationship\b[^>]*>/g)) {
        const tag = m[0];
        if (/TargetMode="External"/.test(tag)) continue;
        const t = /Target="([^"]*)"/.exec(tag)?.[1];
        if (t) referenced.add(resolvePart(dir, t.replace(/&amp;/g, "&")));
      }
    }
    let removed = 0;
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir || !sweepDirs.test(name) || referenced.has(name)) continue;
      zip.remove(name); zip.remove(relsPathOf(name)); ct.removeOverride(name); removed++;
    }
    if (!removed) break;
  }
}
