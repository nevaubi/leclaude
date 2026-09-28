/**
 * Cell presentation: formatted text, CSS from styles, conditional formatting
 * evaluation. Shared by the virtualized grid and the print view.
 */
import type * as React from "react";
import { cn } from "@/lib/utils";
import { iterateRange, normalizeRange, parseRange, toA1 } from "./a1";
import { cfKey, type Computed } from "./engine";
import { formatValue, isoToSerial, todayISO, toNumber, type Formatted } from "./format";
import { getStyle, type BorderEdge, type Cell, type CellStyle, type CellValue, type CFStop, type Sheet, type Workbook } from "./model";

/** A conditional-format result: a style patch plus an optional in-cell data bar. */
export type CFStyle = CellStyle & { bar?: { pct: number; color: string } };

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
  if (st.underline && (st.underlineStyle === "double" || st.underlineStyle === "doubleAccounting")) css.textDecorationStyle = "double";
  if (st.indent) { if (st.align === "right") css.paddingRight = 6 + st.indent * 9; else css.paddingLeft = 6 + st.indent * 9; }
  if (st.vertAlign) { css.fontSize = Math.round((st.fontSize ?? 12.5) * 0.75); css.verticalAlign = st.vertAlign === "superscript" ? "super" : "sub"; }
  if (st.fill) css.backgroundColor = st.fill;
  if (st.color && st.fill) css.color = st.color;
  else if (st.color) (css as Record<string, string>)["--cell-color"] = st.color; // lightened in dark mode by sheet.css
  else if (st.fill) css.color = isDarkColor(st.fill) ? "#F9FAFB" : "#111827"; // keep contrast on document fills in both themes
  if (st.fontSize) css.fontSize = st.fontSize;
  if (st.fontFamily) css.fontFamily = st.fontFamily;
  if (st.valign) css.alignItems = st.valign === "top" ? "flex-start" : st.valign === "bottom" ? "flex-end" : "center";
  if (st.wrap) { css.whiteSpace = "pre-wrap"; css.wordBreak = "break-word"; }
  if (st.borders) {
    const width = (e: BorderEdge) => (/^(medium|mediumDashed|mediumDashDot|mediumDashDotDot|slantDashDot)$/.test(e.style) ? 2 : e.style === "thick" || e.style === "double" ? 3 : 1);
    const color = (e: BorderEdge) => e.color ?? "var(--sheet-border-strong)";
    const parts: string[] = [];
    const b = st.borders;
    if (b.top) parts.push(`inset 0 ${width(b.top)}px 0 ${color(b.top)}`);
    if (b.bottom) parts.push(`inset 0 -${width(b.bottom)}px 0 ${color(b.bottom)}`);
    if (b.left) parts.push(`inset ${width(b.left)}px 0 0 ${color(b.left)}`);
    if (b.right) parts.push(`inset -${width(b.right)}px 0 0 ${color(b.right)}`);
    if (parts.length) css.boxShadow = parts.join(", ");
  } else switch (st.border) {
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

export function renderCell(wb: Workbook, sheet: Sheet, ref: string, computed: Computed, cfStyle?: CFStyle): RenderedCell {
  const cell: Cell | undefined = sheet.cells[ref];
  const base = getStyle(wb, cell);
  const { bar, ...cfRest } = cfStyle ?? {};
  const style = cfStyle ? { ...base, ...cfRest } : base;
  const raw = cellValueOf(sheet, ref, computed);
  const computedType = cell?.f ? computed[sheet.id]?.[ref]?.t : undefined;
  const f = formatValue(raw, style, computedType === "d" ? "d" : cell?.t);
  const css = styleToCss(style);
  if (bar) css.backgroundImage = `linear-gradient(to right, color-mix(in oklab, ${bar.color} 55%, transparent) ${bar.pct}%, transparent ${bar.pct}%)`;
  return { ...f, style, css, className: cn(f.isError && "sheet-cell-error", style.color && !style.fill && "has-color"), hasFormula: Boolean(cell?.f), raw };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return t < 0.5 ? a : b;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Threshold value of a colour-scale / data-bar stop over the numbers in the range. */
function stopValue(stop: Omit<CFStop, "color">, nums: number[], min: number, max: number): number {
  const v = Number(stop.value);
  switch (stop.type) {
    case "min": return min;
    case "max": return max;
    case "num": return Number.isFinite(v) ? v : min;
    case "percent": return min + ((Number.isFinite(v) ? v : 50) / 100) * (max - min);
    case "percentile": { const s = [...nums].sort((p, q) => p - q); const k = Math.max(0, Math.min(s.length - 1, Math.round(((Number.isFinite(v) ? v : 50) / 100) * (s.length - 1)))); return s[k] ?? min; }
    default: return Number.isFinite(v) ? v : min;
  }
}

/** Evaluate every conditional format on a sheet → ref → merged style patch. */
export function conditionalStyles(sheet: Sheet, computed: Computed): Map<string, CFStyle> {
  const out = new Map<string, CFStyle>();
  if (!sheet.conditionalFormats.length) return out;
  const today = isoToSerial(todayISO()) ?? 0;
  for (const cf of sheet.conditionalFormats) {
    let range;
    try { range = normalizeRange(parseRange(cf.range)); } catch { continue; }
    const rule = cf.rule;
    const matches = new Set<string>();
    if (rule.kind === "raw") continue;
    if (rule.kind === "colorScale" || rule.kind === "dataBar") {
      const entries: { ref: string; n: number }[] = [];
      for (const c of iterateRange(range)) { const n = toNumber(cellValueOf(sheet, c.ref, computed)); if (n !== null && sheet.cells[c.ref]) entries.push({ ref: c.ref, n }); }
      if (!entries.length) continue;
      const nums = entries.map((e) => e.n);
      const min = Math.min(...nums), max = Math.max(...nums);
      if (rule.kind === "colorScale") {
        const stops = rule.stops.map((s) => ({ at: stopValue(s, nums, min, max), color: s.color })).sort((p, q) => p.at - q.at);
        for (const e of entries) {
          let color = stops[0]?.color ?? "#FFFFFF";
          for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i + 1];
            if (e.n >= a.at && e.n <= b.at) { color = mix(a.color, b.color, b.at === a.at ? 0 : (e.n - a.at) / (b.at - a.at)); break; }
            if (e.n > b.at) color = b.color;
          }
          out.set(e.ref, { ...(out.get(e.ref) ?? {}), fill: color });
        }
      } else {
        const lo = rule.min ? stopValue(rule.min, nums, min, max) : Math.min(0, min);
        const hi = rule.max ? stopValue(rule.max, nums, min, max) : max;
        for (const e of entries) {
          const pct = hi === lo ? 100 : Math.max(0, Math.min(100, ((e.n - lo) / (hi - lo)) * 100));
          out.set(e.ref, { ...(out.get(e.ref) ?? {}), bar: { pct: Math.round(pct), color: rule.color } });
        }
      }
      continue;
    }
    if (rule.kind === "expression" || rule.kind === "cellIs") {
      const hits = computed[cfKey(sheet.id)] ?? {};
      for (const c of iterateRange(range)) if (hits[`${cf.id}|${c.ref}`]) matches.add(c.ref);
      if (rule.kind === "cellIs" && !Object.keys(hits).some((k) => k.startsWith(`${cf.id}|`))) {
        // constant operands: evaluate directly
        const a = Number(rule.formulas[0]), b = Number(rule.formulas[1]);
        for (const c of iterateRange(range)) {
          const n = toNumber(cellValueOf(sheet, c.ref, computed));
          if (n === null || !Number.isFinite(a)) continue;
          const ok = rule.operator === "greaterThan" ? n > a : rule.operator === "lessThan" ? n < a : rule.operator === "greaterThanOrEqual" ? n >= a : rule.operator === "lessThanOrEqual" ? n <= a : rule.operator === "equal" ? n === a : rule.operator === "notEqual" ? n !== a : rule.operator === "between" ? n >= a && n <= b : n < a || n > b;
          if (ok) matches.add(c.ref);
        }
      }
    } else if (rule.kind === "top" || rule.kind === "duplicate") {
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
