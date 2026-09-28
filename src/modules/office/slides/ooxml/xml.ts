/**
 * Minimal order-preserving XML DOM for OOXML parts.
 *
 * Every parsed element remembers its exact source text. Serialization writes a node's source bytes unless the node
 * or one of its descendants was modified, so a patched slide keeps every untouched shape byte-identical and the
 * document order of runs, breaks and fields is never lost (fast-xml-parser groups siblings by tag). Namespaced
 * names are plain strings ("p:sp"); no namespace resolution is needed for PresentationML.
 */

export interface XAttr { n: string; v: string }
export interface XEl { t: "el"; name: string; attrs: XAttr[]; kids: XNode[]; raw?: string; dirty?: boolean }
export interface XText { t: "text"; v: string; raw?: string }
export interface XOther { t: "other"; raw: string }
export type XNode = XEl | XText | XOther;
export interface XDoc { before: XNode[]; root: XEl; after: XNode[] }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") { const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return ENT[e] ?? m;
  });
}

export const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;").replace(/\t/g, "&#x9;");

const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse an XML document (or fragment with a single root). Throws on malformed nesting. */
export function parseXml(src: string): XDoc {
  const top: XNode[] = [];
  const stack: { el: XEl; start: number }[] = [];
  const push = (n: XNode) => { if (stack.length) stack[stack.length - 1].el.kids.push(n); else top.push(n); };
  let i = 0;
  const len = src.length;
  while (i < len) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { const raw = src.slice(i); if (raw) push({ t: "text", v: decodeEntities(raw), raw }); break; }
    if (lt > i) { const raw = src.slice(i, lt); push({ t: "text", v: decodeEntities(raw), raw }); }
    if (src.startsWith("<!--", lt)) { const end = src.indexOf("-->", lt + 4); if (end < 0) throw new Error("Unterminated comment"); push({ t: "other", raw: src.slice(lt, end + 3) }); i = end + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const end = src.indexOf("]]>", lt + 9); if (end < 0) throw new Error("Unterminated CDATA"); push({ t: "other", raw: src.slice(lt, end + 3) }); i = end + 3; continue; }
    if (src.startsWith("<?", lt)) { const end = src.indexOf("?>", lt + 2); if (end < 0) throw new Error("Unterminated processing instruction"); push({ t: "other", raw: src.slice(lt, end + 2) }); i = end + 2; continue; }
    if (src.startsWith("<!", lt)) { const end = src.indexOf(">", lt + 2); push({ t: "other", raw: src.slice(lt, end + 1) }); i = end + 1; continue; }
    // find the end of the tag, skipping quoted attribute values
    let j = lt + 1; let q: string | null = null;
    for (; j < len; j++) { const c = src[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; }
    if (j >= len) throw new Error("Unterminated tag");
    const inner = src.slice(lt + 1, j);
    if (inner[0] === "/") {
      const name = inner.slice(1).trim();
      const open = stack.pop();
      if (!open || open.el.name !== name) throw new Error(`Mismatched closing tag </${name}>`);
      open.el.raw = src.slice(open.start, j + 1);
      i = j + 1;
      continue;
    }
    const selfClose = inner.endsWith("/");
    const body = selfClose ? inner.slice(0, -1) : inner;
    const sp = body.search(/\s/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const attrs: XAttr[] = [];
    if (sp >= 0) { ATTR_RE.lastIndex = 0; let m: RegExpExecArray | null; const rest = body.slice(sp); while ((m = ATTR_RE.exec(rest))) attrs.push({ n: m[1], v: decodeEntities(m[2] ?? m[3] ?? "") }); }
    const el: XEl = { t: "el", name, attrs, kids: [] };
    push(el);
    if (selfClose) el.raw = src.slice(lt, j + 1);
    else stack.push({ el, start: lt });
    i = j + 1;
  }
  if (stack.length) throw new Error(`Unclosed element <${stack[stack.length - 1].el.name}>`);
  const rootIdx = top.findIndex((n) => n.t === "el");
  if (rootIdx < 0) throw new Error("No root element");
  return { before: top.slice(0, rootIdx), root: top[rootIdx] as XEl, after: top.slice(rootIdx + 1) };
}

/** Parse a fragment and return its root element (source text kept, so it serializes verbatim until modified). */
export function frag(xml: string): XEl { return parseXml(xml).root; }

export function isClean(n: XNode): boolean {
  if (n.t === "other") return true;
  if (n.t === "text") return n.raw !== undefined;
  return n.raw !== undefined && !n.dirty && n.kids.every(isClean);
}

export function serialize(n: XNode): string {
  if (n.t === "other") return n.raw;
  if (n.t === "text") return n.raw ?? escText(n.v);
  if (isClean(n)) return n.raw as string;
  const attrs = n.attrs.map((a) => ` ${a.n}="${escAttr(a.v)}"`).join("");
  if (!n.kids.length) return `<${n.name}${attrs}/>`;
  return `<${n.name}${attrs}>${n.kids.map(serialize).join("")}</${n.name}>`;
}

export function serializeDoc(d: XDoc): string {
  return [...d.before, d.root, ...d.after].map(serialize).join("");
}

// ---------------------------------------------------------------------------
// Navigation / mutation helpers
// ---------------------------------------------------------------------------

export const els = (n: XEl | undefined): XEl[] => (n ? (n.kids.filter((k) => k.t === "el") as XEl[]) : []);
export const kid = (n: XEl | undefined, name: string): XEl | undefined => (n ? (n.kids.find((k) => k.t === "el" && k.name === name) as XEl | undefined) : undefined);
export const kids = (n: XEl | undefined, name: string): XEl[] => els(n).filter((k) => k.name === name);
export const path = (n: XEl | undefined, ...names: string[]): XEl | undefined => names.reduce<XEl | undefined>((cur, nm) => kid(cur, nm), n);
export const attr = (n: XEl | undefined, name: string): string | undefined => n?.attrs.find((a) => a.n === name)?.v;
export const numAttr = (n: XEl | undefined, name: string, d = 0): number => { const v = attr(n, name); const x = v === undefined ? NaN : Number(v); return Number.isFinite(x) ? x : d; };

export function setAttr(n: XEl, name: string, value: string | number | undefined | null) {
  const i = n.attrs.findIndex((a) => a.n === name);
  if (value === undefined || value === null) { if (i >= 0) { n.attrs.splice(i, 1); n.dirty = true; } return; }
  const v = String(value);
  if (i >= 0) { if (n.attrs[i].v !== v) { n.attrs[i].v = v; n.dirty = true; } }
  else { n.attrs.push({ n: name, v }); n.dirty = true; }
}

export function mk(name: string, attrs: Record<string, string | number | undefined | null> = {}, children: (XNode | string)[] = []): XEl {
  const el: XEl = { t: "el", name, attrs: [], kids: [], dirty: true };
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.attrs.push({ n: k, v: String(v) });
  for (const c of children) el.kids.push(typeof c === "string" ? { t: "text", v: c } : c);
  return el;
}

export function setKids(n: XEl, children: XNode[]) { n.kids = children; n.dirty = true; }
export function removeKid(parent: XEl, child: XNode) { const i = parent.kids.indexOf(child); if (i >= 0) { parent.kids.splice(i, 1); parent.dirty = true; } }
export function insertKid(parent: XEl, index: number, child: XNode) { parent.kids.splice(Math.max(0, Math.min(parent.kids.length, index)), 0, child); parent.dirty = true; }
export function appendKid(parent: XEl, child: XNode) { parent.kids.push(child); parent.dirty = true; }
export function replaceKid(parent: XEl, old: XNode, next: XNode) { const i = parent.kids.indexOf(old); if (i >= 0) { parent.kids[i] = next; parent.dirty = true; } else appendKid(parent, next); }

/** Insert `child` before the first existing child whose name is in `before` (schema ordering), else append. */
export function insertOrdered(parent: XEl, child: XEl, before: string[]) {
  const i = parent.kids.findIndex((k) => k.t === "el" && before.includes(k.name));
  if (i < 0) appendKid(parent, child); else insertKid(parent, i, child);
}

/** Replace the first child named `name` (or insert it respecting `before` ordering). */
export function upsertKid(parent: XEl, child: XEl, before: string[] = []) {
  const cur = kid(parent, child.name);
  if (cur) replaceKid(parent, cur, child); else insertOrdered(parent, child, before);
}

export function clone<T extends XNode>(n: T): T { return JSON.parse(JSON.stringify(n)) as T; }

/** Concatenated decoded text of all descendant text nodes (a:t content etc.). */
export function textContent(n: XNode): string {
  if (n.t === "text") return n.v;
  if (n.t === "other") return n.raw.startsWith("<![CDATA[") ? n.raw.slice(9, -3) : "";
  return n.kids.map(textContent).join("");
}

export function setText(n: XEl, text: string) { n.kids = [{ t: "text", v: text }]; n.dirty = true; }

/** Depth-first search over elements (the node itself included). */
export function findAll(n: XEl, pred: (e: XEl) => boolean, out: XEl[] = []): XEl[] {
  if (pred(n)) out.push(n);
  for (const k of n.kids) if (k.t === "el") findAll(k, pred, out);
  return out;
}
