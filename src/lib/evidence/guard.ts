/**
 * Evidence substitution guard (constitution §23 "never substitute evidence"). Pure and client-safe.
 *
 * Forbidden: unresolved Bates → first document; unresolved source → current deposition; unresolved witness →
 * closest name; unresolved authority → plausible authority. The only legitimate way to attach a source to a
 * citation is through a citation that resolved to exactly that source.
 */
import type { Citation, EvidenceRef } from "./types";

export class EvidenceSubstitutionError extends Error {
  readonly citation: Citation;
  readonly attempted: Pick<EvidenceRef, "kind" | "id" | "matterId">;
  constructor(message: string, citation: Citation, attempted: Pick<EvidenceRef, "kind" | "id" | "matterId">) {
    super(message);
    this.name = "EvidenceSubstitutionError";
    this.citation = citation;
    this.attempted = attempted;
  }
}

/**
 * Throws when code tries to attach `ref` to `citation` although the citation did not resolve to that exact
 * record. Returns the resolved ref so call sites can write `const ref = assertNoSubstitution(cite, candidate)`.
 */
export function assertNoSubstitution(citation: Citation, ref: Pick<EvidenceRef, "kind" | "id" | "matterId">): EvidenceRef {
  const attempted = { kind: ref.kind, id: ref.id, matterId: ref.matterId };
  if (citation.state !== "resolved" || !citation.ref) {
    throw new EvidenceSubstitutionError(`Citation "${citation.raw}" is ${citation.state}${citation.reason ? ` (${citation.reason})` : ""}; it cannot be bound to ${ref.kind} ${ref.id}`, citation, attempted);
  }
  const r = citation.ref;
  if (r.kind !== ref.kind || r.id !== ref.id) {
    throw new EvidenceSubstitutionError(`Citation "${citation.raw}" resolved to ${r.kind} ${r.id}, not ${ref.kind} ${ref.id}`, citation, attempted);
  }
  if (ref.matterId && r.matterId && ref.matterId !== r.matterId) {
    throw new EvidenceSubstitutionError(`Citation "${citation.raw}" resolved in matter ${r.matterId}, not ${ref.matterId}`, citation, attempted);
  }
  return r;
}

/** The refs of resolved citations only; unresolved, excluded and review-pending cites contribute nothing. */
export function resolvedRefs(citations: readonly Citation[]): EvidenceRef[] {
  return citations.filter((c) => c.state === "resolved" && c.ref).map((c) => c.ref!);
}
