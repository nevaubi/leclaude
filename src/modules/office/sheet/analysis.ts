/**
 * Deterministic spreadsheet analysis for the agent (constitution §53.3: all
 * arithmetic in code or in the formula engine, never in the model):
 * formula audit, precedent/dependent tracing, formula regions (R1C1),
 * compact workbook summaries, US court-calendar date math, and builders for
 * live-formula summary tables, lookups and prejudgment-interest schedules.
 */
import { colToLetter, letterToCol, normalizeRange, parseA1, parseRange, quoteSheet, rangeToA1, tokenizeFormula, toA1, type RangeRef } from "./a1";
import type { Computed } from "./engine";
import { formatValue, isoToSerial, serialToISO } from "./format";
import { formulaFacts, parseFormula, walk, type FNode } from "./formula-ast";
import { detectHeaderRow, getStyle, usedRange, type CellValue, type Sheet, type Workbook } from "./model";
import type { CellInput, SheetOp } from "./ops";

// ------------------------------------------------------------------ values

export function valueOf(sheet: Sheet, computed: Computed, ref: string): CellValue {
  const c = sheet.cells[ref];
  if (!c) return null;
  if (c.f) return computed[sheet.id]?.[ref]?.v ?? null;
  return c.v ?? null;
}

export function displayOf(wb: Workbook, sheet: Sheet, computed: Computed, ref: string): string {
  const c = sheet.cells[ref];
  if (!c) return "";
  const t = c.f ? computed[sheet.id]?.[ref]?.t : c.t;
  return formatValue(valueOf(sheet, computed, ref), getStyle(wb, c), t === "d" ? "d" : c.t).text;
}

// ------------------------------------------------------------------ R1C1 / regions

/** Relative (R1C1-style) shape of a formula written in (row, col): equal shapes = the same formula copied. */
export function toR1C1(formula: string, row: number, col: number): string {
  return tokenizeFormula(formula).map((t) => {
    if (t.kind !== "ref" || !t.start) return t.text;
    const one = (c: { row: number; col: number; absRow?: boolean; absCol?: boolean }, full?: "row" | "col") => {
      const r = full === "col" ? "" : c.absRow ? `R${c.row + 1}` : `R[${c.row - row}]`;
      const k = full === "row" ? "" : c.absCol ? `C${c.col + 1}` : `C[${c.col - col}]`;
      return r + k;
    };
    const full = t.fullCol ? "col" : t.fullRow ? "row" : undefined;
    const body = t.end ? `${one(t.start, full)}:${one(t.end, full)}` : one(t.start, full);
    return (t.sheet ? `${t.sheet}!` : "") + body;
  }).join("");
}

export interface FormulaRegion { range: string; count: number; example: string; r1c1: string }

/** Contiguous runs of the same (R1C1) formula down each column. */
export function formulaRegions(sheet: Sheet): FormulaRegion[] {
  const byCol = new Map<number, { row: number; ref: string; f: string; shape: string }[]>();
  for (const [ref, c] of Object.entries(sheet.cells)) {
    if (!c.f) continue;
    const p = parseA1(ref);
    const list = byCol.get(p.col) ?? [];
    list.push({ row: p.row, ref, f: c.f, shape: toR1C1(c.f, p.row, p.col) });
    byCol.set(p.col, list);
  }
  const out: FormulaRegion[] = [];
  for (const [col, list] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.row - b.row);
    let start = 0;
    for (let i = 1; i <= list.length; i++) {
      const brk = i === list.length || list[i].shape !== list[start].shape || list[i].row !== list[i - 1].row + 1;
      if (!brk) continue;
      const first = list[start], last = list[i - 1];
      out.push({ range: first.row === last.row ? toA1(first.row, col) : `${toA1(first.row, col)}:${toA1(last.row, col)}`, count: i - start, example: first.f, r1c1: first.shape });
      start = i;
    }
  }
  return out;
}

// ------------------------------------------------------------------ summary

const SMALL_SHEET_CELLS = 120;

