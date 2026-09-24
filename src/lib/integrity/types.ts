/** Shared integrity contracts: provenance for AI-generated records, audit events and scan findings. */

export type ProvenanceSourceKind = "document" | "deposition" | "library" | "web" | "case-law" | "regulation" | "docket" | "internal";

export interface ProvenanceSource {
  kind: ProvenanceSourceKind;
  id?: string;
  /** Bates number, page:line, reporter cite, docket entry… */
  cite?: string;
  url?: string;
  title?: string;
}

export interface ProvenanceVerification {
  status: "verified" | "partially-verified" | "unverified" | "contradicted";
  checkedAt: string;
  method: "claims" | "citations" | "schema" | "human";
  supported: number;
  unsupported: number;
  contradicted: number;
  notes?: string;
  /** Items the self-correction loop dropped or changed (one line each). */
  changes?: string[];
  /** Record cites (Bates, page:line) in the output that do not resolve to the evidence set. */
  unresolvedCites?: string[];
}

export interface ProvenanceReview {
  status: "pending" | "approved" | "rejected";
  by?: string;
  at?: string;
  note?: string;
}

export interface Provenance {
  /** Which model produced this. */
  model: string;
  generatedAt: string;
  /** Stable hash of the instructions + input so regenerations can be compared. */
  promptHash?: string;
  /** Evidence the output was grounded in (Bates, page:line, URLs, library ids). */
  sources: ProvenanceSource[];
  /** 0..1 self-reported confidence; records below the gate are flagged for review. */
  confidence?: number;
  /** Result of the verification loop, if it ran. */
  verification?: ProvenanceVerification;
  /** Human sign-off. */
  review?: ProvenanceReview;
  surface: string; // "research", "ediscovery.timeline", "office.word", "workflow"
  /** Id of an existing record this output was found to duplicate (merged or skipped). */
  duplicateOf?: string;
  /** Token usage when the runtime reported it. */
  usage?: { input: number; output: number; total: number };
}

export type AuditAction =
  | "create" | "update" | "delete" | "import" | "export" | "ai.generate" | "ai.apply" | "ai.verify" | "coding.change" | "workflow.run" | "workflow.approve" | "scan.run" | "scan.fix" | "login" | "settings.change";

export interface AuditEvent {
  id: string;
  /** Monotonic sequence within this database (ordering is exact even within one millisecond). */
  seq: number;
  ts: string;
  actorId: string;
  actorName: string;
  action: AuditAction;
  target: { kind: string; id?: string; label?: string; matterId?: string };
  meta?: Record<string, unknown>;
  /** Hash chain: sha256(prev.hash + JSON.stringify(event without hash)). */
  prevHash?: string;
  hash?: string;
}

export type ScanSeverity = "info" | "low" | "medium" | "high";

export interface ScanFinding {
  id: string;
  scanId: string;
  severity: ScanSeverity;
  title: string;
  detail: string;
  target?: { kind: string; id: string; href?: string };
  /** When present the finding can be auto-fixed by POST /api/integrity/scan {fix: findingId}. */
  fixable?: boolean;
  fixed?: boolean;
}

export interface ScanResult {
  scanId: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checked: number;
  findings: ScanFinding[];
  error?: string;
}

export interface ScanReport {
  id: string;
  ranAt: string;
  trigger: "manual" | "scheduled" | "boot";
  results: ScanResult[];
  totals: { checked: number; findings: number; bySeverity: Record<ScanSeverity, number> };
}

/**
 * Sidecar provenance record kept for every AI-produced record, so the review
 * queue and the scans can find AI output regardless of which collection it
 * lives in. `kind:recordId` is the id.
 */
export interface ProvenanceRecord {
  id: string;
  kind: ProvenanceKind;
  recordId: string;
  matterId?: string;
  title: string;
  href?: string;
  provenance: Provenance;
  updatedAt: string;
}

export type ProvenanceKind =
  | "edoc.analysis" | "edoc.prediction" | "privilege.entry"
  | "timeline.event" | "conflict" | "fact-matrix" | "knowledge-map" | "deposition.digest" | "deposition.outline"
  | "home.brief" | "workflow.step" | "office.proposal" | "library.summary" | "library.autotag" | "library.compare" | "research"
  | "intel.job";

/** Row of the review queue (GET /api/integrity/review). */
export interface ReviewQueueItem {
  kind: ProvenanceKind;
  id: string;
  title: string;
  href?: string;
  matterId?: string;
  surface: string;
  confidence?: number;
  verification?: ProvenanceVerification;
  generatedAt: string;
  model: string;
  sources: number;
  review: ProvenanceReview;
}

/** Default confidence gate: AI records below this are marked for human review and excluded from downstream automation. */
export const CONFIDENCE_GATE = 0.6;
