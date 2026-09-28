/**
 * Content-stream level true redaction (constitution §41: redaction must remove
 * the content, not cover it).
 *
 * A small PDF content-stream tokenizer and graphics/text-state interpreter that
 * locates every glyph drawn by Tj / TJ / ' / " (including inside Form XObjects)
 * in page user space, and rewrites the text-showing operators so glyphs whose
 * box falls inside a redaction region are REMOVED from the stream. Removed
 * glyphs are replaced by TJ kerning adjustments of exactly the same advance,
 * so the remaining text on the line does not move. Operators outside the
 * regions are copied byte-for-byte (fonts, vector art, images and marked
 * content are untouched).
 *
 * When editing is not provably safe — an image or inline image under a region,
 * a font whose glyph widths cannot be measured, vertical writing, nested form
 * XObjects with hits, an unparseable stream — the page is reported `unsafe`
 * with a reason and the caller must fall back to rasterizing the page (never
 * to leaving the content in place).
 */
import { Font, Encodings, type EncodingType } from "@pdf-lib/standard-fonts";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream, PDFString, decodePDFRawStream, type PDFPage } from "pdf-lib";
import type { PdfRect } from "./model";

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export type Tok =
  | { t: "num"; v: number; s: number; e: number }
  | { t: "str"; v: Uint8Array; s: number; e: number }
  | { t: "name"; v: string; s: number; e: number }
  | { t: "arr"; v: Tok[]; s: number; e: number }
  | { t: "dict"; v: Tok[]; s: number; e: number }
  | { t: "kw"; v: string; s: number; e: number };

export interface Op { op: string; args: Tok[]; s: number; e: number }

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

export class ContentParseError extends Error {}

