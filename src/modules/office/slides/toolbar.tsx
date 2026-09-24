"use client";
/**
 * Slides toolbar with the same discipline as Word: Undo/Redo · Slide ▾ · Layout ▾ ·
 * Theme ▾ · Insert ▾ · contextual text/shape formatting · Arrange ▾ · … · View ▾.
 */
import * as React from "react";
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter,
  ArrowDownToLine, ArrowUpToLine, Baseline, Bold, ChartColumn, Circle, Eye, Grid3x3, Group, ImagePlus, IndentDecrease, IndentIncrease, Italic, LayoutTemplate, List, ListOrdered, Lock, Magnet, Minus, MoveDown, MoveRight, MoveUp, PaintBucket, Palette, Plus, Redo2, Ruler, Square, Table, Trash2, Type, Underline, Undo2, Ungroup,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OfficeToolbar, ToolButton, ToolMenuTrigger, ToolSep } from "@/modules/office/shared/office-chrome";
import { FONT_FACES, LAYOUT_LABEL, fontStack, resolveColor, type DeckElement, type DeckTheme, type ElementStyle, type ThemeColorToken } from "./model";
import { currentSlideOf, selectedElementsOf, useSlidesStore } from "./store";
import type { TextEditorHandle } from "./text-editor";
import { LayoutGrid, ThemeGrid } from "./dialogs";

const SIZES = [10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72];
const TOKENS: { id: ThemeColorToken; label: string }[] = [{ id: "fg", label: "Text" }, { id: "bg", label: "Background" }, { id: "accent", label: "Accent" }, { id: "accent2", label: "Accent 2" }, { id: "muted", label: "Muted" }, { id: "surface", label: "Surface" }];

