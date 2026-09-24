/**
 * Provider configuration status for Settings → Research providers and the
 * intel layer. Reads env *presence* only; values never leave the server.
 * Pure over an env-like object so it is unit-tested.
 */

export type ProviderId = "openai" | "courtlistener" | "govinfo" | "ecfr" | "federal-register" | "firecrawl" | "tavily" | "openfda" | "local-corpus";

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  /** What the provider is used for. */
  role: string;
  /** Env variable(s) that configure it (names only). */
  env: string[];
  configured: boolean;
  /** "configured" | "public" (works without a key) | "not configured". */
  state: "configured" | "public" | "missing";
  /** Short human status: "key set", "anonymous (rate-limited)", "2 folders". */
  detail: string;
  /** Optional: extra facts that are safe to show (never values of secrets). */
  facts?: Record<string, string | number>;
}

type Env = Record<string, string | undefined>;

const present = (env: Env, key: string) => Boolean(env[key]?.trim());

/** Comma-separated folder list from LECLAUDE_CORPUS_DIRS (paths are configuration, not secrets, but only the count is reported by default). */
export function corpusDirs(env: Env): string[] {
  return (env.LECLAUDE_CORPUS_DIRS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function providerStatuses(env: Env = process.env as Env): ProviderStatus[] {
  const openai = present(env, "OPENAI_API_KEY");
  const cl = present(env, "COURTLISTENER_API_TOKEN");
  const gov = present(env, "GOVINFO_API_KEY") && env.GOVINFO_API_KEY?.trim() !== "DEMO_KEY";
  const fc = present(env, "FIRECRAWL_API_KEY");
  const tv = present(env, "TAVILY_API_KEY");
  const fda = present(env, "OPENFDA_API_KEY");
  const dirs = corpusDirs(env);
  return [
    { id: "openai", name: "OpenAI", role: "Every AI feature: assistants, research synthesis, verification, embeddings", env: ["OPENAI_API_KEY"], configured: openai, state: openai ? "configured" : "missing", detail: openai ? "key set" : "add OPENAI_API_KEY", facts: { model: env.OPENAI_MODEL?.trim() || "default", fastModel: env.OPENAI_FAST_MODEL?.trim() || "default" } },
    { id: "courtlistener", name: "CourtListener", role: "Case law, dockets, judges, citation lookup", env: ["COURTLISTENER_API_TOKEN"], configured: cl, state: cl ? "configured" : "public", detail: cl ? "token set" : "anonymous (rate-limited)" },
    { id: "ecfr", name: "eCFR", role: "Regulations (Code of Federal Regulations)", env: [], configured: true, state: "public", detail: "public, no key needed" },
    { id: "federal-register", name: "Federal Register", role: "Notices, proposed and final rules", env: [], configured: true, state: "public", detail: "public, no key needed" },
    { id: "govinfo", name: "GovInfo", role: "U.S. Code, Public Laws, congressional materials", env: ["GOVINFO_API_KEY"], configured: gov, state: gov ? "configured" : "public", detail: gov ? "key set" : "DEMO_KEY (low rate limit)" },
    { id: "firecrawl", name: "Firecrawl", role: "Web scraping and crawling for court rules, news and web lists", env: ["FIRECRAWL_API_KEY"], configured: fc, state: fc ? "configured" : "missing", detail: fc ? "key set" : "plain fetch fallback" },
    { id: "tavily", name: "Tavily", role: "Web search and extraction for the intelligence layer", env: ["TAVILY_API_KEY"], configured: tv, state: tv ? "configured" : "missing", detail: tv ? "key set" : "not configured" },
    { id: "openfda", name: "openFDA", role: "Recalls, enforcement reports, drug labels, device events", env: ["OPENFDA_API_KEY"], configured: true, state: fda ? "configured" : "public", detail: fda ? "key set" : "anonymous (rate-limited)" },
    { id: "local-corpus", name: "Local corpus", role: "The firm's document folders, indexed by the local-corpus adapter", env: ["LECLAUDE_CORPUS_DIRS"], configured: dirs.length > 0, state: dirs.length ? "configured" : "missing", detail: dirs.length ? `${dirs.length} folder${dirs.length === 1 ? "" : "s"}` : "no folders configured", facts: { folders: dirs.length } },
  ];
}

export interface ProvidersPayload { providers: ProviderStatus[]; summary: { configured: number; public: number; missing: number }; background: "inline" | "cron" | "off"; dataDir: string }

export function providersPayload(env: Env = process.env as Env): ProvidersPayload {
  const providers = providerStatuses(env);
  const bg = (env.LECLAUDE_BACKGROUND ?? "inline").trim().toLowerCase();
  return {
    providers,
    summary: { configured: providers.filter((p) => p.state === "configured").length, public: providers.filter((p) => p.state === "public").length, missing: providers.filter((p) => p.state === "missing").length },
    background: bg === "cron" || bg === "off" ? bg : "inline",
    dataDir: env.LECLAUDE_DATA_DIR?.trim() || "./data",
  };
}
