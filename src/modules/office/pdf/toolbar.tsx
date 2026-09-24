"use client";
/** Editor toolbar: tools, colors, stamps/redactions, zoom, rotate, page navigation, search, view toggles. */
import * as React from "react";
import { Baseline, ChevronDown, ChevronLeft, ChevronRight, Circle, Hand, Highlighter, Link2, Minus, MousePointer2, PenLine, Plus, Redo2, RotateCw, ScanSearch, Search, Signature, Square, Stamp, StickyNote, Strikethrough, SunMoon, Type, Underline, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle";
import { Slider } from "@/components/ui/slider";
import { ANNOTATION_COLORS, REDACTION_REASONS, STAMP_PRESETS, activePages } from "./model";
import { usePdfStore, type Tool, type ZoomMode } from "./store";
import { PII_PATTERNS } from "./text-search";

const ZOOMS = [0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];

const TOOLS: { id: Tool; label: string; icon: React.ComponentType<{ className?: string }>; key: string }[] = [
  { id: "select", label: "Select", icon: MousePointer2, key: "V" },
  { id: "hand", label: "Pan", icon: Hand, key: "H" },
  { id: "highlight", label: "Highlight text", icon: Highlighter, key: "1" },
  { id: "underline", label: "Underline text", icon: Underline, key: "2" },
  { id: "strikeout", label: "Strike out text", icon: Strikethrough, key: "3" },
  { id: "note", label: "Sticky note", icon: StickyNote, key: "N" },
  { id: "text", label: "Text box", icon: Type, key: "T" },
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
  React.useEffect(() => { const onFocus = (e: Event) => { if ((e as CustomEvent).type === "pdf:focus-search") { searchRef.current?.focus(); searchRef.current?.select(); } }; window.addEventListener("pdf:focus-search", onFocus); return () => window.removeEventListener("pdf:focus-search", onFocus); }, []);

  const zoomPct = Math.round((effectiveScale / (96 / 72)) * 100);
  const setZoomStep = (dir: 1 | -1) => { const cur = effectiveScale / (96 / 72); const idx = ZOOMS.findIndex((z) => z >= cur - 0.001); const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (idx < 0 ? ZOOMS.length - 1 : idx) + dir))]; store.getState().setZoom(next); };
  const goto = (n: number) => { const d = Math.max(1, Math.min(pageCount, n)); store.getState().scrollTo(d); setPageInput(String(d)); };
  const rotateCurrent = () => { const p = activePages(store.getState().model)[currentPage - 1]; if (p) store.getState().applyOp({ op: "rotate_pages", sourcePages: [p.index], delta: 90 }); };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2 text-sm">
      <ToggleGroup type="single" value={tool} onValueChange={(v) => v && store.getState().setTool(v as Tool)} size="sm" aria-label="Tools" className="gap-0">
        {TOOLS.map((t) => (
          <Tip key={t.id} label={t.label} shortcut={t.key}><ToggleGroupItem value={t.id} aria-label={t.label} className="size-7 p-0 data-[state=on]:bg-accent"><t.icon className="size-4" /></ToggleGroupItem></Tip>
        ))}
      </ToggleGroup>

      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant={tool === "stamp" ? "secondary" : "ghost"} size="sm" className="h-7 gap-1 px-1.5" aria-label="Stamp"><Stamp className="size-4" /><span className="hidden max-w-[110px] truncate text-xs xl:inline">{tool === "stamp" ? stampText : "Stamp"}</span><ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Stamp text — then click the page</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={stampText} onValueChange={(v) => { store.getState().setPrefs({ stampText: v }); store.getState().setTool("stamp"); }}>
            {STAMP_PRESETS.map((s) => <DropdownMenuRadioItem key={s} value={s} className="font-mono text-xs">{s}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onCustomStamp}>Custom text…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant={tool === "redaction" ? "secondary" : "ghost"} size="sm" className="h-7 gap-1 px-1.5" aria-label="Redaction"><ScanSearch className="size-4" /><span className="hidden text-xs xl:inline">Redact</span><ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem onClick={() => store.getState().setTool("redaction")}><Square /> Draw redaction box <span className="ml-auto text-[10px] text-muted-foreground">X</span></DropdownMenuItem>
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

      <Tip label={signature ? "Place signature (click the page)" : "Draw a signature"} shortcut="S"><Button variant={tool === "signature" ? "secondary" : "ghost"} size="icon-sm" className="size-7" onClick={() => { if (signature) store.getState().setTool("signature"); else onOpenSignature(); }} aria-label="Signature"><Signature className="size-4" /></Button></Tip>

      <div className="mx-1 h-5 w-px bg-border" />

      <Popover>
        <PopoverTrigger asChild><button className="flex size-7 items-center justify-center rounded-md hover:bg-accent cursor-pointer" aria-label="Color"><span className="size-4 rounded-full border border-black/20" style={{ background: color }} /></button></PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Color</div>
          <div className="grid grid-cols-8 gap-1">{ANNOTATION_COLORS.map((c) => <button key={c.id} title={c.label} onClick={() => store.getState().setColor(c.hex)} className={cn("size-5 rounded-full border border-black/15 transition-transform hover:scale-110 cursor-pointer", color.toLowerCase() === c.hex.toLowerCase() && "ring-2 ring-ring ring-offset-1 ring-offset-background")} style={{ background: c.hex }} aria-label={c.label} />)}</div>
          <div className="mt-3 text-[11px] font-medium text-muted-foreground">Stroke width · {strokeWidth}pt</div>
          <Slider value={[strokeWidth]} min={0.5} max={8} step={0.5} onValueChange={([v]) => { store.getState().setPrefs({ strokeWidth: v }); const id = store.getState().selectedAnnotationId; if (id) store.getState().updateAnnotation(id, { strokeWidth: v }); }} className="mt-1" />
          <div className="mt-3 text-[11px] font-medium text-muted-foreground">Text size · {fontSize}pt</div>
          <Slider value={[fontSize]} min={6} max={36} step={1} onValueChange={([v]) => { store.getState().setPrefs({ fontSize: v }); const id = store.getState().selectedAnnotationId; if (id) store.getState().updateAnnotation(id, { fontSize: v }); }} className="mt-1" />
        </PopoverContent>
      </Popover>

      <div className="mx-1 h-5 w-px bg-border" />
      <Tip label="Undo" shortcut="⌘Z"><Button variant="ghost" size="icon-sm" className="size-7" onClick={() => store.getState().undo()} disabled={!canUndo} aria-label="Undo"><Undo2 className="size-4" /></Button></Tip>
      <Tip label="Redo" shortcut="⌘⇧Z"><Button variant="ghost" size="icon-sm" className="size-7" onClick={() => store.getState().redo()} disabled={!canRedo} aria-label="Redo"><Redo2 className="size-4" /></Button></Tip>
      <Tip label="Rotate current page" shortcut="⌘R"><Button variant="ghost" size="icon-sm" className="size-7" onClick={rotateCurrent} aria-label="Rotate page"><RotateCw className="size-4" /></Button></Tip>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <Tip label="Previous page" shortcut="←"><Button variant="ghost" size="icon-sm" className="size-7" onClick={() => goto(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page"><ChevronLeft className="size-4" /></Button></Tip>
        <form onSubmit={(e) => { e.preventDefault(); goto(Number(pageInput) || 1); }} className="flex items-center gap-1 text-xs tabular">
          <Input value={pageInput} onChange={(e) => setPageInput(e.target.value)} onFocus={(e) => e.target.select()} className="h-6 w-11 px-1 text-center text-xs" aria-label="Page number" inputMode="numeric" />
          <span className="text-muted-foreground">of {pageCount}</span>
        </form>
        <Tip label="Next page" shortcut="→"><Button variant="ghost" size="icon-sm" className="size-7" onClick={() => goto(currentPage + 1)} disabled={currentPage >= pageCount} aria-label="Next page"><ChevronRight className="size-4" /></Button></Tip>
      </div>

      <div className="mx-1 h-5 w-px bg-border" />
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setZoomStep(-1)} aria-label="Zoom out"><Minus className="size-3.5" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="min-w-[52px] rounded px-1 text-center text-xs tabular hover:bg-accent cursor-pointer" aria-label="Zoom">{zoomPct}%</button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuRadioGroup value={String(zoom)} onValueChange={(v) => store.getState().setZoom((v === "fit-width" || v === "fit-page" ? v : Number(v)) as ZoomMode)}>
              <DropdownMenuRadioItem value="fit-width">Fit width</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="fit-page">Fit page</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {ZOOMS.map((z) => <DropdownMenuRadioItem key={z} value={String(z)} className="tabular">{Math.round(z * 100)}%</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setZoomStep(1)} aria-label="Zoom in"><Plus className="size-3.5" /></Button>
      </div>
      <Tip label={darkInvert ? "Normal page colors" : "Invert page colors (dark reading)"} shortcut="⌘I"><Button variant={darkInvert ? "secondary" : "ghost"} size="icon-sm" className="size-7" onClick={() => store.getState().setDarkInvert(!darkInvert)} aria-pressed={darkInvert} aria-label="Invert page colors"><SunMoon className="size-4" /></Button></Tip>

      <div className="mx-1 h-5 w-px bg-border" />
      <form onSubmit={(e) => { e.preventDefault(); if (q === search.query && search.hits.length) onNextHit(1); else onSearch(q, { regex: search.regex, caseSensitive: search.caseSensitive }); }} className="flex items-center gap-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (⌘F)" className="h-7 w-[170px] pl-7 pr-6 text-xs" aria-label="Search document" onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); onSearch(""); } if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onNextHit(-1); } }} />
          {q && <button type="button" onClick={() => { setQ(""); onSearch(""); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Clear search"><X className="size-3" /></button>}
        </div>
        {search.query && <span className="min-w-[56px] text-[11px] tabular text-muted-foreground">{search.running ? "…" : search.hits.length ? `${search.index + 1} / ${search.hits.length}` : "0 hits"}</span>}
        <Tip label="Previous hit" shortcut="⇧Enter"><Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={() => onNextHit(-1)} disabled={!search.hits.length} aria-label="Previous result"><ChevronLeft className="size-4" /></Button></Tip>
        <Tip label="Next hit" shortcut="Enter"><Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={() => onNextHit(1)} disabled={!search.hits.length} aria-label="Next result"><ChevronRight className="size-4" /></Button></Tip>
        <Tip label={search.regex ? "Regular expression on" : "Regular expression off"}><Button type="button" variant={search.regex ? "secondary" : "ghost"} size="icon-sm" className="size-7 font-mono text-[10px]" onClick={() => { store.getState().setSearch({ regex: !search.regex }); if (q) onSearch(q, { regex: !search.regex, caseSensitive: search.caseSensitive }); }} aria-pressed={search.regex} aria-label="Toggle regex">.*</Button></Tip>
        <Tip label="Match case"><Button type="button" variant={search.caseSensitive ? "secondary" : "ghost"} size="icon-sm" className="size-7" onClick={() => { store.getState().setSearch({ caseSensitive: !search.caseSensitive }); if (q) onSearch(q, { regex: search.regex, caseSensitive: !search.caseSensitive }); }} aria-pressed={search.caseSensitive} aria-label="Match case"><Baseline className="size-4" /></Button></Tip>
      </form>
    </div>
  );
}