export function ColorControl({ value, onChange, theme, label, icon, allowNone }: { value?: string; onChange: (v: string | undefined) => void; theme: DeckTheme; label: string; icon: React.ReactNode; allowNone?: boolean }) {
  const resolved = resolveColor(value, theme, "transparent");
  const hex = /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#000000";
  return (
    <Popover>
      <Tip label={label}>
        <PopoverTrigger asChild>
          <button className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-foreground cursor-pointer" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
            {icon}
            <span className="h-3 w-1.5 rounded-sm border" style={{ background: resolved === "transparent" ? "repeating-conic-gradient(var(--border) 0 25%, transparent 0 50%) 0 0/6px 6px" : resolved }} />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="start" className="w-56 space-y-2 p-2">
        <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="grid grid-cols-3 gap-1">
          {TOKENS.map((t) => (
            <button key={t.id} onClick={() => onChange(t.id)} className={cn("flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] hover:bg-accent cursor-pointer", value === t.id && "border-primary/60 bg-primary/5")}>
              <span className="size-3.5 rounded-sm border" style={{ background: resolveColor(t.id, theme) }} />{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-10 cursor-pointer rounded-md border bg-transparent p-0.5" aria-label="Custom color" />
          <input value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} placeholder="#RRGGBB or token" className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px]" />
          {allowNone && <Button size="xs" variant="outline" onClick={() => onChange(undefined)}>None</Button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface SlidesToolbarProps {
  textEditorRef: React.RefObject<TextEditorHandle | null>;
  onInsertImage: () => void;
  onEditData: (el: DeckElement) => void;
  disabled?: boolean;
}

const selectCls = "h-7 rounded-md border-transparent bg-transparent px-1.5 text-[11.5px] shadow-none hover:bg-accent focus:ring-0 [&>span]:truncate";

export function SlidesToolbar({ textEditorRef, onInsertImage, onEditData, disabled }: SlidesToolbarProps) {
  const deck = useSlidesStore((s) => s.deck);
  const currentSlideId = useSlidesStore((s) => s.currentSlideId);
  const selectedIds = useSlidesStore((s) => s.selectedIds);
  const editingId = useSlidesStore((s) => s.editingId);
  const canUndo = useSlidesStore((s) => s.past.length > 0);
  const canRedo = useSlidesStore((s) => s.future.length > 0);
  const showGrid = useSlidesStore((s) => s.showGrid);
  const snap = useSlidesStore((s) => s.snap);
  const showGuides = useSlidesStore((s) => s.showGuides);
  const st = useSlidesStore;
  const theme = deck.theme;
  const slide = currentSlideOf({ deck, currentSlideId });
  const selected = React.useMemo(() => selectedElementsOf({ deck, currentSlideId, selectedIds }), [deck, currentSlideId, selectedIds]);
  const first = selected[0];
  const editing = Boolean(editingId);
  const textLike = selected.length > 0 && selected.every((e) => e.type === "text" || e.type === "shape");
  const shapeLike = selected.length > 0 && selected.every((e) => e.type === "shape" || e.type === "text" || e.type === "line" || e.type === "image" || e.type === "chart");
  const style: ElementStyle = first?.style ?? {};
  const [layoutOpen, setLayoutOpen] = React.useState(false);
  const [themeOpen, setThemeOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);

  const setStyle = (patch: Partial<ElementStyle>) => st.getState().updateSelected(() => ({ style: patch }));
  const toggleStyle = (key: "bold" | "italic" | "underline") => { if (editing) textEditorRef.current?.exec(key); else setStyle({ [key]: !style[key] }); };
  const list = (kind: "toggle-bullet" | "toggle-number") => {
    if (editing) { textEditorRef.current?.setLineKind(kind); return; }
    st.getState().updateSelected((e) => {
      const lines = (e.text ?? "").split("\n");
      const marker = kind === "toggle-bullet" ? "- " : "1. ";
      const allMarked = lines.every((l) => new RegExp(`^\\s*${kind === "toggle-bullet" ? "[-•*]" : "\\d+[.)]"}\\s`).test(l) || !l.trim());
      return { text: lines.map((l) => { const m = l.match(/^(\s*)(?:[-•*]\s+|\d+[.)]\s+)?(.*)$/); const indent = m?.[1] ?? "", rest = m?.[2] ?? l; return allMarked ? `${indent}${rest}` : `${indent}${marker}${rest}`; }).join("\n") };
    });
  };
  const indent = (d: number) => {
    if (editing) { textEditorRef.current?.indent(d); return; }
    st.getState().updateSelected((e) => ({ text: (e.text ?? "").split("\n").map((l) => (d > 0 ? `  ${l}` : l.replace(/^ {1,2}/, ""))).join("\n") }));
  };
  const addText = () => st.getState().addElement({ type: "text", text: "New text", x: 160, y: 300, w: 480, h: 80, style: { fontSize: 20, color: "fg", padding: 8, valign: "top" }, name: "Text" });
  const addShape = (shape: "rect" | "ellipse" | "arrow" | "line") => {
    if (shape === "line") st.getState().addElement({ type: "line", x: 240, y: 360, w: 320, h: 0, style: { stroke: "accent", strokeWidth: 3, lineDir: "down" }, name: "Line" });
    else st.getState().addElement({ type: "shape", shape, x: 440, y: 260, w: shape === "arrow" ? 280 : 240, h: shape === "arrow" ? 90 : 160, style: { fill: shape === "arrow" ? "accent2" : "accent", radius: shape === "rect" ? 12 : undefined, color: "bg", fontSize: 16, align: "center", valign: "middle" }, name: shape[0].toUpperCase() + shape.slice(1) });
  };
  const addTable = () => st.getState().addElement({ type: "table", table: { header: ["Column A", "Column B", "Column C"], rows: [["", "", ""], ["", "", ""], ["", "", ""]] }, x: 72, y: 168, w: 1136, h: 200, style: { fontSize: 14, color: "fg", headerFill: "accent", headerColor: "bg", stroke: "muted", banded: true }, name: "Table" });
  const addChart = () => st.getState().addElement({ type: "chart", chart: { type: "bar", categories: ["2024", "2025", "2026"], series: [{ name: "Series A", values: [12, 18, 24] }], showLegend: false, showValues: true }, x: 72, y: 168, w: 1136, h: 460, style: { fill: "surface", radius: 12, padding: 16 }, name: "Chart" });
  const viewActive = showGrid || snap || showGuides;

  return (
    <OfficeToolbar
      disabled={disabled}
      right={
        <DropdownMenu>
          <DropdownMenuTrigger asChild><ToolMenuTrigger icon={Eye} label="View" aria-label="View options" active={viewActive} hideLabelBelow="lg" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={() => st.getState().toggleGrid()}><Grid3x3 /> Grid <span className="ml-auto text-[10px] text-muted-foreground">⌘&apos;</span></DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={snap} onCheckedChange={() => st.getState().toggleSnap()}><Magnet /> Snap to grid</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={showGuides} onCheckedChange={() => st.getState().toggleGuides()}><Ruler /> Smart guides</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <ToolButton icon={Undo2} label="Undo" shortcut="⌘Z" onClick={() => st.getState().undo()} disabled={!canUndo} />
      <ToolButton icon={Redo2} label="Redo" shortcut="⌘⇧Z" onClick={() => st.getState().redo()} disabled={!canRedo} />
      <ToolSep />
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild><ToolMenuTrigger icon={Plus} label="Slide" aria-label="New slide" /></PopoverTrigger>
        <PopoverContent align="start" className="w-[340px] p-2"><div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">New slide layout</div><LayoutGrid onPick={(l) => { st.getState().addSlide(l); setAddOpen(false); }} /></PopoverContent>
      </Popover>
      <Popover open={layoutOpen} onOpenChange={setLayoutOpen}>
        <PopoverTrigger asChild><ToolMenuTrigger icon={LayoutTemplate} label="Layout" aria-label="Apply layout" disabled={!slide} hideLabelBelow="lg" /></PopoverTrigger>
        <PopoverContent align="start" className="w-[340px] p-2"><div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Apply layout to this slide{slide ? ` (${LAYOUT_LABEL[slide.layout]})` : ""}</div><LayoutGrid current={slide?.layout} onPick={(l) => { if (slide) st.getState().setLayout(slide.id, l); setLayoutOpen(false); }} /></PopoverContent>
      </Popover>
      <Popover open={themeOpen} onOpenChange={setThemeOpen}>
        <PopoverTrigger asChild><ToolMenuTrigger icon={Palette} label={theme.name} aria-label="Theme" hideLabelBelow="lg" /></PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-2"><div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Theme</div><ThemeGrid current={theme.id} onPick={(id) => { st.getState().setTheme(id); setThemeOpen(false); }} /></PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><ToolMenuTrigger icon={ImagePlus} label="Insert" aria-label="Insert" disabled={!slide} hideLabelBelow="lg" /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={addText}><Type /> Text box</DropdownMenuItem>
          <DropdownMenuItem onClick={onInsertImage}><ImagePlus /> Image…</DropdownMenuItem>
          <DropdownMenuItem onClick={addTable}><Table /> Table</DropdownMenuItem>
          <DropdownMenuItem onClick={addChart}><ChartColumn /> Chart</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Shapes</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => addShape("rect")}><Square /> Rectangle</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addShape("ellipse")}><Circle /> Ellipse</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addShape("arrow")}><MoveRight /> Arrow</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addShape("line")}><Minus /> Line</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolSep />

      {textLike && (
        <>
          <Select value={style.fontFamily ?? "body"} onValueChange={(v) => setStyle({ fontFamily: v })}>
            <Tip label="Font"><SelectTrigger size="sm" className={cn(selectCls, "hidden w-[120px] md:flex")} aria-label="Font"><SelectValue /></SelectTrigger></Tip>
            <SelectContent>
              <SelectItem value="heading"><span style={{ fontFamily: fontStack(theme.fonts.heading) }}>Heading · {theme.fonts.heading}</span></SelectItem>
              <SelectItem value="body"><span style={{ fontFamily: fontStack(theme.fonts.body) }}>Body · {theme.fonts.body}</span></SelectItem>
              {FONT_FACES.map((f) => <SelectItem key={f} value={f}><span style={{ fontFamily: fontStack(f) }}>{f}</span></SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex h-7 shrink-0 items-center rounded-md border">
            <button className="px-1 text-muted-foreground hover:text-foreground cursor-pointer" onMouseDown={(e) => e.preventDefault()} onClick={() => setStyle({ fontSize: Math.max(6, (style.fontSize ?? 18) - 1) })} aria-label="Smaller text"><Minus className="size-3" /></button>
            <input value={style.fontSize ?? 18} onChange={(e) => { const n = Number(e.target.value); if (n >= 4 && n <= 200) setStyle({ fontSize: n }); }} className="h-full w-9 bg-transparent text-center text-[11.5px] tabular outline-none" aria-label="Font size" list="sl-sizes" />
            <datalist id="sl-sizes">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
            <button className="px-1 text-muted-foreground hover:text-foreground cursor-pointer" onMouseDown={(e) => e.preventDefault()} onClick={() => setStyle({ fontSize: Math.min(200, (style.fontSize ?? 18) + 1) })} aria-label="Larger text"><Plus className="size-3" /></button>
          </div>
          <ToolButton icon={Bold} label="Bold" shortcut="⌘B" onClick={() => toggleStyle("bold")} active={!editing && Boolean(style.bold)} />
          <ToolButton icon={Italic} label="Italic" shortcut="⌘I" onClick={() => toggleStyle("italic")} active={!editing && Boolean(style.italic)} />
          <ToolButton icon={Underline} label="Underline" shortcut="⌘U" onClick={() => toggleStyle("underline")} active={!editing && Boolean(style.underline)} />
          <ColorControl label="Text color" icon={<Baseline className="size-4" />} theme={theme} value={style.color} onChange={(v) => setStyle({ color: v })} />
          <ToolSep />
          <ToolButton icon={AlignLeft} label="Align left" onClick={() => setStyle({ align: "left" })} active={(style.align ?? "left") === "left"} />
          <ToolButton icon={AlignCenter} label="Align center" onClick={() => setStyle({ align: "center" })} active={style.align === "center"} />
          <ToolButton icon={AlignRight} label="Align right" onClick={() => setStyle({ align: "right" })} active={style.align === "right"} />
          <DropdownMenu>
            <Tip label="Vertical alignment, lists and spacing"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={AlignStartHorizontal} label="Text" aria-label="Text options" hideLabelBelow="xl" /></DropdownMenuTrigger></Tip>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Vertical alignment</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={(style.valign ?? "top") === "top"} onCheckedChange={() => setStyle({ valign: "top" })}><AlignStartHorizontal /> Top</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={style.valign === "middle"} onCheckedChange={() => setStyle({ valign: "middle" })}><AlignCenterHorizontal /> Middle</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={style.valign === "bottom"} onCheckedChange={() => setStyle({ valign: "bottom" })}><AlignEndHorizontal /> Bottom</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => list("toggle-bullet")}><List /> Bullets</DropdownMenuItem>
              <DropdownMenuItem onClick={() => list("toggle-number")}><ListOrdered /> Numbering</DropdownMenuItem>
              <DropdownMenuItem onClick={() => indent(-1)}><IndentDecrease /> Outdent <span className="ml-auto text-[10px] text-muted-foreground">⇧Tab</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => indent(1)}><IndentIncrease /> Indent <span className="ml-auto text-[10px] text-muted-foreground">Tab</span></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Line spacing · {(style.lineHeight ?? 1.25).toFixed(2)}×</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>{[1, 1.1, 1.25, 1.4, 1.6, 2].map((v) => <DropdownMenuCheckboxItem key={v} checked={(style.lineHeight ?? 1.25) === v} onCheckedChange={() => setStyle({ lineHeight: v })}>{v.toFixed(2)}×</DropdownMenuCheckboxItem>)}</DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton icon={List} label="Bullets" onClick={() => list("toggle-bullet")} className="hidden xl:inline-flex" />
          <ToolButton icon={ListOrdered} label="Numbering" onClick={() => list("toggle-number")} className="hidden xl:inline-flex" />
          <ToolSep />
        </>
      )}

      {shapeLike && !editing && (
        <>
          {first?.type !== "image" && first?.type !== "line" && <ColorControl label="Fill" icon={<PaintBucket className="size-4" />} theme={theme} value={style.fill} onChange={(v) => setStyle({ fill: v })} allowNone />}
          <ColorControl label="Stroke" icon={<Square className="size-4" />} theme={theme} value={style.stroke} onChange={(v) => setStyle({ stroke: v, strokeWidth: v ? style.strokeWidth ?? 2 : style.strokeWidth })} allowNone />
          <Popover>
            <Tip label="Shape options (radius, opacity, line)"><PopoverTrigger asChild><ToolMenuTrigger label="Shape" aria-label="Shape options" hideLabelBelow="lg" /></PopoverTrigger></Tip>
            <PopoverContent align="start" className="w-64 space-y-3 p-3 text-xs">
              {first?.type === "line" && (
                <>
                  <label className="block"><span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Line width · {style.strokeWidth ?? 2}</span><input type="range" min={1} max={12} value={style.strokeWidth ?? 2} onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })} className="w-full accent-primary" aria-label="Line width" /></label>
                  <div className="flex gap-1">
                    <Button size="xs" variant={style.arrowEnd ? "secondary" : "outline"} onClick={() => setStyle({ arrowEnd: !style.arrowEnd })}><MoveRight className="size-3.5" /> Arrow head</Button>
                    <Button size="xs" variant="outline" onClick={() => setStyle({ lineDir: style.lineDir === "up" ? "down" : "up" })}>{style.lineDir === "up" ? <MoveUp className="size-3.5" /> : <MoveDown className="size-3.5" />} Flip</Button>
                  </div>
                </>
              )}
              {first?.type !== "line" && first?.shape !== "ellipse" && <label className="block"><span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Corner radius · {style.radius ?? 0}</span><input type="range" min={0} max={80} value={style.radius ?? 0} onChange={(e) => setStyle({ radius: Number(e.target.value) })} className="w-full accent-primary" aria-label="Corner radius" /></label>}
              <label className="block"><span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Opacity · {Math.round((style.opacity ?? 1) * 100)}%</span><input type="range" min={5} max={100} value={Math.round((style.opacity ?? 1) * 100)} onChange={(e) => setStyle({ opacity: Number(e.target.value) / 100 })} className="w-full accent-primary" aria-label="Opacity" /></label>
              {first?.type === "image" && (
                <div><div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Image fit</div><div className="grid grid-cols-3 gap-1">{(["contain", "cover", "fill"] as const).map((f) => <Button key={f} size="xs" variant={(style.fit ?? "contain") === f ? "secondary" : "outline"} onClick={() => setStyle({ fit: f })}>{f === "contain" ? "Fit" : f === "cover" ? "Crop" : "Stretch"}</Button>)}</div></div>
              )}
            </PopoverContent>
          </Popover>
          {(first?.type === "table" || first?.type === "chart") && selected.length === 1 && <Button size="xs" variant="outline" className="h-7" onMouseDown={(e) => e.preventDefault()} onClick={() => onEditData(first)}>Edit {first.type === "table" ? "cells" : "data"}</Button>}
          <ToolSep />
        </>
      )}

      {selected.length > 0 && !editing && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><ToolMenuTrigger icon={AlignStartVertical} label="Arrange" aria-label="Arrange" hideLabelBelow="lg" /></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => st.getState().align("left")}><AlignStartVertical /> Align left</DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().align("center")}><AlignCenterVertical /> Align center</DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().align("right")}><AlignEndVertical /> Align right</DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().align("top")}><AlignStartHorizontal /> Align top</DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().align("middle")}><AlignCenterHorizontal /> Align middle</DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().align("bottom")}><AlignEndHorizontal /> Align bottom</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={selected.length < 3} onClick={() => st.getState().distribute("h")}><AlignHorizontalDistributeCenter /> Distribute horizontally</DropdownMenuItem>
              <DropdownMenuItem disabled={selected.length < 3} onClick={() => st.getState().distribute("v")}><AlignVerticalDistributeCenter /> Distribute vertically</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => st.getState().reorder("front")}><ArrowUpToLine /> Bring to front <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧]</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().reorder("forward")}><MoveUp /> Bring forward <span className="ml-auto text-[10px] text-muted-foreground">⌘]</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().reorder("backward")}><MoveDown /> Send backward <span className="ml-auto text-[10px] text-muted-foreground">⌘[</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().reorder("back")}><ArrowDownToLine /> Send to back <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧[</span></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={selected.length < 2} onClick={() => st.getState().group()}><Group /> Group <span className="ml-auto text-[10px] text-muted-foreground">⌘G</span></DropdownMenuItem>
              <DropdownMenuItem disabled={!selected.some((e) => e.groupId)} onClick={() => st.getState().ungroup()}><Ungroup /> Ungroup <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧G</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().updateSelected((e) => ({ locked: !e.locked }))}><Lock /> {first?.locked ? "Unlock" : "Lock position"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => st.getState().updateSelected(() => ({ rotation: undefined }))}>Reset rotation</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton icon={Trash2} label="Delete" shortcut="⌫" onClick={() => st.getState().deleteSelected()} />
        </>
      )}
    </OfficeToolbar>
  );
}
