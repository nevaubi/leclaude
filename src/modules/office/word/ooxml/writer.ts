/**
 * Editor model → WordprocessingML body. Used by both export paths:
 *  - fresh packages (documents created in the app): every block is generated;
 *  - package-preserving export (imported .docx): blocks equal to their pristine import are re-emitted from the
 *    original source bytes, everything else is generated with the original pPr/rPr/tblPr/tcPr merged in.
 *
 * Allocators (relationships, numbering, comments, notes, styles) are injected so each path decides how new
 * parts/ids are created without the writer knowing about packages.
 */
import { collectFootnotes, type PMNode } from "../doc-model";
import type { DocSettings } from "../constants";
import { MARGIN_PRESETS, PAGE_SIZES } from "../constants";
import { buildPPr, buildRPr, stripRevisionMarkup } from "./props";
import { escAttr, escText, kids, parseXml, raw as rawOf, stripInvalidXmlChars, wval } from "./xml";

type Mark = NonNullable<PMNode["marks"]>[number];

export interface ExportImageData { bytes: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width?: number; height?: number }

export interface StyleResolver {
  /** Style id to write for a paragraph/heading node (null = default paragraph style). */
  paragraph(node: PMNode, role?: "quote" | "code" | "listContinuation"): string | null;
  has(id: string): boolean;
  /** Character style id for footnote references / hyperlinks when the package defines one. */
  character(kind: "footnoteReference" | "endnoteReference" | "hyperlink" | "commentReference"): string | null;
}

export interface RelAllocator { hyperlink(url: string): string; image(img: ExportImageData): string }
export interface NumAllocator { forList(list: PMNode, ilvl: number, parentNumId: string | null): string }
export interface CommentAllocator { idFor(markId: string): number | null }
export interface NoteAllocator { ref(attrs: Record<string, unknown>): { kind: "footnote" | "endnote"; id: number } }

export interface PristineIndex {
  /** Raw source XML for a node when it is unchanged since import (and its list context still matches). */
  raw(node: PMNode, listContext: { numId: string; ilvl: number } | null | undefined): string | null;
  sdtStart(id: string): { raw: string; members: string[] } | null;
  lead(id: string): string | null;
  /** The pristine image src for an image node id (reuse its relationship when unchanged). */
  imageSrc(id: string): string | null;
}

export interface WriterEnv {
  mode: "fresh" | "preserve";
  author: string;
  changes: "revisions" | "accepted";
  settings: DocSettings;
  styles: StyleResolver;
  rels: RelAllocator;
  numbering: NumAllocator;
  comments: CommentAllocator;
  notes: NoteAllocator;
  images: Map<string, ExportImageData | null>;
  nextId: () => number;
  nextDrawingId: () => number;
  pristine?: PristineIndex;
  /** Section properties XML (children of w:sectPr) for the body and section-break paragraphs. */
  sectPrInner: (section?: Record<string, unknown> | null) => string;
  bookmarkIds: Map<string, number>;
  /** Comment range bookkeeping: first/last text node per comment id in document order. */
  commentSpan: Map<string, { first: PMNode; last: PMNode }>;
  lineDefault: number | null;
  warnings: string[];
}

const T = (s: string) => escText(stripInvalidXmlChars(s));

function textRun(rPr: string, text: string, deleted: boolean): string {
  let out = "";
  let buf = "";
  const tag = deleted ? "w:delText" : "w:t";
  const flush = () => { if (buf) { out += `<${tag} xml:space="preserve">${T(buf)}</${tag}>`; buf = ""; } };
  for (const ch of text) {
    if (ch === "\t") { flush(); out += "<w:tab/>"; }
    else if (ch === "\n") { flush(); out += "<w:br/>"; }
    else if (ch === "‑") { flush(); out += "<w:noBreakHyphen/>"; }
    else if (ch === "­") { flush(); out += "<w:softHyphen/>"; }
    else buf += ch;
  }
  flush();
  return out ? `<w:r>${rPr}${out}</w:r>` : "";
}

function markOf(n: PMNode, type: string): Mark | undefined { return n.marks?.find((m) => m.type === type); }

function changeAttrs(env: WriterEnv, m: Mark): string {
  const author = String(m.attrs?.author ?? env.author);
  const date = String(m.attrs?.date ?? "") || new Date().toISOString();
  return `w:id="${env.nextId()}" w:author="${escAttr(author)}" w:date="${escAttr(date.replace(/\.\d{3}Z$/, "Z"))}"`;
}

