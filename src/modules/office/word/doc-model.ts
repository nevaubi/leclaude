/**
 * Pure (isomorphic) helpers over the Word content model: TipTap/ProseMirror
 * JSON where every block node carries `attrs.id`. Used by the editor (client),
 * the agent tools (server), export/import, templates and tests. No DOM, no db.
 */
import { nanoid } from "nanoid";
import { markdownToDoc, inline, type PMNode } from "@/modules/office/shared/markdown-doc";

export type { PMNode };

/** Node types that must carry a stable `id` attribute. */
export const BLOCK_ID_TYPES = [
  "paragraph", "heading", "listItem", "blockquote", "tableCell", "tableHeader", "codeBlock", "image", "horizontalRule", "pageBreak",
  "bulletList", "orderedList", "table", "tableRow", "taskList", "taskItem", "toc",
] as const;
export const BLOCK_ID_TYPE_SET = new Set<string>(BLOCK_ID_TYPES);

/** Leaf blocks the agent addresses directly (¶ numbering is over these). */
export const LEAF_BLOCK_TYPES = new Set<string>(["paragraph", "heading", "codeBlock", "image", "horizontalRule", "pageBreak"]);

export const TEXTBLOCK_TYPES = new Set<string>(["paragraph", "heading", "codeBlock"]);

export type ParagraphStyle = "title" | "heading1" | "heading2" | "heading3" | "body" | "blockquote" | "caption" | "legal_numbered" | "bullet_list" | "numbered_list";

export interface ChangeMarkAttrs { id: string; author: string; date: string }

export function newId() { return nanoid(8); }

export function emptyDoc(): PMNode {
  return { type: "doc", content: [{ type: "paragraph", attrs: { id: newId() }, content: [] }] };
}

/** Deep-clone a node tree (JSON-safe). */
export function cloneNode<T extends PMNode | PMNode[]>(n: T): T { return JSON.parse(JSON.stringify(n)) as T; }

/** Return a copy of the doc where every block node has a unique 8-char id. */
export function ensureBlockIds(doc: PMNode): PMNode {
  const seen = new Set<string>();
  const walk = (n: PMNode): PMNode => {
    const out: PMNode = { ...n };
    if (BLOCK_ID_TYPE_SET.has(n.type)) {
      const attrs = { ...(n.attrs ?? {}) };
      let id = typeof attrs.id === "string" && /^[A-Za-z0-9_-]{4,32}$/.test(attrs.id) ? attrs.id : "";
      if (!id || seen.has(id)) id = newId();
      seen.add(id);
      attrs.id = id;
      out.attrs = attrs;
    }
    if (n.content) out.content = n.content.map(walk);
    return out;
  };
  return walk(doc);
}

// ---------------------------------------------------------------------------
// Inline text helpers
// ---------------------------------------------------------------------------

export type TextView = "accepted" | "raw" | "original";

function hasMark(n: PMNode, type: string) { return Boolean(n.marks?.some((m) => m.type === type)); }

/** Plain text of an inline content array. `accepted` drops tracked deletions; `original` drops insertions. */
export function inlineText(content: PMNode[] | undefined, view: TextView = "accepted"): string {
  if (!content) return "";
  let s = "";
  for (const n of content) {
    if (n.type === "text") {
      if (view === "accepted" && hasMark(n, "deletion")) continue;
      if (view === "original" && hasMark(n, "insertion")) continue;
      s += n.text ?? "";
    } else if (n.type === "hardBreak") s += "\n";
    else if (n.content) s += inlineText(n.content, view);
  }
  return s;
}

/** Text of a block node (paragraph/heading/cell…), recursing into nested blocks with newlines. */
export function blockText(node: PMNode, view: TextView = "accepted"): string {
  if (TEXTBLOCK_TYPES.has(node.type)) return inlineText(node.content, view);
  if (node.type === "image") return node.attrs?.alt ? `[image: ${String(node.attrs.alt)}]` : "[image]";
  if (node.type === "pageBreak") return "[page break]";
  if (node.type === "horizontalRule") return "———";
  return (node.content ?? []).map((c) => blockText(c, view)).filter(Boolean).join("\n");
}

