/**
 * Word agent tools. Read tools answer from the snapshot; edit tools register an
 * EditProposal through ctx.propose AND mutate the snapshot so later reads see
 * the new state. Side-effecting dependencies (image generation, citation
 * verification, paragraph polishing) are injected so the tools stay testable.
 */
import { nanoid } from "nanoid";
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import { findCitations, findPlaceholders, flattenBlocks, inlineFromMarkdown, inlineText, makeParagraph, makeTable, markdownToBlocks, newId, wordCount, type ParagraphStyle, type PMNode } from "./doc-model";
import { buildTemplateSection, tableOfContents, TEMPLATE_SECTIONS, type TemplateSectionId } from "./sections";
import { reindexSnapshot, sectionBlocks, type SnapshotBlock, type WordSnapshot } from "./snapshot";

export interface WordToolDeps {
  /** Generate an image for a prompt; returns a URL the editor can load (blob url). */
  generateImage?: (prompt: string, size: "1024x1024" | "1536x1024" | "1024x1536") => Promise<{ url: string; blobId?: string }>;
  /** Resolve citations found in text (CourtListener). */
  verifyCitations?: (text: string) => Promise<{ citations: { citation: string; resolved: boolean; matches?: { case_name?: string; url?: string; date_filed?: string }[] }[] }>;
  /** Rewrite paragraphs for polish goals (model call). */
  polishParagraphs?: (paragraphs: { id: string; text: string }[], goals: string[], context: { title: string; sectionTitle: string; matter?: string }) => Promise<{ id: string; markdown: string; note?: string }[]>;
}

type Ctx = OfficeAgentContext<WordSnapshot>;

const STYLE_VALUES: ParagraphStyle[] = ["title", "heading1", "heading2", "heading3", "body", "blockquote", "caption", "legal_numbered", "bullet_list", "numbered_list"];

export function isWordEditingTool(name: string) {
  return !/^(get_|find_text$)/.test(name);
}

/** Convert PM block nodes → snapshot blocks (ids preserved). */
export function blocksToSnapshot(nodes: PMNode[]): SnapshotBlock[] {
  return flattenBlocks({ type: "doc", content: nodes }).blocks;
}

function getBlock(s: WordSnapshot, id: string): { block: SnapshotBlock; i: number } {
  const i = s.blocks.findIndex((b) => b.id === id);
  if (i < 0) throw new Error(`No block with id "${id}". Use get_outline or find_text to look up ids.`);
  return { block: s.blocks[i], i };
}

function label(b: SnapshotBlock) { return `¶${b.index}`; }
function preview(t: string, n = 160) { return t.length > n ? `${t.slice(0, n)}…` : t; }

function insertBlocksAt(s: WordSnapshot, i: number, nodes: PMNode[]) {
  const blocks = blocksToSnapshot(nodes);
  s.blocks.splice(i, 0, ...blocks);
  reindexSnapshot(s);
  return blocks;
}

