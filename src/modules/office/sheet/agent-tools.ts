/**
 * Spreadsheet agent tools. Read tools answer from the snapshot (model +
 * engine-computed values) with targeted ranges, never whole-workbook dumps.
 * Edit tools apply a SheetOp to the snapshot, recompute with the formula
 * engine, verify the result (new errors, circular references, computed values
 * of what was written) and register an EditProposal whose payload is the op
 * plus its base version, so the client rejects it if the target changed.
 *
 * All arithmetic is done by the engine or deterministic code: the agent writes
 * formulas and reads computed values back (constitution §53.3).
 *
 * Modes (constitution §31): draft = every tool; review = read tools, comments
 * and non-destructive suggested changes; ask = read tools only (edit tools are
 * not in the toolset at all).
 */
import { nanoid } from "nanoid";
import { colToLetter, letterToCol, normalizeRange, parseA1, quoteSheet, rangeSize, rangeToA1, toA1, type RangeRef } from "./a1";
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import { auditFormulas, buildDamagesOps, buildSummaryOps, dateMath, displayOf, formulaRegions, summarizeSheet, traceDependents, tracePrecedents, type DateOp } from "./analysis";
import { SheetEngine, formulaErrors } from "./engine";
import { parseFormula, say } from "./formula-ast";
import { getSheet, getStyle, resolveRange, usedRange, type CellBorders, type CellStyle, type CellValue, type CFRule, type ChartType, type DataValidation, type NumFmt, type Sheet } from "./model";
import { applyOp, describeOp, opTarget, type CellInput, type SheetOp } from "./ops";
import { hashValue } from "./hash";
import { proposalBase } from "./proposal-base";
import { cellValue, describeValues, displayValue, headerInfo, recompute, type SheetSnapshot } from "./snapshot";

type Ctx = OfficeAgentContext<SheetSnapshot>;
type AnyTool = ToolDef<never, unknown>;

/** Tool access per mode. Read tools are always available; edits are grouped so Ask mode gets none. */
export type ToolAccess = "read" | "suggest" | "edit";

const BORDER_EDGE = { type: "object", properties: { style: { type: "string", enum: ["thin", "medium", "thick", "dashed", "dotted", "double", "hair"] }, color: { type: "string" } }, required: ["style"] } as const;

const STYLE_SCHEMA = {
  type: "object",
  description: "Style patch. Omit a property to leave it unchanged; null clears it.",
  properties: {
    bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, strike: { type: "boolean" },
    align: { type: "string", enum: ["left", "center", "right", "justify", "centerContinuous"] },
    valign: { type: "string", enum: ["top", "middle", "bottom"] },
    wrap: { type: "boolean" },
    indent: { type: "integer", description: "Indent level (0–15)" },
    numFmt: { type: "string", description: "General | 0 | 0.00 | #,##0 | #,##0.00 | $#,##0.00 | $#,##0 | 0% | 0.00% | yyyy-mm-dd | mmm d yyyy | m/d/yyyy | text | accounting _(\"$\"* #,##0.00_);_(\"$\"* \\(#,##0.00\\);_(\"$\"* \"-\"??_);_(@_) | custom like #,##0.00;(#,##0.00)" },
    fill: { type: "string", description: "Background hex color, e.g. #1F3A5F" },
    color: { type: "string", description: "Text hex color" },
    fontSize: { type: "number" },
    fontFamily: { type: "string" },
    border: { type: "string", enum: ["none", "thin", "medium", "thick", "bottom", "top", "outline", "all"], description: "Shorthand applied to every cell" },
    borders: { type: "object", description: "Per-edge borders (overrides the shorthand)", properties: { top: BORDER_EDGE, right: BORDER_EDGE, bottom: BORDER_EDGE, left: BORDER_EDGE }, required: [] },
    locked: { type: "boolean", description: "false = editable when the sheet is protected" },
  },
  required: [],
} as const;

const RULE_SCHEMA = {
  type: "object",
  description: "Rule: {kind:'gt'|'lt', value} | {kind:'between', min, max} | {kind:'eq', value} | {kind:'contains', text} | {kind:'dueBefore', date:'today'|'yyyy-mm-dd', days?} | {kind:'top', count, bottom?} | {kind:'blank'} | {kind:'duplicate'} | {kind:'expression', formula} (written for the range's top-left cell, e.g. \"=$D2<TODAY()\") | {kind:'colorScale', stops:[{type:'min'|'max'|'num'|'percent'|'percentile', value?, color}]} | {kind:'dataBar', color}",
  properties: {
    kind: { type: "string", enum: ["gt", "lt", "between", "eq", "contains", "dueBefore", "top", "blank", "duplicate", "expression", "colorScale", "dataBar"] },
    value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] },
    min: { type: "number" }, max: { type: "number" },
    text: { type: "string" },
    date: { type: "string" }, days: { type: "integer" },
    count: { type: "integer" }, bottom: { type: "boolean" },
    formula: { type: "string" },
    color: { type: "string" },
    stops: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["min", "max", "num", "percent", "percentile"] }, value: { type: "string" }, color: { type: "string" } }, required: ["type", "color"] } },
  },
  required: ["kind"],
} as const;

function toRule(raw: Record<string, unknown>): CFRule {
  const kind = String(raw.kind);
  switch (kind) {
    case "gt": return { kind, value: Number(raw.value) };
    case "lt": return { kind, value: Number(raw.value) };
    case "between": return { kind, min: Number(raw.min), max: Number(raw.max) };
    case "eq": return { kind, value: raw.value as CellValue };
    case "contains": return { kind, text: String(raw.text ?? raw.value ?? "") };
    case "dueBefore": return { kind, date: String(raw.date ?? "today"), days: raw.days == null ? undefined : Number(raw.days) };
    case "top": return { kind, count: Number(raw.count ?? 10), bottom: Boolean(raw.bottom) };
    case "blank": return { kind };
    case "duplicate": return { kind };
    case "expression": { const f = String(raw.formula ?? "").replace(/^=/, ""); parseFormula(f); return { kind, formula: f }; }
    case "colorScale": { const stops = (raw.stops as { type: string; value?: string; color: string }[] | undefined) ?? [{ type: "min", color: "#F8696B" }, { type: "max", color: "#63BE7B" }]; if (stops.length < 2 || stops.length > 3) throw new Error("colorScale needs 2 or 3 stops"); return { kind, stops: stops.map((s) => ({ type: s.type as "min", color: s.color, ...(s.value !== undefined && s.value !== null ? { value: String(s.value) } : {}) })) }; }
    case "dataBar": return { kind, color: String(raw.color ?? "#638EC6") };
    default: throw new Error(`Unknown rule kind "${kind}"`);
  }
}

function cleanStyle(raw: Record<string, unknown> | null | undefined): Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === undefined) continue;
    if (k === "borders" && v && typeof v === "object") { const b: CellBorders = {}; for (const [e, x] of Object.entries(v as Record<string, unknown>)) if (x && typeof x === "object") (b as Record<string, unknown>)[e] = x; out.borders = Object.keys(b).length ? b : null; continue; }
    if (k === "locked") { out.locked = v === false ? false : null; continue; }
    out[k] = v;
  }
  return out as Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>>;
}

const letter = (c: string) => { const L = c.trim().toUpperCase(); if (!/^[A-Z]{1,3}$/.test(L)) throw new Error(`"${c}" is not a column letter`); return L; };

function rangeText(snapshot: SheetSnapshot, sheet: Sheet, rangeStr: string, opts: { maxCells?: number; valuesOnly?: boolean } = {}) {
  const maxCells = opts.maxCells ?? 600;
  const { sheet: target, range } = resolveRange(snapshot.workbook, rangeStr, sheet);
  const size = rangeSize(range);
  const rows: Record<string, unknown>[] = [];
  let n = 0;
  for (let r = range.start.row; r <= range.end.row; r++) {
    const row: Record<string, unknown> = { row: r + 1 };
    let any = false;
    for (let c = range.start.col; c <= range.end.col; c++) {
      const ref = toA1(r, c);
      const cell = target.cells[ref];
      if (!cell) continue;
      n++;
      if (n > maxCells) break;
      any = true;
      const v = cellValue(snapshot, target, ref);
      if (opts.valuesOnly) { row[colToLetter(c)] = cell.f ? { v, f: cell.f } : v; continue; }
      const entry: Record<string, unknown> = { v };
      if (cell.f) entry.f = cell.f;
      const st = getStyle(snapshot.workbook, cell);
      if (Object.keys(st).length) entry.s = st;
      const disp = displayValue(snapshot, target, ref);
      if (disp !== String(entry.v ?? "")) entry.display = disp;
      row[colToLetter(c)] = entry;
    }
    if (any) rows.push(row);
    if (n > maxCells) { rows.push({ truncated: true, note: `stopped after ${maxCells} cells; request a smaller range` }); break; }
  }
  return { sheet: target.name, range: rangeToA1(range), size, rows };
}

