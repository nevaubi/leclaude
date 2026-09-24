/**
 * Pure transcript helpers (client + server safe): full-text search across
 * transcripts, page:line arithmetic, designation export, objection summary.
 */
import type { Deposition, DepositionQA } from "@/lib/types/domain";
import type { Designation, ObjectionSummary, QAFlag, TranscriptHit } from "./types";
import { formatPageLine, formatRange } from "./types";

export const LINES_PER_PAGE = 25;

export function comparePageLine(aPage: number, aLine: number, bPage: number, bLine: number) {
  return aPage !== bPage ? aPage - bPage : aLine - bLine;
}

/** Inclusive test: is (page,line) within the range? */
export function inRange(page: number, line: number, r: Pick<Designation, "startPage" | "startLine" | "endPage" | "endLine">) {
  return comparePageLine(page, line, r.startPage, r.startLine) >= 0 && comparePageLine(page, line, r.endPage, r.endLine) <= 0;
}

/** Approximate the last line a Q/A pair occupies (question + answer wrapped at ~58 chars). */
export function qaEndLine(qa: DepositionQA): { page: number; line: number } {
  const lines = Math.max(2, Math.ceil(qa.question.length / 58) + Math.ceil(qa.answer.length / 58) + (qa.objection ? Math.ceil((qa.objection.text ?? "Objection.").length / 58) : 0));
  let page = qa.page;
  let line = qa.line + lines - 1;
  while (line > LINES_PER_PAGE) { line -= LINES_PER_PAGE; page += 1; }
  return { page, line };
}

export function normalizeRange(r: Pick<Designation, "startPage" | "startLine" | "endPage" | "endLine">) {
  if (comparePageLine(r.startPage, r.startLine, r.endPage, r.endLine) <= 0) return r;
  return { startPage: r.endPage, startLine: r.endLine, endPage: r.startPage, endLine: r.startLine };
}

