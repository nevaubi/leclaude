/**
 * Trust-state helpers (constitution §23 trust states, answer-version binding). Client-safe, pure.
 */
import { TRUST_ORDER, type CitationCheck, type ReviewDecision, type SourceStates, type TrustRecord, type TrustState, type VerificationVerdict } from "./types";

export function trustRank(state: TrustState): number {
  return TRUST_ORDER.indexOf(state);
}

export function atLeast(state: TrustState, floor: TrustState): boolean {
  return state !== "rejected" && trustRank(state) >= trustRank(floor);
}

/** A verification only counts for the exact artifact hash it was computed against. */
export function isVerificationCurrent(artifactHash: string, verdict: VerificationVerdict | undefined): boolean {
  return !!verdict && verdict.artifactHash === artifactHash;
}

export function isReviewCurrent(artifactHash: string, review: ReviewDecision | undefined): boolean {
  return !!review && review.artifactHash === artifactHash;
}

/**
 * Derive the trust state from what has actually been established for this artifact hash.
 * Stale verifications and reviews (other hashes) are ignored, so a changed answer drops back to the
 * state its remaining evidence supports (constitution §23 answer version binding).
 */
export function deriveTrustState(input: {
  artifactHash: string;
  sourceCount: number;
  sourceStates?: Partial<SourceStates>;
  citationCheck?: CitationCheck;
  verification?: VerificationVerdict;
  review?: ReviewDecision;
}): TrustState {
  const { artifactHash } = input;
  if (isReviewCurrent(artifactHash, input.review)) return input.review!.decision === "approved" ? "human_approved" : "rejected";
  if (isVerificationCurrent(artifactHash, input.verification)) {
    const v = input.verification!;
    if (v.status === "contradicted" || v.status === "unsupported") return "claim_checked";
    if (v.status === "partially_supported") return "partially_supported";
    return "verified";
  }
  if (input.citationCheck && input.citationCheck.artifactHash === artifactHash) return "citation_checked";
  if (input.sourceCount > 0 && (input.sourceStates?.read || input.sourceStates?.found)) return "source_linked";
  return "generated";
}

/** Human-readable label that never overstates certainty (constitution §34). */
export function trustLabel(state: TrustState): string {
  switch (state) {
    case "generated": return "Generated";
    case "source_linked": return "Source-linked";
    case "citation_checked": return "Citations checked";
    case "claim_checked": return "Claims checked";
    case "partially_supported": return "Partially supported";
    case "verified": return "Verified";
    case "human_approved": return "Reviewed";
    case "rejected": return "Rejected";
  }
}

/** Invalidate everything bound to a previous hash when the artifact changes. */
export function rebindArtifact(record: TrustRecord, newHash: string, newVersion: string, now = new Date().toISOString()): TrustRecord {
  if (record.artifactHash === newHash) return record;
  const next: TrustRecord = { ...record, artifactHash: newHash, artifactVersion: newVersion, updatedAt: now };
  next.state = deriveTrustState({ artifactHash: newHash, sourceCount: next.sources.length, sourceStates: next.sourceStates, citationCheck: next.citationCheck, verification: next.verification, review: next.review });
  return next;
}
