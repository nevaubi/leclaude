/**
 * Model router (constitution §15, §16, §17). Pure decision logic over the configured providers and the
 * coded capability matrix; no provider SDK, no raw model ids. Providers register through
 * src/lib/ai/providers/registry.ts (server-only) and expose the models their configuration names.
 */
import { CAPABILITIES, missingCapabilities, satisfies } from "./capabilities";
import { InferenceError, type ModelDescriptor, type ModelRole, type ProviderId, type RouterInput, type RoutingDecision, type TaskType } from "./providers/types";

/** Task → role mapping. Heavy legal reasoning goes to the primary model; bounded decisions to the fast model; routing to the router. */
export function roleForTask(task: TaskType): ModelRole {
  switch (task) {
    case "route": return "router";
    case "classify": case "extract": case "summarize": return "fast";
    case "embed": return "embedding";
    case "image": return "image";
    case "vision": return "vision";
    default: return "primary";
  }
}

/** Provider preference order for a role. Fable/Claude providers first (constitution §17), OpenAI as the fallback runtime. */
export function providerOrder(role: ModelRole, preferred?: ProviderId | null): ProviderId[] {
  const base: ProviderId[] = role === "router" ? ["openrouter", "bedrock", "anthropic", "openai"] : role === "embedding" ? ["openai", "bedrock"] : role === "image" ? ["openai"] : ["bedrock", "anthropic", "openai"];
  if (preferred && base.includes(preferred)) return [preferred, ...base.filter((p) => p !== preferred)];
  return base;
}

export interface RouteOptions {
  /** Models the configured providers can serve. */
  available: ModelDescriptor[];
  /** MODEL_PROVIDER preference from configuration. */
  preferred?: ProviderId | null;
  /** Whether matter (confidential) data may leave the internal boundary for external routers (ROUTER_ALLOW_MATTER_DATA). */
  allowExternalForMatterData?: boolean;
}

/**
 * Choose a model. Explicit models win when configured and eligible; otherwise the first configured provider in role order whose
 * capability profile satisfies the request. Fails closed with a precise InferenceError instead of guessing.
 */
export function routeModel(input: RouterInput, opts: RouteOptions): RoutingDecision {
  const role = input.role ?? roleForTask(input.taskType);
  const needs = { ...(input.needs ?? {}) };
  if (role === "embedding") needs.embeddings = true;
  if (role === "image") needs.imageGeneration = true;
  if (role === "vision") needs.vision = true;
  const eligible = (d: ModelDescriptor) => {
    if (input.privacy === "internal" && d.privacy === "external" && !opts.allowExternalForMatterData) return false;
    return satisfies(d.capabilities, needs);
  };
  const candidates = opts.available.filter((d) => d.roles.includes(role) || (role === "vision" && d.capabilities.vision && d.roles.includes("primary")));

  if (input.explicitModel) {
    const d = opts.available.find((m) => m.id === input.explicitModel && (!input.explicitProvider || m.provider === input.explicitProvider));
    if (!d) throw new InferenceError("not_configured", `Model "${input.explicitModel}" is not served by any configured provider.`);
    if (!eligible(d)) {
      const missing = missingCapabilities(d.capabilities, needs);
      throw new InferenceError(missing.length ? "capability_unavailable" : "privacy_boundary", missing.length ? `Model "${d.id}" (${d.provider}) lacks: ${missing.join(", ")}.` : `Model "${d.id}" (${d.provider}) is outside the internal data boundary; matter data may not be sent to it.`, { provider: d.provider });
    }
    return { provider: d.provider, model: d.id, descriptor: d, reason: "explicit model", fallbacks: fallbacksFor(d, candidates.filter(eligible)) };
  }

  const order = providerOrder(role, input.explicitProvider ?? opts.preferred ?? null);
  for (const provider of order) {
    const d = candidates.find((m) => m.provider === provider && eligible(m));
    if (d) return { provider: d.provider, model: d.id, descriptor: d, reason: `${role} role → first eligible provider (${provider})`, fallbacks: fallbacksFor(d, candidates.filter(eligible)) };
  }
  const configured = Array.from(new Set(opts.available.map((m) => m.provider)));
  if (!configured.length) throw new InferenceError("not_configured", "No model provider is configured. Set ANTHROPIC_API_KEY, AWS credentials with BEDROCK_MODEL, or OPENAI_API_KEY.");
  const needed = Object.entries(needs).filter(([, v]) => v).map(([k]) => k);
  if (role === "router" && input.privacy === "internal") {
    throw new InferenceError("privacy_boundary", "No internal router model is configured and matter data may not be sent to the external router (set ROUTER_ALLOW_MATTER_DATA=true or configure a fast internal model).");
  }
  throw new InferenceError("capability_unavailable", `No configured provider (${configured.join(", ")}) serves the ${role} role${needed.length ? ` with ${needed.join(", ")}` : ""}. Capabilities are declared in src/lib/ai/capabilities.ts.`);
}

function fallbacksFor(chosen: ModelDescriptor, eligible: ModelDescriptor[]) {
  return eligible.filter((m) => m.id !== chosen.id || m.provider !== chosen.provider).map((m) => ({ provider: m.provider, model: m.id }));
}

export { CAPABILITIES };
