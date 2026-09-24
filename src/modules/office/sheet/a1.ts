/**
 * A1 notation utilities shared by the grid, the formula engine wrapper, the
 * agent tools and the XLSX import/export. Pure, isomorphic, dependency-free.
 *
 * Conventions: rows and columns are 0-based in code, 1-based in A1 strings.
 */

export interface CellRef { row: number; col: number; absRow?: boolean; absCol?: boolean; sheet?: string }
export interface RangeRef { start: CellRef; end: CellRef; sheet?: string }

const COL_RE = /^([A-Z]{1,3})$/;
const CELL_RE = /^(?:(?:'([^']+)'|([A-Za-z0-9_.]+))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const RANGE_RE = /^(?:(?:'([^']+)'|([A-Za-z0-9_.]+))!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?$/;
const COL_RANGE_RE = /^(?:(?:'([^']+)'|([A-Za-z0-9_.]+))!)?(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})$/;
const ROW_RANGE_RE = /^(?:(?:'([^']+)'|([A-Za-z0-9_.]+))!)?(\$?)(\d+):(\$?)(\d+)$/;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colToLetter(col: number): string {
  if (col < 0 || !Number.isFinite(col)) throw new Error(`Invalid column index ${col}`);
  let s = "";
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function letterToCol(letters: string): number {
  const up = letters.toUpperCase();
  if (!COL_RE.test(up)) throw new Error(`Invalid column letters "${letters}"`);
  let n = 0;
  for (let i = 0; i < up.length; i++) n = n * 26 + (up.charCodeAt(i) - 64);
  return n - 1;
}

export function toA1(row: number, col: number, opts: { absRow?: boolean; absCol?: boolean } = {}): string {
  return `${opts.absCol ? "$" : ""}${colToLetter(col)}${opts.absRow ? "$" : ""}${row + 1}`;
}

/** Parse "B4", "$B$4", "Sheet1!B4", "'Depo Schedule'!B4". */
export function parseA1(ref: string): CellRef {
  const m = CELL_RE.exec(ref.trim());
  if (!m) throw new Error(`Invalid cell reference "${ref}"`);
  const sheet = m[1] ?? m[2];
  const row = Number(m[6]) - 1;
  if (row < 0) throw new Error(`Invalid cell reference "${ref}"`);
  return { sheet, absCol: m[3] === "$", col: letterToCol(m[4]), absRow: m[5] === "$", row };
}

export function isA1(ref: string): boolean {
  return CELL_RE.test(ref.trim());
}

export function isRangeRef(ref: string): boolean {
  const t = ref.trim();
  return RANGE_RE.test(t) || COL_RANGE_RE.test(t) || ROW_RANGE_RE.test(t);
}

/**
 * Parse "A1:C10", "B4" (single cell range), "Sheet1!A1:B2", "A:C" (whole
 * columns; rows bounded by `maxRow`), "3:5" (whole rows bounded by `maxCol`).
 */
export function parseRange(ref: string, bounds: { maxRow?: number; maxCol?: number } = {}): RangeRef {
  const t = ref.trim();
  let m = RANGE_RE.exec(t);
  if (m) {
    const sheet = m[1] ?? m[2];
    const a = parseA1(m[3]);
    const b = m[4] ? parseA1(m[4]) : a;
    return normalizeRange({ sheet, start: { ...a, sheet: undefined }, end: { ...b, sheet: undefined } });
  }
  m = COL_RANGE_RE.exec(t);
  if (m) {
    const sheet = m[1] ?? m[2];
    return normalizeRange({ sheet, start: { row: 0, col: letterToCol(m[4]), absCol: m[3] === "$" }, end: { row: (bounds.maxRow ?? 1048576) - 1, col: letterToCol(m[6]), absCol: m[5] === "$" } });
  }
  m = ROW_RANGE_RE.exec(t);
  if (m) {
    const sheet = m[1] ?? m[2];
    return normalizeRange({ sheet, start: { row: Number(m[4]) - 1, col: 0, absRow: m[3] === "$" }, end: { row: Number(m[6]) - 1, col: (bounds.maxCol ?? 16384) - 1, absRow: m[5] === "$" } });
  }
  throw new Error(`Invalid range "${ref}"`);
}

export function normalizeRange(r: RangeRef): RangeRef {
  const r0 = Math.min(r.start.row, r.end.row), r1 = Math.max(r.start.row, r.end.row);
  const c0 = Math.min(r.start.col, r.end.col), c1 = Math.max(r.start.col, r.end.col);
  return { sheet: r.sheet, start: { row: r0, col: c0 }, end: { row: r1, col: c1 } };
}

export function rangeToA1(r: RangeRef, withSheet = false): string {
  const n = normalizeRange(r);
  const a = toA1(n.start.row, n.start.col);
  const b = toA1(n.end.row, n.end.col);
  const body = a === b ? a : `${a}:${b}`;
  return withSheet && n.sheet ? `${quoteSheet(n.sheet)}!${body}` : body;
}

export function quoteSheet(name: string): string {
  return /^[A-Za-z0-9_.]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Iterate every cell in a range (row-major). */
export function* iterateRange(r: RangeRef): Generator<{ row: number; col: number; ref: string }> {
  const n = normalizeRange(r);
  for (let row = n.start.row; row <= n.end.row; row++) for (let col = n.start.col; col <= n.end.col; col++) yield { row, col, ref: toA1(row, col) };
}

export function rangeCells(r: RangeRef): string[] {
  return Array.from(iterateRange(r), (c) => c.ref);
}

export function rangeSize(r: RangeRef): { rows: number; cols: number; cells: number } {
  const n = normalizeRange(r);
  const rows = n.end.row - n.start.row + 1, cols = n.end.col - n.start.col + 1;
  return { rows, cols, cells: rows * cols };
}

export function rangeContains(r: RangeRef, row: number, col: number): boolean {
  const n = normalizeRange(r);
  return row >= n.start.row && row <= n.end.row && col >= n.start.col && col <= n.end.col;
}

export function rangesIntersect(a: RangeRef, b: RangeRef): boolean {
  const x = normalizeRange(a), y = normalizeRange(b);
  return !(x.end.row < y.start.row || y.end.row < x.start.row || x.end.col < y.start.col || y.end.col < x.start.col);
}

/** Offset a single reference by rows/cols (respecting $ anchors). Returns null when it would fall off the sheet. */
export function offsetRef(ref: string, dRow: number, dCol: number): string | null {
  const p = parseA1(ref);
  const row = p.absRow ? p.row : p.row + dRow;
  const col = p.absCol ? p.col : p.col + dCol;
  if (row < 0 || col < 0) return null;
  return `${p.sheet ? `${quoteSheet(p.sheet)}!` : ""}${toA1(row, col, { absRow: p.absRow, absCol: p.absCol })}`;
}

export function offsetRange(r: RangeRef, dRow: number, dCol: number): RangeRef {
  return { sheet: r.sheet, start: { row: r.start.row + dRow, col: r.start.col + dCol }, end: { row: r.end.row + dRow, col: r.end.col + dCol } };
}

// ---------------------------------------------------------------- formulas

/** Token in a formula: either a cell/range reference (with sheet prefix) or opaque text. */
export interface FormulaToken { kind: "ref" | "text"; text: string; sheet?: string; start?: CellRef; end?: CellRef; fullCol?: boolean; fullRow?: boolean }

const REF_TOKEN_RE = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![A-Za-z0-9_(])/g;

/**
 * Tokenize a formula into reference tokens and text tokens. String literals are
 * kept opaque so "A1" inside quotes is not treated as a reference; function
 * names (e.g. LOG10) are excluded by the trailing look-ahead and a leading
 * identifier check.
 */
export function tokenizeFormula(formula: string): FormulaToken[] {
  const src = formula.startsWith("=") ? formula.slice(1) : formula;
  const tokens: FormulaToken[] = [];
  let i = 0;
  let buf = "";
  const flush = () => { if (buf) { tokens.push({ kind: "text", text: buf }); buf = ""; } };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue; } break; } j++; }
      buf += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    REF_TOKEN_RE.lastIndex = i;
    const m = REF_TOKEN_RE.exec(src);
    if (m && m.index === i) {
      // Reject when the match is preceded by an identifier char (e.g. part of a name like TAX_A1)
      const prev = i > 0 ? src[i - 1] : "";
      if (/[A-Za-z0-9_.]/.test(prev) && !m[1] && !m[2]) { buf += ch; i++; continue; }
      const sheet = m[1] ? m[1].replace(/''/g, "'") : m[2];
      const body = m[3];
      const tok: FormulaToken = { kind: "ref", text: m[0], sheet };
      try {
        if (/^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}$/.test(body)) {
          tok.fullCol = true;
          const [a, b] = body.split(":");
          tok.start = { row: 0, col: letterToCol(a.replace("$", "")), absCol: a.startsWith("$"), absRow: true };
          tok.end = { row: 1048575, col: letterToCol(b.replace("$", "")), absCol: b.startsWith("$"), absRow: true };
        } else if (/^\$?\d+:\$?\d+$/.test(body)) {
          tok.fullRow = true;
          const [a, b] = body.split(":");
          tok.start = { row: Number(a.replace("$", "")) - 1, col: 0, absRow: a.startsWith("$"), absCol: true };
          tok.end = { row: Number(b.replace("$", "")) - 1, col: 16383, absRow: b.startsWith("$"), absCol: true };
        } else {
          const [a, b] = body.split(":");
          tok.start = parseA1(a);
          tok.end = b ? parseA1(b) : undefined;
        }
      } catch {
        buf += m[0]; i += m[0].length; continue;
      }
      flush();
      tokens.push(tok);
      i += m[0].length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return tokens;
}

