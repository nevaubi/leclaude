import "server-only";
import { z } from "zod";
import { dedupeMentions, mention } from "../mentions";
import { defineAdapter } from "./types";

const schema = z.object({
  queries: z.array(z.string().min(1)).default([]),
  /** USCODE | PLAW | STATUTE | BILLS | CRPT */
  collection: z.string().default("USCODE"),
  maxResults: z.number().int().min(1).max(50).default(10),
  fetchText: z.boolean().default(true),
  maxTextChars: z.number().int().min(2000).max(400_000).default(60_000),
});

export type GovInfoConfig = z.infer<typeof schema>;

const USC_RE = /(\d{1,2})\s*U\.?S\.?C\.?\s*(?:§+\s*)?(\d+[a-z0-9\-]*)/i;

/** U.S. Code sections and public laws from GovInfo. */
export const govInfoAdapter = defineAdapter<GovInfoConfig>({
  id: "govinfo",
  name: "Statutes (GovInfo)",
  description: "U.S. Code sections, Public Laws and bills matching saved queries, with text.",
  kinds: ["statute"],
  family: "govinfo",
  requires: ["govinfo"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const queries = Array.from(new Set([...cfg.queries, ...(ctx.scope.queries ?? [])].map((q) => q.trim()).filter(Boolean)));
    if (!queries.length) { ctx.note("No queries configured."); return; }
    for (const query of queries) {
      if (ctx.budgetLeft() <= 0) break;
      const res = await ctx.attempt(`search GovInfo "${query}"`, () => ctx.providers.govinfo.search({ query, collection: cfg.collection, limit: cfg.maxResults, signal: ctx.signal }), { provider: "govinfo" });
      for (const hit of res?.results ?? []) {
        if (ctx.budgetLeft() <= 0) break;
        if (!hit.packageId) continue;
        const externalId = `govinfo:${hit.packageId}${hit.granuleId ? `/${hit.granuleId}` : ""}`;
        const existing = ctx.existing(externalId);
        if (existing && existing.textLength > 500 && existing.chunkCount > 0) { ctx.result.skipped++; continue; }
        let text = hit.teaser ?? "";
        if (cfg.fetchText) {
          const full = await ctx.attempt(`text of ${externalId}`, () => ctx.providers.govinfo.getText(hit, { maxChars: cfg.maxTextChars, signal: ctx.signal }), { provider: "govinfo" });
          if (full?.text) text = full.text;
        }
        if (!text) text = hit.title;
        const usc = hit.title.match(USC_RE);
        const citation = usc ? `${usc[1]} U.S.C. § ${usc[2]}` : undefined;
        await ctx.attempt(`ingest ${hit.title.slice(0, 60)}`, () => ctx.ingest({
          kind: "statute",
          title: hit.title.slice(0, 280),
          citation,
          jurisdiction: "Federal",
          dates: { published: hit.dateIssued },
          url: hit.url ?? hit.pdfUrl,
          externalId,
          text,
          summary: hit.teaser?.slice(0, 600),
          tags: ["statute", (hit.collection ?? cfg.collection).toLowerCase()],
          entities: dedupeMentions([citation ? mention("statute", citation, { externalId }) : null]),
          confidence: text.length > 1000 ? 0.85 : 0.6,
          meta: { packageId: hit.packageId, granuleId: hit.granuleId, collection: hit.collection ?? cfg.collection, query },
        }));
      }
    }
  },
});
