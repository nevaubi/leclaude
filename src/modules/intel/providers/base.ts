import "server-only";
import { fetchCached, memoryHttpCache, rateLimiter, TokenBucket, type HttpCacheStore } from "@/lib/ai/toolkit/http";
import type { IntelErrorCode } from "../types";

/**
 * Shared plumbing for every intelligence provider: a 24h response cache, a
 * per-provider token bucket, request timeouts and structured errors. Provider
 * methods only ever throw ProviderError; raw fetch/JSON errors are mapped.
 */
export type ProviderErrorCode = "not_configured" | "rate_limited" | "network" | "parse" | "http" | "timeout";

export class ProviderError extends Error {
  readonly name = "ProviderError";
  constructor(
    public readonly provider: string,
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly url?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
  toJSON() {
    return { provider: this.provider, code: this.code, message: this.message, retryable: this.retryable, status: this.status, url: this.url, retryAfterMs: this.retryAfterMs };
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return Boolean(e) && typeof e === "object" && (e as { name?: string }).name === "ProviderError";
}

/** ProviderError code → the job/steward error code. */
export function toIntelErrorCode(e: unknown): IntelErrorCode {
  if (isProviderError(e)) return e.code === "http" ? "network" : e.code;
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/AbortError|timed? ?out|ETIMEDOUT/i.test(msg)) return "timeout";
  if (/429|rate.?limit|too many requests/i.test(msg)) return "rate_limited";
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket hang up/i.test(msg)) return "network";
  if (/not configured|API key|missing key/i.test(msg)) return "not_configured";
  if (/JSON|Unexpected token|parse/i.test(msg)) return "parse";
  return "unknown";
}

/** Wrap any thrown value as a ProviderError (never lets raw errors escape). */
export function asProviderError(provider: string, e: unknown, url?: string): ProviderError {
  if (isProviderError(e)) return e;
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const msg = err?.message ?? String(e);
  if (err?.name === "AbortError" || /aborted|timed? ?out/i.test(msg)) return new ProviderError(provider, "timeout", `${provider}: request timed out`, true, undefined, url);
  const cause = err?.cause?.code ?? err?.cause?.message ?? "";
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket|network/i.test(`${msg} ${cause}`)) return new ProviderError(provider, "network", `${provider}: ${msg}${cause ? ` (${cause})` : ""}`, true, undefined, url);
  if (/JSON|Unexpected token|Unexpected end/i.test(msg)) return new ProviderError(provider, "parse", `${provider}: could not parse response (${msg})`, false, undefined, url);
  return new ProviderError(provider, "network", `${provider}: ${msg}`, true, undefined, url);
}

export interface ProviderClientOptions {
  name: string;
  /** Requests per second and burst. */
  rps: number;
  burst: number;
  timeoutMs?: number;
  /** Default cache TTL; individual calls may override. */
  ttlMs?: number;
  cache?: HttpCacheStore;
  fetchImpl?: typeof fetch;
  /** Maximum time to wait for a rate-limit token before failing with rate_limited. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  limiter?: TokenBucket;
  offline?: boolean;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  ttlMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBytes?: number;
  /** Treat these statuses as retryable http errors (default 5xx + 408 + 429). */
  retryableStatuses?: number[];
}

export interface TextResponse { text: string; status: number; contentType: string; finalUrl: string; cached: boolean; fetchedAt: string }

/**
 * A rate-limited, cached HTTP client for one provider. `getJSON`/`postJSON`
 * parse JSON and map errors; `getText` returns the decoded body.
 */
export class ProviderClient {
  readonly name: string;
  readonly limiter: TokenBucket;
  private readonly cache: HttpCacheStore;
  private readonly fetchImpl?: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly maxWaitMs: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly offline: boolean;
  /** Counters for diagnostics/tests. */
  readonly stats = { requests: 0, cached: 0, errors: 0, rateLimited: 0 };

  constructor(opts: ProviderClientOptions) {
    this.name = opts.name;
    this.limiter = opts.limiter ?? rateLimiter(`intel:${opts.name}`, { capacity: opts.burst, refillPerSecond: opts.rps });
    this.cache = opts.cache ?? memoryHttpCache(100);
    this.fetchImpl = opts.fetchImpl;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.ttlMs = opts.ttlMs ?? 24 * 3600_000;
    this.maxWaitMs = opts.maxWaitMs ?? 8_000;
    this.sleep = opts.sleep;
    this.offline = opts.offline ?? false;
  }

  private async acquire(url: string) {
    const ok = await this.limiter.take(this.maxWaitMs, this.sleep);
    if (!ok) {
      this.stats.rateLimited++;
      throw new ProviderError(this.name, "rate_limited", `${this.name}: local rate limit reached (${this.limiter.refillPerSecond}/s)`, true, undefined, url, this.limiter.msUntil(1));
    }
  }

  private mapStatus(status: number, url: string, retryable?: number[], retryAfter?: string): ProviderError | null {
    if (status >= 200 && status < 300) return null;
    if (status === 429) {
      const ms = retryAfter ? Number(retryAfter) * 1000 : undefined;
      return new ProviderError(this.name, "rate_limited", `${this.name}: rate limited by the provider (429)`, true, status, url, Number.isFinite(ms) ? ms : undefined);
    }
    if (status === 401 || status === 403) return new ProviderError(this.name, "not_configured", `${this.name}: authentication failed (${status}); check the API key`, false, status, url);
    const retry = retryable ? retryable.includes(status) : status >= 500 || status === 408;
    return new ProviderError(this.name, "http", `${this.name}: HTTP ${status}${status === 404 ? " (not found)" : ""}`, retry, status, url);
  }

