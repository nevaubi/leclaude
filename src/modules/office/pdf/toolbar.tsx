"use client";
/**
 * PDF toolbar with the office discipline: Undo/Redo · Select/Pan · Markup ▾ ·
 * Note · Text · Shapes ▾ · Stamp ▾ · Redact ▾ · Signature · color · rotate ·
 * … page navigation · zoom · invert · search.
 */
import * as React from "react";
import { Baseline, ChevronLeft, ChevronRight, Circle, Hand, Highlighter, Link2, Minus, MousePointer2, PenLine, Plus, Redo2, RotateCw, ScanSearch, Search, Shapes, Signature, Square, Stamp, StickyNote, Strikethrough, SunMoon, Type, Underline, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { OfficeToolbar, ToolButton, ToolMenuTrigger, ToolSep } from "@/modules/office/shared/office-chrome";
import { ANNOTATION_COLORS, REDACTION_REASONS, STAMP_PRESETS, activePages } from "./model";
import { usePdfStore, type Tool, type ZoomMode } from "./store";
import { PII_PATTERNS } from "./text-search";

const ZOOMS = [0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];

const MARKUP: { id: Tool; label: string; icon: React.ComponentType<{ className?: string }>; key: string }[] = [
  { id: "highlight", label: "Highlight text", icon: Highlighter, key: "1" },
  { id: "underline", label: "Underline text", icon: Underline, key: "2" },
  { id: "strikeout", label: "Strike out text", icon: Strikethrough, key: "3" },
];
const SHAPES: { id: Tool; label: string; icon: React.ComponentType<{ className?: string }>; key: string }[] = [
  { id: "rect", label: "Rectangle", icon: Square, key: "R" },
  { id: "ellipse", label: "Ellipse", icon: Circle, key: "E" },
  { id: "freehand", label: "Pen", icon: PenLine, key: "P" },
  { id: "link", label: "Link", icon: Link2, key: "L" },
];

export interface PdfToolbarProps {
  onSearch: (query: string, opts?: { regex?: boolean; caseSensitive?: boolean }) => void;
  onNextHit: (dir: 1 | -1) => void;
  onOpenSignature: () => void;
  onRedactSearch: (query: string, regex: boolean, reason?: string) => void;
  onCustomStamp: () => void;
}

export function PdfToolbar({ onSearch, onNextHit, onOpenSignature, onRedactSearch, onCustomStamp }: PdfToolbarProps) {
  const tool = usePdfStore((s) => s.tool);
  const color = usePdfStore((s) => s.color);
  const zoom = usePdfStore((s) => s.zoom);
  const effectiveScale = usePdfStore((s) => s.effectiveScale);
  const currentPage = usePdfStore((s) => s.currentPage);
  const pageCount = usePdfStore((s) => activePages(s.model).length);
  const search = usePdfStore((s) => s.search);
  const darkInvert = usePdfStore((s) => s.darkInvert);
  const canUndo = usePdfStore((s) => s.history.length > 0);
  const canRedo = usePdfStore((s) => s.future.length > 0);
  const stampText = usePdfStore((s) => s.stampText);
  const redactionReason = usePdfStore((s) => s.redactionReason);
  const strokeWidth = usePdfStore((s) => s.strokeWidth);
  const fontSize = usePdfStore((s) => s.fontSize);
  const signature = usePdfStore((s) => s.signatureDataUrl);
  const store = usePdfStore;
  const [pageInput, setPageInput] = React.useState(String(currentPage));
  const [q, setQ] = React.useState(search.query);
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => setPageInput(String(currentPage)), [currentPage]);
  React.useEffect(() => { const onFocus = () => { searchRef.current?.focus(); searchRef.current?.select(); }; window.addEventListener("pdf:focus-search", onFocus); return () => window.removeEventListener("pdf:focus-search", onFocus); }, []);

  const zoomPct = Math.round((effectiveScale / (96 / 72)) * 100);
  const setZoomStep = (dir: 1 | -1) => { const cur = effectiveScale / (96 / 72); const idx = ZOOMS.findIndex((z) => z >= cur - 0.001); const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (idx < 0 ? ZOOMS.length - 1 : idx) + dir))]; store.getState().setZoom(next); };
  const goto = (n: number) => { const d = Math.max(1, Math.min(pageCount, n)); store.getState().scrollTo(d); setPageInput(String(d)); };
  const rotateCurrent = () => { const p = activePages(store.getState().model)[currentPage - 1]; if (p) store.getState().applyOp({ op: "rotate_pages", sourcePages: [p.index], delta: 90 }); };
  const setTool = (t: Tool) => store.getState().setTool(t);
  const markup = MARKUP.find((m) => m.id === tool);
  const shape = SHAPES.find((s) => s.id === tool);

  return (
    <OfficeToolbar
      right={
        <>
          <div className="flex items-center gap-0.5">
            <ToolButton icon={ChevronLeft} label="Previous page" shortcut="←" onClick={() => goto(currentPage - 1)} disabled={currentPage <= 1} keepFocus={false} />
            <form onSubmit={(e) => { e.preventDefault(); goto(Number(pageInput) || 1); }} className="flex items-center gap-1 text-xs tabular">
              <Input value={pageInput} onChange={(e) => setPageInput(e.target.value)} onFocus={(e) => e.target.select()} className="h-6 w-11 px-1 text-center text-xs" aria-label="Page number" inputMode="numeric" />
              <span className="whitespace-nowrap text-muted-foreground">of {pageCount}</span>
            </form>
            <ToolButton icon={ChevronRight} label="Next page" shortcut="→" onClick={() => goto(currentPage + 1)} disabled={currentPage >= pageCount} keepFocus={false} />
          </div>
          <ToolSep />
          <div className="flex items-center gap-0.5">
            <ToolButton icon={Minus} label="Zoom out" shortcut="⌘−" onClick={() => setZoomStep(-1)} keepFocus={false} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button className="min-w-[52px] rounded-md px-1 text-center text-xs tabular hover:bg-accent cursor-pointer" aria-label="Zoom">{zoomPct}%</button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuRadioGroup value={String(zoom)} onValueChange={(v) => store.getState().setZoom((v === "fit-width" || v === "fit-page" ? v : Number(v)) as ZoomMode)}>
                  <DropdownMenuRadioItem value="fit-width">Fit width <span className="ml-auto text-[10px] text-muted-foreground">⌘0</span></DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="fit-page">Fit page <span className="ml-auto text-[10px] text-muted-foreground">⌘9</span></DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {ZOOMS.map((z) => <DropdownMenuRadioItem key={z} value={String(z)} className="tabular">{Math.round(z * 100)}%</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ToolButton icon={Plus} label="Zoom in" shortcut="⌘+" onClick={() => setZoomStep(1)} keepFocus={false} />
          </div>
          <ToolButton icon={SunMoon} label={darkInvert ? "Normal page colors" : "Invert page colors (dark reading)"} shortcut="⌘I" active={darkInvert} onClick={() => store.getState().setDarkInvert(!darkInvert)} keepFocus={false} />
          <ToolSep />
          <form onSubmit={(e) => { e.preventDefault(); if (q === search.query && search.hits.length) onNextHit(1); else onSearch(q, { regex: search.regex, caseSensitive: search.caseSensitive }); }} className="flex items-center gap-0.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (⌘F)" className="h-7 w-[150px] pl-7 pr-6 text-xs lg:w-[180px]" aria-label="Search document" onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); onSearch(""); } if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onNextHit(-1); } }} />
              {q && <button type="button" onClick={() => { setQ(""); onSearch(""); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Clear search"><X className="size-3" /></button>}
            </div>
            {search.query && <span className="min-w-[48px] text-center text-[11px] tabular text-muted-foreground">{search.running ? "…" : search.hits.length ? `${search.index + 1}/${search.hits.length}` : "0"}</span>}
            <Tip label="Previous hit" shortcut="⇧↵"><Button type="button" variant="ghost" size="icon-xs" onClick={() => onNextHit(-1)} disabled={!search.hits.length} aria-label="Previous result"><ChevronLeft className="size-4" /></Button></Tip>
            <Tip label="Next hit" shortcut="↵"><Button type="button" variant="ghost" size="icon-xs" onClick={() => onNextHit(1)} disabled={!search.hits.length} aria-label="Next result"><ChevronRight className="size-4" /></Button></Tip>
            <DropdownMenu>
              <Tip label="Search options"><DropdownMenuTrigger asChild><Button type="button" variant={search.regex || search.caseSensitive ? "secondary" : "ghost"} size="icon-xs" aria-label="Search options" className="font-mono text-[10px]">.*</Button></DropdownMenuTrigger></Tip>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuCheckboxItem checked={search.regex} onCheckedChange={() => { store.getState().setSearch({ regex: !search.regex }); if (q) onSearch(q, { regex: !search.regex, caseSensitive: search.caseSensitive }); }}>Regular expression</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={search.caseSensitive} onCheckedChange={() => { store.getState().setSearch({ caseSensitive: !search.caseSensitive }); if (q) onSearch(q, { regex: search.regex, caseSensitive: !search.caseSensitive }); }}>Match case</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </form>
        </>
      }
    >
      <ToolButton icon={Undo2} label="Undo" shortcut="⌘Z" onClick={() => store.getState().undo()} disabled={!canUndo} keepFocus={false} />
      <ToolButton icon={Redo2} label="Redo" shortcut="⌘⇧Z" onClick={() => store.getState().redo()} disabled={!canRedo} keepFocus={false} />
      <ToolSep />
      <ToolButton icon={MousePointer2} label="Select" shortcut="V" active={tool === "select"} onClick={() => setTool("select")} keepFocus={false} />
      <ToolButton icon={Hand} label="Pan" shortcut="H" active={tool === "hand"} onClick={() => setTool("hand")} keepFocus={false} />
      <DropdownMenu>
        <Tip label="Text markup: highlight, underline, strike out"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={markup?.icon ?? Highlighter} label={markup?.label ?? "Markup"} active={Boolean(markup)} aria-label="Text markup" hideLabelBelow="xl" /></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Select text, then mark it</DropdownMenuLabel>
          {MARKUP.map((m) => <DropdownMenuCheckboxItem key={m.id} checked={tool === m.id} onCheckedChange={() => setTool(m.id)}><m.icon /> {m.label} <span className="ml-auto text-[10px] text-muted-foreground">{m.key}</span></DropdownMenuCheckboxItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton icon={StickyNote} label="Sticky note" shortcut="N" active={tool === "note"} onClick={() => setTool("note")} keepFocus={false} />
      <ToolButton icon={Type} label="Text box" shortcut="T" active={tool === "text"} onClick={() => setTool("text")} keepFocus={false} />
      <DropdownMenu>
        <Tip label="Shapes, pen and links"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={shape?.icon ?? Shapes} label={shape?.label ?? "Shapes"} active={Boolean(shape)} aria-label="Shapes" hideLabelBelow="xl" /></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start" className="w-48">
          {SHAPES.map((s) => <DropdownMenuCheckboxItem key={s.id} checked={tool === s.id} onCheckedChange={() => setTool(s.id)}><s.icon /> {s.label} <span className="ml-auto text-[10px] text-muted-foreground">{s.key}</span></DropdownMenuCheckboxItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolSep />
      <DropdownMenu>
        <Tip label="Stamp: pick text, then click the page"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={Stamp} label={tool === "stamp" ? stampText : "Stamp"} active={tool === "stamp"} aria-label="Stamp" hideLabelBelow="lg" className="max-w-[150px]" /></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Stamp text — then click the page</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={stampText} onValueChange={(v) => { store.getState().setPrefs({ stampText: v }); setTool("stamp"); }}>
            {STAMP_PRESETS.map((s) => <DropdownMenuRadioItem key={s} value={s} className="font-mono text-xs">{s}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onCustomStamp}>Custom text…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tip label="Redaction: draw boxes, redact search hits or a pattern"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={ScanSearch} label="Redact" active={tool === "redaction"} aria-label="Redaction" hideLabelBelow="lg" /></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem onClick={() => setTool("redaction")}><Square /> Draw redaction box <span className="ml-auto text-[10px] text-muted-foreground">X</span></DropdownMenuItem>
          <DropdownMenuItem disabled={!search.query || !search.hits.length} onClick={() => onRedactSearch(search.query, search.regex, redactionReason)}><Search /> Redact all {search.hits.length ? `${search.hits.length} ` : ""}search results</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Redact a pattern</DropdownMenuLabel>
          {PII_PATTERNS.map((p) => <DropdownMenuItem key={p.id} onClick={() => onRedactSearch(p.pattern, true, p.label)}>{p.label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Reason for new boxes</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={redactionReason} onValueChange={(v) => store.getState().setPrefs({ redactionReason: v })}>
            {REDACTION_REASONS.map((r) => <DropdownMenuRadioItem key={r} value={r}>{r}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton icon={Signature} label={signature ? "Place signature (click the page)" : "Draw a signature"} shortcut="S" active={tool === "signature"} onClick={() => { if (signature) setTool("signature"); else onOpenSignature(); }} keepFocus={false} />
      <ToolSep />
      <Popover>
        <Tip label="Color, stroke and text size">
          <PopoverTrigger asChild>
            <button className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-foreground/80 hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Color and stroke">
              <Baseline className="size-4" />
              <span className="size-3.5 rounded-full border border-border" style={{ background: color }} />
            </button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="start" className="w-56 p-3">
          <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Color</div>
          <div className="grid grid-cols-8 gap-1">{ANNOTATION_COLORS.map((c) => <button key={c.id} title={c.label} onClick={() => store.getState().setColor(c.hex)} className={cn("size-5 rounded-full border border-border transition-transform hover:scale-110 cursor-pointer", color.toLowerCase() === c.hex.toLowerCase() && "ring-2 ring-ring ring-offset-1 ring-offset-background")} style={{ background: c.hex }} aria-label={c.label} />)}</div>
          <div className="mt-3 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Stroke width · {strokeWidth}pt</div>
          <Slider value={[strokeWidth]} min={0.5} max={8} step={0.5} onValueChange={([v]) => { store.getState().setPrefs({ strokeWidth: v }); const id = store.getState().selectedAnnotationId; if (id) store.getState().updateAnnotation(id, { strokeWidth: v }); }} className="mt-1" />
          <div className="mt-3 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Text size · {fontSize}pt</div>
          <Slider value={[fontSize]} min={6} max={36} step={1} onValueChange={([v]) => { store.getState().setPrefs({ fontSize: v }); const id = store.getState().selectedAnnotationId; if (id) store.getState().updateAnnotation(id, { fontSize: v }); }} className="mt-1" />
        </PopoverContent>
      </Popover>
      <ToolButton icon={RotateCw} label="Rotate current page" shortcut="⌘R" onClick={rotateCurrent} keepFocus={false} />
    </OfficeToolbar>
  );
}
