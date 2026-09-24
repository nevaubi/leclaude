/**
 * Spreadsheet agent tools. Read tools answer from the snapshot (model +
 * computed values). Edit tools apply a SheetOp to the snapshot workbook,
 * recompute with the engine, and register an EditProposal whose payload is
 * the op — the client applies exactly that op through its store (undoable).
 *
 * Tool names are chosen so the shared route factory classifies them
 * correctly (edit tools start with set_/add_/fill_/insert_/delete_/style_/
 * sort_/merge_/clear_/build_/transcribe_; read tools start with get_/find_/
 * describe_/validate_).
 */
import { nanoid } from "nanoid";
import { colToLetter, letterToCol, parseA1, rangeSize, rangeToA1, toA1 } from "./a1";
import { defineTool, type ToolDef } from "@/lib/ai/tools";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { EditProposal } from "@/modules/office/shared/types";
import { formulaErrors } from "./engine";
import { getSheet, getStyle, resolveRange, usedRange, type CellStyle, type CellValue, type CFRule, type ChartType, type NumFmt, type Sheet } from "./model";
import { applyOp, describeOp, opTarget, type CellInput, type SheetOp } from "./ops";
import { cellValue, describeValues, displayValue, headerInfo, recompute, type SheetSnapshot } from "./snapshot";

type Ctx = OfficeAgentContext<SheetSnapshot>;

const STYLE_SCHEMA = {
  type: "object",
  description: "Style patch. Omit a property to leave it unchanged; null clears it.",
  properties: {
    bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" },
    align: { type: "string", enum: ["left", "center", "right"] },
    valign: { type: "string", enum: ["top", "middle", "bottom"] },
    wrap: { type: "boolean" },
    numFmt: { type: "string", description: "General | 0 | 0.00 | #,##0 | #,##0.00 | $#,##0.00 | $#,##0 | 0% | 0.00% | yyyy-mm-dd | mmm d yyyy | m/d/yyyy | text | custom like #,##0.00;(#,##0.00)" },
    fill: { type: "string", description: "Background hex color, e.g. #1F3A5F" },
    color: { type: "string", description: "Text hex color" },
    border: { type: "string", enum: ["none", "thin", "medium", "thick", "bottom", "top", "outline", "all"] },
    fontSize: { type: "number" },
  },
  required: [],
} as const;

const RULE_SCHEMA = {
  type: "object",
  description: "Conditional rule: {kind:'gt'|'lt', value} | {kind:'between', min, max} | {kind:'eq', value} | {kind:'contains', text} | {kind:'dueBefore', date:'today'|'yyyy-mm-dd', days?} | {kind:'top', count, bottom?} | {kind:'blank'} | {kind:'duplicate'}",
  properties: {
    kind: { type: "string", enum: ["gt", "lt", "between", "eq", "contains", "dueBefore", "top", "blank", "duplicate"] },
    value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] },
    min: { type: "number" }, max: { type: "number" },
    text: { type: "string" },
    date: { type: "string" }, days: { type: "integer" },
    count: { type: "integer" }, bottom: { type: "boolean" },
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
    default: throw new Error(`Unknown rule kind "${kind}"`);
  }
}

function cleanStyle(raw: Record<string, unknown> | null | undefined): Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) if (v !== undefined) out[k] = v;
  return out as Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>>;
}