  async request(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, opts: RequestOptions = {}): Promise<TextResponse> {
    if (this.offline) throw new ProviderError(this.name, "not_configured", `${this.name}: outbound network is disabled (INTEL_OFFLINE)`, false, undefined, url);
    const ttl = opts.ttlMs ?? this.ttlMs;
    // Cached responses do not consume rate-limit tokens: peek first through fetchCached's cache by doing a dry lookup.
    const cacheOnly = await this.peek(url, init, ttl);
    if (cacheOnly) { this.stats.cached++; return cacheOnly; }
    await this.acquire(url);
    this.stats.requests++;
    try {
      const res = await fetchCached(url, {
        method: init.method ?? "GET",
        body: init.body,
        headers: { ...(init.headers ?? {}), ...(opts.headers ?? {}) },
        ttlMs: ttl,
        cache: this.cache,
        fetchImpl: this.fetchImpl,
        timeoutMs: opts.timeoutMs ?? this.timeoutMs,
        maxBytes: opts.maxBytes,
        signal: opts.signal,
      });
      const err = this.mapStatus(res.status, url, opts.retryableStatuses, res.headers?.["retry-after"]);
      if (err) { this.stats.errors++; throw err; }
      return { text: res.body, status: res.status, contentType: res.contentType, finalUrl: res.finalUrl, cached: res.cached, fetchedAt: res.fetchedAt };
    } catch (e) {
      if (!isProviderError(e)) this.stats.errors++;
      throw asProviderError(this.name, e, url);
    }
  }

  private async peek(url: string, init: { method?: string; body?: string }, ttl: number): Promise<TextResponse | null> {
    if (ttl <= 0) return null;
    const { httpCacheKey } = await import("@/lib/ai/toolkit/http");
    const hit = this.cache.get(httpCacheKey(init.method ?? "GET", url, init.body));
    return hit ? { text: hit.body, status: hit.status, contentType: hit.contentType, finalUrl: hit.finalUrl, cached: true, fetchedAt: hit.fetchedAt } : null;
  }

  async getText(url: string, opts: RequestOptions = {}): Promise<TextResponse> {
    return this.request(url, { method: "GET" }, opts);
  }

  async getJSON<T>(url: string, opts: RequestOptions = {}): Promise<T & { __cached?: boolean }> {
    const res = await this.request(url, { method: "GET", headers: { Accept: "application/json" } }, opts);
    return this.parse<T>(res, url);
  }

  async postJSON<T>(url: string, body: unknown, opts: RequestOptions = {}): Promise<T & { __cached?: boolean }> {
    const res = await this.request(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Accept: "application/json" } }, opts);
    return this.parse<T>(res, url);
  }

  async postForm<T>(url: string, form: Record<string, string>, opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(url, { method: "POST", body: new URLSearchParams(form).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" } }, opts);
    return this.parse<T>(res, url);
  }

  private parse<T>(res: TextResponse, url: string): T & { __cached?: boolean } {
    try {
      const data = JSON.parse(res.text) as T & { __cached?: boolean };
      if (data && typeof data === "object") Object.defineProperty(data, "__cached", { value: res.cached, enumerable: false });
      return data;
    } catch (e) {
      this.stats.errors++;
      throw new ProviderError(this.name, "parse", `${this.name}: invalid JSON (${(e as Error).message.slice(0, 80)})`, false, res.status, url);
    }
  }

  /** HEAD-style reachability check (falls back to GET with a small byte cap). Returns the status, never throws on HTTP errors. */
  async probe(url: string, opts: RequestOptions = {}): Promise<{ status: number; ok: boolean; finalUrl: string; error?: string }> {
    if (this.offline) return { status: 0, ok: false, finalUrl: url, error: "offline" };
    await this.acquire(url);
    this.stats.requests++;
    const doFetch = this.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8_000);
    try {
      let res = await doFetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "LeClaude/1.0 (+internal legal research platform)" } });
      if (res.status === 405 || res.status === 403 || res.status === 501) res = await doFetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { Range: "bytes=0-1024", "User-Agent": "LeClaude/1.0 (+internal legal research platform)" } });
      return { status: res.status, ok: res.ok, finalUrl: res.url || url };
    } catch (e) {
      return { status: 0, ok: false, finalUrl: url, error: asProviderError(this.name, e, url).message };
    } finally { clearTimeout(t); }
  }
}

/** Shape shared by provider factories so adapters and tests can inject fakes. */
export interface ProviderFactoryOptions {
  cache?: HttpCacheStore;
  fetchImpl?: typeof fetch;
  offline?: boolean;
  limiter?: TokenBucket;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  env?: Partial<Record<ProviderEnvKey, string | undefined>>;
}

export type ProviderEnvKey = "COURTLISTENER_API_TOKEN" | "GOVINFO_API_KEY" | "FIRECRAWL_API_KEY" | "TAVILY_API_KEY" | "OPENFDA_API_KEY";

export function envValue(opts: ProviderFactoryOptions | undefined, key: ProviderEnvKey): string | undefined {
  if (opts?.env && key in opts.env) { const v = opts.env[key]; return v && v.trim() ? v.trim() : undefined; }
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function clip(s: string | undefined | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "\n…[truncated]" : s;
}

export function daysAgoISO(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10);
}
