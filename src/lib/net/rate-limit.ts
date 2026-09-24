import "server-only";

/**
 * Keyed token-bucket rate limiting (CLAUDE.md §41 rate limits, §52 bounded
 * tools). Keys are free-form strings such as `provider:courtlistener`,
 * `host:www.ecfr.gov`, `principal:p_123` or `route:/api/intel/search`; rules
 * are matched by the longest key prefix.
 *
 * The default store is in-memory (per process). A shared backend (Redis,
 * DynamoDB, ElastiCache) plugs in through `RateLimitStore` so every replica
 * shares one budget; see docs/architecture/network-security.md.
 */
export interface RateLimitRule {
  /** Burst size: tokens available after an idle period. */
  capacity: number;
  /** Sustained rate. */
  refillPerSecond: number;
}

export interface RateLimitDecision {
  ok: boolean;
  key: string;
  /** Whole tokens left after this decision. */
  remaining: number;
  /** 0 when the request may proceed now. */
  retryAfterMs: number;
  limit: number;
}

export interface RateLimitStore {
  /** Atomically refill `key` and take `cost` tokens when available. */
  take(key: string, rule: RateLimitRule, cost: number, now: number): RateLimitDecision | Promise<RateLimitDecision>;
  /** Report the state of `key` without consuming. */
  peek(key: string, rule: RateLimitRule, now: number): RateLimitDecision | Promise<RateLimitDecision>;
  /** Clear one key, or every key. */
  reset(key?: string): void | Promise<void>;
}

interface Bucket { tokens: number; last: number }

/** Bounded in-process store; least-recently-touched keys are evicted past `maxKeys`. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly maxKeys = 10_000) {}

  private bucket(key: string, rule: RateLimitRule, now: number): Bucket {
    let b = this.buckets.get(key);
    if (b) {
      this.buckets.delete(key);
      const elapsed = Math.max(0, now - b.last) / 1000;
      b.tokens = Math.min(rule.capacity, b.tokens + elapsed * rule.refillPerSecond);
      b.last = now;
    } else {
      b = { tokens: rule.capacity, last: now };
    }
    this.buckets.set(key, b);
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest == null) break;
      this.buckets.delete(oldest);
    }
    return b;
  }

  take(key: string, rule: RateLimitRule, cost: number, now: number): RateLimitDecision {
    const b = this.bucket(key, rule, now);
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, key, remaining: Math.floor(b.tokens), retryAfterMs: 0, limit: rule.capacity };
    }
    const retryAfterMs = rule.refillPerSecond > 0 ? Math.ceil(((cost - b.tokens) / rule.refillPerSecond) * 1000) : Number.POSITIVE_INFINITY;
    return { ok: false, key, remaining: Math.floor(b.tokens), retryAfterMs, limit: rule.capacity };
  }

  peek(key: string, rule: RateLimitRule, now: number): RateLimitDecision {
    const b = this.bucket(key, rule, now);
    const ok = b.tokens >= 1;
    return { ok, key, remaining: Math.floor(b.tokens), retryAfterMs: ok ? 0 : Math.ceil(((1 - b.tokens) / Math.max(rule.refillPerSecond, 1e-9)) * 1000), limit: rule.capacity };
  }

  reset(key?: string) {
    if (key == null) this.buckets.clear(); else this.buckets.delete(key);
  }

  get size() { return this.buckets.size; }
}

export class RateLimitError extends Error {
  readonly name = "RateLimitError";
  readonly code = "rate_limited" as const;
  readonly retryable = true;
  constructor(public readonly decision: RateLimitDecision, message?: string) {
    super(message ?? `Rate limit reached for ${decision.key}; retry in ${Math.ceil(decision.retryAfterMs / 1000)}s`);
  }
}

export function isRateLimitError(e: unknown): e is RateLimitError {
  return Boolean(e) && typeof e === "object" && (e as { name?: string }).name === "RateLimitError";
}

/** Rules keyed by prefix; the longest matching prefix wins. */
export const DEFAULT_RULES: Record<string, RateLimitRule> = {
  host: { capacity: 10, refillPerSecond: 4 },
  provider: { capacity: 10, refillPerSecond: 2 },
  "tool:fetch_url": { capacity: 4, refillPerSecond: 1 },
  tool: { capacity: 20, refillPerSecond: 5 },
  principal: { capacity: 60, refillPerSecond: 10 },
  route: { capacity: 120, refillPerSecond: 20 },
  upload: { capacity: 10, refillPerSecond: 0.5 },
};