function rangeText(snapshot: SheetSnapshot, sheet: Sheet, rangeStr: string, maxCells = 600) {
  const { range } = resolveRange(snapshot.workbook, rangeStr, sheet);
  const size = rangeSize(range);
  const rows: Record<string, unknown>[] = [];
  let n = 0;
  for (let r = range.start.row; r <= range.end.row; r++) {
    const row: Record<string, unknown> = { row: r + 1 };
    let any = false;
    for (let c = range.start.col; c <= range.end.col; c++) {
      const ref = toA1(r, c);
      const cell = sheet.cells[ref];
      if (!cell) continue;
      n++;
      if (n > maxCells) break;
      any = true;
      const entry: Record<string, unknown> = { v: cellValue(snapshot, sheet, ref) };
      if (cell.f) entry.f = cell.f;
      const st = getStyle(snapshot.workbook, cell);
      if (Object.keys(st).length) entry.s = st;
      const disp = displayValue(snapshot, sheet, ref);
      if (disp !== String(entry.v ?? "")) entry.display = disp;
      row[colToLetter(c)] = entry;
    }
    if (any) rows.push(row);
    if (n > maxCells) { rows.push({ truncated: true, note: `stopped after ${maxCells} cells; request a smaller range` }); break; }
  }
  return { sheet: sheet.name, range: rangeToA1(range), size, rows };
}