/** Compact, prompt-friendly description of a sheet: never every cell of a large sheet. */
export function summarizeSheet(wb: Workbook, sheet: Sheet, computed: Computed, opts: { active?: boolean; previewRows?: number } = {}): string {
  const ur = usedRange(sheet);
  const cells = Object.keys(sheet.cells).length;
  const formulas = Object.values(sheet.cells).filter((c) => c.f).length;
  const bits = [`used ${ur ? rangeToA1(ur) : "(empty)"}`, `${cells} cells`, `${formulas} formulas`];
  if (sheet.freeze.rows || sheet.freeze.cols) bits.push(`freeze ${sheet.freeze.rows}r/${sheet.freeze.cols}c`);
  if (sheet.merges.length) bits.push(`merges ${sheet.merges.slice(0, 6).join(",")}${sheet.merges.length > 6 ? "…" : ""}`);
  if (sheet.filters) bits.push(`filter ${sheet.filters.range}`);
  if (sheet.conditionalFormats.length) bits.push(`${sheet.conditionalFormats.length} conditional format(s)`);
  if (sheet.validations?.length) bits.push(`${sheet.validations.length} validation(s)`);
  if (sheet.hidden) bits.push("hidden");
  if (sheet.hiddenRows?.length) bits.push(`${sheet.hiddenRows.length} hidden row(s)`);
  if (sheet.hiddenCols?.length) bits.push(`hidden cols ${sheet.hiddenCols.join(",")}`);
  const lines = [`## Sheet "${sheet.name}"${opts.active ? " (active)" : ""} — ${bits.join(" · ")}`];
  if (!ur) return lines.join("\n");
  const hr = detectHeaderRow(sheet, ur);
  if (hr !== null) {
    const heads: string[] = [];
    for (let c = ur.start.col; c <= ur.end.col && heads.length < 30; c++) { const v = valueOf(sheet, computed, toA1(hr, c)); if (v !== null && v !== "") heads.push(`${colToLetter(c)}=${JSON.stringify(String(v)).slice(0, 60)}`); }
    lines.push(`headers (row ${hr + 1}): ${heads.join(" ")}`);
  }
  // column profile below the header
  const first = hr !== null ? hr + 1 : ur.start.row;
  const prof: string[] = [];
  for (let c = ur.start.col; c <= ur.end.col && prof.length < 26; c++) {
    let n = 0, s = 0, d = 0, f = 0, b = 0, sum = 0;
    let fmt: string | undefined;
    for (let r = first; r <= ur.end.row; r++) {
      const ref = toA1(r, c);
      const cell = sheet.cells[ref];
      if (!cell) continue;
      if (cell.f) f++;
      const v = valueOf(sheet, computed, ref);
      if (typeof v === "number") { n++; sum += v; fmt = fmt ?? getStyle(wb, cell).numFmt; }
      else if (typeof v === "boolean") b++;
      else if (typeof v === "string" && v !== "") { if (cell.t === "d" || /^\d{4}-\d{2}-\d{2}$/.test(v)) d++; else s++; }
    }
    if (!n && !s && !d && !b) continue;
    const kind = [n ? `${n} num${fmt ? ` [${fmt}]` : ""}` : "", s ? `${s} text` : "", d ? `${d} date` : "", b ? `${b} bool` : "", f ? `${f} formulas` : ""].filter(Boolean).join(", ");
    prof.push(`${colToLetter(c)}: ${kind}${n > 1 ? ` sum=${Math.round(sum * 100) / 100}` : ""}`);
  }
  if (prof.length) lines.push(`columns (rows ${first + 1}–${ur.end.row + 1}): ${prof.join(" · ")}`);
  const regions = formulaRegions(sheet);
  if (regions.length) lines.push(`formula regions: ${regions.slice(0, 24).map((r) => `${r.range}${r.count > 1 ? ` ×${r.count} like` : ""} {${r.example}}`).join(" · ")}${regions.length > 24 ? ` … +${regions.length - 24} more` : ""}`);
  const errs = Object.entries(computed[sheet.id] ?? {}).filter(([, v]) => v.t === "e");
  if (errs.length) lines.push(`ERRORS: ${errs.slice(0, 10).map(([ref, v]) => `${ref} ${v.v}`).join(", ")}${errs.length > 10 ? ` … +${errs.length - 10}` : ""}`);
  if (sheet.charts.length) lines.push(`charts: ${sheet.charts.map((c) => `${c.id} ${c.type} "${c.title}" data=${c.range}${c.categoryRange ? ` cats=${c.categoryRange}` : ""}`).join("; ")}`);
  if (sheet.conditionalFormats.length) lines.push(`conditional formats: ${sheet.conditionalFormats.slice(0, 8).map((c) => `${c.range} ${c.rule.kind}`).join("; ")}`);
  if (sheet.localNames && Object.keys(sheet.localNames).length) lines.push(`sheet names: ${Object.entries(sheet.localNames).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  // data: whole sheet when small, otherwise a head/tail preview
  const rowsToShow: number[] = [];
  if (cells <= SMALL_SHEET_CELLS) for (let r = ur.start.row; r <= ur.end.row; r++) rowsToShow.push(r);
  else {
    const head = opts.previewRows ?? 5;
    for (let r = ur.start.row; r <= Math.min(ur.end.row, ur.start.row + head); r++) rowsToShow.push(r);
    for (let r = Math.max(ur.end.row - 1, ur.start.row + head + 1); r <= ur.end.row; r++) rowsToShow.push(r);
  }
  let prev = -1;
  for (const r of rowsToShow) {
    const parts: string[] = [];
    for (let c = ur.start.col; c <= ur.end.col && parts.length < 30; c++) {
      const ref = toA1(r, c);
      const cell = sheet.cells[ref];
      if (!cell || (cell.v === undefined && !cell.f)) continue;
      const v = valueOf(sheet, computed, ref);
      const raw = v === null || v === undefined ? "" : typeof v === "string" ? JSON.stringify(v).slice(0, 60) : String(v);
      parts.push(`${colToLetter(c)}=${raw}${cell.f ? `{${cell.f}}` : ""}`);
    }
    if (!parts.length) continue;
    if (prev >= 0 && r > prev + 1) lines.push(`… rows ${prev + 2}–${r} omitted; use get_range`);
    lines.push(`r${r + 1}: ${parts.join(" ")}`);
    prev = r;
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ audit

export type AuditKind = "error" | "circular" | "inconsistent" | "hardcoded_in_formula" | "hardcoded_in_region" | "sum_gap" | "number_as_text";
export interface AuditFinding { severity: "high" | "medium" | "low"; kind: AuditKind; sheet: string; ref: string; formula?: string; detail: string; suggestion?: string; root?: boolean }

/** Constants that are units, not assumptions. */
const UNIT_CONSTANTS = new Set([0, 1, 2, 3, 4, 7, 10, 12, 24, 52, 60, 100, 360, 365, 366, 1000, -1]);
/** Function argument positions that are structural (digits, column indexes, match types…), not assumptions. */
const STRUCTURAL_ARGS: Record<string, number[]> = { ROUND: [1], ROUNDUP: [1], ROUNDDOWN: [1], VLOOKUP: [2, 3], HLOOKUP: [2, 3], INDEX: [1, 2], MATCH: [2], XMATCH: [2, 3], CHOOSE: [0], LEFT: [1], RIGHT: [1], MID: [1, 2], DATE: [0, 1, 2], TEXT: [1], LARGE: [1], SMALL: [1], OFFSET: [1, 2, 3, 4], WEEKDAY: [1], YEARFRAC: [2], DATEDIF: [2], EOMONTH: [1], TIME: [0, 1, 2], SUBTOTAL: [0], AGGREGATE: [0, 1], RANK: [2], MOD: [1], POWER: [1], FIXED: [1] };

function hardcodedConstants(formula: string): number[] {
  let ast: FNode;
  try { ast = parseFormula(formula); } catch { return []; }
  const skip = new Set<FNode>();
  walk(ast, (n) => { if (n.k === "func") for (const i of STRUCTURAL_ARGS[n.name] ?? []) if (n.args[i]) walk(n.args[i], (x) => skip.add(x)); });
  const out: number[] = [];
  let hasRef = false;
  walk(ast, (n) => { if (n.k === "ref" || n.k === "name") hasRef = true; if (n.k === "num" && !skip.has(n) && !UNIT_CONSTANTS.has(n.v)) out.push(n.v); });
  return hasRef ? out : [];
}

function refsOf(formula: string): { sheet?: string; range: RangeRef }[] {
  const out: { sheet?: string; range: RangeRef }[] = [];
  for (const t of tokenizeFormula(formula)) if (t.kind === "ref" && t.start) out.push({ sheet: t.sheet, range: normalizeRange({ start: t.start, end: t.end ?? t.start }) });
  return out;
}

export function auditFormulas(wb: Workbook, computed: Computed, opts: { sheetId?: string; range?: RangeRef } = {}): { findings: AuditFinding[]; counts: Record<AuditKind, number>; formulasChecked: number } {
  const findings: AuditFinding[] = [];
  let checked = 0;
  const inScope = (row: number, col: number) => !opts.range || (row >= opts.range.start.row && row <= opts.range.end.row && col >= opts.range.start.col && col <= opts.range.end.col);
  for (const sheet of wb.sheets) {
    if (opts.sheetId && sheet.id !== opts.sheetId) continue;
    const comp = computed[sheet.id] ?? {};
    const byCol = new Map<number, { row: number; ref: string; f: string; shape: string }[]>();
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (!cell.f) continue;
      const p = parseA1(ref);
      if (!inScope(p.row, p.col)) continue;
      checked++;
      const cc = comp[ref];
      if (cc?.t === "e") {
        const err = String(cc.v);
        if (err === "#CYCLE!") findings.push({ severity: "high", kind: "circular", sheet: sheet.name, ref, formula: cell.f, detail: "Circular reference: the formula depends on its own result.", suggestion: "Break the loop — reference an input cell instead of a cell that depends on this one." });
        else {
          // root cause = none of its same-sheet single-cell precedents is itself an error
          const upstreamError = refsOf(cell.f).some((r) => !r.sheet && r.range.start.row === r.range.end.row && r.range.start.col === r.range.end.col && comp[toA1(r.range.start.row, r.range.start.col)]?.t === "e");
          findings.push({ severity: "high", kind: "error", sheet: sheet.name, ref, formula: cell.f, detail: `Evaluates to ${err}${upstreamError ? " (propagated from a precedent)" : ""}.`, root: !upstreamError, suggestion: err === "#DIV/0!" ? "Guard the divisor, e.g. =IF(divisor=0,0,…) or IFERROR." : err === "#REF!" ? "A referenced cell was deleted; re-point the reference." : err === "#NAME?" ? "Unknown function or name; check spelling and defined names." : err === "#N/A" ? "Lookup found no match; check keys or wrap in IFERROR/IFNA with an explicit 'not found'." : "Check operand types (text vs numbers) and argument ranges." });
        }
      }
      const consts = hardcodedConstants(cell.f);
      if (consts.length) findings.push({ severity: "medium", kind: "hardcoded_in_formula", sheet: sheet.name, ref, formula: cell.f, detail: `Hardcoded number(s) ${consts.slice(0, 4).join(", ")} inside a formula.`, suggestion: "Move assumptions to a labeled input cell (or named range) and reference it with an absolute reference." });
      const list = byCol.get(p.col) ?? [];
      list.push({ row: p.row, ref, f: cell.f, shape: toR1C1(cell.f, p.row, p.col) });
      byCol.set(p.col, list);
      // SUM range that skips numbers directly above it
      const m = /^=\s*SUM\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)\s*$/i.exec(cell.f);
      if (m && m[1].toUpperCase() === m[3].toUpperCase() && letterToCol(m[1]) === p.col) {
        const endRow = Number(m[4]) - 1, startRow = Number(m[2]) - 1;
        const skipped: string[] = [];
        for (let r = endRow + 1; r < p.row; r++) { const v = valueOf(sheet, computed, toA1(r, p.col)); if (typeof v === "number") skipped.push(toA1(r, p.col)); }
        let above = startRow - 1;
        while (above >= 0 && typeof valueOf(sheet, computed, toA1(above, p.col)) === "number" && !sheet.cells[toA1(above, p.col)]?.f) { skipped.push(toA1(above, p.col)); above--; }
        if (skipped.length) findings.push({ severity: "medium", kind: "sum_gap", sheet: sheet.name, ref, formula: cell.f, detail: `SUM range ${m[1]}${m[2]}:${m[3]}${m[4]} leaves out adjacent number(s) ${skipped.slice(0, 5).join(", ")}.`, suggestion: "Extend the range to include every detail row, or confirm the exclusion is intended." });
      }
    }
    // inconsistent formulas and numbers typed over formula regions
    for (const [col, list] of byCol) {
      list.sort((a, b) => a.row - b.row);
      if (list.length >= 3) {
        const counts = new Map<string, number>();
        for (const it of list) counts.set(it.shape, (counts.get(it.shape) ?? 0) + 1);
        const [common, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (n >= Math.max(2, list.length * 0.6)) {
          list.forEach((it, i) => {
            if (it.shape === common || (counts.get(it.shape) ?? 0) > 2) return;
            const isTotal = i === list.length - 1 && /\b(SUM|SUBTOTAL|AGGREGATE)\(/i.test(it.f);
            if (isTotal) return;
            const neighbour = list.find((x) => x.shape === common)!;
            findings.push({ severity: "medium", kind: "inconsistent", sheet: sheet.name, ref: it.ref, formula: it.f, detail: `Formula differs from the rest of column ${colToLetter(col)} (e.g. ${neighbour.ref} ${neighbour.f}).`, suggestion: "Confirm the exception is intended or refill the column from the common formula." });
          });
        }
        // constants sitting inside the span of a formula column
        const rows = list.map((x) => x.row);
        const lo = rows[0], hi = rows[rows.length - 1];
        for (let r = lo + 1; r < hi; r++) {
          const ref = toA1(r, col);
          const c = sheet.cells[ref];
          if (c && !c.f && typeof c.v === "number" && inScope(r, col)) findings.push({ severity: "high", kind: "hardcoded_in_region", sheet: sheet.name, ref, detail: `A typed number (${c.v}) sits inside the formula region ${toA1(lo, col)}:${toA1(hi, col)}.`, suggestion: "Replace it with the column's formula or document why it is an override." });
        }
      }
    }
    // numbers stored as text in numeric columns
    const ur = usedRange(sheet);
    if (ur) {
      for (let c = ur.start.col; c <= ur.end.col; c++) {
        let nums = 0; const textNums: string[] = [];
        for (let r = ur.start.row; r <= ur.end.row; r++) {
          if (!inScope(r, c)) continue;
          const cell = sheet.cells[toA1(r, c)];
          if (!cell || cell.f) continue;
          if (typeof cell.v === "number") nums++;
          else if (typeof cell.v === "string" && cell.t !== "d" && /^-?\$?[\d,]+(\.\d+)?%?$/.test(cell.v.trim()) && /\d/.test(cell.v)) textNums.push(toA1(r, c));
        }
        if (nums >= 2 && textNums.length) for (const ref of textNums.slice(0, 10)) findings.push({ severity: "low", kind: "number_as_text", sheet: sheet.name, ref, detail: "Number stored as text in a numeric column; SUM and lookups will skip it.", suggestion: "Re-enter it as a number." });
      }
    }
  }
  const counts = { error: 0, circular: 0, inconsistent: 0, hardcoded_in_formula: 0, hardcoded_in_region: 0, sum_gap: 0, number_as_text: 0 } as Record<AuditKind, number>;
  for (const f of findings) counts[f.kind]++;
  const rank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { findings, counts, formulasChecked: checked };
}

// ------------------------------------------------------------------ tracing

export interface TraceNode { sheet: string; ref: string; depth: number; formula?: string; value: CellValue; display: string; via?: string }

function resolveName(wb: Workbook, sheet: Sheet, name: string): { sheet: Sheet; range: RangeRef } | null {
  const ref = sheet.localNames?.[name] ?? wb.namedRanges[name] ?? Object.entries(wb.namedRanges).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  if (!ref) return null;
  try {
    const p = parseRange(ref);
    const target = p.sheet ? wb.sheets.find((s) => s.name === p.sheet) : sheet;
    return target ? { sheet: target, range: normalizeRange(p) } : null;
  } catch { return null; }
}

/** Cells a formula reads, as (sheet, range) pairs; names resolved. */
export function formulaInputs(wb: Workbook, sheet: Sheet, formula: string): { sheet: Sheet; range: RangeRef; via?: string }[] {
  const out: { sheet: Sheet; range: RangeRef; via?: string }[] = [];
  for (const r of refsOf(formula)) {
    const target = r.sheet ? wb.sheets.find((s) => s.name === r.sheet) : sheet;
    if (target) out.push({ sheet: target, range: r.range });
  }
  let names: string[] = [];
  try { names = formulaFacts(formula).names; } catch { names = []; }
  for (const n of names) { const res = resolveName(wb, sheet, n); if (res) out.push({ ...res, via: n }); }
  return out;
}

const TRACE_CAP = 150;

export function tracePrecedents(wb: Workbook, computed: Computed, sheet: Sheet, ref: string, depth = 2): TraceNode[] {
  const out: TraceNode[] = [];
  const seen = new Set<string>();
  const visit = (s: Sheet, r: string, d: number) => {
    const cell = s.cells[r];
    if (!cell?.f || d > depth) return;
    for (const inp of formulaInputs(wb, s, cell.f)) {
      const n = normalizeRange(inp.range);
      const size = (n.end.row - n.start.row + 1) * (n.end.col - n.start.col + 1);
      if (size > 1) {
        const key = `${inp.sheet.id}!${rangeToA1(n)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ sheet: inp.sheet.name, ref: rangeToA1(n), depth: d, value: null, display: `${size} cells`, via: inp.via });
        if (size <= 40) for (let rr = n.start.row; rr <= n.end.row; rr++) for (let cc = n.start.col; cc <= n.end.col; cc++) visit(inp.sheet, toA1(rr, cc), d + 1);
        continue;
      }
      const cref = toA1(n.start.row, n.start.col);
      const key = `${inp.sheet.id}!${cref}`;
      if (seen.has(key) || out.length >= TRACE_CAP) continue;
      seen.add(key);
      const c = inp.sheet.cells[cref];
      out.push({ sheet: inp.sheet.name, ref: cref, depth: d, formula: c?.f, value: valueOf(inp.sheet, computed, cref), display: displayOf(wb, inp.sheet, computed, cref), via: inp.via });
      visit(inp.sheet, cref, d + 1);
    }
  };
  visit(sheet, ref, 1);
  return out;
}

