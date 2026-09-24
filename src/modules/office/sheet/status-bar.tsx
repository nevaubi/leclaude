"use client";
import * as React from "react";
import { Loader2, MessageSquare, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { iterateRange, rangeSize } from "./a1";
import { cellValueOf } from "./cell-render";
import { formatValue, toNumber } from "./format";
import { getStyle } from "./model";
import { useSheetStore } from "./store";

export interface StatusBarProps { firstRow: number; lastRow: number; pages: number; saveLabel: string; loading: boolean; comments: number; errors: number; saveState: string }

export function StatusBar({ firstRow, lastRow, pages, saveLabel, loading, comments, errors, saveState }: StatusBarProps) {
  const workbook = useSheetStore((s) => s.workbook);
  const computed = useSheetStore((s) => s.computed);
  const selection = useSheetStore((s) => s.selection);
  const sheet = workbook.sheets[workbook.activeSheet] ?? workbook.sheets[0];

  const stats = React.useMemo(() => {
    let count = 0, numeric = 0, sum = 0, min = Infinity, max = -Infinity;
    let numFmt: string | undefined;
    let cells = 0;
    for (const r of selection.ranges) {
      const size = rangeSize(r);
      cells += size.cells;
      if (size.cells > 50_000) {
        for (const [ref, cell] of Object.entries(sheet.cells)) { const m = /^([A-Z]+)(\d+)$/.exec(ref)!; const row = Number(m[2]) - 1; let col = 0; for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64); col--; if (row < r.start.row || row > r.end.row || col < r.start.col || col > r.end.col) continue; const v = cell.f ? computed[sheet.id]?.[ref]?.v : cell.v; if (v === null || v === undefined || v === "") continue; count++; const n = typeof v === "number" ? v : null; if (n !== null) { numeric++; sum += n; min = Math.min(min, n); max = Math.max(max, n); if (!numFmt) numFmt = getStyle(workbook, cell).numFmt; } }
        continue;
      }
      for (const c of iterateRange(r)) {
        const cell = sheet.cells[c.ref];
        if (!cell) continue;
        const v = cellValueOf(sheet, c.ref, computed);
        if (v === null || v === "") continue;
        count++;
        const n = typeof v === "number" ? v : cell.t === "d" ? null : toNumber(v);
        if (n !== null && typeof v !== "boolean") { numeric++; sum += n; min = Math.min(min, n); max = Math.max(max, n); if (!numFmt) numFmt = getStyle(workbook, cell).numFmt; }
      }
    }
    return { count, numeric, sum, min, max, avg: numeric ? sum / numeric : 0, numFmt, cells };
  }, [selection.ranges, sheet, computed, workbook]);

  const fmt = (n: number) => formatValue(n, stats.numFmt && !/(yy|mmm|d)/i.test(stats.numFmt) ? { numFmt: stats.numFmt } : undefined).text;
  const Item = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) => <span title={title} className={cn("flex items-center gap-1 whitespace-nowrap px-2", className)}>{children}</span>;

  return (
    <div className="flex h-7 shrink-0 items-center overflow-hidden border-t bg-background text-[11px] text-muted-foreground divide-x">
      <Item title="Visible rows">Rows <span className="tabular text-foreground">{firstRow}–{lastRow}</span></Item>
      <Item title="Printed pages for the used range">Page 1 of <span className="tabular">{pages}</span></Item>
      <Item title="Sheet size">{Object.keys(sheet.cells).length.toLocaleString()} cells · {Object.values(sheet.cells).filter((c) => c.f).length.toLocaleString()} formulas</Item>
      {errors > 0 && <Item className="text-destructive" title="Cells with formula errors"><AlertTriangle className="size-3" /> {errors} error{errors === 1 ? "" : "s"}</Item>}
      <div className="flex-1" />
      {stats.numeric > 0 && (
        <>
          <Item title="Sum of numeric cells in the selection">Sum <span className="tabular text-foreground">{fmt(stats.sum)}</span></Item>
          <Item>Avg <span className="tabular text-foreground">{fmt(stats.avg)}</span></Item>
          <Item>Min <span className="tabular text-foreground">{fmt(stats.min)}</span></Item>
          <Item>Max <span className="tabular text-foreground">{fmt(stats.max)}</span></Item>
        </>
      )}
      {stats.count > 0 && <Item>Count <span className="tabular text-foreground">{stats.count}</span>{stats.cells > 1 && <span className="text-muted-foreground"> of {stats.cells.toLocaleString()}</span>}</Item>}
      {comments > 0 && <Item><MessageSquare className="size-3" /> <span className="tabular">{comments}</span></Item>}
      <Item className={cn("min-w-[120px] justify-end", saveState === "error" && "text-destructive")}>{loading ? <Loader2 className="size-3 animate-spin" /> : null}{saveLabel}</Item>
    </div>
  );
}