export function wordAgentTools(ctx: Ctx, deps: WordToolDeps = {}): ToolDef<never, unknown>[] {
  const s = ctx.snapshot;
  const author = "Drafting assistant";
  const propose = (p: Omit<EditProposal, "id" | "status">) => ctx.propose(p);

  // ------------------------------------------------------------------ reads
  const get_outline = defineTool<Record<string, never>>({
    name: "get_outline",
    description: "Document outline: every heading with its id, level, ¶ index, word count and block count. Use heading ids as section scope for get_section/polish_section.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading outline",
    execute: () => ({ title: s.title, sections: s.sections.map((x) => ({ id: x.id, level: x.level, index: x.index, title: x.title, words: x.wordCount, blocks: x.blockCount })), totals: { blocks: s.blocks.length, words: s.stats.words, pages: s.stats.pages } }),
  });

  const get_paragraphs = defineTool<{ from_index?: number; to_index?: number; ids?: string[] }>({
    name: "get_paragraphs",
    description: "Full text of blocks by ¶ index range (from_index..to_index, 1-based, inclusive, max 80) or by ids. Returns id, index, type, style, list/table context, text and inline formatting notes.",
    parameters: { type: "object", properties: { from_index: { type: "integer" }, to_index: { type: "integer" }, ids: { type: "array", items: { type: "string" } } }, required: [] },
    label: (a) => a.ids?.length ? `Reading ${a.ids.length} block${a.ids.length > 1 ? "s" : ""}` : `Reading ¶${a.from_index ?? 1}–${a.to_index ?? ""}`,
    execute: ({ from_index, to_index, ids }) => {
      let blocks: SnapshotBlock[];
      if (ids?.length) blocks = ids.map((id) => s.blocks.find((b) => b.id === id)).filter((b): b is SnapshotBlock => Boolean(b));
      else { const from = Math.max(1, from_index ?? 1); const to = Math.min(s.blocks.length, to_index ?? from + 39, from + 79); blocks = s.blocks.filter((b) => b.index >= from && b.index <= to); }
      return { blocks: blocks.map(fullBlock) };
    },
  });

  const get_section = defineTool<{ heading_id: string }>({
    name: "get_section",
    description: "Full text of a section: the heading and every block until the next heading of the same or higher level.",
    parameters: { type: "object", properties: { heading_id: { type: "string" } }, required: ["heading_id"] },
    label: () => "Reading section",
    execute: ({ heading_id }) => {
      const blocks = sectionBlocks(s, heading_id);
      if (!blocks.length) throw new Error(`No heading with id "${heading_id}"`);
      return { heading: blocks[0].text, blocks: blocks.map(fullBlock), words: blocks.reduce((n, b) => n + b.wordCount, 0) };
    },
  });

  const find_text = defineTool<{ query: string; regex?: boolean; case_sensitive?: boolean; whole_word?: boolean; limit?: number }>({
    name: "find_text",
    description: "Search the document text. Returns matching blocks with id, ¶ index, the match and surrounding context. Supports regex. Use before replace_text_in_paragraph / find_replace_all.",
    parameters: { type: "object", properties: { query: { type: "string" }, regex: { type: "boolean" }, case_sensitive: { type: "boolean" }, whole_word: { type: "boolean" }, limit: { type: "integer" } }, required: ["query"] },
    label: (a) => `Searching "${preview(a.query, 40)}"`,
    execute: ({ query, regex, case_sensitive, whole_word, limit }) => {
      const re = safeRegex(query, { regex, caseSensitive: case_sensitive, wholeWord: whole_word });
      if (!re) throw new Error("Invalid regular expression");
      const out: { id: string; index: number; match: string; context: string; type: string }[] = [];
      for (const b of s.blocks) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(b.text)) && out.length < (limit ?? 40)) {
          if (m[0] === "") { re.lastIndex++; continue; }
          const a = Math.max(0, m.index - 80), z = Math.min(b.text.length, m.index + m[0].length + 80);
          out.push({ id: b.id, index: b.index, match: m[0], context: `${a > 0 ? "…" : ""}${b.text.slice(a, z)}${z < b.text.length ? "…" : ""}`, type: b.type });
        }
        if (out.length >= (limit ?? 40)) break;
      }
      return { count: out.length, matches: out };
    },
  });

  const get_selection = defineTool<Record<string, never>>({
    name: "get_selection",
    description: "The user's current text selection (text and containing block ids), if any.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading selection",
    execute: () => (s.selection?.text ? { text: s.selection.text, block_ids: s.selection.blockIds, blocks: s.selection.blockIds.map((id) => s.blocks.find((b) => b.id === id)).filter(Boolean).map((b) => fullBlock(b!)) } : { text: "", block_ids: [], note: "No selection. Ask the user or use scope." }),
  });

  const get_comments = defineTool<{ include_resolved?: boolean }>({
    name: "get_comments",
    description: "Comments on the document (anchor block id, author, body, quote, resolved).",
    parameters: { type: "object", properties: { include_resolved: { type: "boolean" } }, required: [] },
    label: () => "Reading comments",
    execute: ({ include_resolved }) => ({ comments: (s.comments ?? []).filter((c) => include_resolved || !c.resolved).map((c) => ({ ...c, block: s.blocks.find((b) => b.id === c.anchor)?.index })) }),
  });

  const get_document_stats = defineTool<Record<string, never>>({
    name: "get_document_stats",
    description: "Word/character/paragraph counts, page estimate, tables, images, footnotes, comments, pending tracked changes, page setup and defined terms / placeholders / citations detected.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Computing statistics",
    execute: () => {
      const all = s.blocks.map((b) => b.text).join("\n");
      const definedTerms = Array.from(new Set((all.match(/[“"(]\s*(?:the\s+)?“?([A-Z][A-Za-z0-9 -]{1,40})”\s*\)?/g) ?? []).map((m) => m.replace(/^[“"(]\s*(?:the\s+)?“?/, "").replace(/”\s*\)?$/, "")))).slice(0, 60);
      return { ...s.stats, page: s.page, track_changes_on: s.trackChangesOn, defined_terms: definedTerms, placeholders: Array.from(new Set(findPlaceholders(all))).slice(0, 60), citations: Array.from(new Set(findCitations(all))).slice(0, 80) };
    },
  });

  // ------------------------------------------------------------------ edits
  const rewrite_paragraph = defineTool<{ id: string; markdown: string; reason?: string }>({
    name: "rewrite_paragraph",
    description: "Replace the full text of one block (paragraph, heading or list item) with new inline markdown (**bold**, *italic*, __underline__, [text](url)). The change is applied as a tracked change (word-level diff). Prefer replace_text_in_paragraph when only a phrase changes. Do not include a heading marker (#) — use set_style to change style.",
    parameters: { type: "object", properties: { id: { type: "string" }, markdown: { type: "string" }, reason: { type: "string", description: "Short reason shown to the user" } }, required: ["id", "markdown"] },
    label: () => "Rewriting paragraph",
    execute: ({ id, markdown, reason }) => {
      const { block } = getBlock(s, id);
      if (block.type !== "paragraph" && block.type !== "heading" && block.type !== "codeBlock") throw new Error(`Block ${id} is a ${block.type}; rewrite only applies to text blocks.`);
      const md = markdown.replace(/^#{1,6}\s+/, "").trim();
      const newText = inlineText(inlineFromMarkdown(md), "raw");
      const old = block.text;
      const p = propose({ kind: "rewrite_paragraph", title: `Rewrite ${label(block)}`, summary: `${reason ? `${reason}\n` : ""}− ${preview(old, 220)}\n+ ${preview(newText, 220)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, markdown: md, text: newText, oldText: old }, risk: block.type === "heading" ? "medium" : "low" });
      block.text = newText; block.rawText = undefined; block.wordCount = wordCount(newText); block.marks = undefined;
      reindexSnapshot(s);
      return { proposal: p.id, id: block.id, index: block.index, new_text: newText };
    },
  });

  const replace_text_in_paragraph = defineTool<{ id: string; find: string; replace: string; all?: boolean; regex?: boolean; case_sensitive?: boolean }>({
    name: "replace_text_in_paragraph",
    description: "Replace a phrase inside one block (minimal diff; inline formatting of surrounding text is preserved). Use find_text first to confirm the exact phrase. all=true replaces every occurrence in that block.",
    parameters: { type: "object", properties: { id: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, all: { type: "boolean" }, regex: { type: "boolean" }, case_sensitive: { type: "boolean" } }, required: ["id", "find", "replace"] },
    label: (a) => `Replacing "${preview(a.find, 30)}"`,
    execute: ({ id, find, replace, all, regex, case_sensitive }) => {
      const { block } = getBlock(s, id);
      const re = safeRegex(find, { regex, caseSensitive: case_sensitive, all: all !== false });
      if (!re) throw new Error("Invalid find pattern");
      if (!re.test(block.text)) throw new Error(`"${find}" not found in ¶${block.index}. Current text: ${preview(block.text, 300)}`);
      re.lastIndex = 0;
      const newText = all === false ? block.text.replace(re, replace) : block.text.replace(re, replace);
      const count = (block.text.match(re) ?? []).length || 1;
      const p = propose({ kind: "replace_text_in_paragraph", title: `Replace in ${label(block)}`, summary: `“${preview(find, 80)}” → “${preview(replace, 80)}”${count > 1 ? ` (${count}×)` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, find, replace, all: all !== false, regex: Boolean(regex), caseSensitive: Boolean(case_sensitive), oldText: block.text, text: newText }, risk: "low" });
      block.text = newText; block.wordCount = wordCount(newText);
      return { proposal: p.id, replaced: count, new_text: newText };
    },
  });

  const makeInsert = (name: "insert_after" | "insert_before") => defineTool<{ id: string; markdown: string; reason?: string }>({
    name,
    description: `Insert new content ${name === "insert_after" ? "after" : "before"} the block with the given id. Markdown may contain several blocks: paragraphs, # headings, - bullets, 1. numbered items, > quotes, | tables |, --- rules. Each block gets an id you can reference afterwards. New text is marked as a tracked insertion.`,
    parameters: { type: "object", properties: { id: { type: "string" }, markdown: { type: "string" }, reason: { type: "string" } }, required: ["id", "markdown"] },
    label: () => name === "insert_after" ? "Inserting content" : "Inserting content before",
    execute: ({ id, markdown, reason }) => {
      const { block, i } = getBlock(s, id);
      const nodes = markdownToBlocks(markdown);
      if (!nodes.length) throw new Error("markdown produced no blocks");
      const at = name === "insert_after" ? i + 1 : i;
      const blocks = insertBlocksAt(s, at, nodes);
      const p = propose({ kind: name, title: `Insert ${blocks.length} block${blocks.length > 1 ? "s" : ""} ${name === "insert_after" ? "after" : "before"} ${label(block)}`, summary: `${reason ? `${reason}\n` : ""}${preview(blocks.map((b) => b.text).join(" ¶ "), 260)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, blocks: nodes, markdown, blockIds: blocks.map((b) => b.id) }, risk: "low" });
      return { proposal: p.id, inserted: blocks.map((b) => ({ id: b.id, index: b.index, type: b.type, text: preview(b.text, 80) })) };
    },
  });

  const delete_paragraph = defineTool<{ id: string; reason?: string }>({
    name: "delete_paragraph",
    description: "Delete a block (tracked as a deletion when track changes is on).",
    parameters: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id"] },
    label: () => "Deleting block",
    execute: ({ id, reason }) => {
      const { block, i } = getBlock(s, id);
      const p = propose({ kind: "delete_paragraph", title: `Delete ${label(block)}`, summary: `${reason ? `${reason}\n` : ""}− ${preview(block.text, 200)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, oldText: block.text }, risk: block.type === "heading" ? "high" : "medium" });
      s.blocks.splice(i, 1);
      reindexSnapshot(s);
      return { proposal: p.id, deleted: block.id };
    },
  });

  const move_block = defineTool<{ id: string; after_id: string }>({
    name: "move_block",
    description: "Move a block so it follows another block (after_id). Use \"start\" as after_id to move to the top of the document.",
    parameters: { type: "object", properties: { id: { type: "string" }, after_id: { type: "string" } }, required: ["id", "after_id"] },
    label: () => "Moving block",
    execute: ({ id, after_id }) => {
      const { block, i } = getBlock(s, id);
      s.blocks.splice(i, 1);
      let at = 0;
      if (after_id !== "start") { const t = s.blocks.findIndex((b) => b.id === after_id); if (t < 0) { s.blocks.splice(i, 0, block); throw new Error(`No block with id "${after_id}"`); } at = t + 1; }
      s.blocks.splice(at, 0, block);
      reindexSnapshot(s);
      const p = propose({ kind: "move_block", title: `Move block to ${label(block)}`, summary: preview(block.text, 160), target: block.id, targetLabel: label(block), payload: { id: block.id, afterId: after_id }, risk: "medium" });
      return { proposal: p.id, new_index: block.index };
    },
  });

  const set_style = defineTool<{ id: string; style: ParagraphStyle }>({
    name: "set_style",
    description: "Set the paragraph style of a block: title | heading1 | heading2 | heading3 | body | blockquote | caption | legal_numbered (1., 1.1, 1.1.1) | bullet_list | numbered_list.",
    parameters: { type: "object", properties: { id: { type: "string" }, style: { type: "string", enum: STYLE_VALUES } }, required: ["id", "style"] },
    label: (a) => `Style → ${a.style}`,
    execute: ({ id, style }) => {
      const { block } = getBlock(s, id);
      if (!STYLE_VALUES.includes(style)) throw new Error(`Unknown style ${style}`);
      const p = propose({ kind: "set_style", title: `Style ${label(block)} → ${style.replace(/_/g, " ")}`, summary: preview(block.text, 120), target: block.id, targetLabel: label(block), payload: { id: block.id, style }, risk: "low" });
      if (style.startsWith("heading")) { block.type = "heading"; block.level = Number(style.slice(-1)); block.pStyle = undefined; block.listInfo = undefined; }
      else if (style === "title") { block.type = "heading"; block.level = 1; block.pStyle = "title"; block.listInfo = undefined; }
      else { block.type = "paragraph"; block.level = undefined; block.pStyle = style === "caption" ? "caption" : style === "blockquote" ? "blockquote" : undefined; block.listInfo = style === "bullet_list" ? { kind: "bullet", depth: 1, position: 1 } : style === "numbered_list" ? { kind: "ordered", depth: 1, position: 1 } : style === "legal_numbered" ? { kind: "legal", depth: 1, position: 1 } : undefined; }
      reindexSnapshot(s);
      return { proposal: p.id };
    },
  });

  const format_text = defineTool<{ id: string; find: string; marks: { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; highlight?: string | boolean; color?: string; font_size?: string; small_caps?: boolean }; all?: boolean }>({
    name: "format_text",
    description: "Apply inline formatting to a phrase in a block: bold, italic, underline, strike, highlight (true or a color), color (css), font_size (e.g. '11pt'), small_caps. Set a mark false to remove it.",
    parameters: { type: "object", properties: { id: { type: "string" }, find: { type: "string" }, marks: { type: "object", properties: { bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, strike: { type: "boolean" }, highlight: { anyOf: [{ type: "boolean" }, { type: "string" }] }, color: { type: "string" }, font_size: { type: "string" }, small_caps: { type: "boolean" } }, required: [] }, all: { type: "boolean" } }, required: ["id", "find", "marks"] },
    label: () => "Formatting text",
    execute: ({ id, find, marks, all }) => {
      const { block } = getBlock(s, id);
      if (!block.text.toLowerCase().includes(find.toLowerCase())) throw new Error(`"${find}" not found in ¶${block.index}`);
      const clean = Object.fromEntries(Object.entries(marks ?? {}).filter(([, v]) => v !== null && v !== undefined));
      const what = Object.entries(clean).map(([k, v]) => (v === false ? `no ${k}` : k)).join(", ");
      const p = propose({ kind: "format_text", title: `Format “${preview(find, 40)}” in ${label(block)}`, summary: what, target: block.id, targetLabel: label(block), payload: { id: block.id, find, marks: clean, all: all !== false }, risk: "low" });
      block.marks = [...(block.marks ?? []), `${what}: "${preview(find, 40)}"`].slice(-6);
      return { proposal: p.id };
    },
  });

  const set_alignment = defineTool<{ id: string; align: "left" | "center" | "right" | "justify" }>({
    name: "set_alignment",
    description: "Set paragraph alignment.",
    parameters: { type: "object", properties: { id: { type: "string" }, align: { type: "string", enum: ["left", "center", "right", "justify"] } }, required: ["id", "align"] },
    label: (a) => `Align ${a.align}`,
    execute: ({ id, align }) => {
      const { block } = getBlock(s, id);
      const p = propose({ kind: "set_alignment", title: `Align ${label(block)} ${align}`, summary: preview(block.text, 100), target: block.id, targetLabel: label(block), payload: { id: block.id, align }, risk: "low" });
      block.align = align === "left" ? undefined : align;
      return { proposal: p.id };
    },
  });

  const find_replace_all = defineTool<{ find: string; replace: string; regex?: boolean; case_sensitive?: boolean; whole_word?: boolean; scope_heading_id?: string }>({
    name: "find_replace_all",
    description: "Replace every occurrence across the document (or within a section when scope_heading_id is given). Use for defined-term changes, party names, dates. Returns the count and affected blocks.",
    parameters: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" }, regex: { type: "boolean" }, case_sensitive: { type: "boolean" }, whole_word: { type: "boolean" }, scope_heading_id: { type: "string" } }, required: ["find", "replace"] },
    label: (a) => `Replace all "${preview(a.find, 30)}"`,
    execute: ({ find, replace, regex, case_sensitive, whole_word, scope_heading_id }) => {
      const re = safeRegex(find, { regex, caseSensitive: case_sensitive, wholeWord: whole_word, all: true });
      if (!re) throw new Error("Invalid find pattern");
      const targets = scope_heading_id ? sectionBlocks(s, scope_heading_id) : s.blocks;
      let count = 0; const blockIds: string[] = [];
      for (const b of targets) {
        const n = (b.text.match(re) ?? []).length;
        if (!n) continue;
        count += n; blockIds.push(b.id);
        b.text = b.text.replace(re, replace); b.wordCount = wordCount(b.text);
      }
      if (!count) return { count: 0, note: `"${find}" not found` };
      const p = propose({ kind: "find_replace_all", title: `Replace all “${preview(find, 30)}” → “${preview(replace, 30)}”`, summary: `${count} occurrence${count > 1 ? "s" : ""} in ${blockIds.length} block${blockIds.length > 1 ? "s" : ""}${scope_heading_id ? " (section scope)" : ""}`, target: blockIds[0], targetLabel: `¶${s.blocks.find((b) => b.id === blockIds[0])?.index ?? "?"}`, payload: { find, replace, regex: Boolean(regex), caseSensitive: Boolean(case_sensitive), wholeWord: Boolean(whole_word), count, blockIds }, risk: count > 10 ? "medium" : "low" });
      return { proposal: p.id, count, block_ids: blockIds };
    },
  });

  const add_comment = defineTool<{ id: string; text: string; quote?: string }>({
    name: "add_comment",
    description: "Attach a margin comment to a block (optionally anchored to a quoted phrase). Use for [VERIFY] flags, questions for the drafter, and review notes.",
    parameters: { type: "object", properties: { id: { type: "string" }, text: { type: "string" }, quote: { type: "string", description: "Exact phrase in the block to anchor the comment to" } }, required: ["id", "text"] },
    label: () => "Adding comment",
    execute: ({ id, text, quote }) => {
      const { block } = getBlock(s, id);
      const p = propose({ kind: "add_comment", title: `Comment on ${label(block)}`, summary: `${quote ? `“${preview(quote, 60)}”: ` : ""}${preview(text, 200)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, text, quote }, risk: "low" });
      block.comments += 1;
      s.comments = [...(s.comments ?? []), { id: `pending_${p.id}`, anchor: block.id, body: text, author, quote }];
      return { proposal: p.id };
    },
  });

  const insert_table_after = defineTool<{ id: string; header: string[]; rows: string[][]; caption?: string }>({
    name: "insert_table_after",
    description: "Insert a table (header row + rows) after a block, with an optional caption paragraph.",
    parameters: { type: "object", properties: { id: { type: "string" }, header: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } }, caption: { type: "string" } }, required: ["id", "header", "rows"] },
    label: () => "Inserting table",
    execute: ({ id, header, rows, caption }) => {
      const { block, i } = getBlock(s, id);
      const table = makeTable(header, rows);
      const nodes = caption ? [table, makeParagraph(caption, { pStyle: "caption" })] : [table];
      const blocks = insertBlocksAt(s, i + 1, nodes);
      const p = propose({ kind: "insert_table_after", title: `Insert ${header.length}×${rows.length + 1} table after ${label(block)}`, summary: `${header.join(" | ")}${caption ? `\n${caption}` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, blocks: nodes, tableId: table.attrs?.id, blockIds: blocks.map((b) => b.id) }, risk: "low" });
      return { proposal: p.id, table_id: table.attrs?.id, cell_block_ids: blocks.slice(0, 6).map((b) => b.id) };
    },
  });

  const insert_image_after = defineTool<{ id: string; prompt?: string; url?: string; blob_id?: string; caption?: string; width?: number; alt?: string }>({
    name: "insert_image_after",
    description: "Insert an image after a block. Provide one of: prompt (generate an illustration with the image model — good for demonstratives, org charts sketches, exhibits), url (existing image), blob_id (uploaded blob). Optional caption and width in px (default 480).",
    parameters: { type: "object", properties: { id: { type: "string" }, prompt: { type: "string" }, url: { type: "string" }, blob_id: { type: "string" }, caption: { type: "string" }, width: { type: "integer" }, alt: { type: "string" } }, required: ["id"] },
    label: (a) => a.prompt ? "Generating image" : "Inserting image",
    execute: async ({ id, prompt, url, blob_id, caption, width, alt }) => {
      const { block, i } = getBlock(s, id);
      let src = url ?? (blob_id ? `/api/blobs/${blob_id}` : "");
      if (!src && prompt) {
        if (!deps.generateImage) throw new Error("Image generation is not available in this environment.");
        ctx.emit({ type: "status", message: "Generating image…" });
        const r = await deps.generateImage(prompt, "1024x1024");
        src = r.url;
      }
      if (!src) throw new Error("Provide prompt, url or blob_id");
      const image: PMNode = { type: "image", attrs: { id: newId(), src, alt: alt ?? prompt ?? caption ?? "Image", width: width ?? 480, height: null, align: "center", title: caption ?? null } };
      const nodes = caption ? [image, makeParagraph(caption, { pStyle: "caption", textAlign: "center" })] : [image];
      const blocks = insertBlocksAt(s, i + 1, nodes);
      const p = propose({ kind: "insert_image_after", title: `Insert image after ${label(block)}`, summary: `${prompt ? `Generated: ${preview(prompt, 100)}` : src}${caption ? `\n${caption}` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, src, alt: image.attrs?.alt, width: width ?? 480, caption, blocks: nodes, blockIds: blocks.map((b) => b.id) }, risk: "low" });
      return { proposal: p.id, image_block_id: image.attrs?.id, src };
    },
  });

  const insert_diagram_after = defineTool<{ id: string; mermaid: string; caption?: string; width?: number }>({
    name: "insert_diagram_after",
    description: "Insert a diagram (flowchart, timeline, org chart, sequence, gantt) after a block from Mermaid source; the editor renders it to an image. Keep node labels short; quote labels with special characters.",
    parameters: { type: "object", properties: { id: { type: "string" }, mermaid: { type: "string" }, caption: { type: "string" }, width: { type: "integer" } }, required: ["id", "mermaid"] },
    label: () => "Inserting diagram",
    execute: ({ id, mermaid, caption, width }) => {
      const { block, i } = getBlock(s, id);
      const image: PMNode = { type: "image", attrs: { id: newId(), src: "", alt: caption ?? "Diagram", width: width ?? 560, height: null, align: "center", mermaid, title: caption ?? null } };
      const nodes = caption ? [image, makeParagraph(caption, { pStyle: "caption", textAlign: "center" })] : [image];
      const blocks = insertBlocksAt(s, i + 1, nodes);
      const p = propose({ kind: "insert_diagram_after", title: `Insert diagram after ${label(block)}`, summary: `${mermaid.split("\n")[0]}${caption ? `\n${caption}` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, mermaid, caption, width: width ?? 560, blocks: nodes, blockIds: blocks.map((b) => b.id) }, risk: "low" });
      return { proposal: p.id, image_block_id: image.attrs?.id };
    },
  });

  const insert_page_break_after = defineTool<{ id: string }>({
    name: "insert_page_break_after",
    description: "Insert a manual page break after a block.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    label: () => "Inserting page break",
    execute: ({ id }) => {
      const { block, i } = getBlock(s, id);
      const node: PMNode = { type: "pageBreak", attrs: { id: newId() } };
      insertBlocksAt(s, i + 1, [node]);
      const p = propose({ kind: "insert_page_break_after", title: `Page break after ${label(block)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, blocks: [node], blockIds: [node.attrs?.id] }, risk: "low" });
      return { proposal: p.id, block_id: node.attrs?.id };
    },
  });

  const insert_footnote = defineTool<{ id: string; anchor_text: string; footnote_text: string }>({
    name: "insert_footnote",
    description: "Attach a footnote to a phrase in a block. The footnote appears as a superscript number and is listed at the end of the document / exported as a Word footnote.",
    parameters: { type: "object", properties: { id: { type: "string" }, anchor_text: { type: "string", description: "Exact phrase in the block the footnote reference follows" }, footnote_text: { type: "string" } }, required: ["id", "anchor_text", "footnote_text"] },
    label: () => "Inserting footnote",
    execute: ({ id, anchor_text, footnote_text }) => {
      const { block } = getBlock(s, id);
      if (!block.text.includes(anchor_text)) throw new Error(`"${anchor_text}" not found in ¶${block.index}`);
      const footnoteId = nanoid(6);
      const p = propose({ kind: "insert_footnote", title: `Footnote in ${label(block)}`, summary: `after “${preview(anchor_text, 50)}”: ${preview(footnote_text, 160)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, anchorText: anchor_text, footnoteText: footnote_text, footnoteId }, risk: "low" });
      block.footnotes = (block.footnotes ?? 0) + 1; s.stats.footnotes += 1;
      return { proposal: p.id, footnote_id: footnoteId };
    },
  });

  const insert_toc_after = defineTool<{ id: string }>({
    name: "insert_toc_after",
    description: "Insert a table of contents (from the current headings) after a block.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    label: () => "Inserting table of contents",
    execute: ({ id }) => {
      const { block, i } = getBlock(s, id);
      const nodes = tableOfContents(s.sections);
      const blocks = insertBlocksAt(s, i + 1, nodes);
      const p = propose({ kind: "insert_toc_after", title: `Insert table of contents after ${label(block)}`, summary: `${s.sections.length} entries`, target: block.id, targetLabel: label(block), payload: { id: block.id, blocks: nodes, blockIds: blocks.map((b) => b.id) }, risk: "low" });
      return { proposal: p.id, entries: s.sections.length };
    },
  });

  const apply_template_section = defineTool<{ id: string; template_section: TemplateSectionId; position?: "after" | "before" }>({
    name: "apply_template_section",
    description: `Insert a standard drafting block after (default) or before a block: ${TEMPLATE_SECTIONS.map((t) => `${t.id} (${t.description})`).join("; ")}. Placeholders appear in [BRACKETS] for the drafter to complete.`,
    parameters: { type: "object", properties: { id: { type: "string" }, template_section: { type: "string", enum: TEMPLATE_SECTIONS.map((t) => t.id) }, position: { type: "string", enum: ["after", "before"] } }, required: ["id", "template_section"] },
    label: (a) => `Inserting ${String(a.template_section).replace(/_/g, " ")}`,
    execute: ({ id, template_section, position }) => {
      const { block, i } = getBlock(s, id);
      if (!TEMPLATE_SECTIONS.some((t) => t.id === template_section)) throw new Error(`Unknown template section ${template_section}`);
      const nodes = buildTemplateSection(template_section, { matter: ctx.matter, documentTitle: s.title, date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) });
      const at = position === "before" ? i : i + 1;
      const blocks = insertBlocksAt(s, at, nodes);
      const p = propose({ kind: "apply_template_section", title: `Insert ${template_section.replace(/_/g, " ")} ${position === "before" ? "before" : "after"} ${label(block)}`, summary: preview(blocks.map((b) => b.text).filter(Boolean).join(" ¶ "), 220), target: block.id, targetLabel: label(block), payload: { id: block.id, section: template_section, position: position ?? "after", blocks: nodes, blockIds: blocks.map((b) => b.id) }, risk: "low" });
      return { proposal: p.id, inserted: blocks.length, first_block_id: blocks[0]?.id };
    },
  });

  const set_document_title = defineTool<{ title: string }>({
    name: "set_document_title",
    description: "Rename the document (the file title, not a heading).",
    parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    label: () => "Renaming document",
    execute: ({ title }) => {
      const p = propose({ kind: "set_document_title", title: `Rename to “${preview(title, 60)}”`, summary: `was “${s.title}”`, payload: { title, oldTitle: s.title }, risk: "low" });
      s.title = title;
      return { proposal: p.id };
    },
  });

  const renumber_lists = defineTool<{ scope_heading_id?: string; style?: "decimal" | "legal" | "outline" | "alpha" | "roman" }>({
    name: "renumber_lists",
    description: "Restart and normalize list numbering (optionally set a numbering style: decimal, legal 1.1.1, outline (a)(i), alpha, roman) in the whole document or a section.",
    parameters: { type: "object", properties: { scope_heading_id: { type: "string" }, style: { type: "string", enum: ["decimal", "legal", "outline", "alpha", "roman"] } }, required: [] },
    label: () => "Renumbering lists",
    execute: ({ scope_heading_id, style }) => {
      const targets = scope_heading_id ? sectionBlocks(s, scope_heading_id) : s.blocks;
      const listed = targets.filter((b) => b.listInfo && b.listInfo.kind !== "bullet");
      const p = propose({ kind: "renumber_lists", title: `Renumber lists${style ? ` (${style})` : ""}${scope_heading_id ? " in section" : ""}`, summary: `${listed.length} numbered item${listed.length === 1 ? "" : "s"}`, target: listed[0]?.id, targetLabel: listed[0] ? label(listed[0]) : undefined, payload: { scopeHeadingId: scope_heading_id, style, blockIds: listed.map((b) => b.id) }, risk: "low" });
      let pos = 0;
      for (const b of listed) { if (b.listInfo) { pos = b.listInfo.depth === 1 ? pos + 1 : pos; if (style) b.listInfo.kind = style === "decimal" ? "ordered" : style; } }
      return { proposal: p.id, items: listed.length };
    },
  });

  const polish_section = defineTool<{ heading_id: string; goals: string[] }>({
    name: "polish_section",
    description: "Polish every paragraph of a section for the given goals (e.g. 'tighten', 'plain English', 'active voice', 'consistent defined terms', 'persuasive tone', 'remove redundancy'). Reads the section and proposes a tracked rewrite per paragraph that changes. Use for section-level line edits instead of many manual rewrites. Use \"document\" as heading_id to polish everything.",
    parameters: { type: "object", properties: { heading_id: { type: "string" }, goals: { type: "array", items: { type: "string" } } }, required: ["heading_id", "goals"] },
    label: () => "Polishing section",
    execute: async ({ heading_id, goals }) => {
      const blocks = (heading_id === "document" ? s.blocks : sectionBlocks(s, heading_id)).filter((b) => b.type === "paragraph" && b.text.trim().length > 20 && !b.table);
      if (!blocks.length) throw new Error("No paragraphs in that section");
      if (!deps.polishParagraphs) throw new Error("Polishing requires the language model; rewrite paragraphs individually with rewrite_paragraph.");
      ctx.emit({ type: "status", message: `Polishing ${blocks.length} paragraph${blocks.length > 1 ? "s" : ""}…` });
      const sectionTitle = heading_id === "document" ? s.title : s.blocks.find((b) => b.id === heading_id)?.text ?? "";
      const rewrites = await deps.polishParagraphs(blocks.slice(0, 40).map((b) => ({ id: b.id, text: b.text })), goals, { title: s.title, sectionTitle, matter: ctx.matter?.name });
      let changed = 0;
      for (const r of rewrites) {
        const b = s.blocks.find((x) => x.id === r.id);
        if (!b) continue;
        const newText = inlineText(inlineFromMarkdown(r.markdown), "raw");
        if (newText.trim() === b.text.trim()) continue;
        changed++;
        propose({ kind: "rewrite_paragraph", title: `Polish ${label(b)}`, summary: `${r.note ? `${r.note}\n` : ""}− ${preview(b.text, 160)}\n+ ${preview(newText, 160)}`, target: b.id, targetLabel: label(b), payload: { id: b.id, markdown: r.markdown, text: newText, oldText: b.text }, risk: "low" });
        b.text = newText; b.wordCount = wordCount(newText); b.marks = undefined;
      }
      return { paragraphs_reviewed: blocks.length, proposals: changed };
    },
  });

  const fix_citations = defineTool<{ scope_heading_id?: string }>({
    name: "fix_citations",
    description: "Cite-check: find citation-like strings and bracketed placeholders in the document (or a section), verify citations against CourtListener when research is on, normalize spacing (e.g. 'F. 3d' → 'F.3d', 'U.S.C. §' spacing), and flag unresolved or placeholder citations with [VERIFY] comments.",
    parameters: { type: "object", properties: { scope_heading_id: { type: "string" } }, required: [] },
    label: () => "Cite-checking",
    execute: async ({ scope_heading_id }) => {
      const targets = scope_heading_id ? sectionBlocks(s, scope_heading_id) : s.blocks;
      const found: { block: SnapshotBlock; cite: string }[] = [];
      const placeholders: { block: SnapshotBlock; text: string }[] = [];
      for (const b of targets) {
        for (const c of findCitations(b.text)) found.push({ block: b, cite: c });
        for (const p of findPlaceholders(b.text)) if (/VERIFY|CITE|CITATION|TBD|INSERT/i.test(p)) placeholders.push({ block: b, text: p });
      }
      // Normalizations
      const fixes: [RegExp, string, string][] = [[/\bF\.\s+(2d|3d|4th)\b/g, "F.$1", "reporter spacing"], [/\bF\.\s?Supp\.\s+(2d|3d)\b/g, "F. Supp. $1", "F. Supp. spacing"], [/\bU\.S\.C\.\s*§\s*(\d)/g, "U.S.C. § $1", "section symbol spacing"], [/\bC\.F\.R\.\s*§\s*(\d)/g, "C.F.R. § $1", "section symbol spacing"], [/\bS\.\s?Ct\b(?!\.)/g, "S. Ct.", "S. Ct. abbreviation"]];
      let normalized = 0;
      for (const b of targets) {
        for (const [re, rep, why] of fixes) {
          if (!re.test(b.text)) { re.lastIndex = 0; continue; }
          re.lastIndex = 0;
          const newText = b.text.replace(re, rep);
          if (newText !== b.text) {
            propose({ kind: "replace_text_in_paragraph", title: `Normalize citation in ${label(b)}`, summary: why, target: b.id, targetLabel: label(b), payload: { id: b.id, find: re.source, replace: rep, all: true, regex: true, caseSensitive: true, oldText: b.text, text: newText }, risk: "low" });
            b.text = newText; normalized++;
          }
        }
      }
      // Verification
      let verified: { citation: string; resolved: boolean; matches?: { case_name?: string; url?: string; date_filed?: string }[] }[] = [];
      const unique = Array.from(new Set(found.map((f) => f.cite)));
      if (deps.verifyCitations && ctx.research && unique.length) {
        ctx.emit({ type: "status", message: `Verifying ${unique.length} citation${unique.length > 1 ? "s" : ""}…` });
        try { verified = (await deps.verifyCitations(unique.join("\n"))).citations; } catch (e) { ctx.emit({ type: "status", message: `Citation lookup failed: ${(e as Error).message}` }); }
      }
      let flagged = 0;
      const flaggedIds = new Set<string>();
      for (const f of found) {
        const v = verified.find((x) => f.cite.includes(x.citation) || x.citation.includes(f.cite.replace(/\s*\(.*$/, "")));
        const key = `${f.block.id}:${f.cite}`;
        if (flaggedIds.has(key)) continue;
        if (v && v.resolved) continue;
        if (!v && (deps.verifyCitations && ctx.research)) continue; // regulatory cites (CFR/USC) are not in CourtListener; skip silently
        if (!ctx.research && !/U\.S\.C\.|C\.F\.R\./.test(f.cite)) {
          flaggedIds.add(key); flagged++;
          propose({ kind: "add_comment", title: `[VERIFY] ${preview(f.cite, 40)}`, summary: `Citation not verified (research off). Confirm reporter, pin cite and parenthetical before filing.`, target: f.block.id, targetLabel: label(f.block), payload: { id: f.block.id, text: `[VERIFY] Citation "${f.cite}" has not been verified against a reporter. Confirm the case name, reporter volume/page, pin cite and year before filing.`, quote: f.cite }, risk: "low" });
        } else if (v && !v.resolved) {
          flaggedIds.add(key); flagged++;
          propose({ kind: "add_comment", title: `[VERIFY] unresolved ${preview(f.cite, 40)}`, summary: "CourtListener could not resolve this citation.", target: f.block.id, targetLabel: label(f.block), payload: { id: f.block.id, text: `[VERIFY] "${f.cite}" did not resolve in CourtListener. It may be mistyped, a placeholder, or an unpublished/WL cite. Replace with a verified Bluebook citation.`, quote: f.cite }, risk: "medium" });
        }
      }
      for (const p of placeholders) {
        flagged++;
        propose({ kind: "add_comment", title: `Placeholder ${preview(p.text, 30)}`, summary: "Bracketed placeholder must be completed before filing.", target: p.block.id, targetLabel: label(p.block), payload: { id: p.block.id, text: `Placeholder ${p.text} must be replaced with the actual citation/text before filing.`, quote: p.text }, risk: "low" });
      }
      return { citations_found: unique, verified: verified.map((v) => ({ citation: v.citation, resolved: v.resolved, match: v.matches?.[0]?.case_name })), placeholders: placeholders.map((p) => p.text), normalized, flagged };
    },
  });

  const reads = [get_outline, get_paragraphs, get_section, find_text, get_selection, get_comments, get_document_stats];
  const edits = [rewrite_paragraph, replace_text_in_paragraph, makeInsert("insert_after"), makeInsert("insert_before"), delete_paragraph, move_block, set_style, format_text, set_alignment, find_replace_all, add_comment, insert_table_after, insert_image_after, insert_diagram_after, insert_page_break_after, insert_footnote, insert_toc_after, apply_template_section, set_document_title, renumber_lists, polish_section, fix_citations];
  const all = ctx.mode === "ask" ? reads : [...reads, ...edits];
  return all as unknown as ToolDef<never, unknown>[];
}

function fullBlock(b: SnapshotBlock) {
  return { id: b.id, index: b.index, type: b.type, level: b.level, style: b.pStyle, align: b.align, list: b.listInfo, table: b.table, text: b.text, tracked_raw_text: b.rawText, words: b.wordCount, formatting: b.marks, comments: b.comments || undefined, footnotes: b.footnotes, image: b.image };
}

function safeRegex(find: string, opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; all?: boolean }): RegExp | null {
  let src = opts.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try { return new RegExp(src, `${opts.all === false ? "" : "g"}u${opts.caseSensitive ? "" : "i"}`); } catch { return null; }
}
