/**
 * Native PDF annotations: read the annotations an imported PDF already carries
 * (so they are listed, round-trip untouched and can be deleted), and write the
 * editor's annotations as real annotation objects with appearance streams
 * (Highlight / Underline / StrikeOut with QuadPoints, Text notes, FreeText,
 * Ink, Square / Circle, Stamp, Link) that Acrobat, Preview and pdf.js render
 * without regenerating them. Author (/T), dates (/M, /CreationDate) and the
 * editor id (/NM) are always written.
 */
import { PDFArray, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject, type PDFPage } from "pdf-lib";
import { pdfText } from "./content-stream";
import { hexToRgb, type AnnotationType, type PdfAnnotation, type PdfPoint, type PdfRect } from "./model";
import { sanitizeWinAnsi, wrapLine } from "./pdf-lib-utils";

const SUBTYPE_TO_TYPE: Record<string, AnnotationType> = {
  Highlight: "highlight", Underline: "underline", Squiggly: "underline", StrikeOut: "strikeout", Text: "note", FreeText: "text",
  Square: "rect", Circle: "ellipse", Ink: "freehand", Stamp: "stamp", Redact: "redaction", Link: "link",
};


/** Stable content signature of an annotation: native annotations whose signature changed are rewritten on export. */
export function annotationSig(a: Pick<PdfAnnotation, "type" | "rects" | "color" | "text" | "paths" | "opacity">): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return JSON.stringify([a.type, a.rects.map((x) => [r(x.x), r(x.y), r(x.w), r(x.h)]), (a.color ?? "").toLowerCase(), a.text ?? "", a.paths?.length ?? 0, Math.round((a.opacity ?? 1) * 100)]);
}

function lk(doc: PDFDocument, o: PDFObject | undefined) { return o instanceof PDFRef ? doc.context.lookup(o) : o; }
function numArr(doc: PDFDocument, o: PDFObject | undefined): number[] {
  const a = lk(doc, o);
  if (!(a instanceof PDFArray)) return [];
  return a.asArray().map((x) => { const v = lk(doc, x); return v instanceof PDFNumber ? v.asNumber() : NaN; }).filter((x) => Number.isFinite(x));
}

