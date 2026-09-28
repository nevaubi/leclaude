/**
 * Minimal, offset-tracking XML reader for OOXML parts.
 *
 * fast-xml-parser (used for validation) does not report source offsets, and the package-preserving export
 * needs the exact source bytes of every element it does not rewrite (paragraphs, tables, pPr/rPr/sectPr…).
 * This reader keeps `start`/`end` offsets into the decoded part text for every element, canonicalizes
 * namespace prefixes (so a producer that binds WordprocessingML to `ns0:` still reads as `w:`), and decodes
 * entities in text and attribute values. It is deliberately small: OOXML parts have no DTDs or external entities.
 */

export interface XText { kind: "text"; text: string; start: number; end: number }
export interface XEl {
  kind: "el";
  /** Canonical qualified name, e.g. "w:p" (prefix normalized through the namespace table). */
  name: string;
  /** Attributes keyed by canonical qualified name ("w:val", "r:id", "xml:space"). Values are entity-decoded. */
  attrs: Record<string, string>;
  children: XNode[];
  start: number;
  end: number;
  /** Offset just after the start tag (content start) and just before the end tag (content end). */
  innerStart: number;
  innerEnd: number;
}
export type XNode = XEl | XText;

export const NS: Record<string, string> = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  v: "urn:schemas-microsoft-com:vml",
  o: "urn:schemas-microsoft-com:office:office",
  w14: "http://schemas.microsoft.com/office/word/2010/wordml",
  w15: "http://schemas.microsoft.com/office/word/2012/wordml",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
};
const CANON_BY_URI = new Map(Object.entries(NS).map(([p, u]) => [u, p]));
// Strict-OOXML namespaces map onto the transitional prefixes.
CANON_BY_URI.set("http://purl.oclc.org/ooxml/wordprocessingml/main", "w");
CANON_BY_URI.set("http://purl.oclc.org/ooxml/officeDocument/relationships", "r");

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITY[e] ?? m;
  });
}

export function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Characters XML 1.0 forbids in content (Word refuses such a part). */
export function stripInvalidXmlChars(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR_RE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export class XmlError extends Error { constructor(message: string) { super(message); this.name = "XmlError"; } }

/** Parse an XML part. Throws XmlError on malformed input. */
export function parseXml(src: string): { root: XEl; src: string } {
  const stack: { el: XEl; scope: Map<string, string> }[] = [];
  let root: XEl | null = null;
  let i = 0;
  const n = src.length;
  const canon = (qname: string, scope: Map<string, string>, isAttr: boolean): string => {
    const c = qname.indexOf(":");
    if (c < 0) {
      if (isAttr) return qname;
      const def = scope.get("");
      const p = def ? CANON_BY_URI.get(def) : undefined;
      return p ? `${p}:${qname}` : qname;
    }
    const prefix = qname.slice(0, c);
    if (prefix === "xml" || prefix === "xmlns") return qname;
    const uri = scope.get(prefix);
    const p = uri ? CANON_BY_URI.get(uri) : undefined;
    return p ? `${p}:${qname.slice(c + 1)}` : qname;
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      if (stack.length && src.slice(i).trim()) stack[stack.length - 1].el.children.push({ kind: "text", text: decodeEntities(src.slice(i)), start: i, end: n });
      break;
    }
    if (lt > i && stack.length) {
      const raw = src.slice(i, lt);
      stack[stack.length - 1].el.children.push({ kind: "text", text: decodeEntities(raw), start: i, end: lt });
    }
    if (src.startsWith("<?", lt)) { const e = src.indexOf("?>", lt); if (e < 0) throw new XmlError("unterminated processing instruction"); i = e + 2; continue; }
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt); if (e < 0) throw new XmlError("unterminated comment"); i = e + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt);
      if (e < 0) throw new XmlError("unterminated CDATA");
      if (stack.length) stack[stack.length - 1].el.children.push({ kind: "text", text: src.slice(lt + 9, e), start: lt, end: e + 3 });
      i = e + 3; continue;
    }
    if (src.startsWith("<!", lt)) { const e = src.indexOf(">", lt); if (e < 0) throw new XmlError("unterminated declaration"); i = e + 1; continue; }
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(src);
    if (!m) throw new XmlError(`malformed tag at offset ${lt}`);
    const [whole, close, qname, attrSrc, selfClose] = m;
    const tagEnd = lt + whole.length;
    if (close) {
      const top = stack.pop();
      if (!top) throw new XmlError(`unexpected </${qname}> at ${lt}`);
      const want = canon(qname, top.scope, false);
      if (want !== top.el.name) throw new XmlError(`mismatched </${qname}> (open ${top.el.name}) at ${lt}`);
      top.el.innerEnd = lt;
      top.el.end = tagEnd;
      i = tagEnd;
      continue;
    }
    const parentScope = stack.length ? stack[stack.length - 1].scope : new Map<string, string>();
    let scope = parentScope;
    const rawAttrs: [string, string][] = [];
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ATTR_RE.exec(attrSrc))) {
      const k = a[1]; const v = decodeEntities(a[2] ?? a[3] ?? "");
      rawAttrs.push([k, v]);
      if (k === "xmlns" || k.startsWith("xmlns:")) {
        if (scope === parentScope) scope = new Map(parentScope);
        scope.set(k === "xmlns" ? "" : k.slice(6), v);
      }
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of rawAttrs) attrs[canon(k, scope, true)] = v;
    const el: XEl = { kind: "el", name: canon(qname, scope, false), attrs, children: [], start: lt, end: tagEnd, innerStart: tagEnd, innerEnd: tagEnd };
    if (stack.length) stack[stack.length - 1].el.children.push(el);
    else if (!root) root = el;
    else throw new XmlError("multiple root elements");
    if (!selfClose) stack.push({ el, scope });
    i = tagEnd;
  }
  if (stack.length) throw new XmlError(`unclosed <${stack[stack.length - 1].el.name}>`);
  if (!root) throw new XmlError("no root element");
  return { root, src };
}

