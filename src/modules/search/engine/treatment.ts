/**
 * Authority treatment signals and currentness flags (constitution §25: track date/currentness,
 * court hierarchy; never assert good law). Pure and client-safe.
 *
 * Treatment comes from citing opinions (CourtListener `cites:` search). A citing opinion that uses
 * negative-treatment language near the citation makes the authority "possibly negative — review";
 * the absence of such language is reported as "no negative signal found", which is NOT a statement
 * that the authority is good law.
 */
import type { AuthorityTreatment, Currentness, ResearchSource } from "./types";

/** Phrases that indicate negative subsequent treatment (lower-cased; matched on word boundaries). */
export const NEGATIVE_TREATMENT_PHRASES = [
  "overruled", "overrule", "overruling", "abrogated", "abrogation", "superseded by statute", "superseded", "disapproved", "declined to follow", "decline to follow",
  "called into doubt", "no longer good law", "questioned", "limited to its facts", "we reject", "rejected the reasoning", "criticized", "not followed",
];

const NEG_RE = new RegExp(`\\b(${NEGATIVE_TREATMENT_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|")})\\b`, "i");

export interface CitingOpinion {
  title: string;
  cite?: string;
  date?: string;
  url?: string;
  snippet?: string;
}

/** First negative-treatment phrase in a snippet, or null. */
export function negativePhrase(text: string | undefined): string | null {
  const m = (text ?? "").match(NEG_RE);
  return m ? m[1].toLowerCase().replace(/\s+/g, " ") : null;
}

/**
 * Treatment signal from citing opinions. `negative` are citing opinions returned by a query that
 * already requires negative language (their phrase is re-derived from the snippet when possible).
 */
export function classifyTreatment(input: { citing: CitingOpinion[]; citingCount?: number; negative?: CitingOpinion[] }, checkedAt = new Date().toISOString()): AuthorityTreatment {
  const flagged = new Map<string, CitingOpinion & { phrase?: string }>();
  for (const c of [...(input.negative ?? []), ...input.citing]) {
    const phrase = negativePhrase(c.snippet) ?? (input.negative?.includes(c) ? "negative-treatment language" : null);
    if (phrase && !flagged.has(c.url ?? c.title)) flagged.set(c.url ?? c.title, { ...c, phrase });
  }
  const citingCount = input.citingCount ?? input.citing.length;
  const examples = Array.from(flagged.values()).slice(0, 3).map((c) => ({ title: c.title, cite: c.cite, date: c.date, url: c.url, phrase: c.phrase }));
  if (flagged.size) {
    return { signal: "possibly_negative", citingCount, negativeCount: flagged.size, examples, checkedAt, note: `Treatment: possibly negative, review. ${flagged.size} citing opinion${flagged.size === 1 ? " uses" : "s use"} negative-treatment language (${examples.map((e) => `“${e.phrase}”`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}).` };
  }
  return { signal: "no_negative_signal", citingCount, negativeCount: 0, examples: [], checkedAt, note: citingCount ? `No negative-treatment language found in ${citingCount} citing opinion${citingCount === 1 ? "" : "s"} checked. This is not a citator result; confirm before relying.` : "No citing opinions were found. This is not a citator result; confirm before relying." };
}

export function treatmentUnavailable(reason: string, checkedAt = new Date().toISOString()): AuthorityTreatment {
  return { signal: "unavailable", checkedAt, note: `Treatment not checked: ${reason}` };
}

export const TREATMENT_LABEL: Record<AuthorityTreatment["signal"], string> = {
  possibly_negative: "Treatment: possibly negative, review",
  no_negative_signal: "No negative signal found",
  unavailable: "Treatment not checked",
};

/** Currentness flag: proposed rules are not law; case law older than 25 years and other sources older than 10 are "dated". */
export function currentnessOf(s: Pick<ResearchSource, "kind" | "date" | "hit">, now = Date.now()): Currentness {
  if (s.kind === "federal_register" && /PRORULE|proposed/i.test(`${s.hit.fr?.type ?? ""} ${s.hit.title}`)) return { flag: "proposed", label: "Proposed rule, not in force" };
  const m = (s.date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { flag: "undated", label: "Date unknown" };
  const years = Math.floor((now - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / (365.25 * 86400_000));
  const limit = s.kind === "caselaw" ? 25 : s.kind === "regulations" || s.kind === "statutes" ? 100 : 10;
  if (years >= limit) return { flag: "dated", label: `${years} years old; confirm it is still current`, years };
  return { flag: "current", label: years <= 0 ? "Less than a year old" : `${years} year${years === 1 ? "" : "s"} old`, years };
}