export function wordCount(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  return m ? m.length : 0;
}

/** Summarize inline formatting for the agent, e.g. "bold: 'Summary judgment'". */
export function summarizeMarks(content: PMNode[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of content ?? []) {
    if (n.type !== "text" || !n.marks?.length) continue;
    for (const m of n.marks) {
      if (["insertion", "deletion", "comment", "textStyle", "footnote"].includes(m.type)) continue;
      const key = `${m.type}:${(n.text ?? "").slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${m.type}: "${(n.text ?? "").slice(0, 40)}${(n.text ?? "").length > 40 ? "…" : ""}"`);
    }
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Flattened block listing (the agent's view of the document)
// ---------------------------------------------------------------------------

export interface ListInfo { kind: "bullet" | "ordered" | "legal" | "outline" | "alpha" | "roman" | "task"; depth: number; position: number }
export interface TableInfo { tableId: string; row: number; col: number; header: boolean }

export interface DocBlock {
  id: string;
  /** 1-based paragraph number (¶n) over leaf blocks. */
  index: number;
  type: "paragraph" | "heading" | "codeBlock" | "image" | "horizontalRule" | "pageBreak";
  level?: number;
  /** Paragraph style attr (title, caption, …). */
  pStyle?: string;
  align?: string;
  text: string;
  /** Raw text including tracked deletions, when different. */
  rawText?: string;
  /** Nearest preceding heading id (section). */
  section?: string;
  listInfo?: ListInfo;
  table?: TableInfo;
  wordCount: number;
  marks?: string[];
  comments: number;
  footnotes?: number;
  tracked?: { insertions: number; deletions: number };
  image?: { src: string; alt?: string; width?: number };
}

export interface DocSection { id: string; title: string; level: number; index: number; wordCount: number; blockCount: number; start: number; end: number }

export interface FlattenResult { blocks: DocBlock[]; sections: DocSection[] }

const LIST_KIND: Record<string, ListInfo["kind"]> = { bulletList: "bullet", orderedList: "ordered", taskList: "task" };

export function flattenBlocks(doc: PMNode): FlattenResult {
  const blocks: DocBlock[] = [];
  const sections: DocSection[] = [];
  let index = 0;
  let currentSection: DocSection | null = null;
  const closeSection = () => { if (currentSection) { currentSection.end = index; currentSection.blockCount = index - currentSection.start; } };

  const walk = (n: PMNode, ctx: { list?: ListInfo; table?: TableInfo; listCounters: number[] }) => {
    if (LEAF_BLOCK_TYPES.has(n.type)) {
      const id = String(n.attrs?.id ?? "");
      index += 1;
      const text = blockText(n, "accepted");
      const raw = blockText(n, "raw");
      const tracked = countTracked(n.content);
      const b: DocBlock = {
        id,
        index,
        type: n.type as DocBlock["type"],
        text,
        wordCount: wordCount(text),
        comments: countMarks(n.content, "comment"),
        section: n.type === "heading" ? undefined : currentSection?.id,
      };
      if (raw !== text) b.rawText = raw;
      if (n.type === "heading") b.level = Number(n.attrs?.level ?? 1);
      if (n.attrs?.pStyle) b.pStyle = String(n.attrs.pStyle);
      if (n.attrs?.textAlign && n.attrs.textAlign !== "left") b.align = String(n.attrs.textAlign);
      if (ctx.list) b.listInfo = ctx.list;
      if (ctx.table) b.table = ctx.table;
      const marks = summarizeMarks(n.content);
      if (marks.length) b.marks = marks;
      const fn = countMarks(n.content, "footnote");
      if (fn) b.footnotes = fn;
      if (tracked.insertions || tracked.deletions) b.tracked = tracked;
      if (n.type === "image") b.image = { src: String(n.attrs?.src ?? ""), alt: n.attrs?.alt ? String(n.attrs.alt) : undefined, width: n.attrs?.width ? Number(n.attrs.width) : undefined };
      blocks.push(b);
      if (n.type === "heading") {
        closeSection();
        currentSection = { id, title: text, level: b.level ?? 1, index, wordCount: 0, blockCount: 0, start: index, end: index };
        sections.push(currentSection);
        b.section = id;
      } else if (currentSection) currentSection.wordCount += b.wordCount;
      return;
    }
    if (n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") {
      const depth = (ctx.list?.depth ?? 0) + 1;
      const style = String(n.attrs?.listStyle ?? "");
      const kind: ListInfo["kind"] = n.type === "orderedList" && (style === "legal" || style === "outline" || style === "alpha" || style === "roman") ? (style as ListInfo["kind"]) : LIST_KIND[n.type];
      let position = Number(n.attrs?.start ?? 1) - 1;
      for (const item of n.content ?? []) {
        position += 1;
        walk(item, { ...ctx, list: { kind, depth, position } });
      }
      return;
    }
    if (n.type === "table") {
      const tableId = String(n.attrs?.id ?? "");
      (n.content ?? []).forEach((row, r) => {
        (row.content ?? []).forEach((cell, c) => {
          walk(cell, { ...ctx, table: { tableId, row: r + 1, col: c + 1, header: cell.type === "tableHeader" } });
        });
      });
      return;
    }
    for (const c of n.content ?? []) walk(c, ctx);
  };
  walk(doc, { listCounters: [] });
  closeSection();
  return { blocks, sections };
}

function countMarks(content: PMNode[] | undefined, type: string): number {
  const ids = new Set<string>();
  let n = 0;
  for (const c of content ?? []) {
    for (const m of c.marks ?? []) {
      if (m.type !== type) continue;
      const id = String(m.attrs?.id ?? "");
      if (id) { if (!ids.has(id)) { ids.add(id); n++; } } else n++;
    }
    if (c.content) n += countMarks(c.content, type);
  }
  return n;
}

function countTracked(content: PMNode[] | undefined): { insertions: number; deletions: number } {
  const ins = new Set<string>(); const del = new Set<string>();
  for (const c of content ?? []) {
    for (const m of c.marks ?? []) {
      if (m.type === "insertion") ins.add(String(m.attrs?.id ?? c.text));
      if (m.type === "deletion") del.add(String(m.attrs?.id ?? c.text));
    }
  }
  return { insertions: ins.size, deletions: del.size };
}

// ---------------------------------------------------------------------------
// Document statistics
// ---------------------------------------------------------------------------

export interface DocStats { words: number; characters: number; paragraphs: number; headings: number; tables: number; images: number; lists: number; footnotes: number; comments: number; insertions: number; deletions: number; pageBreaks: number }

export function docStats(doc: PMNode): DocStats {
  const s: DocStats = { words: 0, characters: 0, paragraphs: 0, headings: 0, tables: 0, images: 0, lists: 0, footnotes: 0, comments: 0, insertions: 0, deletions: 0, pageBreaks: 0 };
  const ins = new Set<string>(); const del = new Set<string>(); const cm = new Set<string>(); const fn = new Set<string>();
  const walk = (n: PMNode) => {
    switch (n.type) {
      case "paragraph": s.paragraphs++; break;
      case "heading": s.headings++; break;
      case "table": s.tables++; break;
      case "image": s.images++; break;
      case "bulletList": case "orderedList": case "taskList": s.lists++; break;
      case "pageBreak": s.pageBreaks++; break;
      case "text": {
        if (!hasMark(n, "deletion")) { const t = n.text ?? ""; s.characters += t.length; s.words += wordCount(t); }
        for (const m of n.marks ?? []) {
          const id = String(m.attrs?.id ?? n.text);
          if (m.type === "insertion") ins.add(id);
          else if (m.type === "deletion") del.add(id);
          else if (m.type === "comment") cm.add(id);
          else if (m.type === "footnote") fn.add(id);
        }
        break;
      }
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  s.insertions = ins.size; s.deletions = del.size; s.comments = cm.size; s.footnotes = fn.size;
  return s;
}

/** Word-count based page estimate (≈ 500 words / page for 12pt double-spaced legal text). */
export function estimatePages(stats: DocStats, wordsPerPage = 480): number {
  return Math.max(1, Math.ceil(stats.words / wordsPerPage) + stats.pageBreaks);
}

// ---------------------------------------------------------------------------
// Lookup / mutation on JSON trees
// ---------------------------------------------------------------------------

export interface NodeLocation { node: PMNode; parent: PMNode; indexInParent: number; ancestors: PMNode[] }

export function findNodeById(doc: PMNode, id: string): NodeLocation | null {
  const stack: PMNode[] = [];
  let found: NodeLocation | null = null;
  const walk = (n: PMNode): boolean => {
    stack.push(n);
    const content = n.content ?? [];
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (c.attrs?.id === id) { found = { node: c, parent: n, indexInParent: i, ancestors: [...stack] }; return true; }
      if (c.content && walk(c)) return true;
    }
    stack.pop();
    return false;
  };
  walk(doc);
  return found;
}

/** All footnotes in document order: [{id, text, index}] */
export function collectFootnotes(doc: PMNode): { id: string; text: string; index: number; anchor: string }[] {
  const out: { id: string; text: string; index: number; anchor: string }[] = [];
  const seen = new Set<string>();
  const walk = (n: PMNode) => {
    if (n.type === "text") {
      const fm = n.marks?.find((m) => m.type === "footnote");
      if (fm) {
        const id = String(fm.attrs?.id ?? "");
        if (!seen.has(id)) { seen.add(id); out.push({ id, text: String(fm.attrs?.text ?? ""), index: out.length + 1, anchor: n.text ?? "" }); }
      }
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

/** Tracked changes in document order, grouped by change id. A deletion and an insertion sharing an id form one "replacement". */
export interface TrackedChange { id: string; kind: "insertion" | "deletion" | "replacement"; author: string; date: string; text: string; deletedText: string; insertedText: string; blockId: string }

export function collectTrackedChanges(doc: PMNode): TrackedChange[] {
  const out: TrackedChange[] = [];
  const byId = new Map<string, TrackedChange>();
  const walk = (n: PMNode, blockId: string) => {
    const bid = LEAF_BLOCK_TYPES.has(n.type) ? String(n.attrs?.id ?? blockId) : blockId;
    if (n.type === "text") {
      for (const m of n.marks ?? []) {
        if (m.type !== "insertion" && m.type !== "deletion") continue;
        const id = String(m.attrs?.id ?? "");
        let c = byId.get(id);
        if (!c) { c = { id, kind: m.type, author: String(m.attrs?.author ?? "Unknown"), date: String(m.attrs?.date ?? ""), text: "", deletedText: "", insertedText: "", blockId: bid }; byId.set(id, c); out.push(c); }
        if (m.type === "insertion") c.insertedText += n.text ?? ""; else c.deletedText += n.text ?? "";
        c.kind = c.insertedText && c.deletedText ? "replacement" : c.insertedText ? "insertion" : "deletion";
        c.text = c.kind === "replacement" ? `${c.deletedText} → ${c.insertedText}` : c.insertedText || c.deletedText;
      }
    }
    for (const c of n.content ?? []) walk(c, bid);
  };
  walk(doc, "");
  return out;
}

// ---------------------------------------------------------------------------
// Markdown / text conversion
// ---------------------------------------------------------------------------

/** Markdown → block nodes (with ids). Supports headings, lists, tables, quotes, code, rules. */
export function markdownToBlocks(markdown: string): PMNode[] {
  const doc = markdownToDoc(markdown);
  return ensureBlockIds(doc).content ?? [];
}

/** Inline markdown (bold/italic/code/link/strike) → text nodes. */
export function inlineFromMarkdown(markdown: string): PMNode[] {
  return inline(markdown.replace(/\s*\n\s*/g, " ").trim());
}

/** Build a paragraph/heading with inline markdown. */
export function makeParagraph(markdown: string, attrs: Record<string, unknown> = {}): PMNode {
  return { type: "paragraph", attrs: { id: newId(), ...attrs }, content: inlineFromMarkdown(markdown) };
}

export function makeHeading(text: string, level: 1 | 2 | 3, attrs: Record<string, unknown> = {}): PMNode {
  return { type: "heading", attrs: { id: newId(), level, ...attrs }, content: inlineFromMarkdown(text) };
}

export function makeTable(header: string[], rows: string[][], opts: { widths?: number[] } = {}): PMNode {
  const cell = (text: string, type: "tableHeader" | "tableCell", i: number): PMNode => ({ type, attrs: { id: newId(), colspan: 1, rowspan: 1, colwidth: opts.widths?.[i] ? [opts.widths[i]] : null }, content: [makeParagraph(text)] });
  return {
    type: "table",
    attrs: { id: newId() },
    content: [
      { type: "tableRow", attrs: { id: newId() }, content: header.map((h, i) => cell(h, "tableHeader", i)) },
      ...rows.map((r) => ({ type: "tableRow", attrs: { id: newId() }, content: header.map((_, i) => cell(r[i] ?? "", "tableCell", i)) })),
    ],
  };
}

export function makePageBreak(): PMNode { return { type: "pageBreak", attrs: { id: newId() } }; }

export function makeList(items: string[], kind: "bullet" | "ordered" | "legal" = "bullet"): PMNode {
  return {
    type: kind === "bullet" ? "bulletList" : "orderedList",
    attrs: { id: newId(), ...(kind !== "bullet" ? { start: 1, listStyle: kind === "legal" ? "legal" : "decimal" } : {}) },
    content: items.map((t) => ({ type: "listItem", attrs: { id: newId() }, content: [makeParagraph(t)] })),
  };
}

function inlineToMarkdown(content: PMNode[] | undefined, view: TextView = "accepted"): string {
  let s = "";
  for (const n of content ?? []) {
    if (n.type === "hardBreak") { s += "  \n"; continue; }
    if (n.type !== "text") continue;
    if (view === "accepted" && hasMark(n, "deletion")) continue;
    let t = n.text ?? "";
    const marks = n.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    if (has("code")) t = `\`${t}\``;
    if (has("bold")) t = `**${t}**`;
    if (has("italic")) t = `*${t}*`;
    if (has("strike")) t = `~~${t}~~`;
    if (has("underline")) t = `__${t}__`;
    const link = marks.find((m) => m.type === "link");
    if (link) t = `[${t}](${String(link.attrs?.href ?? "")})`;
    const fn = marks.find((m) => m.type === "footnote");
    if (fn) t = `${t}[^${String(fn.attrs?.id ?? "")}]`;
    s += t;
  }
  return s;
}

/** Serialize the document to GitHub-flavoured Markdown (accepted view). */
export function docToMarkdown(doc: PMNode, opts: { title?: string } = {}): string {
  const lines: string[] = [];
  if (opts.title) lines.push(`# ${opts.title}`, "");
  const walk = (n: PMNode, depth = 0, listPrefix?: (i: number) => string) => {
    switch (n.type) {
      case "heading": lines.push(`${"#".repeat(Math.min(6, Number(n.attrs?.level ?? 1)))} ${inlineToMarkdown(n.content)}`, ""); break;
      case "paragraph": {
        const t = inlineToMarkdown(n.content);
        if (listPrefix) lines.push(`${"  ".repeat(depth - 1)}${listPrefix(0)}${t}`);
        else lines.push(t, "");
        break;
      }
      case "blockquote": for (const c of n.content ?? []) lines.push(`> ${inlineToMarkdown(c.content)}`); lines.push(""); break;
      case "codeBlock": lines.push("```", inlineText(n.content, "raw"), "```", ""); break;
      case "horizontalRule": lines.push("---", ""); break;
      case "pageBreak": lines.push("<div style=\"page-break-after: always\"></div>", ""); break;
      case "image": lines.push(`![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`, ""); break;
      case "bulletList": case "orderedList": case "taskList": {
        const ordered = n.type === "orderedList";
        const start = Number(n.attrs?.start ?? 1);
        (n.content ?? []).forEach((item, i) => {
          const prefix = n.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] ` : ordered ? `${start + i}. ` : "- ";
          let first = true;
          for (const c of item.content ?? []) {
            if (c.type === "paragraph") { lines.push(`${"  ".repeat(depth)}${first ? prefix : "   "}${inlineToMarkdown(c.content)}`); first = false; }
            else walk(c, depth + 1);
          }
        });
        if (depth === 0) lines.push("");
        break;
      }
      case "table": {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inlineToMarkdown(p.content)).join(" ").replace(/\|/g, "\\|")));
        if (!rows.length) break;
        lines.push(`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`);
        for (const r of rows.slice(1)) lines.push(`| ${r.join(" | ")} |`);
        lines.push("");
        break;
      }
      default: for (const c of n.content ?? []) walk(c, depth);
    }
  };
  for (const c of doc.content ?? []) walk(c);
  const fns = collectFootnotes(doc);
  if (fns.length) { lines.push(""); for (const f of fns) lines.push(`[^${f.id}]: ${f.text}`); }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Plain text, one paragraph per line (accepted view). */
export function docToPlainText(doc: PMNode): string {
  const out: string[] = [];
  const walk = (n: PMNode, prefix = "") => {
    if (TEXTBLOCK_TYPES.has(n.type)) { out.push(prefix + inlineText(n.content)); return; }
    if (n.type === "image") { out.push(`[Image${n.attrs?.alt ? `: ${String(n.attrs.alt)}` : ""}]`); return; }
    if (n.type === "pageBreak") { out.push("\f"); return; }
    if (n.type === "horizontalRule") { out.push("———"); return; }
    if (n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") {
      const ordered = n.type === "orderedList";
      (n.content ?? []).forEach((item, i) => {
        (item.content ?? []).forEach((c, j) => walk(c, j === 0 ? `${prefix}${ordered ? `${i + 1}. ` : "• "}` : `${prefix}   `));
      });
      return;
    }
    if (n.type === "table") {
      for (const r of n.content ?? []) out.push((r.content ?? []).map((c) => (c.content ?? []).map((p) => inlineText(p.content)).join(" ")).join("\t"));
      return;
    }
    for (const c of n.content ?? []) walk(c, prefix);
  };
  for (const c of doc.content ?? []) walk(c);
  const fns = collectFootnotes(doc);
  if (fns.length) { out.push(""); for (const f of fns) out.push(`${f.index}. ${f.text}`); }
  return out.join("\n");
}

/** Paragraph-level text lines (for version diffs). */
export function docToLines(doc: PMNode): string[] {
  return docToPlainText(doc).split("\n");
}

// ---------------------------------------------------------------------------
// Style application on JSON nodes (mirrors the client's set_style command)
// ---------------------------------------------------------------------------

export function styleOfBlock(node: PMNode, listInfo?: ListInfo): ParagraphStyle {
  if (node.type === "heading") { const l = Number(node.attrs?.level ?? 1); if (node.attrs?.pStyle === "title") return "title"; return (`heading${Math.min(3, l)}`) as ParagraphStyle; }
  if (node.attrs?.pStyle === "title") return "title";
  if (node.attrs?.pStyle === "caption") return "caption";
  if (listInfo) return listInfo.kind === "bullet" ? "bullet_list" : listInfo.kind === "legal" || listInfo.kind === "outline" ? "legal_numbered" : "numbered_list";
  return "body";
}

export const PARAGRAPH_STYLES: { id: ParagraphStyle; label: string; shortcut?: string }[] = [
  { id: "body", label: "Body text", shortcut: "⌘⌥0" },
  { id: "title", label: "Title" },
  { id: "heading1", label: "Heading 1", shortcut: "⌘⌥1" },
  { id: "heading2", label: "Heading 2", shortcut: "⌘⌥2" },
  { id: "heading3", label: "Heading 3", shortcut: "⌘⌥3" },
  { id: "blockquote", label: "Block quote" },
  { id: "caption", label: "Caption" },
  { id: "legal_numbered", label: "Legal numbered" },
  { id: "bullet_list", label: "Bullet list" },
  { id: "numbered_list", label: "Numbered list" },
];

// ---------------------------------------------------------------------------
// Inline find / replace on JSON inline content (marks preserved)
// ---------------------------------------------------------------------------

export interface Span { text: string; marks?: PMNode["marks"]; node?: PMNode }

/** Inline content → spans (hardBreak becomes a "\n" span carrying the node). */
export function toSpans(content: PMNode[] | undefined): Span[] {
  const out: Span[] = [];
  for (const n of content ?? []) {
    if (n.type === "text") out.push({ text: n.text ?? "", marks: n.marks });
    else if (n.type === "hardBreak") out.push({ text: "\n", node: n });
    else if (n.content) out.push(...toSpans(n.content));
  }
  return out;
}

export function spansText(spans: Span[]) { return spans.map((s) => s.text).join(""); }

/** Slice spans by character offsets into text nodes. */
export function sliceSpans(spans: Span[], from: number, to: number): PMNode[] {
  const out: PMNode[] = [];
  let pos = 0;
  for (const s of spans) {
    const start = pos, end = pos + s.text.length;
    pos = end;
    if (end <= from || start >= to) continue;
    const a = Math.max(from, start) - start, b = Math.min(to, end) - start;
    if (s.node) { out.push(cloneNode(s.node)); continue; }
    const t = s.text.slice(a, b);
    if (t) out.push({ type: "text", text: t, ...(s.marks?.length ? { marks: cloneNode(s.marks) } : {}) });
  }
  return out;
}

function marksKey(m: PMNode["marks"]) { return JSON.stringify((m ?? []).map((x) => [x.type, x.attrs ?? {}]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))); }

/** Merge adjacent text nodes with identical marks and drop empties. */
export function normalizeInline(content: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of content) {
    if (n.type === "text" && !n.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === "text" && n.type === "text" && marksKey(last.marks) === marksKey(n.marks)) { last.text = (last.text ?? "") + (n.text ?? ""); continue; }
    out.push(n);
  }
  return out;
}

export function addMarkToInline(content: PMNode[], mark: { type: string; attrs?: Record<string, unknown> }, opts: { remove?: string[] } = {}): PMNode[] {
  return content.map((n) => {
    if (n.type !== "text") return n;
    const marks = (n.marks ?? []).filter((m) => m.type !== mark.type && !(opts.remove ?? []).includes(m.type));
    return { ...n, marks: [...marks, cloneNode(mark)] };
  });
}

export function buildFindRegex(find: string, opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; all?: boolean } = {}): RegExp | null {
  if (!find) return null;
  let src = opts.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try { return new RegExp(src, `${opts.all === false ? "" : "g"}u${opts.caseSensitive ? "" : "i"}`); } catch { return null; }
}

/**
 * Replace text inside inline content while keeping marks: the replacement
 * inherits the marks at the start of the match. Returns the new content and
 * the number of replacements.
 */
export function replaceInInline(content: PMNode[] | undefined, find: string, replace: string, opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; all?: boolean } = {}): { content: PMNode[]; count: number } {
  const spans = toSpans(content);
  const text = spansText(spans);
  const re = buildFindRegex(find, { ...opts, all: opts.all !== false });
  if (!re) return { content: content ?? [], count: 0 };
  const out: PMNode[] = [];
  let last = 0; let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out.push(...sliceSpans(spans, last, m.index));
    const marksAt = marksAtOffset(spans, m.index);
    const rep = opts.regex ? m[0].replace(re.source ? new RegExp(re.source, re.flags.replace("g", "")) : re, replace) : replace;
    if (rep) out.push({ type: "text", text: rep, ...(marksAt?.length ? { marks: cloneNode(marksAt) } : {}) });
    last = m.index + m[0].length;
    count++;
    if (opts.all === false) break;
  }
  out.push(...sliceSpans(spans, last, text.length));
  return { content: normalizeInline(out), count };
}

export function marksAtOffset(spans: Span[], offset: number): PMNode["marks"] | undefined {
  let pos = 0;
  for (const s of spans) { const end = pos + s.text.length; if (offset >= pos && offset < end) return s.marks; pos = end; }
  return spans[spans.length - 1]?.marks;
}

/** Find all matches of `find` in inline content → [{from,to,text}] character offsets. */
export function findInInline(content: PMNode[] | undefined, find: string, opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean } = {}): { from: number; to: number; match: string }[] {
  const text = spansText(toSpans(content));
  const re = buildFindRegex(find, { ...opts, all: true });
  if (!re) return [];
  const out: { from: number; to: number; match: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { if (m[0] === "") { re.lastIndex++; continue; } out.push({ from: m.index, to: m.index + m[0].length, match: m[0] }); }
  return out;
}

/** Add marks to every match of `find` in inline content. */
export function markInInline(content: PMNode[] | undefined, find: string, marks: { type: string; attrs?: Record<string, unknown> }[], opts: { regex?: boolean; caseSensitive?: boolean; all?: boolean; remove?: string[] } = {}): { content: PMNode[]; count: number } {
  const spans = toSpans(content);
  const text = spansText(spans);
  const matches = findInInline(content, find, opts);
  if (!matches.length) return { content: content ?? [], count: 0 };
  const use = opts.all === false ? matches.slice(0, 1) : matches;
  const out: PMNode[] = [];
  let last = 0;
  for (const m of use) {
    out.push(...sliceSpans(spans, last, m.from));
    let seg = sliceSpans(spans, m.from, m.to);
    for (const mk of marks) seg = addMarkToInline(seg, mk, { remove: opts.remove });
    out.push(...seg);
    last = m.to;
  }
  out.push(...sliceSpans(spans, last, text.length));
  return { content: normalizeInline(out), count: use.length };
}

/** Citation-like strings (case reporters, statutes, CFR, rules) with offsets. */
export const CITATION_REGEX = /\b\d{1,4}\s+(?:U\.S\.|S\.\s?Ct\.|F\.(?:2d|3d|4th)?|F\.\s?Supp\.(?:\s?[23]d)?|F\.R\.D\.|U\.S\.C\.|C\.F\.R\.|Cal\.(?:\s?App\.)?\s?(?:[2345]th|2d|3d)?|N\.E\.(?:2d|3d)?|S\.E\.(?:2d)?|P\.(?:2d|3d)?|A\.(?:2d|3d)?|So\.\s?(?:2d|3d)?|N\.W\.(?:2d)?|S\.W\.(?:2d|3d)?|N\.Y\.S\.(?:2d|3d)?|WL)\s+(?:§+\s*)?[\d,-]+(?:\([a-z0-9]+\))*(?:,\s*\d+(?:-\d+)?)?(?:\s*\([^)]{1,60}\))?/g;

export function findCitations(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(CITATION_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0].trim());
  const rules = text.match(/\b(?:Fed\.\s?R\.\s?(?:Civ|Evid|App|Crim)\.\s?P\.|FRCP|FRE|Local\s+(?:Civil\s+)?Rule)\s*\d+(?:\.\d+)?(?:\([a-z0-9]+\))*/g) ?? [];
  return [...out, ...rules];
}

export const PLACEHOLDER_REGEX = /\[(?:[A-Z][A-Z0-9 ,.'’\-/&()]{1,60}|VERIFY|TBD|CITE|CITATION NEEDED|INSERT[^\]]{0,40})\]/g;

export function findPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_REGEX) ?? [];
}