export function traceDependents(wb: Workbook, computed: Computed, sheet: Sheet, ref: string, depth = 2): TraceNode[] {
  // reverse index: formula cell → its inputs
  const index: { sheet: Sheet; ref: string; inputs: { sheet: Sheet; range: RangeRef; via?: string }[] }[] = [];
  for (const s of wb.sheets) for (const [r, c] of Object.entries(s.cells)) if (c.f) index.push({ sheet: s, ref: r, inputs: formulaInputs(wb, s, c.f) });
  const out: TraceNode[] = [];
  const seen = new Set<string>([`${sheet.id}!${ref}`]);
  let frontier: { sheet: Sheet; ref: string }[] = [{ sheet, ref }];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: { sheet: Sheet; ref: string }[] = [];
    for (const t of frontier) {
      const p = parseA1(t.ref);
      for (const e of index) {
        const hit = e.inputs.find((i) => i.sheet.id === t.sheet.id && p.row >= i.range.start.row && p.row <= i.range.end.row && p.col >= i.range.start.col && p.col <= i.range.end.col);
        if (!hit) continue;
        const key = `${e.sheet.id}!${e.ref}`;
        if (seen.has(key) || out.length >= TRACE_CAP) continue;
        seen.add(key);
        out.push({ sheet: e.sheet.name, ref: e.ref, depth: d, formula: e.sheet.cells[e.ref].f, value: valueOf(e.sheet, computed, e.ref), display: displayOf(wb, e.sheet, computed, e.ref), via: hit.via });
        next.push({ sheet: e.sheet, ref: e.ref });
      }
    }
    frontier = next;
  }
  return out;
}

