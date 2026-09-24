/**
 * Deterministic parts of claim verification (constitution §23 separate states, §24 high-risk fields). Pure,
 * client-safe: quote guard, high-risk tagging and verdict arithmetic. The model proposes; this code decides.
 */
import { canonicalText } from "./hash";
import { HIGH_RISK_FIELDS, type Claim, type ClaimSupport, type EvidenceRef, type HighRiskField, type VerificationStatus, type VerificationVerdict } from "./types";

/** Keyword patterns that mark a claim as touching a high-risk field regardless of what the model tagged. */
export const HIGH_RISK_PATTERNS: Record<HighRiskField, RegExp> = {
  privilege: /\bprivilege[ds]?\b|\battorney[- ]client\b|\bwork[- ]product\b/i,
  responsiveness: /\bresponsive(?:ness)?\b|\bnon-?responsive\b/i,
  deadline: /\bdeadline\b|\bdue (?:on|by)\b|\bmust (?:be )?(?:filed|served|answered) (?:by|on|within)\b|\bwithin \d+ days\b|\bno later than\b/i,
  limitations: /\bstatute of limitations\b|\blimitations period\b|\btime[- ]barred\b|\brepose\b/i,
  settlement: /\bsettle(?:ment|d)?\b|\brelease of claims\b/i,
  holding: /\bheld that\b|\bholding\b|\bthe court (?:held|ruled|found|concluded)\b/i,
  quote: /"[^"]{12,}"|“[^”]{12,}”/,
  admission: /\badmit(?:ted|s|ted that)?\b|\bconceded?\b|\backnowledged\b/i,
  causation: /\bcaus(?:ed|es|ation|al)\b|\bproximate\b|\bbut[- ]for\b/i,
  damages: /\bdamages\b|\$\s?\d[\d,]*(?:\.\d+)?\s?(?:million|billion|m|k)?\b/i,
  procedural_posture: /\bmotion to dismiss\b|\bsummary judgment\b|\bon appeal\b|\bremand(?:ed)?\b|\bposture\b/i,
  adverse_authority: /\badverse\b|\bcontrary authority\b|\bdistinguish(?:ed|able)\b|\boverruled\b|\babrogated\b/i,
  dispositive_standard: /\bstandard of review\b|\bde novo\b|\babuse of discretion\b|\bclear(?:ly)? erroneous\b|\bplausib(?:le|ility)\b|\bpreempt(?:ed|ion)\b/i,
  medical_fact: /\bdiagnos(?:is|ed)\b|\bdose\b|\bexposure\b|\bserum\b|\bcarcinogen(?:ic)?\b|\btoxic(?:ity)?\b|\bclinical\b/i,
  scientific_fact: /\bstudy\b|\bstudies\b|\bp\s?[<=]\s?0?\.\d+\b|\bstatistically significant\b|\bhalf-life\b|\bconcentration\b/i,
};

export function tagHighRisk(text: string): HighRiskField[] {
  const out: HighRiskField[] = [];
  for (const f of HIGH_RISK_FIELDS) if (HIGH_RISK_PATTERNS[f].test(text ?? "")) out.push(f);
  return out;
}

export function isHighRiskField(v: unknown): v is HighRiskField {
  return typeof v === "string" && (HIGH_RISK_FIELDS as readonly string[]).includes(v);
}

/** Minimum quote length for a literal check; shorter strings appear in any text and prove nothing. */
export const MIN_QUOTE_CHARS = 12;

function comparable(s: string): string {
  return canonicalText(s).replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/[–—‐‑]/g, "-").replace(/ /g, " ").toLowerCase();
}

/** True when `quote` appears literally in `sourceText` (whitespace, quote glyphs and dashes canonicalized; case-insensitive). */
export function quoteAppears(quote: string, sourceText: string): boolean {
  const q = comparable(quote ?? "");
  if (q.length < MIN_QUOTE_CHARS) return false;
  return comparable(sourceText ?? "").includes(q);
}

export interface RawClaim {
  id: string;
  text: string;
  fields?: string[];
  citations?: string[];
}

export interface RawVerdict {
  claimId: string;
  support: ClaimSupport | string;
  /** Index into the source list, or -1. */
  sourceIndex: number;
  quote: string;
  note?: string;
}

export interface GuardedSource {
  ref: EvidenceRef;
  text: string;
}

