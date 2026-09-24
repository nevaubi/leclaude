import "server-only";
import { registerScan } from "@/lib/integrity/scans";
import type { ScanFinding } from "@/lib/integrity/types";
import { KNOWN_NODE_TYPES } from "./registry";
import { normalizeSchedule } from "./schedule";
import type { RunArtifact, WorkflowRunRecord } from "./types";

type Finding = Omit<ScanFinding, "id" | "scanId">;

const PERIOD_MS: Record<string, number> = { hourly: 3600_000, daily: 86400_000, weekly: 7 * 86400_000, monthly: 31 * 86400_000 };

/**
 * Workflow integrity: templates or workflows using node types the engine does
 * not know, active schedules that never fired, and run artifacts pointing at
 * documents, tasks or events that were deleted since.
 */
registerScan({
  id: "workflow-definitions",
  name: "Workflow definitions",
  description: "Templates and workflows that reference unknown node types, and active schedules that have never fired.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    const known = new Set<string>(KNOWN_NODE_TYPES);
    const now = Date.now();
    for (const w of d.workflows.all()) {
      checked++;
      const unknown = w.nodes.filter((n) => !known.has(n.type));
      if (unknown.length) findings.push({ severity: "high", title: `${w.isTemplate ? "Template" : "Workflow"} "${w.name}" uses ${unknown.length} unknown node type(s)`, detail: Array.from(new Set(unknown.map((n) => n.type))).join(", "), target: { kind: "workflow", id: w.id, href: `/workflows/${w.id}` } });
      const trig = w.nodes.find((n) => n.type === "trigger.schedule");
      if (trig && w.status === "active" && !w.isTemplate && trig.config.enabled !== false) {
        const sched = normalizeSchedule(trig.config.schedule);
        const last = d.kv.get<string>(`wf:schedule:last:${w.id}`);
        const fired = d.workflowRuns.count((r) => r.workflowId === w.id && r.triggeredBy === "schedule");
        const period = sched ? PERIOD_MS[sched.frequency] ?? 86400_000 : 86400_000;
        const age = now - new Date(w.createdAt).getTime();
        if (!fired && !last && age > 2 * period) findings.push({ severity: "medium", title: `"${w.name}" is scheduled ${sched?.frequency ?? ""} but has never fired`, detail: `Created ${w.createdAt.slice(0, 10)}; the in-process scheduler only runs while the server is up.`, target: { kind: "workflow", id: w.id, href: `/workflows/${w.id}` } });
        else if (last && now - new Date(last).getTime() > 3 * period) findings.push({ severity: "low", title: `"${w.name}" last fired ${Math.round((now - new Date(last).getTime()) / 86400_000)} days ago`, detail: `Expected every ${sched?.frequency ?? "period"}.`, target: { kind: "workflow", id: w.id, href: `/workflows/${w.id}` } });
      }
    }
    return { checked, findings };
  },
});

function artifactExists(d: Parameters<Parameters<typeof registerScan>[0]["run"]>[0], a: RunArtifact): boolean {
  switch (a.kind) {
    case "document": return d.officeDocs.has(a.id);
    case "library": return d.library.has(a.id);
    case "task": return d.tasks.has(a.id);
    case "event": return d.events.has(a.id);
    case "file": return Boolean(d.blobs.meta(a.id));
    default: return true;
  }
}

registerScan({
  id: "workflow-artifacts",
  name: "Workflow run artifacts",
  description: "Runs whose artifacts point at documents, tasks, events or files that no longer exist, and trust gates that have waited more than 7 days.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    const now = Date.now();
    for (const r of d.workflowRuns.all() as WorkflowRunRecord[]) {
      checked++;
      const dead = (r.artifacts ?? []).filter((a) => !a.meta?.deleted && !artifactExists(d, a));
      if (dead.length) findings.push({ severity: "low", title: `Run ${r.id} (${r.workflowName ?? r.workflowId}) has ${dead.length} artifact(s) pointing at deleted records`, detail: dead.map((a) => `${a.kind} "${a.title}"`).join(", "), target: { kind: "workflowRun", id: r.id, href: `/workflows/runs/${r.id}` }, fixable: true });
      const gates = (r.approvals ?? []).filter((a) => (a as { kind?: string }).kind === "trust-gate" && a.approved == null);
      for (const g of gates) { const age = now - new Date(g.requestedAt).getTime(); if (age > 7 * 86400_000) findings.push({ severity: "medium", title: `Trust gate "${g.title}" on run ${r.id} has waited ${Math.round(age / 86400_000)} days`, detail: g.message.slice(0, 200), target: { kind: "workflowRun", id: r.id, href: `/workflows/runs/${r.id}` } }); }
    }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "workflowRun") return false;
    const r = d.workflowRuns.get(f.target.id) as WorkflowRunRecord | null;
    if (!r?.artifacts?.length) return false;
    let changed = false;
    const artifacts = r.artifacts.map((a) => { if (!a.meta?.deleted && !artifactExists(d, a)) { changed = true; return { ...a, href: undefined, meta: { ...(a.meta ?? {}), deleted: true } }; } return a; });
    if (changed) d.workflowRuns.put({ ...r, artifacts } as WorkflowRunRecord);
    return changed;
  },
});
