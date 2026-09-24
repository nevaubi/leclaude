"use client";
/**
 * Excel toolbar in the spirit of the reference: Undo/Redo · size · B I U ·
 * colors/borders · alignment · number format (select + $ %) · Σ · chart icons ·
 * comment · Data ▾ · Insert ▾ · … · Page breaks. Everything else lives in the
 * menus so the row stays calm at 1024px.
 */
import * as React from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowUpZA, BarChart3, Bold, Braces, Calendar, Columns3, Database, DollarSign, Filter, Grid2x2, Hash, Italic, LineChart, ListChecks, MessageSquarePlus, PaintBucket, Percent, PieChart, Plus, Printer, Redo2, Rows3, Search, Sheet as SheetIcon, Sigma, Snowflake, SquareStack, TableProperties, Tags, Type, Underline, Undo2, WrapText, Baseline } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OfficeToolbar, ToolButton, ToolMenuTrigger, ToolSep, ToolbarToggle } from "@/modules/office/shared/office-chrome";
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

/** Swatch trigger (text color / fill) for the toolbar. */
function SwatchButton({ label, icon: Icon, color, checker }: { label: string; icon: React.ComponentType<{ className?: string }>; color: string | null | undefined; checker?: boolean }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-foreground cursor-pointer" aria-label={label}>
      <Icon className="size-4" />
      <span className="h-3 w-1.5 rounded-sm border" style={{ background: color ?? (checker ? "repeating-conic-gradient(var(--border) 0 25%, transparent 0 50%) 0 0/6px 6px" : "currentColor") }} aria-hidden />
    </button>
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
  const currentFmtLabel = NUMBER_FORMATS.find((f) => f.id === currentFmt)?.label ?? (currentFmt === "$#,##0.00;($#,##0.00)" ? "Accounting" : currentFmt === "0.0%" ? "Percent (1 dp)" : currentFmt);
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
      if (r.end.row > r.start.row) for (let c = r.start.col; c <= r.end.col; c++) cells.push({ ref: toA1(r.end.row + 1, c), formula: `=SUM(${toA1(r.start.row, c)}:${toA1(r.end.row, c)})` });
      else cells.push({ ref: toA1(r.start.row, r.end.col + 1), formula: `=SUM(${rangeToA1(r)})` });
    } else {
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
  const frozen = Boolean(sheet.freeze.rows || sheet.freeze.cols);

  return (
    <OfficeToolbar disabled={disabled} right={<ToolbarToggle icon={Printer} label="Page breaks (print preview on the grid)" pressed={pageBreaks} onClick={() => store.getState().setPageBreaks(!pageBreaks)} text={<span className="hidden md:inline">Page breaks</span>} />}>
      <ToolButton icon={Undo2} label="Undo" shortcut={`${MOD}Z`} onClick={() => store.getState().undo()} disabled={!past} />
      <ToolButton icon={Redo2} label="Redo" shortcut={`${MOD}Y`} onClick={() => store.getState().redo()} disabled={!future} />
      <ToolSep />
      <DropdownMenu>
        <Tip label="Font size"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={Type} label={<span className="tabular">{style.fontSize ?? 12}</span>} aria-label="Font size" /></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start" className="w-24">{FONT_SIZES.map((s) => <DropdownMenuItem key={s} onSelect={() => styleSel({ fontSize: s === 12 ? null : s })} className={cn("tabular", (style.fontSize ?? 12) === s && "bg-accent")}>{s}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <ToolButton icon={Bold} label="Bold" shortcut={`${MOD}B`} active={Boolean(style.bold)} onClick={() => toggle("bold")} />
      <ToolButton icon={Italic} label="Italic" shortcut={`${MOD}I`} active={Boolean(style.italic)} onClick={() => toggle("italic")} />
      <ToolButton icon={Underline} label="Underline" shortcut={`${MOD}U`} active={Boolean(style.underline)} onClick={() => toggle("underline")} />
      <Popover>
        <Tip label="Text color"><PopoverTrigger asChild><SwatchButton label="Text color" icon={Baseline} color={style.color} /></PopoverTrigger></Tip>
        <PopoverContent align="start" className="w-auto p-2"><div className="grid grid-cols-5 gap-1">{TEXT_COLORS.map((c) => <button key={c} onClick={() => styleSel({ color: c })} className={cn("size-6 rounded-md border cursor-pointer transition-transform hover:scale-110", style.color === c && "ring-2 ring-ring ring-offset-1 ring-offset-background")} style={{ background: c }} aria-label={c} />)}<button onClick={() => styleSel({ color: null })} className="col-span-5 mt-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent cursor-pointer">Automatic</button></div></PopoverContent>
      </Popover>
      <Popover>
        <Tip label="Fill color"><PopoverTrigger asChild><SwatchButton label="Fill color" icon={PaintBucket} color={style.fill} checker /></PopoverTrigger></Tip>
        <PopoverContent align="start" className="w-auto p-2"><div className="grid grid-cols-7 gap-1">{FILLS.map((c) => <button key={c} onClick={() => styleSel({ fill: c })} className={cn("size-6 rounded-md border cursor-pointer transition-transform hover:scale-110", style.fill === c && "ring-2 ring-ring ring-offset-1 ring-offset-background")} style={{ background: c }} aria-label={c} />)}<button onClick={() => styleSel({ fill: null })} className="col-span-7 mt-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent cursor-pointer">No fill</button></div></PopoverContent>
      </Popover>
      <DropdownMenu>
        <Tip label="Borders"><DropdownMenuTrigger asChild><ToolMenuTrigger icon={Grid2x2} label="Borders" aria-label="Borders" className="[&>span]:sr-only" /></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start">{BORDERS.map((b) => <DropdownMenuItem key={b.id} onSelect={() => styleSel({ border: b.id === "none" ? null : b.id })}>{b.label}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <ToolSep />
      <ToolButton icon={AlignLeft} label="Align left" active={style.align === "left"} onClick={() => styleSel({ align: "left" })} />
      <ToolButton icon={AlignCenter} label="Align center" active={style.align === "center"} onClick={() => styleSel({ align: "center" })} />
      <ToolButton icon={AlignRight} label="Align right" active={style.align === "right"} onClick={() => styleSel({ align: "right" })} />
      <ToolButton icon={WrapText} label="Wrap text" active={Boolean(style.wrap)} onClick={() => toggle("wrap")} className="hidden lg:inline-flex" />
      <ToolButton icon={SquareStack} label={merged ? "Unmerge cells" : "Merge cells"} active={merged} onClick={() => store.getState().apply({ type: merged ? "unmerge_cells" : "merge_cells", sheet: sheet.id, range: store.getState().selectionA1() })} className="hidden lg:inline-flex" />
      <ToolSep />
      <DropdownMenu>
        <Tip label="Number format"><DropdownMenuTrigger asChild><ToolMenuTrigger label={currentFmtLabel} aria-label="Number format" width={132} className="border" /></DropdownMenuTrigger></Tip>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Number format</DropdownMenuLabel>
          {NUMBER_FORMATS.map((f) => <DropdownMenuItem key={f.id} onSelect={() => setFmt(f.id)} className={cn(currentFmt === f.id && "bg-accent")}>{f.label}<span className="ml-auto text-[10px] text-muted-foreground tabular">{f.example}</span></DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setFmt("$#,##0.00;($#,##0.00)")}>Accounting (negatives in parentheses)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFmt("0.0%")}>Percent (1 dp)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFmt("#,##0")}><Hash /> Thousands separator</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFmt("mmm d yyyy")}><Calendar /> Date</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => adjustDecimals(-1)}>Fewer decimals <span className="ml-auto text-[10px] tabular text-muted-foreground">.0</span></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => adjustDecimals(1)}>More decimals <span className="ml-auto text-[10px] tabular text-muted-foreground">.00</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton icon={DollarSign} label="Currency" onClick={() => setFmt("$#,##0.00")} active={currentFmt === "$#,##0.00"} />
      <ToolButton icon={Percent} label="Percent" onClick={() => setFmt("0.0%")} active={currentFmt === "0.0%"} />
      <ToolSep />
      <ToolButton icon={Sigma} label="Autosum" shortcut="Alt+=" onClick={autosum} />
      <ToolButton icon={BarChart3} label="Bar chart from selection" onClick={() => onInsertChart("bar")} />
      <ToolButton icon={LineChart} label="Line chart from selection" onClick={() => onInsertChart("line")} className="hidden md:inline-flex" />
      <ToolButton icon={PieChart} label="Pie chart from selection" onClick={() => onInsertChart("pie")} className="hidden md:inline-flex" />
      <ToolButton icon={MessageSquarePlus} label={`Comment on ${activeRef}`} shortcut={`${MOD}⇧M`} onClick={onAddComment} />
      <ToolSep />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><ToolMenuTrigger icon={Database} label="Data" aria-label="Data" active={Boolean(sheet.filters) || frozen || showFormulas} hideLabelBelow="lg" /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => sort("asc")}><ArrowDownAZ /> Sort A → Z</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => sort("desc")}><ArrowUpZA /> Sort Z → A</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("sort")}><Rows3 /> Sort by columns…</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked={Boolean(sheet.filters)} onCheckedChange={filter}><Filter /> Filter</DropdownMenuCheckboxItem>
          <DropdownMenuItem onSelect={() => onOpen("conditional")}><TableProperties /> Conditional formatting…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Snowflake /> Freeze panes{frozen ? " · on" : ""}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => freeze("row")}>Freeze top row</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => freeze("col")}>Freeze first column</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => freeze("here")}>Freeze up to {activeRef}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => freeze("none")} disabled={!frozen}>Unfreeze</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => onOpen("names")}><Tags /> Named ranges…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("validation")}><ListChecks /> Data validation (list)…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("find")}><Search /> Find & replace… <span className="ml-auto text-[10px] text-muted-foreground">{MOD}F</span></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={showFormulas} onCheckedChange={() => store.getState().setShowFormulas(!showFormulas)}><Braces /> Show formulas <span className="ml-auto text-[10px] text-muted-foreground">{MOD}`</span></DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><ToolMenuTrigger icon={Plus} label="Insert" aria-label="Insert" hideLabelBelow="lg" /></DropdownMenuTrigger>
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
    </OfficeToolbar>
  );
}

export { Button };