const NEEDS_QUOTE: ReadonlySet<ClaimSupport> = new Set<ClaimSupport>(["supported", "partially_supported", "contradicted"]);
const SUPPORTS: readonly ClaimSupport[] = ["supported", "partially_supported", "unsupported", "contradicted", "unchecked"];

/**
 * Turn model verdicts into claims the contract can trust: a claim counts as supported, partially supported or
 * contradicted only when the quoted passage literally appears in the cited source. Anything else is demoted to
 * unsupported with a note; claims the model skipped are "unchecked". High-risk fields are tagged by the model's
 * labels or the keyword patterns.
 */
export function applyQuoteGuard(rawClaims: readonly RawClaim[], verdicts: readonly RawVerdict[], sources: readonly GuardedSource[]): Claim[] {
  const byClaim = new Map<string, RawVerdict>();
  for (const v of verdicts) if (v && typeof v.claimId === "string" && !byClaim.has(v.claimId)) byClaim.set(v.claimId, v);
  return rawClaims.map((rc) => {
    const modelFields = (rc.fields ?? []).filter(isHighRiskField);
    const highRisk = modelFields.length > 0 || tagHighRisk(rc.text).length > 0;
    const v = byClaim.get(rc.id);
    const base: Claim = { id: rc.id, text: rc.text, citations: [], support: "unchecked", evidence: [], highRisk };
    if (!v) return { ...base, notes: "no verdict returned for this claim" };
    const support = (SUPPORTS as readonly string[]).includes(v.support) ? (v.support as ClaimSupport) : "unchecked";
    if (!NEEDS_QUOTE.has(support)) return { ...base, support, notes: v.note?.trim() || undefined };
    const src = Number.isInteger(v.sourceIndex) && v.sourceIndex >= 0 ? sources[v.sourceIndex] : undefined;
    if (!src) return { ...base, support: "unsupported", notes: `demoted from ${support}: the verdict named no source (sourceIndex ${v.sourceIndex})` };
    if (!quoteAppears(v.quote ?? "", src.text)) {
      return { ...base, support: "unsupported", notes: `demoted from ${support}: the quoted passage does not appear in ${src.ref.kind} ${src.ref.id}` };
    }
    return { ...base, support, evidence: [{ ...src.ref, citation: v.quote.trim() }], notes: v.note?.trim() || undefined };
  });
}

export interface VerdictSummary {
  supported: number;
  unsupported: number;
  contradicted: number;
  partiallySupported: number;
  unchecked: number;
  score: number;
  status: VerificationStatus;
}

/** Status and score from the claims. Partially supported claims count half; contradiction dominates. */
export function summarizeClaims(claims: readonly Claim[]): VerdictSummary {
  const counts = { supported: 0, partiallySupported: 0, unsupported: 0, contradicted: 0, unchecked: 0 };
  for (const c of claims) {
    if (c.support === "supported") counts.supported++;
    else if (c.support === "partially_supported") counts.partiallySupported++;
    else if (c.support === "contradicted") counts.contradicted++;
    else if (c.support === "unchecked") counts.unchecked++;
    else counts.unsupported++;
  }
  const total = claims.length;
  const score = total ? Math.round(((counts.supported + counts.partiallySupported * 0.5) / total) * 1000) / 1000 : 0;
  let status: VerificationStatus;
  if (total === 0) status = "unsupported";
  else if (counts.contradicted > 0) status = "contradicted";
  else if (counts.supported === total) status = "verified";
  else if (counts.supported + counts.partiallySupported > 0) status = "partially_supported";
  else status = "unsupported";
  return { ...counts, score, status };
}

export function buildVerdict(input: { artifactHash: string; claims: Claim[]; model?: string; notes?: string; verifiedAt?: string }): VerificationVerdict {
  const s = summarizeClaims(input.claims);
  const highRiskOpen = input.claims.filter((c) => c.highRisk && c.support !== "supported").length;
  const notes = [input.notes, highRiskOpen ? `${highRiskOpen} high-risk claim(s) are not fully supported and need human review` : undefined].filter(Boolean).join("; ") || undefined;
  return {
    artifactHash: input.artifactHash,
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
    method: "claims",
    status: s.status,
    claims: input.claims,
    supported: s.supported,
    unsupported: s.unsupported + s.unchecked,
    contradicted: s.contradicted,
    score: s.score,
    notes,
    model: input.model,
  };
}
