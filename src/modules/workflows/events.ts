import "server-only";
import type { RunEvent } from "./types";

/**
 * In-process pub/sub for run progress. The engine publishes; the SSE stream
 * route subscribes. Kept on globalThis so Next.js dev reloads share one bus.
 */
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
