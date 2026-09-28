/**
 * Apply agent proposals to the live TipTap editor by block id. Rewrites and
 * replacements become word-level tracked changes; structural inserts get
 * insertion marks; formatting/style changes apply directly.
 */
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNodeT } from "@tiptap/pm/model";
import { Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { CellSelection, TableMap, mergeCells } from "@tiptap/pm/tables";
import { nanoid } from "nanoid";
import type { OfficeComment } from "@/lib/types/domain";
import type { EditProposal } from "@/modules/office/shared/types";
import type { DocSettings } from "./constants";
import { blockText, cloneNode, inlineFromMarkdown, markInInline, markdownToBlocks, newId, replaceInInline, sliceSpans, spansText, toSpans, type ChangeMarkAttrs, type PMNode } from "./doc-model";
import { findBlockPos } from "./extensions";
import { checkFreshness } from "./proposal-freshness";
import { buildTrackedInline, markBlocksDeleted, markBlocksInserted } from "./tracked-diff";

export interface ApplyContext {
  editor: Editor;
  trackChanges: boolean;
  author: string;
  addComment: (input: { anchor: string; body: string; quote?: string; source?: "user" | "agent" }) => Promise<OfficeComment>;
  setTitle: (title: string) => Promise<void>;
  renderMermaid: (source: string) => Promise<string>;
  /** Resolve a comment (DB comment or imported .docx comment), optionally with a reply. */
  resolveComment?: (id: string, note?: string) => Promise<void>;
  /** Current page setup and a setter (set_page_setup). */
  settings?: DocSettings;
  updateSettings?: (patch: Partial<DocSettings>) => void;
}

export interface ApplyOutcome { firstPos: number | null }

const change = (ctx: ApplyContext): ChangeMarkAttrs => ({ id: nanoid(8), author: ctx.author, date: new Date().toISOString() });

function inlineJSON(node: PMNodeT): PMNode[] { return (node.content.toJSON() as PMNode[] | null) ?? []; }

function replaceInline(tr: Transaction, pos: number, node: PMNodeT, content: PMNode[]) {
  const frag = Fragment.fromJSON(tr.doc.type.schema, content);
  tr.replaceWith(pos + 1, pos + 1 + node.content.size, frag);
}

function requireBlock(editor: Editor, id: string) {
  const hit = findBlockPos(editor.state.doc, id);
  if (!hit) throw new Error(`Block ${id} no longer exists (¶ may have been deleted or merged)`);
  return hit;
}

/** Wrap blocks so they fit where they are inserted (e.g. paragraphs inside a list become list items). */
function adaptBlocksForParent(schema: PMNodeT["type"]["schema"], parent: PMNodeT, blocks: PMNode[]): PMNode[] {
  if (parent.type.name !== "listItem" && parent.type.name !== "taskItem") return blocks;
  const out: PMNode[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "heading") out.push({ type: parent.type.name, attrs: { id: newId() }, content: [b.type === "heading" ? { ...b, type: "paragraph", attrs: { id: b.attrs?.id, textAlign: b.attrs?.textAlign } } : b] });
    else if (b.type === "bulletList" || b.type === "orderedList") out.push(...(b.content ?? []));
    else out.push({ type: parent.type.name, attrs: { id: newId() }, content: [b] });
  }
  void schema;
  return out;
}

