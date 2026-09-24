/**
 * Verbatim-quote verification (pure, client-safe, unit-tested). A model may
 * offer excerpts in support of a coding suggestion; an excerpt counts as
 * verified only when it appears in the document text. Matching ignores
 * whitespace runs, curly vs straight quotes/dashes and case, and returns the
 * offset in the original text so the viewer can jump to it.
 */
import type { AnalysisQuote } from "./types";

const fold = (c: string) => {
  switch (c) {
    case "‘": case "’": case "‚": return "'";
    case "“": case "”": case "„": return '"';
    case "–": case "—": case "−": return "-";
    case " ": return " ";
    default: return c.toLowerCase();
  }
};

/** Folded text plus a map from folded index → original index (whitespace runs collapse to one space). */
export function foldText(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = fold(text[i]);
    if (/\s/.test(c)) { if (lastSpace) continue; lastSpace = true; folded += " "; map.push(i); continue; }
    lastSpace = false;
    folded += c;
    map.push(i);
  }
  return { folded, map };
}

/** Find one excerpt in the text; null when it is not there. */
export function findQuote(text: string, quote: string, prepared?: ReturnType<typeof foldText>): { start: number; end: number } | null {
  const q = foldText(quote).folded.trim().replace(/^["'“”‘’]+|["'“”‘’.,;:]+$/g, "").trim();
  if (q.length < 8) return null;
  const { folded, map } = prepared ?? foldText(text);
  const at = folded.indexOf(q);
  if (at < 0) return null;
  const start = map[at];
  const endIdx = at + q.length - 1;
  const end = (map[endIdx] ?? text.length - 1) + 1;
  return { start, end };
}

/** Verify a list of excerpts against the text (duplicates collapsed, empty strings dropped). */
export function verifyQuotes(text: string, quotes: string[], max = 6): AnalysisQuote[] {
  const prepared = foldText(text);
  const seen = new Set<string>();
  const out: AnalysisQuote[] = [];
  for (const raw of quotes) {
    const q = (raw ?? "").trim();
    if (!q || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    const hit = findQuote(text, q, prepared);
    out.push(hit ? { text: text.slice(hit.start, hit.end), verified: true, start: hit.start, end: hit.end } : { text: q, verified: false });
    if (out.length >= max) break;
  }
  return out;
}

/** Confidence cap from unverified excerpts: an excerpt the document does not contain is a fabrication signal. */
export function quoteConfidenceCap(quotes: AnalysisQuote[]): number {
  const bad = quotes.filter((q) => !q.verified).length;
  if (!bad) return 1;
  return Math.max(0.2, 0.9 - 0.2 * bad);
}
