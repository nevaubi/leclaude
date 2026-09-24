/**
 * Research engine contracts. Client-safe: shared by the server orchestrator,
 * the SSE route, the React hook/components, the seed and the tests.
 */
import type { Provenance } from "@/lib/integrity/types";
import type { Authority, SearchHit, SearchSettings, SearchSource } from "../types";

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

export type LaneKind = "controlling" | "contrary" | "regulatory" | "record" | "secondary" | "fast";

/**
 * Where a lane retrieves from: the structured providers, or the firm's
 * intelligence corpus ("intel"), whose hits are normalized onto the lane's
 * provider kinds (opinion → caselaw, CFR → regulations, docket entries →
 * dockets…) so sources, citations and reading stay uniform.
 */
export type RetrievalSource = SearchSource | "intel";

export interface ResearchLane {
  /** Also feed the lane from the intelligence corpus (default true for provider lanes). */
  intel?: boolean;
  /** One-line note shown under the lane card ("Also searches the intelligence corpus"). */
  note?: string;
  id: string;
  kind: LaneKind;
  name: string;
  /** One-line purpose shown on the lane card. */
  brief: string;
  /** Structured providers this lane queries before (and while) the agent reads. */
  sources: SearchSource[];
  /** Toolkit tool names the lane agent may call. */
  tools: string[];
  /** Queries run against the structured providers (round-specific). */
  queries: string[];
  /** Agent loop bound. */
  maxSteps: number;
  /** Cap on full-text reads per lane. */
  maxReads: number;
  round: number;
}

export type LaneStatus = "queued" | "retrieving" | "reading" | "done" | "error" | "stopped" | "skipped";

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** One authority/page/document the engine found or read, deduped across lanes and rounds. */
export interface ResearchSource {
  /** Stable key (hit id, or url for web pages). */
  id: string;
  /** Citation number in the answer, assigned at synthesis. */
  n?: number;
  kind: SearchSource;
  title: string;
  cite?: string;
  url?: string;
  court?: string;
  date?: string;
  authority?: Authority;
  snippet?: string;
  /** True when the full text was retrieved and handed to the synthesis/verification steps. */
  read: boolean;
  chars?: number;
  readMs?: number;
  cached?: boolean;
  laneIds: string[];
  /** First ~600 characters of the text that was read (for the UI and thread history). */
  excerpt?: string;
  /** Normalized hit for the reader sheet, pins and library. */
  hit: SearchHit;
  /** Whether the source is part of the matter record (documents/depositions) or outside authority. */
  scope: "record" | "authority" | "internal" | "web";
  foundAt: number;
}

export interface ClaimVerdictView {
  claim: string;
  status: "supported" | "unsupported" | "contradicted";
  /** Citation number of the supporting/contradicting source (1-based), or null. */
  sourceN: number | null;
  quote?: string;
  note?: string;
}

export interface VerificationSummary {
  status: "verified" | "partially-verified" | "unverified" | "contradicted";
  supported: number;
  unsupported: number;
  contradicted: number;
  score: number;
  checkedAt: string;
  verdicts: ClaimVerdictView[];
}

export interface CitationCrossCheck {
  citation: string;
  /** Matched to a source the lanes read. */
  matched: boolean;
  sourceN?: number;
  /** Resolved on CourtListener (network) even though no lane read it. */
  resolvedRemotely?: boolean;
}

export interface RunStats {
  sources: number;
  read: number;
  rounds: number;
  agents: number;
  durationMs: number;
}

export type ResearchMode = "deep" | "fast";

export type AnswerBanner = "not-source-backed" | "no-api-key" | null;

// ---------------------------------------------------------------------------
// Threads and messages
// ---------------------------------------------------------------------------

export interface ResearchMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  runId?: string;
  stats?: RunStats;
  verification?: Omit<VerificationSummary, "verdicts"> & { verdicts?: ClaimVerdictView[] };
  citations?: CitationCrossCheck[];
  provenance?: Provenance;
  banner?: AnswerBanner;
  followUps?: string[];
  /** Citation numbers → source ids for this answer. */
  citeMap?: Record<number, string>;
  lanes?: { id: string; name: string; kind: LaneKind; status: LaneStatus; sources: number; durationMs: number; round: number }[];
}

export interface ResearchPin {
  id: string;
  kind: "source" | "passage";
  sourceId?: string;
  hit?: SearchHit;
  text?: string;
  note?: string;
  addedAt: number;
}

export interface ResearchThread {
  id: string;
  title: string;
  matterId: string | null;
  settings: SearchSettings;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  messages: ResearchMessage[];
  /** Deduped sources across every run in the thread (text is not stored; excerpts are). */
  sources: ResearchSource[];
  pins: ResearchPin[];
  runIds: string[];
}

// ---------------------------------------------------------------------------
// Stream events (in addition to the agent's text.delta/tool events)
// ---------------------------------------------------------------------------

export type ResearchStreamEvent =
  | { type: "run.start"; runId: string; threadId: string; question: string; mode: ResearchMode; startedAt: number }
  | { type: "plan"; round: number; lanes: ResearchLane[] }
  | { type: "round.start"; round: number; reason?: string }
  | { type: "lane.start"; laneId: string; round: number }
  | { type: "lane.step"; laneId: string; step: number; label: string; status: LaneStatus }
  | { type: "lane.source"; laneId: string; source: ResearchSource }
  | { type: "lane.note"; laneId: string; note: string }
  | { type: "lane.done"; laneId: string; status: LaneStatus; durationMs: number; sources: number; error?: string }
  | { type: "synthesis.start"; round: number; sources: number }
  | { type: "answer.text"; text: string; citeMap: Record<number, string>; stage: "draft" | "revised" | "final" }
  | { type: "verify.start"; claims?: number }
  | { type: "verify.done"; verification: VerificationSummary }
  | { type: "correction"; changed: boolean; note: string }
  | { type: "citecheck"; checks: CitationCrossCheck[] }
  | { type: "round.done"; round: number; complete: boolean; reason: string }
  | { type: "followups"; questions: string[] }
  | { type: "answer.final"; message: ResearchMessage; sources: ResearchSource[] }
  | { type: "run.done"; runId: string; threadId: string; stats: RunStats };
