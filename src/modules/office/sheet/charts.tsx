"use client";
import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { GripHorizontal, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeRange, parseRange, toA1 } from "./a1";
import { cellValueOf } from "./cell-render";
import type { Computed } from "./engine";
import { formatValue, toNumber } from "./format";
import { getStyle, type Sheet, type SheetChart, type Workbook } from "./model";

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export interface ChartData { rows: Record<string, string | number | null>[]; series: string[]; categoryKey: string; numFmt?: string }

/** Extract chart rows from the sheet: data range columns become series (header row = names), category range = labels. */
export function chartData(chart: SheetChart, sheet: Sheet, computed: Computed, wb?: Workbook): ChartData {
  let data; let cats = null;
  try { data = normalizeRange(parseRange(chart.range)); } catch { return { rows: [], series: [], categoryKey: "label" }; }
  try { if (chart.categoryRange) cats = normalizeRange(parseRange(chart.categoryRange)); } catch { cats = null; }
  const hasHeader = chart.hasHeader !== false;
  const series: string[] = [];
  for (let c = data.start.col; c <= data.end.col; c++) {
    const headerVal = hasHeader ? cellValueOf(sheet, toA1(data.start.row, c), computed) : null;
    series.push(headerVal !== null && headerVal !== "" ? String(headerVal) : `Series ${c - data.start.col + 1}`);
  }
  const firstRow = data.start.row + (hasHeader ? 1 : 0);
  const rows: ChartData["rows"] = [];
  let numFmt: string | undefined;
  for (let r = firstRow; r <= data.end.row; r++) {
    const row: Record<string, string | number | null> = {};
    let catLabel: string | null = null;
    if (cats) {
      const cr = cats.start.row + (r - firstRow) + (cats.end.row - cats.start.row + 1 > data.end.row - firstRow + 1 && hasHeader ? 1 : 0);
      const cv = cellValueOf(sheet, toA1(Math.min(cr, cats.end.row), cats.start.col), computed);
      const cs = wb ? getStyle(wb, sheet.cells[toA1(Math.min(cr, cats.end.row), cats.start.col)]) : undefined;
      catLabel = cv === null ? "" : formatValue(cv, cs, sheet.cells[toA1(Math.min(cr, cats.end.row), cats.start.col)]?.t).text;
    }
    row.label = catLabel ?? `Row ${r + 1}`;
    let any = false;
    series.forEach((name, i) => {
      const ref = toA1(r, data.start.col + i);
      const v = toNumber(cellValueOf(sheet, ref, computed));
      if (!numFmt && wb) { const st = getStyle(wb, sheet.cells[ref]); if (st.numFmt) numFmt = st.numFmt; }
      row[name] = v;
      if (v !== null) any = true;
    });
    if (any || catLabel) rows.push(row);
  }
  return { rows, series, categoryKey: "label", numFmt };
}

function fmtTick(numFmt?: string) {
  return (v: number) => formatValue(v, numFmt ? { numFmt } : undefined).text;
}

