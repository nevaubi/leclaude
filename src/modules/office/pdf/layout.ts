/**
 * Deterministic layout analysis over positioned text runs: lines, cells,
 * headings (for bookmarks) and tables (column clustering by x position).
 * No model calls; every output points back to its page and coordinates.
 */
import type { PdfRect } from "./model";
import type { TextRun } from "./text-search";

export interface LayoutCell { text: string; x: number; x2: number }
export interface LayoutLine { y: number; h: number; x: number; text: string; cells: LayoutCell[] }

/** Split one run into cells at runs of two or more spaces (positions interpolated by character). */
function runCells(r: TextRun): LayoutCell[] {
  const s = r.s;
  if (!s.trim()) return [];
  const cw = r.w / Math.max(1, s.length);
  const out: LayoutCell[] = [];
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ text: m[0], x: r.x + m.index * cw, x2: r.x + (m.index + m[0].length) * cw });
  return out;
}

/** Group runs into lines (top to bottom) and lines into cells split by wide gaps. */
export function layoutLines(runs: TextRun[]): LayoutLine[] {
  const rs = runs.filter((r) => r.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; h: number; runs: TextRun[] }[] = [];
  for (const r of rs) {
    const h = r.h || 10;
    const line = lines.find((l) => Math.abs(l.y - r.y) < Math.max(1.5, Math.min(l.h, h) * 0.45));
    if (line) { line.runs.push(r); line.h = Math.max(line.h, h); }
    else lines.push({ y: r.y, h, runs: [r] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const cells: LayoutCell[] = [];
      for (const c of l.runs.sort((a, b) => a.x - b.x).flatMap(runCells)) {
        const last = cells[cells.length - 1];
        const gap = last ? c.x - last.x2 : Infinity;
        if (last && gap < Math.max(4, l.h * 0.6)) { last.text += gap > l.h * 0.12 ? ` ${c.text}` : c.text; last.x2 = c.x2; }
        else cells.push({ ...c });
      }
      return { y: l.y, h: l.h, x: cells[0]?.x ?? 0, text: cells.map((c) => c.text).join(" "), cells };
    });
}

export interface Heading { title: string; level: number; y: number; size: number }

const NUMBERED = /^(?:(?:ARTICLE|SECTION|PART|EXHIBIT|SCHEDULE|APPENDIX)\s+[\dIVXLC]+[A-Z]?\b|§\s*\d|\d+(?:\.\d+)*\.?\s+\S|[IVXLC]+\.\s+\S|[A-Z]\.\s+\S)/;

/**
 * Headings on a page: lines set noticeably larger than the page's body text,
 * or short numbered/ALL-CAPS lines. Level from numbering depth or size rank.
 */
export function detectHeadings(runs: TextRun[]): Heading[] {
  const lines = layoutLines(runs);
  if (!lines.length) return [];
  // Body size: the size carrying the most characters on the page.
  const weight = new Map<number, number>();
  for (const l of lines) { const k = Math.round(l.h * 2) / 2; weight.set(k, (weight.get(k) ?? 0) + l.text.length); }
  const body = Array.from(weight.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const out: Heading[] = [];
  for (const l of lines) {
    const t = l.text.trim();
    if (t.length < 3 || t.length > 90 || /[.,;:]$/.test(t) && !NUMBERED.test(t)) continue;
    if (/^page \d+( of \d+)?$/i.test(t) || /^\d+$/.test(t)) continue;
    const big = l.h >= body * 1.12;
    const caps = t === t.toUpperCase() && /[A-Z]{3}/.test(t) && t.split(/\s+/).length <= 10;
    const numbered = NUMBERED.test(t) && t.split(/\s+/).length <= 12 && l.cells.length <= 2;
    if (!big && !(numbered && (caps || l.h >= body * 1.05)) && !(caps && l.cells.length === 1 && t.length <= 60)) continue;
    const depth = t.match(/^(\d+(?:\.\d+)*)/)?.[1].split(".").filter(Boolean).length;
    const level = depth ? Math.min(3, depth) : big ? 1 : 2;
    out.push({ title: t.replace(/\s+/g, " "), level, y: l.y, size: l.h });
  }
  return out;
}

export interface ExtractedTable { columns: string[]; rows: string[][]; bbox: PdfRect; lineCount: number }

/**
 * Tables from x-aligned cells: the longest run of consecutive lines with at
 * least two cells whose starts cluster into stable columns. A `hint` picks the
 * candidate whose text (or preceding line) mentions it.
 */
export function extractTables(runs: TextRun[]): ExtractedTable[] {
  const lines = layoutLines(runs);
  const blocks: (LayoutLine & { cont?: boolean })[][] = [];
  let cur: (LayoutLine & { cont?: boolean })[] = [];
  const near = (a: LayoutLine, b: LayoutLine) => a.y - b.y < Math.max(a.h, b.h) * 2.6;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = cur[cur.length - 1];
    const contiguous = prev ? near(prev, l) : true;
    const next = lines[i + 1];
    // A one-cell line inside a table (a wrapped cell such as "(dup)") continues the previous row.
    if (l.cells.length === 1 && prev && contiguous && next && next.cells.length >= 2 && near(l, next) && cur.length >= 2) { cur.push({ ...l, cont: true }); continue; }
    if (l.cells.length >= 2 && contiguous) cur.push(l);
    else { if (cur.filter((x) => !x.cont).length >= 2) blocks.push(cur); cur = l.cells.length >= 2 ? [l] : []; }
  }
  if (cur.filter((x) => !x.cont).length >= 2) blocks.push(cur);
  const tables: ExtractedTable[] = [];
  for (const all of blocks) {
    const block = all.filter((l) => !l.cont);
    // Column anchors: cluster cell start positions.
    const starts = block.flatMap((l) => l.cells.map((c) => c.x)).sort((a, b) => a - b);
    const anchors: number[] = [];
    for (const x of starts) { const last = anchors[anchors.length - 1]; if (last === undefined || x - last > 10) anchors.push(x); }
    // Keep anchors used by at least half the lines (drops stray wrapped fragments).
    const used = anchors.filter((a) => block.filter((l) => l.cells.some((c) => Math.abs(c.x - a) <= 10)).length >= Math.max(2, Math.ceil(block.length / 2)));
    if (used.length < 2) continue;
    const col = (x: number) => { let best = 0; for (let i = 0; i < used.length; i++) if (x >= used[i] - 10) best = i; return best; };
    const grid: string[][] = [];
    for (const l of all) {
      const row = l.cont && grid.length ? grid[grid.length - 1] : used.map(() => "");
      for (const c of l.cells) { const i = col(c.x); row[i] = row[i] ? `${row[i]} ${c.text}` : c.text; }
      if (!(l.cont && grid.length)) grid.push(row);
    }
    const x1 = Math.min(...block.map((l) => l.x)), x2 = Math.max(...block.flatMap((l) => l.cells.map((c) => c.x2)));
    const top = block[0], bottom = block[block.length - 1];
    tables.push({ columns: grid[0], rows: grid.slice(1), bbox: { x: x1, y: bottom.y - bottom.h * 0.3, w: x2 - x1, h: top.y + top.h - (bottom.y - bottom.h * 0.3) }, lineCount: block.length });
  }
  return tables;
}

export function pickTable(tables: ExtractedTable[], hint?: string): ExtractedTable | null {
  if (!tables.length) return null;
  if (hint?.trim()) {
    const words = hint.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const score = (t: ExtractedTable) => { const text = [t.columns, ...t.rows].flat().join(" ").toLowerCase(); return words.filter((w) => text.includes(w)).length; };
    const best = [...tables].sort((a, b) => score(b) - score(a) || b.lineCount - a.lineCount)[0];
    if (score(best) > 0) return best;
  }
  return [...tables].sort((a, b) => b.lineCount * b.columns.length - a.lineCount * a.columns.length)[0];
}

export function tableToMarkdown(t: { columns: string[]; rows: string[][] }): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  return [`| ${t.columns.map(esc).join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${t.columns.map((_, i) => esc(r[i] ?? "")).join(" | ")} |`)].join("\n");
}