// ------------------------------------------------------------------ dates

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()); if (!m) throw new Error(`Invalid date "${s}" (use yyyy-mm-dd)`); const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (iso(d) !== s.trim()) throw new Error(`Invalid date "${s}"`); return d; };
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const nthWeekday = (y: number, m: number, wd: number, n: number) => { const d = new Date(Date.UTC(y, m, 1)); const off = (wd - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + (n - 1) * 7)); };
const lastWeekday = (y: number, m: number, wd: number) => { const d = new Date(Date.UTC(y, m + 1, 0)); const off = (d.getUTCDay() - wd + 7) % 7; return new Date(Date.UTC(y, m + 1, -off)); };
const observed = (d: Date) => (d.getUTCDay() === 6 ? addDays(d, -1) : d.getUTCDay() === 0 ? addDays(d, 1) : d);

/** US federal legal holidays (5 U.S.C. § 6103) with weekend observance, as ISO dates. */
export function usFederalHolidays(year: number): { date: string; name: string }[] {
  const h: { date: Date; name: string }[] = [
    { date: observed(new Date(Date.UTC(year, 0, 1))), name: "New Year's Day" },
    { date: nthWeekday(year, 0, 1, 3), name: "Birthday of Martin Luther King, Jr." },
    { date: nthWeekday(year, 1, 1, 3), name: "Washington's Birthday" },
    { date: lastWeekday(year, 4, 1), name: "Memorial Day" },
    ...(year >= 2021 ? [{ date: observed(new Date(Date.UTC(year, 5, 19))), name: "Juneteenth National Independence Day" }] : []),
    { date: observed(new Date(Date.UTC(year, 6, 4))), name: "Independence Day" },
    { date: nthWeekday(year, 8, 1, 1), name: "Labor Day" },
    { date: nthWeekday(year, 9, 1, 2), name: "Columbus Day" },
    { date: observed(new Date(Date.UTC(year, 10, 11))), name: "Veterans Day" },
    { date: nthWeekday(year, 10, 4, 4), name: "Thanksgiving Day" },
    { date: observed(new Date(Date.UTC(year, 11, 25))), name: "Christmas Day" },
  ];
  return h.map((x) => ({ date: iso(x.date), name: x.name }));
}

