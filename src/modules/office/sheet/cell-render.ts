/**
 * Cell presentation: formatted text, CSS from styles, conditional formatting
 * evaluation. Shared by the virtualized grid and the print view.
 */
import type * as React from "react";
import { iterateRange, normalizeRange, parseRange, toA1 } from "./a1";
import type { Computed } from "./engine";
import { formatValue, isoToSerial, todayISO, toNumber, type Formatted } from "./format";
import { getStyle, type Cell, type CellStyle, type CellValue, type Sheet, type Workbook } from "./model";

export interface RenderedCell extends Formatted { style: CellStyle; css: React.CSSProperties; className: string; hasFormula: boolean; raw: CellValue }

export function cellValueOf(sheet: Sheet, ref: string, computed: Computed): CellValue {
  const cell = sheet.cells[ref];
  if (!cell) return null;
  if (cell.f) return computed[sheet.id]?.[ref]?.v ?? null;
  return cell.v ?? null;
}

export function styleToCss(st: CellStyle): React.CSSProperties {
  const css: React.CSSProperties = {};
  if (st.bold) css.fontWeight = 600;
  if (st.italic) css.fontStyle = "italic";
  if (st.underline && st.strike) css.textDecoration = "underline line-through";
  else if (st.underline) css.textDecoration = "underline";
  else if (st.strike) css.textDecoration = "line-through";
  if (st.fill) css.backgroundColor = st.fill;
  if (st.color) css.color = st.color;
  else if (st.fill) css.color = isDarkColor(st.fill) ? "#F9FAFB" : "#111827"; // keep contrast on document fills in both themes
  if (st.fontSize) css.fontSize = st.fontSize;
  if (st.fontFamily) css.fontFamily = st.fontFamily;
  if (st.valign) css.alignItems = st.valign === "top" ? "flex-start" : st.valign === "bottom" ? "flex-end" : "center";
  if (st.wrap) { css.whiteSpace = "pre-wrap"; css.wordBreak = "break-word"; }
  switch (st.border) {
    case "thin": case "all": css.boxShadow = "inset 0 0 0 1px var(--sheet-border-strong)"; break;
    case "medium": css.boxShadow = "inset 0 0 0 1.5px var(--sheet-border-strong)"; break;
    case "thick": css.boxShadow = "inset 0 0 0 2px var(--sheet-border-strong)"; break;
    case "outline": css.boxShadow = "inset 0 0 0 1px var(--sheet-border-strong)"; break;
    case "bottom": css.boxShadow = "inset 0 -1.5px 0 var(--sheet-border-strong)"; break;
    case "top": css.boxShadow = "inset 0 1.5px 0 var(--sheet-border-strong)"; break;
  }
  return css;
}

function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

export function renderCell(wb: Workbook, sheet: Sheet, ref: string, computed: Computed, cfStyle?: CellStyle): RenderedCell {
  const cell: Cell | undefined = sheet.cells[ref];
  const base = getStyle(wb, cell);
  const style = cfStyle ? { ...base, ...cfStyle } : base;
  const raw = cellValueOf(sheet, ref, computed);
  const computedType = cell?.f ? computed[sheet.id]?.[ref]?.t : undefined;
  const f = formatValue(raw, style, computedType === "d" ? "d" : cell?.t);
  return { ...f, style, css: styleToCss(style), className: f.isError ? "sheet-cell-error" : "", hasFormula: Boolean(cell?.f), raw };
}

/** Evaluate every conditional format on a sheet → ref → merged style patch. */
export function conditionalStyles(sheet: Sheet, computed: Computed): Map<string, CellStyle> {
  const out = new Map<string, CellStyle>();
  if (!sheet.conditionalFormats.length) return out;
  const today = isoToSerial(todayISO()) ?? 0;
  for (const cf of sheet.conditionalFormats) {
    let range;
    try { range = normalizeRange(parseRange(cf.range)); } catch { continue; }
    const rule = cf.rule;
    const matches = new Set<string>();
    if (rule.kind === "top" || rule.kind === "duplicate") {
      const entries: { ref: string; v: CellValue }[] = [];
      for (const c of iterateRange(range)) { const v = cellValueOf(sheet, c.ref, computed); if (v !== null && v !== "") entries.push({ ref: c.ref, v }); }
      if (rule.kind === "top") {
        const nums = entries.filter((e) => toNumber(e.v) !== null).sort((a, b) => (toNumber(b.v)! - toNumber(a.v)!) * (rule.bottom ? -1 : 1));
        for (const e of nums.slice(0, Math.max(1, rule.count))) matches.add(e.ref);
      } else {
        const seen = new Map<string, number>();
        for (const e of entries) seen.set(String(e.v).toLowerCase(), (seen.get(String(e.v).toLowerCase()) ?? 0) + 1);
        for (const e of entries) if ((seen.get(String(e.v).toLowerCase()) ?? 0) > 1) matches.add(e.ref);
      }
    } else {
      for (const c of iterateRange(range)) {
        const v = cellValueOf(sheet, c.ref, computed);
        const n = toNumber(v);
        let ok = false;
        switch (rule.kind) {
          case "gt": ok = n !== null && n > rule.value; break;
          case "lt": ok = n !== null && n < rule.value; break;
          case "between": ok = n !== null && n >= rule.min && n <= rule.max; break;
          case "eq": ok = v !== null && v !== "" && (typeof rule.value === "number" ? n === rule.value : String(v).toLowerCase() === String(rule.value ?? "").toLowerCase()); break;
          case "contains": ok = v !== null && String(v).toLowerCase().includes(rule.text.toLowerCase()); break;
          case "blank": ok = v === null || v === ""; break;
          case "dueBefore": {
            const limit = (rule.date === "today" || !rule.date ? today : (isoToSerial(rule.date) ?? today)) + (rule.days ?? 0);
            const serial = typeof v === "string" ? isoToSerial(v) : typeof v === "number" ? v : null;
            ok = serial !== null && serial < limit;
            break;
          }
        }
        if (ok) matches.add(c.ref);
      }
    }
    for (const ref of matches) out.set(ref, { ...(out.get(ref) ?? {}), ...cf.style });
  }
  return out;
}

/** Merge geometry: anchor → span, plus every covered (non-anchor) ref. */
export function mergeMap(sheet: Sheet): { anchors: Map<string, { rows: number; cols: number }>; covered: Map<string, string> } {
  const anchors = new Map<string, { rows: number; cols: number }>();
  const covered = new Map<string, string>();
  for (const m of sheet.merges) {
    let r;
    try { r = normalizeRange(parseRange(m)); } catch { continue; }
    const anchor = toA1(r.start.row, r.start.col);
    anchors.set(anchor, { rows: r.end.row - r.start.row + 1, cols: r.end.col - r.start.col + 1 });
    for (const c of iterateRange(r)) if (c.ref !== anchor) covered.set(c.ref, anchor);
  }
  return { anchors, covered };
}
