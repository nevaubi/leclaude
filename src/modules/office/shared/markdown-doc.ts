import { nanoid } from "nanoid";

/**
 * Minimal Markdown → TipTap/ProseMirror JSON converter used by modules that
 * create Word documents programmatically (research memos, workflow outputs,
 * chronologies). Supports headings, paragraphs, bullet/numbered lists, block
 * quotes, horizontal rules, simple pipe tables, and inline bold/italic/code/links.
 * Every block node receives a stable `id` attribute (the Word editor relies on it).
 */
export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

export function markdownToDoc(markdown: string, opts: { title?: string } = {}): PMNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: PMNode[] = [];
  if (opts.title) blocks.push(block("heading", { level: 1 }, inline(opts.title)));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push(block("heading", { level: Math.min(h[1].length, 3) }, inline(h[2].trim()))); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(block("horizontalRule")); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: PMNode[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[i]) : /^\s*[-*+]\s+/.test(lines[i]))) {
        const text = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, "");
        items.push(block("listItem", {}, [block("paragraph", {}, inline(text))]));
        i++;
      }
      blocks.push(block(ordered ? "orderedList" : "bulletList", ordered ? { start: 1 } : {}, items));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push(block("blockquote", {}, [block("paragraph", {}, inline(buf.join(" ")))]));
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      blocks.push(block("table", {}, [
        block("tableRow", {}, header.map((c) => block("tableHeader", { colspan: 1, rowspan: 1 }, [block("paragraph", {}, inline(c))]))),
        ...rows.map((r) => block("tableRow", {}, header.map((_, ci) => block("tableCell", { colspan: 1, rowspan: 1 }, [block("paragraph", {}, inline(r[ci] ?? ""))])))),
      ]));
      continue;
    }
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      blocks.push(block("codeBlock", {}, [{ type: "text", text: buf.join("\n") }]));
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|```|\s*[-*+]\s|\s*\d+[.)]\s|\|)/.test(lines[i]) && !/^(-{3,}|\*{3,})\s*$/.test(lines[i])) { buf.push(lines[i].trim()); i++; }
    if (buf.length) blocks.push(block("paragraph", {}, inline(buf.join(" "))));
    else i++;
  }
  return { type: "doc", content: blocks.length ? blocks : [block("paragraph", {}, [])] };
}

function splitRow(line: string) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()); }

function block(type: string, attrs: Record<string, unknown> = {}, content?: PMNode[]): PMNode {
  const node: PMNode = { type, attrs: { id: nanoid(8), ...attrs } };
  if (content && content.length) node.content = content;
  return node;
}

/** Inline markdown: **bold**, *italic*, `code`, [text](url), ~~strike~~ */
export function inline(text: string): PMNode[] {
  const out: PMNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(~~([^~]+)~~)|(__([^_]+)__)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1]) out.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else if (m[3]) out.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    else if (m[5]) out.push({ type: "text", text: m[6], marks: [{ type: "code" }] });
    else if (m[7]) out.push({ type: "text", text: m[8], marks: [{ type: "link", attrs: { href: m[9], target: "_blank" } }] });
    else if (m[10]) out.push({ type: "text", text: m[11], marks: [{ type: "strike" }] });
    else if (m[12]) out.push({ type: "text", text: m[13], marks: [{ type: "underline" }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((n) => n.text !== "");
}

/** Plain text of a ProseMirror doc, paragraph per line. */
export function docToText(doc: PMNode): string {
  const lines: string[] = [];
  const walk = (n: PMNode, acc: string[]) => {
    if (n.type === "text") { acc.push(n.text ?? ""); return; }
    const isBlock = ["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableCell", "tableHeader"].includes(n.type);
    const inner: string[] = [];
    for (const c of n.content ?? []) walk(c, isBlock ? inner : acc);
    if (isBlock) { const t = inner.join("").trim(); if (t) lines.push(t); }
  };
  walk(doc, []);
  return lines.join("\n");
}
