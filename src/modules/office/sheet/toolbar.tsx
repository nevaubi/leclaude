"use client";
import * as React from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowUpZA, BarChart3, Bold, ChevronDown, Filter, Grid2x2, Italic, LineChart, MessageSquarePlus, PaintBucket, PieChart, Plus, Redo2, Rows3, Search, Sigma, Snowflake, SquareStack, TableProperties, Type, Underline, Undo2, WrapText, Columns3, Sheet as SheetIcon, Tags, ListChecks, Printer, Percent, DollarSign, Hash, Calendar, Baseline, Braces } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { colToLetter, rangeToA1, toA1 } from "./a1";
import { currentRegion, getStyle, NUMBER_FORMATS, type BorderSpec, type CellStyle, type NumFmt } from "./model";
import { useSheetStore } from "./store";
import { MOD } from "./client-utils";
import { toNumber } from "./format";

export type DialogKind = "conditional" | "find" | "names" | "validation" | "sort" | "chart" | "versions";

export interface ToolbarProps {
  onOpen: (dialog: DialogKind) => void;
  onInsertChart: (type: "bar" | "line" | "pie") => void;
  onAddComment: () => void;
  disabled?: boolean;
}

const FILLS = ["#1F3A5F", "#2F5D8A", "#E8EEF7", "#F7F9FC", "#EEF2F7", "#FFF8E1", "#FEF3C7", "#FDE2E1", "#DCFCE7", "#DBEAFE", "#EDE9FE", "#F3F4F6", "#111827", "#FFFFFF"];
const TEXT_COLORS = ["#111827", "#1F3A5F", "#5B6B85", "#9F1239", "#92400E", "#166534", "#1D4ED8", "#6B21A8", "#FFFFFF"];
const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28];
const BORDERS: { id: BorderSpec; label: string }[] = [{ id: "all", label: "All borders" }, { id: "outline", label: "Outline" }, { id: "bottom", label: "Bottom border" }, { id: "top", label: "Top border" }, { id: "thick", label: "Thick" }, { id: "none", label: "No border" }];

