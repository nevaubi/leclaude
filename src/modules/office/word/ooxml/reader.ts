/**
 * Direct OOXML reader: .docx package → editor document (TipTap JSON) + DocxMeta + the raw source slices the
 * package-preserving writer re-emits for untouched content.
 *
 * Deterministic by construction (ids derive from the package hash and element order, no clocks or randomness),
 * so re-reading the original package at export time reproduces the pristine document and its raw map exactly.
 */
import { createHash } from "node:crypto";
import { DEFAULT_SETTINGS, MARGIN_PRESETS, PAGE_SIZES, type DocSettings, type MarginPresetId, type PageSizeId } from "../constants";
import type { PMNode } from "../doc-model";
import { IMAGE_MIME, loadPackage, REL, relatedPart, resolveTarget, type DocxPackage } from "./package";
import { marksFromRunValues, paraValuesFromPPr, runValuesFromRPr } from "./props";
import type { DocxImportedComment, DocxMeta, DocxNumberingInfo, DocxSection, DocxStyleInfo } from "./types";
import { attr, descendants, isEl, kid, kids, onOff, parseXml, raw, serializeEl, textContent, wval, type XEl } from "./xml";

type Mark = NonNullable<PMNode["marks"]>[number];

export interface ReadOptions {
  /** Persist an embedded image; returns the src the editor loads. Defaults to a data: URL. */
  storeImage?: (bytes: Uint8Array, mime: string, name: string, sha256: string) => string;
}

/** Raw source kept for the package-preserving export. */
export interface RawMap {
  /** paragraph / image-paragraph / table id → its exact source XML. */
  blocks: Map<string, string>;
  /** Paragraph id → the list context (numId/ilvl) it had in the source, for list paragraphs. */
  listContext: Map<string, { numId: string; ilvl: number } | null>;
  /** First member id → body-level content control wrapping consecutive top-level blocks. */
  sdt: Map<string, { raw: string; members: string[] }>;
  /** Block id → body-level markup (bookmarks, permission ranges…) that precedes it. */
  lead: Map<string, string>;
  tail: string;
  finalSectPr: string | null;
  /** The final sectPr with canonical prefixes (header/footer references copied into new section breaks). */
  finalSectPrCanon?: string | null;
  /** document.xml text through the <w:body> start tag, and from </w:body> to the end. */
  docOpen: string;
  docClose: string;
  /** Largest numeric w:id used by annotations in document.xml (new ids start above it). */
  maxAnnotationId: number;
}

export interface ReadResult {
  doc: PMNode;
  meta: DocxMeta;
  settings: DocSettings;
  title: string | null;
  raw: RawMap;
  pkg: DocxPackage;
}

interface StyleDef { id: string; name: string; type: string; basedOn?: string; outline?: number; numId?: string; ilvl?: number; isDefault: boolean; rPr?: XEl | null; pPr?: XEl | null }
interface LevelDef { ilvl: number; start: number; fmt: string; text: string; isLgl: boolean; restart?: number }
interface AbstractDef { id: string; levels: Map<number, LevelDef> }
interface NumDef { numId: string; abstractId: string; overrides: Map<number, { start?: number; level?: LevelDef }> }

const EMU_PER_PX = 9525;

export function sha256Hex(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }

