/**
 * Search over positioned text items (pdf.js `getTextContent` output) and map
 * matches back to rectangles in PDF user space. Used by the client (search,
 * text-selection markups), the extract route and the agent (find_text,
 * add_highlight/add_redaction by query).
 */
import type { PdfRect } from "./model";

/** A positioned text run in PDF user space; (x, y) is the baseline origin. */
export interface TextRun {
  s: string; x: number; y: number; w: number; h: number; eol?: boolean;
  /** Relative advance of each character of `s` (sums to 1), from the font's glyph widths; absent = evenly spaced. */
  cw?: number[];
}

/** Start offset (fraction of the run width) of character k, and its width fraction. */
function charSpan(run: TextRun, k: number, len: number): { a: number; w: number } {
  const cw = run.cw;
  if (cw && cw.length === len) { let a = 0; for (let i = 0; i < k; i++) a += cw[i]; return { a, w: cw[k] }; }
  return { a: k / len, w: 1 / len };
}

export interface TextMatch { start: number; end: number; text: string; rects: PdfRect[]; snippet: string; line: string }

export interface SearchOptions { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; limit?: number }

interface Piece { run: TextRun; from: number; to: number }

/** Concatenate runs into a page string, remembering each run's character span. */
export function joinRuns(runs: TextRun[]): { text: string; pieces: Piece[] } {
  let text = "";
  const pieces: Piece[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (!r.s) { if (r.eol && !text.endsWith("\n")) text += "\n"; continue; }
    const from = text.length;
    text += r.s;
    pieces.push({ run: r, from, to: text.length });
    const next = runs[i + 1];
    if (r.eol) text += "\n";
    else if (next && next.s) {
      const gap = next.x - (r.x + r.w);
      const sameLine = Math.abs(next.y - r.y) < Math.max(2, r.h * 0.5);
      if (!sameLine) text += "\n";
      else if (gap > Math.max(1, r.h * 0.12) && !r.s.endsWith(" ") && !next.s.startsWith(" ")) text += " ";
    }
  }
  return { text, pieces };
}

/** Plain text for a page (lines joined with newlines). */
export function runsToText(runs: TextRun[]): string {
  return joinRuns(runs).text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildPattern(query: string, opts: SearchOptions): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  const flags = opts.caseSensitive ? "g" : "gi";
  try {
    if (opts.regex) return new RegExp(q, flags);
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(opts.wholeWord ? `\\b${esc}\\b` : esc, flags);
  } catch {
    return null;
  }
}

/** Rects (PDF space) covering the character span [from, to) of a joined page string. */
export function rectsForSpan(pieces: Piece[], from: number, to: number): PdfRect[] {
  const rects: PdfRect[] = [];
  for (const p of pieces) {
    if (p.to <= from || p.from >= to) continue;
    const len = p.to - p.from || 1;
    const a = Math.max(from, p.from) - p.from;
    const b = Math.min(to, p.to) - p.from;
    const sa = charSpan(p.run, a, len), sb = charSpan(p.run, b - 1, len);
    const x = p.run.x + sa.a * p.run.w;
    const w = Math.max(1, (sb.a + sb.w - sa.a) * p.run.w);
    // Baseline origin → box: descend ~22% of the font size below baseline.
    const h = p.run.h || 10;
    rects.push({ x, y: p.run.y - h * 0.22, w, h: h * 1.1 });
  }
  return mergeLineRects(rects);
}

/** Merge adjacent rects on the same baseline into one box per line. */
export function mergeLineRects(rects: PdfRect[]): PdfRect[] {
  const sorted = [...rects].sort((a, b) => b.y - a.y || a.x - b.x);
  const out: PdfRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.max(2, last.h * 0.4) && r.x <= last.x + last.w + Math.max(4, last.h * 0.6)) {
      const x1 = Math.min(last.x, r.x), x2 = Math.max(last.x + last.w, r.x + r.w);
      const y1 = Math.min(last.y, r.y), y2 = Math.max(last.y + last.h, r.y + r.h);
      out[out.length - 1] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    } else out.push({ ...r });
  }
  return out;
}

/** Find all matches of `query` in a page's runs. */
export function searchRuns(runs: TextRun[], query: string, opts: SearchOptions = {}): TextMatch[] {
  const re = buildPattern(query, opts);
  if (!re) return [];
  const { text, pieces } = joinRuns(runs);
  const out: TextMatch[] = [];
  let m: RegExpExecArray | null;
  const limit = opts.limit ?? 500;
  while ((m = re.exec(text)) && out.length < limit) {
    if (!m[0]) { re.lastIndex++; continue; }
    const start = m.index, end = m.index + m[0].length;
    const lineStart = text.lastIndexOf("\n", start) + 1;
    const lineEndRaw = text.indexOf("\n", end);
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    out.push({ start, end, text: m[0], rects: rectsForSpan(pieces, start, end), snippet: snippetAround(text, start, end), line: text.slice(lineStart, lineEnd).trim() });
  }
  return out;
}

