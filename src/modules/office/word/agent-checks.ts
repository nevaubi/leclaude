/**
 * Deterministic drafting checks for the Word agent (no model calls): defined terms, Bluebook-style citation
 * form, block-level redline between two versions, and post-edit verification. They only flag; edits stay
 * proposals the drafter reviews.
 */
import { diffArrays } from "diff";
import { findPlaceholders } from "./doc-model";

export interface CheckBlock { id: string; index: number; type: string; text: string; level?: number }

// ---------------------------------------------------------------------------
// Defined terms
// ---------------------------------------------------------------------------

const Q_OPEN = "[\"“]";
const Q_CLOSE = "[\"”]";
const TERM = "([A-Z][A-Za-z0-9&.'’\\- ]{0,58}[A-Za-z0-9.)])";
/** ("Term"), (the "Term"), (collectively, the "Term"), (each, a "Term"), "Term" means / shall mean / has the meaning / refers to. */
const DEFINITION_RES = [
  new RegExp(`\\((?:[^()"“”]{0,40}?,\\s*)?(?:the\\s+|a\\s+|an\\s+)?${Q_OPEN}${TERM}${Q_CLOSE}\\s*(?:or\\s+(?:the\\s+)?${Q_OPEN}${TERM}${Q_CLOSE})?\\)`, "g"),
  new RegExp(`${Q_OPEN}${TERM}${Q_CLOSE}\\s+(?:means|shall mean|has the meaning|have the meaning|refers to|shall refer to|includes|is defined)`, "g"),
  new RegExp(`(?:hereinafter|hereafter)(?:\\s+(?:referred to as|called))?\\s+(?:the\\s+)?${Q_OPEN}${TERM}${Q_CLOSE}`, "gi"),
];

