/**
 * Citation integrity: every case citation in an answer must correspond to a
 * source a lane actually read. Mismatches get a [VERIFY] marker and a note.
 * Pure and client-safe; the network resolution step lives in the server run.
 */
import { extractCitations, type ExtractedCitation } from "../citations";
import type { CitationCrossCheck, ResearchSource } from "./types";

/** Normalise "550 U.S. 544, 555" → "550u.s.544" (pin cite dropped, whitespace removed) so cites compare reliably. */
export function normCite(c: string): string {
  return c.replace(/,\s*\d{1,5}(?:[-–]\d{1,5})?\s*$/, "").replace(/\s+/g, "").trim().toLowerCase();
}

function citesOf(s: ResearchSource): string[] {
  const list = [s.cite, ...(s.hit.citations ?? [])].filter((x): x is string => Boolean(x));
  return list.map(normCite);
}

export interface CrossCheckResult {
  checks: CitationCrossCheck[];
  /** Case citations that no read source carries. */
  unmatched: ExtractedCitation[];
  /** Sources cited by number in the answer that were never read (snippet only). */
  unreadCitedNs: number[];
}

/** Cross-check case citations in `answer` against the sources; `[n]` markers are validated against the numbered list. */
export function crossCheckCitations(answer: string, sources: ResearchSource[]): CrossCheckResult {
  const extracted = extractCitations(answer).filter((c) => c.kind === "case");
  const byCite = new Map<string, ResearchSource>();
  for (const s of sources) for (const c of citesOf(s)) if (!byCite.has(c)) byCite.set(c, s);
  const checks: CitationCrossCheck[] = [];
  const unmatched: ExtractedCitation[] = [];
  for (const c of extracted) {
    const src = byCite.get(normCite(c.citation));
    if (src && src.read) checks.push({ citation: c.citation, matched: true, sourceN: src.n });
    else if (src) checks.push({ citation: c.citation, matched: false, sourceN: src.n });
    else { checks.push({ citation: c.citation, matched: false }); unmatched.push(c); }
  }
  const nums = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) nums.add(Number(m[1]));
  const byN = new Map(sources.map((s) => [s.n, s] as const));
  const unreadCitedNs = Array.from(nums).filter((n) => { const s = byN.get(n); return s && !s.read; }).sort((a, b) => a - b);
  return { checks, unmatched, unreadCitedNs };
}

/**
 * Insert "[VERIFY]" after each unmatched citation (once per occurrence, never
 * doubling an existing marker) and append a short citation-check note.
 */
export function markUnverifiedCitations(answer: string, result: CrossCheckResult, opts: { remotelyResolved?: Set<string> } = {}): string {
  let out = answer;
  const unmatched = result.checks.filter((c) => !c.matched);
  for (const c of unmatched) {
    const esc = c.citation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    out = out.replace(new RegExp(`(${esc})(?!\\s*\\[VERIFY\\])`, "g"), "$1 [VERIFY]");
  }
  if (!unmatched.length && !result.unreadCitedNs.length) return out;
  const notes: string[] = [];
  if (unmatched.length) {
    const items = unmatched.map((c) => {
      const remote = opts.remotelyResolved?.has(normCite(c.citation));
      return `${c.citation}${c.sourceN ? ` (source [${c.sourceN}] was found but not read)` : remote ? " (resolves on CourtListener; not read in this run)" : " (not among the sources read in this run)"}`;
    });
    notes.push(`${unmatched.length} case citation${unmatched.length === 1 ? "" : "s"} could not be matched to a source read in this run and ${unmatched.length === 1 ? "is" : "are"} marked [VERIFY]: ${items.join("; ")}.`);
  }
  if (result.unreadCitedNs.length) notes.push(`Sources ${result.unreadCitedNs.map((n) => `[${n}]`).join(", ")} were cited from search snippets only; open them before relying on a characterization.`);
  return `${out.trimEnd()}\n\n> **Citation check.** ${notes.join(" ")}`;
}