export type DateOp = "add_business_days" | "add_calendar_days" | "add_months" | "business_days_between" | "calendar_days_between" | "deadline" | "next_business_day" | "is_business_day" | "holidays";

export interface DateMathInput { op: DateOp; date?: string; end?: string; days?: number; months?: number; holidays?: string[]; calendar?: "us_federal" | "none"; year?: number }

export interface DateMathResult { op: DateOp; result: string | number | boolean | { date: string; name: string }[]; weekday?: string; detail: string; formula?: string; holidaysApplied: string[]; rule?: string }

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Deterministic court-calendar date arithmetic. */
export function dateMath(input: DateMathInput): DateMathResult {
  const cal = input.calendar ?? "us_federal";
  const extra = new Set((input.holidays ?? []).map((h) => iso(utc(h))));
  const holidayCache = new Map<number, Map<string, string>>();
  const holidayName = (d: Date): string | null => {
    const s = iso(d);
    if (extra.has(s)) return "custom holiday";
    if (cal !== "us_federal") return null;
    const y = d.getUTCFullYear();
    if (!holidayCache.has(y)) holidayCache.set(y, new Map(usFederalHolidays(y).map((h) => [h.date, h.name])));
    return holidayCache.get(y)!.get(s) ?? null;
  };
  const applied = new Set<string>();
  const isBiz = (d: Date) => { const wd = d.getUTCDay(); if (wd === 0 || wd === 6) return false; const h = holidayName(d); if (h) { applied.add(`${iso(d)} ${h}`); return false; } return true; };
  const excelDate = (s: string) => { const [y, m, d] = s.split("-").map(Number); return `DATE(${y},${m},${d})`; };
  const res = (op: DateOp, result: DateMathResult["result"], detail: string, formula?: string, rule?: string): DateMathResult => ({ op, result, weekday: typeof result === "string" ? WEEKDAYS[utc(result).getUTCDay()] : undefined, detail, formula, holidaysApplied: [...applied], rule });
  const need = (v: unknown, what: string) => { if (v === undefined || v === null || v === "") throw new Error(`${input.op} needs ${what}`); };
  switch (input.op) {
    case "holidays": { const y = input.year ?? new Date().getUTCFullYear(); return { op: "holidays", result: usFederalHolidays(y), detail: `US federal holidays for ${y} (weekend dates observed on the adjacent Friday/Monday).`, holidaysApplied: [] }; }
    case "add_calendar_days": { need(input.date, "date"); need(input.days, "days"); const d = addDays(utc(input.date!), input.days!); return res("add_calendar_days", iso(d), `${input.date} + ${input.days} calendar day(s).`, `=${excelDate(input.date!)}+${input.days}`); }
    case "add_months": { need(input.date, "date"); need(input.months, "months"); const s = utc(input.date!); const t = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + input.months!, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(s.getUTCDate(), last)); return res("add_months", iso(t), `${input.date} + ${input.months} month(s) (end-of-month clamped, like EDATE).`, `=EDATE(${excelDate(input.date!)},${input.months})`); }
    case "add_business_days": {
      need(input.date, "date"); need(input.days, "days");
      let d = utc(input.date!); let n = Math.abs(input.days!); const step = input.days! < 0 ? -1 : 1;
      while (n > 0) { d = addDays(d, step); if (isBiz(d)) n--; }
      return res("add_business_days", iso(d), `${input.days} business day(s) from ${input.date}, skipping weekends${cal === "us_federal" ? " and US federal holidays" : ""}${extra.size ? " and the listed holidays" : ""}.`, `=WORKDAY(${excelDate(input.date!)},${input.days}${cal === "us_federal" || extra.size ? ",<holiday range>" : ""})`);
    }
    case "business_days_between": {
      need(input.date, "date"); need(input.end, "end");
      const a = utc(input.date!), b = utc(input.end!); const sign = b >= a ? 1 : -1;
      let n = 0; for (let d = a; sign > 0 ? d <= b : d >= b; d = addDays(d, sign)) if (isBiz(d)) n++;
      return res("business_days_between", sign * n, `Business days from ${input.date} to ${input.end} inclusive (NETWORKDAYS semantics).`, `=NETWORKDAYS(${excelDate(input.date!)},${excelDate(input.end!)}${cal === "us_federal" || extra.size ? ",<holiday range>" : ""})`);
    }
    case "calendar_days_between": { need(input.date, "date"); need(input.end, "end"); const n = Math.round((utc(input.end!).getTime() - utc(input.date!).getTime()) / DAY); return res("calendar_days_between", n, `Calendar days from ${input.date} to ${input.end} (end minus start).`, `=${excelDate(input.end!)}-${excelDate(input.date!)}`); }
    case "next_business_day": { need(input.date, "date"); let d = utc(input.date!); while (!isBiz(d)) d = addDays(d, 1); return res("next_business_day", iso(d), `First business day on or after ${input.date}.`, `=WORKDAY(${excelDate(input.date!)}-1,1${cal === "us_federal" || extra.size ? ",<holiday range>" : ""})`); }
    case "is_business_day": { need(input.date, "date"); const d = utc(input.date!); const ok = isBiz(d); return res("is_business_day", ok, `${input.date} is a ${WEEKDAYS[d.getUTCDay()]}${ok ? "" : " (not a business day)"}.`, `=NETWORKDAYS(${excelDate(input.date!)},${excelDate(input.date!)})=1`); }
    case "deadline": {
      need(input.date, "date"); need(input.days, "days");
      // Fed. R. Civ. P. 6(a)(1): exclude the trigger day, count every day, and if the last day is a Saturday,
      // Sunday or legal holiday, continue to the next day that is not.
      let d = addDays(utc(input.date!), input.days!);
      const naive = iso(d);
      while (!isBiz(d)) d = addDays(d, 1);
      return res("deadline", iso(d), `${input.days} day(s) after ${input.date} is ${naive}${naive !== iso(d) ? `, which is not a business day, so the period runs to ${iso(d)}` : ""}.`, `=WORKDAY(${excelDate(input.date!)}+${input.days}-1,1${cal === "us_federal" || extra.size ? ",<holiday range>" : ""})`, "Fed. R. Civ. P. 6(a)(1)(C) period computation (verify local rules and any service-method extension, e.g. Rule 6(d)).");
    }
  }
}

