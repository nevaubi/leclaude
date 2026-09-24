/**
 * Client-safe result shapes for the analysis layer. Server modules under
 * `analysis/` produce these; the /intel pages, Home and Settings render them;
 * the API routes return them as JSON.
 */
import type { ID, ISODate } from "@/lib/types/domain";
import type { IntelDocumentKind, IntelEntity, IntelEntityType, IntelEvidence, IntelFlag, IntelInsight, IntelRelation, IntelRelationType, IntelSeries, IntelTimelineEntry, IntelWatch } from "../types";
import type { Anomaly, MotionOutcome, MotionType } from "./pure";

// ---------------- Entities ----------------

export interface EntityListItem {
  id: ID;
  type: IntelEntityType;
  name: string;
  aliases: string[];
  /** Court / firm / MDL number / manufacturer: one line of context. */
  detail?: string;
  mentionCount: number;
  documents: number;
  relations: number;
  /** Most recent linked document date. */
  lastSeen?: ISODate;
  flags: IntelFlag[];
  watched: boolean;
  seeded: boolean;
  updatedAt: ISODate;
}

export interface EntityListResult {
  items: EntityListItem[];
  total: number;
  counts: Partial<Record<IntelEntityType, number>>;
  limit: number;
  offset: number;
}

export interface DocLite {
  id: ID;
  kind: IntelDocumentKind;
  title: string;
  date?: ISODate;
  court?: string;
  citation?: string;
  docketNumber?: string;
  url?: string;
  confidence: number;
  flags: IntelFlag[];
  matterIds: ID[];
  summary?: string;
}

export interface RelatedEntity {
  entity: Pick<IntelEntity, "id" | "type" | "name">;
  relation: IntelRelationType;
  /** "out": this entity → related; "in": related → this entity. */
  direction: "out" | "in";
  weight: number;
  confidence: number;
  evidence: IntelRelation["evidence"];
}

export interface MotionTendency {
  motion: MotionType;
  label: string;
  total: number;
  granted: number;
  denied: number;
  partial: number;
  other: number;
  /** Share granted (incl. partial as half) among decided motions; null when nothing was decided. */
  grantRate: number | null;
  evidence: { docId: ID; title: string; date?: ISODate; outcome: MotionOutcome | null; url?: string }[];
}

export interface EntityProfile {
  entity: IntelEntity;
  counts: { documents: number; byKind: Partial<Record<IntelDocumentKind, number>>; matters: number; relations: number };
  activity: IntelSeries;
  tendencies: MotionTendency[];
  related: RelatedEntity[];
  recent: DocLite[];
  timeline: IntelTimelineEntry[];
  matters: { id: ID; shortName: string; name: string }[];
  watched: boolean;
  watch?: IntelWatch;
  insights: IntelInsight[];
}

// ---------------- Graph ----------------

export interface GraphNodeExport { id: ID; label: string; type: IntelEntityType; degree: number; mentionCount: number; documents: number; flagged: boolean }
export interface GraphLinkExport { id: ID; source: ID; target: ID; type: IntelRelationType; weight: number; confidence: number; evidence: IntelRelation["evidence"] }
export interface GraphExport { nodes: GraphNodeExport[]; links: GraphLinkExport[]; center?: ID; depth: number; truncated: boolean }

// ---------------- Trends ----------------

export type TrendGroupBy = "jurisdiction" | "court" | "judge" | "kind" | "motion" | "outcome" | "mdl" | "attorney" | "firm" | "state" | "agency" | "product" | "matter";

export const TREND_GROUP_LABEL: Record<TrendGroupBy, string> = {
  jurisdiction: "Jurisdiction", court: "Court", judge: "Judge", kind: "Record kind", motion: "Motion type", outcome: "Outcome", mdl: "MDL", attorney: "Attorney", firm: "Firm", state: "State", agency: "Agency", product: "Product", matter: "Matter",
};

export interface TrendQuery {
  groupBy: TrendGroupBy;
  kinds?: IntelDocumentKind[];
  jurisdiction?: string;
  court?: string;
  judgeId?: string;
  entityId?: string;
  matterId?: string;
  motion?: MotionType;
  from?: string;
  to?: string;
  /** Keep the N largest series (default 8). */
  top?: number;
  /** Compare mode: labels or entity ids to keep, aligned on one month axis. */
  compare?: string[];
}

export interface TrendResult {
  query: TrendQuery;
  months: string[];
  series: IntelSeries[];
  totals: { label: string; count: number; id?: ID }[];
  anomalies: { series: string; anomaly: Anomaly }[];
  trends: Record<string, { slope: number; first: number; last: number; changePct: number | null }>;
  sample: number;
  /** Labels → entity ids when the dimension is an entity type. */
  labelIds: Record<string, ID>;
}

// ---------------- Clusters ----------------

export interface ClusterSummary {
  id: string;
  label: string;
  terms: string[];
  size: number;
  share: number;
  docIds: ID[];
  chunkIds: ID[];
  topDocs: { docId: ID; title: string; kind: IntelDocumentKind; similarity: number; chunkId: ID; excerpt: string }[];
  byKind: Partial<Record<IntelDocumentKind, number>>;
  dateRange?: { from: ISODate; to: ISODate };
}

export interface ClusterResult {
  method: "embeddings" | "tfidf";
  k: number;
  chunks: number;
  documents: number;
  iterations: number;
  clusters: ClusterSummary[];
  scope: Record<string, unknown>;
  generatedAt: ISODate;
}

// ---------------- Chronology ----------------

export interface ChronologyQuery {
  matterId?: ID;
  mdlId?: ID;
  productId?: ID;
  entityId?: ID;
  from?: string;
  to?: string;
  kinds?: IntelDocumentKind[];
  includeEdiscovery?: boolean;
  limit?: number;
}

export interface ChronologyResult {
  query: ChronologyQuery;
  entries: IntelTimelineEntry[];
  merged: number;
  sources: { intel: number; ediscovery: number };
  label: string;
}

export interface ChronologyExportResult { matterId: ID; created: number; skippedDuplicates: number; belowGate: number; eventIds: ID[] }

// ---------------- Insights ----------------

export interface InsightListResult {
  insights: IntelInsight[];
  /** Alias so Home's "For you" slot can read `items` too. */
  items: IntelInsight[];
  total: number;
  ranked: boolean;
}

export interface AnalysisRunResult {
  at: ISODate;
  durationMs: number;
  entities: { docs: number; linked: number; created: number };
  relations: { total: number; created: number; updated: number };
  insights: { created: number; updated: number; unchanged: number; total: number };
  chronologies: number;
  notes: string[];
}

export interface AnalysisStatus {
  lastRun?: AnalysisRunResult;
  entities: number;
  relations: number;
  insights: { total: number; published: number; flagged: number; draft: number; dismissed: number };
  watches: number;
  documents: number;
  /** Documents updated after the last analysis run. */
  pending: number;
}

export type { IntelEvidence };