function toDataUrl(bytes: Uint8Array, mime: string) { return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`; }

// ---------------------------------------------------------------------------
// Styles & numbering
// ---------------------------------------------------------------------------

function readStyles(xml: string | null) {
  const map = new Map<string, StyleDef>();
  let defaultPara: string | null = null;
  let docDefaults: { font?: string; sizePt?: number; line?: number } = {};
  if (!xml) return { map, defaultPara, docDefaults };
  const { root } = parseXml(xml);
  const dd = kid(root, "w:docDefaults");
  if (dd) {
    const rPr = kid(kid(dd, "w:rPrDefault"), "w:rPr");
    const pPr = kid(kid(dd, "w:pPrDefault"), "w:pPr");
    const fonts = kid(rPr, "w:rFonts");
    const sz = Number(wval(kid(rPr, "w:sz")));
    const sp = kid(pPr, "w:spacing");
    docDefaults = { font: fonts?.attrs["w:ascii"] ?? fonts?.attrs["w:hAnsi"], sizePt: Number.isFinite(sz) && sz > 0 ? sz / 2 : undefined, line: sp?.attrs["w:line"] && (!sp.attrs["w:lineRule"] || sp.attrs["w:lineRule"] === "auto") ? Number(sp.attrs["w:line"]) / 240 : undefined };
  }
  for (const s of kids(root, "w:style")) {
    const id = attr(s, "w:styleId") ?? "";
    if (!id) continue;
    const pPr = kid(s, "w:pPr");
    const numPr = kid(pPr, "w:numPr");
    const ol = wval(kid(pPr, "w:outlineLvl"));
    const def: StyleDef = {
      id, name: wval(kid(s, "w:name")) ?? id, type: attr(s, "w:type") ?? "paragraph", basedOn: wval(kid(s, "w:basedOn")),
      outline: ol != null && Number.isFinite(Number(ol)) ? Number(ol) : undefined,
      numId: wval(kid(numPr, "w:numId")), ilvl: wval(kid(numPr, "w:ilvl")) != null ? Number(wval(kid(numPr, "w:ilvl"))) : undefined,
      isDefault: ["1", "true", "on"].includes(attr(s, "w:default") ?? ""),
      rPr: kid(s, "w:rPr"), pPr,
    };
    map.set(id, def);
    if (def.type === "paragraph" && def.isDefault) defaultPara = id;
  }
  // Name-based heading detection for styles that carry no outline level ("heading 1" without w:outlineLvl).
  for (const s of map.values()) {
    if (s.outline === undefined) { const m = /^heading\s*(\d)$/i.exec(s.name); if (m) s.outline = Number(m[1]) - 1; }
  }
  return { map, defaultPara, docDefaults };
}

function styleChain(styles: Map<string, StyleDef>, id: string | null | undefined): StyleDef[] {
  const out: StyleDef[] = [];
  const seen = new Set<string>();
  let cur = id ? styles.get(id) : undefined;
  while (cur && !seen.has(cur.id) && out.length < 16) { out.push(cur); seen.add(cur.id); cur = cur.basedOn ? styles.get(cur.basedOn) : undefined; }
  return out;
}

function readNumbering(xml: string | null) {
  const abstracts = new Map<string, AbstractDef>();
  const nums = new Map<string, NumDef>();
  if (!xml) return { abstracts, nums };
  const { root } = parseXml(xml);
  const readLvl = (l: XEl): LevelDef => ({
    ilvl: Number(attr(l, "w:ilvl") ?? 0),
    start: Number(wval(kid(l, "w:start")) ?? 1),
    fmt: wval(kid(l, "w:numFmt")) ?? "decimal",
    text: wval(kid(l, "w:lvlText")) ?? "",
    isLgl: Boolean(kid(l, "w:isLgl")) && (onOff(kid(l, "w:isLgl")) ?? false),
    restart: wval(kid(l, "w:lvlRestart")) != null ? Number(wval(kid(l, "w:lvlRestart"))) : undefined,
  });
  for (const a of kids(root, "w:abstractNum")) {
    const id = attr(a, "w:abstractNumId") ?? "";
    const levels = new Map<number, LevelDef>();
    for (const l of kids(a, "w:lvl")) { const d = readLvl(l); levels.set(d.ilvl, d); }
    abstracts.set(id, { id, levels });
  }
  for (const n of kids(root, "w:num")) {
    const numId = attr(n, "w:numId") ?? "";
    const overrides = new Map<number, { start?: number; level?: LevelDef }>();
    for (const o of kids(n, "w:lvlOverride")) {
      const ilvl = Number(attr(o, "w:ilvl") ?? 0);
      const so = wval(kid(o, "w:startOverride"));
      const lvl = kid(o, "w:lvl");
      overrides.set(ilvl, { start: so != null ? Number(so) : undefined, level: lvl ? readLvl(lvl) : undefined });
    }
    nums.set(numId, { numId, abstractId: wval(kid(n, "w:abstractNumId")) ?? "", overrides });
  }
  return { abstracts, nums };
}

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
function toRoman(n: number) { let s = ""; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; }
function toLetter(n: number) { let s = ""; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
export function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter": return toLetter(n);
    case "upperLetter": return toLetter(n).toUpperCase();
    case "lowerRoman": return toRoman(n);
    case "upperRoman": return toRoman(n).toUpperCase();
    case "decimalZero": return String(n).padStart(2, "0");
    case "bullet": case "none": return "";
    default: return String(n);
  }
}

/** Word list counters: shared per abstractNum, restarted by startOverride on first use of a num, deeper levels reset. */
export class NumberingState {
  private counters = new Map<string, number[]>();
  private seenNums = new Set<string>();
  constructor(private abstracts: Map<string, AbstractDef>, private nums: Map<string, NumDef>) {}
  level(numId: string, ilvl: number): LevelDef | null {
    const num = this.nums.get(numId);
    if (!num) return null;
    const ov = num.overrides.get(ilvl)?.level;
    return ov ?? this.abstracts.get(num.abstractId)?.levels.get(ilvl) ?? null;
  }
  next(numId: string, ilvl: number): { value: number; label: string; level: LevelDef | null } {
    const num = this.nums.get(numId);
    if (!num) return { value: 0, label: "", level: null };
    const key = num.abstractId;
    let c = this.counters.get(key);
    if (!c) { c = []; this.counters.set(key, c); }
    if (!this.seenNums.has(numId)) {
      this.seenNums.add(numId);
      for (const [l, o] of num.overrides) if (o.start != null) c[l] = o.start - 1;
    }
    const lvl = this.level(numId, ilvl);
    if (c[ilvl] === undefined) c[ilvl] = (lvl?.start ?? 1) - 1;
    c[ilvl] += 1;
    for (let d = ilvl + 1; d < 9; d++) c[d] = undefined as unknown as number;
    const value = c[ilvl];
    let label = lvl?.text ?? "";
    if (lvl?.fmt === "bullet") label = lvl.text;
    else label = label.replace(/%(\d)/g, (_, k: string) => {
      const li = Number(k) - 1;
      const lv = this.level(numId, li);
      const v = c![li] ?? lv?.start ?? 1;
      return formatNumber(v, lvl?.isLgl ? "decimal" : (lv?.fmt ?? "decimal"));
    });
    return { value, label, level: lvl };
  }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

interface Ctx {
  pkg: DocxPackage;
  src: string;
  part: string;
  styles: Map<string, StyleDef>;
  defaultPara: string | null;
  numbering: NumberingState;
  numDefs: { abstracts: Map<string, AbstractDef>; nums: Map<string, NumDef> };
  id: () => string;
  hash6: string;
  raw: RawMap;
  opts: ReadOptions;
  footnoteText: Map<string, string>;
  endnoteText: Map<string, string>;
  openComments: Set<string>;
  commentAnchors: Map<string, { anchor: string; quote: string }>;
  fieldStack: PMNode[];
  bookmarks: string[];
  fields: string[];
  images: number;
  tracked: Set<string>;
  sections: XEl[];
  warnings: string[];
  imageCache: Map<string, string>;
}

interface InlineState { out: PMNode[]; link?: string; change?: Mark; drawings: PMNode[]; texts: number }

function commentMarkId(ctx: Ctx, wid: string) { return `wc${ctx.hash6}${wid}`; }

function pushText(ctx: Ctx, st: InlineState, text: string, runMarks: Mark[]) {
  if (!text) return;
  const marks: Mark[] = [...runMarks];
  if (st.link) marks.push({ type: "link", attrs: { href: st.link } });
  if (st.change) marks.push(st.change);
  for (const c of Array.from(ctx.openComments).sort()) marks.push({ type: "comment", attrs: { id: c } });
  st.out.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
  st.texts++;
}

function atom(attrs: Record<string, unknown>): PMNode { return { type: "docxInline", attrs }; }

function applyNoteMark(st: InlineState, mark: Mark) {
  for (let i = st.out.length - 1; i >= 0; i--) {
    const n = st.out[i];
    if (n.type === "hardBreak") break;
    if (n.type !== "text" || !n.text) continue;
    const m = /(\S+)(\s*)$/.exec(n.text);
    if (!m) break;
    const cut = n.text.length - m[0].length;
    const head = n.text.slice(0, cut);
    const word = m[1];
    const tail = m[2];
    const pieces: PMNode[] = [];
    if (head) pieces.push({ ...n, text: head });
    pieces.push({ ...n, text: word, marks: [...(n.marks ?? []), mark] });
    if (tail) pieces.push({ ...n, text: tail });
    st.out.splice(i, 1, ...pieces);
    return;
  }
  st.out.push({ type: "text", text: "​", marks: [mark] });
}

function readRun(ctx: Ctx, r: XEl, st: InlineState) {
  const rPr = kid(r, "w:rPr");
  const runMarks = marksFromRunValues(runValuesFromRPr(rPr));
  const rStyle = wval(kid(rPr, "w:rStyle"));
  const rprRaw = rPr ? serializeEl(rPr) : null;
  if (rprRaw) runMarks.push({ type: "docxRun", attrs: { rpr: rprRaw, rStyle: rStyle ?? null } });
  let buf = "";
  const flush = () => { if (buf) { pushText(ctx, st, buf, runMarks); buf = ""; } };
  for (const c of r.children) {
    if (!isEl(c)) continue;
    switch (c.name) {
      case "w:t": case "w:delText": buf += textContent(c); break;
      case "w:tab": buf += "\t"; break;
      case "w:noBreakHyphen": buf += "‑"; break;
      case "w:softHyphen": buf += "­"; break;
      case "w:cr": flush(); st.out.push({ type: "hardBreak" }); break;
      case "w:br": {
        flush();
        const t = attr(c, "w:type");
        if (t === "page" || t === "column") st.out.push(atom({ kind: t === "page" ? "pageBreak" : "columnBreak", xml: serializeEl(c), rpr: rprRaw, label: t === "page" ? "Page break" : "Column break" }));
        else st.out.push({ type: "hardBreak" });
        break;
      }
      case "w:fldChar": {
        flush();
        const t = attr(c, "w:fldCharType");
        if (t === "begin") { const a = atom({ kind: "fieldBegin", xml: serializeEl(c), rpr: rprRaw, instr: "" }); st.out.push(a); ctx.fieldStack.push(a); }
        else if (t === "separate") st.out.push(atom({ kind: "fieldSep", xml: serializeEl(c), rpr: rprRaw }));
        else if (t === "end") { const b = ctx.fieldStack.pop(); if (b?.attrs) ctx.fields.push(String(b.attrs.instr).trim()); st.out.push(atom({ kind: "fieldEnd", xml: serializeEl(c), rpr: rprRaw })); }
        break;
      }
      case "w:instrText": case "w:delInstrText": {
        const top = ctx.fieldStack[ctx.fieldStack.length - 1];
        if (top?.attrs) top.attrs.instr = `${String(top.attrs.instr ?? "")}${textContent(c)}`;
        break;
      }
      case "w:footnoteReference": case "w:endnoteReference": {
        flush();
        const note = c.name === "w:footnoteReference" ? "footnote" : "endnote";
        const wid = attr(c, "w:id") ?? "";
        const text = (note === "footnote" ? ctx.footnoteText : ctx.endnoteText).get(wid) ?? "";
        applyNoteMark(st, { type: "footnote", attrs: { id: `${note === "footnote" ? "fn" : "en"}${ctx.hash6}${wid}`, text, kind: note, sourceId: wid } });
        break;
      }
      case "w:sym": flush(); st.out.push(atom({ kind: "sym", xml: serializeEl(c), rpr: rprRaw, label: String.fromCharCode(parseInt(attr(c, "w:char") ?? "25A1", 16) || 0x25a1) })); break;
      case "w:ptab": flush(); st.out.push(atom({ kind: "ptab", xml: serializeEl(c), rpr: rprRaw })); break;
      case "w:drawing": case "w:pict": case "w:object": case "mc:AlternateContent": {
        flush();
        const a = atom({ kind: "drawing", xml: serializeEl(c), rpr: rprRaw, label: "Image" });
        const blip = descendants(c, "a:blip")[0];
        const rid = blip ? (attr(blip, "r:embed") ?? attr(blip, "r:link")) : undefined;
        if (rid && c.name === "w:drawing") {
          const extent = descendants(c, "wp:extent")[0];
          const docPr = descendants(c, "wp:docPr")[0];
          const cx = Number(attr(extent, "cx") ?? 0), cy = Number(attr(extent, "cy") ?? 0);
          a.attrs!.image = { rid, src: resolveImage(ctx, rid), width: cx ? Math.round(cx / EMU_PER_PX) : null, height: cy ? Math.round(cy / EMU_PER_PX) : null, alt: attr(docPr, "descr") || attr(docPr, "title") || attr(docPr, "name") || "Image" };
          ctx.images++;
        } else a.attrs!.label = c.name === "w:drawing" ? "Drawing" : "Object";
        st.out.push(a); st.drawings.push(a);
        break;
      }
      case "w:commentReference": case "w:annotationRef": case "w:lastRenderedPageBreak": case "w:rPr": case "w:footnoteRef": case "w:endnoteRef": case "w:separator": case "w:continuationSeparator": break;
      default: flush(); st.out.push(atom({ kind: "object", xml: serializeEl(c), rpr: rprRaw, label: c.name.replace(/^\w+:/, "") })); break;
    }
  }
  flush();
}

function resolveImage(ctx: Ctx, rid: string): string {
  const rel = ctx.pkg.rels(ctx.part).find((r) => r.id === rid);
  if (!rel || rel.external) return rel?.target ?? "";
  const path = resolveTarget(ctx.part, rel.target);
  const cached = ctx.imageCache.get(path);
  if (cached) return cached;
  const bytes = ctx.pkg.files.get(path);
  if (!bytes) { ctx.warnings.push(`Missing image part ${path}`); return ""; }
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
  const sha = sha256Hex(bytes);
  const src = ctx.opts.storeImage ? ctx.opts.storeImage(bytes, mime, path.split("/").pop() ?? "image", sha) : toDataUrl(bytes, mime);
  ctx.imageCache.set(path, src);
  return src;
}

function readInline(ctx: Ctx, children: XEl["children"], st: InlineState) {
  for (const c of children) {
    if (!isEl(c)) continue;
    const name = c.name;
    if (name === "w:r") { readRun(ctx, c, st); continue; }
    if (name === "w:hyperlink") {
      const rid = attr(c, "r:id");
      const anchor = attr(c, "w:anchor");
      let href: string | undefined;
      if (rid) { const rel = ctx.pkg.rels(ctx.part).find((r) => r.id === rid); href = rel?.target; }
      if (anchor) href = `${href ?? ""}#${anchor}`;
      const prev = st.link; st.link = href; readInline(ctx, c.children, st); st.link = prev; continue;
    }
    if (name === "w:ins" || name === "w:del" || name === "w:moveTo" || name === "w:moveFrom") {
      const wid = attr(c, "w:id") ?? "";
      const type = name === "w:ins" || name === "w:moveTo" ? "insertion" : "deletion";
      const id = `wr${ctx.hash6}${wid}`;
      ctx.tracked.add(id);
      const prev = st.change; st.change = { type, attrs: { id, author: attr(c, "w:author") ?? "Unknown", date: attr(c, "w:date") ?? "" } };
      readInline(ctx, c.children, st); st.change = prev; continue;
    }
    if (name === "w:fldSimple") {
      const instr = attr(c, "w:instr") ?? "";
      ctx.fields.push(instr.trim());
      st.out.push(atom({ kind: "fieldBegin", instr, xml: null, rpr: null, simple: true }));
      st.out.push(atom({ kind: "fieldSep", xml: null, rpr: null }));
      readInline(ctx, c.children, st);
      st.out.push(atom({ kind: "fieldEnd", xml: null, rpr: null }));
      continue;
    }
    if (name === "w:smartTag" || name === "w:customXml" || name === "w:dir" || name === "w:bdo") { readInline(ctx, c.children, st); continue; }
    if (name === "w:sdt") { readInline(ctx, kid(c, "w:sdtContent")?.children ?? [], st); continue; }
    if (name === "w:bookmarkStart") { const n = attr(c, "w:name") ?? ""; if (n) ctx.bookmarks.push(n); st.out.push(atom({ kind: "bookmarkStart", name: n, bid: attr(c, "w:id") ?? "", xml: serializeEl(c) })); continue; }
    if (name === "w:bookmarkEnd") { st.out.push(atom({ kind: "bookmarkEnd", bid: attr(c, "w:id") ?? "", xml: serializeEl(c) })); continue; }
    if (name === "w:commentRangeStart") { const id = commentMarkId(ctx, attr(c, "w:id") ?? ""); ctx.openComments.add(id); continue; }
    if (name === "w:commentRangeEnd") { ctx.openComments.delete(commentMarkId(ctx, attr(c, "w:id") ?? "")); continue; }
    if (name.endsWith(":oMath") || name.endsWith(":oMathPara")) { st.out.push(atom({ kind: "math", xml: serializeEl(c), label: "Equation" })); continue; }
    // w:pPr, w:proofErr, w:permStart/End and unknown extension markup: preserved through the raw paragraph only.
  }
}

