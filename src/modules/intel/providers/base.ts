import "server-only";
import { fetchCached, memoryHttpCache, rateLimiter, TokenBucket, type HttpCacheStore } from "@/lib/ai/toolkit/http";
import { redactSecrets } from "@/lib/net/redact";
import { isSafeFetchError, safeFetch, type EgressPolicy } from "@/lib/net/safe-fetch";
import type { IntelErrorCode } from "../types";

/**
 * Shared plumbing for every intelligence provider: a 24h response cache, a
 * per-provider token bucket, request timeouts, structured errors and a
 * per-provider egress policy (host allowlist) enforced by `safeFetch`.
 * Provider methods only ever throw ProviderError; raw fetch/JSON errors are
 * mapped, and URLs recorded on errors are redacted (query-string keys).
 */
export type ProviderErrorCode = "not_configured" | "rate_limited" | "network" | "parse" | "http" | "timeout";

export class ProviderError extends Error {
  readonly name = "ProviderError";
  readonly url?: string;
  constructor(
    public readonly provider: string,
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    url?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(redactSecrets(message));
    this.url = url ? redactSecrets(url) : undefined;
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
  if (isSafeFetchError(e)) {
    if (e.code === "timeout") return "timeout";
    if (e.code === "network" || e.code === "dns") return "network";
    if (e.code === "aborted") return "cancelled";
    if (e.code === "body_too_large" || e.code === "bad_redirect" || e.code === "too_many_redirects" || e.code === "invalid_url") return "parse";
    return "not_configured"; // egress policy denial: needs an allowlist change, never a retry
  }
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/AbortError|timed? ?out|ETIMEDOUT/i.test(msg)) return "timeout";
  if (/429|rate.?limit|too many requests/i.test(msg)) return "rate_limited";
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket hang up/i.test(msg)) return "network";
  if (/not configured|API key|missing key|egress policy|blocked/i.test(msg)) return "not_configured";
  if (/JSON|Unexpected token|parse/i.test(msg)) return "parse";
  return "unknown";
}

/** Wrap any thrown value as a ProviderError (never lets raw errors escape). */
export function asProviderError(provider: string, e: unknown, url?: string): ProviderError {
  if (isProviderError(e)) return e;
  if (isSafeFetchError(e)) {
    const at = e.url ?? url;
    switch (e.code) {
      case "timeout": return new ProviderError(provider, "timeout", `${provider}: request timed out`, true, undefined, at);
      case "aborted": return new ProviderError(provider, "timeout", `${provider}: request aborted`, true, undefined, at);
      case "network":
      case "dns": return new ProviderError(provider, "network", `${provider}: ${e.message}`, e.retryable, undefined, at);
      case "body_too_large":
      case "too_many_redirects":
      case "bad_redirect":
      case "invalid_url": return new ProviderError(provider, "parse", `${provider}: ${e.message}`, false, undefined, at);
      default: return new ProviderError(provider, "not_configured", `${provider}: outbound request blocked by the egress policy (${e.message})`, false, undefined, at);
    }
  }
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const msg = err?.message ?? String(e);
  if (err?.name === "AbortError" || /aborted|timed? ?out/i.test(msg)) return new ProviderError(provider, "timeout", `${provider}: request timed out`, true, undefined, url);
  const cause = err?.cause?.code ?? err?.cause?.message ?? "";
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket|network/i.test(`${msg} ${cause}`)) return new ProviderError(provider, "network", `${provider}: ${msg}${cause ? ` (${cause})` : ""}`, true, undefined, url);
  if (/JSON|Unexpected token|Unexpected end/i.test(msg)) return new ProviderError(provider, "parse", `${provider}: could not parse response (${msg})`, false, undefined, url);
  return new ProviderError(provider, "network", `${provider}: ${msg}`, true, undefined, url);
}

// ---------------------------------------------------------------------------
// Egress policies (CLAUDE.md §41, §53.1): each provider may only talk to its own hosts.
// The open-web provider has no host allowlist but still gets the private-address, redirect,
// byte and timeout rules; NET_ALLOW_HOSTS / NET_DENY_HOSTS narrow everything further.
// ---------------------------------------------------------------------------

export const PROVIDER_EGRESS: Record<string, EgressPolicy> = {
  courtlistener: { name: "courtlistener", allowHosts: ["courtlistener.com"] },
  ecfr: { name: "ecfr", allowHosts: ["ecfr.gov"] },
  "federal-register": { name: "federal-register", allowHosts: ["federalregister.gov", "govinfo.gov"] },
  govinfo: { name: "govinfo", allowHosts: ["govinfo.gov"] },
  openfda: { name: "openfda", allowHosts: ["fda.gov"] },
  firecrawl: { name: "firecrawl", allowHosts: ["firecrawl.dev"] },
  tavily: { name: "tavily", allowHosts: ["tavily.com"] },
  jpml: { name: "jpml", allowHosts: ["uscourts.gov"] },
  web: { name: "web" },
};

