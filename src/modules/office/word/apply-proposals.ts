/**
 * Apply agent proposals to the live TipTap editor by block id. Rewrites and
 * replacements become word-level tracked changes; structural inserts get
 * insertion marks; formatting/style changes apply directly.
 */
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNodeT } from "@tiptap/pm/model";
import { Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { nanoid } from "nanoid";
import type { OfficeComment } from "@/lib/types/domain";
import type { EditProposal } from "@/modules/office/shared/types";
import { cloneNode, inlineFromMarkdown, markInInline, markdownToBlocks, newId, replaceInInline, type ChangeMarkAttrs, type PMNode } from "./doc-model";
import { findBlockPos } from "./extensions";
import { buildTrackedInline, markBlocksDeleted, markBlocksInserted } from "./tracked-diff";

export interface ApplyContext {
  editor: Editor;
  trackChanges: boolean;
  author: string;
  addComment: (input: { anchor: string; body: string; quote?: string; source?: "user" | "agent" }) => Promise<OfficeComment>;
  setTitle: (title: string) => Promise<void>;
  renderMermaid: (source: string) => Promise<string>;
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
export async function applyProposal(p: EditProposal, ctx: ApplyContext): Promise<number | null> {
  const { editor } = ctx;
  const payload = p.payload as Record<string, unknown>;
  const dispatch = (tr: Transaction) => { tr.setMeta("trackChanges", "ignore"); editor.view.dispatch(tr); };

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
    case "set_style": return setStyle(ctx, String(payload.id), String(payload.style));
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
      const r = markInInline(inlineJSON(node), String(payload.anchorText), [{ type: "footnote", attrs: { id: String(payload.footnoteId ?? nanoid(6)), text: String(payload.footnoteText) } }], { all: false });
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
