"use client";
/**
 * In-place text editing: a contentEditable that renders markdown-lite lines as
 * <div class="sl-line" data-kind data-indent> blocks with <b>/<i>/<u> runs and
 * serializes back to markdown-lite on every input.
 */
import * as React from "react";
import { parseMarkdownLite, serializeMarkdownLite, type DeckElement, type DeckTheme, type TextLine, type TextRun } from "./model";
import { textBoxStyle } from "./slide-view";

export interface TextEditorHandle {
  exec: (cmd: "bold" | "italic" | "underline") => void;
  setLineKind: (kind: TextLine["kind"] | "toggle-bullet" | "toggle-number") => void;
  indent: (delta: number) => void;
  focus: () => void;
  serialize: () => string;
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c); }

export function linesToHtml(lines: TextLine[]): string {
  return lines.map((l) => {
    const runs = l.runs.map((r) => { let t = escapeHtml(r.text); if (r.bold) t = `<b>${t}</b>`; if (r.italic) t = `<i>${t}</i>`; if (r.underline) t = `<u>${t}</u>`; return t; }).join("");
    return `<div class="sl-line" data-kind="${l.kind}" data-indent="${l.indent}">${runs || "<br>"}</div>`;
  }).join("");
}

function collectRuns(node: Node, state: { bold: boolean; italic: boolean; underline: boolean }, out: TextRun[]) {
  if (node.nodeType === Node.TEXT_NODE) { const text = node.textContent ?? ""; if (text) out.push({ text, bold: state.bold || undefined, italic: state.italic || undefined, underline: state.underline || undefined }); return; }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === "BR") return;
  const tag = node.tagName;
  const style = node.style;
  const next = { bold: state.bold || tag === "B" || tag === "STRONG" || /^(bold|[6-9]00)$/.test(style.fontWeight), italic: state.italic || tag === "I" || tag === "EM" || style.fontStyle === "italic", underline: state.underline || tag === "U" || /underline/.test(style.textDecoration) };
  node.childNodes.forEach((c) => collectRuns(c, next, out));
}

function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.underline === !!r.underline) last.text += r.text;
    else out.push({ ...r });
  }
  return out.length ? out : [{ text: "" }];
}

export function htmlToLines(root: HTMLElement): TextLine[] {
  const lines: TextLine[] = [];
  const blocks = Array.from(root.childNodes);
  if (!blocks.length) return [{ indent: 0, kind: "para", runs: [{ text: "" }] }];
  let loose: TextRun[] = [];
  const flushLoose = () => { if (loose.length) { lines.push({ indent: 0, kind: "para", runs: mergeRuns(loose) }); loose = []; } };
  for (const b of blocks) {
    if (b instanceof HTMLElement && (b.tagName === "DIV" || b.tagName === "P")) {
      flushLoose();
      const kind = (b.dataset.kind as TextLine["kind"]) ?? "para";
      const indent = Math.min(4, Math.max(0, Number(b.dataset.indent ?? 0) || 0));
      const runs: TextRun[] = [];
      b.childNodes.forEach((c) => collectRuns(c, { bold: false, italic: false, underline: false }, runs));
      lines.push({ indent, kind: ["para", "bullet", "number"].includes(kind) ? kind : "para", runs: mergeRuns(runs) });
    } else collectRuns(b, { bold: false, italic: false, underline: false }, loose);
  }
  flushLoose();
  return lines;
}

/** Ensure every root child is a .sl-line div (browsers insert bare text / <br> on edits). */
function normalize(root: HTMLElement) {
  const children = Array.from(root.childNodes);
  let prev: HTMLElement | null = null;
  for (const c of children) {
    if (c instanceof HTMLElement && (c.tagName === "DIV" || c.tagName === "P")) {
      if (!c.classList.contains("sl-line")) { c.classList.add("sl-line"); if (!c.dataset.kind) { c.dataset.kind = prev?.dataset.kind ?? "para"; c.dataset.indent = prev?.dataset.indent ?? "0"; } }
      // unwrap nested line divs created by some browsers
      c.querySelectorAll("div.sl-line").forEach((n) => { const span = document.createElement("span"); span.innerHTML = n.innerHTML; n.replaceWith(span); });
      prev = c;
    } else if (c.nodeType === Node.TEXT_NODE || (c instanceof HTMLElement && c.tagName !== "BR")) {
      const div = document.createElement("div");
      div.className = "sl-line"; div.dataset.kind = prev?.dataset.kind ?? "para"; div.dataset.indent = prev?.dataset.indent ?? "0";
      root.insertBefore(div, c); div.appendChild(c); prev = div;
    } else if (c instanceof HTMLElement && c.tagName === "BR" && c.parentNode === root) c.remove();
  }
  if (!root.childNodes.length) root.innerHTML = '<div class="sl-line" data-kind="para" data-indent="0"><br></div>';
}

