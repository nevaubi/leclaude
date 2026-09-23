import "server-only";
import { runAgent, strictJsonSchema } from "@/lib/ai/agent";
import { aiConfig } from "@/lib/ai/config";
import { researchToolset } from "@/lib/ai/toolkit";
import { FIRM_NAME, LEGAL_STYLE_RULES } from "@/lib/ai/prompts";
import { collectBriefFacts, computeFallbackBrief, briefStats, renderFactsForModel } from "./brief-fallback";
import { buildBriefContext, cacheBrief } from "./service";
import { CURRENT_USER_ID, type BriefItem, type DailyBrief } from "./types";
import { dateKey } from "./time";

const BRIEF_SCHEMA = strictJsonSchema({
  type: "object",
  properties: {
    headline: { type: "string", description: "One line, ≤ 90 characters, the shape of the day." },
    items: {
      type: "array",
      description: "6 to 10 bullets, most urgent first.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["deadline", "hearing", "task", "news", "update", "matter", "note"] },
          text: { type: "string", description: "One or two sentences. Specific: names, dates, Bates or docket numbers when given." },
          matterId: { type: "string", description: "Matter id when the bullet concerns one matter" },
          href: { type: "string", description: "In-app link: /#calendar, /#tasks, /#news, /#updates, /ediscovery?matter=<id>, or the news URL" },
        },
        required: ["kind", "text"],
      },
    },
  },
  required: ["headline", "items"],
});

interface BriefJson { headline: string; items: { kind: BriefItem["kind"]; text: string; matterId?: string | null; href?: string | null }[] }

/**
 * Generate the AI daily brief with the fast model and the internal research
 * toolset (library, e-discovery, matter context). Throws AIConfigError when
 * no key is configured; callers fall back to computeFallbackBrief.
 */
export async function generateDailyBrief(opts: { now?: Date; userId?: string; signal?: AbortSignal } = {}): Promise<DailyBrief> {
  const now = opts.now ?? new Date();
  const userId = opts.userId ?? CURRENT_USER_ID;
  const ctx = buildBriefContext(now, userId);
  const facts = collectBriefFacts(ctx);
  const cfg = aiConfig();
  const { tools } = researchToolset({ web: false, legal: false, internal: true });

  const instructions = [
    `You write the morning brief for ${ctx.userName}, a partner at ${FIRM_NAME}. Today is ${facts.today}.`,
    "Produce a headline and 6–10 bullets that a busy litigator can act on before 9 a.m. Order: today's calendar, overdue and due-soon tasks, matter deadlines in the next 30 days, hearings/depositions later this week, hot news that changes strategy, then team updates that need a reply.",
    "Every bullet must be grounded in the facts provided (or in a tool result). Use names, dates, docket/CMO references and Bates numbers exactly as given. Say 'in 3 days' / 'overdue 2 days' rather than raw dates where it helps. No filler, no motivational language.",
    "Use get_matter_context only if you need a detail that is missing from the facts. Do not search the library or e-discovery unless a bullet requires it.",
    LEGAL_STYLE_RULES,
  ].join("\n\n");

  const result = await runAgent({
    instructions,
    input: renderFactsForModel(ctx, facts),
    tools,
    model: cfg.fastModel,
    reasoningEffort: "low",
    maxSteps: 3,
    maxOutputTokens: 1800,
    jsonSchema: { name: "daily_brief", schema: BRIEF_SCHEMA },
    metadata: { app: "leclaude", surface: "home-brief" },
    signal: opts.signal,
    onEvent: () => {},
  });

  const json = (result.json ?? safeParse(result.text)) as BriefJson | undefined;
  if (!json?.items?.length) {
    // Model returned nothing usable; keep the card populated.
    return { ...computeFallbackBrief(ctx), model: cfg.fastModel };
  }
  const brief: DailyBrief = {
    date: dateKey(now),
    generatedAt: now.toISOString(),
    source: "ai",
    model: cfg.fastModel,
    headline: json.headline?.trim() || computeFallbackBrief(ctx).headline,
    items: json.items.slice(0, 10).map((it) => ({ kind: it.kind ?? "note", text: it.text.trim(), matterId: it.matterId ?? null, href: it.href ?? null })),
    stats: briefStats(facts),
  };
  cacheBrief(brief);
  return brief;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}