/** The egress policy for a provider name (an unknown name gets an open policy labelled with the name). */
export function providerEgress(name: string, extra: Partial<EgressPolicy> = {}): EgressPolicy {
  return { ...(PROVIDER_EGRESS[name] ?? { name }), ...extra };
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
  /** Egress policy; defaults to `providerEgress(name)`. */
  egress?: EgressPolicy;
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

export interface TextResponse { text: string; status: number; contentType: string; finalUrl: string; cached: boolean; fetchedAt: string; truncated?: boolean }

/**
 * A rate-limited, cached HTTP client for one provider. `getJSON`/`postJSON`
 * parse JSON and map errors; `getText` returns the decoded body.
 */
/** Longest provider-requested wait (Retry-After) the client sleeps through before retrying a 429 once. */
const MAX_429_WAIT_MS = 20_000;

export class ProviderClient {
  readonly name: string;
  readonly limiter: TokenBucket;
  readonly egress: EgressPolicy;
  readonly fetchImpl?: typeof fetch;
  readonly offline: boolean;
  private readonly cache: HttpCacheStore;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly maxWaitMs: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  /** Counters for diagnostics/tests. */
  readonly stats = { requests: 0, cached: 0, errors: 0, rateLimited: 0, blocked: 0 };

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
    this.egress = opts.egress ?? providerEgress(opts.name);
  }

  /** Take a rate-limit token or fail with rate_limited (exposed for callers that fetch binary bodies themselves). */
  async acquire(url: string) {
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

  /** Map a thrown value to a ProviderError for this provider (counts policy denials). */
  wrapError(e: unknown, url?: string): ProviderError {
    if (isSafeFetchError(e) && e.code !== "timeout" && e.code !== "aborted" && e.code !== "network" && e.code !== "dns") this.stats.blocked++;
    return asProviderError(this.name, e, url);
  }

  async request(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, opts: RequestOptions = {}): Promise<TextResponse> {
    try {
      return await this.requestOnce(url, init, opts);
    } catch (e) {
      // One retry after a provider 429 when the wait it asks for is short (default 5s); longer waits surface as rate_limited.
      if (!isProviderError(e) || e.code !== "rate_limited" || e.status !== 429 || opts.signal?.aborted) throw e;
      const wait = e.retryAfterMs ?? 5_000;
      if (!(wait >= 0 && wait <= MAX_429_WAIT_MS)) throw e;
      await (this.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
      if (opts.signal?.aborted) throw e;
      return this.requestOnce(url, init, opts);
    }
  }

  private async requestOnce(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, opts: RequestOptions = {}): Promise<TextResponse> {
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
        egress: this.egress,
      });
      const err = this.mapStatus(res.status, url, opts.retryableStatuses, res.headers?.["retry-after"]);
      if (err) { this.stats.errors++; throw err; }
      return { text: res.body, status: res.status, contentType: res.contentType, finalUrl: res.finalUrl, cached: res.cached, fetchedAt: res.fetchedAt, truncated: res.truncated };
    } catch (e) {
      if (!isProviderError(e)) this.stats.errors++;
      throw this.wrapError(e, url);
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
      throw new ProviderError(this.name, "parse", `${this.name}: invalid JSON (${(e as Error).message.slice(0, 80)})${res.truncated ? " — response was truncated at the byte limit" : ""}`, false, res.status, url);
    }
  }

  /** HEAD-style reachability check (falls back to GET with a small byte cap). Returns the status, never throws on HTTP errors. */
  async probe(url: string, opts: RequestOptions = {}): Promise<{ status: number; ok: boolean; finalUrl: string; error?: string }> {
    if (this.offline) return { status: 0, ok: false, finalUrl: url, error: "offline" };
    await this.acquire(url);
    this.stats.requests++;
    const policy: EgressPolicy = { ...this.egress, timeoutMs: opts.timeoutMs ?? 8_000, maxBytes: 4_096, onLimit: "truncate" };
    const headers = { "User-Agent": "LeClaude/1.0 (+internal legal research platform)" };
    try {
      let res = await safeFetch(url, { method: "HEAD", headers, signal: opts.signal, fetchImpl: this.fetchImpl }, policy);
      if (res.status === 405 || res.status === 403 || res.status === 501) res = await safeFetch(url, { method: "GET", headers: { ...headers, Range: "bytes=0-1024" }, signal: opts.signal, fetchImpl: this.fetchImpl }, policy);
      return { status: res.status, ok: res.ok, finalUrl: res.finalUrl || url };
    } catch (e) {
      return { status: 0, ok: false, finalUrl: url, error: this.wrapError(e, url).message };
    }
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
