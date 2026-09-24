import "server-only";
import { z } from "zod";
import { defineAdapter } from "./types";

const entry = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  matterId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  kind: z.enum(["web_page", "court_rule", "news", "regulation", "statute"]).optional(),
});

const schema = z.object({
  urls: z.array(z.union([z.string().url(), entry])).default([]),
  kind: z.enum(["web_page", "court_rule", "news", "regulation", "statute"]).default("web_page"),
  maxTextChars: z.number().int().min(500).max(600_000).default(120_000),
  prefer: z.enum(["auto", "plain", "firecrawl"]).default("auto"),
});

export type WebListConfig = z.infer<typeof schema>;

/** User-maintained URL lists (agency pages, court notices, client sites) kept current as web_page documents. */
export const webListAdapter = defineAdapter<WebListConfig>({
  id: "web-list",
  name: "Watched web pages",
  description: "Fetches a list of URLs (agency pages, court notices, client sites) and keeps their text current.",
  kinds: ["web_page"],
  family: "web",
  requires: ["web"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const entries = [...cfg.urls.map((u) => (typeof u === "string" ? { url: u, tags: [] as string[] } : u)), ...(ctx.scope.targets ?? []).filter((t) => /^https?:\/\//i.test(t)).map((url) => ({ url, tags: [] as string[] }))];
    if (!entries.length) { ctx.note("No URLs configured."); return; }
    const seen = new Set<string>();
    for (const e of entries) {
      if (ctx.budgetLeft() <= 0) break;
      if (seen.has(e.url)) continue;
      seen.add(e.url);
      const page = await ctx.attempt(`fetch ${e.url}`, () => ctx.providers.web.fetchPage(e.url, { maxChars: cfg.maxTextChars, prefer: cfg.prefer, signal: ctx.signal }), { provider: "web" });
      if (!page) continue;
      if (page.text.trim().length < 80) { ctx.fail(new Error(`${e.url}: page returned ${page.text.trim().length} characters of text`), { label: e.url, provider: "web" }); continue; }
      const matterIds = e.matterId ? [e.matterId] : [];
      await ctx.attempt(`ingest ${e.url}`, () => ctx.ingest({
        kind: e.kind ?? cfg.kind,
        title: e.title ?? page.title ?? e.url,
        dates: { modified: page.fetchedAt.slice(0, 10) },
        url: page.finalUrl || e.url,
        externalId: `web:${e.url}`,
        matterIds,
        text: page.text,
        summary: page.title,
        tags: ["web", ...e.tags],
        confidence: page.via === "firecrawl" || page.via === "pdf" ? 0.8 : 0.7,
        meta: { via: page.via, contentType: page.contentType, requestedUrl: e.url },
      }));
    }
  },
});
