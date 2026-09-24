import "server-only";
import { z } from "zod";
import { courtMention, COURT_NAMES, dedupeMentions, jurisdictionForCourt, mentionsFromCaption, mentionsFromJudgeField } from "../mentions";
import { daysAgoISO } from "../providers/base";
import { courtsForJurisdiction } from "../providers/courtlistener";
import { defineAdapter } from "./types";

const schema = z.object({
  queries: z.array(z.string().min(1)).default([]),
  /** Space-separated CourtListener court ids ("dsc ca4"). */
  courts: z.string().optional(),
  /** Named group from the research toolkit (scotus, federal-appellate, 4th-circuit…). */
  jurisdiction: z.string().optional(),
  sinceDays: z.number().int().min(1).max(3650).default(30),
  maxResults: z.number().int().min(1).max(100).default(20),
  fetchText: z.boolean().default(true),
  maxTextChars: z.number().int().min(2000).max(400_000).default(80_000),
  orderBy: z.string().default("dateFiled desc"),
});

export type CourtListenerOpinionsConfig = z.infer<typeof schema>;

/** Opinions matching saved queries (per court group), full text fetched and indexed. */
export const courtListenerOpinionsAdapter = defineAdapter<CourtListenerOpinionsConfig>({
  id: "courtlistener-opinions",
  name: "Case law (CourtListener opinions)",
  description: "Searches CourtListener for opinions matching saved queries in the selected courts and indexes their full text.",
  kinds: ["opinion"],
  family: "courtlistener",
  requires: ["courtlistener"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const queries = Array.from(new Set([...cfg.queries, ...(ctx.scope.queries ?? [])].map((q) => q.trim()).filter(Boolean)));
    if (!queries.length) { ctx.note("No queries configured."); return; }
    const courts = courtsForJurisdiction(cfg.jurisdiction, cfg.courts ?? ctx.scope.courts?.join(" "));
    const filedAfter = ctx.since ?? daysAgoISO(cfg.sinceDays, ctx.now);
    for (const query of queries) {
      if (ctx.budgetLeft() <= 0) break;
      const res = await ctx.attempt(`search opinions "${query}"`, () => ctx.providers.courtlistener.searchOpinions({ query, courts, filedAfter, orderBy: cfg.orderBy, limit: cfg.maxResults, signal: ctx.signal }), { provider: "courtlistener" });
      if (!res) continue;
      for (const hit of res.results) {
        if (ctx.budgetLeft() <= 0) break;
        const externalId = hit.clusterId ? `cl:cluster:${hit.clusterId}` : hit.opinionId ? `cl:opinion:${hit.opinionId}` : `cl:opinion:${hit.url ?? hit.caseName}`;
        const existing = ctx.existing(externalId);
        // Already have the full text: refresh metadata only.
        const needText = cfg.fetchText && hit.opinionId && !(existing && existing.textLength > 1000);
        let text = "";
        if (needText) {
          const full = await ctx.attempt(`opinion #${hit.opinionId}`, () => ctx.providers.courtlistener.getOpinionText(hit.opinionId!, { maxChars: cfg.maxTextChars, signal: ctx.signal }), { provider: "courtlistener" });
          text = full?.text ?? "";
        }
        if (!text) text = existing?.textLength ? "" : [hit.caseName, hit.citations.join("; "), hit.court, hit.dateFiled, hit.snippet].filter(Boolean).join("\n");
        if (existing && !text) { ctx.result.skipped++; continue; }
        const court = hit.courtId ? COURT_NAMES[hit.courtId] ?? hit.court : hit.court;
        await ctx.attempt(`ingest ${hit.caseName}`, () => ctx.ingest({
          kind: "opinion",
          title: `${hit.caseName}${hit.citations[0] ? `, ${hit.citations[0]}` : ""}${hit.dateFiled ? ` (${hit.dateFiled.slice(0, 4)})` : ""}`,
          caseName: hit.caseName,
          citation: hit.citations[0],
          court,
          courtId: hit.courtId,
          jurisdiction: jurisdictionForCourt(hit.courtId),
          docketNumber: hit.docketNumber,
          dates: { filed: hit.dateFiled, decided: hit.dateFiled },
          url: hit.url,
          externalId,
          summary: hit.snippet?.slice(0, 600),
          text,
          tags: ["case-law", hit.status?.toLowerCase() ?? ""].filter(Boolean),
          entities: dedupeMentions([...mentionsFromJudgeField(hit.judge), ...mentionsFromCaption(hit.caseName), courtMention(court, hit.courtId)]),
          confidence: text.length > 2000 ? 0.9 : 0.6,
          meta: { clusterId: hit.clusterId, opinionId: hit.opinionId, status: hit.status, citeCount: hit.citeCount, citations: hit.citations, query, judge: hit.judge },
        }));
      }
    }
  },
});
