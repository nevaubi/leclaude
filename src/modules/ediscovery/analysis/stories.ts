/**
 * Story builder helpers (client + server safe): facts are ordered, dated,
 * sourced statements. Everything here is deterministic — building from the
 * chronology, from flagged testimony or from intelligence entries, merging
 * with near-duplicate detection, cite verification against a known evidence
 * set, and CSV / Markdown export with citations.
 */
import type { Deposition, DepositionQA, TimelineEvent } from "@/lib/types/domain";
import { eventDuplicateKey, findNearDuplicateEvent } from "@/lib/integrity/dedupe";
import { formatCite, type Story, type StoryCiteReport, type StoryEvidence, type StoryFact, type StorySummary } from "./types";
import { qaEndLine } from "./transcript";
import { formatEventDate } from "./chronology";

export function compareFacts(a: StoryFact, b: StoryFact) {
  return a.date.localeCompare(b.date) || a.order - b.order || a.text.localeCompare(b.text);
}

/** Sort by date, then renumber `order` 1..n. */
export function renumberFacts(facts: StoryFact[]): StoryFact[] {
  return [...facts].sort(compareFacts).map((f, i) => ({ ...f, order: i + 1 }));
}

export function factKey(f: Pick<StoryFact, "date" | "text">) {
  return eventDuplicateKey({ date: f.date, title: f.text });
}

function evidenceSources(ev: StoryEvidence[]): { bates?: string; cite?: string; id?: string }[] {
  return ev.map((e) => (e.kind === "document" ? { bates: e.bates, id: e.docId } : e.kind === "testimony" ? { cite: formatCite(e), id: e.depositionId } : e.kind === "intel" ? { id: e.docId, cite: e.docId } : { id: e.eventId }));
}

/**
 * Merge incoming facts into an existing list: a near-duplicate (same date and
 * a similar text, or a shared source) unions its evidence into the existing
 * fact instead of adding a twin. Returns the renumbered list plus what happened.
 */
export function mergeFacts(existing: StoryFact[], incoming: StoryFact[]): { facts: StoryFact[]; added: StoryFact[]; merged: { incoming: StoryFact; into: StoryFact }[] } {
  const facts = existing.map((f) => ({ ...f, evidence: [...f.evidence] }));
  const added: StoryFact[] = [];
  const merged: { incoming: StoryFact; into: StoryFact }[] = [];
  for (const f of incoming) {
    const hit = findNearDuplicateEvent(facts.map((x) => ({ id: x.id, date: x.date, title: x.text, sources: evidenceSources(x.evidence) })), { date: f.date, title: f.text, sources: evidenceSources(f.evidence) });
    if (!hit) { facts.push({ ...f, evidence: [...f.evidence] }); added.push(f); continue; }
    const into = facts.find((x) => x.id === hit.id)!;
    const seen = new Set(into.evidence.map(evidenceKey));
    for (const e of f.evidence) { const k = evidenceKey(e); if (!seen.has(k)) { into.evidence.push(e); seen.add(k); } }
    into.confidence = Math.max(into.confidence, f.confidence);
    if (f.disputed) into.disputed = true;
    if ((f.text.length > into.text.length) && into.origin !== "user") into.text = f.text;
    if (f.personIds?.length) into.personIds = Array.from(new Set([...(into.personIds ?? []), ...f.personIds]));
    merged.push({ incoming: f, into });
  }
  return { facts: renumberFacts(facts), added, merged };
}

export function evidenceKey(e: StoryEvidence): string {
  if (e.kind === "document") return `doc|${e.bates.toUpperCase()}`;
  if (e.kind === "testimony") return `dep|${e.depositionId}|${e.page}:${e.line}`;
  if (e.kind === "intel") return `intel|${e.docId}`;
  return `event|${e.eventId}`;
}

