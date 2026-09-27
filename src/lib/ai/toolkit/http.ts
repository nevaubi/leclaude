import "server-only";
import { keyFor, sharedRateLimiter } from "@/lib/net/rate-limit";
import { safeFetch, type EgressPolicy, type SafeFetchInit } from "@/lib/net/safe-fetch";

/**
 * Every helper here goes through `safeFetch` (src/lib/net/safe-fetch.ts):
 * HTTP/S only, private/loopback/link-local targets rejected, redirects
 * validated hop by hop, byte limits, timeouts and cancellation, plus the
 * NET_* environment allow/deny lists. Policy denials surface as
 * `SafeFetchError` (never retried); HTTP errors as `HttpError`.
 */
export class HttpError extends Error {
  constructor(public status: number, message: string, public url: string) { super(message); this.name = "HttpError"; }
}

const UA = "LeClaude/1.0 (+internal legal research platform)";
const ACCEPT_TEXT = "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.8";

export interface FetchOptions {
  method?: string;
  headers?: HeadersInit;
  body?: SafeFetchInit["body"];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  /** Egress policy for this call (host allowlist, byte limit, label); the NET_* environment rules always apply on top. */
  egress?: EgressPolicy;
  /** Injectable transport (tests, proxy-aware clients). */
  fetchImpl?: typeof fetch;
  /** How long to wait for the per-host token bucket (default 4 s; 0 fails immediately). */
  rateLimitWaitMs?: number;
}

function headersObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) { h.forEach((v, k) => { out[k] = v; }); return out; }
  if (Array.isArray(h)) { for (const [k, v] of h) out[k] = v; return out; }
  return { ...h };
}

/** Per-host token bucket shared by the generic helpers (providers carry their own buckets in ProviderClient). */
async function throttleHost(url: string, waitMs: number, signal?: AbortSignal): Promise<void> {
  let host = "";
  try { host = new URL(url).host; } catch { return; }
  const d = await sharedRateLimiter().acquire(keyFor("host", host), { maxWaitMs: waitMs, signal });
  if (!d.ok) throw new HttpError(429, `Local rate limit reached for ${host}; retry in ${Math.ceil(d.retryAfterMs / 1000)}s`, url);
}

function policyFor(init: FetchOptions, defaults: { maxBytes: number; onLimit: EgressPolicy["onLimit"] }): EgressPolicy {
  return { ...(init.egress ?? {}), timeoutMs: init.timeoutMs ?? init.egress?.timeoutMs ?? 20_000, maxBytes: init.maxBytes ?? init.egress?.maxBytes ?? defaults.maxBytes, onLimit: init.egress?.onLimit ?? defaults.onLimit };
}

/** JSON request through the egress policy. Throws HttpError on non-2xx and SafeFetchError on policy denials or transport failures. */
export async function fetchJSON<T = unknown>(url: string, init: FetchOptions = {}): Promise<T> {
  await throttleHost(url, init.rateLimitWaitMs ?? 4_000, init.signal);
  const res = await safeFetch(url, { method: init.method, body: init.body, signal: init.signal, fetchImpl: init.fetchImpl, headers: { Accept: "application/json", "User-Agent": UA, ...headersObject(init.headers) } }, policyFor(init, { maxBytes: 8 * 1024 * 1024, onLimit: "abort" }));
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}`, url);
  return res.json<T>();
}

/** Text request through the egress policy; bodies above `maxBytes` (default 2.5 MB) are truncated and flagged. */
export async function fetchText(url: string, init: FetchOptions = {}): Promise<{ text: string; contentType: string; status: number; finalUrl: string; truncated: boolean; bytes: number }> {
  await throttleHost(url, init.rateLimitWaitMs ?? 4_000, init.signal);
  const res = await safeFetch(url, { method: init.method, body: init.body, signal: init.signal, fetchImpl: init.fetchImpl, headers: { "User-Agent": UA, Accept: ACCEPT_TEXT, ...headersObject(init.headers) } }, policyFor(init, { maxBytes: 2_500_000, onLimit: "truncate" }));
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}`, url);
  return { text: res.text(), contentType: res.contentType, status: res.status, finalUrl: res.finalUrl, truncated: res.truncated, bytes: res.bytes };
}

/** Lightweight HTML → readable text (no DOM dependency). */
export function htmlToText(html: string, opts: { maxChars?: number } = {}): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside|header)[\s\S]*?<\/\1>/gi, " ");
  // Prefer <main>/<article> when present.
  const main = s.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (main && main.replace(/<[^>]+>/g, "").trim().length > 400) s = main;
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|table|thead|tbody|dd|dt)>/gi, "\n")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<td[^>]*>|<th[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s).replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").replace(/^[ \t]+|[ \t]+$/gm, "").trim();
  const max = opts.maxChars ?? 40_000;
  return { title, text: s.length > max ? s.slice(0, max) + "\n…[truncated]" : s };
}

export function decodeEntities(s: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sect: "§", para: "¶", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return named[e.toLowerCase()] ?? m;
  });
}

