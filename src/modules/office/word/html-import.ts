/**
 * Minimal HTML → ProseMirror JSON converter (no DOM required). Handles the
 * tags mammoth emits for .docx plus common authoring HTML: headings,
 * paragraphs, lists (nested), block quotes, pre, tables, images, rules,
 * line breaks and inline marks (strong/em/u/s/sup/sub/a/code/mark/span styles).
 */
import { ensureBlockIds, newId, normalizeInline, type PMNode } from "./doc-model";

interface El { tag: string; attrs: Record<string, string>; children: (El | string)[] }

const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "col", "wbr", "source"]);
const BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "hr", "div", "section", "article", "header", "footer", "main", "figure", "figcaption", "body", "html", "nav", "aside", "address", "center", "dl", "dt", "dd", "caption"]);

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|ldquo|rdquo|lsquo|rsquo|sect|para|copy|reg|trade|deg);/g, (_, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", sect: "§", para: "¶", copy: "©", reg: "®", trade: "™", deg: "°" })[n] ?? _);
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** Parse an HTML string into a light element tree. */
export function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  let src = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) stack[stack.length - 1].children.push(decodeEntities(src.slice(last, m.index)));
    last = m.index + m[0].length;
    const raw = m[0];
    const tag = m[1].toLowerCase();
    if (raw.startsWith("</")) {
      // close the nearest matching open element
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const el: El = { tag, attrs: parseAttrs(m[2] ?? ""), children: [] };
    // implicit closes: p closed by block; li closed by li
    const top = () => stack[stack.length - 1];
    if (BLOCK.has(tag) && top().tag === "p") stack.pop();
    if (tag === "li" && top().tag === "li") stack.pop();
    if ((tag === "td" || tag === "th") && (top().tag === "td" || top().tag === "th")) stack.pop();
    if (tag === "tr" && (top().tag === "td" || top().tag === "th")) { stack.pop(); if (top().tag === "tr") stack.pop(); }
    if (tag === "pre") {
      const end = src.indexOf("</pre>", last);
      const inner = end >= 0 ? src.slice(last, end) : src.slice(last);
      el.children.push(decodeEntities(inner.replace(/<[^>]+>/g, "")));
      top().children.push(el);
      last = end >= 0 ? end + 6 : src.length;
      re.lastIndex = last;
      continue;
    }
    top().children.push(el);
    if (!VOID.has(tag) && !raw.endsWith("/>")) stack.push(el);
  }
  if (last < src.length) stack[stack.length - 1].children.push(decodeEntities(src.slice(last)));
  src = "";
  return root;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