function ToolBtn({ label, shortcut, active, onClick, children, disabled }: { label: string; shortcut?: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-pressed={active} aria-label={label} className={cn("flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1.5 text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default", active ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-accent hover:text-foreground")}>{children}</button>
    </Tip>
  );
}

export function SheetToolbar({ onOpen, onInsertChart, onAddComment, disabled }: ToolbarProps) {
  const workbook = useSheetStore((s) => s.workbook);
  const selection = useSheetStore((s) => s.selection);
  const past = useSheetStore((s) => s.past.length);
  const future = useSheetStore((s) => s.future.length);
  const pageBreaks = useSheetStore((s) => s.pageBreaks);
  const showFormulas = useSheetStore((s) => s.showFormulas);
  const store = useSheetStore;
  const sheet = workbook.sheets[workbook.activeSheet] ?? workbook.sheets[0];
  const activeRef = toA1(selection.active.row, selection.active.col);
  const style: CellStyle = getStyle(workbook, sheet.cells[activeRef]);

  const styleSel = (patch: Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>>) => {
    const st = store.getState();
    st.apply({ type: "batch", ops: st.selection.ranges.map((r) => ({ type: "style_range" as const, sheet: sheet.id, range: rangeToA1(r), style: patch })) });
  };
  const toggle = (k: "bold" | "italic" | "underline" | "wrap") => styleSel({ [k]: style[k] ? null : true });
  const setFmt = (fmt: NumFmt) => styleSel({ numFmt: fmt === "General" ? null : fmt });
  const currentFmt = style.numFmt ?? "General";
  const adjustDecimals = (delta: number) => {
    let fmt = currentFmt === "General" ? "0" : String(currentFmt);
    if (/(yy|mmm|d)/i.test(fmt) && !/[#0]/.test(fmt)) return;
    const m = /([#0,]+)(?:\.(0+))?/.exec(fmt);
    if (!m) return;
    const dec = Math.max(0, Math.min(6, (m[2]?.length ?? 0) + delta));
    fmt = fmt.replace(m[0], `${m[1]}${dec ? `.${"0".repeat(dec)}` : ""}`);
    setFmt(fmt);
  };

  const autosum = () => {
    const st = store.getState();
    const r = st.selectionRange();
    const multi = r.end.row > r.start.row || r.end.col > r.start.col;
    const cells: { ref: string; formula: string }[] = [];
    if (multi) {
      // sum each column of the selection into the row below (or each row to the right for a single row)
      if (r.end.row > r.start.row) for (let c = r.start.col; c <= r.end.col; c++) cells.push({ ref: toA1(r.end.row + 1, c), formula: `=SUM(${toA1(r.start.row, c)}:${toA1(r.end.row, c)})` });
      else cells.push({ ref: toA1(r.start.row, r.end.col + 1), formula: `=SUM(${rangeToA1(r)})` });
    } else {
      // find the numeric run above (or to the left)
      const { row, col } = st.selection.active;
      let top = row - 1;
      while (top >= 0 && toNumber(sheet.cells[toA1(top, col)]?.f ? st.computed[sheet.id]?.[toA1(top, col)]?.v ?? null : sheet.cells[toA1(top, col)]?.v ?? null) !== null) top--;
      if (top < row - 1) cells.push({ ref: toA1(row, col), formula: `=SUM(${toA1(top + 1, col)}:${toA1(row - 1, col)})` });
      else {
        let left = col - 1;
        while (left >= 0 && toNumber(sheet.cells[toA1(row, left)]?.v ?? null) !== null) left--;
        if (left < col - 1) cells.push({ ref: toA1(row, col), formula: `=SUM(${toA1(row, left + 1)}:${toA1(row, col - 1)})` });
        else { st.startEdit({ source: "type", initial: "=SUM(" }); return; }
      }
    }
    st.apply({ type: "set_cells", sheet: sheet.id, cells: cells.map((c) => ({ ref: c.ref, formula: c.formula, style: { bold: true } })) });
  };

  const freeze = (mode: "row" | "col" | "here" | "none") => {
    const st = store.getState();
    const a = st.selection.active;
    const rows = mode === "row" ? 1 : mode === "here" ? a.row : mode === "col" ? sheet.freeze.rows : 0;
    const cols = mode === "col" ? 1 : mode === "here" ? a.col : mode === "row" ? sheet.freeze.cols : 0;
    st.apply({ type: "freeze_panes", sheet: sheet.id, rows, cols });
  };
  const sort = (order: "asc" | "desc") => {
    const st = store.getState();
    let r = st.selectionRange();
    if (r.start.row === r.end.row && r.start.col === r.end.col) r = currentRegion(sheet, r.start.row, r.start.col);
    const c = sheet.cells[toA1(r.start.row, st.selection.active.col)];
    const below = sheet.cells[toA1(r.start.row + 1, st.selection.active.col)];
    const hasHeader = typeof c?.v === "string" && !c.f && Boolean(below) && (typeof below?.v === "number" || Boolean(below?.f) || below?.t === "d");
    st.apply({ type: "sort_range", sheet: sheet.id, range: rangeToA1(r), by: colToLetter(st.selection.active.col), order, has_header: hasHeader });
    st.selectRange(r);
  };
  const filter = () => {
    const st = store.getState();
    if (sheet.filters) { st.apply({ type: "clear_filter", sheet: sheet.id }); return; }
    let r = st.selectionRange();
    if (r.start.row === r.end.row && r.start.col === r.end.col) r = currentRegion(sheet, r.start.row, r.start.col);
    st.apply({ type: "add_filter", sheet: sheet.id, range: rangeToA1(r) });
  };
  const insert = (what: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "sheet") => {
    const st = store.getState();
    const r = st.selectionRange();
    if (what === "sheet") { st.apply({ type: "add_sheet", name: `Sheet${workbook.sheets.length + 1}` }); return; }
    if (what === "rowAbove") st.apply({ type: "insert_rows", sheet: sheet.id, index: r.start.row, count: r.end.row - r.start.row + 1 });
    if (what === "rowBelow") st.apply({ type: "insert_rows", sheet: sheet.id, index: r.end.row + 1, count: r.end.row - r.start.row + 1 });
    if (what === "colLeft") st.apply({ type: "insert_cols", sheet: sheet.id, index: r.start.col, count: r.end.col - r.start.col + 1 });
    if (what === "colRight") st.apply({ type: "insert_cols", sheet: sheet.id, index: r.end.col + 1, count: r.end.col - r.start.col + 1 });
  };
  const merged = sheet.merges.some((m) => m === store.getState().selectionA1());

  return (
    <div className={cn("flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2 scrollbar-none", disabled && "pointer-events-none opacity-60")}>
      <ToolBtn label="Undo" shortcut={`${MOD}Z`} onClick={() => store.getState().undo()} disabled={!past}><Undo2 className="size-3.5" /></ToolBtn>
      <ToolBtn label="Redo" shortcut={`${MOD}Y`} onClick={() => store.getState().redo()} disabled={!future}><Redo2 className="size-3.5" /></ToolBtn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-1 rounded px-1.5 text-xs hover:bg-accent cursor-pointer" aria-label="Font size"><Type className="size-3.5" /><span className="tabular">{style.fontSize ?? 12}</span><ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-24">{FONT_SIZES.map((s) => <DropdownMenuItem key={s} onSelect={() => styleSel({ fontSize: s === 12 ? null : s })} className={cn("tabular", (style.fontSize ?? 12) === s && "bg-accent")}>{s}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <ToolBtn label="Bold" shortcut={`${MOD}B`} active={Boolean(style.bold)} onClick={() => toggle("bold")}><Bold className="size-3.5" /></ToolBtn>
      <ToolBtn label="Italic" shortcut={`${MOD}I`} active={Boolean(style.italic)} onClick={() => toggle("italic")}><Italic className="size-3.5" /></ToolBtn>
      <ToolBtn label="Underline" shortcut={`${MOD}U`} active={Boolean(style.underline)} onClick={() => toggle("underline")}><Underline className="size-3.5" /></ToolBtn>
      <Popover>
        <PopoverTrigger asChild><button onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-0.5 rounded px-1.5 text-xs hover:bg-accent cursor-pointer" aria-label="Text color"><Baseline className="size-3.5" /><span className="h-1 w-3.5 rounded-sm border" style={{ background: style.color ?? "currentColor" }} /></button></PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2"><div className="grid grid-cols-5 gap-1">{TEXT_COLORS.map((c) => <button key={c} onClick={() => styleSel({ color: c })} className="size-6 rounded border hover:scale-110 transition-transform cursor-pointer" style={{ background: c }} aria-label={c} />)}<button onClick={() => styleSel({ color: null })} className="col-span-5 mt-1 rounded border px-2 py-0.5 text-[11px] hover:bg-accent cursor-pointer">Automatic</button></div></PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild><button onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-0.5 rounded px-1.5 text-xs hover:bg-accent cursor-pointer" aria-label="Fill color"><PaintBucket className="size-3.5" /><span className="h-1 w-3.5 rounded-sm border" style={{ background: style.fill ?? "transparent" }} /></button></PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2"><div className="grid grid-cols-7 gap-1">{FILLS.map((c) => <button key={c} onClick={() => styleSel({ fill: c })} className="size-6 rounded border hover:scale-110 transition-transform cursor-pointer" style={{ background: c }} aria-label={c} />)}<button onClick={() => styleSel({ fill: null })} className="col-span-7 mt-1 rounded border px-2 py-0.5 text-[11px] hover:bg-accent cursor-pointer">No fill</button></div></PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-0.5 rounded px-1.5 text-xs hover:bg-accent cursor-pointer" aria-label="Borders"><Grid2x2 className="size-3.5" /><ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">{BORDERS.map((b) => <DropdownMenuItem key={b.id} onSelect={() => styleSel({ border: b.id === "none" ? null : b.id })}>{b.label}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolBtn label="Align left" active={(style.align ?? "left") === "left" && Boolean(style.align)} onClick={() => styleSel({ align: "left" })}><AlignLeft className="size-3.5" /></ToolBtn>
      <ToolBtn label="Align center" active={style.align === "center"} onClick={() => styleSel({ align: "center" })}><AlignCenter className="size-3.5" /></ToolBtn>
      <ToolBtn label="Align right" active={style.align === "right"} onClick={() => styleSel({ align: "right" })}><AlignRight className="size-3.5" /></ToolBtn>
      <ToolBtn label="Wrap text" active={Boolean(style.wrap)} onClick={() => toggle("wrap")}><WrapText className="size-3.5" /></ToolBtn>
      <ToolBtn label={merged ? "Unmerge cells" : "Merge cells"} active={merged} onClick={() => store.getState().apply({ type: merged ? "unmerge_cells" : "merge_cells", sheet: sheet.id, range: store.getState().selectionA1() })}><SquareStack className="size-3.5" /></ToolBtn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button onMouseDown={(e) => e.preventDefault()} className="flex h-7 min-w-[7.5rem] items-center gap-1 rounded border px-2 text-xs hover:bg-accent cursor-pointer" aria-label="Number format"><span className="truncate">{NUMBER_FORMATS.find((f) => f.id === currentFmt)?.label ?? currentFmt}</span><ChevronDown className="ml-auto size-3 opacity-60" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Number format</DropdownMenuLabel>
          {NUMBER_FORMATS.map((f) => <DropdownMenuItem key={f.id} onSelect={() => setFmt(f.id)} className={cn(currentFmt === f.id && "bg-accent")}>{f.label}<span className="ml-auto text-[10px] text-muted-foreground tabular">{f.example}</span></DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setFmt("$#,##0.00;($#,##0.00)")}>Accounting (negatives in parentheses)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFmt("0.0%")}>Percent (1 dp)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolBtn label="Currency" onClick={() => setFmt("$#,##0.00")}><DollarSign className="size-3.5" /></ToolBtn>
      <ToolBtn label="Percent" onClick={() => setFmt("0.0%")}><Percent className="size-3.5" /></ToolBtn>
      <ToolBtn label="Thousands separator" onClick={() => setFmt("#,##0")}><Hash className="size-3.5" /></ToolBtn>
      <ToolBtn label="Date" onClick={() => setFmt("mmm d yyyy")}><Calendar className="size-3.5" /></ToolBtn>
      <ToolBtn label="Fewer decimals" onClick={() => adjustDecimals(-1)}><span className="text-[10px] tabular">.0</span></ToolBtn>
      <ToolBtn label="More decimals" onClick={() => adjustDecimals(1)}><span className="text-[10px] tabular">.00</span></ToolBtn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button onMouseDown={(e) => e.preventDefault()} className={cn("flex h-7 items-center gap-1 rounded px-1.5 text-xs hover:bg-accent cursor-pointer", (sheet.freeze.rows || sheet.freeze.cols) && "bg-accent")} aria-label="Freeze panes"><Snowflake className="size-3.5" /><ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => freeze("row")}>Freeze top row</DropdownMenuItem><DropdownMenuItem onSelect={() => freeze("col")}>Freeze first column</DropdownMenuItem><DropdownMenuItem onSelect={() => freeze("here")}>Freeze up to {activeRef}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => freeze("none")}>Unfreeze</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
      <ToolBtn label="Sort A → Z" onClick={() => sort("asc")}><ArrowDownAZ className="size-3.5" /></ToolBtn>
      <ToolBtn label="Sort Z → A" onClick={() => sort("desc")}><ArrowUpZA className="size-3.5" /></ToolBtn>
      <ToolBtn label={sheet.filters ? "Remove filter" : "Filter"} active={Boolean(sheet.filters)} onClick={filter}><Filter className="size-3.5" /></ToolBtn>
      <ToolBtn label="Conditional formatting" onClick={() => onOpen("conditional")}><TableProperties className="size-3.5" /></ToolBtn>
      <ToolBtn label="Sort…" onClick={() => onOpen("sort")}><Rows3 className="size-3.5" /></ToolBtn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-1 rounded px-1.5 text-xs hover:bg-accent cursor-pointer" aria-label="Insert"><Plus className="size-3.5" /> Insert <ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => insert("rowAbove")}><Rows3 /> Rows above</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert("rowBelow")}><Rows3 /> Rows below</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert("colLeft")}><Columns3 /> Columns left</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insert("colRight")}><Columns3 /> Columns right</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => insert("sheet")}><SheetIcon /> Sheet</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("chart")}><BarChart3 /> Chart…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("names")}><Tags /> Named range…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("validation")}><ListChecks /> Data validation (list)…</DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddComment}><MessageSquarePlus /> Comment on {activeRef}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolBtn label="Autosum" shortcut="Alt+=" onClick={autosum}><Sigma className="size-4" /></ToolBtn>
      <ToolBtn label="Bar chart from selection" onClick={() => onInsertChart("bar")}><BarChart3 className="size-3.5" /></ToolBtn>
      <ToolBtn label="Line chart from selection" onClick={() => onInsertChart("line")}><LineChart className="size-3.5" /></ToolBtn>
      <ToolBtn label="Pie chart from selection" onClick={() => onInsertChart("pie")}><PieChart className="size-3.5" /></ToolBtn>
      <ToolBtn label="Comment" shortcut={`${MOD}⇧M`} onClick={onAddComment}><MessageSquarePlus className="size-3.5" /></ToolBtn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolBtn label="Find & replace" shortcut={`${MOD}F`} onClick={() => onOpen("find")}><Search className="size-3.5" /></ToolBtn>
      <ToolBtn label="Named ranges" onClick={() => onOpen("names")}><Tags className="size-3.5" /></ToolBtn>
      <ToolBtn label="Show formulas" shortcut={`${MOD}\``} active={showFormulas} onClick={() => store.getState().setShowFormulas(!showFormulas)}><Braces className="size-3.5" /></ToolBtn>
      <ToolBtn label="Page breaks (print view)" active={pageBreaks} onClick={() => store.getState().setPageBreaks(!pageBreaks)}><Printer className="size-3.5" /><span className="hidden xl:inline">Page breaks</span></ToolBtn>
    </div>
  );
}

export { Button };