let seq = 0;
export function factId(prefix = "sf") { seq += 1; return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** One fact per chronology event; document sources keep Bates, testimony sources keep page:line. */
export function factsFromTimeline(events: TimelineEvent[], opts: { minSignificance?: number; witnessNames?: Map<string, string> } = {}): StoryFact[] {
  const out: StoryFact[] = [];
  for (const e of events) {
    if (opts.minSignificance && e.significance < opts.minSignificance) continue;
    const evidence: StoryEvidence[] = [];
    for (const s of e.sources) {
      if (s.kind === "document" && s.bates) evidence.push({ kind: "document", docId: s.id, bates: s.bates, excerpt: s.excerpt });
      else if (s.kind === "deposition" && s.id) {
        const m = s.cite?.match(/(\d{1,4}):(\d{1,2})(?:\s*[–-]\s*(\d{1,4}):(\d{1,2}))?/);
        if (m) evidence.push({ kind: "testimony", depositionId: s.id, witness: opts.witnessNames?.get(s.id) ?? s.cite?.split(/\s+\d/)[0], page: Number(m[1]), line: Number(m[2]), endPage: m[3] ? Number(m[3]) : undefined, endLine: m[4] ? Number(m[4]) : undefined, excerpt: s.excerpt });
      } else if (s.kind === "external" && s.id) evidence.push({ kind: "intel", docId: s.id, title: s.cite, excerpt: s.excerpt });
    }
    evidence.push({ kind: "event", eventId: e.id, title: e.title });
    const conf = e.provenance?.confidence ?? (e.verified ? 0.95 : e.createdBy === "user" ? 0.85 : 0.6);
    out.push({ id: factId(), order: 0, date: e.date, dateEnd: e.dateEnd, precision: e.precision, text: e.description ? `${e.title}. ${e.description}` : e.title, evidence, confidence: Math.round(conf * 100) / 100, disputed: !!e.disputed, origin: "timeline", originId: e.id, personIds: e.personIds, verified: !!e.verified });
  }
  return renumberFacts(out);
}

/** One fact per flagged (or selected) Q/A, dated to the deposition unless the answer states a date. */
export function factsFromTestimony(dep: Pick<Deposition, "id" | "witnessName" | "date" | "transcript">, opts: { indexes?: number[]; flags?: NonNullable<DepositionQA["flags"]> } = {}): StoryFact[] {
  const flags = opts.flags ?? ["admission", "key", "contradiction"];
  const idx = opts.indexes ?? dep.transcript.map((_, i) => i).filter((i) => dep.transcript[i].flags?.some((f) => flags.includes(f)));
  const out: StoryFact[] = [];
  for (const i of idx) {
    const qa = dep.transcript[i];
    if (!qa) continue;
    const end = qaEndLine(qa);
    const date = dateInText(qa.answer) ?? dateInText(qa.question) ?? dep.date;
    const disputed = !!qa.flags?.includes("contradiction");
    out.push({ id: factId(), order: 0, date, precision: date === dep.date ? "day" : precisionOf(qa.answer) ?? "day", text: `${dep.witnessName} testified: "${clip(qa.answer, 220)}"`, evidence: [{ kind: "testimony", depositionId: dep.id, witness: dep.witnessName, page: qa.page, line: qa.line, endPage: end.page, endLine: end.line, excerpt: `Q. ${clip(qa.question, 160)} A. ${clip(qa.answer, 200)}` }], confidence: qa.flags?.includes("admission") ? 0.9 : 0.75, disputed, origin: "testimony", originId: `${dep.id}:${i}`, tags: qa.flags ? [...qa.flags] : undefined });
  }
  return renumberFacts(out);
}

export interface IntelEntryLike { at: string; title: string; detail?: string; kind?: string; confidence: number; evidence: { docId: string; quote?: string; url?: string }[] }

/** One fact per intelligence chronology entry (docket, regulatory, recalls, opinions), keeping the record ids as evidence. */
export function factsFromIntel(entries: IntelEntryLike[], opts: { minConfidence?: number } = {}): StoryFact[] {
  const out: StoryFact[] = [];
  for (const e of entries) {
    if (!e.at || (opts.minConfidence != null && e.confidence < opts.minConfidence)) continue;
    if (e.evidence.every((ev) => ev.docId.startsWith("tl_"))) continue; // already an e-discovery event
    out.push({ id: factId(), order: 0, date: e.at.slice(0, 10), text: e.detail ? `${e.title}. ${clip(e.detail, 200)}` : e.title, evidence: e.evidence.map((ev) => ({ kind: "intel" as const, docId: ev.docId, title: e.title, url: ev.url, excerpt: ev.quote })), confidence: Math.round(e.confidence * 100) / 100, origin: "intel", originId: e.evidence[0]?.docId, tags: e.kind ? [e.kind] : undefined });
  }
  return renumberFacts(out);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** First date mentioned in a sentence ("March 14, 2001", "in April 2001", "2001") → ISO. */
export function dateInText(s: string): string | undefined {
  const full = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/i);
  if (full) return `${full[3]}-${String(MONTHS.indexOf(full[1].toLowerCase()) + 1).padStart(2, "0")}-${full[2].padStart(2, "0")}`;
  const month = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:of\s+)?((?:19|20)\d{2})\b/i);
  if (month) return `${month[2]}-${String(MONTHS.indexOf(month[1].toLowerCase()) + 1).padStart(2, "0")}-01`;
  const year = s.match(/\b(?:in|by|since|until|during)\s+((?:19|20)\d{2})\b/i);
  if (year) return `${year[1]}-01-01`;
  return undefined;
}
function precisionOf(s: string): StoryFact["precision"] | undefined {
  if (/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i.test(s)) return "day";
  if (/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:of\s+)?(?:19|20)\d{2}\b/i.test(s)) return "month";
  if (/\b(?:19|20)\d{2}\b/.test(s)) return "year";
  return undefined;
}
function clip(s: string, n: number) { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; }

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface CiteEvidenceSet {
  bates: Set<string>;
  /** Pages per deposition id. */
  pagesByDeposition: Map<string, Set<number>>;
  intelDocIds?: Set<string>;
  eventIds?: Set<string>;
}