// ------------------------------------------------------------------ builders

export interface Placement { sheetId: string; anchor: { row: number; col: number } }

function sheetRef(from: Sheet, to: Sheet, range: string): string {
  return from.id === to.id ? range : `${quoteSheet(to.name)}!${range}`;
}

export interface SummarizeInput {
  source: Sheet;
  /** Data range including the header row. */
  range: RangeRef;
  groupBy: string[];
  values: { column: string; agg: "sum" | "count" | "average" | "min" | "max"; label?: string }[];
  target: Sheet;
  anchor: { row: number; col: number };
  totalRow?: boolean;
}

/** Group-by summary as live SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS formulas (keys are data labels; every number is a formula). */
export function buildSummaryOps(wb: Workbook, computed: Computed, input: SummarizeInput): { ops: SheetOp[]; range: string; groups: number } {
  const { source, range, target, anchor } = input;
  const header = range.start.row;
  const first = header + 1, last = range.end.row;
  if (last < first) throw new Error("The source range has no data rows below its header");
  const col = (L: string) => { const c = letterToCol(L.toUpperCase()); if (c < range.start.col || c > range.end.col) throw new Error(`Column ${L} is outside ${rangeToA1(range)}`); return c; };
  const keyCols = input.groupBy.map(col);
  if (!keyCols.length) throw new Error("group_by needs at least one column");
  const valCols = input.values.map((v) => ({ ...v, c: col(v.column) }));
  const colRange = (c: number) => sheetRef(target, source, `$${colToLetter(c)}$${first + 1}:$${colToLetter(c)}$${last + 1}`);
  // distinct key tuples in first-seen order, then sorted for a stable table
  const seen = new Map<string, CellValue[]>();
  for (let r = first; r <= last; r++) {
    const tuple = keyCols.map((c) => valueOf(source, computed, toA1(r, c)));
    if (tuple.every((v) => v === null || v === "")) continue;
    const k = JSON.stringify(tuple);
    if (!seen.has(k)) seen.set(k, tuple);
  }
  const groups = [...seen.values()].sort((a, b) => { for (let i = 0; i < a.length; i++) { const x = String(a[i] ?? ""), y = String(b[i] ?? ""); const n = x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }); if (n) return n; } return 0; });
  if (groups.length > 500) throw new Error(`Too many groups (${groups.length}); group by a coarser column`);
  const headerName = (c: number) => { const v = valueOf(source, computed, toA1(header, c)); return v === null || v === "" ? colToLetter(c) : String(v); };
  const cells: CellInput[] = [];
  const hdr = [...keyCols.map(headerName), ...valCols.map((v) => v.label ?? `${v.agg === "count" ? "Count" : v.agg[0].toUpperCase() + v.agg.slice(1)} of ${headerName(v.c)}`)];
  hdr.forEach((h, j) => cells.push({ ref: toA1(anchor.row, anchor.col + j), value: h, style: { bold: true, fill: "#1F3A5F", color: "#FFFFFF", border: "thin" } }));
  groups.forEach((g, i) => {
    const r = anchor.row + 1 + i;
    g.forEach((v, j) => cells.push({ ref: toA1(r, anchor.col + j), value: v, style: { border: "thin" } }));
    const crit = keyCols.map((kc, j) => `${colRange(kc)},$${colToLetter(anchor.col + j)}${r + 1}`).join(",");
    valCols.forEach((v, j) => {
      const vr = colRange(v.c);
      const f = v.agg === "sum" ? `=SUMIFS(${vr},${crit})` : v.agg === "count" ? `=COUNTIFS(${crit})` : v.agg === "average" ? `=IFERROR(AVERAGEIFS(${vr},${crit}),0)` : v.agg === "min" ? `=MINIFS(${vr},${crit})` : `=MAXIFS(${vr},${crit})`;
      cells.push({ ref: toA1(r, anchor.col + keyCols.length + j), formula: f, style: { border: "thin" } });
    });
  });
  const lastRow = anchor.row + groups.length;
  if (input.totalRow !== false && groups.length) {
    const tr = lastRow + 1;
    cells.push({ ref: toA1(tr, anchor.col), value: "Total", style: { bold: true, fill: "#EEF2F7", border: "top" } });
    for (let j = 1; j < keyCols.length; j++) cells.push({ ref: toA1(tr, anchor.col + j), value: null, style: { bold: true, fill: "#EEF2F7", border: "top" } });
    valCols.forEach((v, j) => {
      const c = anchor.col + keyCols.length + j;
      const colL = colToLetter(c);
      const vr = colRange(v.c);
      const f = v.agg === "sum" || v.agg === "count" ? `=SUM(${colL}${anchor.row + 2}:${colL}${lastRow + 1})` : v.agg === "average" ? `=AVERAGE(${vr})` : v.agg === "min" ? `=MIN(${vr})` : `=MAX(${vr})`;
      cells.push({ ref: toA1(tr, c), formula: f, style: { bold: true, fill: "#EEF2F7", border: "top" } });
    });
  }
  const ops: SheetOp[] = [{ type: "set_cells", sheet: target.id, cells }];
  // carry the source number formats onto aggregated columns
  valCols.forEach((v, j) => {
    if (v.agg === "count") return;
    const srcStyleId = source.cells[toA1(first, v.c)]?.s;
    const numFmt = srcStyleId ? wb.styles[srcStyleId]?.numFmt : undefined;
    if (!numFmt) return;
    const L = colToLetter(anchor.col + keyCols.length + j);
    ops.push({ type: "set_number_format", sheet: target.id, range: `${L}${anchor.row + 2}:${L}${lastRow + (input.totalRow !== false ? 2 : 1)}`, numFmt });
  });
  const endCol = anchor.col + keyCols.length + valCols.length - 1;
  const endRow = lastRow + (input.totalRow !== false && groups.length ? 1 : 0);
  return { ops, range: `${toA1(anchor.row, anchor.col)}:${toA1(endRow, endCol)}`, groups: groups.length };
}

