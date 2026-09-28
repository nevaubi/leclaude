/**
 * XLSX / CSV export. XLSX is written by the direct OOXML writer (xlsx/writer.ts): cell styles, number formats,
 * formulas with engine-computed cached values, widths/heights/hidden state, merges, freeze panes, validation,
 * conditional formatting, hyperlinks, notes, autofilter, print settings, defined names and charts. When the
 * workbook came from an imported .xlsx and the original package bytes are passed, the export keeps that package
 * and rewrites only the parts whose model changed.
 */
import { toA1 } from "./a1";
import { computeWorkbook, type Computed } from "./engine";
import { usedRange, type Workbook } from "./model";
import { writeXlsxWithReport, type WriteReport } from "./xlsx/writer";

export interface ExportOptions {
  computed?: Computed;
  /** Original package bytes (only used when they belong to wb.xlsxSource; the caller verifies the hash). */
  original?: Uint8Array | null;
}

export function exportXlsx(wb: Workbook, opts: ExportOptions = {}): Uint8Array {
  return writeXlsxWithReport(wb, opts).bytes;
}

export function exportXlsxWithReport(wb: Workbook, opts: ExportOptions = {}): { bytes: Uint8Array; report: WriteReport } {
  return writeXlsxWithReport(wb, opts);
}

/** CSV of one sheet using computed values (formulas resolved) and raw literals. */
export function exportCsv(wb: Workbook, sheetKey?: string, opts: { computed?: Computed } = {}): string {
  const computed = opts.computed ?? computeWorkbook(wb);
  const sheet = sheetKey ? wb.sheets.find((s) => s.id === sheetKey || s.name === sheetKey) ?? wb.sheets[wb.activeSheet] : wb.sheets[wb.activeSheet];
  const ur = usedRange(sheet);
  if (!ur) return "";
  const lines: string[] = [];
  for (let r = 0; r <= ur.end.row; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= ur.end.col; c++) {
      const ref = toA1(r, c);
      const cell = sheet.cells[ref];
      let v: unknown = cell?.f ? computed[sheet.id]?.[ref]?.v : cell?.v;
      if (v === undefined || v === null) v = "";
      const s = String(v);
      cells.push(/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