export function sheetAgentTools(ctx: Ctx): ToolDef<never, unknown>[] {
  const s = ctx.snapshot;
  const wb = () => s.workbook;
  const sheetOf = (key?: string | null) => getSheet(wb(), key ?? s.activeSheet);

  /** Apply an op to the snapshot, recompute and propose. */
  const edit = (op: SheetOp, meta: { title?: string; summary?: string; risk?: EditProposal["risk"] } = {}) => {
    const before = s.workbook;
    let next;
    try { next = applyOp(before, op); } catch (e) { throw new Error(`Cannot apply: ${(e as Error).message}`); }
    s.workbook = next;
    recompute(s);
    if (op.type === "add_sheet" || op.type === "set_active_sheet") s.activeSheet = next.sheets[next.activeSheet].name;
    if (op.type === "rename_sheet") { const sh = getSheet(next, op.sheet ?? s.activeSheet); if (before.sheets[before.activeSheet]?.id === sh.id) s.activeSheet = sh.name; }
    const target = opTarget(next, op);
    const p = ctx.propose({
      kind: op.type,
      title: meta.title ?? describeOp(op),
      summary: meta.summary,
      target: target ? `${target.sheet}!${target.range}` : undefined,
      targetLabel: target ? (target.sheet === s.activeSheet ? target.range : `${target.sheet}!${target.range}`) : undefined,
      payload: { op },
      risk: meta.risk ?? (op.type.startsWith("delete_") || op.type === "sort_range" || op.type === "clear_range" ? "medium" : "low"),
    });
    const errors = formulaErrors(next, s.computed).slice(0, 8);
    return { ok: true, proposal: p.id, target: p.target, formulaErrors: errors.length ? errors : undefined };
  };

  // ------------------------------------------------------------------ reads
  const get_sheet_overview = defineTool<{ sheet?: string }>({
    name: "get_sheet_overview",
    description: "Overview of a sheet (default: active): used range, detected header row and column names, per-column data profile (type, blanks, sum/min/max), formulas count, charts, conditional formats, merges, freeze panes, named ranges.",
    parameters: { type: "object", properties: { sheet: { type: "string", description: "Sheet name or id" } }, required: [] },
    label: (a) => `Reading ${a.sheet ?? "sheet"} overview`,
    execute: ({ sheet }) => {
      const sh = sheetOf(sheet);
      const ur = usedRange(sh);
      const hi = headerInfo(s, sh);
      const columns: Record<string, unknown>[] = [];
      if (ur) {
        for (let c = ur.start.col; c <= ur.end.col; c++) {
          const values: CellValue[] = [];
          let formulas = 0;
          for (let r = (hi ? hi.row : ur.start.row); r <= ur.end.row; r++) { const ref = toA1(r, c); if (sh.cells[ref]?.f) formulas++; values.push(cellValue(s, sh, ref)); }
          const d = describeValues(values);
          columns.push({ col: colToLetter(c), header: hi?.headers.find((h) => h.col === colToLetter(c))?.name, formulas, ...d, sample: d.sample.slice(0, 3) });
        }
      }
      return { sheet: sh.name, id: sh.id, usedRange: ur ? rangeToA1(ur) : null, headerRow: hi?.row ?? null, headers: hi?.headers ?? [], columns, cells: Object.keys(sh.cells).length, formulas: Object.values(sh.cells).filter((c) => c.f).length, charts: sh.charts, conditionalFormats: sh.conditionalFormats, merges: sh.merges, freeze: sh.freeze, filters: sh.filters ?? null, namedRanges: wb().namedRanges, sheets: wb().sheets.map((x) => x.name) };
    },
  });

  const get_range = defineTool<{ range: string; sheet?: string }>({
    name: "get_range",
    description: "Read cells in a range (A1 notation, named range, or Sheet!A1:B9): value, formula, style and display text for every non-empty cell. Max ~600 cells per call.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" } }, required: ["range"] },
    label: (a) => `Reading ${a.range}`,
    execute: ({ range, sheet }) => rangeText(s, sheetOf(sheet), range),
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
    execute: () => { if (!s.selection) return { selection: null, activeSheet: s.activeSheet }; const sh = sheetOf(s.selection.sheet); return { selection: s.selection, ...rangeText(s, sh, s.selection.range, 300) }; },
  });

  const find_cells = defineTool<{ query: string; sheet?: string; regex?: boolean; in_formulas?: boolean; limit?: number }>({
    name: "find_cells",
    description: "Find cells whose value (or formula when in_formulas) contains text (case-insensitive) or matches a regex. Searches all sheets unless sheet is given.",
    parameters: { type: "object", properties: { query: { type: "string" }, sheet: { type: "string" }, regex: { type: "boolean" }, in_formulas: { type: "boolean" }, limit: { type: "integer" } }, required: ["query"] },
    label: (a) => `Searching "${a.query}"`,
    execute: ({ query, sheet, regex, in_formulas, limit }) => {
      const re = regex ? new RegExp(query, "i") : null;
      const q = query.toLowerCase();
      const hits: { sheet: string; ref: string; value: CellValue; formula?: string }[] = [];
      const sheets = sheet ? [sheetOf(sheet)] : wb().sheets;
      for (const sh of sheets) {
        for (const [ref, cell] of Object.entries(sh.cells)) {
          const v = cellValue(s, sh, ref);
          const hay = in_formulas ? `${cell.f ?? ""}` : `${v ?? ""} ${displayValue(s, sh, ref)}`;
          if (re ? re.test(hay) : hay.toLowerCase().includes(q)) hits.push({ sheet: sh.name, ref, value: v, formula: cell.f });
          if (hits.length >= (limit ?? 50)) break;
        }
      }
      return { count: hits.length, hits };
    },
  });

  const describe_data = defineTool<{ range: string; sheet?: string; has_header?: boolean }>({
    name: "describe_data",
    description: "Profile a range: per-column type mix, blanks, distinct count, sum/avg/min/max, sample values; flags mixed types and text-that-looks-numeric.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" }, has_header: { type: "boolean" } }, required: ["range"] },
    label: (a) => `Profiling ${a.range}`,
    execute: ({ range, sheet, has_header }) => {
      const sh = sheetOf(sheet);
      const { range: r } = resolveRange(wb(), range, sh);
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

  const validate_formulas = defineTool<{ range?: string; sheet?: string }>({
    name: "validate_formulas",
    description: "Report formula errors (#REF!, #DIV/0!, #NAME?, #VALUE!, #N/A, cycles) and suspicious formulas (hardcoded numbers mixed with references, SUM over a range that skips adjacent numbers, inconsistent formulas in a column). Optionally limited to a range.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" } }, required: [] },
    label: () => "Validating formulas",
    execute: ({ range, sheet }) => {
      const sh = sheet || range ? sheetOf(sheet) : null;
      let errors = formulaErrors(wb(), s.computed, sh?.id);
      const warnings: { sheet: string; ref: string; formula: string; issue: string }[] = [];
      const sheets = sh ? [sh] : wb().sheets;
      let inRange: ((row: number, col: number) => boolean) | null = null;
      if (range && sh) { const { range: r } = resolveRange(wb(), range, sh); inRange = (row, col) => row >= r.start.row && row <= r.end.row && col >= r.start.col && col <= r.end.col; errors = errors.filter((e) => { const p = parseA1(e.ref); return inRange!(p.row, p.col); }); }
      for (const x of sheets) {
        const byCol = new Map<number, { row: number; ref: string; f: string; shape: string }[]>();
        for (const [ref, cell] of Object.entries(x.cells)) {
          if (!cell.f) continue;
          const p = parseA1(ref);
          if (inRange && !inRange(p.row, p.col)) continue;
          if (/[+\-*/]\s*\d{2,}(\.\d+)?(?![\d:!A-Z])/.test(cell.f.replace(/"[^"]*"/g, "")) && /[A-Z]{1,3}\d+/.test(cell.f)) warnings.push({ sheet: x.name, ref, formula: cell.f, issue: "hardcoded number inside a formula — move it to an input cell and reference it" });
          const shape = cell.f.replace(/\$?[A-Z]{1,3}\$?\d+/g, "REF").replace(/\d+(\.\d+)?/g, "N");
          const list = byCol.get(p.col) ?? [];
          list.push({ row: p.row, ref, f: cell.f, shape });
          byCol.set(p.col, list);
        }
        for (const list of byCol.values()) {
          if (list.length < 4) continue;
          const counts = new Map<string, number>();
          for (const it of list) counts.set(it.shape, (counts.get(it.shape) ?? 0) + 1);
          const [common, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
          if (n >= list.length * 0.6) for (const it of list) if (it.shape !== common && counts.get(it.shape)! <= 2) warnings.push({ sheet: x.name, ref: it.ref, formula: it.f, issue: "formula inconsistent with the rest of its column" });
        }
      }
      return { errors, warnings: warnings.slice(0, 40), ok: errors.length === 0 && warnings.length === 0 };
    },
  });

  // ------------------------------------------------------------------ edits
  const set_cells = defineTool<{ sheet?: string; cells: { ref: string; value?: string | number | boolean | null; formula?: string; style?: Record<string, unknown> | null }[] }>({
    name: "set_cells",
    description: "Write values and/or formulas (and optional style) into specific cells. Values are typed (numbers as numbers, ISO dates as 'yyyy-mm-dd' strings, text as strings). Formulas start with '='. Use fill_range / set_formula_column for repeating formulas.",
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
      if (to_row < from_row) throw new Error("to_row must be >= from_row");
      if (to_row - from_row > 5000) throw new Error("Too many rows (max 5000)");
      const ops: SheetOp[] = [{ type: "set_formula_column", sheet: sh.id, column: column.toUpperCase(), from_row, to_row, template }];
      if (header && from_row > 1) {
        const headerRef = `${column.toUpperCase()}${from_row - 1}`;
        const neighbour = sh.cells[`${colToLetter(Math.max(0, letterToCol(column) - 1))}${from_row - 1}`];
        ops.push({ type: "set_cells", sheet: sh.id, cells: [{ ref: headerRef, value: header, style: neighbour?.s ? getStyle(wb(), neighbour) : { bold: true } }] });
      }
      if (numFmt) ops.push({ type: "set_number_format", sheet: sh.id, range: `${column.toUpperCase()}${from_row}:${column.toUpperCase()}${to_row}`, numFmt: numFmt as NumFmt });
      return edit(ops.length === 1 ? ops[0] : { type: "batch", ops }, { title: `Formula column ${column.toUpperCase()}${from_row}:${column.toUpperCase()}${to_row}`, summary: `${template}${header ? ` (header "${header}")` : ""}` });
    },
  });

  const insert_rows = defineTool<{ at_row: number; count?: number; sheet?: string }>({
    name: "insert_rows",
    description: "Insert blank rows before 1-based row at_row. References and named ranges below shift automatically.",
    parameters: { type: "object", properties: { at_row: { type: "integer" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_row"] },
    execute: ({ at_row, count, sheet }) => edit({ type: "insert_rows", sheet: sheetOf(sheet).id, index: at_row - 1, count: count ?? 1 }),
  });
  const delete_rows = defineTool<{ at_row: number; count?: number; sheet?: string }>({
    name: "delete_rows",
    description: "Delete rows starting at 1-based at_row. Formulas referencing deleted cells become #REF!.",
    parameters: { type: "object", properties: { at_row: { type: "integer" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_row"] },
    execute: ({ at_row, count, sheet }) => edit({ type: "delete_rows", sheet: sheetOf(sheet).id, index: at_row - 1, count: count ?? 1 }, { risk: "medium" }),
  });
  const insert_cols = defineTool<{ at_column: string; count?: number; sheet?: string }>({
    name: "insert_cols",
    description: "Insert blank columns before column letter at_column.",
    parameters: { type: "object", properties: { at_column: { type: "string" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_column"] },
    execute: ({ at_column, count, sheet }) => edit({ type: "insert_cols", sheet: sheetOf(sheet).id, index: letterToCol(at_column), count: count ?? 1 }),
  });
  const delete_cols = defineTool<{ at_column: string; count?: number; sheet?: string }>({
    name: "delete_cols",
    description: "Delete columns starting at column letter at_column.",
    parameters: { type: "object", properties: { at_column: { type: "string" }, count: { type: "integer" }, sheet: { type: "string" } }, required: ["at_column"] },
    execute: ({ at_column, count, sheet }) => edit({ type: "delete_cols", sheet: sheetOf(sheet).id, index: letterToCol(at_column), count: count ?? 1 }, { risk: "medium" }),
  });

  const style_range = defineTool<{ range: string; style: Record<string, unknown>; sheet?: string }>({
    name: "style_range",
    description: "Apply a style patch (bold, fill, color, border, align, wrap, numFmt, fontSize) to every cell in a range. Professional header: {bold:true, fill:'#1F3A5F', color:'#FFFFFF', border:'thin'}; totals: {bold:true, fill:'#EEF2F7', border:'top'}.",
    parameters: { type: "object", properties: { range: { type: "string" }, style: STYLE_SCHEMA, sheet: { type: "string" } }, required: ["range", "style"] },
    label: (a) => `Styling ${a.range}`,
    execute: ({ range, style, sheet }) => edit({ type: "style_range", sheet: sheetOf(sheet).id, range, style: cleanStyle(style) }, { summary: JSON.stringify(style) }),
  });

  const set_number_format = defineTool<{ range: string; numFmt: string; sheet?: string }>({
    name: "set_number_format",
    description: "Set the number format of a range: General, 0, 0.00, #,##0, #,##0.00, $#,##0.00, $#,##0, 0%, 0.00%, yyyy-mm-dd, mmm d yyyy, m/d/yyyy, text, or a custom pattern like #,##0.00;(#,##0.00).",
    parameters: { type: "object", properties: { range: { type: "string" }, numFmt: { type: "string" }, sheet: { type: "string" } }, required: ["range", "numFmt"] },
    execute: ({ range, numFmt, sheet }) => edit({ type: "set_number_format", sheet: sheetOf(sheet).id, range, numFmt: numFmt as NumFmt }),
  });

  const set_column_width = defineTool<{ columns: string[]; width?: number; autofit?: boolean; sheet?: string }>({
    name: "set_column_width",
    description: "Set column widths in pixels (e.g. columns ['A','C'], width 160) or autofit:true to size columns to their content. Omit columns with autofit to fit every used column.",
    parameters: { type: "object", properties: { columns: { type: "array", items: { type: "string" } }, width: { type: "number" }, autofit: { type: "boolean" }, sheet: { type: "string" } }, required: ["columns"] },
    execute: ({ columns, width, autofit, sheet }) => {
      const sh = sheetOf(sheet);
      if (autofit || width == null) return edit({ type: "autofit_columns", sheet: sh.id, columns: columns.length ? columns.map((c) => c.toUpperCase()) : undefined });
      return edit({ type: "set_column_width", sheet: sh.id, columns: columns.map((c) => c.toUpperCase()), width });
    },
  });

  const merge_cells = defineTool<{ range: string; sheet?: string; unmerge?: boolean }>({
    name: "merge_cells",
    description: "Merge a range into one cell (title rows, section bands) or unmerge with unmerge:true.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" }, unmerge: { type: "boolean" } }, required: ["range"] },
    execute: ({ range, sheet, unmerge }) => edit({ type: unmerge ? "unmerge_cells" : "merge_cells", sheet: sheetOf(sheet).id, range }),
  });

  const set_freeze_panes = defineTool<{ rows: number; cols?: number; sheet?: string }>({
    name: "set_freeze_panes",
    description: "Freeze the top N rows and/or first M columns so headers stay visible while scrolling. rows:1 freezes the header row; rows:0 cols:0 unfreezes.",
    parameters: { type: "object", properties: { rows: { type: "integer" }, cols: { type: "integer" }, sheet: { type: "string" } }, required: ["rows"] },
    execute: ({ rows, cols, sheet }) => edit({ type: "freeze_panes", sheet: sheetOf(sheet).id, rows, cols: cols ?? 0 }),
  });

  const sort_range = defineTool<{ range: string; by: string; order?: "asc" | "desc"; has_header?: boolean; then_by?: string; sheet?: string }>({
    name: "sort_range",
    description: "Sort the rows of a range by a column letter (e.g. by 'D'), ascending or descending; has_header keeps the first row in place. Whole rows within the range move together and formulas keep pointing at their own row.",
    parameters: { type: "object", properties: { range: { type: "string" }, by: { type: "string" }, order: { type: "string", enum: ["asc", "desc"] }, has_header: { type: "boolean" }, then_by: { type: "string" }, sheet: { type: "string" } }, required: ["range", "by"] },
    label: (a) => `Sorting ${a.range} by ${a.by}`,
    execute: ({ range, by, order, has_header, then_by, sheet }) => edit({ type: "sort_range", sheet: sheetOf(sheet).id, range, by: by.toUpperCase(), order: order ?? "asc", has_header: has_header ?? true, then_by: then_by?.toUpperCase() }),
  });

  const add_filter = defineTool<{ range: string; sheet?: string; column?: string; values?: string[]; condition?: { op: string; value?: string | number } }>({
    name: "add_filter",
    description: "Turn on filter dropdowns for a table range (header row first). Optionally also apply a criterion to one column: values (allowed list) or condition {op: contains|eq|neq|gt|lt|gte|lte|startsWith|blank|notBlank, value}.",
    parameters: { type: "object", properties: { range: { type: "string" }, sheet: { type: "string" }, column: { type: "string" }, values: { type: "array", items: { type: "string" } }, condition: { type: "object", properties: { op: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }] } }, required: ["op"] } }, required: ["range"] },
    execute: ({ range, sheet, column, values, condition }) => {
      const sh = sheetOf(sheet);
      const ops: SheetOp[] = [{ type: "add_filter", sheet: sh.id, range }];
      if (column && (values || condition)) ops.push({ type: "set_filter_criteria", sheet: sh.id, column: column.toUpperCase(), criteria: { values: values ?? null, condition: condition ? { op: condition.op as "contains", value: condition.value } : undefined } });
      return edit(ops.length === 1 ? ops[0] : { type: "batch", ops }, { title: `Filter ${range}${column ? ` on ${column.toUpperCase()}` : ""}` });
    },
  });

  const add_conditional_format = defineTool<{ range: string; rule: Record<string, unknown>; style: Record<string, unknown>; sheet?: string }>({
    name: "add_conditional_format",
    description: "Highlight cells matching a rule (gt/lt/between/eq/contains/dueBefore/top/blank/duplicate) with a style, e.g. overdue dates: rule {kind:'dueBefore', date:'today'} style {fill:'#FDE2E1', color:'#9F1239'}.",
    parameters: { type: "object", properties: { range: { type: "string" }, rule: RULE_SCHEMA, style: STYLE_SCHEMA, sheet: { type: "string" } }, required: ["range", "rule", "style"] },
    execute: ({ range, rule, style, sheet }) => edit({ type: "conditional_format", sheet: sheetOf(sheet).id, range, rule: toRule(rule), style: cleanStyle(style) as CellStyle, id: `cf_${nanoid(6)}` }, { summary: `${JSON.stringify(rule)} → ${JSON.stringify(style)}` }),
  });

  const add_chart = defineTool<{ type: ChartType; title: string; range: string; category_range?: string; sheet?: string; position?: { x?: number; y?: number; w?: number; h?: number }; has_header?: boolean; stacked?: boolean }>({
    name: "add_chart",
    description: "Add a chart (bar, line, pie, area, scatter) from a data range (one or more numeric columns, header row first) with an optional category (label) range such as the first column. Position is in pixels from the grid origin; default places it to the right of the data.",
    parameters: { type: "object", properties: { type: { type: "string", enum: ["bar", "line", "pie", "area", "scatter"] }, title: { type: "string" }, range: { type: "string" }, category_range: { type: "string" }, sheet: { type: "string" }, position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: [] }, has_header: { type: "boolean" }, stacked: { type: "boolean" } }, required: ["type", "title", "range"] },
    label: (a) => `Adding ${a.type} chart`,
    execute: ({ type, title, range, category_range, sheet, position, has_header, stacked }) => edit({ type: "add_chart", sheet: sheetOf(sheet).id, chart: { id: `ch_${nanoid(6)}`, type, title, range, categoryRange: category_range, hasHeader: has_header ?? true, stacked, position: position ?? undefined } }, { title: `Add ${type} chart "${title}"`, summary: `data ${range}${category_range ? `, categories ${category_range}` : ""}` }),
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

  const add_named_range = defineTool<{ name: string; ref: string }>({
    name: "add_named_range",
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
    description: "Attach a comment to a cell (e.g. an assumption that needs confirmation, a [VERIFY] note, or the source of a number).",
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

  const add_validation = defineTool<{ range: string; kind: "list" | "number" | "date"; list?: string[]; min?: number; max?: number; message?: string; sheet?: string }>({
    name: "add_validation",
    description: "Add data validation to a range: a dropdown list (kind 'list' with list values), or number/date bounds.",
    parameters: { type: "object", properties: { range: { type: "string" }, kind: { type: "string", enum: ["list", "number", "date"] }, list: { type: "array", items: { type: "string" } }, min: { type: "number" }, max: { type: "number" }, message: { type: "string" }, sheet: { type: "string" } }, required: ["range", "kind"] },
    execute: ({ range, kind, list, min, max, message, sheet }) => edit({ type: "add_validation", sheet: sheetOf(sheet).id, range, kind, list, min, max, message, id: `dv_${nanoid(6)}` }),
  });

  const set_row_height = defineTool<{ rows: number[]; height: number; sheet?: string }>({
    name: "set_row_height",
    description: "Set the pixel height of 1-based rows (e.g. taller title row).",
    parameters: { type: "object", properties: { rows: { type: "array", items: { type: "integer" } }, height: { type: "number" }, sheet: { type: "string" } }, required: ["rows", "height"] },
    execute: ({ rows, height, sheet }) => edit({ type: "set_row_height", sheet: sheetOf(sheet).id, rows: rows.map((r) => r - 1), height }),
  });

  return [
    get_sheet_overview, get_range, get_headers, get_selection, find_cells, describe_data, validate_formulas,
    set_cells, fill_range, set_formula_column, insert_rows, insert_cols, delete_rows, delete_cols,
    style_range, set_number_format, set_column_width, set_row_height, merge_cells, set_freeze_panes,
    sort_range, add_filter, add_conditional_format, add_chart, add_sheet, set_sheet_name, add_named_range,
    clear_range, add_comment, build_table, transcribe_image_to_cells, add_validation,
  ] as ToolDef<never, unknown>[];
}
