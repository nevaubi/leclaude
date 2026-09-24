"use client";
import * as React from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalSpaceAround, Baseline, Bold, Eraser, Eye, FileText, Highlighter, Image as ImageIcon, Indent, Italic, Link2, List, ListOrdered, ListTodo, Outdent, PenLine, Plus, Redo2, Scissors, Strikethrough, Subscript, Superscript, Table as TableIcon, Type, Underline, Undo2, Workflow, MoreHorizontal, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OfficeToolbar, ToolButton, ToolMenuTrigger, ToolSep, TOOL_BTN, TOOL_BTN_ACTIVE } from "@/modules/office/shared/office-chrome";
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, LINE_SPACINGS, MARGIN_PRESETS, PAGE_SIZES, TEXT_COLORS, type DocSettings } from "./constants";
import { PARAGRAPH_STYLES, type ParagraphStyle } from "./doc-model";

export type InsertAction = "table" | "image" | "diagram" | "link" | "footnote" | "pageBreak" | "toc" | "signature" | "caption" | "certificate" | "captionBlock" | "toa" | "verification" | "proposedOrder";

export interface ToolbarProps {
  editor: Editor;
  settings: DocSettings;
  onSettings: (patch: Partial<DocSettings>) => void;
  onInsert: (action: InsertAction) => void;
  trackChanges: boolean;
  onTrackChanges: (on: boolean) => void;
  view: "edit" | "preview";
  onView: (v: "edit" | "preview") => void;
  disabled?: boolean;
}

const STYLE_SHORTCUT: Partial<Record<ParagraphStyle, string>> = { body: "⌘⌥0", heading1: "⌘⌥1", heading2: "⌘⌥2", heading3: "⌘⌥3" };

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

/**
 * Word toolbar, decluttered into grouped menus: Style · Font · Size · B I U · more ·
 * alignment · lists · Page · Insert, with Track changes and Preview on the right.
 * The tracked-changes strip lives below the toolbar (only when there are changes).
 */
