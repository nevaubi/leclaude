/**
 * Deterministic post-checks on claim verification (constitution §23, §44):
 * - read before characterize: a claim can only be "supported" by a source whose full text was read;
 * - quotes are checked in code: a supporting/contradicting quote must literally appear in the source text;
 * - quotations in the answer attributed to [n] must literally appear in source n.
 * The model's verdicts are demoted, never upgraded. Pure and client-safe.
 */
import { parseCiteMarkers } from "./markers";
import { paragraphOfQuote, quoteExists } from "./paragraphs";
import type { ClaimVerdictView, ResearchSource, VerificationSummary } from "./types";

export interface QuoteCheckResult {
  verdicts: ClaimVerdictView[];
  /** Verdicts the model called supported/contradicted that the code demoted. */
  demoted: number;
  /** Quotations in the answer that do not appear in the cited source. */
  misquotes: number;
}

type TextOf = (s: ResearchSource) => string | undefined;

/** Apply the deterministic checks to a verifier's verdicts for `answer`. */
export function checkClaimEvidence(answer: string, verdicts: ClaimVerdictView[], sources: ResearchSource[], textOf: TextOf): QuoteCheckResult {
  const byN = new Map(sources.filter((s) => s.n != null).map((s) => [s.n!, s] as const));
  let demoted = 0;
  const out: ClaimVerdictView[] = verdicts.map((v) => {
    if (v.status === "unsupported") return v;
    const src = v.sourceN != null ? byN.get(v.sourceN) : undefined;
    if (!src) { demoted++; return { ...v, status: "unsupported", note: joinNote(v.note, "No numbered source was identified for this verdict.") }; }
    if (!src.read) { demoted++; return { ...v, status: "unsupported", note: joinNote(v.note, `Source [${src.n}] was not read in full (search excerpt only); a characterization needs the text.`) }; }
    const text = textOf(src) ?? "";
    if (v.quote && v.quote.trim()) {
      if (!quoteExists(text, v.quote)) { demoted++; return { ...v, status: "unsupported", quoteVerified: false, note: joinNote(v.note, `The quoted passage does not appear in the text of source [${src.n}].`) }; }
      return { ...v, quoteVerified: true, paragraph: v.paragraph ?? paragraphOfQuote(text, v.quote) ?? undefined };
    }
    return v;
  });

  let misquotes = 0;
  for (const q of answerQuotations(answer)) {
    const src = byN.get(q.n);
    if (!src) continue;
    const text = textOf(src) ?? "";
    if (src.read && quoteExists(text, q.quote)) continue;
    misquotes++;
    out.push({
      claim: `Quotation attributed to [${q.n}]: “${q.quote.length > 160 ? q.quote.slice(0, 157) + "…" : q.quote}”`,
      status: "unsupported",
      sourceN: q.n,
      quote: q.quote,
      quoteVerified: false,
      note: src.read ? `The quoted words do not appear in the text of source [${q.n}].` : `Source [${q.n}] was not read in full, so the quotation cannot be confirmed.`,
    });
  }
  return { verdicts: out, demoted, misquotes };
}

/** Quotations of 4+ words in the answer that carry a citation marker within the same sentence. */
export function answerQuotations(answer: string): { quote: string; n: number }[] {
  const out: { quote: string; n: number }[] = [];
  const re = /[“"]([^“”"\n]{12,600})[”"]/g;
  for (const m of (answer ?? "").matchAll(re)) {
    const quote = m[1].trim();
    if (quote.split(/\s+/).length < 4) continue;
    const end = (m.index ?? 0) + m[0].length;
    const tail = answer.slice(end, end + 160);
    const stop = tail.search(/[.!?](\s|$)|\n/);
    const window = stop >= 0 ? tail.slice(0, stop + 1 + 12) : tail;
    const marker = parseCiteMarkers(window)[0];
    if (marker) out.push({ quote, n: marker.n });
  }
  return out;
}

/** Recompute counts, score and status after deterministic demotions (same thresholds as the verifier). */
export function recountVerification<T extends Pick<VerificationSummary, "verdicts" | "supported" | "unsupported" | "contradicted" | "score" | "status">>(v: T): T {
  const supported = v.verdicts.filter((x) => x.status === "supported").length;
  const contradicted = v.verdicts.filter((x) => x.status === "contradicted").length;
  const unsupported = v.verdicts.length - supported - contradicted;
  const score = v.verdicts.length ? supported / v.verdicts.length : 0;
  const status: VerificationSummary["status"] = contradicted > 0 ? "contradicted" : v.verdicts.length === 0 ? "unverified" : score >= 0.9 ? "verified" : score >= 0.5 ? "partially-verified" : "unverified";
  return { ...v, supported, unsupported, contradicted, score, status };
}

function joinNote(a: string | undefined, b: string): string {
  return a ? `${a} ${b}` : b;
}
