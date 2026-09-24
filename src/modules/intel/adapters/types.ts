import "server-only";
import type { Matter } from "@/lib/types/domain";
import type { IntelProviders } from "../providers";
import { isProviderError, toIntelErrorCode } from "../providers/base";
import type { IntelDocumentInput, UpsertResult } from "../store";
import type { AdapterError, AdapterResult, IntelAdapterId, IntelDocument, IntelDocumentKind, IntelProviderStatus, IntelScope, IntelSource, IntelWatch } from "../types";

/**
 * The adapter contract. An adapter maps one provider (or a folder of files)
 * onto IntelDocuments through `ctx.ingest`, records per-item failures with
 * `ctx.attempt`/`ctx.fail` and returns counters. It never throws for routine
 * failures; a thrown error is treated as fatal for the run.
 */
export interface AdapterLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export type IngestInput = Omit<IntelDocumentInput, "sourceId" | "adapter"> & { sourceId?: string; adapter?: IntelAdapterId };

export interface AdapterContext<C = Record<string, unknown>> {
  source: IntelSource;
  config: C;
  scope: IntelScope;
  /** ISO date (YYYY-MM-DD) the incremental window starts at, when the source ran successfully before. */
  since?: string;
  cursor?: string;
  now: Date;
  providers: IntelProviders;
  log: AdapterLogger;
  signal?: AbortSignal;
  /** Matters in scope (scope.matterIds, else all active matters). */
  matters: Matter[];
  watches: IntelWatch[];
  limits: { maxDocs: number; maxTextChars: number };
  embed: boolean;
  chunkSize?: number;
  /** Mutable counters for this run. */
  result: AdapterResult;
  /** Upsert + index a document; counts added/updated/unchanged. Throws when the document budget is exhausted. */
  ingest(input: IngestInput): Promise<UpsertResult & { chunks: number }>;
  /** Run a step; on failure record a (non-fatal by default) error and return undefined. */
  attempt<T>(label: string, fn: () => Promise<T>, opts?: { fatal?: boolean; provider?: string }): Promise<T | undefined>;
  /** Record an error without throwing. */
  fail(e: unknown, opts?: { fatal?: boolean; provider?: string; label?: string }): AdapterError;
  note(msg: string): void;
  existing(externalId: string): IntelDocument | null;
  /** Documents still allowed in this run. */
  budgetLeft(): number;
}

interface SafeParseLike<C> {
  success: boolean;
  data?: C;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}

/** Structural view of a zod schema so adapters can use any zod version without type gymnastics. */
export interface ConfigSchema<C> {
  parse(value: unknown): C;
  safeParse(value: unknown): SafeParseLike<C>;
}

export interface IntelAdapter<C = Record<string, unknown>> {
  id: IntelAdapterId;
  name: string;
  description: string;
  kinds: IntelDocumentKind[];
  /** Provider family for concurrency: at most one job per family runs at a time. */
  family: string;
  /** Providers the adapter needs; a source is "not configured" when one is missing. */
  requires: IntelProviderStatus["id"][];
  configSchema: ConfigSchema<C>;
  defaults: C;
  run(ctx: AdapterContext<C>): Promise<AdapterResult | void>;
}

export function defineAdapter<C>(adapter: IntelAdapter<C>): IntelAdapter<C> {
  return adapter;
}

export class BudgetExhausted extends Error {
  constructor() { super("document budget for this run is exhausted"); this.name = "BudgetExhausted"; }
}

/** Map any thrown value to an AdapterError. */
export function errorFrom(e: unknown, extra: { fatal?: boolean; provider?: string; label?: string } = {}): AdapterError {
  const at = new Date().toISOString();
  if (isProviderError(e)) {
    const code = e.code === "http" ? "network" : e.code;
    return { code, message: extra.label ? `${extra.label}: ${e.message}` : e.message, retryable: e.retryable, fatal: extra.fatal ?? false, provider: extra.provider ?? e.provider, at, data: { status: e.status, url: e.url, retryAfterMs: e.retryAfterMs } };
  }
  const code = toIntelErrorCode(e);
  const message = e instanceof Error ? e.message : String(e);
  const retryable = code === "network" || code === "timeout" || code === "rate_limited";
  return { code, message: extra.label ? `${extra.label}: ${message}` : message, retryable, fatal: extra.fatal ?? false, provider: extra.provider, at };
}

export function emptyResult(): AdapterResult {
  return { added: 0, updated: 0, skipped: 0, errors: [], notes: [], docIds: [], chunks: 0 };
}
