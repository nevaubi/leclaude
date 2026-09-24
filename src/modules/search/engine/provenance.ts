/**
 * Provenance assembly for research answers. Pure over the integrity
 * primitives so tests can assert the exact record the run stores.
 */
import { makeProvenance } from "@/lib/integrity/provenance";
import type { Provenance } from "@/lib/integrity/types";
import { toProvenanceSources } from "./sources";
import type { ResearchSource, VerificationSummary } from "./types";

export function assembleProvenance(input: { sources: ResearchSource[]; verification: VerificationSummary | null; instructions?: string; question: string; model?: string; citationMismatches?: number }): Provenance {
  const cited = input.sources.filter((s) => s.n != null);
  const v = input.verification;
  // Confidence = verification score when the loop ran; otherwise a conservative estimate from source coverage.
  const checked = v ? v.supported + v.unsupported + v.contradicted : 0;
  const confidence = v && checked > 0 ? v.score : cited.some((s) => s.read) ? 0.5 : cited.length ? 0.35 : 0;
  const p = makeProvenance({ surface: "research", instructions: input.instructions, input: input.question, sources: toProvenanceSources(cited), confidence, model: input.model });
  if (v) {
    const mismatch = input.citationMismatches ?? 0;
    p.verification = {
      status: v.status,
      checkedAt: v.checkedAt,
      method: "claims",
      supported: v.supported,
      unsupported: v.unsupported,
      contradicted: v.contradicted,
      notes: [v.contradicted ? `${v.contradicted} claim(s) contradicted by sources` : "", mismatch ? `${mismatch} citation(s) not matched to a read source` : ""].filter(Boolean).join("; ") || undefined,
    };
  } else if (input.citationMismatches) {
    p.verification = { status: "unverified", checkedAt: new Date().toISOString(), method: "citations", supported: 0, unsupported: input.citationMismatches, contradicted: 0, notes: `${input.citationMismatches} citation(s) not matched to a read source` };
  }
  return p;
}

export function verificationFromProvenance(p: Provenance | undefined) {
  return p?.verification ?? null;
}