export interface InterestPeriodInput { from: string; to?: string; rate: number }

export interface DamagesInput {
  target: Sheet;
  anchor: { row: number; col: number };
  principal: number | string;
  start: string;
  end: string;
  rates: InterestPeriodInput[];
  basis?: 360 | 365;
  compounding?: "simple" | "annual";
  splitByYear?: boolean;
  title?: string;
}

/** Period boundaries (deterministic date logic); all money math is written as formulas. */
export function interestPeriods(input: Pick<DamagesInput, "start" | "end" | "rates" | "splitByYear">): { from: string; to: string; rate: number }[] {
  const start = utc(input.start), end = utc(input.end);
  if (end <= start) throw new Error("end must be after start");
  const rates = [...input.rates].sort((a, b) => a.from.localeCompare(b.from));
  if (!rates.length) throw new Error("rates is empty");
  const bounds = new Set<string>([iso(start), iso(end)]);
  for (const r of rates) { const f = utc(r.from); if (f > start && f < end) bounds.add(iso(f)); if (r.to) { const t = utc(r.to); if (t > start && t < end) bounds.add(iso(t)); } }
  if (input.splitByYear) for (let y = start.getUTCFullYear() + 1; y <= end.getUTCFullYear(); y++) { const b = new Date(Date.UTC(y, 0, 1)); if (b > start && b < end) bounds.add(iso(b)); }
  const pts = [...bounds].sort();
  const out: { from: string; to: string; rate: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const from = pts[i];
    const applicable = rates.filter((r) => r.from <= from && (!r.to || r.to > from));
    const rate = (applicable[applicable.length - 1] ?? rates[0]).rate;
    out.push({ from, to: pts[i + 1], rate });
  }
  return out;
}

