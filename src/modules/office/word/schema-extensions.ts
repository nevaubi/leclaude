/**
 * The Word editor's schema-defining extensions (nodes, marks, attributes). The editor adds its UI-only
 * extensions (typography input rules, gutter, find highlights, placeholder, character count) on top; tests build
 * the same ProseMirror schema from this list to prove imported documents survive a load/save through the editor.
 */
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { BlockId, CapsMark, CommentMark, DocxAttrs, DocxInline, DocxRunMark, FootnoteMark, LegalOrderedList, PageBreak, ParagraphAttrs, SmallCaps, TrackChanges, WordImage } from "./extensions";

export function wordSchemaExtensions(opts: { trackChanges?: boolean; author?: string } = {}) {
  return [
    StarterKit.configure({ orderedList: false, heading: { levels: [1, 2, 3, 4, 5, 6] }, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } }, undoRedo: { newGroupDelay: 400 } }),
    LegalOrderedList,
    TextStyle, Color, FontFamily, FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Subscript, Superscript,
    TableKit.configure({ table: { resizable: true, lastColumnResizable: true } }),
    WordImage,
    TaskList, TaskItem.configure({ nested: true }),
    BlockId, ParagraphAttrs, PageBreak, FootnoteMark, CommentMark, SmallCaps,
    DocxAttrs, DocxRunMark, CapsMark, DocxInline,
    TrackChanges.configure({ enabled: opts.trackChanges ?? true, author: opts.author ?? "You" }),
  ];
}
