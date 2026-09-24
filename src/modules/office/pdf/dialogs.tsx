"use client";
/** Dialogs for the PDF editor: annotation editor, Bates stamping, header/footer/watermark, merge, split, signature, custom stamp, apply-to-source, shortcuts. */
import * as React from "react";
import { AlertTriangle, Flame, Loader2, Merge, Scissors, Signature, Stamp, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ANNOTATION_COLORS, ANNOTATION_LABEL, REDACTION_REASONS, activePages, formatBates, parsePageRange, type BatesConfig, type BatesPosition, type PdfAnnotation, type PdfDecorations } from "./model";
import { usePdfStore } from "./store";

// ---------------------------------------------------------------------------
export function AnnotationDialog({ annotation, onClose }: { annotation: PdfAnnotation | null; onClose: () => void }) {
  const store = usePdfStore;
  const [text, setText] = React.useState("");
  const [href, setHref] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [color, setColor] = React.useState("#FACC15");
  const [opacity, setOpacity] = React.useState(1);
  const [fontSize, setFontSize] = React.useState(11);
  React.useEffect(() => { if (annotation) { setText(annotation.text ?? ""); setHref(annotation.href ?? ""); setReason(annotation.reason ?? ""); setColor(annotation.color); setOpacity(annotation.opacity); setFontSize(annotation.fontSize ?? 11); } }, [annotation]);
  if (!annotation) return null;
  const a = annotation;
  const save = () => { store.getState().updateAnnotation(a.id, { text: text || undefined, href: a.type === "link" ? (href || undefined) : a.href, reason: a.type === "redaction" ? (reason || undefined) : a.reason, color, opacity, fontSize: a.type === "text" ? fontSize : a.fontSize }); onClose(); };
  const hasText = ["note", "text", "stamp", "highlight", "underline", "strikeout", "rect", "ellipse", "freehand", "link", "signature"].includes(a.type);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>{ANNOTATION_LABEL[a.type]}</DialogTitle><DialogDescription>{a.author} · {new Date(a.createdAt).toLocaleString()}{a.quote ? ` · “${a.quote.slice(0, 80)}${a.quote.length > 80 ? "…" : ""}”` : ""}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {hasText && <div><Label className="text-xs">{a.type === "note" ? "Note" : a.type === "text" ? "Text" : a.type === "stamp" ? "Stamp text" : "Comment"}</Label><Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} className="mt-1 min-h-[80px] text-sm" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save(); }} /></div>}
          {a.type === "link" && <div><Label className="text-xs">URL</Label><Input value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://" className="mt-1 h-8 text-sm" /></div>}
          {a.type === "redaction" && <div><Label className="text-xs">Reason / exemption</Label><Select value={reason || "__none"} onValueChange={(v) => setReason(v === "__none" ? "" : v)}><SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">None</SelectItem>{REDACTION_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>}
          {a.type === "text" && <div><Label className="text-xs">Font size · {fontSize}pt</Label><Slider value={[fontSize]} min={6} max={36} step={1} onValueChange={([v]) => setFontSize(v)} className="mt-2" /></div>}
          {a.type !== "redaction" && a.type !== "signature" && (
            <div><Label className="text-xs">Color</Label><div className="mt-1 flex flex-wrap gap-1.5">{ANNOTATION_COLORS.map((c) => <button key={c.id} type="button" aria-pressed={color === c.hex} onClick={() => setColor(c.hex)} className={cn("size-6 rounded-full border border-black/15 cursor-pointer", color.toLowerCase() === c.hex.toLowerCase() && "ring-2 ring-ring ring-offset-1 ring-offset-background")} style={{ background: c.hex }} aria-label={c.label} />)}</div></div>
          )}
          {a.type !== "redaction" && <div><Label className="text-xs">Opacity · {Math.round(opacity * 100)}%</Label><Slider value={[opacity]} min={0.1} max={1} step={0.05} onValueChange={([v]) => setOpacity(v)} className="mt-2" /></div>}
        </div>
        <DialogFooter className="mt-2 sm:justify-between">
          <Button variant="ghost" className="text-destructive" onClick={() => { store.getState().removeAnnotations([a.id]); onClose(); }}>Delete</Button>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
const POSITIONS: { id: BatesPosition; label: string }[] = [{ id: "bottom-right", label: "Bottom right" }, { id: "bottom-center", label: "Bottom center" }, { id: "bottom-left", label: "Bottom left" }, { id: "top-right", label: "Top right" }, { id: "top-center", label: "Top center" }, { id: "top-left", label: "Top left" }];

export function BatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const model = usePdfStore((s) => s.model);
  const store = usePdfStore;
  const cur = model.bates;
  const [prefix, setPrefix] = React.useState("MFC-");
  const [start, setStart] = React.useState("60000");
  const [digits, setDigits] = React.useState("7");
  const [position, setPosition] = React.useState<BatesPosition>("bottom-right");
  const [fontSize, setFontSize] = React.useState("9");
  const [legend, setLegend] = React.useState("CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER");
  const [useLegend, setUseLegend] = React.useState(true);
  React.useEffect(() => { if (open && cur) { setPrefix(cur.prefix); setStart(String(cur.start)); setDigits(String(cur.digits)); setPosition(cur.position); setFontSize(String(cur.fontSize ?? 9)); setLegend(cur.legend ?? ""); setUseLegend(Boolean(cur.legend)); } }, [open, cur]);
  const n = activePages(model).length;
  const cfg: BatesConfig = { prefix, start: Math.max(0, Number(start) || 0), digits: Math.max(1, Math.min(12, Number(digits) || 1)), position, fontSize: Number(fontSize) || 9, legend: useLegend ? legend.trim() || undefined : undefined };
  const apply = () => { store.getState().applyOp({ op: "set_bates", bates: cfg }); onOpenChange(false); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Stamp className="size-4" /> Bates stamping</DialogTitle><DialogDescription>Numbers run consecutively over the {n} active page{n === 1 ? "" : "s"} in display order. They are drawn on export and when you apply edits to the source.{cur?.applied ? " This document already carries burned-in Bates numbers." : ""}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div><Label className="text-xs">Prefix</Label><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="mt-1 h-8 font-mono text-sm" /></div>
          <div><Label className="text-xs">Start number</Label><Input value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" className="mt-1 h-8 font-mono text-sm" /></div>
          <div><Label className="text-xs">Digits</Label><Input value={digits} onChange={(e) => setDigits(e.target.value)} inputMode="numeric" className="mt-1 h-8 font-mono text-sm" /></div>
          <div className="col-span-2"><Label className="text-xs">Position</Label><Select value={position} onValueChange={(v) => setPosition(v as BatesPosition)}><SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger><SelectContent>{POSITIONS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Font size</Label><Input value={fontSize} onChange={(e) => setFontSize(e.target.value)} inputMode="numeric" className="mt-1 h-8 text-sm" /></div>
          <div className="col-span-3"><label className="flex items-center gap-2 text-xs"><Checkbox checked={useLegend} onCheckedChange={(v) => setUseLegend(Boolean(v))} /> Confidentiality legend (opposite corner)</label>{useLegend && <Input value={legend} onChange={(e) => setLegend(e.target.value)} className="mt-1 h-8 text-sm" />}</div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3 text-xs">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Preview</div>
          <div className="relative h-24 rounded border bg-paper">
            <span className={cn("absolute font-mono", position.startsWith("top") ? "top-2" : "bottom-2", position.endsWith("left") ? "left-3" : position.endsWith("right") ? "right-3" : "left-1/2 -translate-x-1/2")} style={{ fontSize: Math.max(8, cfg.fontSize ?? 9) }}>{formatBates(cfg, 0)}</span>
            {cfg.legend && <span className={cn("absolute max-w-[60%] truncate text-[8px] text-muted-foreground", position.startsWith("top") ? "bottom-2" : "bottom-2", position.endsWith("right") ? "left-3" : "right-3")}>{cfg.legend}</span>}
          </div>
          <div className="mt-2 flex justify-between tabular text-muted-foreground"><span>First: <b className="font-mono text-foreground">{formatBates(cfg, 0)}</b></span><span>Last: <b className="font-mono text-foreground">{formatBates(cfg, Math.max(0, n - 1))}</b></span></div>
        </div>
        <DialogFooter className="sm:justify-between">
          {cur ? <Button variant="ghost" className="text-destructive" onClick={() => { store.getState().applyOp({ op: "set_bates", bates: null }); onOpenChange(false); }}>Remove numbering</Button> : <span />}
          <div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={apply} disabled={!prefix && !start}>Apply to {n} pages</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export function DecorationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const model = usePdfStore((s) => s.model);
  const store = usePdfStore;
  const d = model.decorations ?? {};
  const [header, setHeader] = React.useState("");
  const [headerPos, setHeaderPos] = React.useState<"top-left" | "top-center" | "top-right">("top-center");
  const [footer, setFooter] = React.useState("");
  const [footerPos, setFooterPos] = React.useState<"bottom-left" | "bottom-center" | "bottom-right">("bottom-center");
  const [numbers, setNumbers] = React.useState(false);
  const [numFormat, setNumFormat] = React.useState("Page {page} of {pages}");
  const [numPos, setNumPos] = React.useState<BatesPosition>("bottom-center");
  const [watermark, setWatermark] = React.useState("");
  const [wmOpacity, setWmOpacity] = React.useState(0.15);
  React.useEffect(() => { if (open) { setHeader(d.header?.text ?? ""); setHeaderPos(d.header?.position ?? "top-center"); setFooter(d.footer?.text ?? ""); setFooterPos(d.footer?.position ?? "bottom-center"); setNumbers(Boolean(d.pageNumbers)); setNumFormat(d.pageNumbers?.format ?? "Page {page} of {pages}"); setNumPos(d.pageNumbers?.position ?? "bottom-center"); setWatermark(d.watermark?.text ?? ""); setWmOpacity(d.watermark?.opacity ?? 0.15); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const apply = () => {
    const next: PdfDecorations = {};
    if (header.trim()) next.header = { text: header.trim(), position: headerPos };
    if (footer.trim()) next.footer = { text: footer.trim(), position: footerPos };
    if (numbers) next.pageNumbers = { format: numFormat || "Page {page} of {pages}", position: numPos };
    if (watermark.trim()) next.watermark = { text: watermark.trim(), opacity: wmOpacity };
    store.getState().applyOp({ op: "set_decorations", decorations: Object.keys(next).length ? next : null });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Header, footer, page numbers & watermark</DialogTitle><DialogDescription>Drawn on every active page at export. Placeholders: {"{page}"}, {"{pages}"}, {"{date}"}.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_140px] gap-2"><div><Label className="text-xs">Header</Label><Input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="e.g. PRIVILEGED & CONFIDENTIAL — ATTORNEY WORK PRODUCT" className="mt-1 h-8 text-sm" /></div><div><Label className="text-xs">Position</Label><Select value={headerPos} onValueChange={(v) => setHeaderPos(v as typeof headerPos)}><SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="top-left">Top left</SelectItem><SelectItem value="top-center">Top center</SelectItem><SelectItem value="top-right">Top right</SelectItem></SelectContent></Select></div></div>
          <div className="grid grid-cols-[1fr_140px] gap-2"><div><Label className="text-xs">Footer</Label><Input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="e.g. Produced {date} — Calloway & Reyes LLP" className="mt-1 h-8 text-sm" /></div><div><Label className="text-xs">Position</Label><Select value={footerPos} onValueChange={(v) => setFooterPos(v as typeof footerPos)}><SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bottom-left">Bottom left</SelectItem><SelectItem value="bottom-center">Bottom center</SelectItem><SelectItem value="bottom-right">Bottom right</SelectItem></SelectContent></Select></div></div>
          <div className="rounded-md border p-2"><label className="flex items-center gap-2 text-xs font-medium"><Checkbox checked={numbers} onCheckedChange={(v) => setNumbers(Boolean(v))} /> Page numbers</label>{numbers && <div className="mt-2 grid grid-cols-[1fr_140px] gap-2"><Input value={numFormat} onChange={(e) => setNumFormat(e.target.value)} className="h-8 text-sm" /><Select value={numPos} onValueChange={(v) => setNumPos(v as BatesPosition)}><SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger><SelectContent>{POSITIONS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent></Select></div>}</div>
          <div className="grid grid-cols-[1fr_140px] gap-2 items-end"><div><Label className="text-xs">Watermark</Label><Input value={watermark} onChange={(e) => setWatermark(e.target.value)} placeholder="DRAFT · CONFIDENTIAL · COPY" className="mt-1 h-8 text-sm" /></div><div><Label className="text-xs">Opacity · {Math.round(wmOpacity * 100)}%</Label><Slider value={[wmOpacity]} min={0.05} max={0.6} step={0.05} onValueChange={([v]) => setWmOpacity(v)} className="mt-3" /></div></div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => { store.getState().applyOp({ op: "set_decorations", decorations: null }); onOpenChange(false); }} disabled={!model.decorations}>Clear all</Button>
          <div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={apply}>Apply</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export function MergeDialog({ open, onOpenChange, onMerge }: { open: boolean; onOpenChange: (v: boolean) => void; onMerge: (files: File[]) => Promise<void> }) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (!open) setFiles([]); }, [open]);
  const pick = (list: FileList | null) => { if (!list) return; setFiles((f) => [...f, ...Array.from(list).filter((x) => /\.pdf$/i.test(x.name))]); };
  const go = async () => { setBusy(true); try { await onMerge(files); onOpenChange(false); } finally { setBusy(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Merge className="size-4" /> Merge PDFs</DialogTitle><DialogDescription>Pages of the selected files are appended after the current last page. Reorder them in the thumbnail rail afterwards.</DialogDescription></DialogHeader>
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }} onClick={() => inputRef.current?.click()} className={cn("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground transition-colors hover:bg-accent/40", drag && "border-primary bg-primary/5")}>
          <Upload className="size-5" /><span>Drop PDFs here or click to choose</span>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        </div>
        {files.length > 0 && <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">{files.map((f, i) => <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded border px-2 py-1"><span className="truncate">{f.name}</span><span className="ml-2 shrink-0 tabular text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span></li>)}</ul>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void go()} disabled={!files.length || busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Merge className="size-4" />} Append {files.length || ""} file{files.length === 1 ? "" : "s"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export function SplitDialog({ open, onOpenChange, initialPages, onSplit }: { open: boolean; onOpenChange: (v: boolean) => void; initialPages?: number[]; onSplit: (pages: number[], title: string) => Promise<void> }) {
  const model = usePdfStore((s) => s.model);
  const n = activePages(model).length;
  const [range, setRange] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setRange(initialPages?.length ? compactRange(initialPages) : `1-${n}`); setTitle(""); } }, [open, initialPages, n]);
  const pages = parsePageRange(range, n);
  const go = async () => { setBusy(true); try { await onSplit(pages, title); onOpenChange(false); } finally { setBusy(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Scissors className="size-4" /> Extract pages to a new PDF</DialogTitle><DialogDescription>Creates a separate document in the library; this document is unchanged. Annotations on the extracted pages are carried over.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Pages (of {n})</Label><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="e.g. 1-3, 7, 9-12" className="mt-1 h-8 font-mono text-sm" /><div className="mt-1 text-[11px] text-muted-foreground">{pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"}: ${compactRange(pages)}` : "No valid pages"}</div></div>
          <div><Label className="text-xs">Title (optional)</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to “<title> — pages a–b”" className="mt-1 h-8 text-sm" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void go()} disabled={!pages.length || busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />} Extract</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function compactRange(pages: number[]): string {
  const s = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i])); i = j + 1; }
  return out.join(", ");
}

// ---------------------------------------------------------------------------
export function SignatureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = usePdfStore;
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const [empty, setEmpty] = React.useState(true);
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => { if (open) { setEmpty(true); setTyped(""); setTimeout(() => { const c = canvasRef.current; const ctx = c?.getContext("2d"); if (c && ctx) { ctx.clearRect(0, 0, c.width, c.height); } }, 0); } }, [open]);
  const pos = (e: React.PointerEvent) => { const c = canvasRef.current!; const b = c.getBoundingClientRect(); return { x: (e.clientX - b.left) * (c.width / b.width), y: (e.clientY - b.top) * (c.height / b.height) }; };
  const down = (e: React.PointerEvent) => { const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return; drawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a2340"; (e.currentTarget as Element).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setEmpty(false); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; const ctx = c?.getContext("2d"); if (c && ctx) ctx.clearRect(0, 0, c.width, c.height); setEmpty(true); };
  const typeIt = (v: string) => { setTyped(v); const c = canvasRef.current; const ctx = c?.getContext("2d"); if (!c || !ctx) return; ctx.clearRect(0, 0, c.width, c.height); if (!v.trim()) { setEmpty(true); return; } ctx.fillStyle = "#1a2340"; ctx.font = "italic 64px 'Segoe Script', 'Brush Script MT', 'Apple Chancery', cursive"; ctx.textBaseline = "middle"; ctx.fillText(v, 24, c.height / 2); setEmpty(false); };
  const use = () => { const c = canvasRef.current; if (!c) return; const url = c.toDataURL("image/png"); store.getState().setPrefs({ signatureDataUrl: url }); store.getState().setTool("signature"); onOpenChange(false); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Signature className="size-4" /> Signature</DialogTitle><DialogDescription>Draw with the mouse or trackpad (or type a name), then click on the page to place it. Placed signatures are images and are flattened into the PDF on export.</DialogDescription></DialogHeader>
        <canvas ref={canvasRef} width={720} height={220} className="w-full touch-none rounded-md border bg-white" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Signature pad" />
        <div className="flex items-center gap-2"><Input value={typed} onChange={(e) => typeIt(e.target.value)} placeholder="…or type a name" className="h-8 text-sm" /><Button variant="outline" size="sm" onClick={clear}>Clear</Button></div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={use} disabled={empty}>Use signature</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export function CustomStampDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = usePdfStore;
  const [text, setText] = React.useState("");
  React.useEffect(() => { if (open) setText(""); }, [open]);
  const go = () => { if (!text.trim()) return; store.getState().setPrefs({ stampText: text.trim().toUpperCase() }); store.getState().setTool("stamp"); onOpenChange(false); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Custom stamp</DialogTitle><DialogDescription>Then click where the stamp should go. Stamps are drawn in red block capitals with a border.</DialogDescription></DialogHeader>
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="EXHIBIT 14 · PLAINTIFF'S EXHIBIT 7 · RECEIVED SEP 24 2026" className="h-9 font-mono uppercase" onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={go} disabled={!text.trim()}>Use stamp</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export interface ApplyOptions { applyRedactions: boolean; flattenAnnotations: boolean; flattenForms: boolean; bates: boolean; rasterize: boolean }

export function ApplyDialog({ open, onOpenChange, onApply, progress }: { open: boolean; onOpenChange: (v: boolean) => void; onApply: (o: ApplyOptions) => Promise<void>; progress: string | null }) {
  const model = usePdfStore((s) => s.model);
  const redactions = model.annotations.filter((a) => a.type === "redaction" && !a.applied).length;
  const markups = model.annotations.filter((a) => a.type !== "redaction").length;
  const [o, setO] = React.useState<ApplyOptions>({ applyRedactions: true, flattenAnnotations: true, flattenForms: false, bates: true, rasterize: true });
  const [busy, setBusy] = React.useState(false);
  const go = async () => { setBusy(true); try { await onApply(o); onOpenChange(false); } finally { setBusy(false); } };
  const pageOps = model.pages.some((p) => p.deleted || p.rotation || p.blank);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Flame className="size-4" /> Apply edits to the source PDF</DialogTitle><DialogDescription>Bakes the current edits into a new source file and starts a fresh editing session on it. The previous source is kept in version history.</DialogDescription></DialogHeader>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2 rounded-md border p-2"><Checkbox checked={o.applyRedactions} onCheckedChange={(v) => setO({ ...o, applyRedactions: Boolean(v) })} className="mt-0.5" /><div><div className="font-medium">Apply {redactions} redaction{redactions === 1 ? "" : "s"}</div><div className="text-xs text-muted-foreground">Draws black boxes and, with rasterization, replaces each redacted page with an image so the underlying text and objects are removed from the file.</div>{o.applyRedactions && <label className="mt-1.5 flex items-center gap-2 text-xs"><Checkbox checked={o.rasterize} onCheckedChange={(v) => setO({ ...o, rasterize: Boolean(v) })} /> Rasterize redacted pages (true content removal; page becomes an image, text search is lost on those pages)</label>}{o.applyRedactions && !o.rasterize && <div className="mt-1 flex items-center gap-1 text-xs text-warning-foreground dark:text-warning"><AlertTriangle className="size-3" /> Without rasterization the text remains in the file under the box.</div>}</div></label>
          <label className="flex items-start gap-2 rounded-md border p-2"><Checkbox checked={o.flattenAnnotations} onCheckedChange={(v) => setO({ ...o, flattenAnnotations: Boolean(v) })} className="mt-0.5" /><div><div className="font-medium">Flatten {markups} markup{markups === 1 ? "" : "s"} and stamps</div><div className="text-xs text-muted-foreground">Highlights, shapes, stamps, text boxes and signatures become page content. Unchecked: they are written as native PDF annotations (editable in Acrobat). Sticky notes are always kept as native comments.</div></div></label>
          <label className="flex items-start gap-2 rounded-md border p-2"><Checkbox checked={o.bates} onCheckedChange={(v) => setO({ ...o, bates: Boolean(v) })} disabled={!model.bates || model.bates.applied} className="mt-0.5" /><div><div className="font-medium">Burn Bates numbers{model.bates ? ` (${formatBates(model.bates, 0)}…)` : ""}</div><div className="text-xs text-muted-foreground">{model.bates ? model.bates.applied ? "Already applied to this source." : "Numbers become part of each page." : "No Bates configuration — use Pages → Bates stamping first."}</div></div></label>
          <label className="flex items-start gap-2 rounded-md border p-2"><Checkbox checked={o.flattenForms} onCheckedChange={(v) => setO({ ...o, flattenForms: Boolean(v) })} disabled={!model.meta.hasForm} className="mt-0.5" /><div><div className="font-medium">Fill and flatten form fields</div><div className="text-xs text-muted-foreground">{model.meta.hasForm ? "Field values are written and the fields become static text." : "This document has no form."}</div></div></label>
          {pageOps && <div className="text-xs text-muted-foreground">Page rotations, deletions, reordering and inserted blank pages are always applied.</div>}
        </div>
        {progress && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {progress}</div>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button onClick={() => void go()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />} Apply to source</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
const SHORTCUTS: [string, string][] = [
  ["V / H", "Select · Pan"], ["1 / 2 / 3", "Highlight · Underline · Strikeout (select text first)"], ["N / T", "Sticky note · Text box"], ["R / E / P", "Rectangle · Ellipse · Pen"], ["X / L / S", "Redaction · Link · Signature"], ["Esc", "Back to Select, clear selection"],
  ["⌘F", "Search"], ["Enter / ⇧Enter", "Next / previous hit"], ["← / → · PgUp / PgDn", "Previous / next page"], ["Home / End", "First / last page"], ["⌘= / ⌘−", "Zoom in / out"], ["⌘0 / ⌘9", "Fit width / fit page"], ["⌘R", "Rotate current page"], ["⌘I", "Invert page colors"],
  ["⌘Z / ⌘⇧Z", "Undo / redo"], ["Delete", "Delete selected annotation"], ["⌘S", "Save"], ["⌘/", "Toggle assistant"], ["⌘⇧M", "Comments"], ["⌘B", "Bates stamping"], ["?", "This help"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
        <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-xs">{SHORTCUTS.map(([k, v]) => <React.Fragment key={k}><dt><kbd>{k}</kbd></dt><dd className="text-muted-foreground">{v}</dd></React.Fragment>)}</dl>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export interface PromptRequest { title: string; description?: string; placeholder?: string; defaultValue?: string; multiline?: boolean; confirm?: string }
export function PromptDialog({ request, onSubmit, onCancel }: { request: PromptRequest | null; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = React.useState("");
  React.useEffect(() => { setV(request?.defaultValue ?? ""); }, [request]);
  if (!request) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>{request.title}</DialogTitle>{request.description && <DialogDescription>{request.description}</DialogDescription>}</DialogHeader>
        {request.multiline ? <Textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={request.placeholder} className="min-h-[90px] text-sm" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit(v); }} /> : <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={request.placeholder} className="h-9" onKeyDown={(e) => { if (e.key === "Enter") onSubmit(v); }} />}
        <DialogFooter><Button variant="outline" onClick={onCancel}>Cancel</Button><Button onClick={() => onSubmit(v)} disabled={!v.trim()}>{request.confirm ?? "OK"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