/** Insert JSON blocks at a document position, climbing out of containers that cannot hold them. */
function insertBlocks(tr: Transaction, insertPos: number, blocks: PMNode[], opts: { asListItems?: boolean } = {}): { from: number; to: number } {
  const schema = tr.doc.type.schema;
  let $pos = tr.doc.resolve(insertPos);
  let json = blocks;
  const parentList = $pos.depth > 0 && ($pos.parent.type.name === "listItem" || $pos.parent.type.name === "taskItem") ? $pos.parent : null;
  if (parentList && opts.asListItems !== false) {
    // Insert as sibling items after the containing list item.
    json = adaptBlocksForParent(schema, parentList, blocks);
    insertPos = $pos.after($pos.depth);
    $pos = tr.doc.resolve(insertPos);
  }
  let nodes = json.map((b) => schema.nodeFromJSON(b));
  let frag = Fragment.from(nodes);
  let guard = 0;
  while ($pos.depth > 0 && !$pos.parent.canReplace($pos.index(), $pos.index(), frag) && guard++ < 10) {
    insertPos = $pos.after($pos.depth);
    $pos = tr.doc.resolve(insertPos);
    if ($pos.parent.type.name !== "listItem" && json !== blocks) { json = blocks; nodes = json.map((b) => schema.nodeFromJSON(b)); frag = Fragment.from(nodes); }
  }
  if ($pos.depth === 0 && !$pos.parent.canReplace($pos.index(), $pos.index(), frag)) {
    // Fall back: wrap unsupported nodes in paragraphs of their text.
    nodes = json.map((b) => (b.type === "paragraph" || b.type === "heading" ? schema.nodeFromJSON(b) : schema.nodes.paragraph.create({ id: newId() }, schema.text(JSON.stringify(b).slice(0, 200)))));
    frag = Fragment.from(nodes);
  }
  tr.insert(insertPos, frag);
  return { from: insertPos, to: insertPos + frag.size };
}

function setStyle(ctx: ApplyContext, id: string, style: string): number {
  const { editor } = ctx;
  const { node, pos } = requireBlock(editor, id);
  const chain = editor.chain().setTextSelection(pos + 1);
  const inList = (() => { const $p = editor.state.doc.resolve(pos); for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "listItem") return true; return false; })();
  const inQuote = (() => { const $p = editor.state.doc.resolve(pos); for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "blockquote") return true; return false; })();
  const attrs = { pStyle: null as string | null };
  switch (style) {
    case "body": chain.setParagraph().updateAttributes("paragraph", attrs); if (inList) chain.liftListItem("listItem"); if (inQuote) chain.lift("blockquote"); break;
    case "title": chain.setHeading({ level: 1 }).updateAttributes("heading", { pStyle: "title", textAlign: "center" }); break;
    case "heading1": case "heading2": case "heading3": if (inList) chain.liftListItem("listItem"); chain.setHeading({ level: Number(style.slice(-1)) as 1 | 2 | 3 }).updateAttributes("heading", attrs); break;
    case "blockquote": chain.setParagraph(); if (!inQuote) chain.wrapIn("blockquote"); break;
    case "caption": chain.setParagraph().updateAttributes("paragraph", { pStyle: "caption", textAlign: "center" }); break;
    case "legal_numbered": chain.setParagraph().updateAttributes("paragraph", attrs); if (!inList) chain.toggleOrderedList(); chain.updateAttributes("orderedList", { listStyle: "legal" }); break;
    case "numbered_list": chain.setParagraph().updateAttributes("paragraph", attrs); if (!inList) chain.toggleOrderedList(); chain.updateAttributes("orderedList", { listStyle: "decimal" }); break;
    case "bullet_list": chain.setParagraph().updateAttributes("paragraph", attrs); if (!inList) chain.toggleBulletList(); break;
    default: throw new Error(`Unknown style ${style}`);
  }
  chain.setMeta("trackChanges", "ignore").run();
  void node;
  return pos;
}

const MARK_MAP: Record<string, (v: unknown) => { type: string; attrs?: Record<string, unknown> } | null> = {
  bold: () => ({ type: "bold" }),
  italic: () => ({ type: "italic" }),
  underline: () => ({ type: "underline" }),
  strike: () => ({ type: "strike" }),
  small_caps: () => ({ type: "smallCaps" }),
  highlight: (v) => ({ type: "highlight", attrs: { color: typeof v === "string" ? v : "#fff3a3" } }),
  color: (v) => ({ type: "textStyle", attrs: { color: String(v) } }),
  font_size: (v) => ({ type: "textStyle", attrs: { fontSize: /^\d+(\.\d+)?$/.test(String(v)) ? `${v}pt` : String(v) } }),
};

