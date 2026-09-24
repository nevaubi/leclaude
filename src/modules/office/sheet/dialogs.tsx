"use client";
import * as React from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowDown, ArrowUp, Bookmark, Loader2, RotateCcw, Sparkles, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OfficeVersion } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { colToLetter, letterToCol, normalizeRange, parseRange, rangeToA1, toA1 } from "./a1";
import { cellValueOf } from "./cell-render";
import { currentRegion, type CellStyle, type CFRule, type ChartType, type SheetChart } from "./model";
import { useSheetStore } from "./store";

const CF_PRESETS: { id: string; label: string; style: CellStyle }[] = [
  { id: "red", label: "Light red fill, dark red text", style: { fill: "#FDE2E1", color: "#9F1239" } },
  { id: "yellow", label: "Yellow fill, dark amber text", style: { fill: "#FEF3C7", color: "#92400E" } },
  { id: "green", label: "Green fill, dark green text", style: { fill: "#DCFCE7", color: "#166534" } },
  { id: "blue", label: "Blue fill, navy text", style: { fill: "#DBEAFE", color: "#1E3A8A" } },
  { id: "bold", label: "Bold red text", style: { bold: true, color: "#9F1239" } },
  { id: "muted", label: "Grey text", style: { color: "#6B7280" } },
];

const RULE_KINDS: { id: CFRule["kind"]; label: string }[] = [
  { id: "gt", label: "Greater than" }, { id: "lt", label: "Less than" }, { id: "between", label: "Between" }, { id: "eq", label: "Equal to" }, { id: "contains", label: "Text contains" }, { id: "dueBefore", label: "Date is before" }, { id: "top", label: "Top N values" }, { id: "blank", label: "Is blank" }, { id: "duplicate", label: "Duplicate values" },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}{hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}</div>;
}

const selectCls = "h-8 w-full rounded-md border bg-background px-2 text-xs";

function useDefaultRange() {
  const store = useSheetStore;
  return React.useCallback(() => {
    const st = store.getState();
    const sheet = st.activeSheet();
    let r = st.selectionRange();
    if (r.start.row === r.end.row && r.start.col === r.end.col) r = currentRegion(sheet, r.start.row, r.start.col);
    return rangeToA1(r);
  }, [store]);
}