function styleMarks(style: string | undefined): Mark[] {
  if (!style) return [];
  const out: Mark[] = [];
  const get = (k: string) => { const m = style.match(new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`, "i")); return m?.[1]?.trim(); };
  const fw = get("font-weight"); if (fw && (fw === "bold" || parseInt(fw) >= 600)) out.push({ type: "bold" });
  const fs = get("font-style"); if (fs === "italic") out.push({ type: "italic" });
  const td = get("text-decoration"); if (td?.includes("underline")) out.push({ type: "underline" }); if (td?.includes("line-through")) out.push({ type: "strike" });
  const color = get("color"); const size = get("font-size"); const family = get("font-family");
  if (color || size || family) out.push({ type: "textStyle", attrs: { ...(color ? { color } : {}), ...(size ? { fontSize: size } : {}), ...(family ? { fontFamily: family } : {}) } });
  const bg = get("background-color"); if (bg) out.push({ type: "highlight", attrs: { color: bg } });
  const fv = get("font-variant"); if (fv === "small-caps") out.push({ type: "smallCaps" });
  return out;
}

const INLINE_MARK: Record<string, Mark> = { strong: { type: "bold" }, b: { type: "bold" }, em: { type: "italic" }, i: { type: "italic" }, u: { type: "underline" }, s: { type: "strike" }, strike: { type: "strike" }, del: { type: "strike" }, sup: { type: "superscript" }, sub: { type: "subscript" }, code: { type: "code" }, mark: { type: "highlight" }, ins: { type: "underline" } };

function textAlignOf(attrs: Record<string, string>): string | undefined {
  const a = attrs.align ?? attrs.style?.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1];
  return a && a !== "left" ? a.toLowerCase() : undefined;
}

function inlineNodes(children: (El | string)[], marks: Mark[], pre = false): PMNode[] {
  const out: PMNode[] = [];
  for (const c of children) {
    if (typeof c === "string") {
      const t = pre ? c : c.replace(/\s+/g, " ");
      if (t) out.push({ type: "text", text: t, ...(marks.length ? { marks: marks.map((m) => ({ ...m })) } : {}) });
      continue;
    }
    if (c.tag === "br") { out.push({ type: "hardBreak" }); continue; }
    if (c.tag === "img") { out.push({ type: "text", text: c.attrs.alt ? `[${c.attrs.alt}]` : "", marks: marks.length ? marks : undefined }); continue; }
    let next = marks;
    const m = INLINE_MARK[c.tag];
    if (m) next = [...next, c.tag === "mark" ? { type: "highlight", attrs: { color: "#fff3a3" } } : m];
    if (c.tag === "a" && c.attrs.href) next = [...next, { type: "link", attrs: { href: c.attrs.href, target: "_blank" } }];
    if (c.tag === "span" || c.tag === "font") next = [...next, ...styleMarks(c.attrs.style), ...(c.attrs.color ? [{ type: "textStyle", attrs: { color: c.attrs.color } }] : [])];
    if (c.attrs.style && !["span", "font"].includes(c.tag)) next = [...next, ...styleMarks(c.attrs.style)];
    out.push(...inlineNodes(c.children, next, pre));
  }
  return out;
}

function trimInline(nodes: PMNode[]): PMNode[] {
  const n = normalizeInline(nodes);
  if (n.length && n[0].type === "text") n[0].text = (n[0].text ?? "").replace(/^\s+/, "");
  const l = n[n.length - 1];
  if (l && l.type === "text") l.text = (l.text ?? "").replace(/\s+$/, "");
  return n.filter((x) => !(x.type === "text" && !x.text));
}

function para(children: (El | string)[], attrs: Record<string, unknown> = {}): PMNode {
  return { type: "paragraph", attrs: { id: newId(), ...attrs }, content: trimInline(inlineNodes(children, [])) };
}

/** Convert a mixed child list into block nodes; runs of inline content become paragraphs. */
function blocks(children: (El | string)[]): PMNode[] {
  const out: PMNode[] = [];
  let run: (El | string)[] = [];
  const flush = () => { if (run.some((c) => (typeof c === "string" ? c.trim() : true))) out.push(para(run)); run = []; };
  for (const c of children) {
    if (typeof c === "string" || !BLOCK.has(c.tag)) { if (typeof c !== "string" && c.tag === "img") { flush(); out.push(imageNode(c)); } else run.push(c); continue; }
    flush();
    out.push(...blockOf(c));
  }
  flush();
  return out;
}

function imageNode(el: El): PMNode {
  const w = parseInt(el.attrs.width ?? el.attrs.style?.match(/width\s*:\s*(\d+)/)?.[1] ?? "");
  return { type: "image", attrs: { id: newId(), src: el.attrs.src ?? "", alt: el.attrs.alt ?? null, title: el.attrs.title ?? null, width: Number.isFinite(w) ? w : null, height: null, align: "center" } };
}

function listNode(el: El): PMNode {
  const ordered = el.tag === "ol";
  const items: PMNode[] = [];
  for (const c of el.children) {
    if (typeof c === "string" || c.tag !== "li") continue;
    const content: PMNode[] = [];
    let inlineRun: (El | string)[] = [];
    const flush = () => { if (inlineRun.some((x) => (typeof x === "string" ? x.trim() : true))) content.push(para(inlineRun)); inlineRun = []; };
    for (const lc of c.children) {
      if (typeof lc !== "string" && (lc.tag === "ul" || lc.tag === "ol")) { flush(); content.push(listNode(lc)); }
      else if (typeof lc !== "string" && lc.tag === "p") { flush(); content.push(para(lc.children, { textAlign: textAlignOf(lc.attrs) })); }
      else if (typeof lc === "string" || !BLOCK.has(lc.tag)) inlineRun.push(lc);
      else { flush(); content.push(...blockOf(lc)); }
    }
    flush();
    if (!content.length) content.push(para([]));
    items.push({ type: "listItem", attrs: { id: newId() }, content });
  }
  const style = el.attrs.type === "a" || el.attrs.style?.includes("lower-alpha") ? "alpha" : el.attrs.type === "i" || el.attrs.style?.includes("roman") ? "roman" : el.attrs["data-list-style"] ?? "decimal";
  return { type: ordered ? "orderedList" : "bulletList", attrs: { id: newId(), ...(ordered ? { start: parseInt(el.attrs.start ?? "1") || 1, listStyle: style } : {}) }, content: items.length ? items : [{ type: "listItem", attrs: { id: newId() }, content: [para([])] }] };
}

function tableNode(el: El): PMNode {
  const rows: PMNode[] = [];
  const collectRows = (e: El) => {
    for (const c of e.children) {
      if (typeof c === "string") continue;
      if (c.tag === "tr") {
        const cells: PMNode[] = [];
        for (const cell of c.children) {
          if (typeof cell === "string" || (cell.tag !== "td" && cell.tag !== "th")) continue;
          const content = blocks(cell.children);
          cells.push({ type: cell.tag === "th" ? "tableHeader" : "tableCell", attrs: { id: newId(), colspan: parseInt(cell.attrs.colspan ?? "1") || 1, rowspan: parseInt(cell.attrs.rowspan ?? "1") || 1, colwidth: null }, content: content.length ? content : [para([])] });
        }
        if (cells.length) rows.push({ type: "tableRow", attrs: { id: newId() }, content: cells });
      } else if (["thead", "tbody", "tfoot"].includes(c.tag)) collectRows(c);
    }
  };
  collectRows(el);
  if (!rows.length) return para([]);
  // Normalize row widths so the table is rectangular.
  const cols = Math.max(...rows.map((r) => (r.content ?? []).reduce((n, c) => n + Number(c.attrs?.colspan ?? 1), 0)));
  for (const r of rows) { let n = (r.content ?? []).reduce((a, c) => a + Number(c.attrs?.colspan ?? 1), 0); while (n < cols) { r.content!.push({ type: "tableCell", attrs: { id: newId(), colspan: 1, rowspan: 1, colwidth: null }, content: [para([])] }); n++; } }
  return { type: "table", attrs: { id: newId() }, content: rows };
}

function blockOf(el: El): PMNode[] {
  switch (el.tag) {
    case "p": { const p = para(el.children, { textAlign: textAlignOf(el.attrs) }); if (el.attrs.class?.includes("caption") || el.attrs.class?.includes("Caption")) p.attrs!.pStyle = "caption"; return [p]; }
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const level = Math.min(3, parseInt(el.tag[1]));
      const attrs: Record<string, unknown> = { id: newId(), level, textAlign: textAlignOf(el.attrs) };
      if (el.attrs.class?.toLowerCase().includes("title")) attrs.pStyle = "title";
      return [{ type: "heading", attrs, content: trimInline(inlineNodes(el.children, [])) }];
    }
    case "ul": case "ol": return [listNode(el)];
    case "blockquote": { const inner = blocks(el.children); return [{ type: "blockquote", attrs: { id: newId() }, content: inner.length ? inner : [para([])] }]; }
    case "pre": return [{ type: "codeBlock", attrs: { id: newId(), language: null }, content: [{ type: "text", text: el.children.map((c) => (typeof c === "string" ? c : "")).join("").replace(/^\n/, "").replace(/\n$/, "") }].filter((t) => t.text) }];
    case "table": return [tableNode(el)];
    case "hr": return [{ type: "horizontalRule", attrs: { id: newId() } }];
    case "img": return [imageNode(el)];
    case "figure": { const out = blocks(el.children.filter((c) => typeof c === "string" || c.tag !== "figcaption")); const cap = el.children.find((c): c is El => typeof c !== "string" && c.tag === "figcaption"); if (cap) out.push(para(cap.children, { pStyle: "caption", textAlign: "center" })); return out; }
    case "figcaption": case "caption": return [para(el.children, { pStyle: "caption" })];
    case "dt": return [para(el.children)];
    case "dd": return [para(el.children, { indent: 1 })];
    case "li": return [listNode({ tag: "ul", attrs: {}, children: [el] })];
    case "tr": case "td": case "th": case "thead": case "tbody": case "tfoot": return blocks(el.children);
    default: {
      if (el.attrs.style?.includes("page-break") || el.attrs.class?.includes("page-break")) return [{ type: "pageBreak", attrs: { id: newId() } }];
      return blocks(el.children);
    }
  }
}

/** HTML string → ProseMirror doc JSON with block ids. */
export function htmlToDoc(html: string): PMNode {
  const root = parseHtml(html);
  const content = blocks(root.children);
  const doc: PMNode = { type: "doc", content: content.length ? content : [para([])] };
  return ensureBlockIds(doc);
}
