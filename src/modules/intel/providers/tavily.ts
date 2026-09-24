import "server-only";
import { clip, envValue, ProviderClient, ProviderError, type ProviderFactoryOptions } from "./base";

/** Tavily search + extract. Requires TAVILY_API_KEY. */
const BASE = "https://api.tavily.com";

export interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score?: number;
  publishedDate?: string;
  rawContent?: string;
}

export function createTavily(opts: ProviderFactoryOptions = {}) {
  const key = envValue(opts, "TAVILY_API_KEY");
  const client = new ProviderClient({ name: "tavily", rps: 1, burst: 3, timeoutMs: 40_000, cache: opts.cache, fetchImpl: opts.fetchImpl, offline: opts.offline, limiter: opts.limiter, sleep: opts.sleep, maxWaitMs: opts.maxWaitMs });
  const require = () => { if (!key) throw new ProviderError("tavily", "not_configured", "tavily: TAVILY_API_KEY is not configured", false); };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    name: "tavily" as const,
    client,
    configured: Boolean(key),
    async search(q: { query: string; topic?: "general" | "news"; days?: number; maxResults?: number; includeDomains?: string[]; excludeDomains?: string[]; searchDepth?: "basic" | "advanced"; includeRawContent?: boolean; signal?: AbortSignal; ttlMs?: number }): Promise<{ results: TavilyResult[]; answer?: string }> {
      require();
      const body: Record<string, unknown> = { query: q.query, topic: q.topic ?? "news", max_results: Math.min(q.maxResults ?? 10, 20), search_depth: q.searchDepth ?? "basic", include_raw_content: q.includeRawContent ?? false };
      if (q.topic === "news" || q.topic === undefined) body.days = q.days ?? 7;
      if (q.includeDomains?.length) body.include_domains = q.includeDomains;
      if (q.excludeDomains?.length) body.exclude_domains = q.excludeDomains;
      const data = await client.postJSON<{ results?: Array<Record<string, unknown>>; answer?: string }>(`${BASE}/search`, body, { headers: { Authorization: `Bearer ${key}` }, signal: q.signal, ttlMs: q.ttlMs ?? 6 * 3600_000 });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("tavily", "parse", "tavily: search response has no results array (schema drift?)", false);
      return { answer: str(data.answer), results: data.results.map((r) => ({ url: str(r.url) ?? "", title: str(r.title) ?? "", content: str(r.content) ?? "", score: typeof r.score === "number" ? r.score : undefined, publishedDate: str(r.published_date), rawContent: str(r.raw_content) })) };
    },
    async extract(urls: string[], o: { maxChars?: number; signal?: AbortSignal; ttlMs?: number } = {}): Promise<{ results: { url: string; text: string }[]; failed: { url: string; error: string }[] }> {
      require();
      const data = await client.postJSON<{ results?: Array<Record<string, unknown>>; failed_results?: Array<Record<string, unknown>> }>(`${BASE}/extract`, { urls: urls.slice(0, 20) }, { headers: { Authorization: `Bearer ${key}` }, signal: o.signal, ttlMs: o.ttlMs });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("tavily", "parse", "tavily: extract response has no results array (schema drift?)", false);
      return {
        results: data.results.map((r) => ({ url: str(r.url) ?? "", text: clip(str(r.raw_content) ?? "", o.maxChars ?? 120_000) })),
        failed: (data.failed_results ?? []).map((r) => ({ url: str(r.url) ?? "", error: str(r.error) ?? "unknown" })),
      };
    },
  };
}

export type TavilyProvider = ReturnType<typeof createTavily>;
