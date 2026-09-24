/**
 * Client-safe types for the e-discovery review workspace. Nothing here
 * imports server-only modules; the API routes and React components share it.
 */
import type { CodingDecision, DocType, EDocument, IssueCode, PrivilegeLogEntry } from "@/lib/types/domain";

export type ReviewTab = "review" | "depositions" | "cross" | "timeline" | "people" | "conflicts" | "codes";

export const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
  { id: "review", label: "Review" },
  { id: "depositions", label: "Depositions" },
  { id: "cross", label: "Cross-analysis" },
  { id: "timeline", label: "Timeline" },
  { id: "people", label: "People & graph" },
  { id: "conflicts", label: "Conflicts" },
  { id: "codes", label: "Codes & privilege" },
];

/** Built-in saved-search views on the left rail. */
export type SavedView = "all" | "needs_review" | "hot" | "privileged" | "ai_responsive" | "recent";

export const SAVED_VIEWS: { id: SavedView; label: string; hint: string }[] = [
  { id: "all", label: "All documents", hint: "Every document collected for this matter" },
  { id: "needs_review", label: "Needs review", hint: "No responsiveness decision yet" },
  { id: "hot", label: "Hot documents", hint: "Flagged hot by a reviewer" },
  { id: "privileged", label: "Privileged", hint: "Coded privileged (any basis)" },
  { id: "ai_responsive", label: "AI: likely responsive", hint: "AI responsiveness score of 70 or higher" },
  { id: "recent", label: "Recently viewed", hint: "Last 25 documents you opened" },
];

export type CodingStatus = "responsive" | "non_responsive" | "needs_review" | "privileged" | "hot";
export type ScoreBucket = "90+" | "70-89" | "50-69" | "<50" | "unscored";

export const SCORE_BUCKETS: { id: ScoreBucket; label: string }[] = [
  { id: "90+", label: "90 – 100" },
  { id: "70-89", label: "70 – 89" },
  { id: "50-69", label: "50 – 69" },
  { id: "<50", label: "Below 50" },
  { id: "unscored", label: "Unscored" },
];

export type SortKey = "date" | "bates" | "custodian" | "type" | "subject" | "aiScore" | "relevance";

export interface SearchFilters {
  custodians?: string[]; // custodianId
  types?: DocType[];
  statuses?: CodingStatus[];
  issues?: string[]; // issue codes ("TOX-01")
  scores?: ScoreBucket[];
  years?: string[]; // "2001"
}

export interface SearchRequest {
  matterId: string;
  q?: string;
  semantic?: boolean;
  view?: SavedView;
  filters?: SearchFilters;
  sort?: SortKey;
  dir?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface FacetBucket { value: string; label: string; count: number }
export interface DateBucket { year: string; count: number }

export interface Facets {
  custodian: FacetBucket[];
  type: FacetBucket[];
  status: FacetBucket[];
  issues: FacetBucket[];
  score: FacetBucket[];
  years: DateBucket[];
}

export interface FamilyInfo {
  isParent: boolean;
  isAttachment: boolean;
  attachmentCount: number;
  inThread: boolean;
  threadSize: number;
  isDuplicate: boolean;
  nearDuplicateCount: number;
}

/** Lightweight row for the review table (no full text). */
export type DocRow = Omit<EDocument, "text" | "entities" | "aiSummary"> & {
  family2: FamilyInfo;
  score?: number; // semantic/keyword relevance 0..1
  snippet?: string;
  textLength: number;
};

export interface SearchResponse {
  hits: DocRow[];
  total: number; // matches for query+filters
  totalWorkspace: number; // all docs in the matter
  offset: number;
  limit: number;
  facets: Facets;
  parsed: ParsedQuerySummary;
  tookMs: number;
  semantic: boolean;
}

export interface ParsedQuerySummary {
  terms: string[]; // highlight terms
  fields: { field: string; value: string }[];
  bates: { start: string; end: string }[];
  warnings: string[];
}

export interface MatterStats {
  matterId: string;
  total: number;
  reviewed: number;
  pctReviewed: number;
  needsReview: number;
  responsive: number;
  nonResponsive: number;
  privileged: number;
  hot: number;
  aiScored: number;
  custodians: number;
  productionDeadline?: { label: string; date: string; daysLeft: number } | null;
  indexed: { docs: number; chunks: number; embedded: number };
}

export interface SavedViewCounts { view: SavedView; count: number }

export type CodingPatch = Partial<CodingDecision>;

export interface BulkCodingRequest {
  ids: string[];
  patch: CodingPatch;
  addIssues?: string[];
  removeIssues?: string[];
  reviewerId?: string;
}

export interface AIAnalysis {
  summary: string;
  keyIssues: string[];
  entities: { people: string[]; orgs: string[]; places: string[]; chemicals?: string[] };
  suggestedCoding: {
    responsive: boolean;
    responsiveConfidence: number; // 0-100
    privileged: boolean;
    privilegedConfidence: number;
    privilegeBasis?: CodingDecision["privilegeBasis"];
    hot: boolean;
    issues: string[]; // issue codes
    rationale: string;
  };
  privilegeRisk?: string;
  generatedAt: string;
  model: string;
}

export interface SimilarDoc {
  id: string;
  bates: string;
  subject: string;
  date: string;
  custodianName: string;
  type: DocType;
  score: number;
  passage: string;
  reason: "semantic" | "keyword" | "duplicate" | "near-duplicate" | "thread" | "family";
}

export interface PredictProgressEvent {
  type: "start" | "progress" | "doc" | "done" | "error";
  total?: number;
  done?: number;
  scored?: number;
  docId?: string;
  bates?: string;
  aiScore?: number;
  message?: string;
  code?: string;
  summary?: { scored: number; likelyResponsive: number; likelyNonResponsive: number; uncertain: number; tookMs: number };
}

export interface ProductionSummary {
  matterId: string;
  responsive: number;
  privilegedWithheld: number;
  produced: number;
  batesRanges: { start: string; end: string; count: number }[];
  byCustodian: { custodian: string; count: number }[];
  byType: { type: string; count: number }[];
}

export type IssueCodeInput = Pick<IssueCode, "code" | "label" | "description" | "color" | "parentId">;

export type PrivilegeLogRow = PrivilegeLogEntry & { subject: string; custodianName: string };

export const ISSUE_COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "info", "warning", "destructive", "success", "primary"] as const;

export const PRIVILEGE_BASES: { id: NonNullable<CodingDecision["privilegeBasis"]>; label: string }[] = [
  { id: "attorney-client", label: "Attorney–client" },
  { id: "work-product", label: "Work product" },
  { id: "common-interest", label: "Common interest" },
  { id: "joint-defense", label: "Joint defense" },
];

export const CONFIDENTIALITY_LEVELS: { id: NonNullable<CodingDecision["confidentiality"]>; label: string }[] = [
  { id: "public", label: "Public" },
  { id: "confidential", label: "Confidential" },
  { id: "highly confidential", label: "Highly Confidential" },
  { id: "AEO", label: "Attorneys' Eyes Only" },
];
