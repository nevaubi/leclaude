/**
 * Word agent tools. Read tools answer from the snapshot; edit tools register an EditProposal through
 * ctx.propose AND mutate the snapshot so later reads see the new state.
 *
 * Contract (constitution §31/§44/§52):
 * - every proposal carries `payload.base` — the snapshot version and the hash of each target block as the agent
 *   read it — so the editor rejects or rebases stale proposals (see proposal-freshness.ts);
 * - every edit returns the re-read affected blocks (`after`), and verify_edits re-checks everything touched;
 * - tools are grouped by access: read (all modes), suggest (Review + Draft; tracked changes and comments only),
 *   edit (Draft). Ask mode receives the read tools only — edit tools are not in its tool list at all.
 * Side-effecting dependencies (image generation, citation verification, polishing, version loading) are
 * injected so the tools stay testable.
 */
import { nanoid } from "nanoid";
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import { checkCitations, checkDefinedTerms, computeRedline, verifyBlocks, type CheckBlock } from "./agent-checks";
import { MARGIN_PRESETS, PAGE_SIZES, type MarginPresetId, type PageSizeId } from "./constants";
import { findCitations, findPlaceholders, flattenBlocks, inlineFromMarkdown, inlineText, makeParagraph, makeTable, markdownToBlocks, newId, type ParagraphStyle, type PMNode } from "./doc-model";
import { buildTemplateSection, captionBlock, captionFromMatter, signatureBlock, tableOfContentsField, TEMPLATE_SECTIONS, type TemplateSectionId } from "./sections";
import { reindexSnapshot, sectionBlocks, touchBlock, type SnapshotBlock, type WordSnapshot } from "./snapshot";

export interface WordToolDeps {
  /** Generate an image for a prompt; returns a URL the editor can load (blob url). */
  generateImage?: (prompt: string, size: "1024x1024" | "1536x1024" | "1024x1536") => Promise<{ url: string; blobId?: string }>;
  /** Resolve citations found in text (CourtListener). */
  verifyCitations?: (text: string) => Promise<{ citations: { citation: string; resolved: boolean; matches?: { case_name?: string; url?: string; date_filed?: string }[] }[] }>;
  /** Rewrite paragraphs for polish goals (model call). */
  polishParagraphs?: (paragraphs: { id: string; text: string }[], goals: string[], context: { title: string; sectionTitle: string; matter?: string }) => Promise<{ id: string; markdown: string; note?: string }[]>;
  /** Saved versions of this document (for redline_compare). */
  listVersions?: () => Promise<{ id: string; version: number; label?: string; createdAt: string }[]>;
  loadVersion?: (versionId: string) => Promise<{ content: PMNode; label?: string; version: number } | null>;
}

type Ctx = OfficeAgentContext<WordSnapshot>;
export type WordToolAccess = "read" | "suggest" | "edit";

const STYLE_VALUES: ParagraphStyle[] = ["title", "heading1", "heading2", "heading3", "body", "blockquote", "caption", "legal_numbered", "bullet_list", "numbered_list"];

/** Access class of every Word tool. Ask = read; Review = read + suggest; Draft = all. */
export const WORD_TOOL_ACCESS: Record<string, WordToolAccess> = {
  get_outline: "read", get_paragraphs: "read", get_section: "read", find_text: "read", get_selection: "read", get_comments: "read", get_document_stats: "read", get_tracked_changes: "read", get_styles: "read",
  check_defined_terms: "read", check_citations: "read", verify_edits: "read",
  rewrite_paragraph: "suggest", replace_text_in_paragraph: "suggest", find_replace: "suggest", insert_after: "suggest", insert_before: "suggest", delete_paragraph: "suggest", edit_table_cell: "suggest",
  insert_comment: "suggest", resolve_comment: "suggest", fix_citations: "suggest", redline_compare: "suggest",
  move_block: "edit", apply_style: "edit", set_heading_level: "edit", format_text: "edit", set_alignment: "edit", insert_table: "edit", merge_cells: "edit", insert_image_after: "edit", insert_diagram_after: "edit",
  insert_page_break_after: "edit", insert_footnote: "edit", insert_toc: "edit", update_fields: "edit", set_page_setup: "edit", insert_cross_reference: "edit", accept_reject_changes: "edit", numbering_fix: "edit",
  legal_caption: "edit", signature_block: "edit", apply_template_section: "edit", set_document_title: "edit", polish_section: "edit",
};

export function isWordEditingTool(name: string) { return (WORD_TOOL_ACCESS[name] ?? "edit") !== "read"; }

export function wordToolAllowed(name: string, mode: Ctx["mode"]): boolean {
  const access = WORD_TOOL_ACCESS[name] ?? "edit";
  if (mode === "ask") return access === "read";
  if (mode === "review") return access !== "edit";
  return true;
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

function safeRegex(find: string, opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; all?: boolean }): RegExp | null {
  let src = opts.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try { return new RegExp(src, `${opts.all === false ? "" : "g"}u${opts.caseSensitive ? "" : "i"}`); } catch { return null; }
}

function fullBlock(b: SnapshotBlock) {
  return { id: b.id, index: b.index, type: b.type, level: b.level, style: b.pStyle, word_style: b.styleId, align: b.align, list: b.listInfo, table: b.table, text: b.text, tracked_raw_text: b.rawText, words: b.wordCount, formatting: b.marks, comments: b.comments || undefined, footnotes: b.footnotes, changes: b.changes, fields: b.fields, image: b.image, hash: b.hash };
}

const after = (blocks: SnapshotBlock[]) => blocks.slice(0, 8).map((b) => ({ id: b.id, index: b.index, type: b.type, text: preview(b.text, 400) }));