export interface RateLimiterOptions {
  store?: RateLimitStore;
  rules?: Record<string, RateLimitRule>;
  defaultRule?: RateLimitRule;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface AcquireOptions {
  cost?: number;
  rule?: RateLimitRule;
  /** Wait up to this long for tokens (0 = fail immediately). */
  maxWaitMs?: number;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  readonly store: RateLimitStore;
  private readonly rules: Record<string, RateLimitRule>;
  private readonly defaultRule: RateLimitRule;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RateLimiterOptions = {}) {
    this.store = opts.store ?? new MemoryRateLimitStore();
    this.rules = { ...DEFAULT_RULES, ...(opts.rules ?? {}) };
    this.defaultRule = opts.defaultRule ?? { capacity: 30, refillPerSecond: 5 };
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** The rule for a key: longest prefix match on ":"-separated segments, else the default rule. */
  ruleFor(key: string): RateLimitRule {
    if (this.rules[key]) return this.rules[key];
    const parts = key.split(":");
    for (let i = parts.length - 1; i > 0; i--) {
      const prefix = parts.slice(0, i).join(":");
      if (this.rules[prefix]) return this.rules[prefix];
    }
    return this.defaultRule;
  }

  /** Take tokens now; never waits. */
  async take(key: string, o: { cost?: number; rule?: RateLimitRule } = {}): Promise<RateLimitDecision> {
    return this.store.take(key, o.rule ?? this.ruleFor(key), o.cost ?? 1, this.now());
  }

  /** Take tokens, waiting up to `maxWaitMs` for the bucket to refill. The decision is `ok: false` when the wait would be longer. */
  async acquire(key: string, o: AcquireOptions = {}): Promise<RateLimitDecision> {
    const rule = o.rule ?? this.ruleFor(key);
    const cost = o.cost ?? 1;
    const deadline = this.now() + (o.maxWaitMs ?? 0);
    for (;;) {
      if (o.signal?.aborted) return { ok: false, key, remaining: 0, retryAfterMs: 0, limit: rule.capacity };
      const d = await this.store.take(key, rule, cost, this.now());
      if (d.ok) return d;
      const left = deadline - this.now();
      if (!Number.isFinite(d.retryAfterMs) || d.retryAfterMs > left) return d;
      await this.sleep(Math.max(1, Math.min(d.retryAfterMs, left)));
    }
  }

  /** Acquire or throw `RateLimitError`. */
  async acquireOrThrow(key: string, o: AcquireOptions = {}): Promise<RateLimitDecision> {
    const d = await this.acquire(key, o);
    if (!d.ok) throw new RateLimitError(d);
    return d;
  }

  async peek(key: string, rule?: RateLimitRule): Promise<RateLimitDecision> {
    return this.store.peek(key, rule ?? this.ruleFor(key), this.now());
  }

  reset(key?: string) { return this.store.reset(key); }
}

/** Compose a limiter key from parts, skipping empty ones: keyFor("principal", id) → "principal:<id>". */
export function keyFor(...parts: Array<string | number | undefined | null>): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== "").map(String).join(":");
}

/** Response headers for a decision (routes). */
export function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  const h: Record<string, string> = { "X-RateLimit-Limit": String(d.limit), "X-RateLimit-Remaining": String(Math.max(0, d.remaining)) };
  if (!d.ok && Number.isFinite(d.retryAfterMs)) h["Retry-After"] = String(Math.max(1, Math.ceil(d.retryAfterMs / 1000)));
  return h;
}

type G = typeof globalThis & { __leclaudeRateLimiter?: RateLimiter };

/**
 * Process-wide limiter. Replace its store with `configureRateLimiter({ store })`
 * at boot to share budgets across replicas (the adapter point for a Redis or
 * DynamoDB store); until then every replica enforces the rules independently.
 */
export function sharedRateLimiter(): RateLimiter {
  const g = globalThis as G;
  if (!g.__leclaudeRateLimiter) g.__leclaudeRateLimiter = new RateLimiter();
  return g.__leclaudeRateLimiter;
}

export function configureRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const g = globalThis as G;
  g.__leclaudeRateLimiter = new RateLimiter(opts);
  return g.__leclaudeRateLimiter;
}
