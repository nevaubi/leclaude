/**
 * Which model role each research step runs on (constitution §15–§17, §36). The router maps
 * `taskType` to a role (`roleForTask`): bounded decisions (planning, query rewriting, snippet
 * triage, lane reading notes, claim extraction/verification, follow-ups) go to the fast role;
 * only the synthesis runs on the primary model. Client-safe constants; defaultDeps reads them
 * so tests can assert the routing without a network call.
 */
import type { ReasoningEffort, TaskType } from "@/lib/ai/providers/types";

export type ResearchStep = "plan" | "refine" | "triage" | "laneAgent" | "verify" | "correct" | "followUps" | "synthesize";

export interface StepPolicy {
  taskType: TaskType;
  /** true → the fast model role; false → primary. Must agree with roleForTask(taskType) for generate* helpers. */
  fast: boolean;
  /** Omitted → the configured default effort for the role. */
  reasoningEffort?: ReasoningEffort;
  /** Byte-stable instructions + tool definitions are marked cacheable. */
  cacheStablePrefix: boolean;
  maxOutputTokens: number;
}

export const RESEARCH_MODEL_POLICY: Record<ResearchStep, StepPolicy> = {
  plan: { taskType: "extract", fast: true, reasoningEffort: "low", cacheStablePrefix: true, maxOutputTokens: 700 },
  refine: { taskType: "extract", fast: true, reasoningEffort: "low", cacheStablePrefix: true, maxOutputTokens: 600 },
  triage: { taskType: "classify", fast: true, reasoningEffort: "low", cacheStablePrefix: true, maxOutputTokens: 400 },
  laneAgent: { taskType: "summarize", fast: true, reasoningEffort: "low", cacheStablePrefix: true, maxOutputTokens: 1800 },
  verify: { taskType: "extract", fast: true, reasoningEffort: "low", cacheStablePrefix: true, maxOutputTokens: 6000 },
  correct: { taskType: "summarize", fast: true, reasoningEffort: "low", cacheStablePrefix: true, maxOutputTokens: 4000 },
  followUps: { taskType: "extract", fast: true, reasoningEffort: "low", cacheStablePrefix: true, maxOutputTokens: 400 },
  synthesize: { taskType: "synthesize", fast: false, cacheStablePrefix: true, maxOutputTokens: 8000 },
};