interface ParaRead { node: PMNode; list: { numId: string; ilvl: number; fmt: string; isLgl: boolean; text: string; start: number; value: number; direct: boolean } | null; sectPr: XEl | null }

function effectiveNumPr(ctx: Ctx, pPr: XEl | null, styleId: string | null): { numId: string; ilvl: number; direct: boolean } | null {
  const numPr = kid(pPr, "w:numPr");
  const direct = numPr ? { numId: wval(kid(numPr, "w:numId")), ilvl: wval(kid(numPr, "w:ilvl")) } : null;
  let numId = direct?.numId;
  let ilvl = direct?.ilvl != null ? Number(direct.ilvl) : undefined;
  if (numId == null) {
    for (const s of styleChain(ctx.styles, styleId)) { if (s.numId != null) { numId = s.numId; if (ilvl === undefined) ilvl = s.ilvl ?? 0; break; } }
  }
  if (numId == null || numId === "0" || !ctx.numDefs.nums.has(numId)) return null;
  return { numId, ilvl: ilvl ?? 0, direct: Boolean(direct?.numId) };
}

function readParagraph(ctx: Ctx, p: XEl): ParaRead {
  const id = ctx.id();
  const pPr = kid(p, "w:pPr");
  const pv = paraValuesFromPPr(pPr);
  const styleId = pv.styleId ?? ctx.defaultPara;
  const chain = styleChain(ctx.styles, styleId);
  const directOutline = wval(kid(pPr, "w:outlineLvl"));
  const outline = directOutline != null ? Number(directOutline) : chain.find((s) => s.outline !== undefined)?.outline;
  const styleName = (chain[0]?.name ?? "").toLowerCase();
  const isToc = /^toc/i.test(styleId ?? "") || styleName.startsWith("toc");
  const st: InlineState = { out: [], drawings: [], texts: 0 };
  readInline(ctx, p.children, st);
  const sectPr = kid(pPr, "w:sectPr");
  if (sectPr) ctx.sections.push(sectPr);
  ctx.raw.blocks.set(id, raw(ctx.src, p));
  // Comment anchors: first block a comment's range touches, and the quoted text.
  for (const n of st.out) {
    if (n.type !== "text") continue;
    for (const m of n.marks ?? []) {
      if (m.type !== "comment") continue;
      const cid = String(m.attrs?.id);
      const a = ctx.commentAnchors.get(cid);
      if (!a) ctx.commentAnchors.set(cid, { anchor: id, quote: n.text ?? "" });
      else if (a.quote.length < 300) a.quote += n.text ?? "";
    }
  }
  for (const cid of ctx.openComments) if (!ctx.commentAnchors.has(cid)) ctx.commentAnchors.set(cid, { anchor: id, quote: "" });
  const docx: Record<string, unknown> = { pPr: pPr ? serializeEl(pPr) : null };
  const attrs: Record<string, unknown> = { id, textAlign: pv.align, lineHeight: pv.lineHeight, spacingBefore: pv.spacingBefore, spacingAfter: pv.spacingAfter, indent: pv.indent, styleId: pv.styleId, docx };

  // A paragraph that holds exactly one picture and no text is an image block.
  const onlyAtoms = st.out.every((n) => n.type === "docxInline" && ["drawing", "bookmarkStart", "bookmarkEnd"].includes(String(n.attrs?.kind)));
  const pictures = st.drawings.filter((d) => (d.attrs?.image as { src?: string } | undefined)?.src);
  if (st.texts === 0 && onlyAtoms && st.drawings.length === 1 && pictures.length === 1) {
    const img = pictures[0].attrs!.image as { rid: string; src: string; width: number | null; height: number | null; alt: string };
    return { node: { type: "image", attrs: { id, src: img.src, alt: img.alt, title: null, width: img.width, height: img.height, align: pv.align ?? "left", docx: { rid: img.rid, pPr: docx.pPr } } }, list: null, sectPr };
  }

  const content = mergeText(st.out);
  const numPr = outline === undefined || outline > 5 || isToc ? effectiveNumPr(ctx, pPr, styleId) : null;
  if (!isToc && (styleName === "title" || styleId === "Title")) return { node: { type: "heading", attrs: { ...attrs, level: 1, pStyle: "title" }, content }, list: null, sectPr };
  if (!isToc && outline !== undefined && outline >= 0 && outline <= 5) return { node: { type: "heading", attrs: { ...attrs, level: outline + 1 }, content }, list: null, sectPr };
  if (/caption/.test(styleName)) attrs.pStyle = "caption";
  if (numPr) {
    const n = ctx.numbering.next(numPr.numId, numPr.ilvl);
    docx.numId = numPr.numId; docx.ilvl = numPr.ilvl;
    return { node: { type: "paragraph", attrs, content }, list: { ...numPr, fmt: n.level?.fmt ?? "decimal", isLgl: Boolean(n.level?.isLgl), text: n.level?.text ?? "", start: n.level?.start ?? 1, value: n.value }, sectPr };
  }
  return { node: { type: "paragraph", attrs, content }, list: null, sectPr };
}