/** Apply one proposal. Throws with a readable message on failure. Returns the document position of the change. */
export async function applyProposal(p: EditProposal, ctxIn: ApplyContext): Promise<number | null> {
  const payload = p.payload as Record<string, unknown>;
  // Review-mode suggestions are always tracked changes, whatever the editor's track-changes toggle says.
  const ctx: ApplyContext = payload.forceTrack ? { ...ctxIn, trackChanges: true } : ctxIn;
  const { editor } = ctx;
  const dispatch = (tr: Transaction) => { tr.setMeta("trackChanges", "ignore"); editor.view.dispatch(tr); };
  const fresh = checkFreshness(p.kind, payload, (id) => liveBlock(editor, id));
  if (fresh.status === "stale") throw new Error(`Stale proposal — ${fresh.reason}. Ask the assistant to redo it on the current text.`);

  switch (p.kind) {
    case "rewrite_paragraph": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const next = inlineFromMarkdown(String(payload.markdown ?? payload.text ?? ""));
      const content = buildTrackedInline(inlineJSON(node), next, { change: change(ctx), track: ctx.trackChanges });
      const tr = editor.state.tr;
      replaceInline(tr, pos, node, content);
      dispatch(tr);
      return pos;
    }
    case "replace_text_in_paragraph": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const old = inlineJSON(node);
      const r = replaceInInline(old, String(payload.find), String(payload.replace ?? ""), { regex: Boolean(payload.regex), caseSensitive: Boolean(payload.caseSensitive), all: payload.all !== false });
      if (!r.count) throw new Error(`"${String(payload.find)}" not found in the paragraph anymore`);
      const content = buildTrackedInline(old, r.content, { change: change(ctx), track: ctx.trackChanges });
      const tr = editor.state.tr;
      replaceInline(tr, pos, node, content);
      dispatch(tr);
      return pos;
    }
    case "find_replace_all": {
      const ids = (payload.blockIds as string[] | undefined) ?? [];
      const tr = editor.state.tr;
      const ch = change(ctx);
      let first: number | null = null;
      let count = 0;
      // Apply from the end so positions remain valid.
      const hits = ids.map((id) => findBlockPos(editor.state.doc, id)).filter((h): h is NonNullable<typeof h> => Boolean(h)).sort((a, b) => b.pos - a.pos);
      for (const { node, pos } of hits) {
        const old = inlineJSON(node);
        const r = replaceInInline(old, String(payload.find), String(payload.replace ?? ""), { regex: Boolean(payload.regex), caseSensitive: Boolean(payload.caseSensitive), wholeWord: Boolean(payload.wholeWord), all: true });
        if (!r.count) continue;
        count += r.count;
        replaceInline(tr, pos, node, buildTrackedInline(old, r.content, { change: ch, track: ctx.trackChanges }));
        first = pos;
      }
      if (!count) throw new Error(`"${String(payload.find)}" not found`);
      dispatch(tr);
      return first;
    }
    case "insert_after": case "insert_before": case "insert_table_after": case "insert_toc_after": case "apply_template_section": case "insert_page_break_after": case "insert_image_after": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      let blocks = cloneNode((payload.blocks as PMNode[] | undefined) ?? markdownToBlocks(String(payload.markdown ?? "")));
      if (!blocks.length) throw new Error("Nothing to insert");
      if (ctx.trackChanges) blocks = markBlocksInserted(blocks, change(ctx));
      const before = p.kind === "insert_before" || payload.position === "before";
      const tr = editor.state.tr;
      const r = insertBlocks(tr, before ? pos : pos + node.nodeSize, blocks);
      dispatch(tr);
      return r.from;
    }
    case "insert_diagram_after": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const src = await ctx.renderMermaid(String(payload.mermaid));
      let blocks = cloneNode((payload.blocks as PMNode[] | undefined) ?? []);
      if (!blocks.length) blocks = [{ type: "image", attrs: { id: newId(), src, alt: String(payload.caption ?? "Diagram"), width: Number(payload.width ?? 560), align: "center", mermaid: String(payload.mermaid) } }];
      for (const b of blocks) if (b.type === "image") b.attrs = { ...(b.attrs ?? {}), src, mermaid: String(payload.mermaid) };
      if (ctx.trackChanges) blocks = markBlocksInserted(blocks, change(ctx));
      const tr = editor.state.tr;
      const r = insertBlocks(tr, pos + node.nodeSize, blocks);
      dispatch(tr);
      return r.from;
    }
    case "delete_paragraph": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const tr = editor.state.tr;
      if (ctx.trackChanges && node.isTextblock && node.content.size > 0) {
        const marked = markBlocksDeleted([{ type: node.type.name, content: inlineJSON(node) }], change(ctx))[0];
        replaceInline(tr, pos, node, marked.content ?? []);
      } else {
        const $p = tr.doc.resolve(pos);
        const parent = $p.parent;
        if ((parent.type.name === "listItem" || parent.type.name === "taskItem") && parent.childCount === 1) tr.delete($p.before($p.depth), $p.after($p.depth));
        else tr.delete(pos, pos + node.nodeSize);
      }
      dispatch(tr);
      return Math.min(pos, editor.state.doc.content.size - 1);
    }
    case "move_block": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const json = node.toJSON() as PMNode;
      const afterId = String(payload.afterId);
      const tr = editor.state.tr;
      if (ctx.trackChanges && node.isTextblock && node.content.size > 0) {
        const marked = markBlocksDeleted([{ type: node.type.name, content: inlineJSON(node) }], change(ctx))[0];
        replaceInline(tr, pos, node, marked.content ?? []);
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId() });
      } else tr.delete(pos, pos + node.nodeSize);
      let insertAt = 0;
      if (afterId !== "start") {
        const target = findBlockPos(tr.doc, afterId);
        if (!target) throw new Error(`Target block ${afterId} not found`);
        insertAt = target.pos + target.node.nodeSize;
      } else insertAt = 0;
      const copy = ctx.trackChanges ? markBlocksInserted([json], change(ctx)) : [json];
      const r = insertBlocks(tr, insertAt, copy);
      dispatch(tr);
      return r.from;
    }
    case "set_style": {
      const pos = setStyle(ctx, String(payload.id), String(payload.style));
      if (payload.styleId !== undefined || payload.level) {
        const { node, pos: at } = requireBlock(editor, String(payload.id));
        const attrs: Record<string, unknown> = { ...node.attrs, styleId: payload.styleId ?? null };
        if (payload.level && node.type.name === "heading") attrs.level = Number(payload.level);
        dispatch(editor.state.tr.setNodeMarkup(at, undefined, attrs));
      }
      return pos;
    }
    case "set_heading_level": {
      const level = Number(payload.level ?? 0);
      const pos = setStyle(ctx, String(payload.id), level ? `heading${Math.min(3, level)}` : "body");
      const { node, pos: at } = requireBlock(editor, String(payload.id));
      dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, styleId: null, ...(level && node.type.name === "heading" ? { level } : {}) }));
      return pos;
    }
    case "resolve_comment": {
      if (!ctx.resolveComment) throw new Error("Comments cannot be resolved here");
      await ctx.resolveComment(String(payload.commentId), payload.note ? String(payload.note) : undefined);
      return null;
    }
    case "accept_reject_changes": {
      const ids = (payload.changeIds as string[] | undefined) ?? [];
      let n = 0;
      for (const id of ids) { const ok = payload.action === "reject" ? editor.commands.rejectChange(id) : editor.commands.acceptChange(id); if (ok) n++; }
      if (!n) throw new Error("Those tracked changes are no longer in the document");
      return null;
    }
    case "numbering_fix": return fixNumbering(editor, payload, dispatch);
    case "merge_cells": return mergeTableCells(editor, payload);
    case "insert_cross_reference": return insertCrossReference(ctx, payload, dispatch);
    case "update_fields": return updateFields(editor, payload, dispatch);
    case "set_page_setup": {
      if (!ctx.updateSettings || !ctx.settings) throw new Error("Page setup is not available here");
      const next: Partial<DocSettings> = {};
      if (payload.orientation) next.orientation = payload.orientation as DocSettings["orientation"];
      if (payload.pageSize) next.pageSize = payload.pageSize as DocSettings["pageSize"];
      if (payload.margins) next.margins = payload.margins as DocSettings["margins"];
      if (payload.sectionBreakAfterId) {
        // A section break carries the setup of the content after it (until the next break); the rest keeps its own.
        const { node, pos } = requireBlock(editor, String(payload.sectionBreakAfterId));
        const tr = editor.state.tr;
        const r = insertBlocks(tr, pos + node.nodeSize, [{ type: "pageBreak", attrs: { id: newId(), section: next } }]);
        dispatch(tr);
        return r.from;
      }
      ctx.updateSettings(next);
      return null;
    }
    case "redline_compare": return applyRedline(ctx, payload, dispatch);
    case "set_alignment": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: String(payload.align) });
      dispatch(tr);
      return pos;
    }
    case "format_text": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const marksIn = (payload.marks ?? {}) as Record<string, unknown>;
      const add: { type: string; attrs?: Record<string, unknown> }[] = [];
      const remove: string[] = [];
      for (const [k, v] of Object.entries(marksIn)) {
        const f = MARK_MAP[k];
        if (!f) continue;
        const m = f(v);
        if (!m) continue;
        if (v === false) remove.push(m.type); else add.push(m);
      }
      const r = markInInline(inlineJSON(node), String(payload.find), add, { all: payload.all !== false, remove });
      if (!r.count) throw new Error(`"${String(payload.find)}" not found in the paragraph`);
      const tr = editor.state.tr;
      replaceInline(tr, pos, node, r.content);
      dispatch(tr);
      return pos;
    }
    case "add_comment": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const quote = payload.quote ? String(payload.quote) : undefined;
      const c = await ctx.addComment({ anchor: String(payload.id), body: String(payload.text), quote, source: "agent" });
      if (quote && node.isTextblock) {
        const r = markInInline(inlineJSON(node), quote, [{ type: "comment", attrs: { id: c.id } }], { all: false });
        if (r.count) { const tr = editor.state.tr; replaceInline(tr, pos, node, r.content); dispatch(tr); }
      }
      return pos;
    }
    case "insert_footnote": {
      const { node, pos } = requireBlock(editor, String(payload.id));
      const r = markInInline(inlineJSON(node), String(payload.anchorText), [{ type: "footnote", attrs: { id: String(payload.footnoteId ?? nanoid(6)), text: String(payload.footnoteText), kind: payload.noteKind === "endnote" ? "endnote" : null } }], { all: false });
      if (!r.count) throw new Error(`Anchor text "${String(payload.anchorText)}" not found`);
      const tr = editor.state.tr;
      replaceInline(tr, pos, node, r.content);
      dispatch(tr);
      return pos;
    }
    case "set_document_title": { await ctx.setTitle(String(payload.title)); return null; }
    case "renumber_lists": {
      const tr = editor.state.tr;
      const style = payload.style ? String(payload.style) : null;
      const scopeId = payload.scopeHeadingId ? String(payload.scopeHeadingId) : null;
      let from = 0, to = editor.state.doc.content.size;
      if (scopeId) {
        const h = findBlockPos(editor.state.doc, scopeId);
        if (h) { from = h.pos; to = editor.state.doc.content.size; const level = Number(h.node.attrs.level ?? 1); editor.state.doc.descendants((n, p) => { if (p > h.pos && n.type.name === "heading" && Number(n.attrs.level ?? 1) <= level && to === editor.state.doc.content.size) to = p; }); }
      }
      let first: number | null = null;
      editor.state.doc.nodesBetween(from, to, (n, p) => {
        if (n.type.name === "orderedList") { tr.setNodeMarkup(p, undefined, { ...n.attrs, start: 1, ...(style ? { listStyle: style === "decimal" ? "decimal" : style } : {}) }); if (first == null) first = p; }
      });
      dispatch(tr);
      return first;
    }
    default:
      throw new Error(`Unsupported proposal kind "${p.kind}"`);
  }
}