export function ChartView({ chart, data, className }: { chart: SheetChart; data: ChartData; className?: string }) {
  const fmt = fmtTick(data.numFmt);
  const common = { margin: { top: 8, right: 16, left: 8, bottom: 4 } };
  const formatter: TooltipProps<ValueType, NameType>["formatter"] = (v) => (typeof v === "number" ? fmt(v) : Array.isArray(v) ? v.join(", ") : String(v ?? ""));
  const tooltipStyle = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }, formatter };
  if (!data.rows.length) return <div className={cn("flex h-full items-center justify-center text-xs text-muted-foreground", className)}>No numeric data in {chart.range}</div>;
  return (
    <div className={cn("h-full w-full text-[11px]", className)}>
      <ResponsiveContainer width="100%" height="100%">
        {chart.type === "pie" ? (
          <PieChart {...common}>
            <Pie data={data.rows} dataKey={data.series[0]} nameKey="label" outerRadius="80%" innerRadius="45%" paddingAngle={2} stroke="var(--background)">
              {data.rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : chart.type === "line" ? (
          <LineChart data={data.rows} {...common}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" width={64} />
            <Tooltip {...tooltipStyle} />
            {data.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {data.series.map((s, i) => <Line key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} />)}
          </LineChart>
        ) : chart.type === "area" ? (
          <AreaChart data={data.rows} {...common}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" width={64} />
            <Tooltip {...tooltipStyle} />
            {data.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {data.series.map((s, i) => <Area key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.25} stackId={chart.stacked ? "a" : undefined} />)}
          </AreaChart>
        ) : chart.type === "scatter" ? (
          <ScatterChart {...common}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey={data.series[0]} name={data.series[0]} tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
            <YAxis dataKey={data.series[1] ?? data.series[0]} name={data.series[1] ?? data.series[0]} tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" width={64} />
            <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={data.rows} fill={PALETTE[0]} />
          </ScatterChart>
        ) : (
          <BarChart data={data.rows} {...common}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" interval={0} angle={data.rows.length > 6 ? -20 : 0} textAnchor={data.rows.length > 6 ? "end" : "middle"} height={data.rows.length > 6 ? 48 : 30} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" width={64} />
            <Tooltip {...tooltipStyle} cursor={{ fill: "var(--accent)", opacity: 0.4 }} />
            {data.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {data.series.map((s, i) => <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} stackId={chart.stacked ? "a" : undefined} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export interface ChartOverlayProps {
  chart: SheetChart; sheet: Sheet; workbook: Workbook; computed: Computed;
  offset: { x: number; y: number };
  onChange: (patch: Partial<SheetChart>) => void;
  onRemove: () => void;
  onEdit: () => void;
}

/** Floating, draggable and resizable chart card positioned over the grid. */
export function ChartOverlay({ chart, sheet, workbook, computed, offset, onChange, onRemove, onEdit }: ChartOverlayProps) {
  const [pos, setPos] = React.useState(chart.position);
  const dragRef = React.useRef<{ mode: "move" | "resize"; sx: number; sy: number; start: SheetChart["position"] } | null>(null);
  React.useEffect(() => setPos(chart.position), [chart.position]);
  const data = React.useMemo(() => chartData(chart, sheet, computed, workbook), [chart, sheet, computed, workbook]);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.mode === "move") setPos({ ...d.start, x: Math.max(0, d.start.x + dx), y: Math.max(0, d.start.y + dy) });
      else setPos({ ...d.start, w: Math.max(200, d.start.w + dx), h: Math.max(140, d.start.h + dy) });
    };
    const onUp = () => { const d = dragRef.current; if (!d) return; dragRef.current = null; setPos((p) => { if (p.x !== chart.position.x || p.y !== chart.position.y || p.w !== chart.position.w || p.h !== chart.position.h) onChange({ position: p }); return p; }); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [chart.position, onChange]);

  return (
    <div data-chart="1" className="absolute z-30 flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg" style={{ left: offset.x + pos.x, top: offset.y + pos.y, width: pos.w, height: pos.h }} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="flex h-7 shrink-0 cursor-move items-center gap-1 border-b bg-muted/50 px-2 text-[11px]" onMouseDown={(e) => { e.preventDefault(); dragRef.current = { mode: "move", sx: e.clientX, sy: e.clientY, start: pos }; }}>
        <GripHorizontal className="size-3 text-muted-foreground" />
        <span className="truncate font-medium">{chart.title}</span>
        <span className="ml-1 truncate text-muted-foreground">{chart.range}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onMouseDown={(e) => e.stopPropagation()} onClick={onEdit} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Edit chart"><Pencil className="size-3" /></button>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={onRemove} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer" aria-label="Remove chart"><X className="size-3" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-1"><ChartView chart={chart} data={data} /></div>
      <div className="absolute bottom-0 right-0 size-3 cursor-nwse-resize border-r-2 border-b-2 border-muted-foreground/50" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); dragRef.current = { mode: "resize", sx: e.clientX, sy: e.clientY, start: pos }; }} />
    </div>
  );
}