function marksKey(m: PMNode["marks"]) { return JSON.stringify(m ?? []); }
function mergeText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text" && marksKey(last.marks) === marksKey(n.marks)) { last.text = (last.text ?? "") + (n.text ?? ""); continue; }
    out.push(n);
  }
  return out;
}

function listTypeFor(fmt: string) { return fmt === "bullet" ? "bulletList" : "orderedList"; }
function listStyleFor(fmt: string, text: string, isLgl: boolean): string {
  if (isLgl || /%1\.%2/.test(text)) return "legal";
  if (fmt === "lowerLetter" || fmt === "upperLetter") return "alpha";
  if (fmt === "lowerRoman" || fmt === "upperRoman") return "roman";
  return "decimal";
}

/** Groups consecutive numbered paragraphs into nested bulletList/orderedList nodes. */
class ListBuilder {
  private stack: { node: PMNode; numId: string; ilvl: number; type: string }[] = [];
  constructor(private ctx: Ctx, private emit: (n: PMNode) => void) {}
  add(pr: ParaRead) {
    const l = pr.list!;
    const type = listTypeFor(l.fmt);
    const item: PMNode = { type: "listItem", attrs: { id: this.ctx.id() }, content: [pr.node] };
    this.ctx.raw.listContext.set(String(pr.node.attrs?.id), { numId: l.numId, ilvl: l.ilvl });
    if (this.stack.length && l.numId !== this.stack[0].numId && l.ilvl <= this.stack[0].ilvl) this.flush();
    while (this.stack.length > 1 && l.ilvl < this.stack[this.stack.length - 1].ilvl) this.stack.pop();
    const top = this.stack[this.stack.length - 1];
    if (top && l.ilvl === top.ilvl && top.type === type && top.numId === l.numId) { top.node.content!.push(item); return; }
    if (top && l.ilvl > top.ilvl) {
      const list = this.newList(type, l, item);
      const lastItem = top.node.content![top.node.content!.length - 1];
      lastItem.content!.push(list);
      this.stack.push({ node: list, numId: l.numId, ilvl: l.ilvl, type });
      return;
    }
    if (top && this.stack.length > 1) {
      // Same depth, different list kind: sibling list inside the parent item.
      this.stack.pop();
      const parent = this.stack[this.stack.length - 1];
      const list = this.newList(type, l, item);
      parent.node.content![parent.node.content!.length - 1].content!.push(list);
      this.stack.push({ node: list, numId: l.numId, ilvl: l.ilvl, type });
      return;
    }
    this.flush();
    const list = this.newList(type, l, item);
    this.stack.push({ node: list, numId: l.numId, ilvl: l.ilvl, type });
  }
  private newList(type: string, l: NonNullable<ParaRead["list"]>, item: PMNode): PMNode {
    const attrs: Record<string, unknown> = { id: this.ctx.id(), docx: { numId: l.numId, ilvl: l.ilvl, importStart: l.value } };
    if (type === "orderedList") { attrs.start = l.value; attrs.listStyle = listStyleFor(l.fmt, l.text, l.isLgl); }
    return { type, attrs, content: [item] };
  }
  flush() { if (this.stack.length) { this.emit(this.stack[0].node); this.stack = []; } }
}

