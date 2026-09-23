import "server-only";
import OpenAI from "openai";
import { aiConfig, AIConfigError } from "./config";

type G = typeof globalThis & { __leclaudeOpenAI?: OpenAI; __leclaudeOpenAIKey?: string };

/** Singleton OpenAI client. Throws AIConfigError (503) when no key is configured. */
export function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AIConfigError();
  const g = globalThis as G;
  if (g.__leclaudeOpenAI && g.__leclaudeOpenAIKey === key) return g.__leclaudeOpenAI;
  const client = new OpenAI({ apiKey: key, baseURL: aiConfig().baseURL, maxRetries: 2, timeout: 120_000 });
  g.__leclaudeOpenAI = client;
  g.__leclaudeOpenAIKey = key;
  return client;
}

export { aiConfig, AIConfigError };
