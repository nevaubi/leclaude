/**
 * Client-safe contract for configuring the intelligence sources from the firm's matters
 * (GET/POST /api/intel/autoconfigure). The server derives, per matter, the searches each source runs;
 * the UI shows the plan, what was applied and the runs it started.
 */
import type { IntelAdapterId } from "./types";

/** Where a derived value came from. Record-derived values are facts from the matter record; model values are search wording. */
export type PlanOrigin = "matter_record" | "model" | "rule";

export interface PlannedQuery {
  text: string;
  origin: PlanOrigin;
}

/** The searches derived for one matter. */
export interface MatterIntelPlan {
  matterId: string;
  matterName: string;
  /** Case-law searches (CourtListener syntax). */
  caseLaw: PlannedQuery[];
  /** CourtListener court ids the case-law searches are limited to (from the matter's court). */
  courts: string[];
  /** Docket numbers found in the matter record (never invented). */
  dockets: string[];
  /** MDL numbers found in the matter record. */
  mdls: string[];
  /** Judges named in the matter record. */
  judges: string[];
  /** Federal Register / regulatory searches. */
  regulatory: PlannedQuery[];
  /** Statute searches (GovInfo). */
  statutes: PlannedQuery[];
  /** Products or firms to watch for FDA enforcement, when relevant. */
  products: string[];
  /** News searches (run only when a news provider key is configured). */
  news: PlannedQuery[];
  /** CFR sections to keep current (from citations in the record, or exact sections the model proposed). */
  cfrSections?: { title: number; section: string }[];
  /** How the plan was produced: model-assisted wording or record-only rules (no AI key). */
  method: "model" | "rules";
  notes?: string[];
}

/** What applying the plan changes on one source. */
export interface SourceChange {
  sourceId: string;
  adapter: IntelAdapterId;
  name: string;
  enabledBefore: boolean;
  enabledAfter: boolean;
  /** Human-readable additions, e.g. `+3 case-law queries`, `+1 docket`. */
  added: string[];
  /** Why a source stays off (e.g. "needs TAVILY_API_KEY"). */
  skippedReason?: string;
  matterIds: string[];
}

export interface AutoconfigState {
  plans: MatterIntelPlan[];
  changes: SourceChange[];
  appliedAt?: string;
  appliedBy?: string;
  /** Jobs started by the last apply. */
  jobs: { id: string; sourceId: string }[];
}

export interface AutoconfigRequest {
  /** Limit to these matters (default: all active matters). */
  matterIds?: string[];
  /** Start runs for the configured sources right away (default true). */
  run?: boolean;
  /** Return the plan without changing sources. */
  dryRun?: boolean;
}
