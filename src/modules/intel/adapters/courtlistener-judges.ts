import "server-only";
import { z } from "zod";
import { courtMention, dedupeMentions, jurisdictionForCourt, mention } from "../mentions";
import type { IntelEntityMention } from "../types";
import { intelDocuments } from "../store";
import { defineAdapter } from "./types";

const schema = z.object({
  names: z.array(z.string().min(2)).default([]),
  /** Also profile judges mentioned on recent dockets/opinions of the matters in scope. */
  fromDocuments: z.boolean().default(true),
  maxJudges: z.number().int().min(1).max(50).default(10),
});

export type CourtListenerJudgesConfig = z.infer<typeof schema>;

/** Judge profiles from CourtListener's people database (positions, courts, appointers). */
export const courtListenerJudgesAdapter = defineAdapter<CourtListenerJudgesConfig>({
  id: "courtlistener-judges",
  name: "Judges (CourtListener people)",
  description: "Builds judge records (positions, courts, appointing authority) for named judges and judges seen on matter dockets and opinions.",
  kinds: ["judge"],
  family: "courtlistener",
  requires: ["courtlistener"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const names = new Set<string>([...cfg.names, ...(ctx.scope.targets ?? [])].map((n) => n.trim()).filter(Boolean));
    for (const w of ctx.watches) if (w.kind === "judge" && !/^ient_/.test(w.target)) names.add(w.label);
    if (cfg.fromDocuments) {
      const matterIds = new Set(ctx.matters.map((m) => m.id));
      for (const m of ctx.matters) if (m.judge) names.add(m.judge);
      const docs = intelDocuments().find((d) => (d.kind === "docket" || d.kind === "opinion") && (matterIds.size === 0 || d.matterIds.some((id) => matterIds.has(id))));
      for (const d of docs) for (const e of (d.meta?.entities as IntelEntityMention[] | undefined) ?? []) if (e.type === "judge") names.add(e.name);
    }
    const list = Array.from(names).map((n) => mention("judge", n)?.name).filter((n): n is string => Boolean(n)).slice(0, cfg.maxJudges);
    if (!list.length) { ctx.note("No judges to profile."); return; }
    for (const name of list) {
      if (ctx.budgetLeft() <= 0) break;
      const people = await ctx.attempt(`find judge ${name}`, () => ctx.providers.courtlistener.searchPeople({ name, limit: 3, signal: ctx.signal }), { provider: "courtlistener" });
      const person = people?.find((p) => p.positions.length) ?? people?.[0];
      if (!person) { if (people) ctx.note(`No CourtListener record for ${name}.`); continue; }
      const latest = [...person.positions].sort((a, b) => (b.dateStart ?? "").localeCompare(a.dateStart ?? ""))[0];
      const courtId = latest?.courtId;
      const text = [
        `${person.name}`,
        person.dateOfBirth ? `Born: ${person.dateOfBirth}` : "",
        "",
        "Positions",
        ...person.positions.map((p) => `• ${[p.title, p.court, p.appointer ? `appointed by ${p.appointer}` : "", p.howSelected, p.dateStart ? `${p.dateStart}${p.dateTermination ? ` – ${p.dateTermination}` : " – present"}` : ""].filter(Boolean).join(", ")}`),
      ].filter((l, i) => l || i > 0).join("\n");
      await ctx.attempt(`ingest judge ${person.name}`, () => ctx.ingest({
        kind: "judge",
        title: person.name,
        court: latest?.court,
        courtId,
        jurisdiction: jurisdictionForCourt(courtId),
        dates: { modified: ctx.now.toISOString().slice(0, 10), event: latest?.dateStart },
        url: person.url,
        externalId: `cl:person:${person.id}`,
        text,
        tags: ["judge"],
        entities: dedupeMentions([mention("judge", person.name, { externalId: `cl:person:${person.id}` }), courtMention(latest?.court, courtId)]),
        confidence: person.positions.length ? 0.85 : 0.5,
        meta: { personId: person.id, positions: person.positions.slice(0, 12), dateOfBirth: person.dateOfBirth, queriedAs: name },
      }));
    }
  },
});