/** Capitalized terms commonly used without a definition in filings; never flagged as undefined. */
const UNDEFINED_STOPLIST = new Set(["Court", "Clerk", "Judge", "Honorable Court", "United States", "State", "Federal Rules", "Rule", "Rules", "Section", "Exhibit", "Motion", "Order", "Complaint", "Answer", "Plaintiff", "Plaintiffs", "Defendant", "Defendants", "Parties", "Party", "Circuit", "District", "Supreme Court", "Congress", "Constitution", "Act", "Code", "Id", "Page", "Table", "Figure", "Article", "Schedule", "Appendix", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

export interface DefinedTermsReport {
  defined: { term: string; block_id: string; index: number; uses: number }[];
  /** Terms used as defined terms (capitalized after "the/such/each/any/this/that/said") with no definition. */
  used_not_defined: { term: string; uses: number; block_ids: string[] }[];
  /** Defined but never used after the definition. */
  defined_not_used: { term: string; block_id: string }[];
  /** Defined more than once, or used before the paragraph that defines it. */
  defined_twice: { term: string; block_ids: string[] }[];
  used_before_definition: { term: string; first_use_block_id: string; definition_block_id: string }[];
  /** Lower-case uses of a defined term (e.g. "agreement" where "Agreement" is defined). */
  inconsistent_case: { term: string; variant: string; block_ids: string[] }[];
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function checkDefinedTerms(blocks: CheckBlock[]): DefinedTermsReport {
  const defs = new Map<string, { block: CheckBlock; count: number; blocks: string[] }>();
  const definitionSpans = new Map<string, [number, number][]>();
  for (const b of blocks) {
    for (const re of DEFINITION_RES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(b.text))) {
        for (const t of [m[1], m[2]].filter(Boolean) as string[]) {
          const term = t.trim().replace(/[.,;:]$/, "");
          if (term.length < 2 || term.split(/\s+/).length > 6) continue;
          const d = defs.get(term);
          if (d) { d.count++; if (!d.blocks.includes(b.id)) d.blocks.push(b.id); }
          else defs.set(term, { block: b, count: 1, blocks: [b.id] });
          definitionSpans.set(b.id, [...(definitionSpans.get(b.id) ?? []), [m.index, m.index + m[0].length]]);
        }
      }
    }
  }
  const inSpan = (id: string, at: number) => (definitionSpans.get(id) ?? []).some(([a, z]) => at >= a && at < z);
  const defined: DefinedTermsReport["defined"] = [];
  const definedNotUsed: DefinedTermsReport["defined_not_used"] = [];
  const usedBefore: DefinedTermsReport["used_before_definition"] = [];
  const inconsistent: DefinedTermsReport["inconsistent_case"] = [];
  for (const [term, d] of defs) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?:s|es)?(?![\\p{L}\\p{N}])`, "gu");
    let uses = 0; let firstUse: CheckBlock | null = null;
    for (const b of blocks) {
      if (b.type === "heading") continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(b.text))) { if (inSpan(b.id, m.index)) continue; uses++; if (!firstUse) firstUse = b; }
    }
    defined.push({ term, block_id: d.block.id, index: d.block.index, uses });
    if (!uses) definedNotUsed.push({ term, block_id: d.block.id });
    if (firstUse && firstUse.index < d.block.index) usedBefore.push({ term, first_use_block_id: firstUse.id, definition_block_id: d.block.id });
    if (/^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/.test(term)) {
      const lower = term.toLowerCase();
      const lre = new RegExp(`\\b(?:[Tt]he|[Tt]his|[Ss]uch|[Ee]ach|[Ss]aid)\\s+${escapeRe(lower)}\\b`);
      const hits = blocks.filter((b) => b.type !== "heading" && lre.test(b.text)).map((b) => b.id);
      if (hits.length) inconsistent.push({ term, variant: lower, block_ids: hits.slice(0, 10) });
    }
  }
  // Candidates for "used but not defined": capitalized phrases after a determiner, used at least twice.
  const cand = new Map<string, { uses: number; blocks: Set<string> }>();
  const candRe = /\b(?:[Tt]he|[Ss]uch|[Ee]ach|[Aa]ny|[Tt]his|[Tt]hat|[Ss]aid|[Aa]ll|[Ee]very)\s+((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+){0,3})\b/g;
  for (const b of blocks) {
    if (b.type === "heading") continue;
    candRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = candRe.exec(b.text))) {
      const term = m[1];
      if (UNDEFINED_STOPLIST.has(term) || UNDEFINED_STOPLIST.has(term.split(" ")[0])) continue;
      if (defs.has(term) || defs.has(term.replace(/s$/, "")) || Array.from(defs.keys()).some((d) => term.startsWith(d))) continue;
      const c = cand.get(term) ?? { uses: 0, blocks: new Set<string>() };
      c.uses++; c.blocks.add(b.id); cand.set(term, c);
    }
  }
  const usedNotDefined = Array.from(cand.entries()).filter(([, c]) => c.uses >= 2).map(([term, c]) => ({ term, uses: c.uses, block_ids: Array.from(c.blocks).slice(0, 10) })).sort((a, b) => b.uses - a.uses).slice(0, 40);
  const twice = Array.from(defs.entries()).filter(([, d]) => d.blocks.length > 1).map(([term, d]) => ({ term, block_ids: d.blocks }));
  return { defined: defined.slice(0, 80), used_not_defined: usedNotDefined, defined_not_used: definedNotUsed, defined_twice: twice, used_before_definition: usedBefore, inconsistent_case: inconsistent };
}

// ---------------------------------------------------------------------------
// Citation form (Bluebook-style pattern checks; flags only)
// ---------------------------------------------------------------------------

export interface CitationFlag { block_id: string; index: number; citation: string; rule: string; message: string }

const CASE_CITE = /((?:[A-Z][\w.&'’-]*(?:,?\s)?)+?)\s?(v\.?|vs\.?)\s((?:[A-Z][\w.&'’-]*(?:,?\s)?)+?),?\s?(\d{1,4})\s(U\.S\.|S\.\s?Ct\.|L\.\s?Ed\.(?:\s?2d)?|F\.\s?(?:2d|3d|4th)|F\.|F\.\s?Supp\.(?:\s?[23]d)?|F\.\s?App'x|[A-Z][\w.]*\s?(?:2d|3d|4th)?)\s(\d{1,5})(?:,\s?(\d{1,5}(?:[–-]\d{1,5})?))?(\s?\(([^)]{0,60})\))?/g;

export function checkCitations(blocks: CheckBlock[], opts: { currentYear?: number } = {}): CitationFlag[] {
  const year = opts.currentYear ?? new Date().getFullYear();
  const out: CitationFlag[] = [];
  const flag = (b: CheckBlock, citation: string, rule: string, message: string) => { if (out.length < 200) out.push({ block_id: b.id, index: b.index, citation: citation.trim().slice(0, 160), rule, message }); };
  for (const b of blocks) {
    const t = b.text;
    CASE_CITE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CASE_CITE.exec(t))) {
      const [whole, , vs, , , reporter, first, pin, paren, parenBody] = m;
      if (vs !== "v.") flag(b, whole, "case-name", `Use "v." between party names (found "${vs}").`);
      if (/\s,/.test(whole)) flag(b, whole, "punctuation", "Remove the space before the comma.");
      if (/^F\.\s(2d|3d|4th)$/.test(reporter)) flag(b, whole, "reporter-spacing", `Close up the reporter: "${reporter.replace(/\s/, "")}".`);
      if (/^S\.Ct\.$/.test(reporter)) flag(b, whole, "reporter-spacing", `Use "S. Ct." with a space.`);
      if (/^F\.Supp\./.test(reporter)) flag(b, whole, "reporter-spacing", `Use "F. Supp." with a space.`);
      if (!paren) flag(b, whole, "parenthetical", "Full case citation is missing the (court year) parenthetical.");
      else {
        const y = /(\d{4})\s*$/.exec(parenBody ?? "")?.[1];
        if (!y) flag(b, whole, "parenthetical", "Parenthetical has no year.");
        else if (Number(y) > year || Number(y) < 1754) flag(b, whole, "year", `Year ${y} is out of range.`);
        if (reporter !== "U.S." && /^\s*\d{4}\s*$/.test(parenBody ?? "") && !/S\.\s?Ct\.|L\.\s?Ed/.test(reporter)) flag(b, whole, "court", "Parenthetical omits the deciding court (required unless the reporter identifies it, e.g. U.S.).");
      }
      if (pin) {
        const p = Number(pin.split(/[–-]/)[0]);
        if (p < Number(first)) flag(b, whole, "pin-cite", `Pin cite ${pin} is before the first page ${first}.`);
      }
    }
    for (const mm of t.matchAll(/\b\d{1,3}\s+(?:U\.S\.C\.|C\.F\.R\.)\s*(§*)\s*\d[\w.-]*/g)) {
      const c = mm[0];
      if (!mm[1]) flag(b, c, "section-symbol", `Statutes and regulations take a section symbol: "U.S.C. § …".`);
      else if (!/\.\s§+\s\d/.test(c)) flag(b, c, "section-symbol", `Put a space before and after "§".`);
    }
    for (const mm of t.matchAll(/\bFRCP\s*\d+|\bFRE\s*\d+/g)) flag(b, mm[0], "rule-form", `Cite rules as "Fed. R. Civ. P." / "Fed. R. Evid." in Bluebook form.`);
    for (const mm of t.matchAll(/(?:^|[.;]\s+)(id\.)/g)) flag(b, mm[1], "id", `Capitalize "Id." at the start of a citation sentence.`);
    for (const mm of t.matchAll(/\bId(?![.\w])/g)) flag(b, mm[0], "id", `"Id." takes a period.`);
    for (const mm of t.matchAll(/\b[A-Z][\w.'’-]+ v\. [A-Z][\w.'’-]+,?\s+supra\b/g)) flag(b, mm[0], "supra", `Do not use "supra" for cases; use a short-form citation.`);
    for (const p of findPlaceholders(t)) if (/VERIFY|CITE|CITATION|TBD|INSERT/i.test(p)) flag(b, p, "placeholder", "Placeholder citation must be completed before filing.");
    for (const mm of t.matchAll(/\b\d{4}\s?WL\s?\d+(?!\s*,\s*at\s*\*\d)/g)) flag(b, mm[0], "westlaw", `Westlaw citations need a pin cite in the form ", at *N".`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Redline (block-aligned diff between two versions)
// ---------------------------------------------------------------------------

export type RedlineOp =
  | { op: "modify"; id: string; base: string; current: string }
  | { op: "insert"; id: string; current: string }
  | { op: "delete"; after_id: string | null; base: string; base_type: string };

/** Share of words two paragraphs have in common (multiset overlap over the longer one). */
function similarity(a: string, b: string): number {
  const wa = a.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [], wb = b.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!wa.length && !wb.length) return 1;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) { const c = counts.get(w) ?? 0; if (c > 0) { common++; counts.set(w, c - 1); } }
  return common / Math.max(wa.length, wb.length);
}

/** Align base and current blocks by text; changed pairs become "modify", the rest insert/delete. */
export function computeRedline(base: { text: string; type: string }[], current: CheckBlock[]): RedlineOp[] {
  const key = (x: { text: string; type: string }) => `${x.type}|${x.text.trim()}`;
  const parts = diffArrays(base.map(key), current.map(key));
  const ops: RedlineOp[] = [];
  let bi = 0, ci = 0;
  let lastCurrent: string | null = null;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (!p.added && !p.removed) { bi += p.count ?? p.value.length; ci += p.count ?? p.value.length; lastCurrent = current[ci - 1]?.id ?? lastCurrent; continue; }
    if (p.removed) {
      const removed = base.slice(bi, bi + (p.count ?? p.value.length));
      bi += removed.length;
      const next = parts[k + 1];
      const added = next?.added ? current.slice(ci, ci + (next.count ?? next.value.length)) : [];
      if (added.length) { ci += added.length; k++; }
      // Pair by position when similar; leftovers are deletions/insertions.
      const n = Math.max(removed.length, added.length);
      for (let i = 0; i < n; i++) {
        const r = removed[i], a = added[i];
        if (r && a && r.type === a.type && similarity(r.text, a.text) >= 0.4) { ops.push({ op: "modify", id: a.id, base: r.text, current: a.text }); lastCurrent = a.id; }
        else {
          if (r) ops.push({ op: "delete", after_id: lastCurrent, base: r.text, base_type: r.type });
          if (a) { ops.push({ op: "insert", id: a.id, current: a.text }); lastCurrent = a.id; }
        }
      }
      continue;
    }
    const added = current.slice(ci, ci + (p.count ?? p.value.length));
    ci += added.length;
    for (const a of added) { ops.push({ op: "insert", id: a.id, current: a.text }); lastCurrent = a.id; }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Post-edit verification
// ---------------------------------------------------------------------------

export interface VerifyIssue { block_id: string; index: number; issue: string }

export function verifyBlocks(after: CheckBlock[], before: Map<string, string>): VerifyIssue[] {
  const out: VerifyIssue[] = [];
  for (const b of after) {
    const prev = before.get(b.id) ?? "";
    const t = b.text;
    const ph = findPlaceholders(t).length - findPlaceholders(prev).length;
    if (ph > 0) out.push({ block_id: b.id, index: b.index, issue: `${ph} new placeholder(s) ${findPlaceholders(t).join(" ")} — complete or flag with a comment` });
    if (/ {2,}/.test(t) && !/ {2,}/.test(prev)) out.push({ block_id: b.id, index: b.index, issue: "double space introduced" });
    const bal = (o: string, c: string) => (t.split(o).length - 1) - (t.split(c).length - 1);
    if (bal("(", ")") !== 0) out.push({ block_id: b.id, index: b.index, issue: "unbalanced parentheses" });
    if (bal("[", "]") !== 0) out.push({ block_id: b.id, index: b.index, issue: "unbalanced brackets" });
    if (bal("“", "”") !== 0) out.push({ block_id: b.id, index: b.index, issue: "unbalanced curly quotes" });
    if (((t.match(/"/g) ?? []).length % 2) === 1) out.push({ block_id: b.id, index: b.index, issue: "odd number of straight quotes" });
    if (/\b(\w+)\s+\1\b/i.test(t) && !/\b(\w+)\s+\1\b/i.test(prev)) out.push({ block_id: b.id, index: b.index, issue: `repeated word "${/\b(\w+)\s+\1\b/i.exec(t)![1]}"` });
    if (b.type === "paragraph" && t.trim() && !/[.:;?!”")\]]$/.test(t.trim()) && prev.trim() && /[.:;?!”")\]]$/.test(prev.trim())) out.push({ block_id: b.id, index: b.index, issue: "paragraph no longer ends with punctuation" });
    if (!t.trim() && prev.trim()) out.push({ block_id: b.id, index: b.index, issue: "paragraph is now empty" });
  }
  return out;
}