export function WordToolbar(props: ToolbarProps) {
  const { editor, settings, onSettings, onInsert, trackChanges, onTrackChanges, view, onView, disabled } = props;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: currentParagraphStyle(e),
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      sup: e.isActive("superscript"), sub: e.isActive("subscript"), smallCaps: e.isActive("smallCaps"), code: e.isActive("code"),
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
  const font = FONT_FAMILIES.find((f) => f.id === fontId) ?? FONT_FAMILIES[0];
  const sizePt = state.fontSize ? parseFloat(state.fontSize) : settings.fontSize;
  const styleLabel = PARAGRAPH_STYLES.find((s) => s.id === state.style)?.label ?? "Body";
  const moreActive = state.strike || state.sup || state.sub || state.smallCaps || state.code;
  const readOnly = view === "preview";

  return (
    <OfficeToolbar
      disabled={disabled}
      right={
        <>
          <ToolButton icon={PenLine} label={trackChanges ? "Track changes on — click to turn off" : "Track changes off — click to turn on"} shortcut="⌘⇧E" active={trackChanges} onClick={() => onTrackChanges(!trackChanges)} keepFocus={false} className={cn("px-2", trackChanges && "text-primary")}>
            <span className="hidden text-[12.5px] xl:inline">Track changes</span>
          </ToolButton>
          <ToolButton icon={Eye} label={readOnly ? "Back to editing" : "Preview with changes accepted"} active={readOnly} onClick={() => onView(readOnly ? "edit" : "preview")} keepFocus={false} />
        </>
      }
    >
      <div className={cn("contents", readOnly && "pointer-events-none opacity-50")}>
        <ToolButton icon={Undo2} label="Undo" shortcut="⌘Z" onClick={() => editor.chain().focus().undo().run()} disabled={!state.canUndo} />
        <ToolButton icon={Redo2} label="Redo" shortcut="⌘⇧Z" onClick={() => editor.chain().focus().redo().run()} disabled={!state.canRedo} />
        <ToolSep />

        {/* Style */}
        <DropdownMenu>
          <Tip label="Paragraph style"><DropdownMenuTrigger asChild><ToolMenuTrigger label={styleLabel} width={118} aria-label="Paragraph style" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Style</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={state.style} onValueChange={(v) => applyParagraphStyle(editor, v as ParagraphStyle)}>
              {PARAGRAPH_STYLES.map((s) => <DropdownMenuRadioItem key={s.id} value={s.id}><span className={cn(s.id.startsWith("heading") && "font-semibold", s.id === "title" && "font-semibold uppercase tracking-wide", s.id === "caption" && "italic text-muted-foreground")}>{s.label}</span>{STYLE_SHORTCUT[s.id] && <kbd className="ml-auto">{STYLE_SHORTCUT[s.id]}</kbd>}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Font */}
        <DropdownMenu>
          <Tip label="Font"><DropdownMenuTrigger asChild><ToolMenuTrigger label={<span style={{ fontFamily: font.css }}>{font.label}</span>} width={126} aria-label="Font family" hideLabelBelow="lg" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>Font</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={fontId} onValueChange={(v) => { const f = FONT_FAMILIES.find((x) => x.id === v)!; if (v === settings.font) editor.chain().focus().unsetFontFamily().run(); else editor.chain().focus().setFontFamily(f.css).run(); }}>
              {FONT_FAMILIES.map((f) => <DropdownMenuRadioItem key={f.id} value={f.id}><span style={{ fontFamily: f.css }}>{f.label}</span>{f.id === settings.font && <span className="ml-auto text-[10.5px] text-muted-foreground">document</span>}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Document default</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={settings.font} onValueChange={(v) => onSettings({ font: v as DocSettings["font"] })}>
              <DropdownMenuRadioItem value="serif">Serif (filings)</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="sans">Sans (memos)</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Size */}
        <DropdownMenu>
          <Tip label="Font size" shortcut="⌘⇧, / ⌘⇧."><DropdownMenuTrigger asChild><ToolMenuTrigger label={<span className="tabular">{sizePt}</span>} width={56} aria-label="Font size" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-40 max-h-80">
            <DropdownMenuRadioGroup value={String(sizePt)} onValueChange={(v) => { if (Number(v) === settings.fontSize) editor.chain().focus().unsetFontSize().run(); else editor.chain().focus().setFontSize(`${v}pt`).run(); }}>
              {Array.from(new Set([...FONT_SIZES, sizePt])).sort((a, b) => a - b).map((s) => <DropdownMenuRadioItem key={s} value={String(s)} className="tabular">{s} pt{s === settings.fontSize && <span className="ml-auto text-[10.5px] text-muted-foreground">document</span>}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolSep />

        {/* Inline formatting */}
        <ToolButton icon={Bold} label="Bold" shortcut="⌘B" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton icon={Italic} label="Italic" shortcut="⌘I" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton icon={Underline} label="Underline" shortcut="⌘U" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Popover>
          <Tip label="Text color"><PopoverTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Text color" className={cn(TOOL_BTN, "relative")}><Baseline className="size-4" /><span className="absolute bottom-1 left-1.5 right-1.5 h-[3px] rounded-sm" style={{ background: state.color || "currentColor" }} /></button></PopoverTrigger></Tip>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Text color</div>
            <div className="grid grid-cols-5 gap-1">
              {TEXT_COLORS.map((c) => <button key={c.id} type="button" title={c.label} aria-label={c.label} onClick={() => (c.css ? editor.chain().focus().setColor(c.css).run() : editor.chain().focus().unsetColor().run())} className={cn("size-6 rounded-md border cursor-pointer transition-transform hover:scale-110", !c.css && "bg-[linear-gradient(135deg,transparent_45%,var(--destructive)_45%,var(--destructive)_55%,transparent_55%)]")} style={c.css ? { background: c.css } : undefined} />)}
            </div>
            <input type="color" aria-label="Custom color" className="mt-2 h-7 w-full cursor-pointer rounded border bg-background" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
          </PopoverContent>
        </Popover>
        <Popover>
          <Tip label="Highlight"><PopoverTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Highlight" data-state={state.highlight ? "on" : "off"} className={cn(TOOL_BTN, state.highlight && TOOL_BTN_ACTIVE)}><Highlighter className="size-4" /></button></PopoverTrigger></Tip>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Highlight</div>
            <div className="grid grid-cols-6 gap-1">
              {HIGHLIGHT_COLORS.map((c) => <button key={c.id} type="button" title={c.label} aria-label={c.label} onClick={() => editor.chain().focus().setHighlight({ color: c.css }).run()} className="size-6 rounded-md border cursor-pointer transition-transform hover:scale-110" style={{ background: c.css }} />)}
            </div>
            <button type="button" onClick={() => editor.chain().focus().unsetHighlight().run()} className="mt-2 w-full rounded-md border px-2 py-1 text-[11.5px] hover:bg-accent cursor-pointer">Remove highlight</button>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <Tip label="More formatting"><DropdownMenuTrigger asChild><button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="More formatting" data-state={moreActive ? "on" : "off"} className={cn(TOOL_BTN, moreActive && TOOL_BTN_ACTIVE)}><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuCheckboxItem checked={state.strike} onCheckedChange={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /> Strikethrough <kbd className="ml-auto">⌘⇧S</kbd></DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={state.sup} onCheckedChange={() => editor.chain().focus().toggleSuperscript().run()}><Superscript /> Superscript <kbd className="ml-auto">⌘.</kbd></DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={state.sub} onCheckedChange={() => editor.chain().focus().toggleSubscript().run()}><Subscript /> Subscript <kbd className="ml-auto">⌘,</kbd></DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={state.smallCaps} onCheckedChange={() => editor.chain().focus().toggleSmallCaps().run()}><Type /> Small caps</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={state.code} onCheckedChange={() => editor.chain().focus().toggleCode().run()}>Monospace</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser /> Clear formatting <kbd className="ml-auto">⌘\</kbd></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolSep />

        {/* Alignment */}
        <ToolButton icon={AlignLeft} label="Align left" shortcut="⌘⇧L" active={state.left} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
        <ToolButton icon={AlignCenter} label="Center" shortcut="⌘⇧E" active={state.center} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
        <ToolButton icon={AlignRight} label="Align right" shortcut="⌘⇧R" active={state.right} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
        <ToolButton icon={AlignJustify} label="Justify" shortcut="⌘⇧J" active={state.justify} onClick={() => editor.chain().focus().setTextAlign("justify").run()} />
        <ToolSep />

        {/* Lists and spacing */}
        <ToolButton icon={List} label="Bullet list" shortcut="⌘⇧8" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <DropdownMenu>
          <Tip label="Numbered list"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={ListOrdered} label="" active={state.ordered} aria-label="Numbered list" className="px-1" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Numbering</DropdownMenuLabel>
            {[["decimal", "1.  2.  3."], ["legal", "1.  1.1  1.1.1"], ["outline", "1.  (a)  (i)"], ["alpha", "(a)  (b)  (c)"], ["roman", "I.  II.  III."]].map(([id, label]) => (
              <DropdownMenuItem key={id} onClick={() => { const c = editor.chain().focus(); if (!editor.isActive("orderedList")) c.toggleOrderedList(); c.updateAttributes("orderedList", { listStyle: id }).run(); }}><span className="font-mono text-[12px]">{label}</span><span className="ml-auto text-[10.5px] text-muted-foreground">{id === "legal" ? "legal" : id === "outline" ? "outline" : ""}</span></DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>{state.ordered ? "Remove numbering" : "Numbered list"}</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={state.task} onCheckedChange={() => editor.chain().focus().toggleTaskList().run()}><ListTodo /> Checklist <kbd className="ml-auto">⌘⇧9</kbd></DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton icon={Outdent} label="Decrease indent" shortcut="⇧Tab" onClick={() => { if (editor.isActive("listItem")) editor.chain().focus().liftListItem("listItem").run(); else editor.chain().focus().setParagraphIndent(-1).run(); }} />
        <ToolButton icon={Indent} label="Increase indent" shortcut="Tab" onClick={() => { if (editor.isActive("listItem")) editor.chain().focus().sinkListItem("listItem").run(); else editor.chain().focus().setParagraphIndent(1).run(); }} />
        <DropdownMenu>
          <Tip label="Line spacing"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={AlignVerticalSpaceAround} label={<span className="tabular">{state.lineHeight ?? settings.lineSpacing}</span>} aria-label="Line spacing" hideLabelBelow="xl" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-60">
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
        <ToolSep />

        {/* Page */}
        <DropdownMenu>
          <Tip label="Page setup: size, margins, orientation, numbering"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={FileText} label="Page" aria-label="Page setup" hideLabelBelow="lg" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Size <span className="ml-auto pr-1 text-[10.5px] text-muted-foreground">{PAGE_SIZES[settings.pageSize].label.split(" ")[0]}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent><DropdownMenuRadioGroup value={settings.pageSize} onValueChange={(v) => onSettings({ pageSize: v as DocSettings["pageSize"] })}>{Object.entries(PAGE_SIZES).map(([id, p]) => <DropdownMenuRadioItem key={id} value={id}>{p.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Margins <span className="ml-auto pr-1 text-[10.5px] text-muted-foreground">{MARGIN_PRESETS[settings.margins].label.split(" ")[0]}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent><DropdownMenuRadioGroup value={settings.margins} onValueChange={(v) => onSettings({ margins: v as DocSettings["margins"] })}>{Object.entries(MARGIN_PRESETS).map(([id, p]) => <DropdownMenuRadioItem key={id} value={id}>{p.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Orientation <span className="ml-auto pr-1 text-[10.5px] capitalize text-muted-foreground">{settings.orientation}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent><DropdownMenuRadioGroup value={settings.orientation} onValueChange={(v) => onSettings({ orientation: v as DocSettings["orientation"] })}><DropdownMenuRadioItem value="portrait">Portrait</DropdownMenuRadioItem><DropdownMenuRadioItem value="landscape">Landscape</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Base size <span className="ml-auto pr-1 text-[10.5px] text-muted-foreground">{settings.fontSize} pt</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent><DropdownMenuRadioGroup value={String(settings.fontSize)} onValueChange={(v) => onSettings({ fontSize: Number(v) })}>{[10, 11, 12, 13, 14].map((s) => <DropdownMenuRadioItem key={s} value={String(s)}>{s} pt</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuCheckboxItem checked={settings.pageNumbers} onCheckedChange={(v) => onSettings({ pageNumbers: Boolean(v) })}>Page numbers on export</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onInsert("pageBreak")}><Scissors /> Insert page break <kbd className="ml-auto">⌘↵</kbd></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Insert */}
        <DropdownMenu>
          <Tip label="Insert"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={Plus} label="Insert" aria-label="Insert" hideLabelBelow="lg" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem onClick={() => onInsert("table")}><TableIcon /> Table</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInsert("image")}><ImageIcon /> Image…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInsert("diagram")}><Workflow /> Diagram…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInsert("link")}><Link2 /> Link <kbd className="ml-auto">⌘K</kbd></DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInsert("footnote")}><Superscript /> Footnote…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInsert("pageBreak")}><Scissors /> Page break <kbd className="ml-auto">⌘↵</kbd></DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInsert("caption")}><FileText /> Caption paragraph</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel><span className="inline-flex items-center gap-1.5"><BookOpen className="size-3.5" /> Legal blocks</span></DropdownMenuLabel>
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
            <Tip label="Table"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={TableIcon} label="Table" active aria-label="Table" hideLabelBelow="lg" /></DropdownMenuTrigger></Tip>
            <DropdownMenuContent align="start" className="w-56">
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
      </div>
    </OfficeToolbar>
  );
}