function readTable(ctx: Ctx, tbl: XEl): PMNode {
  const id = ctx.id();
  ctx.raw.blocks.set(id, raw(ctx.src, tbl));
  const tblPr = kid(tbl, "w:tblPr");
  const grid = kids(kid(tbl, "w:tblGrid"), "w:gridCol").map((g) => Number(attr(g, "w:w") ?? 0));
  const rowsXml: XEl[] = [];
  const collectRows = (el: XEl) => { for (const c of kids(el)) { if (c.name === "w:tr") rowsXml.push(c); else if (c.name === "w:sdt") collectRows(kid(c, "w:sdtContent") ?? c); else if (c.name === "w:customXml") collectRows(c); } };
  collectRows(tbl);
  interface CellRead { tc: XEl; gridStart: number; span: number; vMerge: "restart" | "continue" | null }
  const rowsCells: CellRead[][] = rowsXml.map((tr) => {
    const cells: XEl[] = [];
    const collect = (el: XEl) => { for (const c of kids(el)) { if (c.name === "w:tc") cells.push(c); else if (c.name === "w:sdt") collect(kid(c, "w:sdtContent") ?? c); else if (c.name === "w:customXml") collect(c); } };
    collect(tr);
    const trPr = kid(tr, "w:trPr");
    let g = Number(wval(kid(trPr, "w:gridBefore")) ?? 0);
    return cells.map((tc) => {
      const tcPr = kid(tc, "w:tcPr");
      const span = Math.max(1, Number(wval(kid(tcPr, "w:gridSpan")) ?? 1));
      const vm = kid(tcPr, "w:vMerge");
      const vMerge = vm ? (wval(vm) === "restart" ? "restart" : "continue") : null;
      const r: CellRead = { tc, gridStart: g, span, vMerge };
      g += span;
      return r;
    });
  });
  const rows: PMNode[] = rowsXml.map((tr, ri) => {
    const trPr = kid(tr, "w:trPr");
    const header = onOff(kid(trPr, "w:tblHeader")) ?? false;
    const tblPrEx = kid(tr, "w:tblPrEx");
    const content: PMNode[] = [];
    for (const cr of rowsCells[ri]) {
      if (cr.vMerge === "continue") continue;
      let rowspan = 1;
      const continuation: string[] = [];
      if (cr.vMerge === "restart") {
        for (let rj = ri + 1; rj < rowsCells.length; rj++) {
          const below = rowsCells[rj].find((x) => x.gridStart === cr.gridStart);
          if (!below || below.vMerge !== "continue") break;
          rowspan++;
          continuation.push(serializeEl(below.tc));
        }
      }
      const tcPr = kid(cr.tc, "w:tcPr");
      const tcW = kid(tcPr, "w:tcW");
      let widthTw = tcW && (attr(tcW, "w:type") ?? "dxa") === "dxa" ? Number(attr(tcW, "w:w") ?? 0) : 0;
      if (!widthTw && grid.length) widthTw = grid.slice(cr.gridStart, cr.gridStart + cr.span).reduce((a, b) => a + b, 0);
      const cellId = ctx.id();
      const blocks = readBlocks(ctx, cr.tc.children.filter(isEl).filter((c) => c.name !== "w:tcPr"));
      content.push({
        type: header ? "tableHeader" : "tableCell",
        attrs: { id: cellId, colspan: cr.span, rowspan, colwidth: widthTw ? [Math.max(20, Math.round(widthTw / 15))] : null, docx: { tcPr: tcPr ? serializeEl(tcPr) : null, vmerge: continuation.length ? continuation : null, gridStart: cr.gridStart } },
        content: blocks.length ? blocks : [{ type: "paragraph", attrs: { id: ctx.id() } }],
      });
    }
    return { type: "tableRow", attrs: { id: ctx.id(), docx: { trPr: trPr ? serializeEl(trPr) : null, tblPrEx: tblPrEx ? serializeEl(tblPrEx) : null, header } }, content };
  });
  return { type: "table", attrs: { id, docx: { tblPr: tblPr ? serializeEl(tblPr) : null, grid } }, content: rows };
}

