/** Model configuration, resolved from environment with sensible defaults. */
export interface AIConfig {
  model: string;
  fastModel: string;
  embeddingModel: string;
  imageModel: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  baseURL?: string;
  hasKey: boolean;
}

export function aiConfig(): AIConfig {
  const effort = (process.env.OPENAI_REASONING_EFFORT ?? "medium").trim() as AIConfig["reasoningEffort"];
  return {
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5.4",
    fastModel: process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5.4-mini",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-large",
    imageModel: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1.5",
    reasoningEffort: ["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort) ? effort : "medium",
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    hasKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

/** Reasoning-native models reject `temperature` and accept `reasoning.effort`. */
export function isReasoningModel(model: string) {
  return /^(gpt-5|gpt-6|o[1-9])/i.test(model) && !/chat-latest/i.test(model);
}

export class AIConfigError extends Error {
  status = 503;
  constructor(message = "OPENAI_API_KEY is not configured. Add it to .env.local to enable AI features.") {
    super(message);
    this.name = "AIConfigError";
  }
}