/** Inline content → runs, with hyperlink / ins / del wrappers, comment ranges, notes and field/bookmark atoms. */
export function writeInline(content: PMNode[] | undefined, env: WriterEnv): string {
  const nodes = content ?? [];
  let out = "";
  let openLink: string | null = null;
  let openChange: { type: string; key: string } | null = null;
  const closeChange = () => { if (openChange) { out += openChange.type === "insertion" ? "</w:ins>" : "</w:del>"; openChange = null; } };
  const closeLink = () => { closeChange(); if (openLink !== null) { out += "</w:hyperlink>"; openLink = null; } };
  // Last index per footnote id in this paragraph: the reference follows the last marked node.
  const lastNote = new Map<string, number>();
  nodes.forEach((n, i) => { const f = markOf(n, "footnote"); if (f) lastNote.set(String(f.attrs?.id ?? ""), i); });
  const linkRStyle = env.styles.character("hyperlink");

  nodes.forEach((n, i) => {
    if (n.type === "text") {
      const del = markOf(n, "deletion");
      const ins = markOf(n, "insertion");
      if (del && env.changes === "accepted") return;
      const link = markOf(n, "link");
      const href = link && !del ? String(link.attrs?.href ?? "") : null;
      // comment starts
      for (const m of n.marks ?? []) {
        if (m.type !== "comment") continue;
        const span = env.commentSpan.get(String(m.attrs?.id ?? ""));
        if (span?.first === n) { const cid = env.comments.idFor(String(m.attrs?.id ?? "")); if (cid != null) { closeLink(); out += `<w:commentRangeStart w:id="${cid}"/>`; } }
      }
      if (href !== openLink) {
        closeLink();
        if (href) {
          if (href.startsWith("#")) out += `<w:hyperlink w:anchor="${escAttr(href.slice(1))}" w:history="1">`;
          else out += `<w:hyperlink r:id="${env.rels.hyperlink(href)}" w:history="1">`;
          openLink = href;
        }
      }
      const change = env.changes === "revisions" ? (del ?? ins) : undefined;
      const key = change ? `${change.type}:${String(change.attrs?.id ?? "")}:${String(change.attrs?.author ?? "")}` : null;
      if ((openChange?.key ?? null) !== key) {
        closeChange();
        if (change && key) { out += `<w:${change.type === "insertion" ? "ins" : "del"} ${changeAttrs(env, change)}>`; openChange = { type: change.type, key }; }
      }
      const docxRun = markOf(n, "docxRun");
      const extra: [string, string][] = [];
      if (href && !docxRun) { if (linkRStyle) extra.push(["w:rStyle", `<w:rStyle w:val="${linkRStyle}"/>`]); else { extra.push(["w:color", `<w:color w:val="1F4E9A"/>`]); extra.push(["w:u", `<w:u w:val="single"/>`]); } }
      const rPr = buildRPr(n.marks, docxRun ? String(docxRun.attrs?.rpr ?? "") || null : null, extra, { stripRevisions: env.changes === "accepted" });
      const text = n.text === "​" && markOf(n, "footnote") ? "" : (n.text ?? "");
      out += textRun(rPr, text, Boolean(del) && env.changes === "revisions");
      const fn = markOf(n, "footnote");
      if (fn && lastNote.get(String(fn.attrs?.id ?? "")) === i) {
        const ref = env.notes.ref(fn.attrs ?? {});
        const style = env.styles.character(ref.kind === "footnote" ? "footnoteReference" : "endnoteReference");
        const rp = style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>`;
        out += `<w:r>${rp}<w:${ref.kind}Reference w:id="${ref.id}"/></w:r>`;
      }
      for (const m of n.marks ?? []) {
        if (m.type !== "comment") continue;
        const span = env.commentSpan.get(String(m.attrs?.id ?? ""));
        if (span?.last === n) {
          const cid = env.comments.idFor(String(m.attrs?.id ?? ""));
          if (cid != null) {
            closeLink();
            const cs = env.styles.character("commentReference");
            out += `<w:commentRangeEnd w:id="${cid}"/><w:r>${cs ? `<w:rPr><w:rStyle w:val="${cs}"/></w:rPr>` : ""}<w:commentReference w:id="${cid}"/></w:r>`;
          }
        }
      }
      return;
    }
    closeLink();
    if (n.type === "hardBreak") { out += "<w:r><w:br/></w:r>"; return; }
    if (n.type === "docxInline") { out += writeAtom(n, env); return; }
    if (n.content) out += writeInline(n.content, env);
  });
  closeLink();
  return out;
}

function writeAtom(n: PMNode, env: WriterEnv): string {
  const a = n.attrs ?? {};
  const rpr = a.rpr ? String(a.rpr) : "";
  const xml = a.xml ? String(a.xml) : "";
  switch (a.kind) {
    case "bookmarkStart": {
      if (xml && env.mode === "preserve") return xml;
      const id = bookmarkId(env, String(a.bid ?? a.name ?? ""));
      return `<w:bookmarkStart w:id="${id}" w:name="${escAttr(String(a.name ?? `_Ref${id}`))}"/>`;
    }
    case "bookmarkEnd": {
      if (xml && env.mode === "preserve") return xml;
      return `<w:bookmarkEnd w:id="${bookmarkId(env, String(a.bid ?? ""))}"/>`;
    }
    case "fieldBegin": {
      const dirty = a.dirty ? ` w:dirty="true"` : "";
      const begin = xml && !a.dirty ? xml : `<w:fldChar w:fldCharType="begin"${dirty}/>`;
      return `<w:r>${rpr}${begin}</w:r><w:r>${rpr}<w:instrText xml:space="preserve">${T(String(a.instr ?? ""))}</w:instrText></w:r>`;
    }
    case "fieldSep": return `<w:r>${rpr}${xml || `<w:fldChar w:fldCharType="separate"/>`}</w:r>`;
    case "fieldEnd": return `<w:r>${rpr}${xml || `<w:fldChar w:fldCharType="end"/>`}</w:r>`;
    case "math": return xml;
    case "drawing": {
      const img = a.image as { src?: string; width?: number; height?: number; alt?: string } | undefined;
      if (env.mode === "preserve" && xml) return `<w:r>${rpr}${xml}</w:r>`;
      if (img?.src) return drawingRun(env, img.src, img.width ?? undefined, img.alt ?? "Image") ?? "";
      return "";
    }
    case "pageBreak": return `<w:r>${rpr}<w:br w:type="page"/></w:r>`;
    case "columnBreak": return `<w:r>${rpr}<w:br w:type="column"/></w:r>`;
    default:
      if (env.mode === "preserve" && xml) return `<w:r>${rpr}${xml}</w:r>`;
      return "";
  }
}

function bookmarkId(env: WriterEnv, key: string): number {
  let id = env.bookmarkIds.get(key);
  if (id == null) { id = env.nextId(); env.bookmarkIds.set(key, id); }
  return id;
}

function drawingRun(env: WriterEnv, src: string, widthPx: number | undefined, alt: string, reuseRid?: string): string | null {
  const img = env.images.get(src);
  if (!img && !reuseRid) return null;
  const natW = img?.width || widthPx || 480;
  const natH = img?.height || Math.round(natW * 0.66);
  const w = Math.min(Number(widthPx) || natW, 640);
  const h = Math.max(1, Math.round(w * (natH / natW)));
  const rid = reuseRid ?? env.rels.image(img!);
  const cx = Math.round(w * 9525), cy = Math.round(h * 9525);
  const did = env.nextDrawingId();
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${did}" name="Picture ${did}" descr="${escAttr(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${did}" name="${escAttr(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function paragraphRevision(content: PMNode[] | undefined, env: WriterEnv): string | null {
  if (env.changes !== "revisions") return null;
  const texts = (content ?? []).filter((n) => n.type === "text" && n.text);
  if (!texts.length) return null;
  const ins = texts.every((n) => markOf(n, "insertion"));
  const del = texts.every((n) => markOf(n, "deletion"));
  const m = ins ? markOf(texts[0], "insertion") : del ? markOf(texts[0], "deletion") : undefined;
  if (!m) return null;
  return `<w:${ins ? "ins" : "del"} ${changeAttrs(env, m)}/>`;
}

interface ParaOpts { numPr?: { numId: string; ilvl: number } | null; role?: "quote" | "code" | "listContinuation"; listIlvl?: number; listContext?: { numId: string; ilvl: number } | null }

function docxAttr(n: PMNode): Record<string, unknown> { return (n.attrs?.docx as Record<string, unknown> | undefined) ?? {}; }

export function writeParagraph(n: PMNode, env: WriterEnv, o: ParaOpts = {}): string {
  const pristine = env.pristine?.raw(n, o.listContext === undefined ? null : o.listContext);
  if (pristine) return env.changes === "accepted" ? stripRevisionMarkup(pristine) : pristine;
  const styleId = env.styles.paragraph(n, o.role);
  const extra: [string, string][] = [];
  if (o.role === "quote" && !styleId) extra.push(["w:ind", `<w:ind w:left="720" w:right="720"/>`]);
  if (o.role === "listContinuation" && !n.attrs?.indent) extra.push(["w:ind", `<w:ind w:left="${720 * ((o.listIlvl ?? 0) + 1)}"/>`]);
  if (n.attrs?.pStyle === "toc_entry") extra.push(["w:tabs", `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>`]);
  if (o.role === "code") extra.push(["w:shd", `<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>`]);
  const rawPPr = docxAttr(n).pPr ? String(docxAttr(n).pPr) : null;
  const isHeading = n.type === "heading";
  const pPr = buildPPr(n.attrs, rawPPr, {
    styleId,
    numPr: isHeading ? undefined : (o.numPr ?? null),
    extra,
    markRevision: paragraphRevision(n.content, env),
    stripRevisions: env.changes === "accepted",
    defaultLine: env.lineDefault,
  });
  let content = n.content;
  if (n.attrs?.pStyle === "toc_entry") {
    const text = (content ?? []).map((c) => c.text ?? "").join("").replace(/\s*\.{3,}\s*¶?(\d+)\s*$/, "\t$1");
    content = [{ type: "text", text }];
  }
  if (o.role === "code") content = (content ?? []).map((c) => (c.type === "text" ? { ...c, marks: [...(c.marks ?? []), { type: "code" }] } : c));
  return `<w:p>${pPr}${writeInline(content, env)}</w:p>`;
}

function writeImageBlock(n: PMNode, env: WriterEnv): string {
  const pristine = env.pristine?.raw(n, null);
  if (pristine) return pristine;
  const src = String(n.attrs?.src ?? "");
  const alt = String(n.attrs?.alt ?? "Image");
  const d = docxAttr(n);
  const reuse = env.pristine && d.rid && env.pristine.imageSrc(String(n.attrs?.id ?? "")) === src ? String(d.rid) : undefined;
  const align = String(n.attrs?.align ?? "center");
  const jc = align === "left" ? "" : `<w:jc w:val="${align === "right" ? "right" : "center"}"/>`;
  const run = drawingRun(env, src, Number(n.attrs?.width) || undefined, alt, reuse);
  if (!run) return `<w:p><w:pPr>${jc || `<w:jc w:val="center"/>`}</w:pPr><w:r><w:rPr><w:i/><w:color w:val="777777"/></w:rPr><w:t xml:space="preserve">${T(`[Image${alt ? `: ${alt}` : ""}]`)}</w:t></w:r></w:p>`;
  return `<w:p><w:pPr><w:spacing w:before="120" w:after="120"/>${jc}</w:pPr>${run}</w:p>`;
}

const TCPR_ORDER = ["w:cnfStyle", "w:tcW", "w:gridSpan", "w:hMerge", "w:vMerge", "w:tcBorders", "w:shd", "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark", "w:headers", "w:cellIns", "w:cellDel", "w:cellMerge", "w:tcPrChange"];

function buildTcPr(rawTcPr: string | null, set: { widthTw: number | null; span: number; vMerge: "restart" | "continue" | null; fill?: string | null }): string {
  const parts: [string, string][] = [];
  const replaced = new Set(["w:gridSpan", "w:vMerge", "w:hMerge"]);
  let rawWidth: number | null = null;
  if (rawTcPr) {
    try {
      const { root, src } = parseXml(rawTcPr);
      for (const c of kids(root)) {
        if (replaced.has(c.name)) continue;
        if (c.name === "w:tcW") { const w = Number(c.attrs["w:w"]); if ((c.attrs["w:type"] ?? "dxa") === "dxa" && Number.isFinite(w)) rawWidth = w; }
        parts.push([c.name, rawOf(src, c)]);
      }
    } catch { /* regenerate below */ }
  }
  if (set.widthTw != null && (rawWidth == null || Math.abs(rawWidth - set.widthTw) > 16)) {
    const i = parts.findIndex((p) => p[0] === "w:tcW");
    const el: [string, string] = ["w:tcW", `<w:tcW w:w="${Math.round(set.widthTw)}" w:type="dxa"/>`];
    if (i >= 0 && rawWidth != null) parts[i] = el; else if (i < 0) parts.push(el);
  }
  if (set.span > 1) parts.push(["w:gridSpan", `<w:gridSpan w:val="${set.span}"/>`]);
  if (set.vMerge === "restart") parts.push(["w:vMerge", `<w:vMerge w:val="restart"/>`]);
  else if (set.vMerge === "continue") parts.push(["w:vMerge", `<w:vMerge/>`]);
  if (set.fill && !parts.some((p) => p[0] === "w:shd")) parts.push(["w:shd", `<w:shd w:val="clear" w:color="auto" w:fill="${set.fill}"/>`]);
  const order = (n: string) => { const i = TCPR_ORDER.indexOf(n); return i < 0 ? TCPR_ORDER.length : i; };
  const body = parts.map((p, i) => ({ p, i })).sort((a, b) => order(a.p[0]) - order(b.p[0]) || a.i - b.i).map((x) => x.p[1]).join("");
  return body ? `<w:tcPr>${body}</w:tcPr>` : "";
}

function textWidthTw(env: WriterEnv): number {
  const s = env.settings;
  const size = PAGE_SIZES[s.pageSize] ?? PAGE_SIZES.letter;
  const m = MARGIN_PRESETS[s.margins] ?? MARGIN_PRESETS.normal;
  const w = s.orientation === "landscape" ? size.height : size.width;
  return Math.round((w - m.left - m.right) * 1440);
}

function writeTable(n: PMNode, env: WriterEnv): string {
  const pristine = env.pristine?.raw(n, null);
  if (pristine) return env.changes === "accepted" ? stripRevisionMarkup(pristine) : pristine;
  const rows = n.content ?? [];
  // Grid occupancy from colspan/rowspan.
  const occ: boolean[][] = [];
  const placed: { row: number; col: number; cell: PMNode; span: number; rowspan: number }[][] = [];
  rows.forEach((r, ri) => {
    occ[ri] ??= [];
    placed[ri] = [];
    let c = 0;
    for (const cell of r.content ?? []) {
      while (occ[ri][c]) c++;
      const span = Math.max(1, Number(cell.attrs?.colspan ?? 1) || 1);
      const rowspan = Math.max(1, Number(cell.attrs?.rowspan ?? 1) || 1);
      for (let dr = 0; dr < rowspan; dr++) { occ[ri + dr] ??= []; for (let dc = 0; dc < span; dc++) occ[ri + dr][c + dc] = true; }
      placed[ri].push({ row: ri, col: c, cell, span, rowspan });
      c += span;
    }
  });
  const cols = Math.max(1, ...occ.map((r) => r.length));
  const d = docxAttr(n);
  let grid: number[] = Array.isArray(d.grid) && (d.grid as number[]).length === cols ? (d.grid as number[]).map(Number) : [];
  if (!grid.length) {
    const firstRow = placed[0] ?? [];
    const widths: number[] = Array(cols).fill(0);
    for (const p of firstRow) { const cw = Array.isArray(p.cell.attrs?.colwidth) ? Number((p.cell.attrs?.colwidth as number[])[0]) : 0; if (cw) for (let k = 0; k < p.span; k++) widths[p.col + k] = Math.round((cw * 15) / p.span); }
    const total = textWidthTw(env);
    const known = widths.reduce((a, b) => a + b, 0);
    const unknown = widths.filter((w) => !w).length;
    if (known && !unknown) grid = widths.map((w) => Math.round((w / known) * Math.min(known, total)));
    else { const rest = Math.max(unknown ? (total - known) / unknown : 0, 360); grid = widths.map((w) => w || Math.round(rest)); }
  }
  const caption = Boolean(n.attrs?.caption);
  const tblPr = d.tblPr ? String(d.tblPr) : caption
    ? `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>`
    : `<w:tblPr>${env.styles.has("TableGrid") ? `<w:tblStyle w:val="TableGrid"/>` : ""}<w:tblW w:w="5000" w:type="pct"/>${env.styles.has("TableGrid") ? "" : `<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:left w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:right w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="444444"/></w:tblBorders>`}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
  const tblGrid = `<w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${Math.max(1, Math.round(w))}"/>`).join("")}</w:tblGrid>`;
  // Continuation cells (vMerge) are emitted where a rowspan from above covers a grid position.
  const covering: Map<string, { owner: PMNode; k: number; span: number }> = new Map();
  for (const rowPlaced of placed) for (const p of rowPlaced) for (let dr = 1; dr < p.rowspan; dr++) covering.set(`${p.row + dr}:${p.col}`, { owner: p.cell, k: dr - 1, span: p.span });
  let body = "";
  rows.forEach((r, ri) => {
    const rd = docxAttr(r);
    const header = (r.content ?? []).length > 0 && (r.content ?? []).every((c) => c.type === "tableHeader");
    let trPr = rd.trPr ? String(rd.trPr) : "";
    if (header && !/w:tblHeader/.test(trPr)) trPr = trPr ? trPr.replace(/<w:trPr\s*\/>/, "<w:trPr></w:trPr>").replace("</w:trPr>", "<w:tblHeader/></w:trPr>") : "<w:trPr><w:tblHeader/></w:trPr>";
    if (!header && rd.header && /w:tblHeader/.test(trPr)) trPr = trPr.replace(/<w:tblHeader\b[^>]*\/>/, "");
    const tblPrEx = rd.tblPrEx ? String(rd.tblPrEx) : "";
    let cells = "";
    let c = 0;
    const rowPlaced = placed[ri] ?? [];
    let pi = 0;
    while (c < cols) {
      const cover = covering.get(`${ri}:${c}`);
      if (cover) {
        const od = docxAttr(cover.owner);
        const rawCont = Array.isArray(od.vmerge) ? (od.vmerge as string[])[cover.k] : null;
        if (rawCont && env.mode === "preserve") cells += rawCont;
        else {
          const rawTcPr = od.tcPr ? String(od.tcPr) : null;
          cells += `<w:tc>${buildTcPr(rawTcPr, { widthTw: grid.slice(c, c + cover.span).reduce((a, b) => a + b, 0), span: cover.span, vMerge: "continue" })}<w:p/></w:tc>`;
        }
        c += cover.span;
        continue;
      }
      const p = rowPlaced[pi];
      if (!p || p.col !== c) { cells += `<w:tc><w:tcPr><w:tcW w:w="${grid[c] ?? 0}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`; c++; continue; }
      pi++;
      const cd = docxAttr(p.cell);
      const widthTw = grid.slice(c, c + p.span).reduce((a, b) => a + b, 0);
      const fill = !cd.tcPr && p.cell.type === "tableHeader" && !caption ? "EDEDED" : null;
      const tcPr = buildTcPr(cd.tcPr ? String(cd.tcPr) : null, { widthTw, span: p.span, vMerge: p.rowspan > 1 ? "restart" : null, fill });
      let inner = writeBlocks(p.cell.content ?? [], env, { inCell: true });
      if (!inner || !/<\/w:p>$|<w:p\/>$/.test(inner)) inner += "<w:p/>";
      cells += `<w:tc>${tcPr}${inner}</w:tc>`;
      c += p.span;
    }
    body += `<w:tr>${tblPrEx}${trPr}${cells}</w:tr>`;
  });
  return `<w:tbl>${tblPr}${tblGrid}${body}</w:tbl>`;
}

