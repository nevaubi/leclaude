import "server-only";
import type { RunEvent } from "./types";

/**
 * In-process pub/sub for run progress. The engine publishes; the SSE stream
 * route subscribes. Kept on globalThis so Next.js dev reloads share one bus.
 *
 * Event vocabulary (constitution §46; the type lives in ./types so client
 * code can fold events without importing this server module):
 *
 *   run.started · plan.created
 *   node.started · node.progress · node.log · node.retrying · node.completed · node.failed · node.skipped · node.cancelled · node.waiting · node.reset
 *   tool.started · tool.completed · tool.failed
 *   artifact.created · output.created · handoff.created · review.required · budget.warning
 *   run.waiting · run.completed · run.partial · run.failed · run.cancelled · run.budget_exhausted · run.verification_failed
 *   run.done (stream terminator; the terminal run.* event before it carries the state) · error (transport)
 */
export const RUN_EVENT_TYPES = [
  "snapshot", "run.started", "plan.created",
  "node.started", "node.progress", "node.log", "node.retrying", "node.completed", "node.failed", "node.skipped", "node.cancelled", "node.waiting", "node.reset",
  "tool.started", "tool.completed", "tool.failed",
  "artifact.created", "output.created", "handoff.created", "review.required", "budget.warning",
  "run.waiting", "run.completed", "run.partial", "run.failed", "run.cancelled", "run.budget_exhausted", "run.verification_failed",
  "run.done", "error",
] as const satisfies readonly RunEvent["type"][];

type Listener = (event: RunEvent) => void;
type G = typeof globalThis & { __leclaudeWorkflowBus?: Map<string, Set<Listener>>; __leclaudeWorkflowRecent?: Map<string, RunEvent[]> };

function bus() {
  const g = globalThis as G;
  if (!g.__leclaudeWorkflowBus) g.__leclaudeWorkflowBus = new Map();
  if (!g.__leclaudeWorkflowRecent) g.__leclaudeWorkflowRecent = new Map();
  return { listeners: g.__leclaudeWorkflowBus, recent: g.__leclaudeWorkflowRecent };
}

const RECENT_LIMIT = 400;

export function publishRunEvent(runId: string, event: RunEvent) {
  const { listeners, recent } = bus();
  const buf = recent.get(runId) ?? [];
  buf.push(event);
  if (buf.length > RECENT_LIMIT) buf.splice(0, buf.length - RECENT_LIMIT);
  recent.set(runId, buf);
  const set = listeners.get(runId);
  if (!set) return;
  for (const l of set) { try { l(event); } catch (e) { console.warn("[workflows] listener failed", (e as Error).message); } }
}

export function subscribeRunEvents(runId: string, listener: Listener): () => void {
  const { listeners } = bus();
  let set = listeners.get(runId);
  if (!set) { set = new Set(); listeners.set(runId, set); }
  set.add(listener);
  return () => { set!.delete(listener); if (!set!.size) listeners.delete(runId); };
}

/** Recent events for a run (replayed to late subscribers, after the snapshot). */
export function recentRunEvents(runId: string): RunEvent[] {
  return bus().recent.get(runId) ?? [];
}

export function forgetRunEvents(runId: string) {
  bus().recent.delete(runId);
}