/** Tokenize a decoded content stream into operators with their operands and byte spans. */
export function parseContent(b: Uint8Array): Op[] {
  let i = 0;
  const n = b.length;
  const ops: Op[] = [];

  const skipWs = () => {
    while (i < n) {
      const c = b[i];
      if (WS.has(c)) { i++; continue; }
      if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // % comment
      break;
    }
  };

  const readRegular = () => { const s = i; while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++; return String.fromCharCode(...b.subarray(s, i)); };

  const parseLiteralString = (): Uint8Array => {
    // b[i] === '('
    i++;
    let depth = 1;
    const out: number[] = [];
    while (i < n) {
      const c = b[i++];
      if (c === 92) { // backslash
        if (i >= n) break;
        const d = b[i++];
        switch (d) {
          case 110: out.push(10); break; // n
          case 114: out.push(13); break; // r
          case 116: out.push(9); break; // t
          case 98: out.push(8); break; // b
          case 102: out.push(12); break; // f
          case 40: case 41: case 92: out.push(d); break;
          case 13: if (b[i] === 10) i++; break; // line continuation
          case 10: break;
          default:
            if (d >= 48 && d <= 55) {
              let v = d - 48;
              for (let k = 0; k < 2 && i < n && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48);
              out.push(v & 255);
            } else out.push(d);
        }
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) { depth--; if (depth === 0) return Uint8Array.from(out); }
      out.push(c);
    }
    throw new ContentParseError("Unterminated string");
  };

  const parseHexString = (): Uint8Array => {
    i++; // '<'
    const digits: number[] = [];
    while (i < n && b[i] !== 62) {
      const c = b[i++];
      if (WS.has(c)) continue;
      const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v < 0) throw new ContentParseError("Bad hex string");
      digits.push(v);
    }
    if (b[i] !== 62) throw new ContentParseError("Unterminated hex string");
    i++;
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = digits[2 * k] * 16 + digits[2 * k + 1];
    return out;
  };

  const parseObject = (): Tok | { t: "op"; v: string; s: number; e: number } | { t: "close"; v: string; s: number; e: number } | null => {
    skipWs();
    if (i >= n) return null;
    const s = i;
    const c = b[i];
    if (c === 40) { const v = parseLiteralString(); return { t: "str", v, s, e: i }; }
    if (c === 60) {
      if (b[i + 1] === 60) {
        i += 2;
        const items: Tok[] = [];
        for (;;) {
          skipWs();
          if (i >= n) throw new ContentParseError("Unterminated dict");
          if (b[i] === 62 && b[i + 1] === 62) { i += 2; break; }
          const o = parseObject();
          if (!o || o.t === "op" || o.t === "close") throw new ContentParseError("Bad dict");
          items.push(o);
        }
        return { t: "dict", v: items, s, e: i };
      }
      const v = parseHexString();
      return { t: "str", v, s, e: i };
    }
    if (c === 62 && b[i + 1] === 62) { i += 2; return { t: "close", v: ">>", s, e: i }; }
    if (c === 91) {
      i++;
      const items: Tok[] = [];
      for (;;) {
        skipWs();
        if (i >= n) throw new ContentParseError("Unterminated array");
        if (b[i] === 93) { i++; break; }
        const o = parseObject();
        if (!o || o.t === "close") throw new ContentParseError("Bad array");
        if (o.t === "op") { items.push({ t: "kw", v: o.v, s: o.s, e: o.e }); continue; }
        items.push(o);
      }
      return { t: "arr", v: items, s, e: i };
    }
    if (c === 93) { i++; return { t: "close", v: "]", s, e: i }; }
    if (c === 47) {
      i++;
      const raw = readRegular();
      const v = raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      return { t: "name", v, s, e: i };
    }
    if (c === 123 || c === 125) { i++; return { t: "op", v: String.fromCharCode(c), s, e: i }; }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      const raw = readRegular();
      const v = Number(raw);
      if (Number.isFinite(v)) return { t: "num", v, s, e: i };
      return { t: "op", v: raw, s, e: i };
    }
    if (c === 41) throw new ContentParseError("Unbalanced )");
    const raw = readRegular();
    if (!raw) { i++; throw new ContentParseError(`Unexpected byte ${c}`); }
    if (raw === "true" || raw === "false" || raw === "null") return { t: "kw", v: raw, s, e: i };
    return { t: "op", v: raw, s, e: i };
  };

  let args: Tok[] = [];
  while (i < n) {
    const o = parseObject();
    if (!o) break;
    if (o.t === "close") throw new ContentParseError(`Unexpected ${o.v}`);
    if (o.t !== "op") { args.push(o); continue; }
    if (o.v === "BI") {
      // Inline image: key/value pairs until ID, then binary data until whitespace EI whitespace.
      const dict: Tok[] = [];
      for (;;) {
        const x = parseObject();
        if (!x) throw new ContentParseError("Unterminated inline image");
        if (x.t === "op" && x.v === "ID") break;
        if (x.t === "op" || x.t === "close") throw new ContentParseError("Bad inline image dict");
        dict.push(x);
      }
      i++; // single whitespace after ID
      let end = -1;
      for (let k = i; k < n - 1; k++) {
        if (b[k] === 69 && b[k + 1] === 73 && (k === 0 || WS.has(b[k - 1])) && (k + 2 >= n || WS.has(b[k + 2]) || DELIM.has(b[k + 2]))) { end = k; break; }
      }
      if (end < 0) throw new ContentParseError("Inline image without EI");
      i = end + 2;
      ops.push({ op: "BI", args: dict, s: args[0]?.s ?? o.s, e: i });
      args = [];
      continue;
    }
    ops.push({ op: o.v, args, s: args[0]?.s ?? o.s, e: o.e });
    args = [];
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m1 × m2 in PDF row-vector convention (apply m1 first, then m2). */
export function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}
function apply(m: Mat, x: number, y: number): [number, number] { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

/** Axis-aligned bounds of a rectangle in some space transformed by m. */
export function boxOf(m: Mat, x1: number, y1: number, x2: number, y2: number): PdfRect {
  const pts = [apply(m, x1, y1), apply(m, x2, y1), apply(m, x1, y2), apply(m, x2, y2)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export function intersects(a: PdfRect, b: PdfRect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && a.x + a.w > b.x - pad && a.y < b.y + b.h + pad && a.y + a.h > b.y - pad;
}

function overlapArea(a: PdfRect, b: PdfRect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** A glyph is redacted when its center lies in a region (0.5pt tolerance) or at least half of its box does. */
export function glyphHit(glyph: PdfRect, regions: PdfRect[]): boolean {
  const cx = glyph.x + glyph.w / 2, cy = glyph.y + glyph.h / 2;
  for (const r of regions) {
    if (cx >= r.x - 0.5 && cx <= r.x + r.w + 0.5 && cy >= r.y - 0.5 && cy <= r.y + r.h + 0.5) return true;
    const area = glyph.w * glyph.h;
    if (area > 0 && overlapArea(glyph, r) >= area * 0.5) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

interface FontInfo {
  twoByte: boolean;
  /** Width in text space units (em) of a character code, or undefined when unknown. */
  width: (code: number) => number | undefined;
  asc: number;
  desc: number;
  /** Set when glyph positions cannot be computed safely. */
  unsafe?: string;
}

const STD_ALIASES: Record<string, string> = {
  Arial: "Helvetica", "Arial,Bold": "Helvetica-Bold", "Arial,Italic": "Helvetica-Oblique", "Arial,BoldItalic": "Helvetica-BoldOblique",
  ArialMT: "Helvetica", "Arial-BoldMT": "Helvetica-Bold", "Arial-ItalicMT": "Helvetica-Oblique", "Arial-BoldItalicMT": "Helvetica-BoldOblique",
  TimesNewRoman: "Times-Roman", "TimesNewRoman,Bold": "Times-Bold", "TimesNewRoman,Italic": "Times-Italic", "TimesNewRoman,BoldItalic": "Times-BoldItalic",
  TimesNewRomanPSMT: "Times-Roman", "TimesNewRomanPS-BoldMT": "Times-Bold", "TimesNewRomanPS-ItalicMT": "Times-Italic", "TimesNewRomanPS-BoldItalicMT": "Times-BoldItalic",
  CourierNew: "Courier", "CourierNew,Bold": "Courier-Bold", CourierNewPSMT: "Courier", "CourierNewPS-BoldMT": "Courier-Bold",
};
const STD_NAMES = new Set(["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique", "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Symbol", "ZapfDingbats"]);

const encodingCache = new Map<string, Map<number, string>>();
function codeToName(enc: EncodingType): Map<number, string> {
  const hit = encodingCache.get(enc.name);
  if (hit) return hit;
  const map = new Map<number, string>();
  for (const cp of enc.supportedCodePoints) { const { code, name } = enc.encodeUnicodeCodePoint(cp); if (!map.has(code)) map.set(code, name); }
  encodingCache.set(enc.name, map);
  return map;
}

function num(o: PDFObject | undefined): number | undefined { return o instanceof PDFNumber ? o.asNumber() : undefined; }

function lookup(doc: PDFDocument, o: PDFObject | undefined): PDFObject | undefined { return o instanceof PDFRef ? doc.context.lookup(o) : o; }

function nameOf(o: PDFObject | undefined): string | undefined { return o instanceof PDFName ? o.decodeText() : undefined; }

function dictGet(doc: PDFDocument, d: PDFDict | undefined, key: string): PDFObject | undefined { return d ? lookup(doc, d.get(PDFName.of(key))) : undefined; }

function numbersOf(doc: PDFDocument, o: PDFObject | undefined): number[] | undefined {
  const a = lookup(doc, o);
  if (!(a instanceof PDFArray)) return undefined;
  return a.asArray().map((x) => num(lookup(doc, x)) ?? 0);
}

function descriptorMetrics(doc: PDFDocument, fd: PDFDict | undefined): { asc: number; desc: number; missing?: number } {
  let asc = 0.8, desc = -0.22;
  const a = num(dictGet(doc, fd, "Ascent")), d = num(dictGet(doc, fd, "Descent"));
  if (a !== undefined && a / 1000 > 0.4 && a / 1000 < 1.6) asc = a / 1000;
  if (d !== undefined && d / 1000 < 0 && d / 1000 > -0.8) desc = d / 1000;
  const mw = num(dictGet(doc, fd, "MissingWidth"));
  return { asc, desc, missing: mw !== undefined ? mw / 1000 : undefined };
}

function buildFont(doc: PDFDocument, fontObj: PDFObject | undefined): FontInfo {
  const font = lookup(doc, fontObj);
  if (!(font instanceof PDFDict)) return { twoByte: false, width: () => undefined, asc: 0.8, desc: -0.22, unsafe: "font resource missing" };
  const subtype = nameOf(dictGet(doc, font, "Subtype"));
  if (subtype === "Type0") {
    const enc = nameOf(dictGet(doc, font, "Encoding"));
    const descs = dictGet(doc, font, "DescendantFonts");
    const cid = descs instanceof PDFArray ? lookup(doc, descs.get(0)) : undefined;
    const cidDict = cid instanceof PDFDict ? cid : undefined;
    const m = descriptorMetrics(doc, dictGet(doc, cidDict, "FontDescriptor") as PDFDict | undefined);
    if (enc !== "Identity-H") return { twoByte: true, width: () => undefined, asc: m.asc, desc: m.desc, unsafe: enc === "Identity-V" ? "vertical writing" : `CMap ${enc ?? "embedded"} not supported` };
    const dw = (num(dictGet(doc, cidDict, "DW")) ?? 1000) / 1000;
    const widths = new Map<number, number>();
    const w = dictGet(doc, cidDict, "W");
    if (w instanceof PDFArray) {
      const items = w.asArray().map((x) => lookup(doc, x));
      for (let k = 0; k < items.length;) {
        const first = num(items[k]);
        const next = items[k + 1];
        if (first === undefined) break;
        if (next instanceof PDFArray) { next.asArray().forEach((x, j) => widths.set(first + j, (num(lookup(doc, x)) ?? 0) / 1000)); k += 2; }
        else { const last = num(next), wv = num(items[k + 2]); if (last === undefined || wv === undefined) break; for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, wv / 1000); k += 3; }
      }
    }
    return { twoByte: true, width: (c) => widths.get(c) ?? dw, asc: m.asc, desc: m.desc };
  }
  const fd = dictGet(doc, font, "FontDescriptor") as PDFDict | undefined;
  const m = descriptorMetrics(doc, fd instanceof PDFDict ? fd : undefined);
  const widths = numbersOf(doc, font.get(PDFName.of("Widths")));
  const firstChar = num(dictGet(doc, font, "FirstChar")) ?? 0;
  let scale = 1 / 1000;
  if (subtype === "Type3") {
    const fm = numbersOf(doc, font.get(PDFName.of("FontMatrix")));
    if (!fm || fm.length !== 6 || Math.abs(fm[1]) > 1e-9) return { twoByte: false, width: () => undefined, asc: m.asc, desc: m.desc, unsafe: "Type3 font matrix" };
    scale = fm[0];
  }
  // Standard-14 metrics when the dictionary carries no widths (pdf-lib and many producers omit them).
  let std: Font | null = null;
  let stdNames: Map<number, string> | null = null;
  const base = (nameOf(dictGet(doc, font, "BaseFont")) ?? "").replace(/^[A-Z]{6}\+/, "");
  const stdName = STD_NAMES.has(base) ? base : STD_ALIASES[base];
  if (stdName && subtype !== "Type3") {
    try {
      std = Font.load(stdName as Parameters<typeof Font.load>[0]);
      const encObj = dictGet(doc, font, "Encoding");
      const baseEnc = stdName === "Symbol" ? Encodings.Symbol : stdName === "ZapfDingbats" ? Encodings.ZapfDingbats : Encodings.WinAnsi;
      stdNames = new Map(codeToName(baseEnc));
      const diffs = encObj instanceof PDFDict ? dictGet(doc, encObj, "Differences") : undefined;
      if (diffs instanceof PDFArray) {
        let code = 0;
        for (const x of diffs.asArray()) { const v = lookup(doc, x); if (v instanceof PDFNumber) code = v.asNumber(); else if (v instanceof PDFName) { stdNames.set(code, v.decodeText()); code++; } }
      }
    } catch { std = null; }
  }
  const width = (c: number): number | undefined => {
    if (widths && c >= firstChar && c < firstChar + widths.length) {
      const w = widths[c - firstChar];
      if (w || !std) return w * scale;
    }
    if (std && stdNames) { const g = stdNames.get(c); const w = g ? std.getWidthOfGlyph(g) : undefined; if (typeof w === "number") return w / 1000; }
    if (m.missing !== undefined) return m.missing;
    return undefined;
  };
  return { twoByte: false, width, asc: m.asc, desc: m.desc };
}

// ---------------------------------------------------------------------------
// Interpreter + rewriter
// ---------------------------------------------------------------------------

export interface RedactStreamResult {
  /** New content bytes, or null when nothing changed. */
  bytes: Uint8Array | null;
  removedGlyphs: number;
  /** Non-null when the stream cannot be edited safely. */
  unsafe: string | null;
  /** Form XObjects rewritten for this page: resource name → new stream ref. */
  forms: { name: string; ref: PDFRef }[];
}

interface TextState { fontName: string | null; font: FontInfo | null; fs: number; tc: number; tw: number; th: number; tl: number; rise: number }
interface GState { ctm: Mat; text: TextState }

function hex(bytes: Uint8Array) { let s = "<"; for (const x of bytes) s += x.toString(16).padStart(2, "0"); return `${s}>`; }
function fmt(v: number) { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? "0" : String(r); }

const enc = new TextEncoder();

function splice(src: Uint8Array, edits: { s: number; e: number; text: string }[]): Uint8Array {
  const sorted = [...edits].sort((a, b) => a.s - b.s);
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const ed of sorted) {
    if (ed.s < at) continue; // overlapping edit (should not happen); keep the first
    parts.push(src.subarray(at, ed.s));
    parts.push(enc.encode(ed.text));
    at = ed.e;
  }
  parts.push(src.subarray(at));
  const total = parts.reduce((k, p) => k + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

interface RunCtx {
  doc: PDFDocument;
  regions: PdfRect[];
  depth: number;
  /** Counter for new resource names. */
  nameSeq: { n: number };
}

/**
 * Redact one content stream (page contents or a form XObject's contents).
 * `baseCtm` maps the stream's space into page user space.
 */
function redactStream(ctx: RunCtx, content: Uint8Array, resources: PDFDict | undefined, baseCtm: Mat): RedactStreamResult {
  const { doc, regions } = ctx;
  let ops: Op[];
  try { ops = parseContent(content); } catch (e) { return { bytes: null, removedGlyphs: 0, unsafe: `unparseable content stream (${(e as Error).message})`, forms: [] }; }

  const fonts = new Map<string, FontInfo>();
  const fontRes = dictGet(doc, resources, "Font");
  const xobjRes = dictGet(doc, resources, "XObject");
  const fontFor = (name: string): FontInfo => {
    let f = fonts.get(name);
    if (!f) { f = buildFont(doc, fontRes instanceof PDFDict ? fontRes.get(PDFName.of(name)) : undefined); fonts.set(name, f); }
    return f;
  };

  const stack: GState[] = [];
  let gs: GState = { ctm: baseCtm, text: { fontName: null, font: null, fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 } };
  let tm: Mat = IDENTITY, tlm: Mat = IDENTITY;
  const edits: { s: number; e: number; text: string }[] = [];
  const forms: { name: string; ref: PDFRef }[] = [];
  let removed = 0;
  // Marked-content stack: index of the BDC op and whether a glyph inside was removed.
  const mc: { op: Op | null; touched: boolean }[] = [];
  const touchedMc = new Set<Op>();

  const anyRegion = (box: PdfRect) => regions.some((r) => intersects(box, r, 0.5));

  /** Show a string; returns the TJ elements after removal (or null when nothing was removed). */
  const showString = (bytes: Uint8Array, out: (string | number)[]): { removed: number; unsafe?: string } => {
    const st = gs.text;
    const f = st.font;
    if (!f) return { removed: 0, unsafe: "text shown without a font" };
    const trmBase = (): Mat => mul([st.fs * st.th, 0, 0, st.fs, 0, st.rise], mul(tm, gs.ctm));
    const step = f.twoByte ? 2 : 1;
    let kept: number[] = [];
    let removedHere = 0;
    const flushKept = () => { if (kept.length) { out.push(hex(Uint8Array.from(kept))); kept = []; } };
    for (let k = 0; k + step <= bytes.length; k += step) {
      const code = step === 2 ? (bytes[k] << 8) | (bytes[k + 1] ?? 0) : bytes[k];
      const w0 = f.width(code);
      const isSpace = step === 1 && code === 32;
      if (w0 === undefined || f.unsafe) {
        // Unknown advance: only safe when this whole line band is far from every region.
        const trm = trmBase();
        const band = boxOf(trm, -0.5, f.desc - 0.2, 60, f.asc + 0.2);
        if (anyRegion(band)) return { removed: 0, unsafe: f.unsafe ? `font ${st.fontName}: ${f.unsafe}` : `font ${st.fontName}: unknown glyph width for code ${code}` };
        // far away: advance approximately (the rest of this string is also far away)
        kept.push(...bytes.subarray(k, k + step));
        tm = mul([1, 0, 0, 1, (0.5 * st.fs + st.tc + (isSpace ? st.tw : 0)) * st.th, 0], tm);
        continue;
      }
      const trm = trmBase();
      const box = boxOf(trm, 0, f.desc, w0, f.asc);
      const adv = (w0 * st.fs + st.tc + (isSpace ? st.tw : 0)) * st.th;
      if (box.w > 0 && box.h > 0 && glyphHit(box, regions)) {
        if (!st.fs) return { removed: 0, unsafe: "zero font size" };
        flushKept();
        // Replace the glyph by a kerning adjustment of the same advance: tx = -n/1000 · fs · th.
        const adj = -(adv * 1000) / (st.fs * st.th);
        const last = out[out.length - 1];
        if (typeof last === "number") out[out.length - 1] = last + adj; else out.push(adj);
        removedHere++;
      } else kept.push(...bytes.subarray(k, k + step));
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    }
    flushKept();
    return { removed: removedHere };
  };

  const serializeTJ = (els: (string | number)[]) => `[${els.map((x) => (typeof x === "number" ? fmt(x) : x)).join(" ")}] TJ`;

  const handleText = (op: Op, prefix: string, strings: Tok[] | Tok) : string | null => {
    // strings: a single string token (Tj, ', ") or the TJ array token.
    const els: (string | number)[] = [];
    let removedHere = 0;
    const items = Array.isArray(strings) ? strings : [strings];
    for (const it of items) {
      if (it.t === "str") {
        const r = showString(it.v, els);
        if (r.unsafe) throw new UnsafeError(r.unsafe);
        removedHere += r.removed;
      } else if (it.t === "num") {
        const st = gs.text;
        tm = mul([1, 0, 0, 1, (-it.v / 1000) * st.fs * st.th, 0], tm);
        const last = els[els.length - 1];
        if (typeof last === "number") els[els.length - 1] = last + it.v; else els.push(it.v);
      }
    }
    if (!removedHere) return null;
    removed += removedHere;
    for (const m of mc) { m.touched = true; if (m.op) touchedMc.add(m.op); }
    void op;
    return `${prefix}${serializeTJ(els)}`;
  };

  try {
    for (const op of ops) {
      const a = op.args;
      const nums = () => a.map((x) => (x.t === "num" ? x.v : 0));
      switch (op.op) {
        case "q": stack.push({ ctm: gs.ctm, text: { ...gs.text } }); break;
        case "Q": { const p = stack.pop(); if (p) gs = p; break; }
        case "cm": { const v = nums(); if (v.length === 6) gs = { ...gs, ctm: mul(v as Mat, gs.ctm) }; break; }
        case "BT": tm = IDENTITY; tlm = IDENTITY; break;
        case "ET": break;
        case "Tf": {
          const name = a[0]?.t === "name" ? a[0].v : null;
          const size = a[1]?.t === "num" ? a[1].v : 0;
          gs = { ...gs, text: { ...gs.text, fontName: name, font: name ? fontFor(name) : null, fs: size } };
          break;
        }
        case "Tc": gs.text = { ...gs.text, tc: nums()[0] ?? 0 }; break;
        case "Tw": gs.text = { ...gs.text, tw: nums()[0] ?? 0 }; break;
        case "Tz": gs.text = { ...gs.text, th: (nums()[0] ?? 100) / 100 }; break;
        case "TL": gs.text = { ...gs.text, tl: nums()[0] ?? 0 }; break;
        case "Ts": gs.text = { ...gs.text, rise: nums()[0] ?? 0 }; break;
        case "Td": { const [tx, ty] = nums(); tlm = mul([1, 0, 0, 1, tx ?? 0, ty ?? 0], tlm); tm = tlm; break; }
        case "TD": { const [tx, ty] = nums(); gs.text = { ...gs.text, tl: -(ty ?? 0) }; tlm = mul([1, 0, 0, 1, tx ?? 0, ty ?? 0], tlm); tm = tlm; break; }
        case "Tm": { const v = nums(); if (v.length === 6) { tlm = v as Mat; tm = tlm; } break; }
        case "T*": tlm = mul([1, 0, 0, 1, 0, -gs.text.tl], tlm); tm = tlm; break;
        case "Tj": { if (a[0]?.t === "str") { const r = handleText(op, "", a[0]); if (r) edits.push({ s: op.s, e: op.e, text: r }); } break; }
        case "TJ": { if (a[0]?.t === "arr") { const r = handleText(op, "", a[0].v); if (r) edits.push({ s: op.s, e: op.e, text: r }); } break; }
        case "'": {
          tlm = mul([1, 0, 0, 1, 0, -gs.text.tl], tlm); tm = tlm;
          if (a[0]?.t === "str") { const r = handleText(op, "T* ", a[0]); if (r) edits.push({ s: op.s, e: op.e, text: r }); }
          break;
        }
        case "\"": {
          const aw = a[0]?.t === "num" ? a[0].v : 0, ac = a[1]?.t === "num" ? a[1].v : 0;
          gs.text = { ...gs.text, tw: aw, tc: ac };
          tlm = mul([1, 0, 0, 1, 0, -gs.text.tl], tlm); tm = tlm;
          if (a[2]?.t === "str") { const r = handleText(op, `${fmt(aw)} Tw ${fmt(ac)} Tc T* `, a[2]); if (r) edits.push({ s: op.s, e: op.e, text: r }); }
          break;
        }
        case "BMC": mc.push({ op: null, touched: false }); break;
        case "BDC": mc.push({ op, touched: false }); break;
        case "EMC": mc.pop(); break;
        case "BI": {
          // Inline images occupy the unit square of the CTM.
          if (anyRegion(boxOf(gs.ctm, 0, 0, 1, 1))) throw new UnsafeError("inline image under a redaction region");
          break;
        }
        case "Do": {
          const name = a[0]?.t === "name" ? a[0].v : null;
          if (!name || !(xobjRes instanceof PDFDict)) break;
          const ref = xobjRes.get(PDFName.of(name));
          const xo = lookup(doc, ref);
          if (!(xo instanceof PDFStream)) break;
          const sub = nameOf(xo.dict.lookup(PDFName.of("Subtype")));
          if (sub === "Image") {
            if (anyRegion(boxOf(gs.ctm, 0, 0, 1, 1))) throw new UnsafeError(`image ${name} under a redaction region`);
            break;
          }
          if (sub !== "Form") break;
          const matrix = (numbersOf(doc, xo.dict.get(PDFName.of("Matrix"))) ?? [...IDENTITY]) as Mat;
          const bbox = numbersOf(doc, xo.dict.get(PDFName.of("BBox"))) ?? [0, 0, 0, 0];
          const fctm = mul(matrix, gs.ctm);
          if (!anyRegion(boxOf(fctm, bbox[0], bbox[1], bbox[2], bbox[3]))) break;
          if (ctx.depth >= 2) throw new UnsafeError(`nested form XObject ${name} under a redaction region`);
          const fres = xo.dict.lookup(PDFName.of("Resources"));
          const inner = redactStream({ ...ctx, depth: ctx.depth + 1 }, decodeStream(xo), fres instanceof PDFDict ? fres : resources, fctm);
          if (inner.unsafe) throw new UnsafeError(`form ${name}: ${inner.unsafe}`);
          if (inner.forms.length) throw new UnsafeError(`nested form XObject inside ${name} needs redaction`);
          if (inner.bytes) {
            // Copy the form (it may be shared with other pages) and point this page at the copy.
            const dict = xo.dict.clone(doc.context);
            for (const k of ["Length", "Filter", "DecodeParms", "DL"]) dict.delete(PDFName.of(k));
            const copy = doc.context.flateStream(inner.bytes, {});
            for (const [k, v] of dict.entries()) copy.dict.set(k, v);
            const newRef = doc.context.register(copy);
            const newName = `LCRedact${++ctx.nameSeq.n}`;
            forms.push({ name: newName, ref: newRef });
            edits.push({ s: op.s, e: op.e, text: `/${newName} Do` });
            removed += inner.removedGlyphs;
          }
          break;
        }
        default: break;
      }
    }
  } catch (e) {
    if (e instanceof UnsafeError) return { bytes: null, removedGlyphs: 0, unsafe: e.message, forms: [] };
    throw e;
  }

  // Strip replacement text (ActualText/Alt/E) from marked-content sections whose glyphs were removed.
  for (const op of touchedMc) {
    const props = op.args[1];
    if (props?.t !== "dict") continue;
    const items = props.v;
    for (let k = 0; k + 1 < items.length; k += 2) {
      const key = items[k];
      if (key.t === "name" && (key.v === "ActualText" || key.v === "Alt" || key.v === "E")) edits.push({ s: key.s, e: items[k + 1].e, text: "" });
    }
  }

  if (!edits.length) return { bytes: null, removedGlyphs: 0, unsafe: null, forms };
  return { bytes: splice(content, edits), removedGlyphs: removed, unsafe: null, forms };
}

class UnsafeError extends Error {}

function decodeStream(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  const anyS = s as unknown as { getUnencodedContents?: () => Uint8Array; getContents: () => Uint8Array };
  return anyS.getUnencodedContents ? anyS.getUnencodedContents() : anyS.getContents();
}

/** Decoded, concatenated page content (the streams of a /Contents array are one logical stream). */
export function pageContentBytes(doc: PDFDocument, page: PDFPage): Uint8Array {
  const c = page.node.get(PDFName.of("Contents"));
  const obj = lookup(doc, c);
  const streams: PDFStream[] = [];
  if (obj instanceof PDFStream) streams.push(obj);
  else if (obj instanceof PDFArray) for (const x of obj.asArray()) { const s = lookup(doc, x); if (s instanceof PDFStream) streams.push(s); }
  const parts = streams.map(decodeStream);
  const total = parts.reduce((k, p) => k + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

export interface PageRedactionResult { removedGlyphs: number; unsafe: string | null; changed: boolean }

/**
 * Remove every glyph inside `regions` (page user space) from the page's
 * content (and from form XObjects drawn over the regions). On success the page
 * gets a single new content stream; the old streams become unreferenced and
 * are dropped when the document is pruned before saving.
 */
export function redactPageContent(doc: PDFDocument, page: PDFPage, regions: PdfRect[]): PageRedactionResult {
  if (!regions.length) return { removedGlyphs: 0, unsafe: null, changed: false };
  let content: Uint8Array;
  try { content = pageContentBytes(doc, page); } catch (e) { return { removedGlyphs: 0, unsafe: `content stream could not be decoded (${(e as Error).message})`, changed: false }; }
  const resRaw = page.node.Resources();
  const resources = resRaw instanceof PDFDict ? resRaw : undefined;
  const r = redactStream({ doc, regions, depth: 0, nameSeq: { n: 0 } }, content, resources, IDENTITY);
  if (r.unsafe) return { removedGlyphs: 0, unsafe: r.unsafe, changed: false };
  if (!r.bytes) return { removedGlyphs: 0, unsafe: null, changed: false };
  if (r.forms.length) {
    // Page-local resources so renamed form copies never leak into pages that share the dictionary.
    const own = (resources ?? doc.context.obj({})).clone(doc.context);
    const xo = own.lookup(PDFName.of("XObject"));
    const ownXo = xo instanceof PDFDict ? xo.clone(doc.context) : doc.context.obj({});
    for (const f of r.forms) ownXo.set(PDFName.of(f.name), f.ref);
    own.set(PDFName.of("XObject"), ownXo);
    page.node.set(PDFName.of("Resources"), own);
  }
  const ref = doc.context.register(doc.context.flateStream(r.bytes));
  page.node.set(PDFName.of("Contents"), ref);
  return { removedGlyphs: r.removedGlyphs, unsafe: null, changed: true };
}

/** Empty a page's content (used for deleted and rasterized pages so their objects carry nothing sensitive). */
export function clearPageContent(doc: PDFDocument, page: PDFPage) {
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(new Uint8Array())));
  page.node.set(PDFName.of("Resources"), doc.context.obj({}));
  page.node.delete(PDFName.of("Annots"));
}

/**
 * Delete every indirect object that is not reachable from the trailer (Root,
 * Info). pdf-lib otherwise serializes all objects it ever loaded, so replaced
 * content streams, removed pages and dropped annotations would survive in the
 * saved bytes.
 */
export function pruneUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const t = ctx.trailerInfo;
  for (const o of [t.Root, t.Info]) if (o) stack.push(o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) { for (const [, v] of o.entries()) stack.push(v); }
    else if (o instanceof PDFArray) { for (const v of o.asArray()) stack.push(v); }
    else if (o instanceof PDFStream) stack.push(o.dict);
  }
  let deleted = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) { ctx.delete(ref); deleted++; }
  return deleted;
}

/** Text of a PDF string object (literal or hex), or undefined. */
export function pdfText(o: PDFObject | undefined): string | undefined {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  return undefined;
}
