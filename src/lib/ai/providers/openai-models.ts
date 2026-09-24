/** Coded knowledge about OpenAI model families (pure, client-safe). */

/** Reasoning-native models reject `temperature` and accept `reasoning.effort`. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o[1-9])/i.test(model) && !/chat-latest/i.test(model);
}

/**
 * Reasoning models spend hidden reasoning tokens against max_output_tokens. Callers size caps for the visible
 * answer, so give reasoning models generous headroom; otherwise responses come back `incomplete` with empty JSON.
 */
export function outputTokenBudget(model: string, requested: number | undefined): number | undefined {
  if (requested == null) return undefined;
  if (!isReasoningModel(model)) return requested;
  return Math.max(requested * 3, requested + 16_000);
}
