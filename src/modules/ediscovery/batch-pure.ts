/**
 * Review-batch helpers (pure, client-safe, unit-tested): deterministic QC
 * sampling, progress, next-uncoded navigation and disagreement reporting.
 */
import type { CodingDecision, ReviewBatch, ReviewBatchQcDecision } from "@/lib/types/domain";

/** Seeded PRNG (mulberry32) so a batch's QC sample is stable across reloads. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Sample `percent` of the ids (at least one when percent > 0), deterministic for a seed, keeping the original order. */
export function sampleIds(ids: string[], percent: number, seed: string): string[] {
  const pct = Math.max(0, Math.min(100, percent));
  if (!ids.length || pct === 0) return [];
  const n = Math.min(ids.length, Math.max(1, Math.round((ids.length * pct) / 100)));
  const rnd = seededRandom(seed);
  const shuffled = ids.map((id, i) => ({ id, i, r: rnd() })).sort((a, b) => a.r - b.r).slice(0, n).sort((a, b) => a.i - b.i);
  return shuffled.map((x) => x.id);
}

export const isCoded = (c: CodingDecision | undefined | null) => !!c && c.responsive != null;

export interface BatchProgress {
  total: number;
  coded: number;
  remaining: number;
  pct: number;
  responsive: number;
  privileged: number;
  hot: number;
  qcSampled: number;
  qcDone: number;
  disagreements: number;
}

export function batchProgress(batch: ReviewBatch, codingOf: (id: string) => CodingDecision | undefined): BatchProgress {
  let coded = 0, responsive = 0, privileged = 0, hot = 0;
  for (const id of batch.docIds) {
    const c = codingOf(id);
    if (isCoded(c)) coded++;
    if (c?.responsive === true) responsive++;
    if (c?.privileged === true) privileged++;
    if (c?.hot) hot++;
  }
  const qcDone = Object.keys(batch.qcDecisions ?? {}).length;
  const disagreements = Object.values(batch.qcDecisions ?? {}).filter((d) => !d.agree).length;
  return { total: batch.docIds.length, coded, remaining: batch.docIds.length - coded, pct: batch.docIds.length ? Math.round((coded / batch.docIds.length) * 100) : 0, responsive, privileged, hot, qcSampled: batch.qcSampleIds.length, qcDone, disagreements };
}

/** Next document after `currentId` (wrapping) that still needs a decision; null when the batch is fully coded. */
export function nextUncoded(ids: string[], currentId: string | null, codingOf: (id: string) => CodingDecision | undefined): string | null {
  if (!ids.length) return null;
  const start = currentId ? ids.indexOf(currentId) : -1;
  for (let step = 1; step <= ids.length; step++) {
    const id = ids[(start + step) % ids.length];
    if (id === currentId) continue;
    if (!isCoded(codingOf(id))) return id;
  }
  return null;
}

/** Ids the QC reviewer still has to decide. */
export function nextQc(batch: ReviewBatch, currentId: string | null): string | null {
  const pending = batch.qcSampleIds.filter((id) => !batch.qcDecisions?.[id]);
  if (!pending.length) return null;
  const idx = currentId ? pending.indexOf(currentId) : -1;
  return pending[(idx + 1) % pending.length] ?? pending[0];
}

const norm = (issues?: string[]) => [...(issues ?? [])].sort().join(",");

/** Fields on which a QC call differs from the first pass (issues compared as sets). */
export function codingDifferences(a: Pick<CodingDecision, "responsive" | "privileged" | "hot" | "issues">, b: Pick<CodingDecision, "responsive" | "privileged" | "hot" | "issues">): ("responsive" | "privileged" | "hot" | "issues")[] {
  const out: ("responsive" | "privileged" | "hot" | "issues")[] = [];
  if ((a.responsive ?? null) !== (b.responsive ?? null)) out.push("responsive");
  if ((a.privileged ?? null) !== (b.privileged ?? null)) out.push("privileged");
  if (!!a.hot !== !!b.hot) out.push("hot");
  if (norm(a.issues) !== norm(b.issues)) out.push("issues");
  return out;
}

export function makeQcDecision(firstPass: CodingDecision, qc: Pick<CodingDecision, "responsive" | "privileged" | "hot" | "issues">, reviewerId: string, at = new Date().toISOString()): ReviewBatchQcDecision {
  const fp = { responsive: firstPass.responsive ?? null, privileged: firstPass.privileged ?? null, hot: !!firstPass.hot, issues: [...(firstPass.issues ?? [])], reviewerId: firstPass.reviewerId };
  const q = { responsive: qc.responsive ?? null, privileged: qc.privileged ?? null, hot: !!qc.hot, issues: [...(qc.issues ?? [])] };
  return { reviewerId, at, firstPass: fp, qc: q, agree: codingDifferences(fp, q).length === 0 };
}

export interface DisagreementReport {
  sampled: number;
  reviewed: number;
  agree: number;
  disagree: number;
  /** Agreement rate over reviewed samples (0..1), null before any QC decision. */
  rate: number | null;
  byField: { responsive: number; privileged: number; hot: number; issues: number };
  byReviewer: { reviewerId: string; reviewed: number; disagree: number }[];
  rows: { docId: string; reviewerId: string; at: string; fields: string[]; firstPass: ReviewBatchQcDecision["firstPass"]; qc: ReviewBatchQcDecision["qc"] }[];
}

export function disagreementReport(batch: ReviewBatch): DisagreementReport {
  const decisions = Object.entries(batch.qcDecisions ?? {});
  const byField = { responsive: 0, privileged: 0, hot: 0, issues: 0 };
  const rows: DisagreementReport["rows"] = [];
  const byReviewer = new Map<string, { reviewed: number; disagree: number }>();
  for (const [docId, d] of decisions) {
    const fields = codingDifferences(d.firstPass, d.qc);
    for (const f of fields) byField[f]++;
    const fp = d.firstPass.reviewerId ?? "unknown";
    const r = byReviewer.get(fp) ?? { reviewed: 0, disagree: 0 };
    r.reviewed++;
    if (fields.length) { r.disagree++; rows.push({ docId, reviewerId: d.reviewerId, at: d.at, fields, firstPass: d.firstPass, qc: d.qc }); }
    byReviewer.set(fp, r);
  }
  const disagree = rows.length;
  return {
    sampled: batch.qcSampleIds.length,
    reviewed: decisions.length,
    agree: decisions.length - disagree,
    disagree,
    rate: decisions.length ? Number(((decisions.length - disagree) / decisions.length).toFixed(3)) : null,
    byField,
    byReviewer: Array.from(byReviewer.entries()).map(([reviewerId, v]) => ({ reviewerId, ...v })).sort((a, b) => b.disagree - a.disagree),
    rows: rows.sort((a, b) => a.docId.localeCompare(b.docId)),
  };
}

export const BATCH_PRIORITIES: { id: ReviewBatch["priority"]; label: string }[] = [
  { id: "high", label: "High" },
  { id: "normal", label: "Normal" },
  { id: "low", label: "Low" },
];

export const BATCH_STATUSES: { id: ReviewBatch["status"]; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "qc", label: "In QC" },
  { id: "complete", label: "Complete" },
];

/** Status derived from progress (never moves a completed batch back). */
export function deriveBatchStatus(batch: ReviewBatch, progress: BatchProgress): ReviewBatch["status"] {
  if (batch.status === "complete") return "complete";
  if (progress.coded === 0) return "open";
  if (progress.remaining > 0) return "in_progress";
  if (batch.qcSamplePercent > 0 && progress.qcDone < progress.qcSampled) return "qc";
  return "complete";
}
