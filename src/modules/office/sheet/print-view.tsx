"use client";
import * as React from "react";
import { normalizeRange, parseRange, toA1 } from "./a1";
import { conditionalStyles, mergeMap, renderCell } from "./cell-render";
import { colWidth, DEFAULT_PAGE_SETUP, PAPER_SIZES, rowHeight, usedRange, type PageSetup } from "./model";
import { useSheetStore } from "./store";

function tokens(text: string | undefined, ctx: { title: string; sheet: string }) {
  return (text ?? "").replace(/&\[Title\]/g, ctx.title).replace(/&\[Sheet\]/g, ctx.sheet).replace(/&\[Date\]/g, new Date().toLocaleDateString()).replace(/&\[Page\]/g, "1").replace(/&\[Pages\]/g, "1");
}

/** Static HTML rendering of the active sheet for window.print(); hidden on screen by sheet.css. */
export function PrintView({ title }: { title: string }) {
  const wb = useSheetStore((s) => s.workbook);
  const computed = useSheetStore((s) => s.computed);
  const sheet = wb.sheets[wb.activeSheet];
  const ps: PageSetup = { ...DEFAULT_PAGE_SETUP, ...(wb.pageSetup ?? {}) };
  const paper = PAPER_SIZES[ps.paper] ?? PAPER_SIZES.letter;
  const area = React.useMemo(() => { if (ps.printArea) { try { return normalizeRange(parseRange(ps.printArea)); } catch { /* fall through */ } } const ur = usedRange(sheet); return ur ? { start: { row: 0, col: 0 }, end: ur.end } : null; }, [ps.printArea, sheet]);
  const cf = React.useMemo(() => conditionalStyles(sheet, computed), [sheet, computed]);
  const merges = React.useMemo(() => mergeMap(sheet), [sheet]);
  if (!area) return null;
  const pageCss = `@page { size: ${ps.paper === "a4" ? "A4" : ps.paper} ${ps.orientation}; margin: ${ps.margins.top}in ${ps.margins.right}in ${ps.margins.bottom}in ${ps.margins.left}in; }`;
  const totalWidth = Array.from({ length: area.end.col - area.start.col + 1 }, (_, i) => colWidth(sheet, area.start.col + i)).reduce((a, b) => a + b, 0);
  const pageWidthPx = ((ps.orientation === "landscape" ? paper.h : paper.w) - ps.margins.left - ps.margins.right) * 96;
  const scale = ps.fitToPage && totalWidth > pageWidthPx ? pageWidthPx / totalWidth : 1;
  const ctx = { title, sheet: sheet.name };
  const rows: React.ReactNode[] = [];
  for (let r = area.start.row; r <= area.end.row; r++) {
    const cells: React.ReactNode[] = [];
    for (let c = area.start.col; c <= area.end.col; c++) {
      const ref = toA1(r, c);
      if (merges.covered.has(ref)) continue;
      const span = merges.anchors.get(ref);
      const rc = sheet.cells[ref] ? renderCell(wb, sheet, ref, computed, cf.get(ref)) : null;
      cells.push(<td key={ref} colSpan={span?.cols} rowSpan={span?.rows} style={{ ...(rc?.css ?? {}), textAlign: rc?.align ?? "left", height: rowHeight(sheet, r), border: ps.gridlines ? "1px solid #d1d5db" : undefined, padding: "1px 4px", verticalAlign: "middle", fontSize: rc?.style.fontSize ?? 11, whiteSpace: rc?.style.wrap ? "pre-wrap" : "nowrap", overflow: "hidden" }}>{rc?.text ?? ""}</td>);
    }
    rows.push(<tr key={r} className={r < area.start.row + (ps.repeatHeaderRows ?? 0) ? "print-repeat" : undefined}>{cells}</tr>);
  }
  return (
    <div className="sheet-print-root" aria-hidden>
      <style>{pageCss}</style>
      <div className="print-header">{tokens(ps.header, ctx)}</div>
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left", width: totalWidth }}>
        <colgroup>{Array.from({ length: area.end.col - area.start.col + 1 }, (_, i) => <col key={i} style={{ width: colWidth(sheet, area.start.col + i) }} />)}</colgroup>
        <tbody>{rows}</tbody>
      </table>
      <div className="print-footer">{tokens(ps.footer, ctx)}</div>
    </div>
  );
}
