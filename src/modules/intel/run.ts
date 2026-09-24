import "server-only";
import { db } from "@/lib/db";
import type { Matter } from "@/lib/types/domain";
import { aiConfig } from "@/lib/ai/config";
import { getAdapter } from "./adapters";
import { BudgetExhausted, emptyResult, errorFrom, type AdapterContext, type AdapterLogger, type IngestInput, type IntelAdapter } from "./adapters/types";
import { defaultProviders, type IntelProviders } from "./providers";
import { findByExternalId, ingestDocument, intelWatches } from "./store";
import type { AdapterResult, IntelJobLogLine, IntelSource } from "./types";

export interface RunSourceOptions {
  providers?: IntelProviders;
  since?: string;
  signal?: AbortSignal;
  embed?: boolean;
  log?: (line: IntelJobLogLine) => void;
  now?: Date;
  maxDocs?: number;
  chunkSize?: number;
  /** Override the registered adapter (tests). */
  adapter?: IntelAdapter<Record<string, unknown>>;
  /** Extra config merged over the source config for this run (steward "narrow_query"). */
  configOverride?: Record<string, unknown>;
}

const DEFAULT_MAX_DOCS = 400;
const DEFAULT_MAX_TEXT = 400_000;

/** Incremental window start: two days before the last success, so late-arriving records are not missed. */
export function sinceFor(source: IntelSource, now = new Date()): string | undefined {
  const last = source.health.lastSuccessAt;
  if (!last) return undefined;
  const t = new Date(last).getTime() - 2 * 86400_000;
  if (!Number.isFinite(t) || t > now.getTime()) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

/** Validate config, build the context and run the source's adapter. Never throws: fatal errors land in `result.errors`. */
export async function runSource(source: IntelSource, opts: RunSourceOptions = {}): Promise<AdapterResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const logger = makeLogger(opts.log);
  const adapter = opts.adapter ?? (getAdapter(source.adapter) as IntelAdapter<Record<string, unknown>> | null);
  if (!adapter) {
    result.errors.push({ code: "schema_drift", message: `Unknown adapter "${source.adapter}"`, retryable: false, fatal: true, at: now.toISOString() });
    result.durationMs = Date.now() - started;
    return result;
  }
  const parsed = adapter.configSchema.safeParse({ ...adapter.defaults, ...(source.config ?? {}), ...(opts.configOverride ?? {}) });
  if (!parsed.success || parsed.data === undefined) {
    const issues = parsed.error?.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ") ?? "invalid";
    result.errors.push({ code: "parse", message: `Invalid source configuration: ${issues}`, retryable: false, fatal: true, at: now.toISOString() });
    result.durationMs = Date.now() - started;
    return result;
  }
  const d = db();
  const scope = source.scope ?? {};
  const matters: Matter[] = scope.matterIds?.length ? scope.matterIds.map((id) => d.matters.get(id)).filter((m): m is Matter => Boolean(m)) : d.matters.find((m) => m.status === "active");
  const maxDocs = opts.maxDocs ?? DEFAULT_MAX_DOCS;
  let touched = 0;
  const embed = opts.embed ?? aiConfig().hasKey;

  const ctx: AdapterContext<Record<string, unknown>> = {
    source,
    config: parsed.data,
    scope,
    since: opts.since ?? sinceFor(source, now),
    cursor: source.cursor,
    now,
    providers: opts.providers ?? defaultProviders(),
    log: logger,
    signal: opts.signal,
    matters,
    watches: intelWatches().all(),
    limits: { maxDocs, maxTextChars: DEFAULT_MAX_TEXT },
    embed,
    chunkSize: opts.chunkSize,
    result,
    async ingest(input: IngestInput) {
      if (touched >= maxDocs) throw new BudgetExhausted();
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      touched++;
      const r = await ingestDocument({ ...input, sourceId: input.sourceId ?? source.id, adapter: input.adapter ?? source.adapter, text: (input.text ?? "").slice(0, DEFAULT_MAX_TEXT) }, { embed, chunkSize: opts.chunkSize, now });
      if (r.status === "added") result.added++; else if (r.status === "updated") result.updated++; else result.skipped++;
      result.chunks = (result.chunks ?? 0) + (r.textChanged ? r.chunks : 0);
      if ((result.docIds?.length ?? 0) < 500) result.docIds!.push(r.doc.id);
      return r;
    },
    async attempt(label, fn, o = {}) {
      try { return await fn(); } catch (e) {
        if (e instanceof BudgetExhausted) { ctx.note(`Document budget (${maxDocs}) reached; remaining items deferred to the next run.`); return undefined; }
        if ((e as Error)?.name === "AbortError") throw e;
        const err = errorFrom(e, { fatal: o.fatal, provider: o.provider, label });
        result.errors.push(err);
        logger.warn(`${label} failed: ${err.message}`, { code: err.code, retryable: err.retryable });
        return undefined;
      }
    },
    fail(e, o = {}) {
      const err = errorFrom(e, o);
      result.errors.push(err);
      logger.warn(`${o.label ?? "step"} failed: ${err.message}`, { code: err.code });
      return err;
    },
    note(msg) { if (!result.notes!.includes(msg)) result.notes!.push(msg); logger.info(msg); },
    existing(externalId) { return findByExternalId(source.adapter, externalId); },
    budgetLeft() { return Math.max(0, maxDocs - touched); },
  };

  try {
    logger.info(`Running ${adapter.name}`, { source: source.id, since: ctx.since, matters: matters.length });
    const r = await adapter.run(ctx);
    if (r && r !== result) {
      result.added += r.added; result.updated += r.updated; result.skipped += r.skipped;
      result.errors.push(...r.errors);
      for (const n of r.notes ?? []) ctx.note(n);
      if (r.nextCursor) result.nextCursor = r.nextCursor;
    }
  } catch (e) {
    if (e instanceof BudgetExhausted) ctx.note(`Document budget (${maxDocs}) reached; remaining items deferred to the next run.`);
    else if ((e as Error)?.name === "AbortError") result.errors.push({ code: "cancelled", message: "Run cancelled", retryable: true, fatal: true, at: new Date().toISOString() });
    else { const err = errorFrom(e, { fatal: true, label: adapter.name }); result.errors.push(err); logger.error(`Run failed: ${err.message}`, { code: err.code }); }
  }
  result.errors = result.errors.slice(0, 50);
  result.durationMs = Date.now() - started;
  logger.info(`Finished: ${result.added} added, ${result.updated} updated, ${result.skipped} unchanged, ${result.errors.length} error(s)`, { durationMs: result.durationMs });
  return result;
}

/** A run failed when any error is fatal, or when nothing was processed and the errors are not merely "not configured". */
export function runFailed(result: AdapterResult): { failed: boolean; error?: AdapterResult["errors"][number] } {
  const fatal = result.errors.find((e) => e.fatal);
  if (fatal) return { failed: true, error: fatal };
  const processed = result.added + result.updated + result.skipped;
  if (processed === 0 && result.errors.length && !result.errors.every((e) => e.code === "not_configured")) {
    const err = result.errors.find((e) => e.retryable) ?? result.errors[0];
    return { failed: true, error: err };
  }
  return { failed: false };
}

function makeLogger(sink?: (line: IntelJobLogLine) => void): AdapterLogger {
  const emit = (level: IntelJobLogLine["level"], msg: string, data?: Record<string, unknown>) => { sink?.({ at: new Date().toISOString(), level, msg, data }); };
  return { debug: (m, d) => emit("debug", m, d), info: (m, d) => emit("info", m, d), warn: (m, d) => emit("warn", m, d), error: (m, d) => emit("error", m, d) };
}
