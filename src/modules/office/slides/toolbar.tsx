"use client";
/** Contextual formatting toolbar for the slides editor. */
import * as React from "react";
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter,
  ArrowDownToLine, ArrowUpToLine, Baseline, Bold, ChartColumn, ChevronDown, Circle, Grid3x3, Group, ImagePlus, IndentDecrease, IndentIncrease, Italic, LayoutTemplate, List, ListOrdered, Lock, Magnet, Minus, MoveDown, MoveRight, MoveUp, PaintBucket, Palette, Plus, Redo2, Ruler, Square, Table, Trash2, Type, Underline, Undo2, Ungroup,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FONT_FACES, LAYOUT_LABEL, fontStack, resolveColor, type DeckElement, type DeckTheme, type ElementStyle, type ThemeColorToken } from "./model";
import { currentSlideOf, selectedElementsOf, useSlidesStore } from "./store";
import type { TextEditorHandle } from "./text-editor";
import { LayoutGrid, ThemeGrid } from "./dialogs";

const SIZES = [10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72];
const TOKENS: { id: ThemeColorToken; label: string }[] = [{ id: "fg", label: "Text" }, { id: "bg", label: "Background" }, { id: "accent", label: "Accent" }, { id: "accent2", label: "Accent 2" }, { id: "muted", label: "Muted" }, { id: "surface", label: "Surface" }];

function TBtn({ label, shortcut, onClick, active, disabled, children, className }: { label: string; shortcut?: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <Button variant={active ? "secondary" : "ghost"} size="icon-xs" onClick={onClick} onMouseDown={(e) => e.preventDefault()} disabled={disabled} aria-label={label} aria-pressed={active} className={cn(active && "text-primary", className)}>{children}</Button>
    </Tip>
  );
}

const Sep = () => <div className="mx-1 h-5 w-px shrink-0 bg-border" />;

