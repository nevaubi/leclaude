/**
 * Custom TipTap v3 extensions for the Word editor: BlockId, TrackChanges
 * (insertion/deletion marks + typing interception + accept/reject), Comment
 * and Footnote marks, PageBreak node, paragraph attributes (line height,
 * spacing, indent, style), legal-numbered ordered lists, SmallCaps, a
 * resizable/alignable Image and the paragraph-number gutter.
 */
import { Extension, Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { OrderedList } from "@tiptap/extension-list";
import { Fragment, Slice, type Node as PMNode, type Mark as PMMark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { nanoid } from "nanoid";
import { BLOCK_ID_TYPES, BLOCK_ID_TYPE_SET } from "./doc-model";

// ---------------------------------------------------------------------------
// BlockId
// ---------------------------------------------------------------------------

export const blockIdKey = new PluginKey("blockId");

export const BlockId = Extension.create({
  name: "blockId",
  addGlobalAttributes() {
    return [{
      types: [...BLOCK_ID_TYPES],
      attributes: {
        id: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => el.getAttribute("data-id"),
          renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdKey,
        appendTransaction: (trs, _old, newState) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          const tr = newState.tr;
          let changed = false;
          newState.doc.descendants((node, pos) => {
            if (!BLOCK_ID_TYPE_SET.has(node.type.name)) return;
            const id = node.attrs.id as string | null;
            if (!id || seen.has(id)) {
              const next = nanoid(8);
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: next });
              seen.add(next);
              changed = true;
            } else seen.add(id);
          });
          if (!changed) return null;
          tr.setMeta("trackChanges", "ignore");
          tr.setMeta("blockId", true);
          return tr;
        },
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// Tracked changes
// ---------------------------------------------------------------------------

export function authorIndex(author: string | null | undefined): number {
  const s = author ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 6;
}

const changeAttrs = () => ({
  id: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-change-id"), renderHTML: (a: Record<string, unknown>) => ({ "data-change-id": a.id }) },
  author: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-author"), renderHTML: (a: Record<string, unknown>) => ({ "data-author": a.author }) },
  date: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-date"), renderHTML: (a: Record<string, unknown>) => ({ "data-date": a.date }) },
});

export const Insertion = Mark.create({
  name: "insertion",
  inclusive: true,
  excludes: "deletion",
  addAttributes: changeAttrs,
  parseHTML: () => [{ tag: "ins[data-change-id]" }],
  renderHTML({ HTMLAttributes, mark }) {
    return ["ins", mergeAttributes(HTMLAttributes, { class: `tc-ins tc-author-${authorIndex(mark.attrs.author as string)}`, title: `Inserted by ${mark.attrs.author ?? "unknown"}` }), 0];
  },
});

export const Deletion = Mark.create({
  name: "deletion",
  inclusive: false,
  excludes: "insertion",
  addAttributes: changeAttrs,
  parseHTML: () => [{ tag: "del[data-change-id]" }],
  renderHTML({ HTMLAttributes, mark }) {
    return ["del", mergeAttributes(HTMLAttributes, { class: `tc-del tc-author-${authorIndex(mark.attrs.author as string)}`, title: `Deleted by ${mark.attrs.author ?? "unknown"}` }), 0];
  },
});

export interface TrackChangesOptions { enabled: boolean; author: string }
export interface TrackChangesStorage { enabled: boolean; author: string }

export const trackChangesKey = new PluginKey<{ enabled: boolean }>("trackChanges");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trackChanges: {
      setTrackChanges: (on: boolean) => ReturnType;
      acceptChange: (id: string) => ReturnType;
      rejectChange: (id: string) => ReturnType;
      acceptAllChanges: () => ReturnType;
      rejectAllChanges: () => ReturnType;
    };
  }
}

/** Attributes of an adjacent change mark by the same author, so continuous typing / backspacing stays one change. */
function adjacentChange(doc: PMNode, pos: number, type: "insertion" | "deletion", author: string): Record<string, unknown> | null {
  const check = (p: number, side: -1 | 1): Record<string, unknown> | null => {
    if (p < 0 || p > doc.content.size) return null;
    const $p = doc.resolve(p);
    const node = side < 0 ? $p.nodeBefore : $p.nodeAfter;
    if (!node?.isText) return null;
    const m = node.marks.find((x) => x.type.name === type && x.attrs.author === author);
    return m ? { ...m.attrs } : null;
  };
  return check(pos, -1) ?? check(pos, 1);
}

export const TrackChanges = Extension.create<TrackChangesOptions, TrackChangesStorage>({
  name: "trackChanges",
  addOptions: () => ({ enabled: false, author: "Jordan Whitfield" }),
  addStorage() { return { enabled: this.options.enabled, author: this.options.author }; },
  addExtensions: () => [Insertion, Deletion],
  addCommands() {
    return {
      setTrackChanges: (on) => ({ editor }) => { (editor.storage as unknown as { trackChanges: TrackChangesStorage }).trackChanges.enabled = on; editor.view.dispatch(editor.state.tr.setMeta("trackChangesToggle", on)); return true; },
      acceptChange: (id) => ({ state, tr, dispatch }) => resolveChange(state, tr, dispatch, (m) => m.attrs.id === id, "accept"),
      rejectChange: (id) => ({ state, tr, dispatch }) => resolveChange(state, tr, dispatch, (m) => m.attrs.id === id, "reject"),
      acceptAllChanges: () => ({ state, tr, dispatch }) => resolveChange(state, tr, dispatch, () => true, "accept"),
      rejectAllChanges: () => ({ state, tr, dispatch }) => resolveChange(state, tr, dispatch, () => true, "reject"),
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: trackChangesKey,
        appendTransaction: (trs, oldState, newState) => {
          if (!storage.enabled) return null;
          const author = storage.author;
          const schema = newState.schema;
          const insType = schema.marks.insertion;
          const delType = schema.marks.deletion;
          if (!insType || !delType) return null;
          const tr = newState.tr;
          let modified = false;
          const now = new Date().toISOString();
          let selectionTarget: number | null = null;

          for (const t of trs) {
            if (!t.docChanged) continue;
            if (t.getMeta("trackChanges") === "ignore" || t.getMeta("history$") || t.getMeta("addToHistory") === false || t.getMeta("blockId") || t.getMeta("preventUpdate")) continue;
            const wasBackspace = oldState.selection.empty && t.steps.length === 1;
            t.steps.forEach((step, i) => {
              if (!(step instanceof ReplaceStep)) return;
              const docBefore = t.docs[i];
              // Whole-document replacement (content load / restore) is never a tracked edit.
              if (step.from === 0 && step.to === docBefore.content.size) return;
              const mapAfter = t.mapping.slice(i + 1);
              const { from, to, slice } = step;
              const insertedSize = slice.size;
              // Position of the change start in the current (appended) doc.
              let insFrom = tr.mapping.map(mapAfter.map(from, -1));
              let insTo = tr.mapping.map(mapAfter.map(from + insertedSize, 1));
              if (insTo < insFrom) insTo = insFrom;

              // 1) Reinsert deleted inline text with deletion marks (same-textblock deletions only).
              let reinserted = 0;
              if (to > from) {
                const $f = docBefore.resolve(from), $t = docBefore.resolve(to);
                const sameBlock = $f.sameParent($t) && $f.parent.isTextblock;
                if (sameBlock) {
                  const deleted = docBefore.slice(from, to).content;
                  const nodes: PMNode[] = [];
                  let delAttrs: Record<string, unknown> | null = adjacentChange(tr.doc, insFrom, "deletion", author);
                  deleted.forEach((n) => {
                    if (!n.isText) { nodes.push(n); return; }
                    if (n.marks.some((m) => m.type === insType)) return; // deleting our own pending insertion: real delete
                    if (n.marks.some((m) => m.type === delType)) { nodes.push(n); return; } // already deleted
                    if (!delAttrs) delAttrs = { id: nanoid(8), author, date: now };
                    const mark = delType.create(delAttrs);
                    nodes.push(n.mark(mark.addToSet(n.marks)));
                  });
                  if (nodes.length) {
                    const frag = Fragment.from(nodes);
                    tr.insert(insFrom, frag);
                    reinserted = frag.size;
                    modified = true;
                  }
                }
              }
              // 2) Mark inserted text.
              if (insertedSize > 0 && slice.content.size > 0) {
                const a = insFrom + reinserted, b = insTo + reinserted;
                let hasText = false, needsMark = false;
                tr.doc.nodesBetween(a, b, (n) => { if (n.isText) { hasText = true; if (!n.marks.some((m) => m.type === insType && m.attrs.author === author)) needsMark = true; } });
                if (hasText && b > a && needsMark) {
                  const attrs = adjacentChange(tr.doc, a, "insertion", author) ?? { id: nanoid(8), author, date: now };
                  tr.removeMark(a, b, delType);
                  tr.addMark(a, b, insType.create(attrs));
                  modified = true;
                }
              }
              if (reinserted) {
                // Backspace: cursor stays before the struck text. Forward delete / replace: cursor after.
                const backspace = wasBackspace && oldState.selection.from === to && insertedSize === 0;
                selectionTarget = backspace ? insFrom : insFrom + reinserted + insertedSize;
              }
              insFrom = 0; insTo = 0;
            });
          }
          if (!modified) return null;
          if (selectionTarget != null) {
            const pos = Math.max(0, Math.min(selectionTarget, tr.doc.content.size));
            try { tr.setSelection(TextSelection.create(tr.doc, pos)); } catch { /* keep mapped selection */ }
          }
          tr.setMeta("trackChanges", "ignore");
          return tr;
        },
      }),
    ];
  },
});

function resolveChange(state: EditorState, tr: Transaction, dispatch: ((tr: Transaction) => void) | undefined, match: (m: PMMark) => boolean, mode: "accept" | "reject"): boolean {
  const insType = state.schema.marks.insertion;
  const delType = state.schema.marks.deletion;
  const ops: { from: number; to: number; op: "delete" | "unmark"; type: typeof insType }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if ((m.type !== insType && m.type !== delType) || !match(m)) continue;
      const isIns = m.type === insType;
      const remove = mode === "accept" ? !isIns : isIns;
      ops.push({ from: pos, to: pos + node.nodeSize, op: remove ? "delete" : "unmark", type: m.type });
    }
  });
  if (!ops.length) return false;
  if (dispatch) {
    // Apply from the end so positions stay valid.
    ops.sort((a, b) => b.from - a.from);
    for (const o of ops) {
      if (o.op === "delete") tr.delete(o.from, o.to);
      else tr.removeMark(o.from, o.to, o.type);
    }
    tr.setMeta("trackChanges", "ignore");
    dispatch(tr);
  }
  return true;
}

