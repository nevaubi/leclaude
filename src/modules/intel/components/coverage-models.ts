/**
 * Client-safe contract and pure view helpers for the per-matter intelligence coverage band on /intel
 * (GET /api/intel/coverage). The server helper lives in ../analysis/matter-coverage.ts; everything here is
 * computed data (counts, states, configured searches), never generated text.
 */
import type { IntelAdapterId, IntelErrorCode, IntelJobKind, IntelJobStatus } from "../types";
import type { MatterIntelPlan, PlanOrigin, PlannedQuery, SourceChange } from "../autoconfig-types";

/** What one source is doing for a matter right now. `needs_key` is a configuration gap, not a failure. */
export type CoverageSourceState = "running" | "queued" | "failed" | "needs_key" | "disabled" | "idle";

/** A search a source runs, as configured on the source record (the autoconfigure plan carries origins separately). */
export interface ConfiguredSearch {
  kind: "query" | "docket" | "judge" | "court" | "product" | "mdl" | "cfr" | "target";
  text: string;
}

export interface CoverageSource {
  id: string;
  name: string;
  adapter: IntelAdapterId;
  enabled: boolean;
  state: CoverageSourceState;
  /** "matter": the source's scope names this matter. "all_active": it runs for every active matter. "records": it serves no matter but produced records linked to this one. */
  linked: "matter" | "all_active" | "records";
  /** How many matters share this source's configuration. */
  sharedWith: number;
  lastRunAt?: string;
  nextRunAt?: string;
  /** Redacted, ≤ 200 chars. */
  lastError?: string;
  /** e.g. "TAVILY_API_KEY or FIRECRAWL_API_KEY". */
  needsKey?: string;
  /** Records from this source linked to this matter. */
  records: number;
  searches: ConfiguredSearch[];
}

export interface MatterCoverage {
  matterId: string;
  name: string;
  shortName?: string;
  status: string;
  court?: string;
  judge?: string;
  sources: CoverageSource[];
  /** Intelligence records linked to the matter. */
  records: number;
  /** Records fetched in the last 7 days. */
  recentRecords: number;
  /** Distinct entities resolved from the matter's records. */
  entities: number;
  /** Relations supported by at least one of the matter's records. */
  relations: number;
  insights: { total: number; published: number; flagged: number };
  lastRunAt?: string;
  lastRecordAt?: string;
  activeJobs: number;
  failedJobs: number;
}

export interface CoverageJobLog { at: string; level: "debug" | "info" | "warn" | "error"; msg: string }

export interface CoverageJob {
  id: string;
  kind: IntelJobKind;
  status: IntelJobStatus;
  sourceId?: string;
  sourceName?: string;
  adapter?: IntelAdapterId;
  /** Latest progress line (excerpted). */
  phase?: string;
  /** Records the source added or refreshed since this run started (deterministic count from the store). */
  recordsSoFar: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  errorCode?: IntelErrorCode;
  /** Redacted, ≤ 200 chars. */
  error?: string;
  /** The failure is a missing provider key rather than a broken run. */
  needsKey?: string;
  /** Matters (within the caller's scope) the job's source serves. */
  matterIds: string[];
  log: CoverageJobLog[];
}

export interface CoverageResponse {
  generatedAt: string;
  matters: MatterCoverage[];
  /** Queued/running jobs plus failures from the last 24 hours, newest first. */
  jobs: CoverageJob[];
  totals: { matters: number; sources: number; enabledSources: number; running: number; queued: number; failed: number; needsKey: number };
  /** Provider keys that gate sources (names only, never values). */
  keys: { news: boolean; courtListener: boolean };
  /** The caller sees only some of the firm's matters. */
  restricted: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export const SOURCE_STATE_LABEL: Record<CoverageSourceState, string> = { running: "Running", queued: "Queued", failed: "Failed", needs_key: "Needs API key", disabled: "Off", idle: "Idle" };

export const SOURCE_STATE_TONE: Record<CoverageSourceState, "primary" | "muted" | "destructive" | "warning"> = { running: "primary", queued: "muted", failed: "destructive", needs_key: "warning", disabled: "muted", idle: "muted" };

export const ORIGIN_LABEL: Record<PlanOrigin, string> = { matter_record: "From matter record", model: "Suggested search", rule: "From matter record" };

/** Record-derived facts vs. model-suggested wording: only these two are shown to the user. */
/** Only values copied from the matter record are "record"; any generated wording (model or rules) is a suggestion to check. */
export function originKind(origin: PlanOrigin): "record" | "suggested" {
  return origin === "matter_record" ? "record" : "suggested";
}

export const SEARCH_KIND_LABEL: Record<ConfiguredSearch["kind"], string> = { query: "Query", docket: "Docket", judge: "Judge", court: "Court", product: "Product", mdl: "MDL", cfr: "CFR", target: "Target" };

/** Is any job still moving? Polling runs only while this is true. */
export function hasActiveJobs(jobs: Pick<CoverageJob, "status">[]): boolean {
  return jobs.some((j) => j.status === "queued" || j.status === "running");
}

/** The one row the collapsed activity line shows: a running job first, then queued, then the newest failure. */
export function headlineJob<T extends Pick<CoverageJob, "status" | "updatedAt">>(jobs: T[]): T | undefined {
  const by = (s: CoverageJob["status"][]) => jobs.filter((j) => s.includes(j.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return by(["running"]) ?? by(["queued"]) ?? by(["failed", "escalated"]);
}

/** "12s", "4m 05s", "1h 12m". */
export function fmtElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Plan rows for one matter, flattened for display: each search with its category and origin ("unspecified" when the contract does not say). */
export interface PlanItem { category: string; text: string; origin: "record" | "suggested" | "unspecified" }

export function planItems(plan: MatterIntelPlan): PlanItem[] {
  const q = (category: string, list: PlannedQuery[]) => list.map((x) => ({ category, text: x.text, origin: originKind(x.origin) }));
  const facts = (category: string, list: string[]) => list.map((text) => ({ category, text, origin: "record" as const }));
  return [
    ...facts("Docket", plan.dockets),
    ...facts("MDL", plan.mdls),
    ...facts("Judge", plan.judges),
    ...facts("Court", plan.courts),
    ...q("Case law", plan.caseLaw),
    ...q("Regulatory", plan.regulatory),
    ...q("Statute", plan.statutes),
    ...facts("Product", plan.products),
    ...q("News", plan.news),
    ...(plan.cfrSections ?? []).map((c) => ({ category: "CFR", text: `${c.title} CFR ${c.section}`, origin: "unspecified" as const })),
  ];
}

/** Source changes that touch a matter (an apply is described per matter in the dry run). */
export function changesForMatter(changes: SourceChange[], matterId: string): SourceChange[] {
  return changes.filter((c) => c.matterIds.includes(matterId));
}

/** Does a dry-run change anything? */
export function changeIsEffective(c: Pick<SourceChange, "added" | "enabledBefore" | "enabledAfter">): boolean {
  return c.added.length > 0 || c.enabledBefore !== c.enabledAfter;
}
