/**
 * Research memo markdown builder. The output feeds markdownToDoc() from the
 * office module, which supports headings, paragraphs, lists and pipe tables.
 * Client-safe.
 */
import { formatBluebook, bluebookDate } from "./normalize";
import { courtAbbreviation } from "./jurisdictions";
import { SOURCE_LABEL, type MemoSource, type SearchHit } from "./types";

export interface MemoInput {
  question: string;
  briefAnswer?: string;
  analysis?: string;
  sources: MemoSource[];
  openIssues?: string[];
  author?: string;
  matterName?: string;
  matterCaption?: string;
  jurisdictionLabel?: string;
  date?: string; // ISO
  synthesis?: string; // full AI synthesis; used to derive brief answer/analysis when not given
  /** Pinned passages (verbatim quotations with an optional note and source cite). */
  passages?: { text: string; note?: string; cite?: string }[];
}

function cell(s: string | undefined) {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";
}

/** Split a synthesis into a brief answer (first paragraph(s)) and the rest. */
export function splitSynthesis(text: string | undefined): { briefAnswer: string; analysis: string } {
  const t = (text ?? "").trim();
  if (!t) return { briefAnswer: "", analysis: "" };
  const lines = t.split("\n");
  // Prefer an explicit "Answer"/"Brief answer" section if the agent produced one.
  const idx = lines.findIndex((l, i) => i > 0 && /^#{1,3}\s*(analysis|discussion)/i.test(l));
  if (idx > 0) {
    const head = lines.slice(0, idx).filter((l) => !/^#{1,3}\s*(answer|brief answer|short answer)/i.test(l)).join("\n").trim();
    return { briefAnswer: head, analysis: lines.slice(idx + 1).join("\n").trim() };
  }
  const paras = t.split(/\n\s*\n/);
  return { briefAnswer: paras[0].replace(/^#{1,3}\s*(answer|brief answer|short answer)[:\s]*/i, "").trim(), analysis: paras.slice(1).join("\n\n").trim() };
}

export function sourceHolding(s: MemoSource): string {
  if (s.note?.trim()) return s.note.trim();
  const snip = (s.hit.snippet ?? "").replace(/\s+/g, " ").trim();
  return snip.length > 220 ? snip.slice(0, 217).trimEnd() + "…" : snip;
}

export function authoritiesTable(sources: MemoSource[]): string {
  const header = "| # | Source | Citation | Court / Agency | Date | Holding / relevance |\n|---|---|---|---|---|---|";
  const rows = sources.map((s, i) => {
    const h = s.hit;
    const court = h.source === "caselaw" || h.source === "dockets" ? courtAbbreviation(h.courtId, h.court) : h.source === "federal_register" ? (h.fr?.agencies ?? []).join(", ") : h.source === "ediscovery" ? h.edoc?.custodian ?? "" : h.subtitle ?? "";
    return `| ${i + 1} | ${cell(SOURCE_LABEL[h.source])} | ${cell(formatBluebook(h))} | ${cell(court)} | ${cell(h.date ? bluebookDate(h.date) : "")} | ${cell(sourceHolding(s))} |`;
  });
  return [header, ...rows].join("\n");
}

export function memoTitle(question: string) {
  const q = question.replace(/\s+/g, " ").trim();
  return `Research memo — ${q.length > 70 ? q.slice(0, 67).trimEnd() + "…" : q}`;
}

/** Produce the memo markdown. Sections follow the firm's memo template. */
export function buildMemoMarkdown(input: MemoInput): string {
  const derived = splitSynthesis(input.synthesis);
  const briefAnswer = (input.briefAnswer ?? "").trim() || derived.briefAnswer || "[Brief answer to be completed after review of the authorities below.]";
  const analysis = (input.analysis ?? "").trim() || derived.analysis || "[Analysis to be completed.]";
  const date = bluebookDate(input.date ?? new Date().toISOString());
  const lines: string[] = [];
  lines.push("# " + memoTitle(input.question));
  lines.push("");
  lines.push("**PRIVILEGED & CONFIDENTIAL — ATTORNEY WORK PRODUCT**");
  lines.push("");
  lines.push(`**To:** File${input.matterName ? ` — ${input.matterName}${input.matterCaption ? ` (${input.matterCaption})` : ""}` : ""}`);
  lines.push(`**From:** ${input.author ?? "Research agent"}`);
  lines.push(`**Date:** ${date}`);
  if (input.jurisdictionLabel) lines.push(`**Jurisdiction:** ${input.jurisdictionLabel}`);
  lines.push("");
  lines.push("## Question presented");
  lines.push("");
  lines.push(input.question.trim());
  lines.push("");
  lines.push("## Brief answer");
  lines.push("");
  lines.push(briefAnswer);
  lines.push("");
  lines.push("## Analysis");
  lines.push("");
  lines.push(analysis);
  lines.push("");
  lines.push("## Authorities");
  lines.push("");
  if (input.sources.length) lines.push(authoritiesTable(input.sources));
  else lines.push("_No authorities were pinned._");
  lines.push("");
  const passages = (input.passages ?? []).filter((p) => p.text.trim());
  if (passages.length) {
    lines.push("## Key passages");
    lines.push("");
    for (const p of passages) {
      lines.push(`> ${p.text.trim().replace(/\n+/g, " ")}${p.cite ? ` — ${p.cite}` : ""}`);
      if (p.note?.trim()) lines.push(`> ${p.note.trim()}`);
      lines.push("");
    }
  }
  lines.push("## Open issues and next steps");
  lines.push("");
  const issues = (input.openIssues ?? []).map((s) => s.trim()).filter(Boolean);
  if (issues.length) for (const i of issues) lines.push(`- ${i}`);
  else {
    lines.push("- Verify every citation above against the full opinion text before filing (use the citation checker).");
    lines.push("- Confirm subsequent history and negative treatment for each authority marked persuasive.");
    lines.push("- Identify contrary authority in the governing jurisdiction and address it in the analysis.");
  }
  lines.push("");
  return lines.join("\n");
}

/** Plain-text list of numbered citations matching the synthesis' [n] markers. */
export function numberedSourceList(hits: SearchHit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${formatBluebook(h)}${h.url ? ` — ${h.url}` : ""}`).join("\n");
}