export interface EditorChange { id: string; kind: "insertion" | "deletion" | "replacement"; author: string; date: string; from: number; to: number; deletedText: string; insertedText: string; blockId: string }

/** Tracked changes with document positions (grouped by change id). */
export function collectEditorChanges(doc: PMNode): EditorChange[] {
  const byId = new Map<string, EditorChange>();
  const out: EditorChange[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== "insertion" && m.type.name !== "deletion") continue;
      const id = String(m.attrs.id ?? "");
      let c = byId.get(id);
      if (!c) { c = { id, kind: m.type.name as "insertion", author: String(m.attrs.author ?? "Unknown"), date: String(m.attrs.date ?? ""), from: pos, to: pos + node.nodeSize, deletedText: "", insertedText: "", blockId: String(parent?.attrs.id ?? "") }; byId.set(id, c); out.push(c); }
      c.to = Math.max(c.to, pos + node.nodeSize);
      c.from = Math.min(c.from, pos);
      if (m.type.name === "insertion") c.insertedText += node.text ?? ""; else c.deletedText += node.text ?? "";
      c.kind = c.insertedText && c.deletedText ? "replacement" : c.insertedText ? "insertion" : "deletion";
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Comment mark
// ---------------------------------------------------------------------------

export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({ id: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-id"), renderHTML: (a: Record<string, unknown>) => ({ "data-comment-id": a.id }) } }),
  parseHTML: () => [{ tag: "span[data-comment-id]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "comment-mark" }), 0],
});

// ---------------------------------------------------------------------------
// Footnote mark (footnote-lite): text stored on the mark, numbered by decoration
// ---------------------------------------------------------------------------

export const footnoteKey = new PluginKey<DecorationSet>("footnoteNumbers");

export const FootnoteMark = Mark.create({
  name: "footnote",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({
    id: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-footnote-id"), renderHTML: (a: Record<string, unknown>) => ({ "data-footnote-id": a.id }) },
    text: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-footnote-text"), renderHTML: (a: Record<string, unknown>) => ({ "data-footnote-text": a.text }) },
  }),
  parseHTML: () => [{ tag: "span[data-footnote-id]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "fn-anchor" }), 0],
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const decos: Decoration[] = [];
      const seen = new Map<string, number>();
      const lastPos = new Map<string, number>();
      doc.descendants((node, pos) => {
        if (!node.isText) return;
        const m = node.marks.find((x) => x.type.name === "footnote");
        if (!m) return;
        const id = String(m.attrs.id);
        if (!seen.has(id)) seen.set(id, seen.size + 1);
        lastPos.set(id, pos + node.nodeSize);
      });
      for (const [id, n] of seen) {
        const pos = lastPos.get(id)!;
        decos.push(Decoration.widget(pos, () => { const el = document.createElement("sup"); el.className = "fn-ref"; el.textContent = String(n); el.contentEditable = "false"; return el; }, { side: 1, key: `fn-${id}-${n}` }));
      }
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin({
      key: footnoteKey,
      state: { init: (_, state) => build(state.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});

// ---------------------------------------------------------------------------
// Page break node
// ---------------------------------------------------------------------------

declare module "@tiptap/core" {
  interface Commands<ReturnType> { pageBreak: { insertPageBreak: () => ReturnType } }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "page-break", contenteditable: "false" }), ["span", {}, "Page break"]],
  addCommands() {
    return { insertPageBreak: () => ({ chain }) => chain().insertContent({ type: this.name, attrs: { id: nanoid(8) } }).run() };
  },
  addKeyboardShortcuts() { return { "Mod-Enter": () => this.editor.commands.insertPageBreak() }; },
});

// ---------------------------------------------------------------------------
// Paragraph attributes: line height, spacing, indent, paragraph style, tocRef
// ---------------------------------------------------------------------------

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphAttrs: {
      setParagraphLineHeight: (lh: number | null) => ReturnType;
      setParagraphIndent: (delta: number) => ReturnType;
      setParagraphStyleAttr: (pStyle: string | null) => ReturnType;
      setParagraphSpacing: (before: number | null, after: number | null) => ReturnType;
    };
  }
}

export const ParagraphAttrs = Extension.create({
  name: "paragraphAttrs",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        lineHeight: { default: null, parseHTML: (el) => el.style.lineHeight ? parseFloat(el.style.lineHeight) : null, renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}) },
        spacingBefore: { default: null, parseHTML: (el) => el.getAttribute("data-sb") ? Number(el.getAttribute("data-sb")) : null, renderHTML: (a) => (a.spacingBefore != null ? { "data-sb": a.spacingBefore, style: `margin-top: ${a.spacingBefore}pt` } : {}) },
        spacingAfter: { default: null, parseHTML: (el) => el.getAttribute("data-sa") ? Number(el.getAttribute("data-sa")) : null, renderHTML: (a) => (a.spacingAfter != null ? { "data-sa": a.spacingAfter, style: `margin-bottom: ${a.spacingAfter}pt` } : {}) },
        indent: { default: null, parseHTML: (el) => el.getAttribute("data-indent") ? Number(el.getAttribute("data-indent")) : null, renderHTML: (a) => (a.indent ? { "data-indent": a.indent, style: `margin-left: ${Number(a.indent) * 0.5}in` } : {}) },
        pStyle: { default: null, parseHTML: (el) => el.getAttribute("data-pstyle"), renderHTML: (a) => (a.pStyle ? { "data-pstyle": a.pStyle } : {}) },
        tocRef: { default: null, parseHTML: (el) => el.getAttribute("data-toc-ref"), renderHTML: (a) => (a.tocRef ? { "data-toc-ref": a.tocRef } : {}) },
      },
    }];
  },
  addCommands() {
    const apply = (fn: (attrs: Record<string, unknown>) => Record<string, unknown>) => ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === "paragraph" || node.type.name === "heading") { tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...fn(node.attrs) }); changed = true; }
      });
      if (changed && dispatch) { tr.setMeta("trackChanges", "ignore"); dispatch(tr); }
      return changed;
    };
    return {
      setParagraphLineHeight: (lh) => apply(() => ({ lineHeight: lh })),
      setParagraphIndent: (delta) => apply((a) => ({ indent: Math.max(0, Math.min(8, Number(a.indent ?? 0) + delta)) || null })),
      setParagraphStyleAttr: (pStyle) => apply(() => ({ pStyle })),
      setParagraphSpacing: (before, after) => apply(() => ({ spacingBefore: before, spacingAfter: after })),
    };
  },
});

