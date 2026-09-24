/**
 * Search over positioned text items (pdf.js `getTextContent` output) and map
 * matches back to rectangles in PDF user space. Used by the client (search,
 * text-selection markups), the extract route and the agent (find_text,
 * add_highlight/add_redaction by query).
 */
import type { PdfRect } from "./model";

/** A positioned text run in PDF user space; (x, y) is the baseline origin. */
export interface TextRun { s: string; x: number; y: number; w: number; h: number; eol?: boolean }

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
    const cw = p.run.w / len;
    const x = p.run.x + a * cw;
    const w = Math.max(1, (b - a) * cw);
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
  { id: "ssn", label: "Social Security numbers", pattern: "\\b(?!000|666|9\\d\\d)\\d{3}[- ]?(?!00)\\d{2}[- ]?(?!0000)\\d{4}\\b" },
  { id: "account", label: "Account / routing numbers", pattern: "\\b(?:acct|account|routing|aba|iban)\\.?\\s*(?:no\\.?|number|#)?\\s*:?\\s*[A-Z]{0,2}\\d[\\d -]{6,}\\d\\b" },
  { id: "card", label: "Payment card numbers", pattern: "\\b(?:\\d[ -]?){13,16}\\b" },
  { id: "phone", label: "Phone numbers", pattern: "\\(?\\b\\d{3}\\)?[-. ]\\d{3}[-. ]\\d{4}\\b" },
  { id: "email", label: "Email addresses", pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}" },
  { id: "dob", label: "Dates of birth", pattern: "\\b(?:DOB|date of birth|born)\\s*:?\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b" },
  { id: "ein", label: "Employer identification numbers", pattern: "\\b\\d{2}-\\d{7}\\b" },
];

export const PRIVILEGE_MARKERS = ["privileged", "attorney-client", "attorney client", "work product", "attorney work product", "privileged & confidential", "privileged and confidential", "do not produce", "legal advice", "counsel's advice"];
