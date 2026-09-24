import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/lib/ai/capabilities";
import { describeModels, providerStates, readRuntimeEnv, type Env } from "@/lib/ai/providers/env";
import { InferenceError } from "@/lib/ai/providers/types";
import { providerOrder, roleForTask, routeModel, type RouteOptions } from "@/lib/ai/router";

const ENV_ALL: Env = {
  ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_MODEL: "claude-opus-4-6", ANTHROPIC_FAST_MODEL: "claude-haiku-4-5",
  AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "secret", BEDROCK_MODEL: "us.anthropic.claude-opus-4-6-v1", BEDROCK_EMBEDDING_MODEL: "amazon.titan-embed-text-v2:0",
  OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-5.4", OPENAI_FAST_MODEL: "gpt-5.4-mini",
  OPENROUTER_API_KEY: "or-test", OPENROUTER_ROUTER_MODEL: "meta-llama/llama-3.3-8b",
};

function options(env: Env): RouteOptions {
  const cfg = readRuntimeEnv(env);
  return { available: describeModels(cfg), preferred: cfg.preferred, allowExternalForMatterData: cfg.allowExternalForMatterData };
}

describe("registry configuration from environment", () => {
  it("counts a provider as configured only with credentials and a model id, and never guesses Anthropic/Bedrock ids", () => {
    const states = Object.fromEntries(providerStates(readRuntimeEnv({ ANTHROPIC_API_KEY: "k", AWS_REGION: "us-east-1", AWS_BEARER_TOKEN_BEDROCK: "t", OPENROUTER_API_KEY: "o" })).map((s) => [s.id, s]));
    expect(states.anthropic.configured).toBe(false);
    expect(states.anthropic.missing).toEqual(["ANTHROPIC_MODEL"]);
    expect(states.bedrock.configured).toBe(false);
    expect(states.bedrock.missing).toEqual(["BEDROCK_MODEL"]);
    expect(states.openrouter.configured).toBe(false);
    expect(states.openai.configured).toBe(false);
    expect(states.openai.missing).toEqual(["OPENAI_API_KEY"]);
    expect(describeModels(readRuntimeEnv({ ANTHROPIC_API_KEY: "k" }))).toEqual([]);
    // OpenAI keeps the legacy defaults so a key alone still configures it
    const openai = describeModels(readRuntimeEnv({ OPENAI_API_KEY: "sk" }));
    expect(openai.map((m) => [m.id, m.roles.join("+")])).toEqual([["gpt-5.4", "primary+vision"], ["gpt-5.4-mini", "fast+router+vision"], ["text-embedding-3-large", "embedding"], ["gpt-image-1.5", "image"]]);
    // never a secret in the descriptors or states
    expect(JSON.stringify(providerStates(readRuntimeEnv(ENV_ALL)))).not.toMatch(/sk-ant-test|secret|or-test/);
  });

  it("assigns roles from the variables that name the model and marks Claude models as reasoning-capable", () => {
    const models = describeModels(readRuntimeEnv(ENV_ALL));
    const find = (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id)!;
    expect(find("anthropic", "claude-opus-4-6")).toMatchObject({ roles: ["primary", "vision"], privacy: "internal", reasoning: true, costTier: 3 });
    expect(find("anthropic", "claude-haiku-4-5")).toMatchObject({ roles: ["fast", "router", "vision"], reasoning: false });
    expect(find("bedrock", "us.anthropic.claude-opus-4-6-v1").roles).toEqual(["primary", "vision", "fast", "router"]); // no BEDROCK_FAST_MODEL → primary serves fast/router
    expect(find("bedrock", "amazon.titan-embed-text-v2:0").roles).toEqual(["embedding"]);
    expect(find("openrouter", "meta-llama/llama-3.3-8b")).toMatchObject({ roles: ["router"], privacy: "external" });
    expect(describeModels(readRuntimeEnv({ ...ENV_ALL, BEDROCK_THINKING_BUDGET: "4096", BEDROCK_MODEL: "anthropic.claude-3-5-sonnet-20241022-v2:0" })).find((m) => m.provider === "bedrock" && m.roles.includes("primary"))!.reasoning).toBe(true);
  });
});