/** The live block as the snapshot saw it (type, heading level, accepted text) — for stale checks. */
export function liveBlock(editor: Editor, id: string): { type: string; level?: number; text: string } | null {
  const hit = findBlockPos(editor.state.doc, id);
  if (!hit) return null;
  const json = hit.node.toJSON() as PMNode;
  return { type: json.type, level: json.type === "heading" ? Number(json.attrs?.level ?? 1) : undefined, text: blockText(json, "accepted") };
}

function fixNumbering(editor: Editor, payload: Record<string, unknown>, dispatch: (tr: Transaction) => void): number {
  const hit = findBlockPos(editor.state.doc, String(payload.listId));
  if (!hit) throw new Error("That list no longer exists");
  const { node, pos } = hit;
  const docx = { ...((node.attrs.docx as Record<string, unknown> | null) ?? {}) };
  const attrs: Record<string, unknown> = { ...node.attrs };
  if (payload.style && node.type.name === "orderedList") attrs.listStyle = payload.style === "decimal" ? "decimal" : payload.style;
  if (payload.action === "restart") {
    attrs.start = Number(payload.start ?? 1) || 1;
    docx.restart = true; delete docx.continue;
  } else {
    // Continue from the previous list of the same kind: share its Word numbering and pick up its count.
    let prev: PMNodeT | null = null;
    editor.state.doc.descendants((n, p) => { if (p >= pos) return false; if (n.type === node.type) prev = n; return true; });
    const previous = prev as PMNodeT | null;
    const prevDocx = (previous?.attrs.docx as Record<string, unknown> | null) ?? null;
    if (prevDocx?.numId) { docx.numId = prevDocx.numId; docx.ilvl = prevDocx.ilvl; }
    else docx.continue = true;
    delete docx.restart;
    if (previous && node.type.name === "orderedList") { attrs.start = Number(previous.attrs.start ?? 1) + previous.childCount; docx.importStart = attrs.start; }
  }
  attrs.docx = docx;
  dispatch(editor.state.tr.setNodeMarkup(pos, undefined, attrs));
  return pos;
}

