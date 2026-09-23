"use client";
import * as React from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, ChevronDown, ChevronLeft, ChevronRight, Eraser, FileText, Highlighter, Image as ImageIcon, Indent, Italic, Link2, List, ListOrdered, ListTodo, Outdent, PaintBucket, Plus, Redo2, Scissors, Sigma, Strikethrough, Subscript, Superscript, Table as TableIcon, Type, Underline, Undo2, Workflow, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, LINE_SPACINGS, MARGIN_PRESETS, PAGE_SIZES, TEXT_COLORS, type DocSettings } from "./constants";
import { PARAGRAPH_STYLES, type ParagraphStyle } from "./doc-model";
import type { EditorChange } from "./extensions";

export type InsertAction = "table" | "image" | "diagram" | "link" | "footnote" | "pageBreak" | "toc" | "signature" | "caption" | "certificate" | "captionBlock" | "toa" | "verification" | "proposedOrder";

export interface ToolbarProps {
  editor: Editor;
  settings: DocSettings;
  onSettings: (patch: Partial<DocSettings>) => void;
  onInsert: (action: InsertAction) => void;
  changes: EditorChange[];
  changeIndex: number;
  onChangeNav: (dir: -1 | 1) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptCurrent: () => void;
  onRejectCurrent: () => void;
  trackChanges: boolean;
  disabled?: boolean;
}

function TBtn({ icon: Icon, label, shortcut, active, onClick, disabled }: { icon: LucideIcon; label: string; shortcut?: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} data-state={active ? "on" : "off"} className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none cursor-pointer", active && "bg-accent text-accent-foreground")}>
        <Icon className="size-4" />
      </button>
    </Tip>
  );
}

const Sep = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />;

export function currentParagraphStyle(editor: Editor): ParagraphStyle {
  if (editor.isActive("heading", { pStyle: "title" })) return "title";
  if (editor.isActive("heading", { level: 1 })) return "heading1";
  if (editor.isActive("heading", { level: 2 })) return "heading2";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  if (editor.isActive("orderedList", { listStyle: "legal" }) || editor.isActive("orderedList", { listStyle: "outline" })) return "legal_numbered";
  if (editor.isActive("orderedList")) return "numbered_list";
  if (editor.isActive("bulletList")) return "bullet_list";
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("paragraph", { pStyle: "caption" })) return "caption";
  return "body";
}

export function applyParagraphStyle(editor: Editor, style: ParagraphStyle) {
  const c = editor.chain().focus();
  const inList = editor.isActive("listItem");
  const inQuote = editor.isActive("blockquote");
  switch (style) {
    case "body": c.setParagraph().updateAttributes("paragraph", { pStyle: null }); if (inList) c.liftListItem("listItem"); if (inQuote) c.lift("blockquote"); break;
    case "title": if (inList) c.liftListItem("listItem"); c.setHeading({ level: 1 }).updateAttributes("heading", { pStyle: "title", textAlign: "center" }); break;
    case "heading1": case "heading2": case "heading3": if (inList) c.liftListItem("listItem"); c.setHeading({ level: Number(style.slice(-1)) as 1 | 2 | 3 }).updateAttributes("heading", { pStyle: null }); break;
    case "blockquote": c.setParagraph(); if (inList) c.liftListItem("listItem"); if (!inQuote) c.wrapIn("blockquote"); break;
    case "caption": c.setParagraph().updateAttributes("paragraph", { pStyle: "caption", textAlign: "center" }); break;
    case "legal_numbered": c.setParagraph().updateAttributes("paragraph", { pStyle: null }); if (!editor.isActive("orderedList")) c.toggleOrderedList(); c.updateAttributes("orderedList", { listStyle: "legal" }); break;
    case "numbered_list": c.setParagraph().updateAttributes("paragraph", { pStyle: null }); if (!editor.isActive("orderedList")) c.toggleOrderedList(); c.updateAttributes("orderedList", { listStyle: "decimal" }); break;
    case "bullet_list": c.setParagraph().updateAttributes("paragraph", { pStyle: null }); if (!editor.isActive("bulletList")) c.toggleBulletList(); break;
  }
  c.setMeta("trackChanges", "ignore").run();
}