/** Tool name → access level. Anything not listed is an edit (fail closed). */
export const TOOL_ACCESS: Record<string, ToolAccess> = {
  get_workbook_summary: "read", get_sheet_overview: "read", get_range: "read", get_headers: "read", get_selection: "read", find_cells: "read",
  describe_data: "read", validate_formulas: "read", audit_formulas: "read", explain_formula: "read", trace_precedents: "read", trace_dependents: "read",
  evaluate_formula: "read", date_math: "read",
  add_comment: "suggest", set_cells: "suggest", write_range: "suggest", fill_range: "suggest", set_formula_column: "suggest", set_style: "suggest",
  set_number_format: "suggest", add_conditional_format: "suggest", set_data_validation: "suggest", create_named_range: "suggest",
};

export function toolAccess(name: string): ToolAccess { return TOOL_ACCESS[name] ?? "edit"; }

/** Filter a toolset for a mode: ask = read only; review = read + comments + non-destructive suggestions; draft = all. */
export function toolsForMode<T extends { name: string }>(tools: T[], mode: Ctx["mode"]): T[] {
  if (mode === "ask") return tools.filter((t) => toolAccess(t.name) === "read");
  if (mode === "review") return tools.filter((t) => toolAccess(t.name) !== "edit");
  return tools;
}

export function sheetAgentTools(ctx: Ctx): AnyTool[] {
  return toolsForMode(allSheetTools(ctx), ctx.mode);
}