function colorHex(c: number[]): string | undefined {
  let rgb: number[] | null = null;
  if (c.length === 1) rgb = [c[0], c[0], c[0]];
  else if (c.length === 3) rgb = c;
  else if (c.length === 4) rgb = [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
  if (!rgb) return undefined;
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Parse a PDF date ("D:20260924101500Z", "D:20260924101500-05'00'") to ISO, or undefined. */
export function parsePdfDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/);
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00", tz, th = "00", tm = "00"] = m;
  const off = !tz || tz === "Z" || tz === "z" ? "Z" : `${tz}${th}:${tm}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${off}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function quadsToRects(q: number[]): PdfRect[] {
  const out: PdfRect[] = [];
  for (let i = 0; i + 7 < q.length; i += 8) {
    const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]], ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
    const x = Math.min(...xs), y = Math.min(...ys);
    out.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  }
  return out;
}

export interface NativeAnnotationRead extends PdfAnnotation { native: NonNullable<PdfAnnotation["native"]> }

/** Read supported annotations from every page (source page numbers, 1-based). Widgets and popups are skipped. */
export function readNativeAnnotations(doc: PDFDocument): NativeAnnotationRead[] {
  const out: NativeAnnotationRead[] = [];
  doc.getPages().forEach((page, pi) => {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) return;
    for (const raw of annots.asArray()) {
      const d = lk(doc, raw);
      if (!(d instanceof PDFDict)) continue;
      const sub = d.lookup(PDFName.of("Subtype"));
      const subtype = sub instanceof PDFName ? sub.decodeText() : "";
      const type = SUBTYPE_TO_TYPE[subtype];
      if (!type) continue;
      const rectArr = numArr(doc, d.get(PDFName.of("Rect")));
      if (rectArr.length < 4) continue;
      const rect: PdfRect = { x: Math.min(rectArr[0], rectArr[2]), y: Math.min(rectArr[1], rectArr[3]), w: Math.abs(rectArr[2] - rectArr[0]), h: Math.abs(rectArr[3] - rectArr[1]) };
      const quads = numArr(doc, d.get(PDFName.of("QuadPoints")));
      const rects = (type === "highlight" || type === "underline" || type === "strikeout" || type === "redaction") && quads.length >= 8 ? quadsToRects(quads) : [rect];
      const color = colorHex(numArr(doc, d.get(PDFName.of(type === "redaction" ? "IC" : "C")))) ?? (type === "redaction" ? "#111111" : undefined);
      const ca = lk(doc, d.get(PDFName.of("CA")));
      const contents = pdfText(lk(doc, d.get(PDFName.of("Contents"))));
      const author = pdfText(lk(doc, d.get(PDFName.of("T"))));
      const modified = parsePdfDate(pdfText(lk(doc, d.get(PDFName.of("M")))) ?? pdfText(lk(doc, d.get(PDFName.of("CreationDate")))));
      const nm = pdfText(lk(doc, d.get(PDFName.of("NM"))));
      const ap = lk(doc, d.get(PDFName.of("AP")));
      let paths: PdfPoint[][] | undefined;
      if (type === "freehand") {
        const ink = lk(doc, d.get(PDFName.of("InkList")));
        if (ink instanceof PDFArray) paths = ink.asArray().map((p) => { const n = numArr(doc, p); const pts: PdfPoint[] = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] }); return pts; });
      }
      let text = contents;
      let href: string | undefined;
      if (type === "stamp") { const nmn = d.lookup(PDFName.of("Name")); text = contents ?? (nmn instanceof PDFName ? nmn.decodeText() : "STAMP"); }
      if (type === "link") {
        const act = lk(doc, d.get(PDFName.of("A")));
        const uri = act instanceof PDFDict ? pdfText(lk(doc, act.get(PDFName.of("URI")))) ?? (() => { const u = act.lookup(PDFName.of("URI")); return u instanceof PDFString ? u.asString() : undefined; })() : undefined;
        if (!uri) continue; // internal GoTo links stay in the file untouched; they are not listed
        href = uri;
        text = undefined;
      }
      const ref = raw instanceof PDFRef ? raw.toString() : `${pi + 1}:inline:${out.length}`;
      const fontSize = type === "text" ? Number(pdfText(lk(doc, d.get(PDFName.of("DA"))))?.match(/([\d.]+)\s+Tf/)?.[1] ?? NaN) : NaN;
      const a: NativeAnnotationRead = {
        id: nm && /^an_[\w-]+$/.test(nm) ? nm : `na_${ref.replace(/\s+R$/, "").replace(/\s+/g, "_").replace(/[^\w]/g, "_")}`,
        page: pi + 1,
        type,
        rects,
        color: color ?? "#FACC15",
        opacity: ca instanceof PDFNumber ? ca.asNumber() : type === "highlight" ? 0.4 : 1,
        text: text || undefined,
        paths,
        href,
        fontSize: Number.isFinite(fontSize) ? fontSize : undefined,
        reason: type === "redaction" ? (pdfText(lk(doc, d.get(PDFName.of("OverlayText")))) ?? contents) : undefined,
        author: author || "Unknown",
        createdAt: modified ?? new Date(0).toISOString(),
        native: { ref, subtype, sig: "", hasAppearance: ap instanceof PDFDict },
      };
      a.native.sig = annotationSig(a);
      out.push(a);
    }
  });
  return out;
}

/** Remove annotation objects (by "N G R" ref string) from a page's /Annots, including their popups. */
export function removeNativeAnnotations(doc: PDFDocument, page: PDFPage, refs: Set<string>): number {
  if (!refs.size) return 0;
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return 0;
  const popups = new Set<string>();
  for (const x of annots.asArray()) {
    if (!(x instanceof PDFRef) || !refs.has(x.toString())) continue;
    const d = doc.context.lookup(x);
    const p = d instanceof PDFDict ? d.get(PDFName.of("Popup")) : undefined;
    if (p instanceof PDFRef) popups.add(p.toString());
  }
  const keep = annots.asArray().filter((x) => !(x instanceof PDFRef && (refs.has(x.toString()) || popups.has(x.toString()))));
  const removed = annots.size() - keep.length;
  if (removed) page.node.set(PDFName.of("Annots"), doc.context.obj(keep));
  return removed;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface AnnotationFonts { sans: PDFFont; sansBold: PDFFont }

function f(n: number) { return (Math.round(n * 100) / 100).toString(); }

function baseDict(doc: PDFDocument, page: PDFPage, subtype: string, rect: PdfRect, a: PdfAnnotation, extra: Record<string, PDFObject> = {}) {
  const c = hexToRgb(a.color || "#FACC15");
  const date = PDFString.fromDate(new Date(a.modifiedAt ?? a.createdAt ?? Date.now()));
  const dict = doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of(subtype),
    Rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
    F: PDFNumber.of(4),
    C: [c.r, c.g, c.b],
    CA: PDFNumber.of(a.opacity ?? 1),
    P: page.ref,
    NM: PDFHexString.fromText(a.id),
    T: PDFHexString.fromText(a.author || "Unknown"),
    M: date,
    CreationDate: PDFString.fromDate(new Date(a.createdAt ?? Date.now())),
  });
  if (a.text && a.type !== "text" && a.type !== "stamp") dict.set(PDFName.of("Contents"), PDFHexString.fromText(a.text));
  if (a.quote && !a.text) dict.set(PDFName.of("Contents"), PDFHexString.fromText(a.quote));
  for (const [k, v] of Object.entries(extra)) dict.set(PDFName.of(k), v);
  return dict;
}

function appearance(doc: PDFDocument, bbox: PdfRect, content: string, resources?: Record<string, PDFObject>) {
  const stream = doc.context.flateStream(content, {
    Type: "XObject", Subtype: "Form", FormType: 1,
    BBox: [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h],
    Resources: doc.context.obj(resources ?? {}),
  });
  return doc.context.register(stream);
}

function register(doc: PDFDocument, page: PDFPage, dict: PDFDict, ap?: PDFRef) {
  if (ap) dict.set(PDFName.of("AP"), doc.context.obj({ N: ap }));
  const ref = doc.context.register(dict);
  page.node.addAnnot(ref);
  return ref;
}

function union(rects: PdfRect[], pad = 0): PdfRect {
  const x1 = Math.min(...rects.map((r) => r.x)) - pad, y1 = Math.min(...rects.map((r) => r.y)) - pad;
  const x2 = Math.max(...rects.map((r) => r.x + r.w)) + pad, y2 = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function rgbOp(hex: string, stroke = false) { const c = hexToRgb(hex); return `${f(c.r)} ${f(c.g)} ${f(c.b)} ${stroke ? "RG" : "rg"}`; }

function pdfLiteral(s: string) { return `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`; }

/** Text markup with QuadPoints (TL, TR, BL, BR per line as Acrobat writes them) and an appearance stream. */
export function writeMarkup(doc: PDFDocument, page: PDFPage, a: PdfAnnotation, kind: "Highlight" | "Underline" | "StrikeOut") {
  if (!a.rects.length) return null;
  const rect = union(a.rects, 1);
  const quads: number[] = [];
  for (const r of a.rects) quads.push(r.x, r.y + r.h, r.x + r.w, r.y + r.h, r.x, r.y, r.x + r.w, r.y);
  const dict = baseDict(doc, page, kind, rect, a, { QuadPoints: doc.context.obj(quads) });
  const op = a.opacity ?? (kind === "Highlight" ? 0.4 : 1);
  let body = `q /GS0 gs ${kind === "Highlight" ? rgbOp(a.color) : rgbOp(a.color, true)}\n`;
  for (const r of a.rects) {
    if (kind === "Highlight") body += `${f(r.x)} ${f(r.y)} ${f(r.w)} ${f(r.h)} re f\n`;
    else {
      const t = Math.max(0.8, r.h * 0.07);
      const y = kind === "Underline" ? r.y + t : r.y + r.h * 0.45;
      body += `${f(t)} w ${f(r.x)} ${f(y)} m ${f(r.x + r.w)} ${f(y)} l S\n`;
    }
  }
  body += "Q";
  const ap = appearance(doc, rect, body, { ExtGState: doc.context.obj({ GS0: doc.context.obj({ Type: "ExtGState", CA: op, ca: op, BM: PDFName.of(kind === "Highlight" ? "Multiply" : "Normal") }) }) });
  return register(doc, page, dict, ap);
}

export function writeShape(doc: PDFDocument, page: PDFPage, a: PdfAnnotation, kind: "Square" | "Circle", r: PdfRect) {
  const w = a.strokeWidth ?? 1.5;
  const dict = baseDict(doc, page, kind, r, a, { BS: doc.context.obj({ W: w, S: PDFName.of("S") }) });
  const x = r.x + w / 2, y = r.y + w / 2, W = Math.max(0, r.w - w), H = Math.max(0, r.h - w);
  let path: string;
  if (kind === "Square") path = `${f(x)} ${f(y)} ${f(W)} ${f(H)} re S`;
  else {
    const k = 0.5523, cx = x + W / 2, cy = y + H / 2, rx = W / 2, ry = H / 2;
    path = `${f(cx + rx)} ${f(cy)} m ${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c ${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c ${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c ${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c S`;
  }
  const op = a.opacity ?? 1;
  const ap = appearance(doc, r, `q /GS0 gs ${rgbOp(a.color, true)} ${f(w)} w ${path} Q`, { ExtGState: doc.context.obj({ GS0: doc.context.obj({ Type: "ExtGState", CA: op, ca: op }) }) });
  return register(doc, page, dict, ap);
}

export function writeInk(doc: PDFDocument, page: PDFPage, a: PdfAnnotation) {
  const paths = (a.paths ?? []).filter((p) => p.length > 1);
  if (!paths.length) return null;
  const w = a.strokeWidth ?? 1.8;
  const pts = paths.flat();
  const rect = union(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })), w + 1);
  const dict = baseDict(doc, page, "Ink", rect, a, { InkList: doc.context.obj(paths.map((p) => doc.context.obj(p.flatMap((q) => [q.x, q.y])))), BS: doc.context.obj({ W: w }) });
  const body = paths.map((p) => `${f(p[0].x)} ${f(p[0].y)} m ${p.slice(1).map((q) => `${f(q.x)} ${f(q.y)} l`).join(" ")} S`).join("\n");
  const op = a.opacity ?? 1;
  const ap = appearance(doc, rect, `q /GS0 gs ${rgbOp(a.color, true)} ${f(w)} w 1 J 1 j\n${body}\nQ`, { ExtGState: doc.context.obj({ GS0: doc.context.obj({ Type: "ExtGState", CA: op, ca: op }) }) });
  return register(doc, page, dict, ap);
}

export function writeNote(doc: PDFDocument, page: PDFPage, a: PdfAnnotation) {
  const r0 = a.rects[0] ?? { x: 36, y: page.getHeight() - 56, w: 20, h: 20 };
  const r = { x: r0.x, y: r0.y, w: 20, h: 20 };
  const dict = baseDict(doc, page, "Text", r, a, { Name: PDFName.of("Comment"), Open: doc.context.obj(false) });
  if (!a.text) dict.set(PDFName.of("Contents"), PDFHexString.fromText(a.quote ?? ""));
  const body = `q ${rgbOp(a.color || "#FACC15")} 0.3 0.25 0 RG 0.8 w ${f(r.x + 0.5)} ${f(r.y + 4)} 19 15.5 re B ${f(r.x + 4)} ${f(r.y + 4)} m ${f(r.x + 4)} ${f(r.y + 0.5)} l ${f(r.x + 8)} ${f(r.y + 4)} l f 0.3 0.25 0 RG 1 w ${f(r.x + 4)} ${f(r.y + 14)} m ${f(r.x + 16)} ${f(r.y + 14)} l ${f(r.x + 4)} ${f(r.y + 10.5)} m ${f(r.x + 16)} ${f(r.y + 10.5)} l ${f(r.x + 4)} ${f(r.y + 7)} m ${f(r.x + 12)} ${f(r.y + 7)} l S Q`;
  return register(doc, page, dict, appearance(doc, r, body));
}

export function writeFreeText(doc: PDFDocument, page: PDFPage, a: PdfAnnotation, fonts: AnnotationFonts) {
  const r = a.rects[0];
  if (!r) return null;
  const size = a.fontSize ?? 11;
  const c = hexToRgb(a.color || "#111111");
  const da = `/Helv ${f(size)} Tf ${f(c.r)} ${f(c.g)} ${f(c.b)} rg`;
  const dict = baseDict(doc, page, "FreeText", r, a, { DA: PDFString.of(da), Contents: PDFHexString.fromText(a.text ?? ""), Q: PDFNumber.of(0) });
  const lines = (a.text ?? "").split("\n").flatMap((l) => wrapLine(fonts.sans, size, l, Math.max(10, r.w - 6)));
  let y = r.y + r.h - size - 3;
  let body = `/Tx BMC q BT /Helv ${f(size)} Tf ${f(c.r)} ${f(c.g)} ${f(c.b)} rg\n`;
  for (const line of lines) { if (y < r.y - size * 0.2) break; body += `1 0 0 1 ${f(r.x + 3)} ${f(y)} Tm ${pdfLiteral(sanitizeWinAnsi(line))} Tj\n`; y -= size * 1.25; }
  body += "ET Q EMC";
  return register(doc, page, dict, appearance(doc, r, body, { Font: doc.context.obj({ Helv: fonts.sans.ref }) }));
}

export function writeStamp(doc: PDFDocument, page: PDFPage, a: PdfAnnotation, fonts: AnnotationFonts) {
  const r = a.rects[0];
  if (!r) return null;
  const text = sanitizeWinAnsi((a.text ?? "STAMP").toUpperCase());
  const dict = baseDict(doc, page, "Stamp", r, a, { Name: PDFName.of("Draft"), Contents: PDFHexString.fromText(text) });
  let size = Math.min(r.h * 0.6, 28);
  while (size > 6 && fonts.sansBold.widthOfTextAtSize(text, size) > r.w - 14) size -= 1;
  const tw = fonts.sansBold.widthOfTextAtSize(text, size);
  const op = a.opacity ?? 0.9;
  const body = `q /GS0 gs ${rgbOp(a.color || "#B91C1C", true)} ${rgbOp(a.color || "#B91C1C")} 2 w ${f(r.x + 1)} ${f(r.y + 1)} ${f(r.w - 2)} ${f(r.h - 2)} re S BT /HB ${f(size)} Tf 1 0 0 1 ${f(r.x + (r.w - tw) / 2)} ${f(r.y + (r.h - size * 0.72) / 2)} Tm ${pdfLiteral(text)} Tj ET Q`;
  return register(doc, page, dict, appearance(doc, r, body, { Font: doc.context.obj({ HB: fonts.sansBold.ref }), ExtGState: doc.context.obj({ GS0: doc.context.obj({ Type: "ExtGState", CA: op, ca: op }) }) }));
}