// ------------------------------------------------------------------ conditional formatting
export function ConditionalFormatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = useSheetStore;
  const workbook = useSheetStore((s) => s.workbook);
  const sheet = workbook.sheets[workbook.activeSheet];
  const defaultRange = useDefaultRange();
  const [range, setRange] = React.useState("");
  const [kind, setKind] = React.useState<CFRule["kind"]>("gt");
  const [v1, setV1] = React.useState("");
  const [v2, setV2] = React.useState("");
  const [preset, setPreset] = React.useState("red");
  React.useEffect(() => { if (open) { setRange(defaultRange()); setV1(""); setV2(""); } }, [open, defaultRange]);
  const add = () => {
    let rule: CFRule;
    switch (kind) {
      case "gt": rule = { kind, value: Number(v1) }; break;
      case "lt": rule = { kind, value: Number(v1) }; break;
      case "between": rule = { kind, min: Number(v1), max: Number(v2) }; break;
      case "eq": rule = { kind, value: Number.isFinite(Number(v1)) && v1.trim() !== "" ? Number(v1) : v1 }; break;
      case "contains": rule = { kind, text: v1 }; break;
      case "dueBefore": rule = { kind, date: v1.trim() || "today", days: v2 ? Number(v2) : undefined }; break;
      case "top": rule = { kind, count: Number(v1) || 10 }; break;
      default: rule = { kind } as CFRule;
    }
    try { store.getState().apply({ type: "conditional_format", sheet: sheet.id, range, rule, style: CF_PRESETS.find((p) => p.id === preset)!.style }); toast.success("Conditional format added"); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Conditional formatting</DialogTitle><DialogDescription>Highlight cells in a range when a rule matches. Rules are evaluated live on computed values.</DialogDescription></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Apply to range"><Input value={range} onChange={(e) => setRange(e.target.value)} className="h-8 font-mono text-xs" /></Field>
          <Field label="Rule"><select value={kind} onChange={(e) => setKind(e.target.value as CFRule["kind"])} className={selectCls}>{RULE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
          {["gt", "lt", "eq", "contains", "top"].includes(kind) && <Field label={kind === "contains" ? "Text" : kind === "top" ? "N" : "Value"}><Input value={v1} onChange={(e) => setV1(e.target.value)} className="h-8 text-xs" /></Field>}
          {kind === "between" && <><Field label="Min"><Input value={v1} onChange={(e) => setV1(e.target.value)} className="h-8 text-xs" /></Field><Field label="Max"><Input value={v2} onChange={(e) => setV2(e.target.value)} className="h-8 text-xs" /></Field></>}
          {kind === "dueBefore" && <><Field label="Date" hint="yyyy-mm-dd or 'today'"><Input value={v1} onChange={(e) => setV1(e.target.value)} placeholder="today" className="h-8 text-xs" /></Field><Field label="Offset days" hint="e.g. 7 highlights dates before today + 7"><Input value={v2} onChange={(e) => setV2(e.target.value)} className="h-8 text-xs" /></Field></>}
          <Field label="Style"><select value={preset} onChange={(e) => setPreset(e.target.value)} className={selectCls}>{CF_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
          <div className="flex items-end"><Button size="sm" onClick={add}>Add rule</Button></div>
        </div>
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Rules on {sheet.name} · {sheet.conditionalFormats.length}</div>
          {sheet.conditionalFormats.length === 0 ? <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No rules yet</div> : (
            <ul className="divide-y rounded-md border text-xs">
              {sheet.conditionalFormats.map((cf) => (
                <li key={cf.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="size-4 rounded border" style={{ background: cf.style.fill ?? "transparent" }} />
                  <span className="font-mono">{cf.range}</span>
                  <span className="text-muted-foreground">{RULE_KINDS.find((k) => k.id === cf.rule.kind)?.label} {"value" in cf.rule ? String(cf.rule.value) : "text" in cf.rule ? cf.rule.text : "min" in cf.rule ? `${cf.rule.min}–${cf.rule.max}` : "date" in cf.rule ? cf.rule.date : "count" in cf.rule ? cf.rule.count : ""}</span>
                  <button onClick={() => store.getState().apply({ type: "remove_conditional_format", sheet: sheet.id, id: cf.id })} className="ml-auto rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer" aria-label="Remove rule"><Trash2 className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ find & replace
export function FindReplaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = useSheetStore;
  const workbook = useSheetStore((s) => s.workbook);
  const computed = useSheetStore((s) => s.computed);
  const [q, setQ] = React.useState("");
  const [rep, setRep] = React.useState("");
  const [matchCase, setMatchCase] = React.useState(false);
  const [inFormulas, setInFormulas] = React.useState(false);
  const [allSheets, setAllSheets] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const matches = React.useMemo(() => {
    if (!q) return [] as { sheetIdx: number; ref: string; text: string }[];
    const out: { sheetIdx: number; ref: string; text: string }[] = [];
    const needle = matchCase ? q : q.toLowerCase();
    workbook.sheets.forEach((s, si) => {
      if (!allSheets && si !== workbook.activeSheet) return;
      for (const [ref, cell] of Object.entries(s.cells)) {
        const hay = inFormulas && cell.f ? cell.f : String(cellValueOf(s, ref, computed) ?? "");
        if ((matchCase ? hay : hay.toLowerCase()).includes(needle)) out.push({ sheetIdx: si, ref, text: hay });
      }
    });
    return out.sort((a, b) => a.sheetIdx - b.sheetIdx || a.ref.length - b.ref.length || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }, [q, matchCase, inFormulas, allSheets, workbook, computed]);
  React.useEffect(() => setIdx(0), [q, matches.length]);
  const go = (i: number) => {
    if (!matches.length) return;
    const m = matches[((i % matches.length) + matches.length) % matches.length];
    setIdx(((i % matches.length) + matches.length) % matches.length);
    const st = store.getState();
    st.setActiveSheet(m.sheetIdx);
    const p = /^([A-Z]+)(\d+)$/.exec(m.ref)!;
    st.selectCell(Number(p[2]) - 1, letterToCol(p[1]));
  };
  const replace = (all: boolean) => {
    const st = store.getState();
    const targets = all ? matches : matches.slice(idx, idx + 1);
    const bySheet = new Map<number, { ref: string; value?: string; formula?: string }[]>();
    for (const m of targets) {
      const s = workbook.sheets[m.sheetIdx];
      const cell = s.cells[m.ref];
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi");
      const list = bySheet.get(m.sheetIdx) ?? [];
      if (cell.f && inFormulas) list.push({ ref: m.ref, formula: cell.f.replace(re, rep) });
      else if (!cell.f) list.push({ ref: m.ref, value: String(cell.v ?? "").replace(re, rep) });
      bySheet.set(m.sheetIdx, list);
    }
    const ops = Array.from(bySheet.entries()).map(([si, cells]) => ({ type: "set_cells" as const, sheet: workbook.sheets[si].id, cells, parse: true }));
    if (!ops.length) return;
    st.apply(ops.length === 1 ? ops[0] : { type: "batch", ops });
    toast.success(`Replaced ${targets.length} occurrence${targets.length === 1 ? "" : "s"}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Find & replace</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Find"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(e.shiftKey ? idx - 1 : idx + 1); }} className="h-8 text-xs" placeholder="Text or number" /></Field>
          <Field label="Replace with"><Input value={rep} onChange={(e) => setRep(e.target.value)} className="h-8 text-xs" /></Field>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer"><Checkbox checked={matchCase} onCheckedChange={(c) => setMatchCase(Boolean(c))} /> Match case</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><Checkbox checked={inFormulas} onCheckedChange={(c) => setInFormulas(Boolean(c))} /> Search formulas</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><Checkbox checked={allSheets} onCheckedChange={(c) => setAllSheets(Boolean(c))} /> All sheets</label>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{matches.length ? `${idx + 1} of ${matches.length}` : q ? "No matches" : "Type to search"}</span>
            <div className="ml-auto flex gap-1"><Button size="xs" variant="outline" onClick={() => go(idx - 1)} disabled={!matches.length}><ArrowUp className="size-3" /></Button><Button size="xs" variant="outline" onClick={() => go(idx + 1)} disabled={!matches.length}><ArrowDown className="size-3" /></Button></div>
          </div>
          {matches.length > 0 && <ul className="max-h-40 divide-y overflow-auto rounded-md border text-xs scrollbar-thin">{matches.slice(0, 200).map((m, i) => <li key={`${m.sheetIdx}-${m.ref}`}><button onClick={() => go(i)} className={cn("flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent cursor-pointer", i === idx && "bg-accent")}><span className="font-mono text-muted-foreground">{workbook.sheets[m.sheetIdx].name}!{m.ref}</span><span className="truncate">{m.text}</span></button></li>)}</ul>}
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={() => replace(false)} disabled={!matches.length}>Replace</Button><Button size="sm" onClick={() => replace(true)} disabled={!matches.length}>Replace all</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ named ranges
export function NamedRangesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = useSheetStore;
  const workbook = useSheetStore((s) => s.workbook);
  const defaultRange = useDefaultRange();
  const [name, setName] = React.useState("");
  const [ref, setRef] = React.useState("");
  React.useEffect(() => { if (open) { const sheet = store.getState().activeSheet(); setRef(`${sheet.name}!${defaultRange()}`); setName(""); } }, [open, defaultRange, store]);
  const add = () => { try { store.getState().apply({ type: "add_named_range", name, ref }); setName(""); toast.success(`Named ${ref} as ${name}`); } catch (e) { toast.error((e as Error).message); } };
  const goTo = (r: string) => { const st = store.getState(); const bang = r.indexOf("!"); if (bang > 0) st.setActiveSheet(r.slice(0, bang).replace(/'/g, "")); try { st.selectRange(normalizeRange(parseRange(r.slice(bang + 1)))); } catch { /* ignore */ } onOpenChange(false); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Named ranges</DialogTitle><DialogDescription>Names make formulas readable (=Gross*FeeRate) and are available to the assistant.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="FeeRate" className="h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></Field>
          <Field label="Refers to"><Input value={ref} onChange={(e) => setRef(e.target.value)} className="h-8 font-mono text-xs" /></Field>
          <Button size="sm" onClick={add} disabled={!name.trim()}>Add</Button>
        </div>
        <ul className="divide-y rounded-md border text-xs">
          {Object.entries(workbook.namedRanges).length === 0 && <li className="p-3 text-center text-muted-foreground">No named ranges</li>}
          {Object.entries(workbook.namedRanges).map(([n, r]) => (
            <li key={n} className="flex items-center gap-2 px-2 py-1.5">
              <button onClick={() => goTo(r)} className="font-medium hover:underline cursor-pointer">{n}</button>
              <span className="font-mono text-muted-foreground">{r}</span>
              <button onClick={() => store.getState().apply({ type: "remove_named_range", name: n })} className="ml-auto rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer" aria-label="Remove"><Trash2 className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ data validation (list)
export function ValidationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = useSheetStore;
  const workbook = useSheetStore((s) => s.workbook);
  const sheet = workbook.sheets[workbook.activeSheet];
  const [range, setRange] = React.useState("");
  const [kind, setKind] = React.useState<"list" | "number" | "date">("list");
  const [list, setList] = React.useState("");
  const [min, setMin] = React.useState("");
  const [max, setMax] = React.useState("");
  React.useEffect(() => { if (open) setRange(store.getState().selectionA1()); }, [open, store]);
  const add = () => {
    try { store.getState().apply({ type: "add_validation", sheet: sheet.id, range, kind, list: kind === "list" ? list.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : undefined, min: min ? Number(min) : undefined, max: max ? Number(max) : undefined }); toast.success("Validation added"); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Data validation</DialogTitle><DialogDescription>Restrict cells to a dropdown list, a number range or dates.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Field label="Range"><Input value={range} onChange={(e) => setRange(e.target.value)} className="h-8 font-mono text-xs" /></Field>
          <Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value as "list")} className={selectCls}><option value="list">List (dropdown)</option><option value="number">Number</option><option value="date">Date</option></select></Field>
          {kind === "list" && <Field label="Items" hint="Comma-separated"><Input value={list} onChange={(e) => setList(e.target.value)} placeholder="Open, In progress, Complete" className="h-8 text-xs" /></Field>}
          {kind === "number" && <div className="grid grid-cols-2 gap-2"><Field label="Min"><Input value={min} onChange={(e) => setMin(e.target.value)} className="h-8 text-xs" /></Field><Field label="Max"><Input value={max} onChange={(e) => setMax(e.target.value)} className="h-8 text-xs" /></Field></div>}
          <div className="flex justify-end"><Button size="sm" onClick={add}>Add</Button></div>
          {(sheet.validations ?? []).length > 0 && <ul className="divide-y rounded-md border text-xs">{(sheet.validations ?? []).map((v) => <li key={v.id} className="flex items-center gap-2 px-2 py-1.5"><span className="font-mono">{v.range}</span><span className="text-muted-foreground">{v.kind}{v.list ? `: ${v.list.join(", ")}` : ""}{v.min != null ? ` ≥ ${v.min}` : ""}{v.max != null ? ` ≤ ${v.max}` : ""}</span><button onClick={() => store.getState().apply({ type: "remove_validation", sheet: sheet.id, id: v.id })} className="ml-auto rounded p-1 text-muted-foreground hover:text-destructive cursor-pointer" aria-label="Remove"><Trash2 className="size-3.5" /></button></li>)}</ul>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ sort
export function SortDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const store = useSheetStore;
  const workbook = useSheetStore((s) => s.workbook);
  const computed = useSheetStore((s) => s.computed);
  const sheet = workbook.sheets[workbook.activeSheet];
  const defaultRange = useDefaultRange();
  const [range, setRange] = React.useState("");
  const [by, setBy] = React.useState("A");
  const [thenBy, setThenBy] = React.useState("");
  const [order, setOrder] = React.useState<"asc" | "desc">("asc");
  const [hasHeader, setHasHeader] = React.useState(true);
  React.useEffect(() => { if (open) { const r = defaultRange(); setRange(r); try { const p = normalizeRange(parseRange(r)); setBy(colToLetter(Math.max(p.start.col, Math.min(p.end.col, store.getState().selection.active.col)))); } catch { /* ignore */ } } }, [open, defaultRange, store]);
  const columns = React.useMemo(() => { try { const p = normalizeRange(parseRange(range)); return Array.from({ length: p.end.col - p.start.col + 1 }, (_, i) => { const c = p.start.col + i; const h = hasHeader ? cellValueOf(sheet, toA1(p.start.row, c), computed) : null; return { letter: colToLetter(c), label: h ? `${colToLetter(c)} — ${String(h)}` : colToLetter(c) }; }); } catch { return []; } }, [range, hasHeader, sheet, computed]);
  const run = () => { try { store.getState().apply({ type: "sort_range", sheet: sheet.id, range, by, then_by: thenBy || undefined, order, has_header: hasHeader }); onOpenChange(false); } catch (e) { toast.error((e as Error).message); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Sort range</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Range"><Input value={range} onChange={(e) => setRange(e.target.value)} className="h-8 font-mono text-xs" /></Field>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer"><Checkbox checked={hasHeader} onCheckedChange={(c) => setHasHeader(Boolean(c))} /> Data has a header row</label>
          <Field label="Sort by"><select value={by} onChange={(e) => setBy(e.target.value)} className={selectCls}>{columns.map((c) => <option key={c.letter} value={c.letter}>{c.label}</option>)}</select></Field>
          <Field label="Then by"><select value={thenBy} onChange={(e) => setThenBy(e.target.value)} className={selectCls}><option value="">—</option>{columns.map((c) => <option key={c.letter} value={c.letter}>{c.label}</option>)}</select></Field>
          <Field label="Order"><select value={order} onChange={(e) => setOrder(e.target.value as "asc")} className={selectCls}><option value="asc">A → Z / smallest first</option><option value="desc">Z → A / largest first</option></select></Field>
        </div>
        <DialogFooter><Button size="sm" onClick={run}>Sort</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ chart
export function ChartDialog({ open, onOpenChange, chartId, initialType }: { open: boolean; onOpenChange: (v: boolean) => void; chartId?: string | null; initialType?: ChartType }) {
  const store = useSheetStore;
  const workbook = useSheetStore((s) => s.workbook);
  const sheet = workbook.sheets[workbook.activeSheet];
  const existing = chartId ? sheet.charts.find((c) => c.id === chartId) : null;
  const defaultRange = useDefaultRange();
  const [type, setType] = React.useState<ChartType>("bar");
  const [title, setTitle] = React.useState("");
  const [range, setRange] = React.useState("");
  const [cats, setCats] = React.useState("");
  const [hasHeader, setHasHeader] = React.useState(true);
  const [stacked, setStacked] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    if (existing) { setType(existing.type); setTitle(existing.title); setRange(existing.range); setCats(existing.categoryRange ?? ""); setHasHeader(existing.hasHeader !== false); setStacked(Boolean(existing.stacked)); return; }
    const r = defaultRange();
    setType(initialType ?? "bar"); setTitle(""); setHasHeader(true); setStacked(false);
    try { const p = normalizeRange(parseRange(r)); if (p.end.col > p.start.col) { setCats(rangeToA1({ start: { row: p.start.row + 1, col: p.start.col }, end: { row: p.end.row, col: p.start.col } })); setRange(rangeToA1({ start: { row: p.start.row, col: p.start.col + 1 }, end: p.end })); } else { setCats(""); setRange(r); } } catch { setRange(r); setCats(""); }
  }, [open, existing, defaultRange, initialType]);
  const save = () => {
    try {
      const st = store.getState();
      if (existing) st.apply({ type: "update_chart", sheet: sheet.id, id: existing.id, patch: { type, title: title || existing.title, range, categoryRange: cats || undefined, hasHeader, stacked } });
      else st.apply({ type: "add_chart", sheet: sheet.id, chart: { type, title: title || `${type[0].toUpperCase()}${type.slice(1)} chart`, range, categoryRange: cats || undefined, hasHeader, stacked } });
      onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>{existing ? "Edit chart" : "Insert chart"}</DialogTitle><DialogDescription>Data range holds the numeric series (header row first); category range holds the labels.</DialogDescription></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value as ChartType)} className={selectCls}>{(["bar", "line", "pie", "area", "scatter"] as ChartType[]).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select></Field>
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" placeholder="Damages by category" /></Field>
          <Field label="Data range"><Input value={range} onChange={(e) => setRange(e.target.value)} className="h-8 font-mono text-xs" /></Field>
          <Field label="Category range"><Input value={cats} onChange={(e) => setCats(e.target.value)} className="h-8 font-mono text-xs" placeholder="A2:A9" /></Field>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer"><Checkbox checked={hasHeader} onCheckedChange={(c) => setHasHeader(Boolean(c))} /> First row of data range is a header</label>
          {(type === "bar" || type === "area") && <label className="flex items-center gap-1.5 text-xs cursor-pointer"><Checkbox checked={stacked} onCheckedChange={(c) => setStacked(Boolean(c))} /> Stacked</label>}
        </div>
        <DialogFooter>{existing && <Button variant="ghost" size="sm" className="mr-auto text-destructive" onClick={() => { store.getState().apply({ type: "remove_chart", sheet: sheet.id, id: existing.id }); onOpenChange(false); }}>Delete chart</Button>}<Button size="sm" onClick={save}>{existing ? "Save" : "Insert"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ versions
export function VersionsDialog({ open, onOpenChange, list, checkpoint, restore }: { open: boolean; onOpenChange: (v: boolean) => void; list: () => Promise<Omit<OfficeVersion, "content">[]>; checkpoint: (label: string) => Promise<boolean>; restore: (id: string) => Promise<unknown> }) {
  const [versions, setVersions] = React.useState<Omit<OfficeVersion, "content">[] | null>(null);
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const reload = React.useCallback(async () => { try { setVersions(await list()); } catch { setVersions([]); } }, [list]);
  React.useEffect(() => { if (open) { setVersions(null); void reload(); } }, [open, reload]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Version history</DialogTitle><DialogDescription>Autosaves every few minutes; agent edits and checkpoints always create a version.</DialogDescription></DialogHeader>
        <div className="flex gap-2"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Checkpoint label, e.g. Before client call" className="h-8 text-xs" /><Button size="sm" disabled={busy !== null} onClick={async () => { setBusy("cp"); await checkpoint(label || "Checkpoint"); setLabel(""); await reload(); setBusy(null); toast.success("Checkpoint saved"); }}><Bookmark className="size-3.5" /> Checkpoint</Button></div>
        {!versions ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <ul className="max-h-[50vh] divide-y overflow-auto rounded-md border text-xs scrollbar-thin">
            {versions.map((v, i) => (
              <li key={v.id} className="flex items-center gap-2 px-2 py-2">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">{v.authorName?.includes("assistant") ? <Sparkles className="size-3 text-primary" /> : <User className="size-3" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5"><span className="font-medium">v{v.version}</span>{v.label && <Badge variant="muted" className="py-0">{v.label}</Badge>}{i === 0 && <Badge variant="info" className="py-0">current</Badge>}</div>
                  <div className="truncate text-muted-foreground">{v.summary} · {v.authorName} · <span title={format(new Date(v.createdAt), "PPpp")}>{formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>{v.changedFields ? ` · ${v.changedFields} changes` : ""}</div>
                </div>
                {i > 0 && <Button size="xs" variant="outline" disabled={busy !== null} onClick={async () => { setBusy(v.id); await restore(v.id); setBusy(null); onOpenChange(false); toast.success(`Restored v${v.version}`); }}>{busy === v.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} Restore</Button>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type { SheetChart };
