import "server-only";
import { intelBootstrap } from "../bootstrap";
import { registerAnalysisJobHandlers, scheduleAnalysisIfStale } from "./jobs";
import { ensureIntelAnalysisSeeded } from "./seed";

/**
 * Called by every analysis route and /intel page: runs the core bootstrap
 * (seed + background loop), seeds the analysis layer on older databases,
 * registers the analysis job handlers with the runner and queues an analysis
 * pass when documents changed since the last one.
 */
export function intelAnalysisBootstrap(): void {
  intelBootstrap();
  try { ensureIntelAnalysisSeeded(); } catch (e) { console.warn("[intel] analysis seed failed", (e as Error).message); }
  try { registerAnalysisJobHandlers(); } catch (e) { console.warn("[intel] analysis handlers failed", (e as Error).message); }
  try { scheduleAnalysisIfStale(); } catch (e) { console.warn("[intel] analysis scheduling failed", (e as Error).message); }
}
