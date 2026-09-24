import "server-only";
import { applyCiteCheck, applyVerification, crossCheckCitations, safeSelfCorrect, safeVerifyClaims, type VerifySource } from "@/lib/ai/verify";
import { audit } from "./audit";
import { gateReview, makeProvenance } from "./provenance";
import { putProvenance } from "./store";
import type { Provenance, ProvenanceKind, ProvenanceSource } from "./types";

/**
 * One-stop helpers used by every AI wrapper: build provenance, run the
 * verification loops fail-soft, gate low-confidence output for review, store
 * the sidecar record and write the audit trail. Nothing here ever throws away
 * the primary output — verification failures only mark it "unverified".
 */

export interface GenerationInput {
  surface: string;
  instructions?: string;
  input?: unknown;
  sources?: ProvenanceSource[];
  confidence?: number;
  model?: string;
  usage?: Provenance["usage"];
  /** Audit target (what record this generation produced). */
  target: { kind: string; id?: string; label?: string; matterId?: string };
  meta?: Record<string, unknown>;
}

/** Build provenance for a fresh generation and record an `ai.generate` audit event. */
export function recordGeneration(g: GenerationInput): Provenance {
  const p = makeProvenance({ surface: g.surface, instructions: g.instructions, input: g.input, sources: g.sources, confidence: g.confidence, model: g.model, usage: g.usage });
  audit("ai.generate", g.target, { surface: g.surface, model: p.model, promptHash: p.promptHash, confidence: p.confidence, sources: p.sources.slice(0, 12).map((s) => s.cite ?? s.title ?? s.url ?? s.id), tokens: g.usage?.total, ...(g.meta ?? {}) });
  return p;
}

export interface StructuredVerifyOptions<T> {
  label: string;
  output: T;
  evidence: string;
  schema: Record<string, unknown>;
  instructions?: string;
  verify?: boolean;
  signal?: AbortSignal;
  /** Count items so the verification numbers are meaningful (default: array length or 1). */
  count?: (v: T) => number;
}

/**
 * Structured extractions (timeline events, contradictions, fact-matrix cells,
 * digest admissions, knowledge-map entries) go through selfCorrect() against
 * the evidence they were built from. Dropped/changed items land in
 * provenance.verification.changes and are audited under ai.verify.
 */
export async function verifyStructured<T>(p: Provenance, opts: StructuredVerifyOptions<T>, target: { kind: string; id?: string; label?: string; matterId?: string }): Promise<{ provenance: Provenance; output: T; changes: string[] }> {
  const count = opts.count ?? ((v: T) => (Array.isArray(v) ? v.length : 1));
  const before = count(opts.output);
  const r = await safeSelfCorrect<T>({ label: opts.label, output: opts.output, evidence: opts.evidence, schema: opts.schema, instructions: opts.instructions, verify: opts.verify, signal: opts.signal });
  const checkedAt = new Date().toISOString();
  if (!r.ran) {
    const notes = r.error === "skipped" ? "verification skipped by caller" : `self-correction did not run (${r.error ?? "unknown"})`;
    const status: NonNullable<Provenance["verification"]>["status"] = p.verification?.status ?? "unverified";
    return { provenance: gateReview({ ...p, verification: { status, checkedAt, method: "schema", supported: 0, unsupported: 0, contradicted: 0, notes } }), output: opts.output, changes: [] };
  }
  const after = count(r.corrected);
  const dropped = Math.max(0, before - after);
  const changed = r.changes.length;
  const status: NonNullable<Provenance["verification"]>["status"] = before === 0 ? "unverified" : dropped === 0 && changed === 0 ? "verified" : dropped < before ? "partially-verified" : "contradicted";
  const provenance = gateReview({ ...p, verification: { status, checkedAt, method: "schema", supported: Math.max(0, after), unsupported: dropped, contradicted: 0, notes: changed ? `${changed} correction(s): ${r.changes.slice(0, 5).join(" | ")}`.slice(0, 600) : undefined, changes: r.changes.slice(0, 40) } });
  if (changed || dropped) audit("ai.verify", target, { method: "self-correct", label: opts.label, before, after, dropped, changes: r.changes.slice(0, 20) });
  return { provenance, output: r.corrected, changes: r.changes };
}

export interface NarrativeVerifyOptions {
  answer: string;
  sources: VerifySource[];
  /** Record cites known to exist in the evidence: Bates numbers and page:line cites / pages. */
  cites?: { bates?: Iterable<string>; pageLines?: Iterable<string>; pages?: Iterable<number> };
  verify?: boolean;
  signal?: AbortSignal;
  maxClaims?: number;
}

/**
 * Narrative outputs (digest summaries, outlines, briefs, workflow drafts) go
 * through verifyClaims() against their sources when sources exist; record
 * cites are cross-checked and unresolved ones get [VERIFY]. Fail-soft.
 */
export async function verifyNarrative(p: Provenance, opts: NarrativeVerifyOptions, target: { kind: string; id?: string; label?: string; matterId?: string }): Promise<{ provenance: Provenance; text: string; unresolvedCites: string[] }> {
  let provenance = p;
  let text = opts.answer;
  let unresolved: string[] = [];
  if (opts.cites && (Array.from(opts.cites.bates ?? []).length || Array.from(opts.cites.pageLines ?? []).length || Array.from(opts.cites.pages ?? []).length)) {
    const check = crossCheckCitations(text, opts.cites);
    text = check.text;
    unresolved = check.unresolved;
    provenance = applyCiteCheck(provenance, check);
  }
  const hasSources = opts.sources.some((s) => s.text?.trim());
  if (hasSources) {
    const v = await safeVerifyClaims({ answer: opts.answer, sources: opts.sources, verify: opts.verify, signal: opts.signal, maxClaims: opts.maxClaims });
    const merged = applyVerification(provenance, v, "claims");
    // keep the cite-check details alongside the claim verdicts
    provenance = { ...merged, verification: merged.verification ? { ...merged.verification, unresolvedCites: unresolved.length ? unresolved : provenance.verification?.unresolvedCites } : merged.verification };
    if (v.verdicts.length) audit("ai.verify", target, { method: "claims", status: v.status, supported: v.supported, unsupported: v.unsupported, contradicted: v.contradicted, score: Number(v.score.toFixed(2)), unresolvedCites: unresolved.slice(0, 10) });
  } else if (!provenance.verification) {
    provenance = { ...provenance, verification: { status: "unverified", checkedAt: new Date().toISOString(), method: "claims", supported: 0, unsupported: 0, contradicted: 0, notes: "no sources available to verify against" } };
  }
  return { provenance: gateReview(provenance), text, unresolvedCites: unresolved };
}

/** Persist the sidecar record (and return the provenance for the API response). */
export function attachProvenance(input: { kind: ProvenanceKind; recordId: string; matterId?: string; title: string; href?: string; provenance: Provenance }): Provenance {
  putProvenance(input);
  return input.provenance;
}

/** Sources helper: build provenance sources from e-discovery documents. */
export function documentSources(docs: { id: string; bates: string; subject?: string }[]): ProvenanceSource[] {
  return docs.map((d) => ({ kind: "document" as const, id: d.id, cite: d.bates, title: d.subject }));
}

export function depositionSource(dep: { id: string; witnessName: string; date?: string }, cite?: string): ProvenanceSource {
  return { kind: "deposition", id: dep.id, cite: cite ?? `${dep.witnessName} dep.${dep.date ? ` (${dep.date})` : ""}`, title: `Deposition of ${dep.witnessName}` };
}