// ---------------------------------------------------------------------------
// Ordered list with numbering style (decimal | legal | outline | alpha | roman)
// ---------------------------------------------------------------------------

export const LegalOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      listStyle: { default: "decimal", parseHTML: (el: HTMLElement) => el.getAttribute("data-list-style") ?? "decimal", renderHTML: (a: Record<string, unknown>) => ({ "data-list-style": a.listStyle ?? "decimal" }) },
    };
  },
});

// ---------------------------------------------------------------------------
// Small caps mark
// ---------------------------------------------------------------------------

declare module "@tiptap/core" {
  interface Commands<ReturnType> { smallCaps: { toggleSmallCaps: () => ReturnType } }
}

export const SmallCaps = Mark.create({
  name: "smallCaps",
  parseHTML: () => [{ tag: "span.small-caps" }, { style: "font-variant", getAttrs: (v) => (String(v).includes("small-caps") ? {} : false) }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "small-caps" }), 0],
  addCommands() { return { toggleSmallCaps: () => ({ commands }) => commands.toggleMark(this.name) }; },
});

// ---------------------------------------------------------------------------
// Image with alignment + mermaid source + caption title
// ---------------------------------------------------------------------------

export const WordImage = Image.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      align: { default: "center", parseHTML: (el: HTMLElement) => el.getAttribute("data-align") ?? "center", renderHTML: (a: Record<string, unknown>) => ({ "data-align": a.align ?? "center" }) },
      mermaid: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-mermaid"), renderHTML: (a: Record<string, unknown>) => (a.mermaid ? { "data-mermaid": a.mermaid } : {}) },
    };
  },
}).configure({ inline: false, allowBase64: true, resize: { enabled: true, minWidth: 48, minHeight: 32, alwaysPreserveAspectRatio: true } });