function allSheetTools(ctx: Ctx): AnyTool[] {
  const s = ctx.snapshot;
  const wb = () => s.workbook;
  const sheetOf = (key?: string | null) => getSheet(wb(), key ?? s.activeSheet);

  /** Apply an op to the snapshot, recompute, verify and propose. */
  const edit = (op: SheetOp, meta: { title?: string; summary?: string; risk?: EditProposal["risk"]; readBack?: string[] } = {}) => {
    const before = s.workbook;
    const beforeErrors = new Set(formulaErrors(before, s.computed).map((e) => `${e.sheet}!${e.ref}`));
    const base = proposalBase(before, op);
    let next;
    try { next = applyOp(before, op); } catch (e) { throw new Error(`Cannot apply: ${(e as Error).message}`); }
    s.workbook = next;
    recompute(s);
    if (op.type === "add_sheet" || op.type === "set_active_sheet") s.activeSheet = next.sheets[next.activeSheet].name;
    if (op.type === "rename_sheet") { const sh = getSheet(next, op.sheet ?? s.activeSheet); if (before.sheets[before.activeSheet]?.id === sh.id) s.activeSheet = sh.name; }
    const target = opTarget(next, op);
    const suggestion = ctx.mode === "review";
    const p = ctx.propose({
      kind: op.type,
      title: `${suggestion ? "Suggested: " : ""}${meta.title ?? describeOp(op)}`,
      summary: meta.summary,
      target: target ? `${target.sheet}!${target.range}` : undefined,
      targetLabel: target ? (target.sheet === s.activeSheet ? target.range : `${target.sheet}!${target.range}`) : undefined,
      payload: { op, base, ...(suggestion ? { suggestion: true } : {}) },
      // shared-protocol summary of the base; the per-range hashes the client checks live in payload.base
      base: { hash: hashValue(base.map((b) => b.hash)) },
      risk: meta.risk ?? (op.type.startsWith("delete_") || op.type === "sort_range" || op.type === "clear_range" ? "medium" : "low"),
    });
    // verify: new errors / circular references, and the computed values of what was written
    const errors = formulaErrors(next, s.computed);
    const newErrors = errors.filter((e) => !beforeErrors.has(`${e.sheet}!${e.ref}`)).slice(0, 12);
    const results: { ref: string; formula: string; value: CellValue; display: string }[] = [];
    const readRefs = meta.readBack ?? (target ? [`${target.sheet}!${target.range}`] : []);
    for (const rr of readRefs) {
      try {
        const { sheet: sh, range } = resolveRange(next, rr, sheetOf(null));
        const n = normalizeRange(range);
        if ((n.end.row - n.start.row + 1) * (n.end.col - n.start.col + 1) > 5000) continue;
        for (let r = n.start.row; r <= n.end.row && results.length < 12; r++) for (let c = n.start.col; c <= n.end.col && results.length < 12; c++) {
          const ref = toA1(r, c); const cell = sh.cells[ref];
          if (cell?.f) results.push({ ref: sh.id === sheetOf(null).id ? ref : `${sh.name}!${ref}`, formula: cell.f, value: cellValue(s, sh, ref), display: displayValue(s, sh, ref) });
        }
      } catch { /* sheet-level target */ }
    }
    const circular = newErrors.some((e) => e.error === "#CYCLE!");
    return {
      ok: newErrors.length === 0,
      proposal: p.id,
      target: p.target,
      verify: { newErrors: newErrors.length ? newErrors : undefined, circular: circular || undefined, results: results.length ? results : undefined },
      ...(newErrors.length ? { action_required: `The edit introduced ${newErrors.length} formula error(s)${circular ? " including a circular reference" : ""}. Fix them (or explain why they are expected) before finishing.` } : {}),
    };
  };

  // ------------------------------------------------------------------ reads
  const get_workbook_summary = defineTool<{ sheet?: string; preview_rows?: number }>({
    name: "get_workbook_summary",
    description: "Compact summary of the workbook (or one sheet): per sheet the used range, header row, per-column type/format profile, formula regions (runs of the same formula), errors, charts, conditional formats, names, and a head/tail preview. Cheap; use it before targeted get_range reads.",
    parameters: { type: "object", properties: { sheet: { type: "string" }, preview_rows: { type: "integer" } }, required: [] },
    label: () => "Summarizing workbook",
    execute: ({ sheet, preview_rows }) => {
      const sheets = sheet ? [sheetOf(sheet)] : wb().sheets;
      const named = Object.entries(wb().namedRanges);
      return [
        `WORKBOOK: ${wb().sheets.length} sheet(s); active "${s.activeSheet}"`,
        named.length ? `NAMED RANGES: ${named.map(([k, v]) => `${k}=${v}`).join(", ")}` : "",
        ...sheets.map((sh) => summarizeSheet(wb(), sh, s.computed, { active: sh.name === s.activeSheet, previewRows: preview_rows ?? 5 })),
      ].filter(Boolean).join("\n\n");
    },
  });

  const get_sheet_overview = defineTool<{ sheet?: string }>({
    name: "get_sheet_overview",
    description: "Structured overview of a sheet (default: active): used range, header row and column names, per-column data profile (type, blanks, sum/min/max), formula regions, charts, conditional formats, validations, merges, freeze panes, filters, named ranges.",
    parameters: { type: "object", properties: { sheet: { type: "string", description: "Sheet name or id" } }, required: [] },
    label: (a) => `Reading ${a.sheet ?? "sheet"} overview`,
    execute: ({ sheet }) => {
      const sh = sheetOf(sheet);
      const ur = usedRange(sh);
      const hi = headerInfo(s, sh);
      const columns: Record<string, unknown>[] = [];
      if (ur) {
        for (let c = ur.start.col; c <= ur.end.col && columns.length < 40; c++) {
          const values: CellValue[] = [];
          let formulas = 0;
          for (let r = (hi ? hi.row : ur.start.row); r <= ur.end.row; r++) { const ref = toA1(r, c); if (sh.cells[ref]?.f) formulas++; values.push(cellValue(s, sh, ref)); }
          const d = describeValues(values);
          columns.push({ col: colToLetter(c), header: hi?.headers.find((h) => h.col === colToLetter(c))?.name, formulas, ...d, sample: d.sample.slice(0, 3) });
        }
      }
      return { sheet: sh.name, id: sh.id, usedRange: ur ? rangeToA1(ur) : null, headerRow: hi?.row ?? null, headers: hi?.headers ?? [], columns, cells: Object.keys(sh.cells).length, formulas: Object.values(sh.cells).filter((c) => c.f).length, formulaRegions: formulaRegions(sh).slice(0, 30), charts: sh.charts.map(({ xlsx: _x, ...c }) => { void _x; return c; }), conditionalFormats: sh.conditionalFormats.map((c) => ({ id: c.id, range: c.range, rule: c.rule.kind === "raw" ? { kind: "raw" } : c.rule })), validations: sh.validations ?? [], merges: sh.merges, freeze: sh.freeze, filters: sh.filters ?? null, hiddenRows: sh.hiddenRows, hiddenCols: sh.hiddenCols, namedRanges: wb().namedRanges, sheetNames: sh.localNames, sheets: wb().sheets.map((x) => x.name) };
    },
  });

  const get_range = defineTool<{ range?: string; ranges?: string[]; sheet?: string; values_only?: boolean }>({
    name: "get_range",
    description: "Read cells (A1 notation, named range, or Sheet!A1:B9): value, formula, style and display text for each non-empty cell. Pass ranges:[…] to read several ranges in one call (parallel reads). values_only:true returns just values/formulas (cheaper). Max ~600 cells per range.",
    parameters: { type: "object", properties: { range: { type: "string" }, ranges: { type: "array", items: { type: "string" } }, sheet: { type: "string" }, values_only: { type: "boolean" } }, required: [] },
    label: (a) => `Reading ${a.range ?? (a.ranges ?? []).join(", ")}`,
    execute: ({ range, ranges, sheet, values_only }) => {
      const list = ranges?.length ? ranges : range ? [range] : [];
      if (!list.length) throw new Error("Pass range or ranges");
      if (list.length > 12) throw new Error("At most 12 ranges per call");
      const out = list.map((r) => { try { return rangeText(s, sheetOf(sheet), r, { valuesOnly: values_only }); } catch (e) { return { range: r, error: (e as Error).message }; } });
      return out.length === 1 ? out[0] : { ranges: out };
    },
  });

  const get_headers = defineTool<{ sheet?: string }>({
    name: "get_headers",
    description: "Detected header row and column names of a sheet, with the first data row and last data row numbers.",
    parameters: { type: "object", properties: { sheet: { type: "string" } }, required: [] },
    label: () => "Reading headers",
    execute: ({ sheet }) => { const sh = sheetOf(sheet); const hi = headerInfo(s, sh); const ur = usedRange(sh); return { sheet: sh.name, headerRow: hi?.row ?? null, headers: hi?.headers ?? [], firstDataRow: hi ? hi.row + 1 : ur ? ur.start.row + 1 : null, lastDataRow: ur ? ur.end.row + 1 : null }; },
  });

  const get_selection = defineTool<Record<string, never>>({
    name: "get_selection",
    description: "The user's current selection (sheet and range) with its cells.",
    parameters: { type: "object", properties: {}, required: [] },
    label: () => "Reading selection",
    execute: () => { if (!s.selection) return { selection: null, activeSheet: s.activeSheet }; const sh = sheetOf(s.selection.sheet); return { selection: s.selection, ...rangeText(s, sh, s.selection.range, { maxCells: 300 }) }; },
  });

  const find_cells = defineTool<{ query: string; sheet?: string; regex?: boolean; in_formulas?: boolean; limit?: number }>({
    name: "find_cells",
    description: "Find cells whose value (or formula when in_formulas) contains text (case-insensitive) or matches a regex. Searches all sheets unless sheet is given.",
    parameters: { type: "object", properties: { query: { type: "string" }, sheet: { type: "string" }, regex: { type: "boolean" }, in_formulas: { type: "boolean" }, limit: { type: "integer" } }, required: ["query"] },
    label: (a) => `Searching "${a.query}"`,
    execute: ({ query, sheet, regex, in_formulas, limit }) => {
      let re: RegExp | null = null;
      if (regex) { if (query.length > 200) throw new Error("regex too long"); re = new RegExp(query, "i"); }
      const q = query.toLowerCase();
      const hits: { sheet: string; ref: string; value: CellValue; formula?: string }[] = [];
      const max = Math.min(200, limit ?? 50);
      const sheets = sheet ? [sheetOf(sheet)] : wb().sheets;
      outer: for (const sh of sheets) {
        for (const [ref, cell] of Object.entries(sh.cells)) {
          const v = cellValue(s, sh, ref);
          const hay = in_formulas ? `${cell.f ?? ""}` : `${v ?? ""} ${displayValue(s, sh, ref)}`;
          if (re ? re.test(hay) : hay.toLowerCase().includes(q)) hits.push({ sheet: sh.name, ref, value: v, formula: cell.f });
          if (hits.length >= max) break outer;
        }
      }
      return { count: hits.length, hits };
    },
  });

  const describe_data = defineTool<{ range: string; sheet?: string; has_header?: boolean }>({
    name: "describe_data",
    description: "Profile a range: per-column type mix, blanks, distinct count, sum/avg/min/max (computed in code), sample values; flags mixed types and text-that-looks-numeric.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" }, has_header: { type: "boolean" } }, required: ["range"] },
    label: (a) => `Profiling ${a.range}`,
    execute: ({ range, sheet, has_header }) => {
      const { sheet: sh, range: r } = resolveRange(wb(), range, sheetOf(sheet));
      const columns: Record<string, unknown>[] = [];
      for (let c = r.start.col; c <= r.end.col; c++) {
        const values: CellValue[] = [];
        for (let row = r.start.row + (has_header ? 1 : 0); row <= r.end.row; row++) values.push(cellValue(s, sh, toA1(row, c)));
        const d = describeValues(values);
        const numericText = values.filter((v) => typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[$,%]/g, "")))).length;
        const header = has_header ? cellValue(s, sh, toA1(r.start.row, c)) : undefined;
        columns.push({ col: colToLetter(c), header, ...d, issues: [d.numbers && d.texts ? "mixed numbers and text" : null, numericText ? `${numericText} numeric values stored as text` : null].filter(Boolean) });
      }
      return { sheet: sh.name, range: rangeToA1(r), rows: rangeSize(r).rows - (has_header ? 1 : 0), columns };
    },
  });

  const scopeRange = (sheet?: string, range?: string): { sheetId?: string; range?: RangeRef } => {
    if (!sheet && !range) return {};
    const sh = sheetOf(sheet);
    if (!range) return { sheetId: sh.id };
    const r = resolveRange(wb(), range, sh);
    return { sheetId: r.sheet.id, range: normalizeRange(r.range) };
  };

  const audit_formulas = defineTool<{ sheet?: string; range?: string }>({
    name: "audit_formulas",
    description: "Deterministic formula audit: error cells (#REF!, #DIV/0!, #VALUE!, #NAME?, #N/A) with root causes, circular references, formulas inconsistent with the rest of their column, hardcoded numbers inside formulas, numbers typed over a formula region, SUM ranges that skip adjacent rows, and numbers stored as text. Whole workbook unless sheet/range is given.",
    parameters: { type: "object", properties: { sheet: { type: "string" }, range: { type: "string" } }, required: [] },
    label: () => "Auditing formulas",
    execute: ({ sheet, range }) => {
      const r = auditFormulas(wb(), s.computed, scopeRange(sheet, range));
      return { ok: r.findings.length === 0, formulasChecked: r.formulasChecked, counts: r.counts, findings: r.findings.slice(0, 60), truncated: r.findings.length > 60 || undefined };
    },
  });

  const validate_formulas = defineTool<{ range?: string; sheet?: string }>({
    name: "validate_formulas",
    description: "Quick check after edits: formula errors (including circular references) and warnings (inconsistent formulas, hardcoded numbers). Use audit_formulas for the full review.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" } }, required: [] },
    label: () => "Validating formulas",
    execute: ({ range, sheet }) => {
      const r = auditFormulas(wb(), s.computed, scopeRange(sheet, range));
      const errors = r.findings.filter((f) => f.kind === "error" || f.kind === "circular").map((f) => ({ sheet: f.sheet, ref: f.ref, formula: f.formula ?? "", error: /Evaluates to (\S+?)[.( ]/.exec(f.detail)?.[1] ?? (f.kind === "circular" ? "#CYCLE!" : "error") }));
      const warnings = r.findings.filter((f) => f.kind !== "error" && f.kind !== "circular").map((f) => ({ sheet: f.sheet, ref: f.ref, formula: f.formula ?? "", issue: f.kind === "inconsistent" ? "formula inconsistent with the rest of its column" : f.kind === "hardcoded_in_formula" ? "hardcoded number inside a formula — move it to an input cell and reference it" : f.detail }));
      return { errors, warnings: warnings.slice(0, 40), ok: errors.length === 0 && warnings.length === 0 };
    },
  });

  const explain_formula = defineTool<{ cell?: string; formula?: string; sheet?: string }>({
    name: "explain_formula",
    description: "Explain a formula deterministically: parse it, describe it in plain language with every referenced cell's current value, list functions and hardcoded constants, and give the engine-computed result. Pass cell (e.g. 'B14' or 'Sheet!B14') or a formula text.",
    parameters: { type: "object", properties: { cell: { type: "string" }, formula: { type: "string" }, sheet: { type: "string" } }, required: [] },
    label: (a) => `Explaining ${a.cell ?? "formula"}`,
    execute: ({ cell, formula, sheet }) => {
      let sh = sheetOf(sheet);
      let f = formula;
      let at: string | undefined;
      if (cell) {
        const r = resolveRange(wb(), cell, sh);
        sh = r.sheet; at = toA1(r.range.start.row, r.range.start.col);
        f = sh.cells[at]?.f;
        if (!f) return { cell: at, formula: null, value: cellValue(s, sh, at), explanation: `${at} holds a constant (${displayValue(s, sh, at) || "empty"}), not a formula.` };
      }
      if (!f) throw new Error("Pass cell or formula");
      const ast = parseFormula(f);
      const describeRef = (text: string) => {
        try {
          const r = resolveRange(wb(), text, sh);
          const n = normalizeRange(r.range);
          const label = `${r.sheet.id === sh.id ? "" : `${r.sheet.name}!`}${rangeToA1(n)}`;
          const named = /^[A-Za-z_][\w.]*$/.test(text) && !/^[A-Za-z]{1,3}\d+$/.test(text) ? `${text} (${label})` : label;
          if (n.start.row === n.end.row && n.start.col === n.end.col) {
            const ref = toA1(n.start.row, n.start.col);
            const hdr = headerInfo(s, r.sheet);
            const colName = hdr?.headers.find((h) => h.col === colToLetter(n.start.col))?.name;
            const rowLabel = r.sheet.cells[toA1(n.start.row, 0)] && n.start.col > 0 ? cellValue(s, r.sheet, toA1(n.start.row, 0)) : null;
            const ctxLabel = [typeof rowLabel === "string" ? rowLabel : null, colName].filter(Boolean).join(" / ");
            return `${named}${ctxLabel ? ` [${ctxLabel}]` : ""} (= ${displayOf(wb(), r.sheet, s.computed, ref) || "empty"})`;
          }
          return `${named} (${(n.end.row - n.start.row + 1) * (n.end.col - n.start.col + 1)} cells)`;
        } catch { return text; }
      };
      const engine = new SheetEngine();
      let result: { v: CellValue; t?: string };
      try { engine.sync(wb()); result = at ? { v: cellValue(s, sh, at), t: s.computed[sh.id]?.[at]?.t } : engine.evaluate(sh.id, f); } finally { engine.destroy(); }
      const facts: { functions: Set<string>; constants: number[] } = { functions: new Set(), constants: [] };
      const walkAst = (n: typeof ast) => { if (n.k === "func") { facts.functions.add(n.name); n.args.forEach(walkAst); } else if (n.k === "num") facts.constants.push(n.v); else if (n.k === "bin") { walkAst(n.l); walkAst(n.r); } else if (n.k === "unary" || n.k === "percent") walkAst(n.arg); };
      walkAst(ast);
      return {
        cell: at ? `${sh.name}!${at}` : undefined, formula: f.startsWith("=") ? f : `=${f}`,
        value: result.v, display: at ? displayValue(s, sh, at) : undefined, isError: result.t === "e" || undefined,
        explanation: `${at ?? "The formula"} = ${say(ast, { describeRef })}.`,
        functions: [...facts.functions], constants: facts.constants.length ? facts.constants : undefined,
      };
    },
  });

  const trace_precedents = defineTool<{ cell: string; sheet?: string; depth?: number }>({
    name: "trace_precedents",
    description: "Cells and ranges a cell's formula reads, recursively (depth 1–4), with their formulas and current values — follows named ranges and cross-sheet references.",
    parameters: { type: "object", properties: { cell: { type: "string" }, sheet: { type: "string" }, depth: { type: "integer" } }, required: ["cell"] },
    label: (a) => `Tracing precedents of ${a.cell}`,
    execute: ({ cell, sheet, depth }) => { const r = resolveRange(wb(), cell, sheetOf(sheet)); const ref = toA1(r.range.start.row, r.range.start.col); return { cell: `${r.sheet.name}!${ref}`, formula: r.sheet.cells[ref]?.f ?? null, precedents: tracePrecedents(wb(), s.computed, r.sheet, ref, Math.max(1, Math.min(4, depth ?? 2))) }; },
  });

  const trace_dependents = defineTool<{ cell: string; sheet?: string; depth?: number }>({
    name: "trace_dependents",
    description: "Formula cells that read a cell (directly or through named ranges and other sheets), recursively (depth 1–4), with their current values — shows what an edit to the cell would change.",
    parameters: { type: "object", properties: { cell: { type: "string" }, sheet: { type: "string" }, depth: { type: "integer" } }, required: ["cell"] },
    label: (a) => `Tracing dependents of ${a.cell}`,
    execute: ({ cell, sheet, depth }) => { const r = resolveRange(wb(), cell, sheetOf(sheet)); const ref = toA1(r.range.start.row, r.range.start.col); return { cell: `${r.sheet.name}!${ref}`, dependents: traceDependents(wb(), s.computed, r.sheet, ref, Math.max(1, Math.min(4, depth ?? 2))) }; },
  });

  const evaluate_formula = defineTool<{ formula: string; sheet?: string }>({
    name: "evaluate_formula",
    description: "Compute a formula with the spreadsheet engine against the current workbook without writing it (e.g. '=SUMIFS(D:D,B:B,\"Discovery\")', '=NETWORKDAYS(A2,B2)'). Use this for any arithmetic you need to state — never compute numbers yourself.",
    parameters: { type: "object", properties: { formula: { type: "string" }, sheet: { type: "string" } }, required: ["formula"] },
    label: (a) => `Evaluating ${a.formula.slice(0, 40)}`,
    execute: ({ formula, sheet }) => {
      const sh = sheetOf(sheet);
      const engine = new SheetEngine();
      try { engine.sync(wb()); const r = engine.evaluate(sh.id, formula); return { formula: formula.startsWith("=") ? formula : `=${formula}`, value: r.v, isError: r.t === "e" || undefined }; } finally { engine.destroy(); }
    },
  });

  const date_math = defineTool<{ op: DateOp; date?: string; end?: string; days?: number; months?: number; holidays?: string[]; calendar?: "us_federal" | "none"; year?: number }>({
    name: "date_math",
    description: "Deterministic court-calendar date arithmetic (never compute dates yourself): add_business_days, add_calendar_days, add_months, business_days_between, calendar_days_between, deadline (Fed. R. Civ. P. 6(a)(1): count days, roll past weekends/US federal holidays), next_business_day, is_business_day, holidays (list for a year). Dates are yyyy-mm-dd; holidays adds extra non-business days. Returns the Excel formula that reproduces the result so the sheet can stay live.",
    parameters: { type: "object", properties: { op: { type: "string", enum: ["add_business_days", "add_calendar_days", "add_months", "business_days_between", "calendar_days_between", "deadline", "next_business_day", "is_business_day", "holidays"] }, date: { type: "string" }, end: { type: "string" }, days: { type: "integer" }, months: { type: "integer" }, holidays: { type: "array", items: { type: "string" } }, calendar: { type: "string", enum: ["us_federal", "none"] }, year: { type: "integer" } }, required: ["op"] },
    label: (a) => `Date math: ${a.op}`,
    execute: (a) => dateMath(a),
  });

  // ------------------------------------------------------------------ edits
  const set_cells = defineTool<{ sheet?: string; cells: { ref: string; value?: string | number | boolean | null; formula?: string; style?: Record<string, unknown> | null }[] }>({
    name: "set_cells",
    description: "Write values and/or formulas (and optional style) into specific cells. Values are typed (numbers as numbers, ISO dates as 'yyyy-mm-dd' strings, text as strings). Formulas start with '='. For blocks use write_range.",
    parameters: { type: "object", properties: { sheet: { type: "string" }, cells: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] }, formula: { type: "string" }, style: STYLE_SCHEMA }, required: ["ref"] } } }, required: ["cells"] },
    label: (a) => `Setting ${a.cells?.length ?? 0} cell${(a.cells?.length ?? 0) === 1 ? "" : "s"}`,
    execute: ({ sheet, cells }) => {
      if (!cells.length) throw new Error("cells is empty");
      if (cells.length > 2000) throw new Error("Too many cells in one call (max 2000); split the write");
      const sh = sheetOf(sheet);
      const inputs: CellInput[] = cells.map((c) => {
        const input: CellInput = { ref: c.ref.toUpperCase() };
        if (c.formula) input.formula = c.formula;
        else if (c.value !== undefined) { if (typeof c.value === "string" && c.value.startsWith("=") && c.value.length > 1) input.formula = c.value; else input.value = c.value; }
        if (c.style !== undefined) input.style = c.style === null ? null : (cleanStyle(c.style) as Partial<CellStyle>);
        return input;
      });
      return edit({ type: "set_cells", sheet: sh.id, cells: inputs }, { title: `Set ${inputs.length === 1 ? inputs[0].ref : `${inputs.length} cells`}`, summary: inputs.slice(0, 6).map((i) => `${i.ref} ← ${i.formula ?? JSON.stringify(i.value ?? "")}`).join("\n") + (inputs.length > 6 ? `\n… +${inputs.length - 6} more` : "") });
    },
  });

  const write_range = defineTool<{ anchor?: string; range?: string; values?: (string | number | boolean | null)[][]; formula?: string; fill?: "down" | "right"; sheet?: string; style?: Record<string, unknown> | null }>({
    name: "write_range",
    description: "Write a block: values (2-D array, rows of cells; strings starting with '=' are formulas) at an anchor cell, OR one formula written for the top-left cell of range and filled down/right with relative references shifting (e.g. range 'E2:E40', formula '=C2*D2', fill 'down'). Optional style for the whole block.",
    parameters: { type: "object", properties: { anchor: { type: "string" }, range: { type: "string" }, values: { type: "array", items: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } } }, formula: { type: "string" }, fill: { type: "string", enum: ["down", "right"] }, sheet: { type: "string" }, style: STYLE_SCHEMA }, required: [] },
    label: (a) => `Writing ${a.range ?? a.anchor ?? "range"}`,
    execute: ({ anchor, range, values, formula, fill, sheet, style }) => {
      const sh = sheetOf(sheet);
      if (formula) {
        if (!range) throw new Error("formula needs range (e.g. E2:E40)");
        const r = normalizeRange(resolveRange(wb(), range, sh).range);
        const target = fill === "right" ? { start: r.start, end: { row: r.start.row, col: r.end.col } } : fill === "down" ? { start: r.start, end: { row: r.end.row, col: r.start.col } } : r;
        if (rangeSize(target).cells > 20_000) throw new Error("Range too large (max 20,000 cells)");
        const f = formula.startsWith("=") ? formula : `=${formula}`;
        parseFormula(f);
        const ops: SheetOp[] = [{ type: "fill_range", sheet: sh.id, range: rangeToA1(target), pattern: f }];
        if (style) ops.push({ type: "style_range", sheet: sh.id, range: rangeToA1(target), style: cleanStyle(style) });
        return edit(ops.length === 1 ? ops[0] : { type: "batch", ops }, { title: `Fill ${rangeToA1(target)} with ${f}`, summary: `${f} (relative references shift per cell)` });
      }
      if (!values?.length) throw new Error("Pass values (2-D array) with anchor, or formula with range");
      const a = parseA1((anchor ?? range ?? "A1").split(":")[0]);
      const cells: CellInput[] = [];
      values.forEach((row, i) => row.forEach((v, j) => {
        const ref = toA1(a.row + i, a.col + j);
        const input: CellInput = typeof v === "string" && v.startsWith("=") && v.length > 1 ? { ref, formula: v } : { ref, value: v };
        if (style) input.style = cleanStyle(style) as Partial<CellStyle>;
        cells.push(input);
      }));
      if (cells.length > 20_000) throw new Error("Too many cells (max 20,000)");
      return edit({ type: "set_cells", sheet: sh.id, cells }, { title: `Write ${values.length}×${Math.max(...values.map((r) => r.length))} at ${toA1(a.row, a.col)}` });
    },
  });

  const fill_range = defineTool<{ range: string; pattern: string; sheet?: string }>({
    name: "fill_range",
    description: "Fill every cell of a range with a value, or with a formula written for the range's top-left cell; relative references shift for each cell (e.g. range D2:D20, pattern '=B2*C2' gives D3 '=B3*C3'…). Use $ for absolute refs.",
    parameters: { type: "object", properties: { range: { type: "string" }, pattern: { type: "string" }, sheet: { type: "string" } }, required: ["range", "pattern"] },
    label: (a) => `Filling ${a.range}`,
    execute: ({ range, pattern, sheet }) => { const sh = sheetOf(sheet); return edit({ type: "fill_range", sheet: sh.id, range, pattern }, { summary: `${range} ← ${pattern} (relative refs shift per cell)` }); },
  });

  const set_formula_column = defineTool<{ column: string; from_row: number; to_row: number; template: string; sheet?: string; header?: string; numFmt?: string }>({
    name: "set_formula_column",
    description: "Write a formula down a column using a template with {row}, e.g. column 'E', rows 2–40, template '=C{row}*D{row}'. Optionally sets a header in row from_row-1 and a number format.",
    parameters: { type: "object", properties: { column: { type: "string" }, from_row: { type: "integer" }, to_row: { type: "integer" }, template: { type: "string" }, sheet: { type: "string" }, header: { type: "string" }, numFmt: { type: "string" } }, required: ["column", "from_row", "to_row", "template"] },
    label: (a) => `Formula column ${a.column}`,
    execute: ({ column, from_row, to_row, template, sheet, header, numFmt }) => {
      const sh = sheetOf(sheet);
      const col = letter(column);
      if (to_row < from_row) throw new Error("to_row must be >= from_row");
      if (to_row - from_row > 5000) throw new Error("Too many rows (max 5000)");
      const ops: SheetOp[] = [{ type: "set_formula_column", sheet: sh.id, column: col, from_row, to_row, template }];
      if (header && from_row > 1) {
        const headerRef = `${col}${from_row - 1}`;
        const neighbour = sh.cells[`${colToLetter(Math.max(0, letterToCol(col) - 1))}${from_row - 1}`];
        ops.push({ type: "set_cells", sheet: sh.id, cells: [{ ref: headerRef, value: header, style: neighbour?.s ? getStyle(wb(), neighbour) : { bold: true } }] });
      }
      if (numFmt) ops.push({ type: "set_number_format", sheet: sh.id, range: `${col}${from_row}:${col}${to_row}`, numFmt: numFmt as NumFmt });
      return edit(ops.length === 1 ? ops[0] : { type: "batch", ops }, { title: `Formula column ${col}${from_row}:${col}${to_row}`, summary: `${template}${header ? ` (header "${header}")` : ""}`, readBack: [`${sh.name}!${col}${from_row}:${col}${Math.min(to_row, from_row + 11)}`] });
    },
  });

  const insert_rows = defineTool<{ at_row: number; count?: number; sheet?: string }>({
    name: "insert_rows",
    description: "Insert blank rows before 1-based row at_row. References, names, merges, formats and validations below shift automatically.",
    parameters: { type: "object", properties: { at_row: { type: "integer" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_row"] },
    execute: ({ at_row, count, sheet }) => edit({ type: "insert_rows", sheet: sheetOf(sheet).id, index: at_row - 1, count: count ?? 1 }),
  });
  const delete_rows = defineTool<{ at_row: number; count?: number; sheet?: string }>({
    name: "delete_rows",
    description: "Delete rows starting at 1-based at_row. Formulas referencing deleted cells become #REF! (the result reports them).",
    parameters: { type: "object", properties: { at_row: { type: "integer" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_row"] },
    execute: ({ at_row, count, sheet }) => edit({ type: "delete_rows", sheet: sheetOf(sheet).id, index: at_row - 1, count: count ?? 1 }, { risk: "medium" }),
  });
  const insert_cols = defineTool<{ at_column: string; count?: number; sheet?: string }>({
    name: "insert_cols",
    description: "Insert blank columns before column letter at_column.",
    parameters: { type: "object", properties: { at_column: { type: "string" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_column"] },
    execute: ({ at_column, count, sheet }) => edit({ type: "insert_cols", sheet: sheetOf(sheet).id, index: letterToCol(letter(at_column)), count: count ?? 1 }),
  });
  const delete_cols = defineTool<{ at_column: string; count?: number; sheet?: string }>({
    name: "delete_cols",
    description: "Delete columns starting at column letter at_column.",
    parameters: { type: "object", properties: { at_column: { type: "string" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_column"] },
    execute: ({ at_column, count, sheet }) => edit({ type: "delete_cols", sheet: sheetOf(sheet).id, index: letterToCol(letter(at_column)), count: count ?? 1 }, { risk: "medium" }),
  });

  const set_style = defineTool<{ range: string; style: Record<string, unknown>; sheet?: string }>({
    name: "set_style",
    description: "Apply a style patch to every cell in a range: font (bold, italic, underline, strike, color, fontSize, fontFamily), fill, borders (shorthand `border` or per-edge `borders`), alignment (align, valign, wrap, indent), numFmt, locked. Professional header: {bold:true, fill:'#1F3A5F', color:'#FFFFFF', border:'thin'}; totals: {bold:true, fill:'#EEF2F7', border:'top'}.",
    parameters: { type: "object", properties: { range: { type: "string" }, style: STYLE_SCHEMA, sheet: { type: "string" } }, required: ["range", "style"] },
    label: (a) => `Styling ${a.range}`,
    execute: ({ range, style, sheet }) => edit({ type: "style_range", sheet: sheetOf(sheet).id, range, style: cleanStyle(style) }, { summary: JSON.stringify(style) }),
  });

  const set_number_format = defineTool<{ range: string; numFmt: string; sheet?: string }>({
    name: "set_number_format",
    description: "Set the number format of a range: General, 0, 0.00, #,##0, #,##0.00, $#,##0.00, $#,##0, 0%, 0.00%, yyyy-mm-dd, mmm d yyyy, m/d/yyyy, text, accounting, or a custom pattern like #,##0.00;(#,##0.00).",
    parameters: { type: "object", properties: { range: { type: "string" }, numFmt: { type: "string" }, sheet: { type: "string" } }, required: ["range", "numFmt"] },
    execute: ({ range, numFmt, sheet }) => edit({ type: "set_number_format", sheet: sheetOf(sheet).id, range, numFmt: numFmt as NumFmt }),
  });

  const set_column_width = defineTool<{ columns: string[]; width?: number; autofit?: boolean; sheet?: string }>({
    name: "set_column_width",
    description: "Set column widths in pixels (e.g. columns ['A','C'], width 160) or autofit:true to size columns to their content. Empty columns with autofit fits every used column.",
    parameters: { type: "object", properties: { columns: { type: "array", items: { type: "string" } }, width: { type: "number" }, autofit: { type: "boolean" }, sheet: { type: "string" } }, required: ["columns"] },
    execute: ({ columns, width, autofit, sheet }) => {
      const sh = sheetOf(sheet);
      if (autofit || width == null) return edit({ type: "autofit_columns", sheet: sh.id, columns: columns.length ? columns.map(letter) : undefined });
      return edit({ type: "set_column_width", sheet: sh.id, columns: columns.map(letter), width });
    },
  });

  const set_row_height = defineTool<{ rows: number[]; height: number; sheet?: string }>({
    name: "set_row_height",
    description: "Set the pixel height of 1-based rows (e.g. taller title row).",
    parameters: { type: "object", properties: { rows: { type: "array", items: { type: "integer" } }, height: { type: "number" }, sheet: { type: "string" } }, required: ["rows", "height"] },
    execute: ({ rows, height, sheet }) => edit({ type: "set_row_height", sheet: sheetOf(sheet).id, rows: rows.map((r) => r - 1), height }),
  });

  const hide_rows_cols = defineTool<{ rows?: number[]; columns?: string[]; hidden?: boolean; sheet?: string }>({
    name: "hide_rows_cols",
    description: "Hide (or unhide with hidden:false) 1-based rows and/or column letters.",
    parameters: { type: "object", properties: { rows: { type: "array", items: { type: "integer" } }, columns: { type: "array", items: { type: "string" } }, hidden: { type: "boolean" }, sheet: { type: "string" } }, required: [] },
    execute: ({ rows, columns, hidden, sheet }) => { if (!rows?.length && !columns?.length) throw new Error("Pass rows or columns"); return edit({ type: "set_hidden", sheet: sheetOf(sheet).id, rows: rows?.map((r) => r - 1), cols: columns?.map(letter), hidden: hidden !== false }); },
  });

  const merge_cells = defineTool<{ range: string; sheet?: string; unmerge?: boolean }>({
    name: "merge_cells",
    description: "Merge a range into one cell (title rows, section bands). unmerge:true unmerges.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" }, unmerge: { type: "boolean" } }, required: ["range"] },
    execute: ({ range, sheet, unmerge }) => edit({ type: unmerge ? "unmerge_cells" : "merge_cells", sheet: sheetOf(sheet).id, range }),
  });

  const unmerge_cells = defineTool<{ range: string; sheet?: string }>({
    name: "unmerge_cells",
    description: "Unmerge every merged block that overlaps a range.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" } }, required: ["range"] },
    execute: ({ range, sheet }) => edit({ type: "unmerge_cells", sheet: sheetOf(sheet).id, range }),
  });

  const set_freeze_panes = defineTool<{ rows: number; cols?: number; sheet?: string }>({
    name: "set_freeze_panes",
    description: "Freeze the top N rows and/or first M columns so headers stay visible while scrolling. rows:1 freezes the header row; rows:0 cols:0 unfreezes.",
    parameters: { type: "object", properties: { rows: { type: "integer" }, cols: { type: "integer" }, sheet: { type: "string" } }, required: ["rows"] },
    execute: ({ rows, cols, sheet }) => edit({ type: "freeze_panes", sheet: sheetOf(sheet).id, rows, cols: cols ?? 0 }),
  });

  const sort_range = defineTool<{ range: string; by?: string; order?: "asc" | "desc"; keys?: { column: string; order?: "asc" | "desc" }[]; has_header?: boolean; then_by?: string; sheet?: string }>({
    name: "sort_range",
    description: "Sort the rows of a range by one or more columns: keys [{column:'D', order:'desc'}, {column:'A'}] (or by/then_by). has_header keeps the first row in place. Whole rows move together and relative formulas keep pointing at their own row.",
    parameters: { type: "object", properties: { range: { type: "string" }, by: { type: "string" }, order: { type: "string", enum: ["asc", "desc"] }, keys: { type: "array", items: { type: "object", properties: { column: { type: "string" }, order: { type: "string", enum: ["asc", "desc"] } }, required: ["column"] } }, has_header: { type: "boolean" }, then_by: { type: "string" }, sheet: { type: "string" } }, required: ["range"] },
    label: (a) => `Sorting ${a.range}`,
    execute: ({ range, by, order, keys, has_header, then_by, sheet }) => {
      const k = keys?.length ? keys.map((x) => ({ by: letter(x.column), order: x.order ?? "asc" })) : undefined;
      const first = k?.[0]?.by ?? (by ? letter(by) : null);
      if (!first) throw new Error("Pass keys or by");
      return edit({ type: "sort_range", sheet: sheetOf(sheet).id, range, by: first, order: k?.[0]?.order ?? order ?? "asc", has_header: has_header ?? true, then_by: then_by ? letter(then_by) : undefined, keys: k });
    },
  });

  const add_filter = defineTool<{ range: string; sheet?: string; column?: string; values?: string[]; condition?: { op: string; value?: string | number } }>({
    name: "add_filter",
    description: "Turn on autofilter dropdowns for a table range (header row first). Optionally apply a criterion to one column: values (allowed list) or condition {op: contains|notContains|eq|neq|gt|lt|gte|lte|startsWith|blank|notBlank, value}.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" }, column: { type: "string" }, values: { type: "array", items: { type: "string" } }, condition: { type: "object", properties: { op: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }] } }, required: ["op"] } }, required: ["range"] },
    execute: ({ range, sheet, column, values, condition }) => {
      const sh = sheetOf(sheet);
      const ops: SheetOp[] = [{ type: "add_filter", sheet: sh.id, range }];
      if (column && (values || condition)) ops.push({ type: "set_filter_criteria", sheet: sh.id, column: letter(column), criteria: { values: values ?? null, condition: condition ? { op: condition.op as "contains", value: condition.value } : undefined } });
      return edit(ops.length === 1 ? ops[0] : { type: "batch", ops }, { title: `Filter ${range}${column ? ` on ${letter(column)}` : ""}` });
    },
  });

  const clear_filter = defineTool<{ sheet?: string }>({
    name: "clear_filter",
    description: "Remove the sheet's autofilter.",
    parameters: { type: "object", properties: { sheet: { type: "string" } }, required: [] },
    execute: ({ sheet }) => edit({ type: "clear_filter", sheet: sheetOf(sheet).id }),
  });

  const add_conditional_format = defineTool<{ range: string; rule: Record<string, unknown>; style?: Record<string, unknown>; sheet?: string }>({
    name: "add_conditional_format",
    description: "Conditional formatting: highlight cells matching a rule (gt/lt/between/eq/contains/dueBefore/top/blank/duplicate/expression) with a style, or add a colorScale / dataBar. Overdue dates: rule {kind:'dueBefore', date:'today'} style {fill:'#FDE2E1', color:'#9F1239'}; whole-row highlight: rule {kind:'expression', formula:'=$E2=\"Open\"'} on A2:H40.",
    parameters: { type: "object", properties: { range: { type: "string" }, rule: RULE_SCHEMA, style: STYLE_SCHEMA, sheet: { type: "string" } }, required: ["range", "rule"] },
    execute: ({ range, rule, style, sheet }) => edit({ type: "conditional_format", sheet: sheetOf(sheet).id, range, rule: toRule(rule), style: cleanStyle(style ?? {}) as CellStyle, id: `cf_${nanoid(6)}` }, { summary: `${JSON.stringify(rule)} → ${JSON.stringify(style ?? {})}` }),
  });

  const set_data_validation = defineTool<{ range: string; kind: DataValidation["kind"]; list?: string[]; list_source?: string; min?: number; max?: number; formula?: string; message?: string; error?: string; sheet?: string }>({
    name: "set_data_validation",
    description: "Data validation on a range: dropdown list (kind 'list' with list values, or list_source range like \"Lists!$A$1:$A$9\"), number/date bounds (kind 'number'|'date' with min/max; dates as serials or use formula), whole numbers, text length, or a custom formula (kind 'custom', formula for the top-left cell).",
    parameters: { type: "object", properties: { range: { type: "string" }, kind: { type: "string", enum: ["list", "number", "date", "whole", "decimal", "textLength", "custom"] }, list: { type: "array", items: { type: "string" } }, list_source: { type: "string" }, min: { type: "number" }, max: { type: "number" }, formula: { type: "string" }, message: { type: "string" }, error: { type: "string" }, sheet: { type: "string" } }, required: ["range", "kind"] },
    execute: ({ range, kind, list, list_source, min, max, formula, message, error, sheet }) => {
      const sh = sheetOf(sheet);
      if (kind === "list" && !list?.length && !list_source) throw new Error("A list validation needs list values or list_source");
      if (kind === "custom" && !formula) throw new Error("A custom validation needs formula");
      const op: Extract<SheetOp, { type: "add_validation" }> = { type: "add_validation", sheet: sh.id, range, kind, id: `dv_${nanoid(6)}` };
      if (list?.length) op.list = list;
      if (list_source) op.listSource = list_source;
      if (message) op.message = message;
      if (error) op.error = error;
      if (kind === "number" || kind === "date") { if (min !== undefined && min !== null) op.min = min; if (max !== undefined && max !== null) op.max = max; if (formula) op.formula1 = formula.replace(/^=/, ""); }
      else if (kind === "custom") op.formula1 = formula!.replace(/^=/, "");
      else if (kind !== "list") {
        const hasMin = min !== undefined && min !== null, hasMax = max !== undefined && max !== null;
        if (!hasMin && !hasMax && !formula) throw new Error(`${kind} validation needs min and/or max`);
        op.operator = hasMin && hasMax ? "between" : hasMin ? "greaterThanOrEqual" : "lessThanOrEqual";
        op.formula1 = formula ? formula.replace(/^=/, "") : String(hasMin ? min : max);
        if (hasMin && hasMax) op.formula2 = String(max);
      }
      return edit(op, { title: `Validation on ${range} (${kind})` });
    },
  });

  const create_chart = defineTool<{ type: ChartType; title: string; range: string; category_range?: string; sheet?: string; position?: { x?: number; y?: number; w?: number; h?: number }; has_header?: boolean; stacked?: boolean; horizontal?: boolean }>({
    name: "create_chart",
    description: "Add a chart (bar, line, pie, area, scatter) from a data range (one or more numeric columns, header row first) with an optional category (label) range such as the first column. Exported to .xlsx as a native Excel chart. Position is in pixels from the grid origin; default places it to the right of the data.",
    parameters: { type: "object", properties: { type: { type: "string", enum: ["bar", "line", "pie", "area", "scatter"] }, title: { type: "string" }, range: { type: "string" }, category_range: { type: "string" }, sheet: { type: "string" }, position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: [] }, has_header: { type: "boolean" }, stacked: { type: "boolean" }, horizontal: { type: "boolean" } }, required: ["type", "title", "range"] },
    label: (a) => `Adding ${a.type} chart`,
    execute: ({ type, title, range, category_range, sheet, position, has_header, stacked, horizontal }) => edit({ type: "add_chart", sheet: sheetOf(sheet).id, chart: { id: `ch_${nanoid(6)}`, type, title, range, categoryRange: category_range, hasHeader: has_header ?? true, stacked: stacked ?? undefined, horizontal: horizontal ?? undefined, position: position ?? undefined } }, { title: `Add ${type} chart "${title}"`, summary: `data ${range}${category_range ? `, categories ${category_range}` : ""}` }),
  });

  const add_sheet = defineTool<{ name: string }>({
    name: "add_sheet",
    description: "Add a new worksheet and make it active.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    execute: ({ name }) => edit({ type: "add_sheet", name, id: `sh_${nanoid(6)}` }),
  });

  const set_sheet_name = defineTool<{ name: string; sheet?: string }>({
    name: "set_sheet_name",
    description: "Rename a sheet (default: active). Cross-sheet references update automatically.",
    parameters: { type: "object", properties: { name: { type: "string" }, sheet: { type: "string" } }, required: ["name"] },
    execute: ({ name, sheet }) => edit({ type: "rename_sheet", sheet: sheetOf(sheet).id, name }),
  });

  const create_named_range = defineTool<{ name: string; ref: string }>({
    name: "create_named_range",
    description: "Define a named range (e.g. FeeRate = Inputs!B3) so formulas read =Gross*FeeRate instead of hardcoded cells. Names: letters/digits/underscore, not cell-like.",
    parameters: { type: "object", properties: { name: { type: "string" }, ref: { type: "string" } }, required: ["name", "ref"] },
    execute: ({ name, ref }) => edit({ type: "add_named_range", name, ref }),
  });

  const clear_range = defineTool<{ range: string; what?: "all" | "contents" | "formats"; sheet?: string }>({
    name: "clear_range",
    description: "Clear a range: all, contents only, or formats only.",
    parameters: { type: "object", properties: { range: { type: "string" }, what: { type: "string", enum: ["all", "contents", "formats"] }, sheet: { type: "string" } }, required: ["range"] },
    execute: ({ range, what, sheet }) => edit({ type: "clear_range", sheet: sheetOf(sheet).id, range, what: what ?? "all" }, { risk: "medium" }),
  });

  const add_comment = defineTool<{ cell: string; text: string; sheet?: string }>({
    name: "add_comment",
    description: "Attach a review comment to a cell (an assumption that needs confirmation, a [VERIFY] note, the source of a number, or a suggested change in review mode).",
    parameters: { type: "object", properties: { cell: { type: "string" }, text: { type: "string" }, sheet: { type: "string" } }, required: ["cell", "text"] },
    execute: ({ cell, text, sheet }) => {
      const sh = sheetOf(sheet);
      const ref = toA1(parseA1(cell).row, parseA1(cell).col);
      const anchor = `${sh.name}!${ref}`;
      s.comments = [...(s.comments ?? []), { id: `pending-${s.comments?.length ?? 0}`, anchor, body: text, author: "Spreadsheet assistant" }];
      const p = ctx.propose({ kind: "add_comment", title: `Comment on ${ref}`, summary: text, target: anchor, targetLabel: sh.name === s.activeSheet ? ref : anchor, payload: { anchor, text, quote: displayValue(s, sh, ref) }, risk: "low" });
      return { ok: true, proposal: p.id, anchor };
    },
  });

  const build_table = defineTool<{ anchor: string; headers: string[]; rows: (string | number | boolean | null)[][]; style?: "professional" | "plain"; total_row?: boolean; number_format?: string; sheet?: string; freeze_header?: boolean }>({
    name: "build_table",
    description: "Write a complete table at an anchor cell: header row, data rows (cells may be values or '=formulas' relative to their own row), optional total row that SUMs numeric columns, professional styling (bold shaded header, borders, banding, autofit) and a frozen header when the table starts at row 1.",
    parameters: { type: "object", properties: { anchor: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } } }, style: { type: "string", enum: ["professional", "plain"] }, total_row: { type: "boolean" }, number_format: { type: "string" }, sheet: { type: "string" }, freeze_header: { type: "boolean" } }, required: ["anchor", "headers", "rows"] },
    label: (a) => `Building table (${a.rows?.length ?? 0} rows)`,
    execute: ({ anchor, headers, rows, style, total_row, number_format, sheet, freeze_header }) => {
      const sh = sheetOf(sheet);
      if (!headers.length) throw new Error("headers is empty");
      const a = parseA1(anchor);
      const ops: SheetOp[] = [{ type: "build_table", sheet: sh.id, anchor: toA1(a.row, a.col), headers, rows, style: style ?? "professional", total_row: Boolean(total_row), number_format: number_format as NumFmt | undefined }];
      if (freeze_header && a.row > 0) ops.push({ type: "freeze_panes", sheet: sh.id, rows: a.row + 1, cols: 0 });
      return edit(ops.length === 1 ? ops[0] : { type: "batch", ops }, { title: `Build table at ${toA1(a.row, a.col)}`, summary: `${headers.join(" · ")}\n${rows.length} rows${total_row ? " + total row" : ""}` });
    },
  });

  const transcribe_image_to_cells = defineTool<{ anchor: string; headers?: string[]; rows: (string | number | boolean | null)[][]; sheet?: string; style?: "professional" | "plain" }>({
    name: "transcribe_image_to_cells",
    description: "Write a table you transcribed from an attached image/screenshot into the sheet starting at anchor. Pass the header row in headers and every data row in rows, with numbers as numbers and dates as yyyy-mm-dd. Mark unreadable cells with '[?]'.",
    parameters: { type: "object", properties: { anchor: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } } }, sheet: { type: "string" }, style: { type: "string", enum: ["professional", "plain"] } }, required: ["anchor", "rows"] },
    label: () => "Transcribing image",
    execute: ({ anchor, headers, rows, sheet, style }) => {
      const sh = sheetOf(sheet);
      const a = parseA1(anchor);
      if (headers?.length) return edit({ type: "build_table", sheet: sh.id, anchor: toA1(a.row, a.col), headers, rows, style: style ?? "plain" }, { title: `Transcribe table at ${toA1(a.row, a.col)}`, summary: `${headers.join(" · ")}\n${rows.length} rows` });
      const cells: CellInput[] = [];
      rows.forEach((row, i) => row.forEach((v, j) => cells.push({ ref: toA1(a.row + i, a.col + j), value: v })));
      return edit({ type: "set_cells", sheet: sh.id, cells }, { title: `Transcribe ${rows.length} rows at ${toA1(a.row, a.col)}` });
    },
  });

  const placement = (sheetArg: string | undefined, anchor: string | undefined, newSheet: string | undefined, fallback: { sheet: Sheet; col: number }): { ops: SheetOp[]; target: Sheet; anchor: { row: number; col: number } } => {
    if (newSheet) {
      const id = `sh_${nanoid(6)}`;
      const tmp = applyOp(wb(), { type: "add_sheet", name: newSheet, id });
      return { ops: [{ type: "add_sheet", name: newSheet, id }], target: tmp.sheets.find((x) => x.id === id)!, anchor: anchor ? parseA1(anchor) : { row: 0, col: 0 } };
    }
    const target = sheetArg ? sheetOf(sheetArg) : fallback.sheet;
    if (anchor) return { ops: [], target, anchor: parseA1(anchor) };
    const ur = usedRange(target);
    return { ops: [], target, anchor: { row: 0, col: ur ? Math.max(fallback.col, ur.end.col + 2) : 0 } };
  };

  const summarize_table = defineTool<{ range: string; group_by: string[]; values: { column: string; agg: "sum" | "count" | "average" | "min" | "max"; label?: string }[]; sheet?: string; anchor?: string; target_sheet?: string; new_sheet?: string; total_row?: boolean }>({
    name: "summarize_table",
    description: "Pivot-style group-by summary written as LIVE formulas: one row per distinct key (group_by column letters), each value column an aggregate (sum/count/average/min/max) built with SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS over the source columns, plus a total row. Nothing is pasted as a static number. Place it on new_sheet, or at anchor (default: two columns right of the data).",
    parameters: { type: "object", properties: { range: { type: "string", description: "Source table including its header row" }, group_by: { type: "array", items: { type: "string" } }, values: { type: "array", items: { type: "object", properties: { column: { type: "string" }, agg: { type: "string", enum: ["sum", "count", "average", "min", "max"] }, label: { type: "string" } }, required: ["column", "agg"] } }, sheet: { type: "string" }, anchor: { type: "string" }, target_sheet: { type: "string" }, new_sheet: { type: "string" }, total_row: { type: "boolean" } }, required: ["range", "group_by", "values"] },
    label: () => "Building summary table",
    execute: ({ range, group_by, values, sheet, anchor, target_sheet, new_sheet, total_row }) => {
      const src = resolveRange(wb(), range, sheetOf(sheet));
      const r = normalizeRange(src.range);
      const place = placement(target_sheet, anchor, new_sheet, { sheet: src.sheet, col: r.end.col + 2 });
      const built = buildSummaryOps(wb(), s.computed, { source: src.sheet, range: r, groupBy: group_by.map(letter), values: values.map((v) => ({ ...v, column: letter(v.column) })), target: place.target, anchor: place.anchor, totalRow: total_row });
      const ops = [...place.ops, ...built.ops, { type: "autofit_columns", sheet: place.target.id, columns: undefined } as SheetOp];
      const res = edit({ type: "batch", ops }, { title: `Summary of ${src.sheet.name}!${rangeToA1(r)} by ${group_by.join(", ")}`, summary: `${built.groups} group(s); ${values.map((v) => `${v.agg}(${v.column})`).join(", ")} as live SUMIFS/COUNTIFS formulas`, readBack: [`${place.target.name}!${built.range}`] });
      return { ...res, summaryRange: `${place.target.name}!${built.range}`, groups: built.groups };
    },
  });

  const lookup_join = defineTool<{ key_column: string; from_row: number; to_row: number; output_column: string; lookup_range: string; key_offset?: number; return_offset: number; method?: "xlookup" | "index_match"; not_found?: string; header?: string; sheet?: string }>({
    name: "lookup_join",
    description: "Join data from another table with live lookup formulas: for rows from_row..to_row, look up key_column's value in the first column (or key_offset) of lookup_range and return the column at return_offset (0-based within lookup_range), writing XLOOKUP (default) or INDEX/MATCH into output_column, wrapped so misses show not_found. Reports matched / not-found counts computed by the engine.",
    parameters: { type: "object", properties: { key_column: { type: "string" }, from_row: { type: "integer" }, to_row: { type: "integer" }, output_column: { type: "string" }, lookup_range: { type: "string", description: "e.g. 'Rates'!A2:D40 (no header)" }, key_offset: { type: "integer" }, return_offset: { type: "integer" }, method: { type: "string", enum: ["xlookup", "index_match"] }, not_found: { type: "string" }, header: { type: "string" }, sheet: { type: "string" } }, required: ["key_column", "from_row", "to_row", "output_column", "lookup_range", "return_offset"] },
    label: () => "Adding lookup column",
    execute: ({ key_column, from_row, to_row, output_column, lookup_range, key_offset, return_offset, method, not_found, header, sheet }) => {
      const sh = sheetOf(sheet);
      const lk = resolveRange(wb(), lookup_range, sh);
      const r = normalizeRange(lk.range);
      const width = r.end.col - r.start.col + 1;
      const ko = key_offset ?? 0;
      if (return_offset < 0 || return_offset >= width || ko < 0 || ko >= width) throw new Error(`Offsets must be within the ${width} column(s) of ${lookup_range}`);
      const pre = lk.sheet.id === sh.id ? "" : `${quoteSheet(lk.sheet.name)}!`;
      const colAbs = (c: number) => `${pre}$${colToLetter(c)}$${r.start.row + 1}:$${colToLetter(c)}$${r.end.row + 1}`;
      const keys = colAbs(r.start.col + ko), ret = colAbs(r.start.col + return_offset);
      const nf = `"${(not_found ?? "not found").replace(/"/g, '""')}"`;
      const k = `${letter(key_column)}{row}`;
      const template = (method ?? "xlookup") === "xlookup" ? `=IFERROR(XLOOKUP(${k},${keys},${ret}),${nf})` : `=IFERROR(INDEX(${ret},MATCH(${k},${keys},0)),${nf})`;
      const out = letter(output_column);
      const ops: SheetOp[] = [{ type: "set_formula_column", sheet: sh.id, column: out, from_row, to_row, template }];
      if (header && from_row > 1) ops.push({ type: "set_cells", sheet: sh.id, cells: [{ ref: `${out}${from_row - 1}`, value: header, style: { bold: true } }] });
      const res = edit(ops.length === 1 ? ops[0] : { type: "batch", ops }, { title: `Lookup column ${out}${from_row}:${out}${to_row}`, summary: template.replace(/\{row\}/g, String(from_row)), readBack: [`${sh.name}!${out}${from_row}:${out}${Math.min(to_row, from_row + 11)}`] });
      const cur = sheetOf(sh.id);
      let matched = 0, missing = 0;
      const missingRows: number[] = [];
      for (let row = from_row; row <= to_row; row++) { const v = cellValue(s, cur, `${out}${row}`); if (v === (not_found ?? "not found")) { missing++; if (missingRows.length < 20) missingRows.push(row); } else matched++; }
      return { ...res, matched, notFound: missing, notFoundRows: missingRows.length ? missingRows : undefined };
    },
  });

  const damages_schedule = defineTool<{ principal: number | string; start: string; end: string; rate?: number; rates?: { from: string; to?: string; rate: number }[]; basis?: 360 | 365; compounding?: "simple" | "annual"; split_by_year?: boolean; sheet?: string; anchor?: string; new_sheet?: string; title?: string }>({
    name: "damages_schedule",
    description: "Build a prejudgment-interest schedule with live formulas: inputs block (principal as a number or a formula/cell reference such as '=Damages!B20', day-count basis, compounding), one row per rate period (period boundaries computed deterministically; split_by_year for statutes applied per calendar year), days = end - start, interest = ROUND(principal × rate × days / basis, 2) (annual compounding adds prior interest to the base), cumulative interest, totals and principal + interest. Rates are decimals (0.1 = 10%). Returns the engine-computed totals.",
    parameters: { type: "object", properties: { principal: { anyOf: [{ type: "number" }, { type: "string" }] }, start: { type: "string" }, end: { type: "string" }, rate: { type: "number" }, rates: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, rate: { type: "number" } }, required: ["from", "rate"] } }, basis: { type: "integer", enum: [360, 365] }, compounding: { type: "string", enum: ["simple", "annual"] }, split_by_year: { type: "boolean" }, sheet: { type: "string" }, anchor: { type: "string" }, new_sheet: { type: "string" }, title: { type: "string" } }, required: ["principal", "start", "end"] },
    label: () => "Building interest schedule",
    execute: (a) => {
      const rates = a.rates?.length ? a.rates : a.rate !== undefined && a.rate !== null ? [{ from: a.start, rate: a.rate }] : null;
      if (!rates) throw new Error("Pass rate or rates");
      for (const r of rates) if (!(r.rate >= 0 && r.rate < 1)) throw new Error(`Rate ${r.rate} must be a decimal between 0 and 1 (e.g. 0.1 for 10%)`);
      const place = placement(a.sheet, a.anchor, a.new_sheet, { sheet: sheetOf(null), col: 0 });
      const built = buildDamagesOps({ target: place.target, anchor: place.anchor, principal: a.principal, start: a.start, end: a.end, rates, basis: a.basis === 360 ? 360 : 365, compounding: a.compounding ?? "simple", splitByYear: a.split_by_year ?? false, title: a.title });
      const res = edit({ type: "batch", ops: [...place.ops, ...built.ops] }, { title: `Prejudgment interest ${a.start} → ${a.end}`, summary: `${built.periods} period(s), ${a.compounding ?? "simple"} interest, ${a.basis === 360 ? 360 : 365}-day basis`, readBack: [`${place.target.name}!${built.interestRef}`, `${place.target.name}!${built.totalRef}`] });
      const tgt = sheetOf(place.target.id);
      return { ...res, scheduleRange: `${tgt.name}!${built.range}`, totalInterest: { ref: `${tgt.name}!${built.interestRef}`, value: cellValue(s, tgt, built.interestRef), display: displayValue(s, tgt, built.interestRef) }, principalPlusInterest: { ref: `${tgt.name}!${built.totalRef}`, value: cellValue(s, tgt, built.totalRef), display: displayValue(s, tgt, built.totalRef) } };
    },
  });

  return [
    get_workbook_summary, get_sheet_overview, get_range, get_headers, get_selection, find_cells, describe_data, validate_formulas,
    audit_formulas, explain_formula, trace_precedents, trace_dependents, evaluate_formula, date_math,
    set_cells, write_range, fill_range, set_formula_column, insert_rows, insert_cols, delete_rows, delete_cols,
    set_style, set_number_format, set_column_width, set_row_height, hide_rows_cols, merge_cells, unmerge_cells, set_freeze_panes,
    sort_range, add_filter, clear_filter, add_conditional_format, set_data_validation, create_chart, add_sheet, set_sheet_name, create_named_range,
    clear_range, add_comment, build_table, transcribe_image_to_cells, summarize_table, lookup_join, damages_schedule,
  ] as AnyTool[];
}