export function buildDamagesOps(input: DamagesInput): { ops: SheetOp[]; range: string; totalRef: string; interestRef: string; periods: number } {
  const { target, anchor } = input;
  const basis = input.basis ?? 365;
  const periods = interestPeriods(input);
  if (periods.length > 400) throw new Error("Too many periods; do not split by year for very long spans");
  const A = (r: number, c: number) => toA1(anchor.row + r, anchor.col + c);
  const abs = (r: number, c: number) => `$${colToLetter(anchor.col + c)}$${anchor.row + r + 1}`;
  const cells: CellInput[] = [];
  const hdr = { bold: true, fill: "#1F3A5F", color: "#FFFFFF", border: "thin" as const };
  cells.push({ ref: A(0, 0), value: input.title ?? "Prejudgment interest schedule", style: { bold: true, fontSize: 14 } });
  cells.push({ ref: A(1, 0), value: "Principal", style: { bold: true } });
  if (typeof input.principal === "number") cells.push({ ref: A(1, 1), value: input.principal, style: { numFmt: "$#,##0.00", fill: "#FFF7E6" } });
  else cells.push({ ref: A(1, 1), formula: input.principal.startsWith("=") ? input.principal : `=${input.principal}`, style: { numFmt: "$#,##0.00" } });
  cells.push({ ref: A(2, 0), value: "Day-count basis", style: { bold: true } });
  cells.push({ ref: A(2, 1), value: basis, style: { fill: "#FFF7E6" } });
  cells.push({ ref: A(3, 0), value: "Compounding", style: { bold: true } });
  cells.push({ ref: A(3, 1), value: input.compounding ?? "simple" });
  const H = 5;
  ["Period start", "Period end", "Days", "Annual rate", "Interest", "Cumulative interest"].forEach((h, j) => cells.push({ ref: A(H, j), value: h, style: hdr }));
  periods.forEach((p, i) => {
    const r = H + 1 + i;
    const row = anchor.row + r + 1;
    const L = (c: number) => colToLetter(anchor.col + c);
    cells.push({ ref: A(r, 0), value: p.from, style: { numFmt: "yyyy-mm-dd", border: "thin" } });
    cells.push({ ref: A(r, 1), value: p.to, style: { numFmt: "yyyy-mm-dd", border: "thin" } });
    cells.push({ ref: A(r, 2), formula: `=${L(1)}${row}-${L(0)}${row}`, style: { numFmt: "0", border: "thin" } });
    cells.push({ ref: A(r, 3), value: p.rate, style: { numFmt: "0.000%", border: "thin", fill: "#FFF7E6" } });
    const base = input.compounding === "annual" && i > 0 ? `(${abs(1, 1)}+${L(5)}${row - 1})` : abs(1, 1);
    cells.push({ ref: A(r, 4), formula: `=ROUND(${base}*${L(3)}${row}*${L(2)}${row}/${abs(2, 1)},2)`, style: { numFmt: "$#,##0.00", border: "thin" } });
    cells.push({ ref: A(r, 5), formula: i === 0 ? `=${L(4)}${row}` : `=${L(5)}${row - 1}+${L(4)}${row}`, style: { numFmt: "$#,##0.00", border: "thin" } });
  });
  const first = anchor.row + H + 2, last = anchor.row + H + 1 + periods.length;
  const T = H + 1 + periods.length;
  const L = (c: number) => colToLetter(anchor.col + c);
  cells.push({ ref: A(T, 0), value: "Total", style: { bold: true, fill: "#EEF2F7", border: "top" } });
  cells.push({ ref: A(T, 2), formula: `=SUM(${L(2)}${first}:${L(2)}${last})`, style: { bold: true, fill: "#EEF2F7", border: "top", numFmt: "0" } });
  cells.push({ ref: A(T, 4), formula: `=SUM(${L(4)}${first}:${L(4)}${last})`, style: { bold: true, fill: "#EEF2F7", border: "top", numFmt: "$#,##0.00" } });
  cells.push({ ref: A(T + 1, 0), value: "Principal + interest", style: { bold: true } });
  cells.push({ ref: A(T + 1, 4), formula: `=${abs(1, 1)}+${L(4)}${anchor.row + T + 1}`, style: { bold: true, numFmt: "$#,##0.00" } });
  const ops: SheetOp[] = [{ type: "set_cells", sheet: target.id, cells }, { type: "autofit_columns", sheet: target.id, columns: [0, 1, 2, 3, 4, 5].map((j) => L(j)) }];
  return { ops, range: `${A(0, 0)}:${A(T + 1, 5)}`, totalRef: A(T + 1, 4), interestRef: A(T, 4), periods: periods.length };
}

export { isoToSerial, serialToISO };
