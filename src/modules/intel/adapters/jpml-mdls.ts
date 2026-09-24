import "server-only";
import { z } from "zod";
import { courtMention, COURT_NAMES, dedupeMentions, jurisdictionForCourt, mention, mentionsFromCaption } from "../mentions";
import { defineAdapter } from "./types";

const schema = z.object({
  maxResults: z.number().int().min(1).max(500).default(200),
  /** MDL numbers to always include (even when the live list omits them). */
  watch: z.array(z.string().regex(/^\d{3,4}$/)).default([]),
  /** Override the JPML list URL. */
  url: z.string().url().optional(),
  /** When the live page cannot be parsed, use the seeded fallback list (records are flagged unverified). */
  allowFallback: z.boolean().default(true),
});

export type JpmlMdlsConfig = z.infer<typeof schema>;

/** Pending MDL dockets from the JPML list, linked to matters whose caption carries the MDL number. */
export const jpmlMdlsAdapter = defineAdapter<JpmlMdlsConfig>({
  id: "jpml-mdls",
  name: "MDL tracker (JPML)",
  description: "Pending multidistrict litigation dockets (transferee court, judge, pending actions) from the JPML list.",
  kinds: ["mdl"],
  family: "web",
  requires: ["jpml"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const list = await ctx.attempt("JPML pending MDL list", () => ctx.providers.jpml.pendingMDLs({ signal: ctx.signal, allowFallback: cfg.allowFallback }), { provider: "jpml", fatal: true });
    if (!list) return;
    if (list.source === "fallback") ctx.note(`JPML list not parsed (${list.note ?? "unknown"}); using the seeded fallback list.`);
    const watch = new Set([...cfg.watch, ...(ctx.scope.targets ?? []).filter((t) => /^\d{3,4}$/.test(t))]);
    const matterByMdl = new Map<string, string[]>();
    for (const m of ctx.matters) {
      const n = m.caption?.match(/MDL\s*(?:No\.?)?\s*(\d{3,4})/i)?.[1];
      if (n) matterByMdl.set(n, [...(matterByMdl.get(n) ?? []), m.id]);
    }
    const ordered = [...list.mdls].sort((a, b) => Number(watch.has(b.mdlNumber) || matterByMdl.has(b.mdlNumber)) - Number(watch.has(a.mdlNumber) || matterByMdl.has(a.mdlNumber)));
    for (const mdl of ordered.slice(0, cfg.maxResults)) {
      if (ctx.budgetLeft() <= 0) break;
      const court = mdl.courtId ? COURT_NAMES[mdl.courtId] ?? mdl.court : mdl.court;
      const text = [
        `MDL No. ${mdl.mdlNumber} — ${mdl.title}`,
        court ? `Transferee court: ${court}` : "",
        mdl.judge ? `Transferee judge: ${mdl.judge}` : "",
        mdl.docketNumber ? `Lead docket: ${mdl.docketNumber}` : "",
        mdl.transferDate ? `Centralized: ${mdl.transferDate}` : "",
        mdl.pendingActions != null ? `Pending actions: ${mdl.pendingActions}` : "",
        mdl.fallback ? "\nSource: seeded fallback list (verify against the JPML pending MDL report)." : `\nSource: ${list.source} JPML list`,
      ].filter(Boolean).join("\n");
      await ctx.attempt(`ingest MDL ${mdl.mdlNumber}`, () => ctx.ingest({
        kind: "mdl",
        title: `MDL ${mdl.mdlNumber}: ${mdl.title.replace(/^In re:?\s*/i, "")}`,
        caseName: mdl.title,
        docketNumber: mdl.docketNumber,
        court, courtId: mdl.courtId,
        jurisdiction: jurisdictionForCourt(mdl.courtId),
        dates: { filed: mdl.transferDate, modified: ctx.now.toISOString().slice(0, 10) },
        url: mdl.url,
        externalId: `jpml:${mdl.mdlNumber}`,
        matterIds: matterByMdl.get(mdl.mdlNumber) ?? [],
        text,
        summary: `${mdl.title}${court ? ` — ${court}` : ""}${mdl.judge ? `, Judge ${mdl.judge}` : ""}`,
        tags: ["mdl", watch.has(mdl.mdlNumber) ? "watched" : ""].filter(Boolean),
        entities: dedupeMentions([mention("mdl", `MDL ${mdl.mdlNumber}`, { externalId: `jpml:${mdl.mdlNumber}` }), mdl.judge ? mention("judge", mdl.judge) : null, courtMention(court, mdl.courtId), ...mentionsFromCaption(mdl.title)]),
        confidence: mdl.fallback ? 0.55 : 0.85,
        flags: mdl.fallback ? [{ kind: "unverified", note: "From the seeded fallback list; the live JPML page was not parsed.", at: ctx.now.toISOString(), by: "adapter:jpml-mdls" }] : [],
        meta: { mdlNumber: mdl.mdlNumber, judge: mdl.judge, pendingActions: mdl.pendingActions, transferDate: mdl.transferDate, fallback: Boolean(mdl.fallback), listSource: list.source },
      }));
    }
  },
});