function mergeTableCells(editor: Editor, payload: Record<string, unknown>): number {
  const hit = findBlockPos(editor.state.doc, String(payload.tableId));
  if (!hit || hit.node.type.name !== "table") throw new Error("That table no longer exists");
  const table = hit.node;
  const map = TableMap.get(table);
  const r0 = Number(payload.fromRow) - 1, c0 = Number(payload.fromCol) - 1, r1 = Number(payload.toRow) - 1, c1 = Number(payload.toCol) - 1;
  if (r1 >= map.height || c1 >= map.width || r0 < 0 || c0 < 0) throw new Error("Cell range is outside the table");
  const start = hit.pos + 1;
  const anchor = start + map.map[r0 * map.width + c0];
  const head = start + map.map[r1 * map.width + c1];
  const sel = CellSelection.create(editor.state.doc, anchor, head);
  const state = editor.state.apply(editor.state.tr.setSelection(sel));
  let ok = false;
  mergeCells(state, (tr) => { ok = true; const merged = editor.state.tr; for (const step of tr.steps) merged.step(step); merged.setMeta("trackChanges", "ignore"); editor.view.dispatch(merged); });
  if (!ok) throw new Error("Those cells cannot be merged (already merged or not rectangular)");
  return anchor;
}

function atom(kind: string, extra: Record<string, unknown> = {}): PMNode { return { type: "docxInline", attrs: { kind, ...extra } }; }