describe("routeModel", () => {
  it("maps tasks to roles and orders providers Claude-first with the MODEL_PROVIDER preference", () => {
    expect(roleForTask("classify")).toBe("fast");
    expect(roleForTask("route")).toBe("router");
    expect(roleForTask("draft")).toBe("primary");
    expect(providerOrder("primary")).toEqual(["bedrock", "anthropic", "openai"]);
    expect(providerOrder("primary", "openai")).toEqual(["openai", "bedrock", "anthropic"]);
    expect(providerOrder("router")).toEqual(["openrouter", "bedrock", "anthropic", "openai"]);
    expect(providerOrder("embedding")).toEqual(["openai", "bedrock"]);
  });

  it("chooses the first eligible provider in role order and lists the other eligible models as fallbacks", () => {
    const d = routeModel({ taskType: "draft", privacy: "internal" }, options(ENV_ALL));
    expect(d).toMatchObject({ provider: "bedrock", model: "us.anthropic.claude-opus-4-6-v1" });
    expect(d.fallbacks).toEqual([{ provider: "anthropic", model: "claude-opus-4-6" }, { provider: "openai", model: "gpt-5.4" }]);
    expect(routeModel({ taskType: "draft", privacy: "internal" }, options({ ...ENV_ALL, MODEL_PROVIDER: "anthropic" }))).toMatchObject({ provider: "anthropic", model: "claude-opus-4-6" });
    expect(routeModel({ taskType: "classify", privacy: "internal" }, options({ ...ENV_ALL, MODEL_PROVIDER: "anthropic" }))).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(routeModel({ taskType: "embed", privacy: "internal" }, options(ENV_ALL))).toMatchObject({ provider: "openai", model: "text-embedding-3-large" });
    expect(routeModel({ taskType: "embed", privacy: "internal" }, options({ ...ENV_ALL, OPENAI_API_KEY: "" }))).toMatchObject({ provider: "bedrock", model: "amazon.titan-embed-text-v2:0" });
  });

  it("honours explicit models when configured and eligible, and fails closed otherwise", () => {
    expect(routeModel({ taskType: "draft", privacy: "internal", explicitModel: "gpt-5.4-mini" }, options(ENV_ALL))).toMatchObject({ provider: "openai", model: "gpt-5.4-mini", reason: "explicit model" });
    expect(() => routeModel({ taskType: "draft", privacy: "internal", explicitModel: "claude-opus-9" }, options(ENV_ALL))).toThrow(expect.objectContaining({ code: "not_configured" }));
    expect(() => routeModel({ taskType: "draft", privacy: "internal", explicitModel: "us.anthropic.claude-opus-4-6-v1", needs: { serverWebSearch: true } }, options(ENV_ALL))).toThrow(/lacks: serverWebSearch/);
  });

  it("enforces the external data boundary for the router role", () => {
    const only = { OPENROUTER_API_KEY: "or", OPENROUTER_ROUTER_MODEL: "meta-llama/llama-3.3-8b" };
    expect(() => routeModel({ taskType: "route", privacy: "internal" }, options(only))).toThrow(expect.objectContaining({ code: "privacy_boundary" }));
    expect(routeModel({ taskType: "route", privacy: "external" }, options(only))).toMatchObject({ provider: "openrouter" });
    expect(routeModel({ taskType: "route", privacy: "internal" }, options({ ...only, ROUTER_ALLOW_MATTER_DATA: "true" }))).toMatchObject({ provider: "openrouter" });
    // with an internal fast model available, internal routing skips OpenRouter entirely
    expect(routeModel({ taskType: "route", privacy: "internal" }, options(ENV_ALL))).toMatchObject({ provider: "bedrock" });
    expect(routeModel({ taskType: "route", privacy: "external" }, options(ENV_ALL))).toMatchObject({ provider: "openrouter" });
  });

  it("excludes providers that lack a needed capability and explains the failure", () => {
    const bedrockOnly = { AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", BEDROCK_MODEL: "us.anthropic.claude-opus-4-6-v1" };
    expect(routeModel({ taskType: "draft", privacy: "internal", needs: { serverWebSearch: true } }, options(ENV_ALL))).toMatchObject({ provider: "anthropic" });
    let err: unknown;
    try { routeModel({ taskType: "draft", privacy: "internal", needs: { serverWebSearch: true } }, options(bedrockOnly)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(InferenceError);
    expect((err as InferenceError).code).toBe("capability_unavailable");
    expect((err as InferenceError).message).toMatch(/serverWebSearch/);
    expect(() => routeModel({ taskType: "draft", privacy: "internal" }, options({}))).toThrow(expect.objectContaining({ code: "not_configured" }));
    expect(() => routeModel({ taskType: "image", privacy: "internal" }, options(bedrockOnly))).toThrow(expect.objectContaining({ code: "capability_unavailable" }));
  });

  it("serves the vision role from a vision-capable primary model", () => {
    expect(routeModel({ taskType: "vision", privacy: "internal" }, options({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-opus-4-6" }))).toMatchObject({ provider: "anthropic", model: "claude-opus-4-6" });
    expect(CAPABILITIES.anthropic.vision).toBe(true);
  });
});