// ---------------------------------------------------------------------------
// Paragraph gutter numbers (¶n) and current-paragraph highlight
// ---------------------------------------------------------------------------

export const gutterKey = new PluginKey<{ decos: DecorationSet; count: number }>("paragraphGutter");

export interface GutterOptions { onSelectBlock?: (editor: Editor, pos: number, node: PMNode) => void }

export const ParagraphGutter = Extension.create<GutterOptions>({
  name: "paragraphGutter",
  addOptions: () => ({}),
  addProseMirrorPlugins() {
    const opts = this.options;
    const editor = this.editor;
    const build = (doc: PMNode, selFrom: number): { decos: DecorationSet; count: number } => {
      const decos: Decoration[] = [];
      let n = 0;
      doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" || node.type.name === "heading" || node.type.name === "codeBlock" || node.type.name === "image" || node.type.name === "pageBreak" || node.type.name === "horizontalRule") {
          n++;
          if (node.isTextblock) {
            const index = n;
            const current = selFrom >= pos && selFrom <= pos + node.nodeSize;
            decos.push(Decoration.widget(pos + 1, () => {
              const el = document.createElement("span");
              el.className = "pn-gutter";
              el.textContent = `¶${index}`;
              el.contentEditable = "false";
              el.title = `Paragraph ${index} — click to select`;
              el.addEventListener("mousedown", (e) => {
                e.preventDefault();
                const { state, view } = editor;
                const at = view.posAtDOM(el, 0);
                const $p = state.doc.resolve(Math.max(0, at));
                const start = $p.start($p.depth), end = $p.end($p.depth);
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
                opts.onSelectBlock?.(editor, $p.before($p.depth), $p.parent);
                view.focus();
              });
              return el;
            }, { side: -1, key: `pn-${node.attrs.id ?? pos}-${index}`, ignoreSelection: true }));
            if (current) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "pn-current" }));
          }
          return false;
        }
        return true;
      });
      return { decos: DecorationSet.create(doc, decos), count: n };
    };
    return [new Plugin({
      key: gutterKey,
      state: {
        init: (_, state) => build(state.doc, state.selection.from),
        apply: (tr, old, oldState, newState) => {
          if (tr.docChanged) return build(newState.doc, newState.selection.from);
          if (tr.selectionSet) {
            // Only the "current" node decoration changes: cheap rebuild of that part.
            const oldPara = oldState.selection.$from.parent, newPara = newState.selection.$from.parent;
            if (oldPara !== newPara) return build(newState.doc, newState.selection.from);
          }
          return old;
        },
      },
      props: { decorations(state) { return this.getState(state)?.decos ?? null; } },
    })];
  },
});

