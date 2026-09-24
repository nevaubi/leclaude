/**
 * Pure helpers for the "Needs review" queue surface (Codes & privilege tab and
 * Settings). No React, no server imports: unit-tested in tests/ui-polish-modules.test.ts.
 */
import type { ProvenanceKind, ReviewQueueItem } from "@/lib/integrity/types";

export const KIND_LABEL: Record<ProvenanceKind, string> = {
  "edoc.analysis": "Document analysis",
  "edoc.prediction": "Responsiveness prediction",
  "privilege.entry": "Privilege log entry",
  "timeline.event": "Timeline event",
  conflict: "Conflict",
  "fact-matrix": "Fact matrix",
  "knowledge-map": "Knowledge map",
  "deposition.digest": "Deposition digest",
  "deposition.outline": "Deposition outline",
  "home.brief": "Daily brief",
  "workflow.step": "Workflow step",
  "office.proposal": "Office proposal",
  "library.summary": "Library summary",
  "library.autotag": "Library auto-tag",
  "library.compare": "Clause comparison",
  research: "Research answer",
  "intel.job": "Intelligence job",
  "story.draft": "Story narrative",
};

/** Order groups appear in: the record types a reviewer must clear before production first. */
const KIND_ORDER: ProvenanceKind[] = ["privilege.entry", "edoc.analysis", "edoc.prediction", "conflict", "timeline.event", "deposition.digest", "deposition.outline", "fact-matrix", "knowledge-map", "workflow.step", "office.proposal", "library.summary", "library.autotag", "library.compare", "research", "home.brief"];

export function kindLabel(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? kind.replace(/[.-]/g, " ");
}

/** Group queue rows by kind, most urgent kinds first, newest rows first inside each group. */
export function groupQueueByKind(items: ReviewQueueItem[]): { kind: ProvenanceKind; label: string; items: ReviewQueueItem[] }[] {
  const by = new Map<ProvenanceKind, ReviewQueueItem[]>();
  for (const it of items) by.set(it.kind, [...(by.get(it.kind) ?? []), it]);
  const kinds = Array.from(by.keys()).sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a), ib = KIND_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return kinds.map((kind) => ({ kind, label: kindLabel(kind), items: [...by.get(kind)!].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)) }));
}

/** Why the row is in the queue, in one short phrase (mirrors provenance.review.note / verification). */
export function queueReason(item: Pick<ReviewQueueItem, "review" | "verification" | "confidence" | "sources">): string {
  if (item.review?.note) return item.review.note;
  if (item.verification?.status === "contradicted") return `${item.verification.contradicted} claim${item.verification.contradicted === 1 ? "" : "s"} contradicted by the sources`;
  if (item.verification?.status === "partially-verified") return `${item.verification.unsupported} unsupported claim${item.verification.unsupported === 1 ? "" : "s"}`;
  if (item.confidence != null && item.confidence < 0.6) return `confidence ${Math.round(item.confidence * 100)}% is below the gate`;
  if (!item.sources) return "not source-backed";
  return "awaiting human review";
}

/** Request body for POST /api/integrity/review. `status` mirrors `decision` for callers that use either name. */
export function decisionBody(item: Pick<ReviewQueueItem, "id" | "kind">, decision: "approved" | "rejected", note?: string): { id: string; kind: ProvenanceKind; status: "approved" | "rejected"; decision: "approved" | "rejected"; note?: string } {
  const trimmed = note?.trim();
  return { id: item.id, kind: item.kind, status: decision, decision, ...(trimmed ? { note: trimmed } : {}) };
}

/** True when the review endpoint is not deployed (404/405) or unreachable — the UI then shows an empty state instead of an error. */
export function isEndpointMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (status === 404 || status === 405 || status === 501) return true;
  const name = (err as { name?: unknown }).name;
  return name === "TypeError" && /fetch/i.test(String((err as { message?: unknown }).message ?? ""));
}

/** Summary counts by matter for the Settings "Review queue" card. */
export function summarizeByMatter(items: ReviewQueueItem[], matterName: (id: string | undefined) => string | undefined): { matterId: string | undefined; matterName: string; pending: number; kinds: string[] }[] {
  const by = new Map<string | undefined, ReviewQueueItem[]>();
  for (const it of items) by.set(it.matterId, [...(by.get(it.matterId) ?? []), it]);
  return Array.from(by.entries())
    .map(([matterId, rows]) => ({ matterId, matterName: matterName(matterId) ?? (matterId ? matterId : "Firm-wide"), pending: rows.length, kinds: Array.from(new Set(rows.map((r) => kindLabel(r.kind)))).sort() }))
    // Busiest matter first; ties by name; firm-wide (no matter) rows always last.
    .sort((a, b) => b.pending - a.pending || Number(!a.matterId) - Number(!b.matterId) || a.matterName.localeCompare(b.matterName));
}