function hasBates(set: Set<string>, bates: string) {
  const key = bates.toUpperCase();
  if (set.has(key)) return true;
  for (const b of set) if (b.toUpperCase() === key) return true;
  return false;
}

/** Check every fact's evidence against the record: Bates must exist, page:line must be inside the transcript, ids must resolve. */
export function verifyStoryCites(story: Pick<Story, "id" | "facts">, evidence: CiteEvidenceSet): StoryCiteReport {
  const report: StoryCiteReport = { storyId: story.id, checked: 0, resolved: 0, unresolved: [] };
  for (const f of story.facts) {
    for (const e of f.evidence) {
      report.checked++;
      if (e.kind === "document") {
        if (!hasBates(evidence.bates, e.bates)) report.unresolved.push({ factId: f.id, cite: e.bates, reason: "Bates number not in the review set" }); else report.resolved++;
      } else if (e.kind === "testimony") {
        const pages = evidence.pagesByDeposition.get(e.depositionId);
        if (!pages) { report.unresolved.push({ factId: f.id, cite: formatCite(e), reason: "deposition not found" }); continue; }
        const ok = pages.has(e.page) && (e.endPage == null || pages.has(e.endPage) || pages.has(e.page));
        if (!ok) report.unresolved.push({ factId: f.id, cite: formatCite(e), reason: "page not in the excerpted transcript" }); else report.resolved++;
      } else if (e.kind === "intel") {
        if (evidence.intelDocIds && !evidence.intelDocIds.has(e.docId)) report.unresolved.push({ factId: f.id, cite: e.docId, reason: "intelligence record not found" }); else report.resolved++;
      } else if (evidence.eventIds && !evidence.eventIds.has(e.eventId)) report.unresolved.push({ factId: f.id, cite: e.eventId, reason: "timeline event not found" }); else report.resolved++;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Summaries and export
// ---------------------------------------------------------------------------

export function summarizeStory(s: Story): StorySummary {
  const { facts, narrative, ...rest } = s;
  const dates = facts.map((f) => f.date).sort();
  return { ...rest, factCount: facts.length, disputed: facts.filter((f) => f.disputed).length, unverified: facts.filter((f) => !f.verified).length, from: dates[0], to: dates[dates.length - 1], hasNarrative: !!narrative?.text };
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function storyCsv(story: Story): string {
  const header = ["#", "Date", "End date", "Precision", "Fact", "Evidence", "Confidence", "Disputed", "Verified", "Origin"];
  const lines = [header.join(",")];
  for (const f of renumberFacts(story.facts)) lines.push([f.order, f.date, f.dateEnd ?? "", f.precision ?? "day", f.text, f.evidence.map(formatCite).join("; "), f.confidence.toFixed(2), f.disputed ? "yes" : "no", f.verified ? "yes" : "no", f.origin ?? "user"].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Markdown with a numbered fact list, footnote-style citations and an evidence table; feeds markdownToDoc for Word. */
export function storyMarkdown(story: Story, opts: { matterName?: string; people?: Map<string, string>; includeNarrative?: boolean } = {}): string {
  const facts = renumberFacts(story.facts);
  const out: string[] = [];
  out.push(`# ${story.title}`);
  out.push("");
  out.push(`${opts.matterName ? `**Matter:** ${opts.matterName}  ` : ""}${story.theme ? `**Theme:** ${story.theme}  ` : ""}**Facts:** ${facts.length}  **Disputed:** ${facts.filter((f) => f.disputed).length}  **Verified:** ${facts.filter((f) => f.verified).length}`);
  out.push("");
  if (opts.includeNarrative !== false && story.narrative?.text) { out.push("## Narrative"); out.push(""); out.push(story.narrative.text); out.push(""); }
  out.push("## Facts");
  out.push("");
  for (const f of facts) {
    const cites = f.evidence.map(formatCite);
    out.push(`${f.order}. **${formatEventDate({ date: f.date, dateEnd: f.dateEnd, precision: f.precision })}** — ${f.text}${cites.length ? ` [${cites.join("; ")}]` : ""}${f.disputed ? " *(disputed)*" : ""}`);
  }
  out.push("");
  out.push("## Evidence");
  out.push("");
  out.push("| # | Cite | Kind | Excerpt |");
  out.push("|---|---|---|---|");
  for (const f of facts) for (const e of f.evidence) out.push(`| ${f.order} | ${formatCite(e).replace(/\|/g, "/")} | ${e.kind} | ${("excerpt" in e ? e.excerpt ?? "" : "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 200)} |`);
  out.push("");
  return out.join("\n");
}

/** Text block for prompts: numbered facts with their cites. */
export function storyFactsText(story: Pick<Story, "facts">, max = 30_000): string {
  const text = renumberFacts(story.facts).map((f) => `${f.order}. ${f.date} — ${f.text} [${f.evidence.map(formatCite).join("; ")}]${f.disputed ? " (disputed)" : ""}`).join("\n");
  return text.length > max ? text.slice(0, max) + "\n…[truncated]" : text;
}
