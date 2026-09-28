/**
 * Model routing for the research engine (constitution §15–§17, §36–§37): planning, query rewriting, triage,
 * lane reading, claim verification and follow-ups run on the fast role; only synthesis runs on the primary role;
 * stable prefixes are marked cacheable. The agent facade is mocked so the real defaultDeps() can be exercised
 * without a network call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: { fn: string; opts: Record<string, unknown> }[] = [];

vi.mock("@/lib/ai/agent", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/agent")>();
  return {
    ...real,
    generateJSON: vi.fn(async (opts: Record<string, unknown>) => {
      captured.push({ fn: "generateJSON", opts });
      if (opts.name === "research_plan") return { subQuestions: ["What standard governs removal in the Fourth Circuit?"], lanes: [{ lane: "contrary", queries: ["\"federal officer\" AND declined"] }] };
      if (opts.name === "claim_verification") return { verdicts: [] };
      if (opts.name === "follow_ups") return { questions: ["a", "b", "c"] };
      return { refinements: [] };
    }),
    generateText: vi.fn(async (opts: Record<string, unknown>) => { captured.push({ fn: "generateText", opts }); return { text: "revised", responseId: "r" }; }),
    runAgent: vi.fn(async (opts: Record<string, unknown> & { onEvent: (e: unknown) => void }) => {
      captured.push({ fn: "runAgent", opts });
      opts.onEvent({ type: "text.delta", delta: "answer" });
      return { text: "answer", responseId: null, steps: 0, toolCalls: [], usage: { input: 1, output: 1, total: 2 } };
    }),
  };
});

import { roleForTask } from "@/lib/ai/router";
import { aiConfig } from "@/lib/ai/config";
import { defaultDeps } from "@/modules/search/engine/deps";
import { RESEARCH_MODEL_POLICY } from "@/modules/search/engine/model-policy";
import { PLAN_INSTRUCTIONS } from "@/modules/search/engine/prompts";

beforeEach(() => { captured.length = 0; });

describe("research model policy", () => {
  it("maps every bounded step to the fast role and only synthesis to the primary role", () => {
    for (const [step, p] of Object.entries(RESEARCH_MODEL_POLICY)) {
      expect(roleForTask(p.taskType), step).toBe(p.fast ? "fast" : "primary");
      expect(p.cacheStablePrefix, step).toBe(true);
    }
    expect(RESEARCH_MODEL_POLICY.synthesize.fast).toBe(false);
    for (const step of ["plan", "refine", "triage", "laneAgent", "verify", "correct", "followUps"] as const) expect(RESEARCH_MODEL_POLICY[step].fast, step).toBe(true);
  });

  it("defaultDeps plans on the fast model with a byte-stable prefix, synthesizes on the primary role with evidence blocks", async () => {
    const deps = defaultDeps();
    const plan = await deps.planQueries!({ question: "Is removal available?", context: "Today's date is 2026-09-28.", laneKinds: ["controlling", "contrary"] });
    expect(plan.subQuestions[0]).toContain("Fourth Circuit");
    expect(plan.queries.contrary).toEqual(["\"federal officer\" AND declined"]);
    const p = captured.find((c) => c.opts.name === "research_plan")!.opts;
    expect(p.fast).toBe(true);
    expect(roleForTask(p.taskType as never)).toBe("fast");
    expect(p.cacheStablePrefix).toBe(true);
    expect(p.instructions).toBe(PLAN_INSTRUCTIONS);
    expect(String(p.input)).toContain("Today's date"); // volatile context travels in the input, not the instructions

    const evidence = [{ type: "search_result" as const, source: "authority://courtlistener/opinion/112120", title: "Source 1 — Boyle", content: ["¶1 text"], citationsEnabled: true }];
    const deltas: string[] = [];
    await deps.synthesize({ instructions: "stable", input: "question last", evidence, onDelta: (d) => deltas.push(d) });
    const s = captured.find((c) => c.fn === "runAgent")!.opts;
    expect(s.taskType).toBe("synthesize");
    expect(roleForTask(s.taskType as never)).toBe("primary");
    expect(s.model).toBeUndefined();
    expect(s.evidence).toEqual(evidence);
    expect(s.cacheStablePrefix).toBe(true);
    expect(deltas).toEqual(["answer"]);

    captured.length = 0;
    await deps.laneAgent({ instructions: "lane", input: "x", tools: [], web: false, maxSteps: 2, onEvent: () => {} });
    const lane = captured[0].opts;
    expect(lane.model).toBe(aiConfig().fastModel);
    expect(roleForTask(lane.taskType as never)).toBe("fast");

    captured.length = 0;
    await deps.verify({ answer: "a", sources: [{ title: "t", text: "some source text" }] });
    await deps.refine({ question: "q", gaps: ["g"], laneKinds: ["controlling"] });
    await deps.followUps({ question: "q", answer: "a", matterLine: "m" });
    await deps.correct({ instructions: "c", input: "i" });
    expect(captured.length).toBe(4);
    for (const c of captured) expect(c.opts.fast, `${c.fn}:${String(c.opts.name)}`).toBe(true);
  });
});
