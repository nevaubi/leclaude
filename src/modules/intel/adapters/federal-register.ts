import "server-only";
import { z } from "zod";
import { dedupeMentions, mention } from "../mentions";
import { daysAgoISO } from "../providers/base";
import { defineAdapter } from "./types";

const schema = z.object({
  queries: z.array(z.string().min(1)).default([]),
  /** Agency slugs: environmental-protection-agency, food-and-drug-administration… */
  agencies: z.array(z.string()).default([]),
  /** RULE | PRORULE | NOTICE | PRESDOCU */
  types: z.array(z.string()).default([]),
  sinceDays: z.number().int().min(1).max(3650).default(30),
  maxResults: z.number().int().min(1).max(100).default(20),
  fetchText: z.boolean().default(true),
  maxTextChars: z.number().int().min(2000).max(400_000).default(80_000),
});

export type FederalRegisterConfig = z.infer<typeof schema>;

const TYPE_LABEL: Record<string, string> = { RULE: "Final rule", PRORULE: "Proposed rule", NOTICE: "Notice", PRESDOCU: "Presidential document" };

/** Federal Register documents matching saved queries; full text fetched when available. */
export const federalRegisterAdapter = defineAdapter<FederalRegisterConfig>({
  id: "federal-register",
  name: "Federal Register",
  description: "Rules, proposed rules and notices matching saved queries and agencies, with full text.",
  kinds: ["register_notice"],
  family: "federal-register",
  requires: ["federal-register"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const queries = Array.from(new Set([...cfg.queries, ...(ctx.scope.queries ?? [])].map((q) => q.trim()).filter(Boolean)));
    if (!queries.length) { ctx.note("No queries configured."); return; }
    const publishedAfter = ctx.since ?? daysAgoISO(cfg.sinceDays, ctx.now);
    const seen = new Set<string>();
    for (const term of queries) {
      if (ctx.budgetLeft() <= 0) break;
      const res = await ctx.attempt(`search Federal Register "${term}"`, () => ctx.providers.federalRegister.search({ term, agencies: cfg.agencies, types: cfg.types, publishedAfter, limit: cfg.maxResults, signal: ctx.signal }), { provider: "federal-register" });
      for (const doc of res?.results ?? []) {
        if (ctx.budgetLeft() <= 0) break;
        if (!doc.documentNumber || seen.has(doc.documentNumber)) continue;
        seen.add(doc.documentNumber);
        const externalId = `fr:${doc.documentNumber}`;
        const existing = ctx.existing(externalId);
        // Published documents do not change; skip the (expensive) text fetch when we already hold the text.
        if (existing && existing.textLength > 1000 && existing.chunkCount > 0) { ctx.result.skipped++; continue; }
        let text = doc.abstract ?? "";
        let source: string = "abstract";
        if (cfg.fetchText) {
          const full = await ctx.attempt(`text of ${doc.documentNumber}`, () => ctx.providers.federalRegister.getText(doc, { maxChars: cfg.maxTextChars, signal: ctx.signal }), { provider: "federal-register" });
          if (full?.text) { text = full.text; source = full.source; }
        }
        if (!text) text = doc.title;
        await ctx.attempt(`ingest ${doc.documentNumber}`, () => ctx.ingest({
          kind: "register_notice",
          title: `${TYPE_LABEL[doc.type ?? ""] ?? doc.type ?? "Document"}: ${doc.title}`.slice(0, 280),
          citation: doc.citation,
          jurisdiction: "Federal",
          agencies: doc.agencies,
          dates: { published: doc.publicationDate, effective: doc.effectiveOn ?? undefined },
          url: doc.url,
          externalId,
          text,
          summary: doc.abstract?.slice(0, 700),
          tags: ["federal-register", (doc.type ?? "").toLowerCase()].filter(Boolean),
          entities: dedupeMentions([...doc.agencies.map((a) => mention("agency", a)), ...doc.cfrReferences.slice(0, 10).map((c) => (c.title && c.part ? mention("regulation", `${c.title} C.F.R. Part ${c.part}`) : null))]),
          confidence: source === "abstract" ? 0.7 : 0.92,
          meta: { documentNumber: doc.documentNumber, type: doc.type, docketIds: doc.docketIds, cfrReferences: doc.cfrReferences, commentsCloseOn: doc.commentsCloseOn, pdfUrl: doc.pdfUrl, textSource: source, query: term },
        }));
      }
    }
  },
});
