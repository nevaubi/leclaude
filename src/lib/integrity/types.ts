/** Shared integrity contracts: provenance for AI-generated records, audit events and scan findings. */

export interface Provenance {
  /** Which model produced this. */
  model: string;
  generatedAt: string;
  /** Stable hash of the instructions + input so regenerations can be compared. */
  promptHash?: string;
  /** Evidence the output was grounded in (Bates, page:line, URLs, library ids). */
  sources: { kind: "document" | "deposition" | "library" | "web" | "case-law" | "regulation" | "docket" | "internal"; id?: string; cite?: string; url?: string; title?: string }[];
  /** 0..1 self-reported confidence; records below the gate are flagged for review. */
  confidence?: number;
  /** Result of the verification loop, if it ran. */
  verification?: { status: "verified" | "partially-verified" | "unverified" | "contradicted"; checkedAt: string; method: "claims" | "citations" | "schema" | "human"; supported: number; unsupported: number; contradicted: number; notes?: string };
  /** Human sign-off. */
  review?: { status: "pending" | "approved" | "rejected"; by?: string; at?: string; note?: string };
  surface: string; // "research", "ediscovery.timeline", "office.word", "workflow"
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

/** Default confidence gate: AI records below this are marked for human review and excluded from downstream automation. */
export const CONFIDENCE_GATE = 0.6;
