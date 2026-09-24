/**
 * Legal evidence contract (constitution §23, §24, §34).
 *
 * Artifacts are traceable to exact sources; citation and claim states stay separate; verification binds
 * to an artifact hash; evidence is never substituted (an unresolved Bates stays unresolved). Client-safe.
 */
export type EvidenceKind =
  | "document"
  | "deposition"
  | "docket_entry"
  | "opinion"
  | "statute"
  | "regulation"
  | "register_notice"
  | "library"
  | "web"
  | "intel"
  | "office_doc";

export interface EvidenceRef {
  kind: EvidenceKind;
  /** Application record id (never a model-generated id). */
  id: string;
  matterId?: string;
  tenantId?: string;
  title?: string;
  bates?: string;
  batesEnd?: string;
  depositionId?: string;
  witness?: string;
  page?: number;
  line?: number;
  lineEnd?: number;
  exhibit?: string;
  authorityId?: string;
  citation?: string;
  url?: string;
  /** Content hash of the source text this reference was built from. */
  hash?: string;
  version?: string;
  retrievedAt?: string;
}

export interface EvidenceVersion {
  ref: EvidenceRef;
  hash: string;
  version: string;
  extractedAt?: string;
  extractorVersion?: string;
}

export interface SourceRead {
  ref: EvidenceRef;
  readAt: string;
  chars: number;
  method: "full" | "partial" | "snippet";
  cached: boolean;
  excerptHash?: string;
}

/** Resolution outcome of a citation string against the record. No arbitrary fallback exists. */
export type CitationState = "resolved" | "unresolved" | "retried" | "excluded" | "requires_review";

export interface Citation {
  raw: string;
  state: CitationState;
  ref?: EvidenceRef;
  reason?: string;
  locationValid?: boolean;
  quoteExists?: boolean;
}

export type ClaimSupport = "supported" | "partially_supported" | "unsupported" | "contradicted" | "unchecked";

export interface Claim {
  id: string;
  text: string;
  citations: Citation[];
  support: ClaimSupport;
  evidence: EvidenceRef[];
  notes?: string;
  /** High-risk fields need stricter verification and human review (constitution §24). */
  highRisk?: boolean;
}

export interface CitationCheck {
  artifactHash: string;
  checkedAt: string;
  citations: Citation[];
  resolved: number;
  unresolved: number;
  excluded: number;
  requiresReview: number;
}

export type VerificationMethod = "claims" | "citations" | "schema" | "human";

export type VerificationStatus = "verified" | "partially_supported" | "unsupported" | "contradicted";

export interface VerificationVerdict {
  artifactHash: string;
  verifiedAt: string;
  method: VerificationMethod;
  status: VerificationStatus;
  claims: Claim[];
  supported: number;
  unsupported: number;
  contradicted: number;
  /** 0–1 share of supported claims. */
  score: number;
  notes?: string;
  model?: string;
}

/** Separate source states; never compress into one generic "verified" (constitution §23). */
export interface SourceStates {
  exists: boolean;
  found: boolean;
  read: boolean;
  citationLocationValid?: boolean;
  quoteExists?: boolean;
  propositionSupported?: boolean;
  authorityControlling?: boolean;
  authorityTreatmentValid?: boolean;
}

export type TrustState =
  | "generated"
  | "source_linked"
  | "citation_checked"
  | "claim_checked"
  | "partially_supported"
  | "verified"
  | "human_approved"
  | "rejected";

export interface ReviewDecision {
  reviewerId: string;
  reviewerName?: string;
  decision: "approved" | "rejected";
  artifactVersion: string;
  artifactHash: string;
  at: string;
  note?: string;
}

export interface TrustRecord {
  artifactId: string;
  artifactHash: string;
  artifactVersion: string;
  state: TrustState;
  sources: EvidenceRef[];
  sourceStates: SourceStates;
  citationCheck?: CitationCheck;
  verification?: VerificationVerdict;
  review?: ReviewDecision;
  updatedAt: string;
}

/** Ordered from least to most trusted; "rejected" is terminal and sorts last for display only. */
export const TRUST_ORDER: TrustState[] = ["generated", "source_linked", "citation_checked", "claim_checked", "partially_supported", "verified", "human_approved", "rejected"];

/** Fields that require stricter verification and human review before downstream use (constitution §24). */
export const HIGH_RISK_FIELDS = [
  "privilege", "responsiveness", "deadline", "limitations", "settlement", "holding", "quote", "admission", "causation", "damages",
  "procedural_posture", "adverse_authority", "dispositive_standard", "medical_fact", "scientific_fact",
] as const;
export type HighRiskField = (typeof HIGH_RISK_FIELDS)[number];