export function WordToolbar(props: ToolbarProps) {
  const { editor, settings, onSettings, onInsert, changes, changeIndex, onChangeNav, onAcceptAll, onRejectAll, onAcceptCurrent, onRejectCurrent, trackChanges, disabled } = props;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: currentParagraphStyle(e),
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      sup: e.isActive("superscript"), sub: e.isActive("subscript"),
      left: e.isActive({ textAlign: "left" }) || (!e.isActive({ textAlign: "center" }) && !e.isActive({ textAlign: "right" }) && !e.isActive({ textAlign: "justify" })),
      center: e.isActive({ textAlign: "center" }), right: e.isActive({ textAlign: "right" }), justify: e.isActive({ textAlign: "justify" }),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), task: e.isActive("taskList"),
      fontFamily: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      fontSize: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
      highlight: e.isActive("highlight"),
      lineHeight: (e.getAttributes("paragraph").lineHeight as number | null) ?? (e.getAttributes("heading").lineHeight as number | null) ?? null,
      canUndo: e.can().undo(), canRedo: e.can().redo(),
      inTable: e.isActive("table"),
    }),
  });
  const fontId = FONT_FAMILIES.find((f) => f.css === state.fontFamily)?.id ?? settings.font;
  const sizePt = state.fontSize ? parseFloat(state.fontSize) : settings.fontSize;

  return (
    <div className={cn("word-toolbar flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2", disabled && "pointer-events-none opacity-60")}>
      <TBtn icon={Undo2} label="Undo" shortcut="⌘Z" onClick={() => editor.chain().focus().undo().run()} disabled={!state.canUndo} />
      <TBtn icon={Redo2} label="Redo" shortcut="⌘⇧Z" onClick={() => editor.chain().focus().redo().run()} disabled={!state.canRedo} />
      <Sep />
      <Select value={state.style} onValueChange={(v) => applyParagraphStyle(editor, v as ParagraphStyle)}>
        <SelectTrigger size="sm" className="h-7 w-[118px] shrink-0 text-xs" aria-label="Paragraph style"><SelectValue /></SelectTrigger>
        <SelectContent>{PARAGRAPH_STYLES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={fontId} onValueChange={(v) => { const f = FONT_FAMILIES.find((x) => x.id === v)!; if (v === settings.font) editor.chain().focus().unsetFontFamily().run(); else editor.chain().focus().setFontFamily(f.css).run(); }}>
        <SelectTrigger size="sm" className="h-7 w-[112px] shrink-0 text-xs" aria-label="Font family"><SelectValue /></SelectTrigger>
        <SelectContent>{FONT_FAMILIES.map((f) => <SelectItem key={f.id} value={f.id}><span style={{ fontFamily: f.css }}>{f.label}</span></SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(sizePt)} onValueChange={(v) => { if (Number(v) === settings.fontSize) editor.chain().focus().unsetFontSize().run(); else editor.chain().focus().setFontSize(`${v}pt`).run(); }}>
        <SelectTrigger size="sm" className="h-7 w-[58px] shrink-0 px-1.5 text-xs tabular" aria-label="Font size (⌘⇧, / ⌘⇧.)"><SelectValue /></SelectTrigger>
        <SelectContent>{Array.from(new Set([...FONT_SIZES, sizePt])).sort((a, b) => a - b).map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}</SelectContent>
      </Select>
      <Sep />
      <TBtn icon={Bold} label="Bold" shortcut="⌘B" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <TBtn icon={Italic} label="Italic" shortcut="⌘I" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <TBtn icon={Underline} label="Underline" shortcut="⌘U" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <TBtn icon={Strikethrough} label="Strikethrough" shortcut="⌘⇧S" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <Popover>
        <Tip label="Text color"><PopoverTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Text color" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent cursor-pointer"><Baseline className="size-4" style={state.color ? { color: state.color } : undefined} /></button></PopoverTrigger></Tip>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-5 gap-1">
            {TEXT_COLORS.map((c) => <button key={c.id} type="button" title={c.label} aria-label={c.label} onClick={() => (c.css ? editor.chain().focus().setColor(c.css).run() : editor.chain().focus().unsetColor().run())} className={cn("size-6 rounded-md border cursor-pointer", !c.css && "bg-[linear-gradient(135deg,transparent_45%,var(--destructive)_45%,var(--destructive)_55%,transparent_55%)]")} style={c.css ? { background: c.css } : undefined} />)}
          </div>
          <input type="color" aria-label="Custom color" className="mt-2 h-7 w-full cursor-pointer rounded border bg-background" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
        </PopoverContent>
      </Popover>
      <Popover>
        <Tip label="Highlight"><PopoverTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Highlight" data-state={state.highlight ? "on" : "off"} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent cursor-pointer"><Highlighter className="size-4" /></button></PopoverTrigger></Tip>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-6 gap-1">
            {HIGHLIGHT_COLORS.map((c) => <button key={c.id} type="button" title={c.label} aria-label={c.label} onClick={() => editor.chain().focus().setHighlight({ color: c.css }).run()} className="size-6 rounded-md border cursor-pointer" style={{ background: c.css }} />)}
          </div>
          <Button variant="ghost" size="xs" className="mt-2 w-full" onClick={() => editor.chain().focus().unsetHighlight().run()}>Remove highlight</Button>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <Tip label="More formatting"><DropdownMenuTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="More formatting" data-state={state.sup || state.sub ? "on" : "off"} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent cursor-pointer"><Type className="size-4" /></button></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem checked={state.sup} onCheckedChange={() => editor.chain().focus().toggleSuperscript().run()}><Superscript /> Superscript <span className="ml-auto text-[10px] text-muted-foreground">⌘.</span></DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={state.sub} onCheckedChange={() => editor.chain().focus().toggleSubscript().run()}><Subscript /> Subscript <span className="ml-auto text-[10px] text-muted-foreground">⌘,</span></DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={editor.isActive("smallCaps")} onCheckedChange={() => editor.chain().focus().toggleSmallCaps().run()}>Small caps</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={editor.isActive("code")} onCheckedChange={() => editor.chain().focus().toggleCode().run()}>Monospace</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser /> Clear formatting <span className="ml-auto text-[10px] text-muted-foreground">⌘\</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sep />
      <TBtn icon={AlignLeft} label="Align left" shortcut="⌘⇧L" active={state.left} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
      <TBtn icon={AlignCenter} label="Center" shortcut="⌘⇧E" active={state.center} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
      <TBtn icon={AlignRight} label="Align right" shortcut="⌘⇧R" active={state.right} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
      <TBtn icon={AlignJustify} label="Justify" shortcut="⌘⇧J" active={state.justify} onClick={() => editor.chain().focus().setTextAlign("justify").run()} />
      <Sep />
      <TBtn icon={List} label="Bullet list" shortcut="⌘⇧8" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <DropdownMenu>
        <Tip label="Numbered list"><DropdownMenuTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Numbered list" data-state={state.ordered ? "on" : "off"} className="inline-flex h-7 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 hover:bg-accent cursor-pointer"><ListOrdered className="size-4" /><ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Numbering style</DropdownMenuLabel>
          {[["decimal", "1. 2. 3."], ["legal", "1.  1.1  1.1.1 (legal)"], ["outline", "1.  (a)  (i) (outline)"], ["alpha", "(a) (b) (c)"], ["roman", "I. II. III."]].map(([id, label]) => (
            <DropdownMenuItem key={id} onClick={() => { const c = editor.chain().focus(); if (!editor.isActive("orderedList")) c.toggleOrderedList(); c.updateAttributes("orderedList", { listStyle: id }).run(); }}>{label}</DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>{state.ordered ? "Remove numbering" : "Numbered list"}</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked={state.task} onCheckedChange={() => editor.chain().focus().toggleTaskList().run()}><ListTodo /> Checklist <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧9</span></DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TBtn icon={Outdent} label="Decrease indent" shortcut="⇧Tab" onClick={() => { if (editor.isActive("listItem")) editor.chain().focus().liftListItem("listItem").run(); else editor.chain().focus().setParagraphIndent(-1).run(); }} />
      <TBtn icon={Indent} label="Increase indent" shortcut="Tab" onClick={() => { if (editor.isActive("listItem")) editor.chain().focus().sinkListItem("listItem").run(); else editor.chain().focus().setParagraphIndent(1).run(); }} />
      <DropdownMenu>
        <Tip label="Line spacing"><DropdownMenuTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Line spacing" className="inline-flex h-7 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 text-xs tabular hover:bg-accent cursor-pointer"><Sigma className="size-4" />{state.lineHeight ?? settings.lineSpacing}</button></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Paragraph spacing</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(state.lineHeight ?? "")} onValueChange={(v) => editor.chain().focus().setParagraphLineHeight(v ? Number(v) : null).run()}>
            <DropdownMenuRadioItem value="">Document default ({settings.lineSpacing})</DropdownMenuRadioItem>
            {LINE_SPACINGS.map((l) => <DropdownMenuRadioItem key={l.id} value={String(l.id)}>{l.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Document default</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(settings.lineSpacing)} onValueChange={(v) => onSettings({ lineSpacing: Number(v) })}>
            {LINE_SPACINGS.map((l) => <DropdownMenuRadioItem key={l.id} value={String(l.id)}>{l.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => editor.chain().focus().setParagraphSpacing(0, 0).run()}>Remove space before/after</DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().setParagraphSpacing(12, 12).run()}>Add 12pt before/after</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sep />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" className="h-7 shrink-0 gap-1 px-1.5 font-normal" onMouseDown={(e) => e.preventDefault()} aria-label="Insert"><Plus className="size-4" /><span className="hidden min-[1700px]:inline">Insert</span><ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem onClick={() => onInsert("table")}><TableIcon /> Table</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("image")}><ImageIcon /> Image…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("diagram")}><Workflow /> Diagram (Mermaid)…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("link")}><Link2 /> Link <span className="ml-auto text-[10px] text-muted-foreground">⌘K</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("footnote")}><Superscript /> Footnote…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("pageBreak")}><Scissors /> Page break <span className="ml-auto text-[10px] text-muted-foreground">⌘↵</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("caption")}><FileText /> Caption paragraph</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Legal blocks</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onInsert("toc")}>Table of contents</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("captionBlock")}>Court caption block</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("signature")}>Signature block</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("certificate")}>Certificate of service</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("toa")}>Table of authorities (placeholder)</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("verification")}>Verification (§ 1746)</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("proposedOrder")}>Proposed order</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {state.inTable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" className="h-7 shrink-0 gap-1 px-1.5 font-normal" onMouseDown={(e) => e.preventDefault()} aria-label="Table"><TableIcon className="size-4" /><span className="hidden min-[1700px]:inline">Table</span><ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowBefore().run()}>Insert row above</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>Insert row below</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnBefore().run()}>Insert column left</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>Insert column right</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Toggle header row</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().mergeCells().run()}>Merge cells</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().splitCell().run()}>Split cell</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" className="h-7 shrink-0 gap-1 px-1.5 font-normal" onMouseDown={(e) => e.preventDefault()} aria-label="Page setup"><PaintBucket className="size-4" /><span className="hidden min-[1700px]:inline">Page</span><ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Size · {PAGE_SIZES[settings.pageSize].label.split(" ")[0]}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuRadioGroup value={settings.pageSize} onValueChange={(v) => onSettings({ pageSize: v as DocSettings["pageSize"] })}>{Object.entries(PAGE_SIZES).map(([id, p]) => <DropdownMenuRadioItem key={id} value={id}>{p.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Margins · {MARGIN_PRESETS[settings.margins].label.split(" ")[0]}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuRadioGroup value={settings.margins} onValueChange={(v) => onSettings({ margins: v as DocSettings["margins"] })}>{Object.entries(MARGIN_PRESETS).map(([id, p]) => <DropdownMenuRadioItem key={id} value={id}>{p.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Orientation · {settings.orientation}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuRadioGroup value={settings.orientation} onValueChange={(v) => onSettings({ orientation: v as DocSettings["orientation"] })}><DropdownMenuRadioItem value="portrait">Portrait</DropdownMenuRadioItem><DropdownMenuRadioItem value="landscape">Landscape</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Body font · {settings.font === "serif" ? "Serif" : "Sans"}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuRadioGroup value={settings.font} onValueChange={(v) => onSettings({ font: v as DocSettings["font"] })}><DropdownMenuRadioItem value="serif">Serif (legal filings)</DropdownMenuRadioItem><DropdownMenuRadioItem value="sans">Sans (memos)</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Base size · {settings.fontSize}pt</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuRadioGroup value={String(settings.fontSize)} onValueChange={(v) => onSettings({ fontSize: Number(v) })}>{[10, 11, 12, 13, 14].map((s) => <DropdownMenuRadioItem key={s} value={String(s)}>{s} pt</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem checked={settings.pageNumbers} onCheckedChange={(v) => onSettings({ pageNumbers: Boolean(v) })}>Page numbers on export</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onInsert("pageBreak")}><Scissors /> Insert page break</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {trackChanges || changes.length > 0 ? (
        <>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs">
            <span className="tabular text-muted-foreground whitespace-nowrap">{changes.length} tracked change{changes.length === 1 ? "" : "s"}</span>
            <button type="button" aria-label="Previous change" disabled={!changes.length} onClick={() => onChangeNav(-1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-40 cursor-pointer"><ChevronLeft className="size-3.5" /></button>
            <span className="tabular text-[11px] text-muted-foreground">{changes.length ? `${changeIndex + 1}/${changes.length}` : "–"}</span>
            <button type="button" aria-label="Next change" disabled={!changes.length} onClick={() => onChangeNav(1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-40 cursor-pointer"><ChevronRight className="size-3.5" /></button>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <Tip label="Accept current change"><button type="button" disabled={!changes.length} onClick={onAcceptCurrent} className="rounded px-1 text-success hover:bg-success/10 disabled:opacity-40 cursor-pointer">✓</button></Tip>
            <Tip label="Reject current change"><button type="button" disabled={!changes.length} onClick={onRejectCurrent} className="rounded px-1 text-destructive hover:bg-destructive/10 disabled:opacity-40 cursor-pointer">✕</button></Tip>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <button type="button" disabled={!changes.length} onClick={onAcceptAll} className="whitespace-nowrap rounded px-1 py-0.5 font-medium hover:bg-accent disabled:opacity-40 cursor-pointer">Accept all</button>
            <button type="button" disabled={!changes.length} onClick={onRejectAll} className="whitespace-nowrap rounded px-1 py-0.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 cursor-pointer">Reject all</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