/** Insert inline nodes after the first occurrence of `anchor` (or at the end) in inline content. */
function insertInlineAfter(content: PMNode[], anchor: string | undefined, nodes: PMNode[]): PMNode[] {
  const spans = toSpans(content);
  const text = spansText(spans);
  const at = anchor ? text.indexOf(anchor) : -1;
  if (anchor && at < 0) throw new Error(`"${anchor}" not found in the paragraph`);
  const cut = at < 0 ? text.length : at + anchor!.length;
  return [...sliceSpans(spans, 0, cut), ...nodes, ...sliceSpans(spans, cut, text.length + 1)];
}

function insertCrossReference(ctx: ApplyContext, payload: Record<string, unknown>, dispatch: (tr: Transaction) => void): number {
  const { editor } = ctx;
  const bookmark = String(payload.bookmark);
  const target = requireBlock(editor, String(payload.targetId));
  let hasBookmark = false;
  target.node.forEach((n) => { if (n.type.name === "docxInline" && n.attrs.kind === "bookmarkStart" && n.attrs.name === bookmark) hasBookmark = true; });
  const tr = editor.state.tr;
  if (!hasBookmark) {
    const content = [atom("bookmarkStart", { name: bookmark, bid: bookmark }), ...inlineJSON(target.node), atom("bookmarkEnd", { bid: bookmark })];
    replaceInline(tr, target.pos, target.node, content);
  }
  const hit = findBlockPos(tr.doc, String(payload.id));
  if (!hit) throw new Error("The paragraph no longer exists");
  const display: PMNode = { type: "text", text: String(payload.display ?? ""), ...(ctx.trackChanges ? { marks: [{ type: "insertion", attrs: { ...change(ctx) } }] } : {}) };
  const nodes = [atom("fieldBegin", { instr: String(payload.instr), dirty: true }), atom("fieldSep"), ...(display.text ? [display] : []), atom("fieldEnd")];
  replaceInline(tr, hit.pos, hit.node, insertInlineAfter(inlineJSON(hit.node), payload.anchorText ? String(payload.anchorText) : undefined, nodes));
  dispatch(tr);
  return hit.pos;
}