/** Read a sequence of block-level elements (body, cell, sdtContent). */
function readBlocks(ctx: Ctx, els: XEl[], topLevel = false): PMNode[] {
  const out: PMNode[] = [];
  let lead: string[] = [];
  const emit = (n: PMNode) => {
    if (lead.length && topLevel) { ctx.raw.lead.set(String(n.attrs?.id), lead.join("")); lead = []; }
    out.push(n);
  };
  const lists = new ListBuilder(ctx, emit);
  for (const el of els) {
    switch (el.name) {
      case "w:p": {
        const pr = readParagraph(ctx, el);
        if (pr.list) lists.add(pr); else { lists.flush(); emit(pr.node); }
        break;
      }
      case "w:tbl": lists.flush(); emit(readTable(ctx, el)); break;
      case "w:sdt": case "w:customXml": {
        lists.flush();
        const inner = el.name === "w:sdt" ? kids(kid(el, "w:sdtContent")) : kids(el).filter((c) => c.name !== "w:customXmlPr");
        const before = out.length;
        const children = readBlocks(ctx, inner, false);
        for (const c of children) emit(c);
        const members = out.slice(before).map((n) => String(n.attrs?.id));
        if (topLevel && members.length) ctx.raw.sdt.set(members[0], { raw: raw(ctx.src, el), members });
        break;
      }
      case "w:sectPr": break;
      default:
        // bookmarks, permission ranges, proofing marks, altChunk… between blocks
        if (topLevel) lead.push(raw(ctx.src, el));
    }
  }
  lists.flush();
  if (topLevel && lead.length) ctx.raw.tail += lead.join("");
  return out;
}

function readNotes(pkg: DocxPackage, main: string, type: string): Map<string, string> {
  const out = new Map<string, string>();
  const part = relatedPart(pkg, main, type);
  const xml = part ? pkg.text(part) : null;
  if (!xml) return out;
  const { root } = parseXml(xml);
  for (const n of kids(root)) {
    const t = attr(n, "w:type");
    if (t && t !== "normal") continue;
    out.set(attr(n, "w:id") ?? "", notePlainText(n));
  }
  return out;
}

/** Plain text of a note/comment body: paragraphs joined with newlines; reference marks and field codes skipped. */
export function notePlainText(el: XEl): string {
  const paras = descendants(el, "w:p");
  return paras.map((p) => {
    let s = "";
    let inInstr = 0;
    const walk = (x: XEl) => {
      for (const c of x.children) {
        if (!isEl(c)) continue;
        if (c.name === "w:fldChar") { const t = attr(c, "w:fldCharType"); if (t === "begin") inInstr++; else if (t === "separate" || t === "end") inInstr = Math.max(0, inInstr - (t === "separate" ? 1 : 0)); continue; }
        if (c.name === "w:instrText") continue;
        if (c.name === "w:t" || c.name === "w:delText") { if (!inInstr) s += textContent(c); continue; }
        if (c.name === "w:tab") { s += "\t"; continue; }
        if (c.name === "w:br" || c.name === "w:cr") { s += "\n"; continue; }
        if (c.name === "w:p") continue;
        walk(c);
      }
    };
    walk(p);
    return s;
  }).join("\n").replace(/^\s+/, "").replace(/\s+$/, "");
}