function renderRef(c: CellRef): string {
  return toA1(c.row, c.col, { absRow: c.absRow, absCol: c.absCol });
}

function renderToken(t: FormulaToken): string {
  if (t.kind === "text" || !t.start) return t.text;
  const prefix = t.sheet ? `${quoteSheet(t.sheet)}!` : "";
  if (t.fullCol) return `${prefix}${t.start.absCol ? "$" : ""}${colToLetter(t.start.col)}:${t.end!.absCol ? "$" : ""}${colToLetter(t.end!.col)}`;
  if (t.fullRow) return `${prefix}${t.start.absRow ? "$" : ""}${t.start.row + 1}:${t.end!.absRow ? "$" : ""}${t.end!.row + 1}`;
  return `${prefix}${renderRef(t.start)}${t.end ? `:${renderRef(t.end)}` : ""}`;
}

/** Shift every relative reference in a formula (copy/fill semantics). Off-sheet refs become #REF!. */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  const hadEq = formula.startsWith("=");
  const out = tokenizeFormula(formula).map((t) => {
    if (t.kind !== "ref" || !t.start) return t.text;
    const mv = (c: CellRef): CellRef | null => {
      const row = c.absRow ? c.row : c.row + dRow;
      const col = c.absCol ? c.col : c.col + dCol;
      if (row < 0 || col < 0) return null;
      return { ...c, row, col };
    };
    const s = t.fullCol ? { ...t.start, col: t.start.absCol ? t.start.col : t.start.col + dCol } : t.fullRow ? { ...t.start, row: t.start.absRow ? t.start.row : t.start.row + dRow } : mv(t.start);
    const eRaw = t.end ? (t.fullCol ? { ...t.end, col: t.end.absCol ? t.end.col : t.end.col + dCol } : t.fullRow ? { ...t.end, row: t.end.absRow ? t.end.row : t.end.row + dRow } : mv(t.end)) : undefined;
    if (!s || (t.end && !eRaw) || s.row < 0 || s.col < 0 || (eRaw && (eRaw.row < 0 || eRaw.col < 0))) return "#REF!";
    return renderToken({ ...t, start: s, end: eRaw ?? undefined });
  }).join("");
  return hadEq ? `=${out}` : out;
}

