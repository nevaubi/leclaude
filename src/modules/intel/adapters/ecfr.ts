import "server-only";
import { z } from "zod";
import { dedupeMentions, mention } from "../mentions";
import { CFR_TITLE_AGENCIES, cfrCite } from "../providers/ecfr";
import { defineAdapter } from "./types";

const schema = z.object({
  /** Sections or whole parts to keep current: { title: 40, section: "705.3" } or { title: 21, part: "314" }. */
  sections: z.array(z.object({ title: z.number().int().min(1).max(50), section: z.string().optional(), part: z.string().optional() })).default([]),
  /** Full-text queries; matching sections are fetched when `fetchSections` is on. */
  queries: z.array(z.string().min(1)).default([]),
  maxResults: z.number().int().min(1).max(50).default(10),
  fetchSections: z.boolean().default(true),
  maxTextChars: z.number().int().min(2000).max(400_000).default(120_000),
});

export type EcfrConfig = z.infer<typeof schema>;

/** Current CFR text for tracked sections plus query hits. */
export const ecfrAdapter = defineAdapter<EcfrConfig>({
  id: "ecfr",
  name: "Regulations (eCFR)",
  description: "Keeps tracked CFR sections current and pulls sections matching saved queries.",
  kinds: ["regulation"],
  family: "ecfr",
  requires: ["ecfr"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const wanted: { title: number; section?: string; part?: string; excerpt?: string; heading?: string; startsOn?: string }[] = [...cfg.sections];
    for (const q of [...cfg.queries, ...(ctx.scope.queries ?? [])]) {
      if (ctx.budgetLeft() <= 0) break;
      const res = await ctx.attempt(`search eCFR "${q}"`, () => ctx.providers.ecfr.search({ query: q, limit: cfg.maxResults, signal: ctx.signal }), { provider: "ecfr" });
      for (const hit of res?.results ?? []) {
        const title = Number(hit.title);
        if (!Number.isFinite(title)) continue;
        if (!wanted.some((w) => w.title === title && w.section === hit.section && w.part === hit.part)) wanted.push({ title, section: hit.section, part: hit.part, excerpt: hit.excerpt, heading: hit.heading, startsOn: hit.startsOn });
      }
    }
    if (!wanted.length) { ctx.note("No CFR sections or queries configured."); return; }
    for (const w of wanted) {
      if (ctx.budgetLeft() <= 0) break;
      const part = w.part ?? w.section?.split(".")[0];
      if (!part) continue;
      const cite = cfrCite(w.title, w.section, part);
      const agencies = CFR_TITLE_AGENCIES[w.title] ?? [];
      const fetched = cfg.fetchSections || !w.excerpt ? await ctx.attempt(`fetch ${cite}`, () => ctx.providers.ecfr.getSection({ title: w.title, section: w.section, part, maxChars: cfg.maxTextChars, signal: ctx.signal }), { provider: "ecfr" }) : undefined;
      const text = fetched?.text ?? w.excerpt ?? "";
      if (!text) continue;
      await ctx.attempt(`ingest ${cite}`, () => ctx.ingest({
        kind: "regulation",
        title: `${cite}${(fetched?.heading ?? w.heading) ? ` — ${fetched?.heading ?? w.heading}` : ""}`,
        citation: cite,
        jurisdiction: "Federal",
        agencies,
        dates: { effective: w.startsOn, modified: fetched?.asOf ?? ctx.now.toISOString().slice(0, 10) },
        url: fetched?.url ?? (w.section ? `https://www.ecfr.gov/current/title-${w.title}/section-${w.section}` : `https://www.ecfr.gov/current/title-${w.title}/part-${part}`),
        externalId: `ecfr:${cite}`,
        text,
        summary: (fetched?.heading ?? w.heading) ? `${cite} — ${fetched?.heading ?? w.heading}` : undefined,
        tags: ["cfr", `title-${w.title}`],
        entities: dedupeMentions([mention("regulation", cite, { externalId: `ecfr:${cite}` }), ...agencies.map((a) => mention("agency", a))]),
        confidence: fetched ? 0.95 : 0.6,
        meta: { title: w.title, part, section: w.section, asOf: fetched?.asOf, source: fetched ? "versioner" : "search-excerpt" },
      }));
    }
  },
});
