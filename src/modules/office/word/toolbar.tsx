"use client";
/**
 * Word toolbar, grouped so the row stays calm: Undo/Redo · Style · Font · Size ·
 * B I U S · Text (color, highlight, more) · alignment · lists/indent/spacing ·
 * Insert · Page · Table (contextual) · … · Track changes · Preview.
 * The tracked-changes navigator lives in <TrackedChangesStrip> under the toolbar.
 */
import * as React from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Eraser, Eye, FileText, Highlighter, Image as ImageIcon, Indent, Italic, Link2, List, ListOrdered, ListTodo, Outdent, PenLine, Plus, Redo2, Scissors, Sigma, Strikethrough, Subscript, Superscript, Table as TableIcon, Type, Underline, Undo2, Workflow, PanelsTopLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OfficeToolbar, ToolbarButton, ToolbarMenuButton, ToolbarSep, ToolbarSpacer, ToolbarToggle } from "@/modules/office/shared/office-chrome";
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

const selectCls = "h-7 shrink-0 rounded-md border-transparent bg-transparent px-1.5 text-xs shadow-none hover:bg-accent hover:text-foreground focus:ring-0 data-[state=open]:bg-accent [&>span]:truncate";

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
  const sizePt = state.fontSize ? parseFloat(state.fontSize) : settings.fontSize;
  const textActive = Boolean(state.color) || state.highlight || state.sup || state.sub || state.smallCaps || state.code;

  return (
    <OfficeToolbar disabled={disabled} aria-label="Formatting">
      <ToolbarButton icon={Undo2} label="Undo" shortcut="⌘Z" onClick={() => editor.chain().focus().undo().run()} disabled={!state.canUndo} />
      <ToolbarButton icon={Redo2} label="Redo" shortcut="⌘⇧Z" onClick={() => editor.chain().focus().redo().run()} disabled={!state.canRedo} />
      <ToolbarSep />

      <Select value={state.style} onValueChange={(v) => applyParagraphStyle(editor, v as ParagraphStyle)}>
        <Tip label="Paragraph style" shortcut="⌘⌥0–3"><SelectTrigger size="sm" className={cn(selectCls, "w-[104px]")} aria-label="Paragraph style"><SelectValue /></SelectTrigger></Tip>
        <SelectContent>{PARAGRAPH_STYLES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={fontId} onValueChange={(v) => { const f = FONT_FAMILIES.find((x) => x.id === v)!; if (v === settings.font) editor.chain().focus().unsetFontFamily().run(); else editor.chain().focus().setFontFamily(f.css).run(); }}>
        <Tip label="Font"><SelectTrigger size="sm" className={cn(selectCls, "hidden w-[112px] md:flex")} aria-label="Font family"><SelectValue /></SelectTrigger></Tip>
        <SelectContent>{FONT_FAMILIES.map((f) => <SelectItem key={f.id} value={f.id}><span style={{ fontFamily: f.css }}>{f.label}</span></SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(sizePt)} onValueChange={(v) => { if (Number(v) === settings.fontSize) editor.chain().focus().unsetFontSize().run(); else editor.chain().focus().setFontSize(`${v}pt`).run(); }}>
        <Tip label="Font size" shortcut="⌘⇧, / ⌘⇧."><SelectTrigger size="sm" className={cn(selectCls, "w-[56px] tabular")} aria-label="Font size"><SelectValue /></SelectTrigger></Tip>
        <SelectContent>{Array.from(new Set([...FONT_SIZES, sizePt])).sort((a, b) => a - b).map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}</SelectContent>
      </Select>
      <ToolbarSep />

      <ToolbarButton icon={Bold} label="Bold" shortcut="⌘B" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarButton icon={Italic} label="Italic" shortcut="⌘I" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarButton icon={Underline} label="Underline" shortcut="⌘U" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolbarButton icon={Strikethrough} label="Strikethrough" shortcut="⌘⇧S" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <Popover>
        <Tip label="Text color, highlight and more">
          <PopoverTrigger asChild>
            <button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Text color, highlight and more" data-state={textActive ? "on" : "off"} className={cn("inline-flex h-7 w-8 shrink-0 items-center justify-center gap-0.5 rounded-md text-foreground/80 hover:bg-accent hover:text-foreground cursor-pointer", textActive && "bg-accent text-accent-foreground")}>
              <Baseline className="size-4" style={state.color ? { color: state.color } : undefined} />
              <span className="h-3 w-1 rounded-sm" style={{ background: state.color || "var(--foreground)" }} aria-hidden />
            </button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent className="w-64 space-y-3 p-3" align="start">
          <div>
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Text color</div>
            <div className="grid grid-cols-6 gap-1">
              {TEXT_COLORS.map((c) => <button key={c.id} type="button" title={c.label} aria-label={c.label} onClick={() => (c.css ? editor.chain().focus().setColor(c.css).run() : editor.chain().focus().unsetColor().run())} className={cn("size-6 rounded-md border cursor-pointer", !c.css && "bg-[linear-gradient(135deg,transparent_45%,var(--destructive)_45%,var(--destructive)_55%,transparent_55%)]", state.color === c.css && c.css && "ring-2 ring-ring ring-offset-1 ring-offset-background")} style={c.css ? { background: c.css } : undefined} />)}
              <input type="color" aria-label="Custom color" className="col-span-6 mt-1 h-6 w-full cursor-pointer rounded-md border bg-background p-0.5" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground"><span>Highlight</span>{state.highlight && <button className="normal-case tracking-normal text-primary hover:underline cursor-pointer" onClick={() => editor.chain().focus().unsetHighlight().run()}>Remove</button>}</div>
            <div className="grid grid-cols-6 gap-1">
              {HIGHLIGHT_COLORS.map((c) => <button key={c.id} type="button" title={c.label} aria-label={c.label} onClick={() => editor.chain().focus().setHighlight({ color: c.css }).run()} className="size-6 rounded-md border cursor-pointer" style={{ background: c.css }} />)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button variant={state.sup ? "secondary" : "ghost"} size="xs" className="justify-start" onClick={() => editor.chain().focus().toggleSuperscript().run()}><Superscript className="size-3.5" /> Superscript <kbd className="ml-auto">⌘.</kbd></Button>
            <Button variant={state.sub ? "secondary" : "ghost"} size="xs" className="justify-start" onClick={() => editor.chain().focus().toggleSubscript().run()}><Subscript className="size-3.5" /> Subscript <kbd className="ml-auto">⌘,</kbd></Button>
            <Button variant={state.smallCaps ? "secondary" : "ghost"} size="xs" className="justify-start" onClick={() => editor.chain().focus().toggleSmallCaps().run()}><Type className="size-3.5" /> Small caps</Button>
            <Button variant={state.code ? "secondary" : "ghost"} size="xs" className="justify-start" onClick={() => editor.chain().focus().toggleCode().run()}><span className="font-mono text-[11px]">{"</>"}</span> Monospace</Button>
          </div>
          <Button variant="outline" size="xs" className="w-full" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser className="size-3.5" /> Clear formatting <kbd className="ml-auto">⌘\</kbd></Button>
        </PopoverContent>
      </Popover>
      <ToolbarSep />

      <ToolbarButton icon={AlignLeft} label="Align left" shortcut="⌘⇧L" active={state.left} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
      <ToolbarButton icon={AlignCenter} label="Center" shortcut="⌘⇧E" active={state.center} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
      <ToolbarButton icon={AlignRight} label="Align right" shortcut="⌘⇧R" active={state.right} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
      <ToolbarButton icon={AlignJustify} label="Justify" shortcut="⌘⇧J" active={state.justify} onClick={() => editor.chain().focus().setTextAlign("justify").run()} className="hidden md:inline-flex" />
      <ToolbarSep />

      <ToolbarButton icon={List} label="Bullet list" shortcut="⌘⇧8" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <DropdownMenu>
        <Tip label="Numbered list" shortcut="⌘⇧7"><DropdownMenuTrigger asChild><ToolbarMenuButton icon={ListOrdered} label="Numbered list" hideLabel active={state.ordered} aria-label="Numbered list" className="w-10 px-1" /></DropdownMenuTrigger></Tip>
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
      <ToolbarButton icon={Outdent} label="Decrease indent" shortcut="⇧Tab" onClick={() => { if (editor.isActive("listItem")) editor.chain().focus().liftListItem("listItem").run(); else editor.chain().focus().setParagraphIndent(-1).run(); }} className="hidden lg:inline-flex" />
      <ToolbarButton icon={Indent} label="Increase indent" shortcut="Tab" onClick={() => { if (editor.isActive("listItem")) editor.chain().focus().sinkListItem("listItem").run(); else editor.chain().focus().setParagraphIndent(1).run(); }} className="hidden lg:inline-flex" />
      <DropdownMenu>
        <Tip label="Line spacing"><DropdownMenuTrigger asChild><ToolbarMenuButton icon={Sigma} label={String(state.lineHeight ?? settings.lineSpacing)} aria-label="Line spacing" className="tabular" /></DropdownMenuTrigger></Tip>
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
      <ToolbarSep />

      <DropdownMenu>
        <DropdownMenuTrigger asChild><ToolbarMenuButton icon={Plus} label="Insert" aria-label="Insert" /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild><ToolbarMenuButton icon={PanelsTopLeft} label="Page" aria-label="Page setup" /></DropdownMenuTrigger>
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
      {state.inTable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><ToolbarMenuButton icon={TableIcon} label="Table" aria-label="Table" active /></DropdownMenuTrigger>
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

      <ToolbarSpacer />
      <ToolbarToggle icon={PenLine} label="Track changes" shortcut="⌘⇧E" pressed={trackChanges} onClick={() => onTrackChanges(!trackChanges)} text={<span className="hidden sm:inline">Track changes</span>} />
      <ToolbarButton icon={Eye} label={view === "preview" ? "Back to editing" : "Preview with changes accepted"} active={view === "preview"} onClick={() => onView(view === "preview" ? "edit" : "preview")} className="pointer-events-auto" />
    </OfficeToolbar>
  );
}
