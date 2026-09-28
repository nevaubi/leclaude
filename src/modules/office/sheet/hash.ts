/**
 * Deterministic, isomorphic content hashing for the sheet model: fingerprints
 * that decide which xlsx parts an export must rewrite, and base versions that
 * let the client reject stale agent proposals. Not a security primitive.
 */
import { colToLetter, normalizeRange, parseA1, parseRange, toA1 } from "./a1";
import { styleKey, type Sheet, type Workbook } from "./model";

/** JSON with sorted keys and undefined dropped, so equal models hash equally regardless of key order. */
export function stableJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

/** Drop null / undefined / empty arrays and objects, so a model that only differs by normalization defaults hashes equally. */
export function prune(v: unknown): unknown {
  if (Array.isArray(v)) { const a = v.map(prune); return a.length ? a : undefined; }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const p = prune(x); if (p !== undefined && p !== null) out[k] = p; }
    return Object.keys(out).length ? out : undefined;
  }
  return v === null ? undefined : v;
}

/** 64-bit FNV-1a (two 32-bit lanes) as 16 hex chars. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function hashValue(v: unknown): string { return hashString(stableJson(v)); }

/** Cells with style ids replaced by the style's content key (style ids are workbook-local). */
function resolvedCells(wb: Workbook, cells: Sheet["cells"], filter?: (ref: string) => boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [ref, c] of Object.entries(cells)) {
    if (filter && !filter(ref)) continue;
    out[ref] = { ...c, s: c.s ? styleKey(wb.styles[c.s] ?? {}) : undefined };
  }
  return out;
}

/** Fingerprint of everything that is serialized into a sheet's worksheet part (and its drawing/comments). */
export function sheetFingerprint(wb: Workbook, sheet: Sheet): string {
  const { id: _id, name: _name, hidden: _h, veryHidden: _vh, cells, colStyles, rowStyles, ...rest } = sheet;
  void _id; void _name; void _h; void _vh;
  const styleRef = (m?: Record<string, string>) => (m ? Object.fromEntries(Object.entries(m).map(([k, s]) => [k, styleKey(wb.styles[s] ?? {})])) : undefined);
  // chart series reference the sheet by name, so a renamed sheet with charts must be rewritten
  return hashValue(prune({ cells: resolvedCells(wb, cells), colStyles: styleRef(colStyles), rowStyles: styleRef(rowStyles), rest, page: wb.pageSetup ?? null, chartSheet: sheet.charts.length ? sheet.name : null }));
}

/** Fingerprint of the workbook-level part (sheet list, states, defined names, print titles/areas). */
export function workbookFingerprint(wb: Workbook): string {
  return hashValue(prune({
    sheets: wb.sheets.map((s) => ({ id: s.id, name: s.name, hidden: Boolean(s.hidden), veryHidden: Boolean(s.veryHidden), localNames: s.localNames ?? null, pa: s.pageSetup?.printArea ?? null, rr: s.pageSetup?.repeatHeaderRows ?? null, rc: s.pageSetup?.repeatCols ?? null, filter: s.filters?.range ?? null })),
    names: wb.namedRanges, extra: wb.extraNames ?? null, page: { pa: wb.pageSetup?.printArea ?? null, rr: wb.pageSetup?.repeatHeaderRows ?? null, rc: wb.pageSetup?.repeatCols ?? null },
  }));
}

/**
 * Content hash of a range on a sheet (values, formulas, resolved styles). `range` null = the whole sheet,
 * including structure (merges, widths, filters…). Used as a proposal's base version.
 */
export function rangeHash(wb: Workbook, sheetId: string, range: string | null): string {
  const sheet = wb.sheets.find((s) => s.id === sheetId);
  if (!sheet) return "missing-sheet";
  if (!range) return hashValue({ name: sheet.name, fp: sheetFingerprint(wb, sheet) });
  let r;
  try { r = normalizeRange(parseRange(range, { maxRow: 1_048_575, maxCol: 16_383 })); } catch { return hashValue({ bad: range }); }
  const inRange = (ref: string) => { const p = parseA1(ref); return p.row >= r.start.row && p.row <= r.end.row && p.col >= r.start.col && p.col <= r.end.col; };
  return hashValue({ cells: resolvedCells(wb, sheet.cells, inRange), range: `${toA1(r.start.row, r.start.col)}:${colToLetter(r.end.col)}${r.end.row + 1}` });
}
