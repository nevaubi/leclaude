/**
 * Trust derivation for research answers and sources (constitution §23, §26, §34).
 * Client-safe and pure: the UI, exports and tests derive the same states from the
 * same persisted facts. Nothing here upgrades a state beyond what was established for
 * the exact answer hash.
 */
import { deriveTrustState, isVerificationCurrent } from "@/lib/evidence/trust";
import type { CitationCheck as EvidenceCitationCheck, TrustState, VerificationVerdict } from "@/lib/evidence/types";
import { annotateCitations } from "./citecheck";
import type { CitationCrossCheck, ResearchMessage, ResearchSource, VerificationSummary } from "./types";

type MessageLike = Pick<ResearchMessage, "artifactHash" | "verification" | "citationCheck" | "citeMap" | "content" | "citations">;

/**
 * Adapter from the engine's verification summary to the evidence contract's verdict.
 * Stricter than the verifier's own label: "verified" only when every checked claim is
 * supported; any unsupported claim is "partially_supported"; any contradiction is
 * "contradicted".
 */
export function verificationVerdictOf(v: Pick<VerificationSummary, "artifactHash" | "checkedAt" | "supported" | "unsupported" | "contradicted" | "score"> | undefined): VerificationVerdict | undefined {
  if (!v || !v.artifactHash) return undefined;
  const checked = v.supported + v.unsupported + v.contradicted;
  const status: VerificationVerdict["status"] = v.contradicted > 0 ? "contradicted" : v.unsupported > 0 ? "partially_supported" : v.supported > 0 ? "verified" : "unsupported";
  return { artifactHash: v.artifactHash, verifiedAt: v.checkedAt, method: "claims", status, claims: [], supported: v.supported, unsupported: v.unsupported, contradicted: v.contradicted, score: checked ? v.supported / checked : 0 };
}

/** A verdict counts only for the exact answer hash it was computed against. */
export function isMessageVerificationCurrent(m: Pick<MessageLike, "artifactHash" | "verification">): boolean {
  if (!m.artifactHash) return false;
  return isVerificationCurrent(m.artifactHash, verificationVerdictOf(m.verification));
}

export function isCitationCheckCurrent(m: Pick<MessageLike, "artifactHash" | "citationCheck">): boolean {
  return Boolean(m.artifactHash && m.citationCheck && m.citationCheck.artifactHash === m.artifactHash);
}

/** Trust state of an answer from what was actually established for its hash. Human review is not hash-bound in this module and is never inferred. */
export function messageTrustState(m: MessageLike, sources: ResearchSource[] = []): TrustState {
  const cited = Object.values(m.citeMap ?? {});
  const citedSources = cited.length ? sources.filter((s) => cited.includes(s.id)) : [];
  const anyRead = citedSources.some((s) => s.read);
  const citationCheck: EvidenceCitationCheck | undefined = m.citationCheck;
  return deriveTrustState({
    artifactHash: m.artifactHash ?? "",
    sourceCount: cited.length,
    sourceStates: { found: cited.length > 0, read: anyRead },
    citationCheck,
    verification: verificationVerdictOf(m.verification),
  });
}

/** Source states shown in the results (constitution §26, §34): each is a distinct fact, never a blended "verified". */
export type SourceTrustState = "found" | "snippet" | "read" | "source_backed" | "claim_checked" | "verified" | "contradicted";

export const SOURCE_STATE_LABEL: Record<SourceTrustState, string> = {
  found: "Found",
  snippet: "Snippet",
  read: "Read",
  source_backed: "Source-backed",
  claim_checked: "Claim-checked",
  verified: "Verified",
  contradicted: "Contradicted",
};

export const SOURCE_STATE_HINT: Record<SourceTrustState, string> = {
  found: "Returned by a search; not opened and not cited.",
  snippet: "Cited from a search excerpt only; the full text was not read.",
  read: "Full text was read in this run but the answer does not cite it.",
  source_backed: "Read in full and cited in the answer; claims not individually checked against it.",
  claim_checked: "Cited and checked claim by claim; at least one claim it was cited for is not supported by its text.",
  verified: "Cited and every claim checked against it is supported by its text.",
  contradicted: "The source's text contradicts a claim the answer attributes to it.",
};

export interface SourceTrustContext {
  artifactHash?: string;
  verification?: Pick<VerificationSummary, "artifactHash" | "verdicts"> | (Omit<VerificationSummary, "verdicts"> & { verdicts?: VerificationSummary["verdicts"] });
}

export function sourceTrustState(s: Pick<ResearchSource, "n" | "read" | "snippet">, ctx: SourceTrustContext = {}): SourceTrustState {
  if (s.n == null) return s.read ? "read" : s.snippet ? "snippet" : "found";
  const current = Boolean(ctx.verification?.artifactHash && ctx.artifactHash && ctx.verification.artifactHash === ctx.artifactHash);
  const verdicts = current ? (ctx.verification?.verdicts ?? []).filter((v) => v.sourceN === s.n) : [];
  if (verdicts.some((v) => v.status === "contradicted")) return "contradicted";
  if (verdicts.length && verdicts.every((v) => v.status === "supported")) return "verified";
  if (verdicts.length) return "claim_checked";
  return s.read ? "source_backed" : "snippet";
}

/** Citation numbers the answer cites whose source was never read (cited from a snippet). */
export function unreadCitedNumbers(m: Pick<MessageLike, "citeMap">, sources: ResearchSource[]): number[] {
  const byId = new Map(sources.map((s) => [s.id, s] as const));
  return Object.entries(m.citeMap ?? {}).filter(([, id]) => { const s = byId.get(id); return s && !s.read; }).map(([n]) => Number(n)).sort((a, b) => a - b);
}

/** The answer as shown and exported: the verified text plus [VERIFY] markers and the citation-check note derived from the stored checks. */
export function annotateAnswer(m: Pick<MessageLike, "content" | "citations" | "citeMap">, sources: ResearchSource[] = []): string {
  const checks: CitationCrossCheck[] = m.citations ?? [];
  if (!m.content) return m.content;
  return annotateCitations(m.content, checks, { unreadCitedNs: unreadCitedNumbers(m, sources) });
}

/** Counts for the citations strip; unresolved citations are counted, never hidden. */
export function citationCounts(checks: CitationCrossCheck[] | undefined): { resolved: number; requiresReview: number; unresolved: number } {
  const out = { resolved: 0, requiresReview: 0, unresolved: 0 };
  for (const c of checks ?? []) {
    const state = c.state ?? (c.matched ? "resolved" : c.sourceN != null || c.resolvedRemotely ? "requires_review" : "unresolved");
    if (state === "resolved") out.resolved++;
    else if (state === "requires_review") out.requiresReview++;
    else out.unresolved++;
  }
  return out;
}
