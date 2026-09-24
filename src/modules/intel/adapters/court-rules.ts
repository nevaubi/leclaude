import "server-only";
import { z } from "zod";
import { courtMention, dedupeMentions, jurisdictionForCourt } from "../mentions";
import { defineAdapter } from "./types";

const ruleSchema = z.object({
  court: z.string().min(2),
  courtId: z.string().optional(),
  label: z.string().min(2),
  url: z.string().url(),
  jurisdiction: z.string().optional(),
});

const schema = z.object({
  rules: z.array(ruleSchema).default([]),
  maxTextChars: z.number().int().min(2000).max(600_000).default(200_000),
  /** "auto" uses Firecrawl when configured (better for JS-rendered pages and PDFs), else plain fetch. */
  prefer: z.enum(["auto", "plain", "firecrawl"]).default("auto"),
});

export type CourtRulesConfig = z.infer<typeof schema>;

/** Local rules, standing orders and MDL case-management pages from a URL list per court. */
export const courtRulesAdapter = defineAdapter<CourtRulesConfig>({
  id: "court-rules",
  name: "Court rules and standing orders",
  description: "Fetches local rules, standing orders and MDL practice pages from a per-court URL list and keeps them current.",
  kinds: ["court_rule"],
  family: "web",
  requires: ["web"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    if (!cfg.rules.length) { ctx.note("No rule URLs configured."); return; }
    for (const rule of cfg.rules) {
      if (ctx.budgetLeft() <= 0) break;
      const page = await ctx.attempt(`fetch ${rule.label}`, () => ctx.providers.web.fetchPage(rule.url, { maxChars: cfg.maxTextChars, prefer: cfg.prefer, signal: ctx.signal }), { provider: "web" });
      if (!page) continue;
      if (page.text.trim().length < 200) { ctx.fail(new Error(`${rule.label}: page returned ${page.text.trim().length} characters of text`), { label: rule.label, provider: "web" }); continue; }
      await ctx.attempt(`ingest ${rule.label}`, () => ctx.ingest({
        kind: "court_rule",
        title: rule.label,
        court: rule.court,
        courtId: rule.courtId,
        jurisdiction: rule.jurisdiction ?? jurisdictionForCourt(rule.courtId) ?? "Federal",
        dates: { modified: page.fetchedAt.slice(0, 10) },
        url: page.finalUrl || rule.url,
        externalId: `rule:${rule.url}`,
        text: page.text,
        summary: page.title,
        tags: ["court-rule", rule.courtId ?? ""].filter(Boolean),
        entities: dedupeMentions([courtMention(rule.court, rule.courtId)]),
        confidence: page.via === "firecrawl" || page.via === "pdf" ? 0.85 : 0.75,
        meta: { via: page.via, contentType: page.contentType, pageTitle: page.title },
      }));
    }
  },
});
