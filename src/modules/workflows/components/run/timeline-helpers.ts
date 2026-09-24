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
    default: return { tone: "muted", pulse: false, label: "Pending" };
  }
}

/** Provenance carried by a run artifact (either top-level or under meta), when the integrity layer attached one. */
export function artifactProvenance(a: RunArtifact | (RunArtifact & { provenance?: unknown })): Provenance | undefined {
  const candidates = [(a as { provenance?: unknown }).provenance, a.meta?.provenance];
  for (const p of candidates) {
    if (p && typeof p === "object") {
      const v = p as Partial<Provenance>;
      if (typeof v.model === "string" && typeof v.generatedAt === "string" && Array.isArray(v.sources)) return v as Provenance;
    }
  }
  return undefined;
}

/** Steps grouped for the summary line: "3 of 7 done · 1 failed". */
export function stepSummary(steps: { status: WorkflowRunStep["status"] }[]): string {
  const done = steps.filter((s) => s.status === "succeeded").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const waiting = steps.filter((s) => s.status === "waiting_approval").length;
  const parts = [`${done} of ${steps.length} done`];
  if (failed) parts.push(`${failed} failed`);
  if (waiting) parts.push(`${waiting} awaiting approval`);
  return parts.join(" · ");
}