export function stripXml(xml: string) {
  return decodeEntities(xml.replace(/<\/(P|HEAD|DIV\d|SECTNO|SUBJECT|FP|NOTE)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Additive helpers for the intelligence providers: response cache + rate limiting.
// Dependency-free so this file stays importable from any server module.
// ---------------------------------------------------------------------------

export interface CachedHttpResponse {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  fetchedAt: string;
  expiresAt: string;
  /** Selected response headers (retry-after, etag, last-modified), lower-cased. */
  headers?: Record<string, string>;
}

/** Pluggable cache store (the intel layer supplies one backed by `intel_http_cache`). */
export interface HttpCacheStore {
  get(key: string): CachedHttpResponse | null;
  set(key: string, value: CachedHttpResponse): void;
}

/** Stable cache key for a request (method + url + body). */
export function httpCacheKey(method: string, url: string, body?: string): string {
  const s = `${method.toUpperCase()} ${url}\n${body ?? ""}`;
  // FNV-1a 64-bit split into two 32-bit lanes; stable across runtimes, no node:crypto needed.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ (c & 0xff), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c >>> 8) ^ (c & 0xff)), 0x0100019b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Small in-process LRU-ish cache (tests and fallbacks). */
export function memoryHttpCache(max = 200): HttpCacheStore {
  const map = new Map<string, CachedHttpResponse>();
  return {
    get(key) {
      const v = map.get(key);
      if (!v) return null;
      if (new Date(v.expiresAt).getTime() < Date.now()) { map.delete(key); return null; }
      map.delete(key); map.set(key, v);
      return v;
    },
    set(key, value) {
      map.set(key, value);
      while (map.size > max) { const first = map.keys().next().value; if (first == null) break; map.delete(first); }
    },
  };
}

export interface FetchCachedOptions {
  method?: string;
  headers?: HeadersInit;
  body?: SafeFetchInit["body"];
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Truncation limit for the decoded body (default 2.5 MB). */
  maxBytes?: number;
  /** 0 disables caching for this call. Default 24h. */
  ttlMs?: number;
  cache?: HttpCacheStore;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Cache even non-2xx responses (default: only 2xx). */
  cacheErrors?: boolean;
  /** Provider egress policy (host allowlist, label). */
  egress?: EgressPolicy;
}

/**
 * fetch with a response cache. Bodies are decoded as UTF-8 text (JSON, HTML,
 * XML, plain text); binary responses use `safeFetch` directly. Never throws on
 * HTTP errors — callers inspect `status`. Transport goes through `safeFetch`,
 * so policy denials, DNS failures, timeouts and oversize bodies throw
 * `SafeFetchError`.
 */
export async function fetchCached(url: string, init: FetchCachedOptions = {}): Promise<CachedHttpResponse & { cached: boolean; truncated?: boolean; bytes?: number; hops?: number; durationMs?: number }> {
  const method = (init.method ?? "GET").toUpperCase();
  const bodyStr = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : undefined;
  const ttl = init.ttlMs ?? 24 * 3600_000;
  const key = httpCacheKey(method, url, bodyStr);
  if (ttl > 0 && init.cache) {
    const hit = init.cache.get(key);
    if (hit) return { ...hit, cached: true };
  }
  const res = await safeFetch(
    url,
    { method, body: init.body, signal: init.signal, fetchImpl: init.fetchImpl, headers: { "User-Agent": UA, Accept: "application/json,text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8", ...headersObject(init.headers) } },
    { ...(init.egress ?? {}), timeoutMs: init.timeoutMs ?? init.egress?.timeoutMs ?? 20_000, maxBytes: init.maxBytes ?? init.egress?.maxBytes ?? 2_500_000, onLimit: init.egress?.onLimit ?? "truncate" },
  );
  const now = Date.now();
  const headers: Record<string, string> = {};
  for (const h of ["retry-after", "etag", "last-modified"]) { const v = res.headers.get(h); if (v) headers[h] = v; }
  const out: CachedHttpResponse = { status: res.status, contentType: res.contentType, body: res.text(), finalUrl: res.finalUrl, fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl).toISOString(), headers: Object.keys(headers).length ? headers : undefined };
  if (ttl > 0 && init.cache && (res.ok || init.cacheErrors) && !res.truncated) init.cache.set(key, out);
  return { ...out, cached: false, truncated: res.truncated, bytes: res.bytes, hops: res.hops, durationMs: res.durationMs };
}

/** Token bucket: `capacity` burst, refilled at `refillPerSecond`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(public readonly capacity: number, public readonly refillPerSecond: number, private readonly now: () => number = () => Date.now()) {
    this.tokens = capacity;
    this.last = this.now();
  }
  private refill() {
    const t = this.now();
    const elapsed = Math.max(0, t - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.last = t;
  }
  tryTake(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
  /** Milliseconds until `n` tokens will be available (0 when available now). */
  msUntil(n = 1): number {
    this.refill();
    if (this.tokens >= n) return 0;
    return Math.ceil(((n - this.tokens) / this.refillPerSecond) * 1000);
  }
  /** Wait (up to maxWaitMs) for a token; resolves false when it would take longer. */
  async take(maxWaitMs = 5_000, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
    const wait = this.msUntil(1);
    if (wait === 0) { this.tokens -= 1; return true; }
    if (wait > maxWaitMs) return false;
    await sleep(wait);
    return this.tryTake(1) || this.take(Math.max(0, maxWaitMs - wait), sleep);
  }
  available(): number { this.refill(); return this.tokens; }
}

type LimiterGlobal = typeof globalThis & { __leclaudeRateLimiters?: Map<string, TokenBucket> };

/** Process-wide named limiter (shared across module reloads). */
export function rateLimiter(name: string, opts: { capacity: number; refillPerSecond: number }): TokenBucket {
  const g = globalThis as LimiterGlobal;
  if (!g.__leclaudeRateLimiters) g.__leclaudeRateLimiters = new Map();
  let b = g.__leclaudeRateLimiters.get(name);
  if (!b) { b = new TokenBucket(opts.capacity, opts.refillPerSecond); g.__leclaudeRateLimiters.set(name, b); }
  return b;
}