/**
 * Adjust references in a formula after inserting/deleting rows or columns on
 * `sheetName` (refs to other sheets are untouched; unqualified refs belong to
 * `formulaSheet`). `count` > 0 inserts before `index`; `count` < 0 deletes
 * |count| starting at `index`. Refs entirely inside a deleted block → #REF!.
 */
export function adjustFormulaForStructure(formula: string, opts: { axis: "row" | "col"; index: number; count: number; sheetName: string; formulaSheet: string }): string {
  const hadEq = formula.startsWith("=");
  const { axis, index, count } = opts;
  const out = tokenizeFormula(formula).map((t) => {
    if (t.kind !== "ref" || !t.start) return t.text;
    const target = t.sheet ?? opts.formulaSheet;
    if (target.toLowerCase() !== opts.sheetName.toLowerCase()) return t.text;
    const key = axis === "row" ? "row" : "col";
    const s = { ...t.start };
    const e = t.end ? { ...t.end } : undefined;
    const spansAll = axis === "row" ? Boolean(t.fullCol) : Boolean(t.fullRow);
    if (count > 0) {
      if (!spansAll) {
        if (s[key] >= index) s[key] += count;
        if (e && e[key] >= index) e[key] += count;
      }
      return renderToken({ ...t, start: s, end: e });
    }
    const del = -count;
    const delEnd = index + del - 1;
    if (spansAll) return renderToken(t);
    const lo = s[key], hi = e ? e[key] : s[key];
    if (lo >= index && hi <= delEnd) return "#REF!";
    const adj = (v: number) => (v < index ? v : v > delEnd ? v - del : index);
    if (!e) { s[key] = adj(s[key]); return renderToken({ ...t, start: s }); }
    // range partially overlapping: clip
    s[key] = lo < index ? lo : lo > delEnd ? lo - del : index;
    e[key] = hi > delEnd ? hi - del : hi < index ? hi : index - 1;
    if (e[key] < s[key]) return "#REF!";
    return renderToken({ ...t, start: s, end: e });
  }).join("");
  return hadEq ? `=${out}` : out;
}