/** Rebuild TOC entries and REF results from the current headings; mark every field dirty for Word. */
function updateFields(editor: Editor, payload: Record<string, unknown>, dispatch: (tr: Transaction) => void): number | null {
  const sections = (payload.sections as { id: string; title: string; index: number }[] | undefined) ?? [];
  const byId = new Map(sections.map((x) => [x.id, x]));
  const bookmarkText = new Map<string, string>();
  editor.state.doc.descendants((n) => {
    if (!n.isTextblock) return true;
    n.forEach((c) => { if (c.type.name === "docxInline" && c.attrs.kind === "bookmarkStart" && c.attrs.name) bookmarkText.set(String(c.attrs.name), n.textContent); });
    return false;
  });
  const tr = editor.state.tr;
  let changed = 0;
  const edits: { pos: number; node: PMNodeT; content: PMNode[] }[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    const content = inlineJSON(n);
    let touched = false;
    for (const c of content) if (c.type === "docxInline" && c.attrs?.kind === "fieldBegin" && !c.attrs.dirty) { c.attrs = { ...c.attrs, dirty: true }; touched = true; }
    // REF results between separator and end
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (c.type !== "docxInline" || c.attrs?.kind !== "fieldBegin") continue;
      const m = /^\s*REF\s+(\S+)/.exec(String(c.attrs.instr ?? ""));
      const text = m ? bookmarkText.get(m[1]) : undefined;
      if (!text) continue;
      const sep = content.findIndex((x, k) => k > i && x.type === "docxInline" && x.attrs?.kind === "fieldSep");
      const end = content.findIndex((x, k) => k > sep && x.type === "docxInline" && x.attrs?.kind === "fieldEnd");
      if (sep < 0 || end < 0) continue;
      content.splice(sep + 1, end - sep - 1, { type: "text", text });
      touched = true;
    }
    const tocRef = n.attrs.tocRef ? byId.get(String(n.attrs.tocRef)) : undefined;
    if (tocRef && n.attrs.pStyle === "toc_entry") {
      const atoms = content.filter((c) => c.type === "docxInline");
      const lead = atoms.filter((a) => a.attrs?.kind === "fieldBegin" || a.attrs?.kind === "fieldSep");
      const tail = atoms.filter((a) => a.attrs?.kind === "fieldEnd");
      content.splice(0, content.length, ...lead, { type: "text", text: `${tocRef.title} .......... ¶${tocRef.index}` }, ...tail);
      touched = true;
    }
    if (touched) { edits.push({ pos, node: n, content }); changed++; }
    return false;
  });
  for (const e of edits.sort((a, b) => b.pos - a.pos)) replaceInline(tr, e.pos, e.node, e.content);
  if (!changed) return null;
  dispatch(tr);
  return edits[edits.length - 1]?.pos ?? null;
}