function readComments(ctx: Ctx): DocxImportedComment[] {
  const part = relatedPart(ctx.pkg, ctx.pkg.mainPart, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments");
  const xml = part ? ctx.pkg.text(part) : null;
  if (!xml) return [];
  const ext = relatedPart(ctx.pkg, ctx.pkg.mainPart, "http://schemas.microsoft.com/office/2011/relationships/commentsExtended");
  const done = new Map<string, { done: boolean; parent?: string }>();
  const extXml = ext ? ctx.pkg.text(ext) : null;
  if (extXml) {
    const { root } = parseXml(extXml);
    for (const e of kids(root)) done.set(attr(e, "w15:paraId") ?? "", { done: attr(e, "w15:done") === "1", parent: attr(e, "w15:paraIdParent") });
  }
  const { root } = parseXml(xml);
  const byPara = new Map<string, string>();
  const out: DocxImportedComment[] = [];
  for (const c of kids(root, "w:comment")) {
    const wid = attr(c, "w:id") ?? "";
    const id = commentMarkId(ctx, wid);
    const paras = descendants(c, "w:p");
    const lastPara = paras[paras.length - 1];
    const paraId = lastPara ? attr(lastPara, "w14:paraId") : undefined;
    if (paraId) byPara.set(paraId, id);
    const ex = paraId ? done.get(paraId) : undefined;
    const anchor = ctx.commentAnchors.get(id);
    out.push({ id, sourceId: wid, author: attr(c, "w:author") ?? "Unknown", initials: attr(c, "w:initials"), date: attr(c, "w:date"), text: notePlainText(c), anchor: anchor?.anchor ?? "", quote: anchor?.quote || undefined, resolved: ex?.done || undefined, ...(ex?.parent ? { parentPara: ex.parent } : {}) } as DocxImportedComment & { parentPara?: string });
  }
  for (const c of out as (DocxImportedComment & { parentPara?: string; parentId?: string })[]) {
    if (c.parentPara) { c.parentId = byPara.get(c.parentPara); delete c.parentPara; }
  }
  return out;
}

function headerFooterText(pkg: DocxPackage, main: string, rid: string | undefined): string {
  if (!rid) return "";
  const rel = pkg.rels(main).find((r) => r.id === rid);
  if (!rel) return "";
  const xml = pkg.text(resolveTarget(main, rel.target));
  if (!xml) return "";
  const { root } = parseXml(xml);
  const out: string[] = [];
  for (const p of descendants(root, "w:p")) {
    let s = "";
    let instr = "";
    let state: "none" | "instr" | "result" = "none";
    const walk = (x: XEl) => {
      for (const c of x.children) {
        if (!isEl(c)) continue;
        if (c.name === "w:fldSimple") { s += `{${(attr(c, "w:instr") ?? "").trim().split(/\s+/)[0]}}`; continue; }
        if (c.name === "w:fldChar") { const t = attr(c, "w:fldCharType"); if (t === "begin") { state = "instr"; instr = ""; } else if (t === "separate") { s += `{${instr.trim().split(/\s+/)[0]}}`; state = "result"; } else if (t === "end") { if (state === "instr") s += `{${instr.trim().split(/\s+/)[0]}}`; state = "none"; } continue; }
        if (c.name === "w:instrText") { instr += textContent(c); continue; }
        if (c.name === "w:t") { if (state !== "result") s += textContent(c); continue; }
        if (c.name === "w:tab" || c.name === "w:ptab") { s += "\t"; continue; }
        walk(c);
      }
    };
    walk(p);
    out.push(s);
  }
  return out.join("\n").trim();
}

function readSection(pkg: DocxPackage, main: string, s: XEl, index: number): DocxSection {
  const pgSz = kid(s, "w:pgSz"), pgMar = kid(s, "w:pgMar"), cols = kid(s, "w:cols");
  const w = Number(attr(pgSz, "w:w") ?? 12240), h = Number(attr(pgSz, "w:h") ?? 15840);
  const orient = attr(pgSz, "w:orient") === "landscape" || w > h ? "landscape" : "portrait";
  const n = (x: string | undefined) => (x != null && Number.isFinite(Number(x)) ? Number(x) : undefined);
  const headers: DocxSection["headers"] = {}, footers: DocxSection["footers"] = {};
  for (const r of kids(s, "w:headerReference")) headers[(attr(r, "w:type") ?? "default") as "default"] = headerFooterText(pkg, main, attr(r, "r:id"));
  for (const r of kids(s, "w:footerReference")) footers[(attr(r, "w:type") ?? "default") as "default"] = headerFooterText(pkg, main, attr(r, "r:id"));
  return {
    index, type: wval(kid(s, "w:type")) ?? "nextPage", pageWidth: w, pageHeight: h, orientation: orient,
    margins: { top: n(attr(pgMar, "w:top")) ?? 1440, right: n(attr(pgMar, "w:right")) ?? 1440, bottom: n(attr(pgMar, "w:bottom")) ?? 1440, left: n(attr(pgMar, "w:left")) ?? 1440, header: n(attr(pgMar, "w:header")), footer: n(attr(pgMar, "w:footer")), gutter: n(attr(pgMar, "w:gutter")) },
    columns: { num: n(attr(cols, "w:num")) ?? 1, space: n(attr(cols, "w:space")) },
    titlePage: Boolean(kid(s, "w:titlePg")) && (onOff(kid(s, "w:titlePg")) ?? false), headers, footers,
  };
}

export function settingsFromSection(sec: DocxSection | undefined, defaults: { font?: string; sizePt?: number; line?: number }, hasPageNumbers: boolean): DocSettings {
  const s: DocSettings = { ...DEFAULT_SETTINGS };
  if (sec) {
    const wIn = Math.min(sec.pageWidth, sec.pageHeight) / 1440, hIn = Math.max(sec.pageWidth, sec.pageHeight) / 1440;
    const size = (Object.entries(PAGE_SIZES) as [PageSizeId, { width: number; height: number }][]).find(([, v]) => Math.abs(v.width - wIn) < 0.06 && Math.abs(v.height - hIn) < 0.06);
    s.pageSize = size ? size[0] : "letter";
    s.orientation = sec.orientation;
    const m = sec.margins;
    let best: MarginPresetId = "normal"; let bestD = Infinity;
    for (const [k, v] of Object.entries(MARGIN_PRESETS) as [MarginPresetId, { top: number; right: number; bottom: number; left: number }][]) {
      const d = Math.abs(v.top - m.top / 1440) + Math.abs(v.right - m.right / 1440) + Math.abs(v.bottom - m.bottom / 1440) + Math.abs(v.left - m.left / 1440);
      if (d < bestD) { bestD = d; best = k; }
    }
    s.margins = best;
  }
  if (defaults.font) s.font = /calibri|arial|helvetica|segoe|aptos|verdana|tahoma|inter|sans/i.test(defaults.font) ? "sans" : "serif";
  if (defaults.sizePt) s.fontSize = defaults.sizePt;
  if (defaults.line) s.lineSpacing = Math.round(defaults.line * 100) / 100;
  s.pageNumbers = hasPageNumbers;
  return s;
}

function maxAnnotationId(xml: string): number {
  let max = 0;
  const re = /<w:(?:ins|del|moveFrom|moveTo|bookmarkStart|bookmarkEnd|commentRangeStart|commentRangeEnd|commentReference|rPrChange|pPrChange|tblPrChange|trPrChange|tcPrChange|sectPrChange|numberingChange|footnoteReference|endnoteReference)\b[^>]*?\bw:id="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) max = Math.max(max, Number(m[1]));
  return max;
}

export async function readDocx(bytes: Uint8Array, opts: ReadOptions = {}): Promise<ReadResult> {
  const pkg = await loadPackage(bytes);
  const sha = sha256Hex(bytes);
  const src = pkg.text(pkg.mainPart)!;
  const { root } = parseXml(src);
  const body = kid(root, "w:body");
  if (!body) throw new Error("document.xml has no w:body");
  const stylesPart = relatedPart(pkg, pkg.mainPart, REL.styles);
  const numberingPart = relatedPart(pkg, pkg.mainPart, REL.numbering);
  const st = readStyles(stylesPart ? pkg.text(stylesPart) : null);
  const numDefs = readNumbering(numberingPart ? pkg.text(numberingPart) : null);
  const hash6 = sha.slice(0, 6);
  let counter = 0;
  const rawMap: RawMap = { blocks: new Map(), listContext: new Map(), sdt: new Map(), lead: new Map(), tail: "", finalSectPr: null, docOpen: src.slice(0, body.innerStart), docClose: src.slice(body.innerEnd), maxAnnotationId: maxAnnotationId(src) };
  const ctx: Ctx = {
    pkg, src, part: pkg.mainPart, styles: st.map, defaultPara: st.defaultPara, numbering: new NumberingState(numDefs.abstracts, numDefs.nums), numDefs,
    id: () => `w${hash6}${(counter++).toString(36)}`, hash6, raw: rawMap, opts,
    footnoteText: readNotes(pkg, pkg.mainPart, REL.footnotes), endnoteText: readNotes(pkg, pkg.mainPart, REL.endnotes),
    openComments: new Set(), commentAnchors: new Map(), fieldStack: [], bookmarks: [], fields: [], images: 0, tracked: new Set(), sections: [], warnings: [], imageCache: new Map(),
  };
  const bodyEls = kids(body);
  const finalSect = bodyEls.length && bodyEls[bodyEls.length - 1].name === "w:sectPr" ? bodyEls[bodyEls.length - 1] : null;
  const blocks = readBlocks(ctx, finalSect ? bodyEls.slice(0, -1) : bodyEls, true);
  if (finalSect) { rawMap.finalSectPr = raw(src, finalSect); rawMap.finalSectPrCanon = serializeEl(finalSect); ctx.sections.push(finalSect); }
  const doc: PMNode = { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph", attrs: { id: ctx.id() } }] };
  const sections = ctx.sections.map((s, i) => readSection(pkg, pkg.mainPart, s, i));
  const hasPageNumbers = sections.some((s) => [...Object.values(s.footers), ...Object.values(s.headers)].some((t) => /\{PAGE\}/.test(t ?? "")));
  // The editor's page setup is the final section's (as for documents written by the app); earlier sections keep theirs.
  const settings = settingsFromSection(sections[sections.length - 1], st.docDefaults, hasPageNumbers);
  const comments = readComments(ctx);
  const styles: DocxStyleInfo[] = Array.from(st.map.values()).map((s) => ({ id: s.id, name: s.name, type: (["paragraph", "character", "table", "numbering"].includes(s.type) ? s.type : "paragraph") as DocxStyleInfo["type"], basedOn: s.basedOn, outlineLevel: s.outline, numId: s.numId, isDefault: s.isDefault || undefined }));
  const numbering: DocxNumberingInfo[] = Array.from(numDefs.nums.values()).map((n) => ({ numId: n.numId, abstractId: n.abstractId, levels: Array.from({ length: 9 }, (_, i) => ctx.numbering.level(n.numId, i)).filter((l): l is LevelDef => Boolean(l)).map((l) => ({ ilvl: l.ilvl, format: l.fmt, text: l.text, start: l.start })) }));
  const meta: DocxMeta = {
    version: 1, sha256: sha, mainPart: pkg.mainPart, sections, styles, numbering, comments,
    footnotes: ctx.footnoteText.size, endnotes: ctx.endnoteText.size, bookmarks: ctx.bookmarks.filter((b) => b !== "_GoBack"), fields: Array.from(new Set(ctx.fields.filter(Boolean))), images: ctx.images, trackedChanges: ctx.tracked.size,
    importedSettings: settings as unknown as Record<string, unknown>, warnings: ctx.warnings,
  };
  let title: string | null = null;
  const core = pkg.text("docProps/core.xml");
  if (core) { const m = /<dc:title>([^<]{1,200})<\/dc:title>/.exec(core); if (m) title = m[1].trim() || null; }
  return { doc, meta, settings, title, raw: rawMap, pkg };
}
