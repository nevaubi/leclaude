import "server-only";
import { ensureScheduledScans } from "@/lib/integrity/bootstrap";
import { ensureScheduler } from "@/modules/workflows/scheduler";
import { intelConfig } from "./config";
import { runDue } from "./jobs";
import { ensureIntelSeeded } from "./seed";
import type { IntelHealth } from "./types";

/**
 * In-process driver started by src/instrumentation.ts. Every 30 seconds it
 * runs due intel jobs; at boot it also starts the workflow scheduler (60s
 * tick) and the integrity scan timer (6h), which otherwise only start lazily
 * from request handlers. Guarded on globalThis; timers are unref'd so the
 * process can exit; nothing runs when LECLAUDE_BACKGROUND is "off" or "cron".
 */
export interface IntelLoopState {
  mode: IntelHealth["background"];
  timer: ReturnType<typeof setInterval> | null;
  startedAt: string;
  lastTickAt?: string;
  ticks: number;
  lastError?: string;
  busy: boolean;
}

type G = typeof globalThis & { __leclaudeIntelLoop?: IntelLoopState };

const FIRST_TICK_DELAY_MS = 20_000;

export function loopState(): IntelLoopState | null {
  return (globalThis as G).__leclaudeIntelLoop ?? null;
}

async function tickOnce(state: IntelLoopState) {
  if (state.busy) return;
  state.busy = true;
  state.ticks++;
  state.lastTickAt = new Date().toISOString();
  try {
    // The workflow scheduler and the scan timer run on their own timers in this process; the loop adds the sweep and the embedding backfill.
    await runDue({ limit: 6, deadlineMs: 25_000, housekeeping: { sweep: true, reembed: true } });
    state.lastError = undefined;
  } catch (e) {
    state.lastError = (e as Error).message;
    console.warn("[intel] tick failed:", state.lastError);
  } finally {
    state.busy = false;
  }
}

export function ensureIntelBackground(): IntelLoopState {
  const g = globalThis as G;
  if (g.__leclaudeIntelLoop) return g.__leclaudeIntelLoop;
  const cfg = intelConfig();
  const state: IntelLoopState = { mode: cfg.background, timer: null, startedAt: new Date().toISOString(), ticks: 0, busy: false };
  g.__leclaudeIntelLoop = state;
  if (cfg.background !== "inline") return state;
  try { ensureIntelSeeded(); } catch (e) { console.warn("[intel] seed failed", (e as Error).message); }
  try { ensureScheduler(); } catch (e) { console.warn("[intel] workflow scheduler start failed", (e as Error).message); }
  try { ensureScheduledScans(); } catch (e) { console.warn("[intel] scan timer start failed", (e as Error).message); }
  const first = setTimeout(() => { void tickOnce(state); }, FIRST_TICK_DELAY_MS);
  (first as { unref?: () => void }).unref?.();
  const timer = setInterval(() => { void tickOnce(state); }, cfg.tickMs);
  (timer as { unref?: () => void }).unref?.();
  state.timer = timer;
  return state;
}

export function stopIntelBackground() {
  const g = globalThis as G;
  if (g.__leclaudeIntelLoop?.timer) clearInterval(g.__leclaudeIntelLoop.timer);
  g.__leclaudeIntelLoop = undefined;
}

/** Nudge the runner right away (after "Run now") without waiting for the next tick; inline mode only. */
export function kickRunner(): boolean {
  const state = loopState();
  if (!state || state.mode !== "inline" || state.busy) return false;
  void tickOnce(state);
  return true;
}
