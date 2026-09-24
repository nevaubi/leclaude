import "server-only";
import { z } from "zod";
import { sha256 } from "@/lib/integrity/hash";
import { dedupeMentions, mention } from "../mentions";
import { defineAdapter } from "./types";

const schema = z.object({
  queries: z.array(z.string().min(2)).default([]),
  /** Add each matter's short name as a query. */
  includeMatters: z.boolean().default(true),
  sinceDays: z.number().int().min(1).max(365).default(7),
  maxResults: z.number().int().min(1).max(20).default(10),
  provider: z.enum(["auto", "tavily", "firecrawl"]).default("auto"),
  includeDomains: z.array(z.string()).default([]),
  maxTextChars: z.number().int().min(500).max(100_000).default(20_000),
});

export type NewsConfig = z.infer<typeof schema>;

interface Item { url: string; title: string; text: string; publishedAt?: string; score?: number; provider: "tavily" | "firecrawl" }

/** News search through Tavily or Firecrawl. Without a key the run succeeds with a `not_configured` note. */
export const newsAdapter = defineAdapter<NewsConfig>({
  id: "news",
  name: "News watch",
  description: "Recent news for saved queries and matter names via Tavily (preferred) or Firecrawl search.",
  kinds: ["news"],
  family: "search",
  requires: [],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const queries = new Map<string, string[]>();
    for (const q of [...cfg.queries, ...(ctx.scope.queries ?? [])]) if (q.trim()) queries.set(q.trim(), []);
    if (cfg.includeMatters) for (const m of ctx.matters) { const q = m.shortName || m.name; queries.set(q, [...(queries.get(q) ?? []), m.id]); }
    if (!queries.size) { ctx.note("No queries configured."); return; }
    const tavily = ctx.providers.tavily.configured && cfg.provider !== "firecrawl";
    const firecrawl = ctx.providers.firecrawl.configured && cfg.provider !== "tavily";
    if (!tavily && !firecrawl) {
      ctx.result.errors.push({ code: "not_configured", message: "News search needs TAVILY_API_KEY or FIRECRAWL_API_KEY; nothing was fetched.", retryable: false, fatal: false, at: ctx.now.toISOString() });
      ctx.note("Not configured: add TAVILY_API_KEY or FIRECRAWL_API_KEY to enable news search.");
      ctx.result.skipped += queries.size;
      return;
    }
    for (const [query, matterIds] of queries) {
      if (ctx.budgetLeft() <= 0) break;
      let items: Item[] = [];
      if (tavily) {
        const res = await ctx.attempt(`Tavily news "${query}"`, () => ctx.providers.tavily.search({ query, topic: "news", days: cfg.sinceDays, maxResults: cfg.maxResults, includeDomains: cfg.includeDomains, signal: ctx.signal }), { provider: "tavily" });
        items = (res?.results ?? []).map((r) => ({ url: r.url, title: r.title, text: r.rawContent ?? r.content, publishedAt: r.publishedDate, score: r.score, provider: "tavily" as const }));
      } else if (firecrawl) {
        const res = await ctx.attempt(`Firecrawl search "${query}"`, () => ctx.providers.firecrawl.search(query, { limit: cfg.maxResults, tbs: cfg.sinceDays <= 1 ? "qdr:d" : cfg.sinceDays <= 7 ? "qdr:w" : cfg.sinceDays <= 31 ? "qdr:m" : "qdr:y", signal: ctx.signal }), { provider: "firecrawl" });
        items = (res ?? []).map((p) => ({ url: p.url, title: p.title ?? p.url, text: p.markdown || p.description || "", publishedAt: p.publishedAt, provider: "firecrawl" as const }));
      }
      for (const it of items) {
        if (ctx.budgetLeft() <= 0) break;
        if (!it.url || !it.text) continue;
        const published = it.publishedAt ? new Date(it.publishedAt) : undefined;
        await ctx.attempt(`ingest ${it.title.slice(0, 60)}`, () => ctx.ingest({
          kind: "news",
          title: it.title.slice(0, 240) || it.url,
          summary: it.text.slice(0, 500),
          dates: { published: published && !Number.isNaN(published.getTime()) ? published.toISOString().slice(0, 10) : undefined, event: published && !Number.isNaN(published.getTime()) ? published.toISOString().slice(0, 10) : ctx.now.toISOString().slice(0, 10) },
          url: it.url,
          externalId: `news:${sha256(it.url).slice(0, 16)}`,
          matterIds,
          text: `${it.title}\n${safeHost(it.url)}${it.publishedAt ? ` · ${it.publishedAt}` : ""}\n\n${it.text.slice(0, cfg.maxTextChars)}`,
          tags: ["news", it.provider],
          entities: dedupeMentions([mention("party", safeHost(it.url), { role: "publisher" })]),
          confidence: Math.min(0.85, 0.5 + (it.score ?? 0.2)),
          meta: { query, provider: it.provider, score: it.score, host: safeHost(it.url) },
        }));
      }
    }
  },
});

function safeHost(url: string) { try { return new URL(url).host.replace(/^www\./, ""); } catch { return "web"; } }
