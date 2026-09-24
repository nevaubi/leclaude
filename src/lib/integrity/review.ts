import "server-only";
import { db } from "@/lib/db";
import { audit } from "./audit";
import { gateReview } from "./provenance";
import { listProvenance, updateProvenance, getProvenanceRecord } from "./store";
import type { Provenance, ProvenanceKind, ReviewQueueItem } from "./types";

const REVIEWER = { id: "p_jwhitfield", name: "Jordan Whitfield" };

/**
 * Review queue: every AI-produced record whose provenance.review.status is
 * "pending" across collections. The sidecar store is the index; records that
 * also carry a native `provenance` field (timeline events, conflicts, e-doc
 * analyses) are kept in sync on decision so TrustBadge reflects it everywhere.
 */
export function listReviewQueue(opts: { matterId?: string; kind?: ProvenanceKind; limit?: number; status?: "pending" | "approved" | "rejected" | "all" } = {}): ReviewQueueItem[] {
  const status = opts.status ?? "pending";
  const rows = listProvenance({ matterId: opts.matterId, kind: opts.kind, pending: status === "pending", limit: opts.limit ?? 200 });
  return rows
    .filter((r) => status === "all" || status === "pending" || r.provenance.review?.status === status)
    .filter((r) => status !== "pending" || recordExists(r.kind, r.recordId))
    .map((r) => ({
      kind: r.kind,
      id: r.recordId,
      title: r.title,
      href: r.href,
      matterId: r.matterId,
      surface: r.provenance.surface,
      confidence: r.provenance.confidence,
      verification: r.provenance.verification,
      generatedAt: r.provenance.generatedAt,
      model: r.provenance.model,
      sources: r.provenance.sources.length,
      review: r.provenance.review ?? { status: "pending" },
    }));
}

export function reviewCounts(matterId?: string): { pending: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  let pending = 0;
  for (const r of listProvenance({ matterId, pending: true })) { if (!recordExists(r.kind, r.recordId)) continue; pending++; byKind[r.kind] = (byKind[r.kind] ?? 0) + 1; }
  return { pending, byKind };
}

/** Approve or reject an AI-produced record; writes provenance.review on the sidecar and the native record, audits ai.verify (method human). */
export function decideReview(input: { kind: ProvenanceKind; id: string; decision: "approved" | "rejected"; note?: string; by?: { id: string; name: string } }): { ok: boolean; provenance?: Provenance; message?: string } {
  const by = input.by ?? REVIEWER;
  const rec = getProvenanceRecord(input.kind, input.id);
  if (!rec) return { ok: false, message: `No provenance recorded for ${input.kind} ${input.id}` };
  const at = new Date().toISOString();
  const patch = (p: Provenance): Provenance => ({ ...p, review: { status: input.decision, by: by.name, at, note: input.note?.trim() || undefined } });
  const updated = updateProvenance(input.kind, input.id, patch);
  syncNativeProvenance(input.kind, input.id, patch);
  audit("ai.verify", { kind: input.kind, id: input.id, label: rec.title, matterId: rec.matterId }, { method: "human", decision: input.decision, note: input.note, confidence: rec.provenance.confidence, verification: rec.provenance.verification?.status }, by);
  return { ok: true, provenance: updated?.provenance };
}

/** Records with a native provenance field are patched too. */
function syncNativeProvenance(kind: ProvenanceKind, id: string, patch: (p: Provenance) => Provenance) {
  const d = db();
  switch (kind) {
    case "timeline.event": { const e = d.timeline.get(id); if (e?.provenance) d.timeline.put({ ...e, provenance: patch(e.provenance), verified: patch(e.provenance).review?.status === "approved" ? true : e.verified }); break; }
    case "conflict": { const c = d.conflicts.get(id); if (c?.provenance) d.conflicts.put({ ...c, provenance: patch(c.provenance) }); break; }
    case "edoc.analysis":
    case "edoc.prediction": { const doc = d.edocs.get(id); if (doc?.aiProvenance) d.edocs.put({ ...doc, aiProvenance: patch(doc.aiProvenance) }); const key = `ediscovery:analysis:${id}`; const a = d.kv.get<{ provenance?: Provenance }>(key); if (a?.provenance) d.kv.set(key, { ...a, provenance: patch(a.provenance) }); break; }
    case "fact-matrix": { const col = d.collection<{ id: string; provenance?: Provenance }>("ediscovery_fact_matrices"); const m = col.get(id); if (m?.provenance) col.put({ ...m, provenance: patch(m.provenance) }); break; }
    case "knowledge-map": { const col = d.collection<{ id: string; provenance?: Provenance }>("ediscovery_knowledge_maps"); const m = col.get(id); if (m?.provenance) col.put({ ...m, provenance: patch(m.provenance) }); break; }
    default: break;
  }
}

/** Gate an existing AI record for human review (sidecar + native record), e.g. from an integrity scan. */
export function gateForReview(kind: ProvenanceKind, id: string, note: string): boolean {
  const rec = getProvenanceRecord(kind, id);
  if (!rec) return false;
  const patch = (p: Provenance): Provenance => (p.review?.status === "approved" || p.review?.status === "rejected" ? p : gateReview(p, note));
  updateProvenance(kind, id, patch);
  syncNativeProvenance(kind, id, patch);
  audit("ai.verify", { kind, id, label: rec.title, matterId: rec.matterId }, { method: "human", decision: "gated", note });
  return true;
}

/** True when the record a provenance sidecar describes still exists (deleted records drop out of the queue and the scans). */
export function recordExists(kind: ProvenanceKind, id: string): boolean {
  const d = db();
  switch (kind) {
    case "timeline.event": return d.timeline.has(id);
    case "conflict": return d.conflicts.has(id);
    case "edoc.analysis":
    case "edoc.prediction": return d.edocs.has(id);
    case "privilege.entry": return d.privilegeLog.has(id);
    case "fact-matrix": return d.collection<{ id: string }>("ediscovery_fact_matrices").has(id);
    case "knowledge-map": return d.collection<{ id: string }>("ediscovery_knowledge_maps").has(id);
    case "deposition.digest": return d.depositions.has(id);
    case "workflow.step": return d.workflowRuns.has(id.split(":")[0]);
    case "library.summary":
    case "library.autotag":
    case "library.compare": return d.library.has(id.split(":")[0]);
    case "intel.job": return d.collection<{ id: string }>("intel_jobs").has(id);
    case "research": return d.collection<{ id: string }>("search_runs").has(id);
    default: return true;
  }
}
