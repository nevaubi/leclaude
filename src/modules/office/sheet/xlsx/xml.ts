/**
 * XML helpers for the OOXML reader/writer: escaping (including Excel's
 * _xHHHH_ escapes for control characters), a configured fast-xml-parser,
 * and a top-level element splitter used to splice preserved elements
 * verbatim into regenerated parts.
 */
import { XMLParser } from "fast-xml-parser";

export type XNode = Record<string, unknown> & { $?: Record<string, string>; "#text"?: string };

const ARRAY_TAGS = new Set([
  "row", "c", "col", "sheet", "definedName", "numFmt", "font", "fill", "border", "xf", "dxf", "si", "r", "mergeCell",
  "conditionalFormatting", "cfRule", "cfvo", "color", "formula", "dataValidation", "hyperlink", "filterColumn", "filter",
  "customFilter", "Relationship", "Override", "Default", "comment", "author", "ser", "pt", "twoCellAnchor", "oneCellAnchor",
  "absoluteAnchor", "selection", "sheetView", "cellStyle", "gradientFill", "stop", "dateGroupItem", "p", "tableStyle",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  attributesGroupName: "$",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export function parseXml(xml: string): XNode {
  return parser.parse(xml) as XNode;
}

/** Attributes of a node (namespace prefixes removed by the parser, e.g. r:id → id). */
export function attrs(node: unknown): Record<string, string> {
  if (!node || typeof node !== "object") return {};
  return ((node as XNode).$ ?? {}) as Record<string, string>;
}

export function child(node: unknown, name: string): XNode | undefined {
  if (!node || typeof node !== "object") return undefined;
  const v = (node as XNode)[name];
  if (Array.isArray(v)) return v[0] as XNode | undefined;
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return { "#text": v } as XNode;
  return v as XNode;
}

export function children(node: unknown, name: string): XNode[] {
  if (!node || typeof node !== "object") return [];
  const v = (node as XNode)[name];
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === "string" ? ({ "#text": x } as XNode) : (x as XNode)));
}

export function text(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  const t = (node as XNode)["#text"];
  return t === undefined || t === null ? "" : String(t);
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape text content: XML-escape and encode characters XML 1.0 cannot carry as Excel's _xHHHH_. */
export function escText(s: string): string {
  // A literal "_x0041_" in the source must itself be escaped (as _x005F_x0041_) so it survives the decode.
  const guarded = s.replace(/_x([0-9A-Fa-f]{4})_/g, "_x005F_x$1_");
  return esc(guarded).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}

/** Decode Excel's _xHHHH_ escapes in shared/inline string text. */
export function unescExcel(s: string): string {
  if (!s.includes("_x")) return s;
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Render attributes, skipping undefined/null/false; `true` renders as "1". */
export function attrStr(a: Record<string, string | number | boolean | undefined | null>): string {
  let out = "";
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === false) continue;
    out += ` ${k}="${esc(v === true ? "1" : String(v))}"`;
  }
  return out;
}

export function el(name: string, a: Record<string, string | number | boolean | undefined | null> = {}, inner?: string | null): string {
  return inner === undefined || inner === null || inner === "" ? `<${name}${attrStr(a)}/>` : `<${name}${attrStr(a)}>${inner}</${name}>`;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export interface TopLevel {
  /** Everything before the root start tag (declaration, comments). */
  prolog: string;
  rootName: string;
  /** Local name of the root element (no prefix). */
  rootLocal: string;
  rootStart: string;
  children: { name: string; local: string; xml: string }[];
  rootEnd: string;
}

/** Skip to the end of the tag starting at `i` (at '<'), honouring quoted attribute values. Returns the index after '>'. */
function tagEnd(xml: string, i: number): number {
  let q: string | null = null;
  for (let j = i + 1; j < xml.length; j++) {
    const ch = xml[j];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === ">") return j + 1;
  }
  throw new Error("Unterminated XML tag");
}

function skipSpecial(xml: string, i: number): number | null {
  if (xml.startsWith("<!--", i)) { const e = xml.indexOf("-->", i + 4); if (e < 0) throw new Error("Unterminated comment"); return e + 3; }
  if (xml.startsWith("<![CDATA[", i)) { const e = xml.indexOf("]]>", i + 9); if (e < 0) throw new Error("Unterminated CDATA"); return e + 3; }
  if (xml.startsWith("<?", i)) { const e = xml.indexOf("?>", i + 2); if (e < 0) throw new Error("Unterminated PI"); return e + 2; }
  if (xml.startsWith("<!", i)) return tagEnd(xml, i);
  return null;
}

function tagName(xml: string, i: number): string {
  const m = /^<\/?([A-Za-z_][\w.:-]*)/.exec(xml.slice(i, i + 200));
  if (!m) throw new Error(`Malformed XML tag at ${i}`);
  return m[1];
}

/** Split an XML document into its root element and the verbatim XML of each direct child element. */
export function splitTopLevel(xml: string): TopLevel {
  let i = 0;
  // prolog
  for (;;) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) throw new Error("No root element");
    const sp = skipSpecial(xml, lt);
    if (sp !== null) { i = sp; continue; }
    i = lt;
    break;
  }
  const prolog = xml.slice(0, i);
  const rootName = tagName(xml, i);
  const rootStartEnd = tagEnd(xml, i);
  const rootStart = xml.slice(i, rootStartEnd);
  const local = (n: string) => n.includes(":") ? n.slice(n.indexOf(":") + 1) : n;
  const out: TopLevel = { prolog, rootName, rootLocal: local(rootName), rootStart, children: [], rootEnd: `</${rootName}>` };
  if (rootStart.endsWith("/>")) { out.rootEnd = ""; return out; }
  i = rootStartEnd;
  for (;;) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) throw new Error("Unterminated root element");
    if (xml.startsWith("</", lt)) { out.rootEnd = xml.slice(lt, tagEnd(xml, lt)); break; }
    const sp = skipSpecial(xml, lt);
    if (sp !== null) { i = sp; continue; }
    const name = tagName(xml, lt);
    let j = tagEnd(xml, lt);
    if (!xml.slice(lt, j).endsWith("/>")) {
      let depth = 1;
      while (depth > 0) {
        const n = xml.indexOf("<", j);
        if (n < 0) throw new Error(`Unterminated element <${name}>`);
        const s2 = skipSpecial(xml, n);
        if (s2 !== null) { j = s2; continue; }
        const e = tagEnd(xml, n);
        if (xml.startsWith("</", n)) depth--;
        else if (!xml.slice(n, e).endsWith("/>")) depth++;
        j = e;
      }
    }
    out.children.push({ name, local: local(name), xml: xml.slice(lt, j) });
    i = j;
  }
  return out;
}

/** Namespace declarations (xmlns / xmlns:x) on a start tag. */
export function nsDecls(startTag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of startTag.matchAll(/\s(xmlns(?::[\w.-]+)?)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