export function snippetAround(text: string, start: number, end: number, radius = 70) {
  const a = Math.max(0, start - radius), b = Math.min(text.length, end + radius);
  return `${a > 0 ? "…" : ""}${text.slice(a, start)}«${text.slice(start, end)}»${text.slice(end, b)}${b < text.length ? "…" : ""}`.replace(/\s+/g, " ");
}

/** Built-in PII patterns for "redact every SSN / account number / phone / email". */
export const PII_PATTERNS: { id: string; label: string; pattern: string }[] = [
  { id: "ssn", label: "Social Security numbers", pattern: "\\b(?!000|666|9\\d\\d)\\d{3}[- ](?!00)\\d{2}[- ](?!0000)\\d{4}\\b" },
  { id: "account", label: "Account / routing numbers", pattern: "\\b(?:acct|account|routing|aba|iban)\\.?\\s*(?:no\\.?|number|#)?\\s*:?\\s*[A-Z]{0,2}\\d[\\d -]{6,}\\d\\b" },
  { id: "card", label: "Payment card numbers", pattern: "\\b(?:\\d[ -]?){13,16}\\b" },
  { id: "phone", label: "Phone numbers", pattern: "\\(?\\b\\d{3}\\)?[-. ]\\d{3}[-. ]\\d{4}\\b" },
  { id: "email", label: "Email addresses", pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}" },
  { id: "dob", label: "Dates of birth", pattern: "\\b(?:DOB|date of birth|born)\\s*:?\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b" },
  { id: "ein", label: "Employer identification numbers", pattern: "\\b\\d{2}-\\d{7}\\b" },
];

export const PRIVILEGE_MARKERS = ["privileged", "attorney-client", "attorney client", "work product", "attorney work product", "privileged & confidential", "privileged and confidential", "do not produce", "legal advice", "counsel's advice"];

/** Character boxes of a joined page string (approximate advance split evenly within a run). */
function charBoxes(pieces: Piece[]): { i: number; box: PdfRect }[] {
  const out: { i: number; box: PdfRect }[] = [];
  for (const p of pieces) {
    const len = p.to - p.from || 1;
    const h = p.run.h || 10;
    for (let k = 0; k < len; k++) { const c = charSpan(p.run, k, len); out.push({ i: p.from + k, box: { x: p.run.x + c.a * p.run.w, y: p.run.y - h * 0.22, w: c.w * p.run.w, h: h * 1.1 } }); }
  }
  return out;
}

function centerIn(b: PdfRect, rects: PdfRect[]) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return rects.some((r) => cx >= r.x - 0.5 && cx <= r.x + r.w + 0.5 && cy >= r.y - 0.5 && cy <= r.y + r.h + 0.5);
}

/** The text strings (contiguous runs of characters) whose glyph centers fall inside the given rectangles. */
export function textUnderRects(runs: TextRun[], rects: PdfRect[]): string[] {
  if (!rects.length) return [];
  const { text, pieces } = joinRuns(runs);
  const hit = new Set<number>();
  for (const c of charBoxes(pieces)) if (centerIn(c.box, rects)) hit.add(c.i);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i <= text.length; i++) {
    if (hit.has(i)) cur += text[i];
    else if (cur) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
  }
  return out;
}

/**
 * Characters extracted inside the rectangles, excluding runs whose text is an allowed label (redaction reason,
 * Bates number…). Character positions are approximated from the run width, so each rectangle is inset by `inset`
 * points horizontally before testing (a neighbouring comma must not count as a leak).
 */
export function charsInsideRects(runs: TextRun[], rects: PdfRect[], allowed: (s: string) => boolean = () => false, inset = 0): string {
  let out = "";
  const shrunk = rects.map((r) => ({ x: r.x + inset, y: r.y, w: Math.max(0, r.w - 2 * inset), h: r.h })).filter((r) => r.w > 0);
  const { pieces, text } = joinRuns(runs.filter((r) => !allowed(r.s.trim())));
  for (const c of charBoxes(pieces)) if (centerIn(c.box, shrunk) && text[c.i]?.trim()) out += text[c.i];
  return out;
}

/** Occurrences of a literal (whitespace-insensitive, case-insensitive) in text. */
export function countOccurrences(text: string, s: string): number {
  const re = buildPattern(s, {});
  if (!re) return 0;
  return (text.match(re) ?? []).length;
}
