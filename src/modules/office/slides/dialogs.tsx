"use client";
/** Pickers, sheets and small dialogs for the slides editor. */
import * as React from "react";
import { Check, ImagePlus, Keyboard, Link2, Loader2, Minus, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LAYOUT_LABEL, SLIDE_LAYOUTS, THEMES, fontStack, type ChartSpec, type DeckElement, type DeckTheme, type SlideLayout, type TableSpec } from "./model";
import { imageSize, readFileAsDataUrl, uploadBlob } from "./client-utils";

// ---------------------------------------------------------------------------
// Layout picker
// ---------------------------------------------------------------------------

function LayoutIcon({ layout }: { layout: SlideLayout }) {
  const s = "currentColor";
  const box = (x: number, y: number, w: number, h: number, o = 0.35) => <rect key={`${x}${y}`} x={x} y={y} width={w} height={h} rx={1.5} fill={s} opacity={o} />;
  const title = box(6, 6, 52, 6, 0.8);
  const body: Record<SlideLayout, React.ReactNode> = {
    title: <>{box(6, 12, 40, 7, 0.9)}{box(6, 22, 28, 3)}</>,
    section: <>{box(6, 14, 14, 8, 0.9)}{box(6, 25, 40, 3)}</>,
    bullets: <>{title}{box(6, 16, 44, 3)}{box(6, 22, 38, 3)}{box(6, 28, 42, 3)}</>,
    two_column: <>{title}{box(6, 16, 24, 3)}{box(6, 22, 22, 3)}{box(34, 16, 24, 3)}{box(34, 22, 22, 3)}</>,
    comparison: <>{title}{box(6, 15, 25, 18, 0.2)}{box(33, 15, 25, 18, 0.2)}{box(8, 17, 14, 3, 0.7)}{box(35, 17, 14, 3, 0.7)}</>,
    timeline: <>{title}<line x1={8} y1={25} x2={56} y2={25} stroke={s} strokeWidth={1.2} opacity={0.6} />{[14, 26, 38, 50].map((x) => <circle key={x} cx={x} cy={25} r={2.2} fill={s} opacity={0.9} />)}</>,
    chart: <>{title}{box(10, 22, 6, 11)}{box(20, 16, 6, 17, 0.6)}{box(30, 19, 6, 14)}{box(40, 14, 6, 19, 0.6)}</>,
    table: <>{title}{box(6, 15, 52, 5, 0.7)}{box(6, 21, 52, 4, 0.2)}{box(6, 26, 52, 4, 0.2)}{box(6, 31, 52, 4, 0.2)}</>,
    quote: <>{box(8, 10, 8, 8, 0.6)}{box(18, 14, 36, 3, 0.8)}{box(18, 20, 30, 3, 0.8)}{box(18, 28, 16, 2)}</>,
    image: <>{title}{box(6, 15, 52, 18, 0.25)}<path d="M10 31 L22 21 L30 27 L36 24 L54 33 Z" fill={s} opacity={0.5} /></>,
    agenda: <>{title}{[16, 22, 28].map((y, i) => <React.Fragment key={y}><circle cx={9} cy={y + 1.5} r={2.5} fill={s} opacity={0.9} />{box(15, y, 30 - i * 4, 3)}</React.Fragment>)}</>,
    blank: <rect x={6} y={6} width={52} height={28} rx={2} fill="none" stroke={s} strokeDasharray="3 2" opacity={0.5} />,
  };
  return <svg viewBox="0 0 64 40" className="h-full w-full">{body[layout]}</svg>;
}

export function LayoutGrid({ onPick, current, className }: { onPick: (layout: SlideLayout) => void; current?: SlideLayout; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 gap-1.5", className)}>
      {SLIDE_LAYOUTS.map((l) => (
        <button key={l} onClick={() => onPick(l)} className={cn("group flex flex-col items-stretch gap-1 rounded-md border p-1.5 text-left transition-colors hover:border-primary/50 hover:bg-accent cursor-pointer", current === l && "border-primary/60 bg-primary/5")}>
          <div className="aspect-[16/10] w-full rounded bg-paper text-foreground/80 group-hover:text-primary"><LayoutIcon layout={l} /></div>
          <div className="truncate px-0.5 text-[11px] font-medium">{LAYOUT_LABEL[l]}</div>
        </button>
      ))}
    </div>
  );
}