/** Q/A pairs whose start falls inside a range. */
export function qaInRange(transcript: DepositionQA[], r: Pick<Designation, "startPage" | "startLine" | "endPage" | "endLine">) {
  return transcript.map((qa, index) => ({ qa, index })).filter(({ qa }) => inRange(qa.page, qa.line, r));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function tokens(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9µ'-]+/i).map((t) => t.replace(/^['-]+|['-]+$/g, "")).filter((t) => t.length > 1);
}

function snippetAround(text: string, terms: string[], radius = 110) {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
  if (pos < 0) return text.length > radius * 2 ? text.slice(0, radius * 2) + "…" : text;
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

/**
 * Full-text search across transcripts. Phrase queries ("...") require the
 * exact phrase; otherwise every token must appear in the field (AND) unless
 * mode is "any", and results are scored by matched terms and term frequency,
 * with answers ranked above questions.
 */
export function searchTranscripts(depositions: Pick<Deposition, "id" | "witnessName" | "transcript">[], query: string, opts: { limit?: number; flags?: QAFlag[]; mode?: "all" | "any" } = {}): TranscriptHit[] {
  const q = query.trim();
  if (!q) return [];
  const phrase = q.match(/^"(.+)"$/)?.[1]?.toLowerCase();
  const terms = phrase ? [phrase] : tokens(q);
  if (!terms.length) return [];
  const any = opts.mode === "any";
  const hits: TranscriptHit[] = [];
  for (const dep of depositions) {
    dep.transcript.forEach((qa, index) => {
      if (opts.flags?.length && !opts.flags.some((f) => qa.flags?.includes(f))) return;
      const fields: [TranscriptHit["field"], string | undefined][] = [["answer", qa.answer], ["question", qa.question], ["objection", qa.objection?.text], ["note", qa.note]];
      for (const [field, text] of fields) {
        if (!text) continue;
        const lower = text.toLowerCase();
        const matched = terms.filter((t) => lower.includes(t)).length;
        if (any ? matched === 0 : matched < terms.length) continue;
        let score = 0;
        for (const t of terms) { let i = -1; while ((i = lower.indexOf(t, i + 1)) >= 0) score += 1; }
        score = score / Math.sqrt(1 + text.length / 400) + matched * 2 + (field === "answer" ? 0.5 : 0) + (qa.flags?.length ? 0.25 : 0);
        hits.push({ depositionId: dep.id, witnessName: dep.witnessName, index, page: qa.page, line: qa.line, field, snippet: snippetAround(text, terms), score: Math.round(score * 100) / 100 });
      }
    });
  }
  hits.sort((a, b) => b.score - a.score || a.page - b.page || a.line - b.line);
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}

export function highlightTerms(query: string): RegExp | null {
  const phrase = query.trim().match(/^"(.+)"$/)?.[1];
  const terms = phrase ? [phrase] : tokens(query);
  if (!terms.length) return null;
  return new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
}

// ---------------------------------------------------------------------------
// Objections
// ---------------------------------------------------------------------------

export function summarizeObjections(transcript: DepositionQA[]): ObjectionSummary {
  const byBasis = new Map<string, number>();
  const byAttorney = new Map<string, number>();
  let total = 0;
  for (const qa of transcript) {
    if (!qa.objection) continue;
    total++;
    const basis = qa.objection.basis.toLowerCase();
    byBasis.set(basis, (byBasis.get(basis) ?? 0) + 1);
    byAttorney.set(qa.objection.by, (byAttorney.get(qa.objection.by) ?? 0) + 1);
  }
  const sort = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    total,
    byBasis: sort(byBasis).map(([basis, count]) => ({ basis, count })),
    byAttorney: sort(byAttorney).map(([attorney, count]) => ({ attorney, count })),
    rulings: { sustained: 0, overruled: 0, pending: total },
  };
}

// ---------------------------------------------------------------------------
// Designations export
// ---------------------------------------------------------------------------

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface DesignationExportRow {
  witness: string;
  date: string;
  range: string;
  purpose: string;
  startPage: number;
  startLine: number;
  endPage: number;
  endLine: number;
  note: string;
  excerpt: string;
}

export function designationRows(dep: Pick<Deposition, "witnessName" | "date" | "transcript">, designations: Designation[]): DesignationExportRow[] {
  const sorted = [...designations].sort((a, b) => comparePageLine(a.startPage, a.startLine, b.startPage, b.startLine));
  return sorted.map((d) => {
    const qas = qaInRange(dep.transcript, d);
    const excerpt = qas.map(({ qa }) => `Q. ${qa.question} A. ${qa.answer}`).join(" ");
    return { witness: dep.witnessName, date: dep.date, range: formatRange(d), purpose: d.purpose, startPage: d.startPage, startLine: d.startLine, endPage: d.endPage, endLine: d.endLine, note: d.note ?? "", excerpt: excerpt.length > 600 ? excerpt.slice(0, 600) + "…" : excerpt };
  });
}

/** CSV in the column order trial-presentation vendors expect (witness, begin page/line, end page/line, purpose, note). */
export function designationsCsv(dep: Pick<Deposition, "witnessName" | "date" | "transcript">, designations: Designation[]): string {
  const rows = designationRows(dep, designations);
  const header = ["Witness", "Deposition date", "Begin page", "Begin line", "End page", "End line", "Range", "Purpose", "Note", "Excerpt"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push([r.witness, r.date, r.startPage, r.startLine, r.endPage, r.endLine, r.range, r.purpose, r.note, r.excerpt].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function designationsMarkdown(dep: Pick<Deposition, "witnessName" | "date" | "transcript" | "witnessTitle">, designations: Designation[], opts: { matterName?: string } = {}): string {
  const sorted = [...designations].sort((a, b) => comparePageLine(a.startPage, a.startLine, b.startPage, b.startLine));
  const rows = designationRows(dep, sorted);
  const out: string[] = [];
  out.push(`# Deposition designations — ${dep.witnessName}`);
  out.push("");
  out.push(`${opts.matterName ? `**Matter:** ${opts.matterName}  ` : ""}**Deposition of:** ${dep.witnessName}${dep.witnessTitle ? ` (${dep.witnessTitle})` : ""}  **Taken:** ${dep.date}  **Designations:** ${rows.length}`);
  out.push("");
  out.push("| # | Page:line | Purpose | Note |");
  out.push("|---|---|---|---|");
  rows.forEach((r, i) => out.push(`| ${i + 1} | ${r.range} | ${r.purpose} | ${r.note.replace(/\|/g, "/")} |`));
  out.push("");
  rows.forEach((r, i) => {
    out.push(`## ${i + 1}. ${r.range} (${r.purpose})`);
    if (r.note) out.push(`> ${r.note}`);
    const qas = qaInRange(dep.transcript, sorted[i]);
    for (const { qa } of qas) {
      out.push(`**${formatPageLine(qa.page, qa.line)}** Q. ${qa.question}`);
      out.push("");
      out.push(`A. ${qa.answer}`);
      out.push("");
    }
  });
  return out.join("\n");
}

/** Plain-text transcript excerpt for prompts. */
export function transcriptText(dep: Pick<Deposition, "witnessName" | "transcript">, opts: { maxChars?: number; indexes?: number[] } = {}) {
  const idx = opts.indexes ? new Set(opts.indexes) : null;
  const parts: string[] = [];
  dep.transcript.forEach((qa, i) => {
    if (idx && !idx.has(i)) return;
    const flags = qa.flags?.length ? ` [${qa.flags.join(", ")}]` : "";
    parts.push(`${formatPageLine(qa.page, qa.line)}${flags}\nQ. ${qa.question}${qa.objection ? `\n   ${qa.objection.by}: Objection, ${qa.objection.basis}.${qa.objection.text ? ` ${qa.objection.text}` : ""}` : ""}\nA. ${qa.answer}${qa.exhibit ? `\n   (Exhibit ${qa.exhibit})` : ""}`);
  });
  let text = parts.join("\n\n");
  const max = opts.maxChars ?? 40_000;
  if (text.length > max) text = text.slice(0, max) + "\n…[truncated]";
  return text;
}
