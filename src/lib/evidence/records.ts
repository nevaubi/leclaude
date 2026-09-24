import "server-only";
import { db } from "@/lib/db";
import { deriveTrustState, rebindArtifact } from "./trust";
import type { CitationCheck, EvidenceRef, ReviewDecision, SourceStates, TrustRecord, TrustState, VerificationVerdict } from "./types";

/**
 * Trust records (constitution §23 trust states, answer-version binding, §54 human review).
 *
 * One record per artifact, keyed by artifact id and bound to the artifact hash. Citation checks, verifications
 * and reviews are accepted only when they were computed against the record's current hash; a changed artifact
 * (`touchArtifact`) rebinds the record and every stale verification drops out of the derived state.
 */
export const TRUST_COLLECTION = "trust_records";

export type StoredTrustRecord = TrustRecord & { id: string };

export class StaleVerificationError extends Error {
  constructor(what: string, artifactId: string, expected: string, got: string) {
    super(`${what} for ${artifactId} was computed against hash ${got.slice(0, 12)} but the artifact is now ${expected.slice(0, 12)}; re-run it against the current version`);
    this.name = "StaleVerificationError";
  }
}

function col() {
  return db().collection<StoredTrustRecord>(TRUST_COLLECTION);
}

const EMPTY_STATES: SourceStates = { exists: false, found: false, read: false };

function derive(r: StoredTrustRecord): StoredTrustRecord {
  const state: TrustState = deriveTrustState({ artifactHash: r.artifactHash, sourceCount: r.sources.length, sourceStates: r.sourceStates, citationCheck: r.citationCheck, verification: r.verification, review: r.review });
  return { ...r, state, updatedAt: new Date().toISOString() };
}

export function getTrust(artifactId: string): StoredTrustRecord | null {
  return col().get(artifactId);
}

/** Create the record for a freshly generated artifact, or rebind an existing one to the given hash/version. */
export function ensureTrust(artifactId: string, artifactHash: string, artifactVersion: string): StoredTrustRecord {
  const existing = col().get(artifactId);
  if (existing) return existing.artifactHash === artifactHash ? existing : touchArtifact(artifactId, artifactHash, artifactVersion);
  const rec: StoredTrustRecord = { id: artifactId, artifactId, artifactHash, artifactVersion, state: "generated", sources: [], sourceStates: { ...EMPTY_STATES }, updatedAt: new Date().toISOString() };
  return col().put(rec);
}

function require(artifactId: string): StoredTrustRecord {
  const r = col().get(artifactId);
  if (!r) throw new Error(`No trust record for artifact ${artifactId}; call ensureTrust first`);
  return r;
}

/** Attach the sources the artifact was grounded in and what has been established about them. */
export function recordSources(artifactId: string, sources: EvidenceRef[], states: Partial<SourceStates> = {}): StoredTrustRecord {
  const r = require(artifactId);
  const sourceStates: SourceStates = { ...r.sourceStates, ...states, exists: states.exists ?? sources.length > 0, found: states.found ?? sources.length > 0 };
  return col().put(derive({ ...r, sources, sourceStates }));
}

export function recordCitationCheck(artifactId: string, check: CitationCheck): StoredTrustRecord {
  const r = require(artifactId);
  if (check.artifactHash !== r.artifactHash) throw new StaleVerificationError("Citation check", artifactId, r.artifactHash, check.artifactHash);
  const checked = check.resolved + check.unresolved + check.requiresReview;
  const sourceStates: SourceStates = { ...r.sourceStates, citationLocationValid: checked > 0 ? check.unresolved === 0 && check.requiresReview === 0 : undefined };
  return col().put(derive({ ...r, citationCheck: check, sourceStates }));
}

export function recordVerification(artifactId: string, verdict: VerificationVerdict): StoredTrustRecord {
  const r = require(artifactId);
  if (verdict.artifactHash !== r.artifactHash) throw new StaleVerificationError("Verification", artifactId, r.artifactHash, verdict.artifactHash);
  const sourceStates: SourceStates = { ...r.sourceStates, read: true, quoteExists: verdict.claims.some((c) => c.evidence.length > 0), propositionSupported: verdict.status === "verified" };
  return col().put(derive({ ...r, verification: verdict, sourceStates }));
}

/** A human decision refers to a specific version; a decision for another hash is refused, never silently applied. */
export function recordReview(artifactId: string, review: ReviewDecision): StoredTrustRecord {
  const r = require(artifactId);
  if (review.artifactHash !== r.artifactHash) throw new StaleVerificationError("Review decision", artifactId, r.artifactHash, review.artifactHash);
  if (review.artifactVersion !== r.artifactVersion) throw new StaleVerificationError(`Review decision (version ${review.artifactVersion})`, artifactId, r.artifactHash, review.artifactHash);
  return col().put(derive({ ...r, review }));
}

/** The artifact changed: rebind to the new hash; stale citation checks, verifications and reviews stop counting. */
export function touchArtifact(artifactId: string, newHash: string, newVersion: string): StoredTrustRecord {
  const r = require(artifactId);
  const next = rebindArtifact(r, newHash, newVersion);
  if (next === r) return r;
  return col().put({ ...next, id: artifactId });
}

export function listTrust(opts: { state?: TrustState; limit?: number } = {}): StoredTrustRecord[] {
  return col().list({ where: (r) => !opts.state || r.state === opts.state, sortBy: "updatedAt", direction: "desc", limit: opts.limit ?? 100 });
}

export function deleteTrust(artifactId: string): boolean {
  return col().delete(artifactId);
}