export function ThemeGrid({ current, onPick, className }: { current: string; onPick: (themeId: string) => void; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-1.5", className)}>
      {THEMES.map((t) => (
        <button key={t.id} onClick={() => onPick(t.id)} className={cn("flex flex-col gap-1.5 rounded-md border p-1.5 text-left transition-colors hover:border-primary/50 hover:bg-accent cursor-pointer", current === t.id && "border-primary/60 bg-primary/5")}>
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded" style={{ background: t.colors.bg }}>
            <div className="absolute left-0 top-0 h-full w-[8%]" style={{ background: t.colors.accent2 }} />
            <div className="absolute left-[16%] top-[22%] h-[12%] w-[60%] rounded-sm" style={{ background: t.colors.fg }} />
            <div className="absolute left-[16%] top-[42%] h-[6%] w-[48%] rounded-sm" style={{ background: t.colors.accent }} />
            <div className="absolute left-[16%] top-[54%] h-[6%] w-[40%] rounded-sm" style={{ background: t.colors.muted }} />
            <div className="absolute left-[16%] top-[66%] h-[6%] w-[52%] rounded-sm" style={{ background: t.colors.muted, opacity: 0.6 }} />
            {current === t.id && <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="size-3" /></div>}
          </div>
          <div className="px-0.5">
            <div className="truncate text-[11px] font-medium" style={{ fontFamily: fontStack(t.fonts.heading) }}>{t.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">{t.fonts.heading} / {t.fonts.body}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart data sheet
// ---------------------------------------------------------------------------

export function ChartSheet({ element, open, onOpenChange, onSave }: { element: DeckElement | null; open: boolean; onOpenChange: (o: boolean) => void; onSave: (chart: ChartSpec) => void }) {
  const [chart, setChart] = React.useState<ChartSpec | null>(null);
  React.useEffect(() => { if (open && element?.chart) setChart(JSON.parse(JSON.stringify(element.chart))); }, [open, element]);
  if (!chart) return null;
  const setCat = (i: number, v: string) => setChart((c) => c && { ...c, categories: c.categories.map((x, j) => (j === i ? v : x)) });
  const setVal = (si: number, i: number, v: string) => setChart((c) => c && { ...c, series: c.series.map((s, j) => (j === si ? { ...s, values: s.values.map((x, k) => (k === i ? Number(v) || 0 : x)) } : s)) });
  const setName = (si: number, v: string) => setChart((c) => c && { ...c, series: c.series.map((s, j) => (j === si ? { ...s, name: v } : s)) });
  const addCat = () => setChart((c) => c && { ...c, categories: [...c.categories, `Item ${c.categories.length + 1}`], series: c.series.map((s) => ({ ...s, values: [...s.values, 0] })) });
  const removeCat = (i: number) => setChart((c) => c && c.categories.length > 1 ? { ...c, categories: c.categories.filter((_, j) => j !== i), series: c.series.map((s) => ({ ...s, values: s.values.filter((_, j) => j !== i) })) } : c);
  const addSeries = () => setChart((c) => c && { ...c, series: [...c.series, { name: `Series ${c.series.length + 1}`, values: c.categories.map(() => 0) }] });
  const removeSeries = (i: number) => setChart((c) => c && c.series.length > 1 ? { ...c, series: c.series.filter((_, j) => j !== i) } : c);
  const pasteCsv = (text: string) => {
    const rows = text.trim().split(/\r?\n/).map((r) => r.split(/\t|,/).map((x) => x.trim()));
    if (rows.length < 2) return;
    const categories = rows[0].slice(1);
    const series = rows.slice(1).map((r) => ({ name: r[0] || "Series", values: categories.map((_, i) => Number(r[i + 1]) || 0) }));
    setChart((c) => c && { ...c, categories, series });
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-2xl" className="flex flex-col">
        <SheetHeader><SheetTitle>Chart data</SheetTitle><SheetDescription>Edit categories and series. Paste a CSV/TSV block (first row = categories, first column = series names) to replace the data.</SheetDescription></SheetHeader>
        <SheetBody className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs">Type</Label>
              <Select value={chart.type} onValueChange={(v) => setChart((c) => c && { ...c, type: v as ChartSpec["type"] })}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bar">Bar</SelectItem><SelectItem value="line">Line</SelectItem><SelectItem value="pie">Pie</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Title</Label><Input className="h-8 text-xs" value={chart.title ?? ""} onChange={(e) => setChart((c) => c && { ...c, title: e.target.value || undefined })} placeholder="Exposure ($M)" /></div>
            <div className="space-y-1"><Label className="text-xs">Unit</Label><Input className="h-8 text-xs" value={chart.unit ?? ""} onChange={(e) => setChart((c) => c && { ...c, unit: e.target.value || undefined })} placeholder="$, %, ppt…" /></div>
          </div>
          <div className="flex items-center gap-5 text-xs">
            <label className="flex items-center gap-2 cursor-pointer"><Switch size="sm" checked={chart.showLegend ?? true} onCheckedChange={(v) => setChart((c) => c && { ...c, showLegend: v })} /> Legend</label>
            <label className="flex items-center gap-2 cursor-pointer"><Switch size="sm" checked={chart.showValues ?? true} onCheckedChange={(v) => setChart((c) => c && { ...c, showValues: v })} /> Value labels</label>
          </div>
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/50">
                <th className="w-40 px-2 py-1.5 text-left font-medium text-muted-foreground">Series</th>
                {chart.categories.map((c, i) => <th key={i} className="min-w-[96px] px-1 py-1"><div className="flex items-center gap-0.5"><Input className="h-7 text-xs" value={c} onChange={(e) => setCat(i, e.target.value)} /><button className="rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => removeCat(i)} aria-label="Remove category"><Minus className="size-3" /></button></div></th>)}
                <th className="w-8 px-1"><button className="rounded p-1 text-muted-foreground hover:text-foreground cursor-pointer" onClick={addCat} aria-label="Add category"><Plus className="size-3.5" /></button></th>
              </tr></thead>
              <tbody>
                {chart.series.map((s, si) => (
                  <tr key={si} className="border-t">
                    <td className="px-1 py-1"><div className="flex items-center gap-0.5"><Input className="h-7 text-xs" value={s.name} onChange={(e) => setName(si, e.target.value)} /><button className="rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => removeSeries(si)} aria-label="Remove series"><Trash2 className="size-3" /></button></div></td>
                    {chart.categories.map((_, i) => <td key={i} className="px-1 py-1"><Input type="number" className="h-7 text-xs tabular" value={s.values[i] ?? 0} onChange={(e) => setVal(si, i, e.target.value)} /></td>)}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button size="xs" variant="outline" onClick={addSeries}><Plus className="size-3" /> Add series</Button>
          <div className="space-y-1"><Label className="text-xs">Paste data (CSV / TSV)</Label><Textarea className="min-h-[72px] font-mono text-xs" placeholder={"Series,2024,2025,2026\nExposure,184,42,65"} onBlur={(e) => { if (e.target.value.trim()) { pasteCsv(e.target.value); e.target.value = ""; } }} /></div>
        </SheetBody>
        <SheetFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => { onSave(chart); onOpenChange(false); }}>Apply</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Table sheet
// ---------------------------------------------------------------------------

export function TableSheet({ element, open, onOpenChange, onSave }: { element: DeckElement | null; open: boolean; onOpenChange: (o: boolean) => void; onSave: (table: TableSpec, style: Partial<DeckElement["style"]>) => void }) {
  const [table, setTable] = React.useState<TableSpec | null>(null);
  const [style, setStyle] = React.useState<Partial<DeckElement["style"]>>({});
  React.useEffect(() => { if (open && element?.table) { setTable(JSON.parse(JSON.stringify(element.table))); setStyle({ fontSize: element.style.fontSize ?? 14, headerFill: element.style.headerFill ?? "accent", banded: element.style.banded !== false }); } }, [open, element]);
  if (!table) return null;
  const cols = table.header.length;
  const setHeader = (i: number, v: string) => setTable((t) => t && { ...t, header: t.header.map((x, j) => (j === i ? v : x)) });
  const setCell = (r: number, c: number, v: string) => setTable((t) => t && { ...t, rows: t.rows.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)) });
  const addRow = (at?: number) => setTable((t) => { if (!t) return t; const rows = [...t.rows]; rows.splice(at ?? rows.length, 0, Array.from({ length: cols }, () => "")); return { ...t, rows }; });
  const removeRow = (i: number) => setTable((t) => t && t.rows.length > 1 ? { ...t, rows: t.rows.filter((_, j) => j !== i) } : t);
  const addCol = () => setTable((t) => t && { ...t, header: [...t.header, `Column ${t.header.length + 1}`], rows: t.rows.map((r) => [...r, ""]), colWidths: undefined });
  const removeCol = (i: number) => setTable((t) => t && t.header.length > 1 ? { ...t, header: t.header.filter((_, j) => j !== i), rows: t.rows.map((r) => r.filter((_, j) => j !== i)), colWidths: undefined } : t);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-3xl" className="flex flex-col">
        <SheetHeader><SheetTitle>Table</SheetTitle><SheetDescription>Edit cells; add or remove rows and columns; set the header style. Tab moves between cells.</SheetDescription></SheetHeader>
        <SheetBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2"><Label className="text-xs">Font size</Label><Input type="number" className="h-7 w-16 text-xs" value={style.fontSize ?? 14} min={8} max={28} onChange={(e) => setStyle((s) => ({ ...s, fontSize: Number(e.target.value) || 14 }))} /></div>
            <div className="flex items-center gap-2"><Label className="text-xs">Header</Label>
              <Select value={style.headerFill ?? "accent"} onValueChange={(v) => setStyle((s) => ({ ...s, headerFill: v, headerColor: v === "surface" ? "fg" : "bg" }))}><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="accent">Accent</SelectItem><SelectItem value="accent2">Accent 2</SelectItem><SelectItem value="fg">Dark</SelectItem><SelectItem value="muted">Muted</SelectItem><SelectItem value="surface">Light</SelectItem></SelectContent></Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer"><Switch size="sm" checked={style.banded !== false} onCheckedChange={(v) => setStyle((s) => ({ ...s, banded: v }))} /> Banded rows</label>
            <div className="ml-auto flex items-center gap-1"><Button size="xs" variant="outline" onClick={() => addRow()}><Plus className="size-3" /> Row</Button><Button size="xs" variant="outline" onClick={addCol}><Plus className="size-3" /> Column</Button></div>
          </div>
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/50">
                <th className="w-8" />
                {table.header.map((h, i) => <th key={i} className="min-w-[120px] px-1 py-1"><div className="flex items-center gap-0.5"><Input className="h-7 text-xs font-semibold" value={h} onChange={(e) => setHeader(i, e.target.value)} /><button className="rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => removeCol(i)} aria-label="Remove column"><Minus className="size-3" /></button></div></th>)}
              </tr></thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri} className="border-t">
                    <td className="px-1 text-center"><button className="rounded p-1 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => removeRow(ri)} aria-label="Remove row"><Trash2 className="size-3" /></button></td>
                    {Array.from({ length: cols }, (_, ci) => <td key={ci} className="px-1 py-1"><Input className="h-7 text-xs" value={row[ci] ?? ""} onChange={(e) => setCell(ri, ci, e.target.value)} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SheetBody>
        <SheetFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => { onSave(table, style); onOpenChange(false); }}>Apply</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Image dialog
// ---------------------------------------------------------------------------

export function ImageDialog({ open, onOpenChange, onInsert }: { open: boolean; onOpenChange: (o: boolean) => void; onInsert: (src: string, alt: string, size: { w: number; h: number }) => void }) {
  const [url, setUrl] = React.useState("");
  const [alt, setAlt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) { setUrl(""); setAlt(""); setPreview(null); } }, [open]);
  const onFile = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Choose an image file"); return; }
    setBusy(true);
    try { const r = await uploadBlob(file, file.name); setUrl(r.url); setPreview(await readFileAsDataUrl(file)); if (!alt) setAlt(file.name.replace(/\.[^.]+$/, "")); } catch (e) { toast.error(`Upload failed: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const insert = async () => { if (!url) return; const size = await imageSize(preview ?? url); onInsert(url, alt || "Image", size); onOpenChange(false); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ImagePlus className="size-4" /> Insert image</DialogTitle><DialogDescription>Upload a file (stored with the deck) or paste a URL. Ask the assistant to generate a demonstrative from a prompt.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }} className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground hover:bg-accent/40" onClick={() => inputRef.current?.click()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {busy ? <Loader2 className="size-5 animate-spin" /> : preview ? <img src={preview} alt="" className="max-h-40 rounded" /> : <><Upload className="size-5" /> Drop an image here or click to choose (PNG, JPG, GIF, SVG)</>}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          </div>
          <div className="space-y-1"><Label className="text-xs flex items-center gap-1"><Link2 className="size-3" /> Image URL</Label><Input value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} placeholder="https://… or /api/blobs/…" className="text-xs" /></div>
          <div className="space-y-1"><Label className="text-xs">Alt text</Label><Input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image for accessibility and export" className="text-xs" /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!url || busy} onClick={() => void insert()}>Insert</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Prompt + shortcuts
// ---------------------------------------------------------------------------

export interface PromptRequest { title: string; description?: string; label?: string; placeholder?: string; defaultValue?: string; multiline?: boolean; confirm?: string }

export function PromptDialog({ request, onSubmit, onCancel }: { request: PromptRequest | null; onSubmit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = React.useState("");
  React.useEffect(() => { setValue(request?.defaultValue ?? ""); }, [request]);
  const submit = () => { if (!value.trim()) return; onSubmit(value.trim()); };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>{request?.title}</DialogTitle>{request?.description && <DialogDescription>{request.description}</DialogDescription>}</DialogHeader>
        <div className="space-y-1">
          {request?.label && <Label className="text-xs">{request.label}</Label>}
          {request?.multiline ? <Textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={request.placeholder} className="min-h-[96px]" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} /> : <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={request?.placeholder} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button onClick={submit}>{request?.confirm ?? "OK"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘S", "Save"], ["⌘Z / ⌘⇧Z", "Undo / redo"], ["⌘/", "Toggle assistant"], ["⌘⇧P or F5", "Present from current slide"], ["⌘⇧N", "New slide after current"], ["⌘⇧D", "Duplicate slide"], ["⌘⇧H", "Hide / show slide"], ["⌘⇧C", "Comment on slide"], ["⌘⇧M", "Toggle comments panel"],
  ["Enter / double-click", "Edit text in place"], ["Esc", "Finish editing / clear selection"], ["Tab / ⇧Tab (editing)", "Indent / outdent bullet"], ["⌘B / ⌘I / ⌘U", "Bold / italic / underline"],
  ["Arrows / ⇧Arrows", "Nudge 1 px / 10 px (or change slide when nothing is selected)"], ["⌘A", "Select all on slide"], ["⌘C / ⌘X / ⌘V / ⌘D", "Copy / cut / paste / duplicate elements"], ["Delete", "Remove selection"],
  ["⌘G / ⌘⇧G", "Group / ungroup"], ["⌘] / ⌘[", "Bring forward / send backward (⇧ for front / back)"], ["⌘'", "Toggle grid"], ["Shift while dragging", "Constrain aspect ratio / 15° rotation steps"], ["Page Up / Page Down", "Previous / next slide"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Keyboard className="size-4" /> Keyboard shortcuts</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {SHORTCUTS.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-3 border-b py-1.5"><span className="text-muted-foreground">{v}</span><kbd className="shrink-0">{k}</kbd></div>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function themeById(id: string): DeckTheme | undefined { return THEMES.find((t) => t.id === id); }
