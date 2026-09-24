import "server-only";
/**
 * Provider registry (constitution §15, §53.5): builds the configured ModelProviders from the environment only and
 * exposes the models they serve. Nothing outside src/lib/ai/providers instantiates a provider or names a model id.
 */
import { AnthropicProvider } from "./anthropic";
import { BedrockProvider } from "./bedrock";
import { describeModels, providerStates, readRuntimeEnv, type RuntimeEnv } from "./env";
import { OpenAIProvider } from "./openai";
import { OpenRouterProvider } from "./openrouter";
import type { ModelDescriptor, ModelProvider, ProviderId } from "./types";

export interface ProviderRegistry {
  env: RuntimeEnv;
  providers: Map<ProviderId, ModelProvider>;
  models: ModelDescriptor[];
  preferred: ProviderId | null;
  allowExternalForMatterData: boolean;
}

/** Instantiate every provider whose credentials and model ids are present. Never guesses a model id. */
export function buildProviders(env: RuntimeEnv = readRuntimeEnv()): ModelProvider[] {
  const models = describeModels(env);
  const configured = new Set(providerStates(env).filter((s) => s.configured).map((s) => s.id));
  const own = (id: ProviderId) => models.filter((m) => m.provider === id);
  const out: ModelProvider[] = [];
  if (configured.has("bedrock")) out.push(new BedrockProvider(env.bedrock, own("bedrock")));
  if (configured.has("anthropic")) out.push(new AnthropicProvider(env.anthropic, own("anthropic")));
  if (configured.has("openai")) out.push(new OpenAIProvider(env.openai, own("openai")));
  if (configured.has("openrouter")) out.push(new OpenRouterProvider(env.openrouter, own("openrouter")));
  return out.filter((p) => p.isConfigured());
}

type G = typeof globalThis & { __leclaudeProviderRegistry?: { key: string; registry: ProviderRegistry } };

/** Cached per environment snapshot, so a changed variable (tests, hot reload) rebuilds the providers. */
export function getRegistry(): ProviderRegistry {
  const env = readRuntimeEnv();
  const key = JSON.stringify(env);
  const g = globalThis as G;
  if (g.__leclaudeProviderRegistry?.key === key) return g.__leclaudeProviderRegistry.registry;
  const providers = buildProviders(env);
  const registry: ProviderRegistry = {
    env,
    providers: new Map(providers.map((p) => [p.id, p])),
    models: providers.flatMap((p) => p.models()),
    preferred: env.preferred,
    allowExternalForMatterData: env.allowExternalForMatterData,
  };
  g.__leclaudeProviderRegistry = { key, registry };
  return registry;
}

export function resetProviderRegistry(): void {
  delete (globalThis as G).__leclaudeProviderRegistry;
}

export function availableModels(): ModelDescriptor[] {
  return getRegistry().models;
}

export function getProvider(id: ProviderId): ModelProvider | undefined {
  return getRegistry().providers.get(id);
}