/** Rename sheet references inside a formula. */
export function renameSheetInFormula(formula: string, from: string, to: string): string {
  const hadEq = formula.startsWith("=");
  const out = tokenizeFormula(formula).map((t) => (t.kind === "ref" && t.sheet && t.sheet.toLowerCase() === from.toLowerCase() ? renderToken({ ...t, sheet: to }) : t.text)).join("");
  return hadEq ? `=${out}` : out;
}

/** All references (as normalized ranges) used by a formula, for highlighting and dependency views. */
export function formulaReferences(formula: string): RangeRef[] {
  const out: RangeRef[] = [];
  for (const t of tokenizeFormula(formula)) {
    if (t.kind !== "ref" || !t.start) continue;
    out.push(normalizeRange({ sheet: t.sheet, start: t.start, end: t.end ?? t.start }));
  }
  return out;
}

/** Split a "Sheet!A1" or "Sheet!A1:B2" anchor into its parts. */
export function splitSheetRef(ref: string): { sheet?: string; ref: string } {
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(ref.trim());
  if (!m) return { ref: ref.trim() };
  return { sheet: (m[1] ?? m[2]).replace(/''/g, "'"), ref: m[3] };
}

/** Bounding range of a list of cell refs. */
export function boundingRange(refs: string[]): RangeRef | null {
  if (!refs.length) return null;
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  for (const ref of refs) {
    const p = parseA1(ref);
    r0 = Math.min(r0, p.row); r1 = Math.max(r1, p.row); c0 = Math.min(c0, p.col); c1 = Math.max(c1, p.col);
  }
  return { start: { row: r0, col: c0 }, end: { row: r1, col: c1 } };
}