export function wordAgentTools(ctx: Ctx, deps: WordToolDeps = {}): ToolDef<never, unknown>[] {
  const s = ctx.snapshot;
  const author = "Drafting assistant";
  const baseVersion = s.version;
  /** Text of every block before this turn touched it (for verify_edits). */
  const touched = new Map<string, string>();
  const touch = (b: SnapshotBlock) => { if (!touched.has(b.id)) touched.set(b.id, b.text); };
  /**
   * Register a proposal with its base: the hash of each target block right now (before this proposal mutates
   * the snapshot). Review mode forces tracked changes on every text edit.
   */
  const propose = (p: Omit<EditProposal, "id" | "status">, targets: SnapshotBlock[]) => {
    const base = { version: baseVersion, blocks: Object.fromEntries(targets.map((b) => [b.id, b.hash ?? ""])) };
    return ctx.propose({ ...p, payload: { ...p.payload, base, ...(ctx.mode === "review" ? { forceTrack: true } : {}) } });
  };
  const checkBlocks = (): CheckBlock[] => s.blocks.map((b) => ({ id: b.id, index: b.index, type: b.type, text: b.text, level: b.level }));
  const scopeBlocks = (headingId?: string) => (headingId ? sectionBlocks(s, headingId) : s.blocks);

  // ------------------------------------------------------------------ reads
  const get_outline = defineTool<Record<string, never>>({
    name: "get_outline",
    description: "Document outline: every heading with its id, level, ¶ index, word count and block count. Use heading ids as section scope for get_section/polish_section.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading outline",
    execute: () => ({ title: s.title, version: s.version, sections: s.sections.map((x) => ({ id: x.id, level: x.level, index: x.index, title: x.title, words: x.wordCount, blocks: x.blockCount })), totals: { blocks: s.blocks.length, words: s.stats.words, pages: s.stats.pages } }),
  });

  const get_paragraphs = defineTool<{ from_index?: number; to_index?: number; ids?: string[]; ranges?: { from: number; to: number }[] }>({
    name: "get_paragraphs",
    description: "Exact text of blocks: by ¶ index range (from_index..to_index, inclusive, max 80), by several ranges at once (ranges), or by ids. Returns id, index, type, style, list/table context, tracked changes, fields, text and a content hash. Read before editing.",
    parameters: { type: "object", properties: { from_index: { type: "integer" }, to_index: { type: "integer" }, ids: { type: "array", items: { type: "string" } }, ranges: { type: "array", items: { type: "object", properties: { from: { type: "integer" }, to: { type: "integer" } }, required: ["from", "to"] } } }, required: [] },
    examples: [{ from_index: 12, to_index: 30 }, { ranges: [{ from: 1, to: 5 }, { from: 40, to: 48 }] }, { ids: ["a1b2c3d4"] }],
    label: (a) => a.ids?.length ? `Reading ${a.ids.length} block${a.ids.length > 1 ? "s" : ""}` : a.ranges?.length ? `Reading ${a.ranges.length} ranges` : `Reading ¶${a.from_index ?? 1}–${a.to_index ?? ""}`,
    execute: ({ from_index, to_index, ids, ranges }) => {
      let blocks: SnapshotBlock[];
      if (ids?.length) blocks = ids.map((id) => s.blocks.find((b) => b.id === id)).filter((b): b is SnapshotBlock => Boolean(b));
      else {
        const rs = ranges?.length ? ranges : [{ from: from_index ?? 1, to: to_index ?? (from_index ?? 1) + 39 }];
        const want = new Set<number>();
        let budget = 120;
        for (const r of rs) { const from = Math.max(1, r.from); const to = Math.min(s.blocks.length, r.to, from + 79); for (let i = from; i <= to && budget > 0; i++, budget--) want.add(i); }
        blocks = s.blocks.filter((b) => want.has(b.index));
      }
      return { version: s.version, blocks: blocks.map(fullBlock) };
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
    description: "Search the document text. Returns matching blocks with id, ¶ index, the match and surrounding context. Supports regex.",
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
    description: "Comments on the document (id, anchor block, author, body, quoted text, resolved). Use the id with resolve_comment.",
    parameters: { type: "object", properties: { include_resolved: { type: "boolean" } }, required: [] },
    label: () => "Reading comments",
    execute: ({ include_resolved }) => ({ comments: (s.comments ?? []).filter((c) => include_resolved || !c.resolved).map((c) => ({ ...c, block: s.blocks.find((b) => b.id === c.anchor)?.index })) }),
  });

  const get_document_stats = defineTool<Record<string, never>>({
    name: "get_document_stats",
    description: "Word/character/paragraph counts, page estimate, tables, images, footnotes, comments, pending tracked changes, page setup, placeholders and citations detected.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Computing statistics",
    execute: () => {
      const all = s.blocks.map((b) => b.text).join("\n");
      return { ...s.stats, page: s.page, track_changes_on: s.trackChangesOn, placeholders: Array.from(new Set(findPlaceholders(all))).slice(0, 60), citations: Array.from(new Set(findCitations(all))).slice(0, 80), bookmarks: s.bookmarks?.slice(0, 40), fields: Array.from(new Set(s.blocks.flatMap((b) => b.fields ?? []))).slice(0, 40) };
    },
  });

  const get_tracked_changes = defineTool<{ author?: string; scope_heading_id?: string }>({
    name: "get_tracked_changes",
    description: "Pending tracked changes (insertions/deletions) with change id, author, text and block; filter by author or section. Use before accept_reject_changes.",
    parameters: { type: "object", properties: { author: { type: "string" }, scope_heading_id: { type: "string" } }, required: [] },
    label: () => "Reading tracked changes",
    execute: ({ author: by, scope_heading_id }) => {
      const out = scopeBlocks(scope_heading_id).flatMap((b) => (b.changes ?? []).map((c) => ({ ...c, block_id: b.id, index: b.index }))).filter((c) => !by || c.author.toLowerCase() === by.toLowerCase());
      return { count: out.length, authors: Array.from(new Set(out.map((c) => c.author))), changes: out.slice(0, 100) };
    },
  });

  const get_styles = defineTool<Record<string, never>>({
    name: "get_styles",
    description: "Paragraph styles available: the app styles (title, heading1-3, body, blockquote, caption, lists) and, for imported Word files, the document's own Word styles (id, name, outline level).",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading styles",
    execute: () => ({ app_styles: STYLE_VALUES, word_styles: (s.styles ?? []).filter((x) => x.type === "paragraph").slice(0, 80) }),
  });

  const check_defined_terms = defineTool<{ scope_heading_id?: string }>({
    name: "check_defined_terms",
    description: "Deterministic defined-term check: terms defined (\"Term\") and their use counts, capitalized terms used but never defined, terms defined but unused, defined twice, used before definition, and lower-case variants. Flags only.",
    parameters: { type: "object", properties: { scope_heading_id: { type: "string", description: "Limit uses to a section (definitions are still collected document-wide)" } }, required: [] },
    label: () => "Checking defined terms",
    execute: ({ scope_heading_id }) => {
      const report = checkDefinedTerms(checkBlocks());
      if (!scope_heading_id) return report;
      const ids = new Set(sectionBlocks(s, scope_heading_id).map((b) => b.id));
      return { ...report, used_not_defined: report.used_not_defined.filter((u) => u.block_ids.some((id) => ids.has(id))) };
    },
  });

  const check_citations = defineTool<{ scope_heading_id?: string }>({
    name: "check_citations",
    description: "Deterministic Bluebook-style citation form check (flags only, no network): case-name \"v.\", reporter spacing (F.3d, S. Ct., F. Supp.), missing or malformed (court year) parentheticals, pin cites before the first page, § spacing, FRCP/FRE short forms, Id./id. form, supra for cases, Westlaw pin cites and placeholder cites. Existence is NOT verified — use fix_citations with research for that.",
    parameters: { type: "object", properties: { scope_heading_id: { type: "string" } }, required: [] },
    label: () => "Checking citation form",
    execute: ({ scope_heading_id }) => {
      const blocks = scopeBlocks(scope_heading_id).map((b) => ({ id: b.id, index: b.index, type: b.type, text: b.text }));
      const flags = checkCitations(blocks);
      return { flags: flags.length, by_rule: flags.reduce<Record<string, number>>((m, f) => { m[f.rule] = (m[f.rule] ?? 0) + 1; return m; }, {}), items: flags.slice(0, 60) };
    },
  });

  const verify_edits = defineTool<Record<string, never>>({
    name: "verify_edits",
    description: "Re-read every block edited in this turn and check it deterministically: new placeholders, unbalanced parentheses/brackets/quotes, double spaces, repeated words, lost end punctuation, emptied paragraphs, and citation-form flags in the edited text. Call it after proposing edits and fix anything it reports.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Verifying edits",
    execute: () => {
      const blocks = s.blocks.filter((b) => touched.has(b.id));
      const deleted = Array.from(touched.keys()).filter((id) => !s.blocks.some((b) => b.id === id));
      const cb = blocks.map((b) => ({ id: b.id, index: b.index, type: b.type, text: b.text }));
      const issues = verifyBlocks(cb, touched);
      const citeFlags = checkCitations(cb).filter((f) => f.rule !== "placeholder");
      return { checked: blocks.length, deleted: deleted.length, proposals: ctx.proposals.length, issues, citation_flags: citeFlags.slice(0, 20), after: after(blocks), ok: !issues.length && !citeFlags.length };
    },
  });

  // ------------------------------------------------------------------ text edits (suggest)
  const rewrite_paragraph = defineTool<{ id: string; markdown: string; reason?: string }>({
    name: "rewrite_paragraph",
    description: "Replace the full text of one block (paragraph, heading, list item or table-cell paragraph) with new inline markdown (**bold**, *italic*, __underline__, [text](url)). Applied as a word-level tracked change. Prefer replace_text_in_paragraph when only a phrase changes. No heading marker (#) — use set_heading_level/apply_style for structure.",
    parameters: { type: "object", properties: { id: { type: "string" }, markdown: { type: "string" }, reason: { type: "string", description: "Short reason shown to the user" } }, required: ["id", "markdown"] },
    label: () => "Rewriting paragraph",
    execute: ({ id, markdown, reason }) => {
      const { block } = getBlock(s, id);
      if (block.type !== "paragraph" && block.type !== "heading" && block.type !== "codeBlock") throw new Error(`Block ${id} is a ${block.type}; rewrite only applies to text blocks.`);
      const md = markdown.replace(/^#{1,6}\s+/, "").trim();
      const newText = inlineText(inlineFromMarkdown(md), "raw");
      const old = block.text;
      const p = propose({ kind: "rewrite_paragraph", title: `Rewrite ${label(block)}`, summary: `${reason ? `${reason}\n` : ""}− ${preview(old, 220)}\n+ ${preview(newText, 220)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, markdown: md, text: newText, oldText: old }, risk: block.type === "heading" ? "medium" : "low" }, [block]);
      touch(block);
      block.text = newText; block.rawText = undefined; block.marks = undefined; touchBlock(block);
      reindexSnapshot(s);
      return { proposal: p.id, id: block.id, index: block.index, new_text: newText, after: after([block]) };
    },
  });

  const replace_text_in_paragraph = defineTool<{ id: string; find: string; replace: string; all?: boolean; regex?: boolean; case_sensitive?: boolean }>({
    name: "replace_text_in_paragraph",
    description: "Replace a phrase inside one block (minimal tracked diff; surrounding formatting preserved). Confirm the exact phrase with find_text/get_paragraphs first. all=true replaces every occurrence in that block.",
    parameters: { type: "object", properties: { id: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, all: { type: "boolean" }, regex: { type: "boolean" }, case_sensitive: { type: "boolean" } }, required: ["id", "find", "replace"] },
    label: (a) => `Replacing "${preview(a.find, 30)}"`,
    execute: ({ id, find, replace, all, regex, case_sensitive }) => {
      const { block } = getBlock(s, id);
      const re = safeRegex(find, { regex, caseSensitive: case_sensitive, all: all !== false });
      if (!re) throw new Error("Invalid find pattern");
      if (!re.test(block.text)) throw new Error(`"${find}" not found in ¶${block.index}. Current text: ${preview(block.text, 300)}`);
      re.lastIndex = 0;
      const newText = block.text.replace(re, replace);
      const count = (block.text.match(re) ?? []).length || 1;
      const p = propose({ kind: "replace_text_in_paragraph", title: `Replace in ${label(block)}`, summary: `“${preview(find, 80)}” → “${preview(replace, 80)}”${count > 1 ? ` (${count}×)` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, find, replace, all: all !== false, regex: Boolean(regex), caseSensitive: Boolean(case_sensitive), oldText: block.text, text: newText }, risk: "low" }, [block]);
      touch(block);
      block.text = newText; touchBlock(block);
      return { proposal: p.id, replaced: count, new_text: newText, after: after([block]) };
    },
  });

  const find_replace = defineTool<{ find: string; replace: string; regex?: boolean; case_sensitive?: boolean; whole_word?: boolean; scope_heading_id?: string; preview?: boolean; expected_count?: number }>({
    name: "find_replace",
    description: "Document-wide (or section-scoped) find & replace with regex, case and whole-word options. Call with preview=true first: it returns the match count and samples without changing anything. Then call again with expected_count set to that count to propose the replacement (a mismatch is refused, so the document must not have changed in between). Use for defined-term renames, party names, dates.",
    parameters: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" }, regex: { type: "boolean" }, case_sensitive: { type: "boolean" }, whole_word: { type: "boolean" }, scope_heading_id: { type: "string" }, preview: { type: "boolean" }, expected_count: { type: "integer" } }, required: ["find", "replace"] },
    examples: [{ find: "Company", replace: "Acme", whole_word: true, case_sensitive: true, preview: true }, { find: "Company", replace: "Acme", whole_word: true, case_sensitive: true, expected_count: 14 }],
    label: (a) => (a.preview ? `Previewing "${preview(a.find, 30)}"` : `Replace all "${preview(a.find, 30)}"`),
    execute: ({ find, replace, regex, case_sensitive, whole_word, scope_heading_id, preview: dry, expected_count }) => {
      const re = safeRegex(find, { regex, caseSensitive: case_sensitive, wholeWord: whole_word, all: true });
      if (!re) throw new Error("Invalid find pattern");
      const targets = scopeBlocks(scope_heading_id);
      const hits: { block: SnapshotBlock; n: number }[] = [];
      for (const b of targets) { const n = (b.text.match(re) ?? []).length; if (n) hits.push({ block: b, n }); }
      const count = hits.reduce((a, h) => a + h.n, 0);
      const samples = hits.slice(0, 8).map((h) => { re.lastIndex = 0; const m = re.exec(h.block.text); const a = Math.max(0, (m?.index ?? 0) - 50); return { id: h.block.id, index: h.block.index, occurrences: h.n, context: preview(h.block.text.slice(a, a + 160), 160), after: preview(h.block.text.replace(re, replace).slice(a, a + 160), 160) }; });
      if (dry) return { preview: true, count, blocks: hits.length, samples };
      if (!count) return { count: 0, note: `"${find}" not found` };
      if (expected_count == null) throw new Error(`Preview first: call find_replace with preview=true (found ${count} occurrences), then pass expected_count=${count}.`);
      if (expected_count !== count) throw new Error(`expected_count ${expected_count} does not match ${count} current occurrences; preview again.`);
      const base = hits.map((h) => h.block);
      const p = propose({ kind: "find_replace_all", title: `Replace all “${preview(find, 30)}” → “${preview(replace, 30)}”`, summary: `${count} occurrence${count > 1 ? "s" : ""} in ${hits.length} block${hits.length > 1 ? "s" : ""}${scope_heading_id ? " (section scope)" : ""}`, target: hits[0].block.id, targetLabel: label(hits[0].block), payload: { find, replace, regex: Boolean(regex), caseSensitive: Boolean(case_sensitive), wholeWord: Boolean(whole_word), count, blockIds: hits.map((h) => h.block.id) }, risk: count > 10 ? "medium" : "low" }, base);
      for (const h of hits) { touch(h.block); h.block.text = h.block.text.replace(re, replace); touchBlock(h.block); }
      return { proposal: p.id, count, block_ids: hits.map((h) => h.block.id), after: after(hits.map((h) => h.block)) };
    },
  });

  const makeInsert = (name: "insert_after" | "insert_before") => defineTool<{ id: string; markdown: string; reason?: string }>({
    name,
    description: `Insert new content ${name === "insert_after" ? "after" : "before"} the block with the given id. Markdown may contain several blocks: paragraphs, # headings, - bullets, 1. numbered items, > quotes, | tables |, --- rules. Each block gets an id you can reference afterwards. New text is a tracked insertion.`,
    parameters: { type: "object", properties: { id: { type: "string" }, markdown: { type: "string" }, reason: { type: "string" } }, required: ["id", "markdown"] },
    label: () => name === "insert_after" ? "Inserting content" : "Inserting content before",
    execute: ({ id, markdown, reason }) => {
      const { block, i } = getBlock(s, id);
      const nodes = markdownToBlocks(markdown);
      if (!nodes.length) throw new Error("markdown produced no blocks");
      const at = name === "insert_after" ? i + 1 : i;
      const p0 = { kind: name, title: "", target: block.id, targetLabel: label(block), risk: "low" as const };
      const baseBlocks = [block];
      const blocks = insertBlocksAt(s, at, nodes);
      for (const b of blocks) touched.set(b.id, "");
      const p = propose({ ...p0, title: `Insert ${blocks.length} block${blocks.length > 1 ? "s" : ""} ${name === "insert_after" ? "after" : "before"} ${label(block)}`, summary: `${reason ? `${reason}\n` : ""}${preview(blocks.map((b) => b.text).join(" ¶ "), 260)}`, payload: { id: block.id, blocks: nodes, markdown, blockIds: blocks.map((b) => b.id) } }, baseBlocks);
      return { proposal: p.id, inserted: blocks.map((b) => ({ id: b.id, index: b.index, type: b.type, text: preview(b.text, 80) })) };
    },
  });

  const delete_paragraph = defineTool<{ id: string; reason?: string }>({
    name: "delete_paragraph",
    description: "Delete a block (tracked as a deletion when track changes is on or in Review mode).",
    parameters: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id"] },
    label: () => "Deleting block",
    execute: ({ id, reason }) => {
      const { block, i } = getBlock(s, id);
      const p = propose({ kind: "delete_paragraph", title: `Delete ${label(block)}`, summary: `${reason ? `${reason}\n` : ""}− ${preview(block.text, 200)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, oldText: block.text }, risk: block.type === "heading" ? "high" : "medium" }, [block]);
      touch(block);
      s.blocks.splice(i, 1);
      reindexSnapshot(s);
      return { proposal: p.id, deleted: block.id };
    },
  });

  const cellBlock = (tableId: string, row: number, col: number) => {
    const b = s.blocks.find((x) => x.table?.tableId === tableId && x.table.row === row && x.table.col === col);
    if (!b) throw new Error(`No cell r${row}c${col} in table ${tableId}. Read the table with get_paragraphs to see its cells (td r,c).`);
    return b;
  };

  const edit_table_cell = defineTool<{ table_id: string; row: number; col: number; markdown: string }>({
    name: "edit_table_cell",
    description: "Replace the text of one table cell (1-based row/col as shown by \"td r,c\" in reads) with inline markdown, as a tracked change.",
    parameters: { type: "object", properties: { table_id: { type: "string" }, row: { type: "integer" }, col: { type: "integer" }, markdown: { type: "string" } }, required: ["table_id", "row", "col", "markdown"] },
    label: (a) => `Editing cell r${a.row}c${a.col}`,
    execute: ({ table_id, row, col, markdown }) => {
      const block = cellBlock(table_id, row, col);
      const newText = inlineText(inlineFromMarkdown(markdown), "raw");
      const p = propose({ kind: "rewrite_paragraph", title: `Edit cell r${row}c${col}`, summary: `− ${preview(block.text, 120)}\n+ ${preview(newText, 120)}`, target: block.id, targetLabel: `${label(block)} (r${row}c${col})`, payload: { id: block.id, markdown, text: newText, oldText: block.text, cell: { tableId: table_id, row, col } }, risk: "low" }, [block]);
      touch(block);
      block.text = newText; touchBlock(block);
      return { proposal: p.id, after: after([block]) };
    },
  });

  const insert_comment = defineTool<{ id: string; text: string; quote?: string }>({
    name: "insert_comment",
    description: "Attach a margin comment to a block, optionally anchored to an exact quoted phrase. Use for [VERIFY] flags, questions for the drafter and review notes.",
    parameters: { type: "object", properties: { id: { type: "string" }, text: { type: "string" }, quote: { type: "string", description: "Exact phrase in the block to anchor the comment to" } }, required: ["id", "text"] },
    label: () => "Adding comment",
    execute: ({ id, text, quote }) => {
      const { block } = getBlock(s, id);
      if (quote && !block.text.includes(quote)) throw new Error(`Quote "${preview(quote, 60)}" not found in ¶${block.index}`);
      const p = propose({ kind: "add_comment", title: `Comment on ${label(block)}`, summary: `${quote ? `“${preview(quote, 60)}”: ` : ""}${preview(text, 200)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, text, quote }, risk: "low" }, [block]);
      block.comments += 1;
      s.comments = [...(s.comments ?? []), { id: `pending_${p.id}`, anchor: block.id, body: text, author, quote }];
      return { proposal: p.id };
    },
  });

  const resolve_comment = defineTool<{ comment_id: string; note?: string }>({
    name: "resolve_comment",
    description: "Mark a comment resolved (ids from get_comments), optionally recording a short reply explaining the resolution.",
    parameters: { type: "object", properties: { comment_id: { type: "string" }, note: { type: "string" } }, required: ["comment_id"] },
    label: () => "Resolving comment",
    execute: ({ comment_id, note }) => {
      const c = (s.comments ?? []).find((x) => x.id === comment_id);
      if (!c) throw new Error(`No comment "${comment_id}". Use get_comments.`);
      if (c.resolved) return { note: "already resolved" };
      const anchor = s.blocks.find((b) => b.id === c.anchor);
      const p = propose({ kind: "resolve_comment", title: `Resolve comment by ${c.author}`, summary: `${preview(c.body, 120)}${note ? `\n↳ ${preview(note, 120)}` : ""}`, target: c.anchor, targetLabel: anchor ? label(anchor) : undefined, payload: { commentId: comment_id, note }, risk: "low" }, anchor ? [anchor] : []);
      c.resolved = true;
      return { proposal: p.id };
    },
  });

  const redline_compare = defineTool<{ base_version_id?: string; base_markdown?: string; scope_heading_id?: string }>({
    name: "redline_compare",
    description: "Redline the current document against an earlier version (base_version_id from the version history; omit both to list versions) or against pasted text (base_markdown). Produces tracked changes showing what changed since the base: modified paragraphs get word-level insertions/deletions, new paragraphs are marked inserted, removed paragraphs are re-inserted as deletions. Deterministic block alignment.",
    parameters: { type: "object", properties: { base_version_id: { type: "string" }, base_markdown: { type: "string" }, scope_heading_id: { type: "string" } }, required: [] },
    label: () => "Comparing versions",
    execute: async ({ base_version_id, base_markdown, scope_heading_id }) => {
      let baseDoc: PMNode | null = null;
      let baseLabel = "pasted text";
      if (base_markdown) baseDoc = { type: "doc", content: markdownToBlocks(base_markdown) };
      else if (base_version_id) {
        if (!deps.loadVersion) throw new Error("Version history is not available here; paste the earlier text as base_markdown.");
        const v = await deps.loadVersion(base_version_id);
        if (!v) throw new Error(`No version "${base_version_id}" for this document.`);
        baseDoc = v.content; baseLabel = `v${v.version}${v.label ? ` (${v.label})` : ""}`;
      } else {
        const versions = deps.listVersions ? await deps.listVersions() : [];
        return { versions: versions.slice(0, 20), note: "Pass base_version_id or base_markdown to produce the redline." };
      }
      const base = flattenBlocks(baseDoc).blocks.map((b) => ({ text: b.text, type: b.type }));
      const current = scopeBlocks(scope_heading_id);
      const ops = computeRedline(base, current.map((b) => ({ id: b.id, index: b.index, type: b.type, text: b.text })));
      if (!ops.length) return { base: baseLabel, changes: 0, note: "No differences." };
      const byId = new Map(s.blocks.map((b) => [b.id, b]));
      const p = propose({ kind: "redline_compare", title: `Redline against ${baseLabel}`, summary: `${ops.filter((o) => o.op === "modify").length} modified · ${ops.filter((o) => o.op === "insert").length} added · ${ops.filter((o) => o.op === "delete").length} removed`, target: (ops.find((o) => o.op !== "delete") as { id?: string } | undefined)?.id, payload: { base: baseLabel, ops }, risk: "medium" }, ops.flatMap((o) => (o.op === "delete" ? [] : [byId.get(o.id)!])).filter(Boolean));
      return { proposal: p.id, base: baseLabel, modified: ops.filter((o) => o.op === "modify").length, added: ops.filter((o) => o.op === "insert").length, removed: ops.filter((o) => o.op === "delete").length, sample: ops.slice(0, 8) };
    },
  });

  // ------------------------------------------------------------------ structure & formatting (edit)
  const move_block = defineTool<{ id: string; after_id: string }>({
    name: "move_block",
    description: "Move a block so it follows another block (after_id). Use \"start\" as after_id to move to the top of the document.",
    parameters: { type: "object", properties: { id: { type: "string" }, after_id: { type: "string" } }, required: ["id", "after_id"] },
    label: () => "Moving block",
    execute: ({ id, after_id }) => {
      const { block, i } = getBlock(s, id);
      const baseBlocks = [block];
      s.blocks.splice(i, 1);
      let at = 0;
      if (after_id !== "start") { const t = s.blocks.findIndex((b) => b.id === after_id); if (t < 0) { s.blocks.splice(i, 0, block); throw new Error(`No block with id "${after_id}"`); } at = t + 1; baseBlocks.push(s.blocks[t]); }
      s.blocks.splice(at, 0, block);
      reindexSnapshot(s);
      const p = propose({ kind: "move_block", title: `Move block to ${label(block)}`, summary: preview(block.text, 160), target: block.id, targetLabel: label(block), payload: { id: block.id, afterId: after_id }, risk: "medium" }, baseBlocks);
      return { proposal: p.id, new_index: block.index };
    },
  });

  const applyStyleToSnapshot = (block: SnapshotBlock, style: ParagraphStyle) => {
    if (style.startsWith("heading")) { block.type = "heading"; block.level = Number(style.slice(-1)); block.pStyle = undefined; block.listInfo = undefined; }
    else if (style === "title") { block.type = "heading"; block.level = 1; block.pStyle = "title"; block.listInfo = undefined; }
    else { block.type = "paragraph"; block.level = undefined; block.pStyle = style === "caption" ? "caption" : style === "blockquote" ? "blockquote" : undefined; block.listInfo = style === "bullet_list" ? { kind: "bullet", depth: 1, position: 1 } : style === "numbered_list" ? { kind: "ordered", depth: 1, position: 1 } : style === "legal_numbered" ? { kind: "legal", depth: 1, position: 1 } : undefined; }
    touchBlock(block);
    reindexSnapshot(s);
  };

  const apply_style = defineTool<{ id: string; style: string; ids?: string[] }>({
    name: "apply_style",
    description: "Apply a paragraph style to one or more blocks: an app style (title | heading1 | heading2 | heading3 | body | blockquote | caption | legal_numbered | bullet_list | numbered_list) or, in an imported Word file, one of its Word style ids from get_styles (e.g. \"BodyText\", \"Heading4\", \"BlockText\").",
    parameters: { type: "object", properties: { id: { type: "string" }, style: { type: "string" }, ids: { type: "array", items: { type: "string" }, description: "Additional blocks to style the same way" } }, required: ["id", "style"] },
    label: (a) => `Style → ${a.style}`,
    execute: ({ id, style, ids }) => {
      const targets = [id, ...(ids ?? [])].map((x) => getBlock(s, x).block);
      const appStyle = STYLE_VALUES.includes(style as ParagraphStyle) ? (style as ParagraphStyle) : null;
      const word = appStyle ? null : (s.styles ?? []).find((x) => x.id === style || x.name.toLowerCase() === style.toLowerCase());
      if (!appStyle && !word) throw new Error(`Unknown style "${style}". Use an app style (${STYLE_VALUES.join(", ")}) or a Word style id from get_styles.`);
      const proposals: string[] = [];
      for (const block of targets) {
        const p = propose({ kind: "set_style", title: `Style ${label(block)} → ${appStyle ? appStyle.replace(/_/g, " ") : word!.name}`, summary: preview(block.text, 120), target: block.id, targetLabel: label(block), payload: { id: block.id, style: appStyle ?? (word!.outline != null && word!.outline <= 5 ? `heading${Math.min(3, word!.outline + 1)}` : "body"), styleId: word?.id ?? null, level: word?.outline != null && word.outline <= 5 ? word.outline + 1 : undefined }, risk: "low" }, [block]);
        proposals.push(p.id);
        if (appStyle) applyStyleToSnapshot(block, appStyle);
        else { if (word!.outline != null && word!.outline <= 5) { block.type = "heading"; block.level = word!.outline + 1; } else { block.type = "paragraph"; block.level = undefined; } block.styleId = word!.id; touchBlock(block); reindexSnapshot(s); }
      }
      return { proposals, after: after(targets) };
    },
  });

  const set_heading_level = defineTool<{ id: string; level: number }>({
    name: "set_heading_level",
    description: "Set a block's heading level: 1–6 makes it a heading at that level, 0 makes it body text. Keeps the outline (and Word heading styles on export) consistent.",
    parameters: { type: "object", properties: { id: { type: "string" }, level: { type: "integer", minimum: 0, maximum: 6 } }, required: ["id", "level"] },
    label: (a) => (a.level ? `Heading level ${a.level}` : "Body text"),
    execute: ({ id, level }) => {
      const { block } = getBlock(s, id);
      const lv = Math.max(0, Math.min(6, Math.round(Number(level))));
      const p = propose({ kind: "set_heading_level", title: `${label(block)} → ${lv ? `Heading ${lv}` : "body text"}`, summary: preview(block.text, 120), target: block.id, targetLabel: label(block), payload: { id: block.id, level: lv }, risk: "low" }, [block]);
      if (lv) { block.type = "heading"; block.level = lv; block.pStyle = undefined; block.listInfo = undefined; } else { block.type = "paragraph"; block.level = undefined; }
      touchBlock(block); reindexSnapshot(s);
      return { proposal: p.id, after: after([block]) };
    },
  });

  const format_text = defineTool<{ id: string; find: string; marks: { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; highlight?: string | boolean; color?: string; font_size?: string; small_caps?: boolean; all_caps?: boolean }; all?: boolean }>({
    name: "format_text",
    description: "Apply inline formatting to a phrase in a block: bold, italic, underline, strike, highlight (true or a color), color (css), font_size (e.g. '11pt'), small_caps, all_caps. Set a mark false to remove it.",
    parameters: { type: "object", properties: { id: { type: "string" }, find: { type: "string" }, marks: { type: "object", properties: { bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, strike: { type: "boolean" }, highlight: { anyOf: [{ type: "boolean" }, { type: "string" }] }, color: { type: "string" }, font_size: { type: "string" }, small_caps: { type: "boolean" }, all_caps: { type: "boolean" } }, required: [] }, all: { type: "boolean" } }, required: ["id", "find", "marks"] },
    label: () => "Formatting text",
    execute: ({ id, find, marks, all }) => {
      const { block } = getBlock(s, id);
      if (!block.text.toLowerCase().includes(find.toLowerCase())) throw new Error(`"${find}" not found in ¶${block.index}`);
      const clean = Object.fromEntries(Object.entries(marks ?? {}).filter(([, v]) => v !== null && v !== undefined));
      const what = Object.entries(clean).map(([k, v]) => (v === false ? `no ${k}` : k)).join(", ");
      const p = propose({ kind: "format_text", title: `Format “${preview(find, 40)}” in ${label(block)}`, summary: what, target: block.id, targetLabel: label(block), payload: { id: block.id, find, marks: clean, all: all !== false }, risk: "low" }, [block]);
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
      const p = propose({ kind: "set_alignment", title: `Align ${label(block)} ${align}`, summary: preview(block.text, 100), target: block.id, targetLabel: label(block), payload: { id: block.id, align }, risk: "low" }, [block]);
      block.align = align === "left" ? undefined : align;
      return { proposal: p.id };
    },
  });

  const insert_table = defineTool<{ id: string; header: string[]; rows: string[][]; caption?: string; position?: "after" | "before"; widths?: number[] }>({
    name: "insert_table",
    description: "Insert a table (header row + rows) after (default) or before a block, with optional caption and column widths in px. Exports as a Word table with a repeating header row.",
    parameters: { type: "object", properties: { id: { type: "string" }, header: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } }, caption: { type: "string" }, position: { type: "string", enum: ["after", "before"] }, widths: { type: "array", items: { type: "integer" } } }, required: ["id", "header", "rows"] },
    label: () => "Inserting table",
    execute: ({ id, header, rows, caption, position, widths }) => {
      const { block, i } = getBlock(s, id);
      if (!header.length) throw new Error("header must have at least one column");
      const table = makeTable(header, rows, { widths });
      const nodes = caption ? [table, makeParagraph(caption, { pStyle: "caption" })] : [table];
      const blocks = insertBlocksAt(s, position === "before" ? i : i + 1, nodes);
      for (const b of blocks) touched.set(b.id, "");
      const p = propose({ kind: "insert_table_after", title: `Insert ${header.length}×${rows.length + 1} table ${position === "before" ? "before" : "after"} ${label(block)}`, summary: `${header.join(" | ")}${caption ? `\n${caption}` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, position: position ?? "after", blocks: nodes, tableId: table.attrs?.id, blockIds: blocks.map((b) => b.id) }, risk: "low" }, [block]);
      return { proposal: p.id, table_id: table.attrs?.id, cell_block_ids: blocks.slice(0, 6).map((b) => b.id) };
    },
  });

  const merge_cells = defineTool<{ table_id: string; from_row: number; from_col: number; to_row: number; to_col: number }>({
    name: "merge_cells",
    description: "Merge a rectangular range of table cells (1-based, inclusive). Text of the merged cells is kept in the top-left cell. Exports as Word gridSpan/vMerge.",
    parameters: { type: "object", properties: { table_id: { type: "string" }, from_row: { type: "integer" }, from_col: { type: "integer" }, to_row: { type: "integer" }, to_col: { type: "integer" } }, required: ["table_id", "from_row", "from_col", "to_row", "to_col"] },
    label: () => "Merging cells",
    execute: ({ table_id, from_row, from_col, to_row, to_col }) => {
      const r0 = Math.min(from_row, to_row), r1 = Math.max(from_row, to_row), c0 = Math.min(from_col, to_col), c1 = Math.max(from_col, to_col);
      if (r0 === r1 && c0 === c1) throw new Error("Select at least two cells to merge");
      const first = cellBlock(table_id, r0, c0);
      const last = cellBlock(table_id, r1, c1);
      const cells = s.blocks.filter((b) => b.table?.tableId === table_id && b.table.row >= r0 && b.table.row <= r1 && b.table.col >= c0 && b.table.col <= c1);
      const p = propose({ kind: "merge_cells", title: `Merge r${r0}c${c0}–r${r1}c${c1}`, summary: preview(cells.map((c) => c.text).filter(Boolean).join(" / "), 160), target: first.id, targetLabel: label(first), payload: { tableId: table_id, fromRow: r0, fromCol: c0, toRow: r1, toCol: c1, anchorId: first.id, lastId: last.id }, risk: "medium" }, [first, last]);
      return { proposal: p.id, merged_cells: cells.length };
    },
  });

  const insert_image_after = defineTool<{ id: string; prompt?: string; url?: string; blob_id?: string; caption?: string; width?: number; alt?: string }>({
    name: "insert_image_after",
    description: "Insert an image after a block. Provide one of: prompt (generate an illustration for a demonstrative), url (existing image), blob_id (uploaded blob). Optional caption and width in px (default 480).",
    parameters: { type: "object", properties: { id: { type: "string" }, prompt: { type: "string" }, url: { type: "string" }, blob_id: { type: "string" }, caption: { type: "string" }, width: { type: "integer" }, alt: { type: "string" } }, required: ["id"] },
    label: (a) => a.prompt ? "Generating image" : "Inserting image",
    timeoutMs: 120_000,
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
      const p = propose({ kind: "insert_image_after", title: `Insert image after ${label(block)}`, summary: `${prompt ? `Generated: ${preview(prompt, 100)}` : src}${caption ? `\n${caption}` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, src, alt: image.attrs?.alt, width: width ?? 480, caption, blocks: nodes, blockIds: blocks.map((b) => b.id) }, risk: "low" }, [block]);
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
      const p = propose({ kind: "insert_diagram_after", title: `Insert diagram after ${label(block)}`, summary: `${mermaid.split("\n")[0]}${caption ? `\n${caption}` : ""}`, target: block.id, targetLabel: label(block), payload: { id: block.id, mermaid, caption, width: width ?? 560, blocks: nodes, blockIds: blocks.map((b) => b.id) }, risk: "low" }, [block]);
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
      const p = propose({ kind: "insert_page_break_after", title: `Page break after ${label(block)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, blocks: [node], blockIds: [node.attrs?.id] }, risk: "low" }, [block]);
      return { proposal: p.id, block_id: node.attrs?.id };
    },
  });

  const insert_footnote = defineTool<{ id: string; anchor_text: string; footnote_text: string; kind?: "footnote" | "endnote" }>({
    name: "insert_footnote",
    description: "Attach a footnote (default) or endnote to a phrase in a block. It exports as a real Word footnote/endnote whose reference follows the phrase.",
    parameters: { type: "object", properties: { id: { type: "string" }, anchor_text: { type: "string", description: "Exact phrase in the block the note reference follows" }, footnote_text: { type: "string" }, kind: { type: "string", enum: ["footnote", "endnote"] } }, required: ["id", "anchor_text", "footnote_text"] },
    label: () => "Inserting footnote",
    execute: ({ id, anchor_text, footnote_text, kind }) => {
      const { block } = getBlock(s, id);
      if (!block.text.includes(anchor_text)) throw new Error(`"${anchor_text}" not found in ¶${block.index}`);
      const footnoteId = nanoid(6);
      const p = propose({ kind: "insert_footnote", title: `${kind === "endnote" ? "Endnote" : "Footnote"} in ${label(block)}`, summary: `after “${preview(anchor_text, 50)}”: ${preview(footnote_text, 160)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, anchorText: anchor_text, footnoteText: footnote_text, footnoteId, noteKind: kind ?? "footnote" }, risk: "low" }, [block]);
      block.footnotes = (block.footnotes ?? 0) + 1; s.stats.footnotes += 1;
      return { proposal: p.id, footnote_id: footnoteId };
    },
  });

  const insert_toc = defineTool<{ id: string; position?: "after" | "before" }>({
    name: "insert_toc",
    description: "Insert a table of contents after (default) or before a block: a real Word TOC field (headings 1–3, hyperlinked) whose entries are pre-filled from the current headings; Word refreshes page numbers when the file opens.",
    parameters: { type: "object", properties: { id: { type: "string" }, position: { type: "string", enum: ["after", "before"] } }, required: ["id"] },
    label: () => "Inserting table of contents",
    execute: ({ id, position }) => {
      const { block, i } = getBlock(s, id);
      const nodes = tableOfContentsField(s.sections);
      const blocks = insertBlocksAt(s, position === "before" ? i : i + 1, nodes);
      const p = propose({ kind: "insert_toc_after", title: `Insert table of contents ${position === "before" ? "before" : "after"} ${label(block)}`, summary: `${s.sections.length} entries (TOC field)`, target: block.id, targetLabel: label(block), payload: { id: block.id, position: position ?? "after", blocks: nodes, blockIds: blocks.map((b) => b.id) }, risk: "low" }, [block]);
      return { proposal: p.id, entries: s.sections.length };
    },
  });

  const update_fields = defineTool<Record<string, never>>({
    name: "update_fields",
    description: "Refresh fields: table-of-contents entries and cross-reference (REF) results are rebuilt from the current headings, and every field is marked dirty so Word recalculates page numbers (PAGE/NUMPAGES/PAGEREF) on open.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Updating fields",
    execute: () => {
      const withFields = s.blocks.filter((b) => b.fields?.length || b.pStyle === "toc_entry");
      const p = propose({ kind: "update_fields", title: "Update fields", summary: `${withFields.length} block(s) with fields; TOC and cross-references rebuilt from ${s.sections.length} headings`, payload: { sections: s.sections.map((x) => ({ id: x.id, title: x.title, level: x.level, index: x.index })) }, risk: "low" }, []);
      return { proposal: p.id, blocks_with_fields: withFields.length };
    },
  });

  const set_page_setup = defineTool<{ orientation?: "portrait" | "landscape"; page_size?: PageSizeId; margins?: MarginPresetId; section_break_after_id?: string }>({
    name: "set_page_setup",
    description: `Change page setup: orientation, page_size (${Object.keys(PAGE_SIZES).join(" | ")}), margins preset (${Object.entries(MARGIN_PRESETS).map(([k, v]) => `${k} = ${v.label}`).join("; ")}). With section_break_after_id, a section break is inserted after that block and the new setup applies from the break to the end (e.g. a landscape exhibit section); without it the whole document changes.`,
    parameters: { type: "object", properties: { orientation: { type: "string", enum: ["portrait", "landscape"] }, page_size: { type: "string", enum: Object.keys(PAGE_SIZES) }, margins: { type: "string", enum: Object.keys(MARGIN_PRESETS) }, section_break_after_id: { type: "string" } }, required: [] },
    label: () => "Page setup",
    execute: ({ orientation, page_size, margins, section_break_after_id }) => {
      if (!orientation && !page_size && !margins) throw new Error("Nothing to change: pass orientation, page_size or margins");
      const target = section_break_after_id ? getBlock(s, section_break_after_id).block : null;
      const what = [orientation, page_size && PAGE_SIZES[page_size]?.label, margins && `${MARGIN_PRESETS[margins]?.label} margins`].filter(Boolean).join(", ");
      const p = propose({ kind: "set_page_setup", title: target ? `Section break after ${label(target)}: ${what}` : `Page setup: ${what}`, summary: target ? "New section from this point to the end of the document" : "Whole document", target: target?.id, targetLabel: target ? label(target) : undefined, payload: { orientation, pageSize: page_size, margins, sectionBreakAfterId: section_break_after_id }, risk: target ? "medium" : "low" }, target ? [target] : []);
      if (s.page && !target) s.page = { ...s.page, orientation: orientation ?? s.page.orientation };
      return { proposal: p.id };
    },
  });

  const insert_cross_reference = defineTool<{ id: string; target_heading_id: string; anchor_text?: string; format?: "text" | "page" | "number" }>({
    name: "insert_cross_reference",
    description: "Insert a live cross-reference to a heading (Word REF/PAGEREF field to a bookmark on the heading): format text = heading text, page = page number, number = heading number. Placed after anchor_text in the block (or at its end).",
    parameters: { type: "object", properties: { id: { type: "string" }, target_heading_id: { type: "string" }, anchor_text: { type: "string" }, format: { type: "string", enum: ["text", "page", "number"] } }, required: ["id", "target_heading_id"] },
    label: () => "Inserting cross-reference",
    execute: ({ id, target_heading_id, anchor_text, format }) => {
      const { block } = getBlock(s, id);
      const target = getBlock(s, target_heading_id).block;
      if (target.type !== "heading") throw new Error(`Block ${target_heading_id} is not a heading; cross-reference headings (get_outline).`);
      if (anchor_text && !block.text.includes(anchor_text)) throw new Error(`"${anchor_text}" not found in ¶${block.index}`);
      const bookmark = `_Ref${target.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`;
      const fmt = format ?? "text";
      const instr = fmt === "page" ? ` PAGEREF ${bookmark} \\h ` : fmt === "number" ? ` REF ${bookmark} \\r \\h ` : ` REF ${bookmark} \\h `;
      const display = fmt === "page" ? "[page]" : fmt === "number" ? "[number]" : target.text;
      const p = propose({ kind: "insert_cross_reference", title: `Cross-reference to “${preview(target.text, 40)}” in ${label(block)}`, summary: `${fmt} → ${preview(display, 60)}`, target: block.id, targetLabel: label(block), payload: { id: block.id, targetId: target.id, bookmark, instr, display, anchorText: anchor_text }, risk: "low" }, [block, target]);
      touch(block);
      block.text = anchor_text ? block.text.replace(anchor_text, `${anchor_text}${display}`) : `${block.text}${display}`;
      block.fields = [...(block.fields ?? []), instr.trim()];
      touchBlock(block);
      return { proposal: p.id, bookmark, after: after([block]) };
    },
  });

  const accept_reject_changes = defineTool<{ action: "accept" | "reject"; author?: string; scope_heading_id?: string; change_ids?: string[] }>({
    name: "accept_reject_changes",
    description: "Accept or reject pending tracked changes: all of them, those by one author, those in a section, or specific change ids (from get_tracked_changes).",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["accept", "reject"] }, author: { type: "string" }, scope_heading_id: { type: "string" }, change_ids: { type: "array", items: { type: "string" } } }, required: ["action"] },
    label: (a) => `${a.action === "accept" ? "Accepting" : "Rejecting"} changes`,
    execute: ({ action, author: by, scope_heading_id, change_ids }) => {
      const blocks = scopeBlocks(scope_heading_id);
      const hits = blocks.flatMap((b) => (b.changes ?? []).map((c) => ({ c, b }))).filter(({ c }) => (!by || c.author.toLowerCase() === by.toLowerCase()) && (!change_ids?.length || change_ids.includes(c.id)));
      if (!hits.length) return { count: 0, note: "No matching tracked changes" };
      const ids = Array.from(new Set(hits.map((h) => h.c.id)));
      const affected = Array.from(new Set(hits.map((h) => h.b)));
      const p = propose({ kind: "accept_reject_changes", title: `${action === "accept" ? "Accept" : "Reject"} ${ids.length} change${ids.length > 1 ? "s" : ""}${by ? ` by ${by}` : ""}`, summary: preview(hits.map((h) => `${h.c.kind}: ${h.c.text}`).join(" · "), 200), target: affected[0].id, targetLabel: label(affected[0]), payload: { action, changeIds: ids, author: by ?? null }, risk: "medium" }, affected);
      for (const b of affected) b.changes = (b.changes ?? []).filter((c) => !ids.includes(c.id));
      return { proposal: p.id, count: ids.length };
    },
  });

  const numbering_fix = defineTool<{ block_id: string; action: "restart" | "continue"; start?: number; style?: "decimal" | "legal" | "outline" | "alpha" | "roman" }>({
    name: "numbering_fix",
    description: "Fix list numbering for the list containing block_id: restart (optionally at start) or continue from the previous list of the same kind; optionally change the numbering style (decimal, legal 1.1.1, outline (a)(i), alpha, roman). Exports as Word list restarts/continuations.",
    parameters: { type: "object", properties: { block_id: { type: "string" }, action: { type: "string", enum: ["restart", "continue"] }, start: { type: "integer" }, style: { type: "string", enum: ["decimal", "legal", "outline", "alpha", "roman"] } }, required: ["block_id", "action"] },
    label: (a) => (a.action === "restart" ? "Restarting numbering" : "Continuing numbering"),
    execute: ({ block_id, action, start, style }) => {
      const { block } = getBlock(s, block_id);
      if (!block.listInfo?.listId) throw new Error(`¶${block.index} is not in a numbered list.`);
      const listId = block.listInfo.listId;
      const items = s.blocks.filter((b) => b.listInfo?.listId === listId);
      const p = propose({ kind: "numbering_fix", title: `${action === "restart" ? `Restart numbering${start ? ` at ${start}` : ""}` : "Continue numbering"} at ${label(block)}${style ? ` (${style})` : ""}`, summary: `${items.length} item(s)`, target: block.id, targetLabel: label(block), payload: { listId, action, start: action === "restart" ? (start ?? 1) : undefined, style }, risk: "low" }, [block]);
      return { proposal: p.id, items: items.length };
    },
  });

  const insertSection = (id: string, position: "after" | "before" | undefined, nodes: PMNode[], title: string, kind = "apply_template_section", extra: Record<string, unknown> = {}) => {
    const { block, i } = getBlock(s, id);
    const at = position === "before" ? i : i + 1;
    const blocks = insertBlocksAt(s, at, nodes);
    for (const b of blocks) touched.set(b.id, "");
    const p = propose({ kind, title: `Insert ${title} ${position === "before" ? "before" : "after"} ${label(block)}`, summary: preview(blocks.map((b) => b.text).filter(Boolean).join(" ¶ "), 220), target: block.id, targetLabel: label(block), payload: { id: block.id, position: position ?? "after", blocks: nodes, blockIds: blocks.map((b) => b.id), ...extra }, risk: "low" }, [block]);
    return { proposal: p.id, inserted: blocks.length, first_block_id: blocks[0]?.id, placeholders: Array.from(new Set(findPlaceholders(blocks.map((b) => b.text).join("\n")))) };
  };

  const legal_caption = defineTool<{ id: string; position?: "after" | "before"; document_title?: string }>({
    name: "legal_caption",
    description: "Insert a court caption block built from the matter record (court, division, parties, case number, judge, document title). Fields the matter record lacks are left as [PLACEHOLDERS] — never invented.",
    parameters: { type: "object", properties: { id: { type: "string" }, position: { type: "string", enum: ["after", "before"] }, document_title: { type: "string" } }, required: ["id"] },
    label: () => "Inserting caption",
    execute: ({ id, position, document_title }) => {
      const info = captionFromMatter(ctx.matter, document_title ?? s.title);
      const r = insertSection(id, position ?? "before", captionBlock(info), "court caption", "apply_template_section", { section: "caption_block" });
      return { ...r, from_matter: Boolean(ctx.matter), note: ctx.matter ? undefined : "No matter is linked: caption fields are placeholders." };
    },
  });

  const signature_block = defineTool<{ id: string; position?: "after" | "before"; attorney?: string; bar_no?: string; for_party?: string; date?: string }>({
    name: "signature_block",
    description: "Insert a signature block (\"Respectfully submitted\", firm, /s/ signature, bar number, contact lines). Only pass attorney/bar_no you were given; missing details stay as [PLACEHOLDERS].",
    parameters: { type: "object", properties: { id: { type: "string" }, position: { type: "string", enum: ["after", "before"] }, attorney: { type: "string" }, bar_no: { type: "string" }, for_party: { type: "string" }, date: { type: "string" } }, required: ["id"] },
    label: () => "Inserting signature block",
    execute: ({ id, position, attorney, bar_no, for_party, date }) => {
      const party = for_party ?? (ctx.matter ? `${ctx.matter.clientSide === "plaintiff" ? "Plaintiff" : ctx.matter.clientSide === "defendant" ? "Defendant" : ""} ${ctx.matter.client}`.trim() : undefined);
      return insertSection(id, position, signatureBlock({ attorney, barNo: bar_no, forParty: party, date }), "signature block", "apply_template_section", { section: "signature_block" });
    },
  });

  const apply_template_section = defineTool<{ id: string; template_section: TemplateSectionId; position?: "after" | "before" }>({
    name: "apply_template_section",
    description: `Insert a standard drafting block after (default) or before a block: ${TEMPLATE_SECTIONS.map((t) => `${t.id} (${t.description})`).join("; ")}. Placeholders appear in [BRACKETS] for the drafter to complete.`,
    parameters: { type: "object", properties: { id: { type: "string" }, template_section: { type: "string", enum: TEMPLATE_SECTIONS.map((t) => t.id) }, position: { type: "string", enum: ["after", "before"] } }, required: ["id", "template_section"] },
    label: (a) => `Inserting ${String(a.template_section).replace(/_/g, " ")}`,
    execute: ({ id, template_section, position }) => {
      if (!TEMPLATE_SECTIONS.some((t) => t.id === template_section)) throw new Error(`Unknown template section ${template_section}`);
      const nodes = buildTemplateSection(template_section, { matter: ctx.matter, documentTitle: s.title, date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) });
      return insertSection(id, position, nodes, template_section.replace(/_/g, " "), "apply_template_section", { section: template_section });
    },
  });

  const set_document_title = defineTool<{ title: string }>({
    name: "set_document_title",
    description: "Rename the document (the file title, not a heading).",
    parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    label: () => "Renaming document",
    execute: ({ title }) => {
      const p = propose({ kind: "set_document_title", title: `Rename to “${preview(title, 60)}”`, summary: `was “${s.title}”`, payload: { title, oldTitle: s.title }, risk: "low" }, []);
      s.title = title;
      return { proposal: p.id };
    },
  });

  const polish_section = defineTool<{ heading_id: string; goals: string[] }>({
    name: "polish_section",
    description: "Polish every paragraph of a section for the given goals (e.g. 'tighten', 'plain English', 'active voice', 'consistent defined terms', 'persuasive tone', 'remove redundancy'); proposes a tracked rewrite per paragraph that changes. Use \"document\" as heading_id to polish everything.",
    parameters: { type: "object", properties: { heading_id: { type: "string" }, goals: { type: "array", items: { type: "string" } } }, required: ["heading_id", "goals"] },
    label: () => "Polishing section",
    timeoutMs: 180_000,
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
        propose({ kind: "rewrite_paragraph", title: `Polish ${label(b)}`, summary: `${r.note ? `${r.note}\n` : ""}− ${preview(b.text, 160)}\n+ ${preview(newText, 160)}`, target: b.id, targetLabel: label(b), payload: { id: b.id, markdown: r.markdown, text: newText, oldText: b.text }, risk: "low" }, [b]);
        touch(b);
        b.text = newText; b.marks = undefined; touchBlock(b);
      }
      return { paragraphs_reviewed: blocks.length, proposals: changed };
    },
  });

  const fix_citations = defineTool<{ scope_heading_id?: string }>({
    name: "fix_citations",
    description: "Cite-check: find citation-like strings and bracketed placeholders (document or section), verify citations against CourtListener when research is on, normalize reporter/section-symbol spacing as tracked replacements, and flag unresolved or placeholder citations with [VERIFY] comments.",
    parameters: { type: "object", properties: { scope_heading_id: { type: "string" } }, required: [] },
    label: () => "Cite-checking",
    timeoutMs: 90_000,
    execute: async ({ scope_heading_id }) => {
      const targets = scopeBlocks(scope_heading_id);
      const found: { block: SnapshotBlock; cite: string }[] = [];
      const placeholders: { block: SnapshotBlock; text: string }[] = [];
      for (const b of targets) {
        for (const c of findCitations(b.text)) found.push({ block: b, cite: c });
        for (const p of findPlaceholders(b.text)) if (/VERIFY|CITE|CITATION|TBD|INSERT/i.test(p)) placeholders.push({ block: b, text: p });
      }
      const fixes: [RegExp, string, string][] = [[/\bF\.\s+(2d|3d|4th)\b/g, "F.$1", "reporter spacing"], [/\bF\.\s?Supp\.\s+(2d|3d)\b/g, "F. Supp. $1", "F. Supp. spacing"], [/\bU\.S\.C\.\s*§\s*(\d)/g, "U.S.C. § $1", "section symbol spacing"], [/\bC\.F\.R\.\s*§\s*(\d)/g, "C.F.R. § $1", "section symbol spacing"], [/\bS\.\s?Ct\b(?!\.)/g, "S. Ct.", "S. Ct. abbreviation"]];
      let normalized = 0;
      for (const b of targets) {
        for (const [re, rep, why] of fixes) {
          if (!re.test(b.text)) { re.lastIndex = 0; continue; }
          re.lastIndex = 0;
          const newText = b.text.replace(re, rep);
          if (newText !== b.text) {
            propose({ kind: "replace_text_in_paragraph", title: `Normalize citation in ${label(b)}`, summary: why, target: b.id, targetLabel: label(b), payload: { id: b.id, find: re.source, replace: rep, all: true, regex: true, caseSensitive: true, oldText: b.text, text: newText }, risk: "low" }, [b]);
            touch(b);
            b.text = newText; touchBlock(b); normalized++;
          }
        }
      }
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
        if (!v && (deps.verifyCitations && ctx.research)) continue;
        if (!ctx.research && !/U\.S\.C\.|C\.F\.R\./.test(f.cite)) {
          flaggedIds.add(key); flagged++;
          propose({ kind: "add_comment", title: `[VERIFY] ${preview(f.cite, 40)}`, summary: `Citation not verified (research off). Confirm reporter, pin cite and parenthetical before filing.`, target: f.block.id, targetLabel: label(f.block), payload: { id: f.block.id, text: `[VERIFY] Citation "${f.cite}" has not been verified against a reporter. Confirm the case name, reporter volume/page, pin cite and year before filing.`, quote: f.cite }, risk: "low" }, [f.block]);
        } else if (v && !v.resolved) {
          flaggedIds.add(key); flagged++;
          propose({ kind: "add_comment", title: `[VERIFY] unresolved ${preview(f.cite, 40)}`, summary: "CourtListener could not resolve this citation.", target: f.block.id, targetLabel: label(f.block), payload: { id: f.block.id, text: `[VERIFY] "${f.cite}" did not resolve in CourtListener. It may be mistyped, a placeholder, or an unpublished/WL cite. Replace with a verified Bluebook citation.`, quote: f.cite }, risk: "medium" }, [f.block]);
        }
      }
      for (const p of placeholders) {
        flagged++;
        propose({ kind: "add_comment", title: `Placeholder ${preview(p.text, 30)}`, summary: "Bracketed placeholder must be completed before filing.", target: p.block.id, targetLabel: label(p.block), payload: { id: p.block.id, text: `Placeholder ${p.text} must be replaced with the actual citation/text before filing.`, quote: p.text }, risk: "low" }, [p.block]);
      }
      return { citations_found: unique, verified: verified.map((v) => ({ citation: v.citation, resolved: v.resolved, match: v.matches?.[0]?.case_name })), placeholders: placeholders.map((p) => p.text), normalized, flagged };
    },
  });

  const all = [
    get_outline, get_paragraphs, get_section, find_text, get_selection, get_comments, get_document_stats, get_tracked_changes, get_styles, check_defined_terms, check_citations, verify_edits,
    rewrite_paragraph, replace_text_in_paragraph, find_replace, makeInsert("insert_after"), makeInsert("insert_before"), delete_paragraph, edit_table_cell, insert_comment, resolve_comment, fix_citations, redline_compare,
    move_block, apply_style, set_heading_level, format_text, set_alignment, insert_table, merge_cells, insert_image_after, insert_diagram_after, insert_page_break_after, insert_footnote, insert_toc, update_fields,
    set_page_setup, insert_cross_reference, accept_reject_changes, numbering_fix, legal_caption, signature_block, apply_template_section, set_document_title, polish_section,
  ] as unknown as ToolDef<never, unknown>[];
  return all.filter((t) => wordToolAllowed(t.name, ctx.mode));
}