interface BlockCtx { inCell?: boolean; topLevel?: boolean }

function writeList(n: PMNode, env: WriterEnv, parentIlvl: number, parentNumId: string | null): string {
  const d = docxAttr(n);
  const ilvl = Math.max(0, Math.min(8, d.ilvl != null ? Number(d.ilvl) : parentIlvl + 1));
  const numId = env.numbering.forList(n, ilvl, parentNumId);
  const task = n.type === "taskList";
  let out = "";
  for (const item of n.content ?? []) {
    let first = true;
    for (const c of item.content ?? []) {
      if (c.type === "paragraph" && first) {
        const para = task ? { ...c, content: [{ type: "text", text: item.attrs?.checked ? "☒ " : "☐ " }, ...(c.content ?? [])] } : c;
        out += writeParagraph(para, env, { numPr: { numId, ilvl }, listContext: { numId, ilvl } });
        first = false;
      } else if (c.type === "paragraph") out += writeParagraph(c, env, { numPr: null, role: "listContinuation", listIlvl: ilvl, listContext: null });
      else if (c.type === "bulletList" || c.type === "orderedList" || c.type === "taskList") out += writeList(c, env, ilvl, numId);
      else out += writeBlock(c, env, {});
    }
  }
  return out;
}

export function writeBlock(n: PMNode, env: WriterEnv, bc: BlockCtx = {}): string {
  switch (n.type) {
    case "paragraph": case "heading": return writeParagraph(n, env, { listContext: null });
    case "image": return writeImageBlock(n, env);
    case "table": return writeTable(n, env);
    case "bulletList": case "orderedList": case "taskList": return writeList(n, env, -1, null);
    case "blockquote": return (n.content ?? []).map((c) => (c.type === "paragraph" ? writeParagraph(c, env, { role: "quote", listContext: null }) : writeBlock(c, env, bc))).join("");
    case "codeBlock": {
      const text = (n.content ?? []).map((c) => c.text ?? "").join("");
      return text.split("\n").map((line) => writeParagraph({ type: "paragraph", attrs: { id: undefined }, content: line ? [{ type: "text", text: line }] : [] }, env, { role: "code", listContext: null })).join("");
    }
    case "horizontalRule": return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr><w:spacing w:after="160"/></w:pPr></w:p>`;
    case "pageBreak": {
      const pristine = env.pristine?.raw(n, null);
      if (pristine) return pristine;
      const section = n.attrs?.section as Record<string, unknown> | undefined;
      if (section) return `<w:p><w:pPr><w:sectPr>${env.sectPrInner(section)}</w:sectPr></w:pPr></w:p>`;
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }
    default: return writeBlocks(n.content ?? [], env, bc);
  }
}

export function writeBlocks(nodes: PMNode[], env: WriterEnv, bc: BlockCtx = {}): string {
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const id = String(n.attrs?.id ?? "");
    if (bc.topLevel && env.pristine) {
      const lead = env.pristine.lead(id);
      if (lead) out += lead;
      const sdt = env.pristine.sdtStart(id);
      if (sdt) {
        const members = nodes.slice(i, i + sdt.members.length);
        const same = members.length === sdt.members.length && members.every((m, k) => String(m.attrs?.id ?? "") === sdt.members[k]);
        if (same && members.every((m) => env.pristine!.raw(m, null) !== null)) {
          out += env.changes === "accepted" ? stripRevisionMarkup(sdt.raw) : sdt.raw;
          i += sdt.members.length - 1;
          continue;
        }
      }
    }
    out += writeBlock(n, env, { ...bc, topLevel: false });
  }
  return out;
}

/** First and last text node per comment id, in document order. */
export function commentSpans(doc: PMNode): Map<string, { first: PMNode; last: PMNode }> {
  const out = new Map<string, { first: PMNode; last: PMNode }>();
  const walk = (n: PMNode) => {
    if (n.type === "text") for (const m of n.marks ?? []) { if (m.type !== "comment") continue; const id = String(m.attrs?.id ?? ""); const s = out.get(id); if (s) s.last = n; else out.set(id, { first: n, last: n }); }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

export function collectImageSrcs(doc: PMNode): string[] {
  const out = new Set<string>();
  const walk = (n: PMNode) => {
    if (n.type === "image" && n.attrs?.src) out.add(String(n.attrs.src));
    if (n.type === "docxInline" && (n.attrs?.image as { src?: string } | undefined)?.src) out.add(String((n.attrs!.image as { src: string }).src));
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return Array.from(out);
}

/** Footnote bodies in document order (for fresh notes parts). */
export function noteBodies(doc: PMNode) { return collectFootnotes(doc); }

/** Parse w:val of a style id element from raw pPr (used to compare heading styles). */
export function rawStyleId(pPr: string | null | undefined): string | null {
  if (!pPr) return null;
  try { const { root } = parseXml(pPr); return wval(kids(root, "w:pStyle")[0]) ?? null; } catch { return null; }
}
