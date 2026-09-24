import "server-only";
import { intelConfig } from "../config";
import { type ProviderFactoryOptions } from "./base";
import { dbHttpCache } from "./cache";
import { createCourtListener, type CourtListenerProvider } from "./courtlistener";
import { createEcfr, type EcfrProvider } from "./ecfr";
import { createFederalRegister, type FederalRegisterProvider } from "./federal-register";
import { createFirecrawl, type FirecrawlProvider } from "./firecrawl";
import { createGovInfo, type GovInfoProvider } from "./govinfo";
import { createJpml, type JpmlProvider } from "./jpml";
import { createOpenFda, type OpenFdaProvider } from "./openfda";
import { createTavily, type TavilyProvider } from "./tavily";
import { createWeb, type WebProvider } from "./web";

/** Every provider an adapter may use. Tests pass fakes with the same shape. */
export interface IntelProviders {
  courtlistener: CourtListenerProvider;
  ecfr: EcfrProvider;
  federalRegister: FederalRegisterProvider;
  govinfo: GovInfoProvider;
  openfda: OpenFdaProvider;
  firecrawl: FirecrawlProvider;
  tavily: TavilyProvider;
  web: WebProvider;
  jpml: JpmlProvider;
}

/** Build the provider bundle. Defaults: DB-backed 24h cache and the process-wide rate limiters. */
export function createProviders(opts: ProviderFactoryOptions = {}): IntelProviders {
  const cfg = intelConfig();
  const base: ProviderFactoryOptions = { cache: opts.cache ?? dbHttpCache(), offline: opts.offline ?? cfg.offline, ...opts };
  const firecrawl = createFirecrawl(base);
  return {
    courtlistener: createCourtListener(base),
    ecfr: createEcfr(base),
    federalRegister: createFederalRegister(base),
    govinfo: createGovInfo(base),
    openfda: createOpenFda(base),
    firecrawl,
    tavily: createTavily(base),
    web: createWeb({ ...base, firecrawl }),
    jpml: createJpml(base),
  };
}

type G = typeof globalThis & { __leclaudeIntelProviders?: IntelProviders };

/** Process-wide bundle (keys are read from the environment at creation; call resetProviders() after changing env in tests). */
export function defaultProviders(): IntelProviders {
  const g = globalThis as G;
  if (!g.__leclaudeIntelProviders) g.__leclaudeIntelProviders = createProviders();
  return g.__leclaudeIntelProviders;
}

export function resetProviders() {
  (globalThis as G).__leclaudeIntelProviders = undefined;
}

export { ProviderError, isProviderError, toIntelErrorCode, asProviderError } from "./base";
export type { ProviderFactoryOptions } from "./base";
export { dbHttpCache, pruneHttpCache, httpCacheStats } from "./cache";
