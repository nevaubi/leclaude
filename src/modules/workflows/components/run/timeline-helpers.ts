/**
 * Pure helpers for the run panel's vertical timeline. No React: unit-tested in
 * tests/ui-polish-modules.test.ts.
 */
import type { WorkflowRunStep } from "@/lib/types/domain";
import type { Provenance } from "@/lib/integrity/types";
import type { RunArtifact } from "../../types";

export type DotTone = "muted" | "primary" | "success" | "warning" | "destructive" | "info";

/** Quiet status dot tone for a step (the timeline never shouts: one colour per state). */
export function stepDotTone(status: WorkflowRunStep["status"]): { tone: DotTone; pulse: boolean; label: string } {
  switch (status) {
    case "running": return { tone: "info", pulse: true, label: "Running" };
    case "succeeded": return { tone: "success", pulse: false, label: "Succeeded" };
    case "failed": return { tone: "destructive", pulse: false, label: "Failed" };
    case "waiting_approval": return { tone: "warning", pulse: true, label: "Waiting for approval" };
    case "skipped": return { tone: "muted", pulse: false, label: "Skipped" };
    case "cancelled": return { tone: "muted", pulse: false, label: "Cancelled" };
    default: return { tone: "muted", pulse: false, label: "Pending" };
  }
}

function looksLikeProvenance(p: unknown): p is Provenance {
  if (!p || typeof p !== "object") return false;
  const v = p as Partial<Provenance>;
  return typeof v.model === "string" && typeof v.generatedAt === "string" && Array.isArray(v.sources);
}

/** Provenance carried by a run artifact (either top-level or under meta), when the integrity layer attached one. */
export function artifactProvenance(a: RunArtifact | (RunArtifact & { provenance?: unknown })): Provenance | undefined {
  const candidates = [(a as { provenance?: unknown }).provenance, a.meta?.provenance];
  for (const p of candidates) if (looksLikeProvenance(p)) return p;
  return undefined;
}

/**
 * Provenance of a run step wherever the engine records it: on the step itself
 * (`provenance`, `meta.provenance`) or on its output — the executors attach
 * `_provenance` to AI outputs and `provenance` to verify-step outputs
 * (src/modules/workflows/executors.ts, stepProvenanceOf). TrustBadge renders
 * from this so the same record is trusted the same way in the panel and the engine.
 */
export function stepProvenance(step: { output?: unknown; meta?: Record<string, unknown>; provenance?: unknown } | undefined): Provenance | undefined {
  if (!step) return undefined;
  const out = step.output && typeof step.output === "object" && !Array.isArray(step.output) ? (step.output as Record<string, unknown>) : undefined;
  const candidates = [step.provenance, step.meta?.provenance, out?._provenance, out?.provenance];
  for (const p of candidates) if (looksLikeProvenance(p)) return p;
  return undefined;
}

/**
 * A step output without its provenance blob (`_provenance` / `provenance`), so the
 * JSON tree shows the step's actual result; the TrustBadge next to the row carries
 * the provenance. Non-provenance fields that happen to use those names are kept.
 */
export function outputWithoutProvenance(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const o = output as Record<string, unknown>;
  const drop = ["_provenance", "provenance"].filter((k) => looksLikeProvenance(o[k]));
  if (!drop.length) return output;
  return Object.fromEntries(Object.entries(o).filter(([k]) => !drop.includes(k)));
}

/** Steps grouped for the summary line: "3 of 7 done · 1 failed · 2 cancelled". */
export function stepSummary(steps: { status: WorkflowRunStep["status"] }[]): string {
  const done = steps.filter((s) => s.status === "succeeded").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const cancelled = steps.filter((s) => s.status === "cancelled").length;
  const waiting = steps.filter((s) => s.status === "waiting_approval").length;
  const parts = [`${done} of ${steps.length} done`];
  if (failed) parts.push(`${failed} failed`);
  if (cancelled) parts.push(`${cancelled} cancelled`);
  if (waiting) parts.push(`${waiting} awaiting approval`);
  return parts.join(" · ");
}

/** Outcome line for a finished run: "5 completed · 1 failed · 2 skipped" (only non-zero parts, completed always). */
export function outcomeSummary(outcome: { completed: string[]; failed: string[]; skipped: string[]; cancelled: string[]; notRun: string[] } | undefined): string | null {
  if (!outcome) return null;
  const parts = [`${outcome.completed.length} completed`];
  if (outcome.failed.length) parts.push(`${outcome.failed.length} failed`);
  if (outcome.cancelled.length) parts.push(`${outcome.cancelled.length} cancelled`);
  if (outcome.skipped.length) parts.push(`${outcome.skipped.length} skipped`);
  if (outcome.notRun.length) parts.push(`${outcome.notRun.length} not run`);
  return parts.join(" · ");
}

/** Secondary line of a step row: what failed and on which attempt, from typed fields only. */
export function stepFailureLine(step: { status: WorkflowRunStep["status"]; failureKind?: string; attempt?: number; error?: string; skipReason?: string }, labels: { failure: Record<string, string>; skip: Record<string, string> }): string | null {
  if (step.status === "failed" || step.status === "cancelled") {
    const kind = step.failureKind ? labels.failure[step.failureKind] ?? step.failureKind : null;
    const attempt = step.attempt && step.attempt > 1 ? `attempt ${step.attempt}` : null;
    const head = [kind, attempt].filter(Boolean).join(" · ");
    return head && step.error ? `${head} — ${step.error}` : head || step.error || null;
  }
  if (step.status === "skipped" && step.skipReason) return labels.skip[step.skipReason] ?? step.skipReason;
  return null;
}