// ---------------------------------------------------------------------------
// Find highlights (decorations driven from the Find & Replace panel)
// ---------------------------------------------------------------------------

export const findKey = new PluginKey<{ decos: DecorationSet; ranges: { from: number; to: number }[]; current: number }>("findHighlights");

export interface FindQuery { text: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; current?: number }

export function findRanges(doc: PMNode, q: FindQuery): { from: number; to: number }[] {
  if (!q.text) return [];
  let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (q.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  let re: RegExp;
  try { re = new RegExp(src, `gu${q.caseSensitive ? "" : "i"}`); } catch { return []; }
  const out: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // Concatenate text with positions (skip deleted text for matching accuracy but keep offsets).
    let text = "";
    const offsets: number[] = [];
    node.forEach((child, off) => {
      if (child.isText) { for (let i = 0; i < (child.text ?? "").length; i++) offsets.push(pos + 1 + off + i); text += child.text; }
      else { offsets.push(pos + 1 + off); text += "\n"; }
    });
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0] === "") { re.lastIndex++; continue; }
      out.push({ from: offsets[m.index], to: offsets[m.index + m[0].length - 1] + 1 });
      if (out.length > 5000) return false;
    }
    return false;
  });
  return out;
}

export const FindHighlights = Extension.create({
  name: "findHighlights",
  addProseMirrorPlugins() {
    const build = (doc: PMNode, ranges: { from: number; to: number }[], current: number) => DecorationSet.create(doc, ranges.map((r, i) => Decoration.inline(r.from, r.to, { class: i === current ? "find-hit find-current" : "find-hit" })));
    type FindState = { decos: DecorationSet; ranges: { from: number; to: number }[]; current: number };
    return [new Plugin<FindState>({
      key: findKey,
      state: {
        init: (): FindState => ({ decos: DecorationSet.empty, ranges: [], current: -1 }),
        apply: (tr, old, _o, newState) => {
          const q = tr.getMeta("find") as (FindQuery | null) | undefined;
          if (q !== undefined) {
            if (!q || !q.text) return { decos: DecorationSet.empty, ranges: [], current: -1 };
            const ranges = findRanges(newState.doc, q);
            const current = ranges.length ? Math.min(Math.max(0, q.current ?? 0), ranges.length - 1) : -1;
            return { decos: build(newState.doc, ranges, current), ranges, current };
          }
          if (tr.docChanged && old.ranges.length) {
            const ranges = old.ranges.map((r) => ({ from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) })).filter((r) => r.to > r.from);
            return { decos: build(newState.doc, ranges, old.current), ranges, current: old.current };
          }
          return old;
        },
      },
      props: { decorations(state) { return this.getState(state)?.decos ?? null; } },
    })];
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a block node by its id → { node, pos } (pos before the node). */
export function findBlockPos(doc: PMNode, id: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.id === id) { found = { node, pos }; return false; }
    return true;
  });
  return found;
}

/** Make an empty slice helper available for callers that need it. */
export const emptySlice = Slice.empty;