export function ColorControl({ value, onChange, theme, label, icon, allowNone }: { value?: string; onChange: (v: string | undefined) => void; theme: DeckTheme; label: string; icon: React.ReactNode; allowNone?: boolean }) {
  const resolved = resolveColor(value, theme, "transparent");
  const hex = /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#000000";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex h-7 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()}>
          {icon}
          <span className="h-3.5 w-3.5 rounded-sm border" style={{ background: resolved === "transparent" ? "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/6px 6px" : resolved }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-2 p-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="grid grid-cols-3 gap-1">
          {TOKENS.map((t) => (
            <button key={t.id} onClick={() => onChange(t.id)} className={cn("flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] hover:bg-accent cursor-pointer", value === t.id && "border-primary/60 bg-primary/5")}>
              <span className="size-3.5 rounded-sm border" style={{ background: resolveColor(t.id, theme) }} />{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-10 cursor-pointer rounded border bg-transparent p-0.5" aria-label="Custom color" />
          <input value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} placeholder="#RRGGBB or token" className="h-7 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-[11px]" />
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

  return (
    <div className={cn("flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2 no-scrollbar", disabled && "pointer-events-none opacity-60")}>
      <TBtn label="Undo" shortcut="⌘Z" onClick={() => st.getState().undo()} disabled={!canUndo}><Undo2 className="size-4" /></TBtn>
      <TBtn label="Redo" shortcut="⌘⇧Z" onClick={() => st.getState().redo()} disabled={!canRedo}><Redo2 className="size-4" /></TBtn>
      <Sep />
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" className="gap-1 px-2"><Plus className="size-4" /> Slide <ChevronDown className="size-3 opacity-60" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-[340px] p-2"><div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">New slide layout</div><LayoutGrid onPick={(l) => { st.getState().addSlide(l); setAddOpen(false); }} /></PopoverContent>
      </Popover>
      <Popover open={layoutOpen} onOpenChange={setLayoutOpen}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" className="gap-1 px-2" disabled={!slide}><LayoutTemplate className="size-4" /> Layout <ChevronDown className="size-3 opacity-60" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-[340px] p-2"><div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Apply layout to this slide{slide ? ` (${LAYOUT_LABEL[slide.layout]})` : ""}</div><LayoutGrid current={slide?.layout} onPick={(l) => { if (slide) st.getState().setLayout(slide.id, l); setLayoutOpen(false); }} /></PopoverContent>
      </Popover>
      <Popover open={themeOpen} onOpenChange={setThemeOpen}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" className="gap-1 px-2"><Palette className="size-4" /> {theme.name} <ChevronDown className="size-3 opacity-60" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-2"><div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Theme</div><ThemeGrid current={theme.id} onPick={(id) => { st.getState().setTheme(id); setThemeOpen(false); }} /></PopoverContent>
      </Popover>
      <Sep />
      <TBtn label="Text box" onClick={addText} disabled={!slide}><Type className="size-4" /></TBtn>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Insert shape" disabled={!slide}><Square className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => addShape("rect")}><Square /> Rectangle</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addShape("ellipse")}><Circle /> Ellipse</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addShape("arrow")}><MoveRight /> Arrow</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addShape("line")}><Minus /> Line</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TBtn label="Image" onClick={onInsertImage} disabled={!slide}><ImagePlus className="size-4" /></TBtn>
      <TBtn label="Table" onClick={addTable} disabled={!slide}><Table className="size-4" /></TBtn>
      <TBtn label="Chart" onClick={addChart} disabled={!slide}><ChartColumn className="size-4" /></TBtn>
      <Sep />

      {textLike && (
        <>
          <Select value={style.fontFamily ?? "body"} onValueChange={(v) => setStyle({ fontFamily: v })}>
            <SelectTrigger size="sm" className="h-7 w-[128px] text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="heading"><span style={{ fontFamily: fontStack(theme.fonts.heading) }}>Heading · {theme.fonts.heading}</span></SelectItem>
              <SelectItem value="body"><span style={{ fontFamily: fontStack(theme.fonts.body) }}>Body · {theme.fonts.body}</span></SelectItem>
              {FONT_FACES.map((f) => <SelectItem key={f} value={f}><span style={{ fontFamily: fontStack(f) }}>{f}</span></SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex h-7 items-center rounded border">
            <button className="px-1 text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setStyle({ fontSize: Math.max(6, (style.fontSize ?? 18) - 1) })} aria-label="Smaller"><Minus className="size-3" /></button>
            <input value={style.fontSize ?? 18} onChange={(e) => { const n = Number(e.target.value); if (n >= 4 && n <= 200) setStyle({ fontSize: n }); }} className="h-full w-9 bg-transparent text-center text-[11px] tabular outline-none" aria-label="Font size" list="sl-sizes" />
            <datalist id="sl-sizes">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
            <button className="px-1 text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setStyle({ fontSize: Math.min(200, (style.fontSize ?? 18) + 1) })} aria-label="Larger"><Plus className="size-3" /></button>
          </div>
          <TBtn label="Bold" shortcut="⌘B" onClick={() => toggleStyle("bold")} active={!editing && Boolean(style.bold)}><Bold className="size-4" /></TBtn>
          <TBtn label="Italic" shortcut="⌘I" onClick={() => toggleStyle("italic")} active={!editing && Boolean(style.italic)}><Italic className="size-4" /></TBtn>
          <TBtn label="Underline" shortcut="⌘U" onClick={() => toggleStyle("underline")} active={!editing && Boolean(style.underline)}><Underline className="size-4" /></TBtn>
          <ColorControl label="Text color" icon={<Baseline className="size-4" />} theme={theme} value={style.color} onChange={(v) => setStyle({ color: v })} />
          <Sep />
          <TBtn label="Align left" onClick={() => setStyle({ align: "left" })} active={(style.align ?? "left") === "left"}><AlignLeft className="size-4" /></TBtn>
          <TBtn label="Align center" onClick={() => setStyle({ align: "center" })} active={style.align === "center"}><AlignCenter className="size-4" /></TBtn>
          <TBtn label="Align right" onClick={() => setStyle({ align: "right" })} active={style.align === "right"}><AlignRight className="size-4" /></TBtn>
          <TBtn label="Top" onClick={() => setStyle({ valign: "top" })} active={(style.valign ?? "top") === "top"}><AlignStartHorizontal className="size-4" /></TBtn>
          <TBtn label="Middle" onClick={() => setStyle({ valign: "middle" })} active={style.valign === "middle"}><AlignCenterHorizontal className="size-4" /></TBtn>
          <TBtn label="Bottom" onClick={() => setStyle({ valign: "bottom" })} active={style.valign === "bottom"}><AlignEndHorizontal className="size-4" /></TBtn>
          <Sep />
          <TBtn label="Bullets" onClick={() => list("toggle-bullet")}><List className="size-4" /></TBtn>
          <TBtn label="Numbering" onClick={() => list("toggle-number")}><ListOrdered className="size-4" /></TBtn>
          <TBtn label="Outdent" shortcut="⇧Tab" onClick={() => indent(-1)}><IndentDecrease className="size-4" /></TBtn>
          <TBtn label="Indent" shortcut="Tab" onClick={() => indent(1)}><IndentIncrease className="size-4" /></TBtn>
          <Select value={String(style.lineHeight ?? 1.25)} onValueChange={(v) => setStyle({ lineHeight: Number(v) })}>
            <SelectTrigger size="sm" className="h-7 w-[72px] text-[11px]" aria-label="Line spacing"><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 1.1, 1.25, 1.4, 1.6, 2].map((v) => <SelectItem key={v} value={String(v)}>{v.toFixed(2)}×</SelectItem>)}</SelectContent>
          </Select>
          <Sep />
        </>
      )}

      {shapeLike && !editing && (
        <>
          {first?.type !== "image" && first?.type !== "line" && <ColorControl label="Fill" icon={<PaintBucket className="size-4" />} theme={theme} value={style.fill} onChange={(v) => setStyle({ fill: v })} allowNone />}
          <ColorControl label="Stroke" icon={<Square className="size-4" />} theme={theme} value={style.stroke} onChange={(v) => setStyle({ stroke: v, strokeWidth: v ? style.strokeWidth ?? 2 : style.strokeWidth })} allowNone />
          {first?.type === "line" && (
            <>
              <input type="range" min={1} max={12} value={style.strokeWidth ?? 2} onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })} className="w-16 accent-primary" aria-label="Line width" />
              <TBtn label="Arrow head" onClick={() => setStyle({ arrowEnd: !style.arrowEnd })} active={Boolean(style.arrowEnd)}><MoveRight className="size-4" /></TBtn>
              <TBtn label="Flip direction" onClick={() => setStyle({ lineDir: style.lineDir === "up" ? "down" : "up" })}>{style.lineDir === "up" ? <MoveUp className="size-4" /> : <MoveDown className="size-4" />}</TBtn>
            </>
          )}
          {first?.type !== "line" && first?.shape !== "ellipse" && <Tip label="Corner radius"><input type="range" min={0} max={80} value={style.radius ?? 0} onChange={(e) => setStyle({ radius: Number(e.target.value) })} className="w-16 accent-primary" aria-label="Corner radius" /></Tip>}
          <Tip label="Opacity"><input type="range" min={5} max={100} value={Math.round((style.opacity ?? 1) * 100)} onChange={(e) => setStyle({ opacity: Number(e.target.value) / 100 })} className="w-16 accent-primary" aria-label="Opacity" /></Tip>
          {first?.type === "image" && (
            <Select value={style.fit ?? "contain"} onValueChange={(v) => setStyle({ fit: v as ElementStyle["fit"] })}>
              <SelectTrigger size="sm" className="h-7 w-[84px] text-[11px]" aria-label="Image fit"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="contain">Fit</SelectItem><SelectItem value="cover">Crop</SelectItem><SelectItem value="fill">Stretch</SelectItem></SelectContent>
            </Select>
          )}
          {(first?.type === "table" || first?.type === "chart") && selected.length === 1 && <Button size="xs" variant="outline" onClick={() => onEditData(first)}>Edit {first.type === "table" ? "cells" : "data"}</Button>}
          <Sep />
        </>
      )}

      {selected.length > 0 && !editing && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="gap-1 px-2"><AlignStartVertical className="size-4" /> Arrange <ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
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
          <TBtn label="Delete" shortcut="⌫" onClick={() => st.getState().deleteSelected()}><Trash2 className="size-4" /></TBtn>
          <Sep />
        </>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <TBtn label="Grid" shortcut="⌘'" onClick={() => st.getState().toggleGrid()} active={showGrid}><Grid3x3 className="size-4" /></TBtn>
        <TBtn label="Snap to grid" onClick={() => st.getState().toggleSnap()} active={snap}><Magnet className="size-4" /></TBtn>
        <TBtn label="Smart guides" onClick={() => st.getState().toggleGuides()} active={showGuides}><Ruler className="size-4" /></TBtn>
      </div>
    </div>
  );
}
