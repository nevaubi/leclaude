import "server-only";
import { db } from "@/lib/db";
import type { Workflow } from "@/lib/types/domain";
import { reapOrphanedRuns, startRun } from "./engine";
import { nextRunAt, normalizeSchedule } from "./schedule";
import type { WorkflowRunRecord } from "./types";

/**
 * Lightweight in-process scheduler. Started lazily by the first workflows API
 * call; ticks every minute; fires active workflows whose trigger.schedule is
 * due. Guarded on globalThis so hot reloads and concurrent route modules never
 * start a second loop.
 *
 * Limitations (by design for this single-process deployment): schedules are
 * evaluated in the server's local time zone; nothing fires while the process is
 * down, and at most one catch-up run happens on the first tick after a restart.
 */
interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  startedAt: string;
  lastTickAt: string | null;
  ticks: number;
  fired: { workflowId: string; name: string; runId: string; at: string }[];
  errors: { workflowId: string; message: string; at: string }[];
  ticking: boolean;
}
type G = typeof globalThis & { __leclaudeWorkflowScheduler?: SchedulerState };

const INTERVAL_MS = 60_000;

export function ensureScheduler(): SchedulerState {
  const g = globalThis as G;
  if (g.__leclaudeWorkflowScheduler) return g.__leclaudeWorkflowScheduler;
  const state: SchedulerState = { timer: null, startedAt: new Date().toISOString(), lastTickAt: null, ticks: 0, fired: [], errors: [], ticking: false };
  g.__leclaudeWorkflowScheduler = state;
  try { reapOrphanedRuns(); } catch (e) { console.warn("[workflows] reap failed", (e as Error).message); }
  if (process.env.WORKFLOW_SCHEDULER_DISABLED === "1") return state;
  const timer = setInterval(() => { void tick(); }, INTERVAL_MS);
  // Never keep the process alive just for the scheduler.
  (timer as { unref?: () => void }).unref?.();
  state.timer = timer;
  return state;
}

export function schedulerStatus() {
  const s = ensureScheduler();
  return { running: Boolean(s.timer), startedAt: s.startedAt, lastTickAt: s.lastTickAt, ticks: s.ticks, intervalMs: INTERVAL_MS, fired: s.fired.slice(-20), errors: s.errors.slice(-20), disabled: process.env.WORKFLOW_SCHEDULER_DISABLED === "1" };
}

/** Evaluate due schedules once. Exported for tests and the manual "tick" endpoint. */
export async function tick(now = new Date(), opts: { force?: string[] } = {}): Promise<{ fired: string[]; checked: number }> {
  const state = ensureScheduler();
  if (state.ticking) return { fired: [], checked: 0 };
  state.ticking = true;
  state.ticks++;
  state.lastTickAt = now.toISOString();
  const fired: string[] = [];
  let checked = 0;
  try {
    const d = db();
    const running = new Set((d.workflowRuns.all() as WorkflowRunRecord[]).filter((r) => r.status === "running" || r.status === "queued").map((r) => r.workflowId));
    for (const w of d.workflows.all() as Workflow[]) {
      const trigger = w.nodes.find((n) => n.type === "trigger.schedule");
      if (!trigger) continue;
      const forced = opts.force?.includes(w.id);
      if (!forced && (w.isTemplate || w.status !== "active" || trigger.config.enabled === false)) continue;
      const schedule = normalizeSchedule(trigger.config.schedule);
      if (!schedule) continue;
      checked++;
      const lastKey = `wf:schedule:last:${w.id}`;
      const last = d.kv.get<string>(lastKey);
      const from = last ? new Date(last) : new Date(w.updatedAt);
      const due = nextRunAt(schedule, from);
      if (!forced && due > now) continue;
      if (running.has(w.id)) continue;
      try {
        const inputs = { ...((trigger.config.presetInputs as Record<string, unknown>) ?? {}) };
        const run = await startRun(w, { inputs, triggeredBy: "schedule", event: { scheduledFor: due.toISOString(), frequency: schedule.frequency } });
        d.kv.set(lastKey, now.toISOString());
        fired.push(w.id);
        state.fired.push({ workflowId: w.id, name: w.name, runId: run.id, at: now.toISOString() });
        if (state.fired.length > 100) state.fired.splice(0, state.fired.length - 100);
      } catch (e) {
        d.kv.set(lastKey, now.toISOString()); // do not retry every minute on a broken workflow
        state.errors.push({ workflowId: w.id, message: (e as Error).message, at: now.toISOString() });
        if (state.errors.length > 100) state.errors.splice(0, state.errors.length - 100);
      }
    }
  } finally {
    state.ticking = false;
  }
  return { fired, checked };
}