function currentLines(root: HTMLElement): HTMLElement[] {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const lines = Array.from(root.querySelectorAll<HTMLElement>(":scope > .sl-line"));
  return lines.filter((l) => range.intersectsNode(l));
}

export interface TextEditorProps {
  element: DeckElement;
  theme: DeckTheme;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export const TextEditor = React.forwardRef<TextEditorHandle, TextEditorProps>(function TextEditor({ element, theme, onChange, onCommit, onCancel }, ref) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const initial = React.useRef(element.text ?? "");

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = linesToHtml(parseMarkdownLite(initial.current));
    root.focus();
    // place caret at the end
    const sel = window.getSelection();
    if (sel) { const range = document.createRange(); range.selectNodeContents(root); range.collapse(false); sel.removeAllRanges(); sel.addRange(range); }
  }, []);

  const emit = React.useCallback(() => { const root = rootRef.current; if (!root) return; normalize(root); onChange(serializeMarkdownLite(htmlToLines(root))); }, [onChange]);

  React.useImperativeHandle(ref, () => ({
    exec: (cmd) => { rootRef.current?.focus(); document.execCommand(cmd); emit(); },
    setLineKind: (kind) => {
      const root = rootRef.current; if (!root) return;
      for (const line of currentLines(root)) {
        const cur = line.dataset.kind ?? "para";
        line.dataset.kind = kind === "toggle-bullet" ? (cur === "bullet" ? "para" : "bullet") : kind === "toggle-number" ? (cur === "number" ? "para" : "number") : kind;
      }
      emit();
    },
    indent: (delta) => {
      const root = rootRef.current; if (!root) return;
      for (const line of currentLines(root)) { const cur = Number(line.dataset.indent ?? 0) || 0; line.dataset.indent = String(Math.min(4, Math.max(0, cur + delta))); if (delta > 0 && line.dataset.kind === "para") line.dataset.kind = "bullet"; }
      emit();
    },
    focus: () => rootRef.current?.focus(),
    serialize: () => { const root = rootRef.current; if (!root) return initial.current; normalize(root); return serializeMarkdownLite(htmlToLines(root)); },
  }), [emit]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCommit(); return; }
    if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); for (const line of currentLines(root)) { const cur = Number(line.dataset.indent ?? 0) || 0; line.dataset.indent = String(Math.min(4, Math.max(0, cur + (e.shiftKey ? -1 : 1)))); if (!e.shiftKey && line.dataset.kind === "para") line.dataset.kind = "bullet"; } emit(); return; }
    if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); document.execCommand(e.key.toLowerCase() === "b" ? "bold" : e.key.toLowerCase() === "i" ? "italic" : "underline"); emit(); return; }
    if (mod && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onCommit(); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      const lines = currentLines(root);
      const line = lines[lines.length - 1];
      const sel = window.getSelection();
      if (!line || !sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      // Empty bullet + Enter → convert to paragraph (like Keynote/PowerPoint)
      if (!line.textContent?.trim() && line.dataset.kind !== "para") { line.dataset.kind = "para"; line.dataset.indent = "0"; emit(); return; }
      const after = range.cloneRange();
      after.setEndAfter(line.lastChild ?? line);
      const tail = after.extractContents();
      const next = document.createElement("div");
      next.className = "sl-line"; next.dataset.kind = line.dataset.kind ?? "para"; next.dataset.indent = line.dataset.indent ?? "0";
      next.appendChild(tail);
      if (!next.textContent && !next.querySelector("br")) next.appendChild(document.createElement("br"));
      if (!line.textContent && !line.querySelector("br")) line.appendChild(document.createElement("br"));
      line.after(next);
      const r = document.createRange(); r.setStart(next, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
      emit();
      return;
    }
    // Stop editor-level shortcuts (delete, arrows, copy) from reaching the canvas.
    e.stopPropagation();
  };

  return (
    <div
      ref={rootRef}
      className="sl-text-editor"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-overlay="text-editor"
      style={{ ...textBoxStyle(element, theme), position: "absolute", left: element.x, top: element.y, width: element.w, height: element.h, transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined, outline: "2px solid var(--primary)", outlineOffset: 0, overflow: "visible", cursor: "text", display: "block" }}
      onInput={emit}
      onKeyDown={onKeyDown}
      onBlur={onCommit}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData("text/plain"); document.execCommand("insertText", false, text); emit(); }}
      onKeyUp={(e) => { if (e.key === "Backspace" || e.key === "Delete") emit(); }}
    />
  );
});

/** Hidden helper for tests / debugging: serialize current DOM state. */
export function cancelGuard(fn: () => void) { return fn; }