function applyRedline(ctx: ApplyContext, payload: Record<string, unknown>, dispatch: (tr: Transaction) => void): number | null {
  const { editor } = ctx;
  const ops = (payload.ops as ({ op: "modify"; id: string; base: string } | { op: "insert"; id: string } | { op: "delete"; after_id: string | null; base: string; base_type: string })[] | undefined) ?? [];
  const ch = change({ ...ctx, author: ctx.author });
  const tr = editor.state.tr;
  let first: number | null = null;
  for (const op of ops) {
    if (op.op === "delete") continue;
    const hit = findBlockPos(tr.doc, op.id);
    if (!hit) continue;
    const current = inlineJSON(hit.node);
    const content = op.op === "modify" ? buildTrackedInline(op.base ? [{ type: "text", text: op.base }] : [], current, { change: ch, track: true }) : markBlocksInserted([{ type: "paragraph", content: current }], ch)[0].content ?? [];
    replaceInline(tr, hit.pos, hit.node, content);
    first ??= hit.pos;
  }
  // Removed paragraphs come back as tracked deletions after the block that preceded them.
  for (const op of ops.slice().reverse()) {
    if (op.op !== "delete" || !op.base.trim()) continue;
    const anchor = op.after_id ? findBlockPos(tr.doc, op.after_id) : null;
    const node: PMNode = { type: op.base_type === "heading" ? "heading" : "paragraph", attrs: { id: newId(), ...(op.base_type === "heading" ? { level: 2 } : {}) }, content: [{ type: "text", text: op.base, marks: [{ type: "deletion", attrs: { ...ch } }] }] };
    insertBlocks(tr, anchor ? anchor.pos + anchor.node.nodeSize : 0, [node]);
  }
  dispatch(tr);
  return first;
}

/** Scroll to and select a position. */
export function revealPosition(editor: Editor, pos: number) {
  try {
    const clamped = Math.max(1, Math.min(pos + 1, editor.state.doc.content.size - 1));
    // Selection.near finds the closest inline position (pos + 1 may sit on a block boundary, e.g. after wrapping in a blockquote).
    const sel = Selection.near(editor.state.doc.resolve(clamped), 1);
    editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView());
    const dom = editor.view.domAtPos(clamped).node as HTMLElement | Text;
    const el = dom instanceof HTMLElement ? dom : dom.parentElement;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch { /* ignore */ }
}

export function revealBlock(editor: Editor, id: string): boolean {
  const hit = findBlockPos(editor.state.doc, id);
  if (!hit) return false;
  const { node, pos } = hit;
  try {
    if (node.isTextblock) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1, pos + 1 + node.content.size)).scrollIntoView());
    else editor.commands.setNodeSelection(pos);
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch { /* ignore */ }
  return true;
}