export function isEl(n: XNode | undefined | null): n is XEl { return Boolean(n && n.kind === "el"); }
export function kids(el: XEl | null | undefined, name?: string): XEl[] {
  if (!el) return [];
  const out: XEl[] = [];
  for (const c of el.children) if (c.kind === "el" && (!name || c.name === name)) out.push(c);
  return out;
}
export function kid(el: XEl | null | undefined, name: string): XEl | null {
  if (!el) return null;
  for (const c of el.children) if (c.kind === "el" && c.name === name) return c;
  return null;
}
/** Depth-first descendants matching a name. */
export function descendants(el: XEl | null | undefined, name: string, out: XEl[] = []): XEl[] {
  if (!el) return out;
  for (const c of el.children) if (c.kind === "el") { if (c.name === name) out.push(c); descendants(c, name, out); }
  return out;
}
export function attr(el: XEl | null | undefined, name: string): string | undefined { return el?.attrs[name]; }
export function wval(el: XEl | null | undefined): string | undefined { return el?.attrs["w:val"]; }
/** OOXML on/off properties: present without w:val, or w:val true/1/on. */
export function onOff(el: XEl | null | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = el.attrs["w:val"];
  if (v === undefined) return true;
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}
export function raw(src: string, el: XEl): string { return src.slice(el.start, el.end); }

/**
 * Serialize an element with canonical prefixes (w:, r:, wp:, a:…). Property fragments (pPr, rPr, tcPr…) stored
 * for regeneration are re-parsed standalone later, where the source document's own prefix bindings are gone.
 * Unknown namespaces keep their source prefix (still declared on the preserved document root).
 */
export function serializeEl(el: XEl): string {
  const attrs = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  if (!el.children.length) return `<${el.name}${attrs}/>`;
  let inner = "";
  for (const c of el.children) inner += c.kind === "text" ? escText(c.text) : serializeEl(c);
  return `<${el.name}${attrs}>${inner}</${el.name}>`;
}
export function innerRaw(src: string, el: XEl): string { return src.slice(el.innerStart, el.innerEnd); }
export function textContent(el: XEl): string {
  let s = "";
  for (const c of el.children) s += c.kind === "text" ? c.text : textContent(c);
  return s;
}

/** Namespace declarations used on generated roots. */
export const WORD_NS_DECLS = `xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="${NS.mc}" xmlns:o="${NS.o}" xmlns:r="${NS.r}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="${NS.v}" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="${NS.wp}" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="${NS.w}" xmlns:w14="${NS.w14}" xmlns:w15="${NS.w15}" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" mc:Ignorable="w14 w15 wp14"`;

export const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
