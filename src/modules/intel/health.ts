import "server-only";
import { adapterInfos } from "./adapters";
import { loopState } from "./background";
import { intelConfig, providerStatuses } from "./config";
import { jobCounts } from "./jobs";
import { intelChunks, intelDocuments, intelEntities, intelInsights, intelSources } from "./store";
import { lastSweepReport } from "./steward";
import { INTEL_STALE_AFTER_DAYS, type IntelConfigView, type IntelHealth } from "./types";

export function intelHealth(now = new Date()): IntelHealth {
  const sources = intelSources().all();
  const insights = intelInsights().all();
  return {
    sources: { total: sources.length, enabled: sources.filter((s) => s.enabled).length, erroring: sources.filter((s) => s.enabled && !s.health.ok).length, running: sources.filter((s) => s.status === "running").length },
    jobs: jobCounts(now),
    documents: intelDocuments().count(),
    chunks: intelChunks().count(),
    entities: intelEntities().count(),
    insights: { total: insights.length, flagged: insights.filter((i) => i.status === "flagged" || i.flags.length > 0).length, pendingVerification: insights.filter((i) => i.status === "draft" || !i.provenance.verification).length },
    lastSweepAt: lastSweepReport()?.at,
    background: intelConfig().background,
  };
}

/** Non-secret configuration view for Settings → Data & automation. */
export function intelConfigView(): IntelConfigView {
  const cfg = intelConfig();
  const providers = providerStatuses(cfg);
  const loop = loopState();
  return {
    background: cfg.background,
    corpusDirs: cfg.corpusDirs,
    providers,
    adapters: adapterInfos(providers),
    staleAfterDays: INTEL_STALE_AFTER_DAYS,
    jobs: { concurrency: cfg.concurrency, tickMs: cfg.tickMs, orphanAfterMs: cfg.orphanAfterMs },
    loop: loop ? { startedAt: loop.startedAt, lastTickAt: loop.lastTickAt, ticks: loop.ticks, lastError: loop.lastError } : undefined,
  };
}
