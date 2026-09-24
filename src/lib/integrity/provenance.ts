import { aiConfig } from "@/lib/ai/config";
import { promptHash } from "./hash";
import { CONFIDENCE_GATE, type Provenance, type ProvenanceSource } from "./types";

/** Build a provenance record for an AI output. Attach as `provenance` on the stored record. */
export function makeProvenance(input: { surface: string; instructions?: string; input?: unknown; sources?: ProvenanceSource[]; confidence?: number; model?: string; usage?: Provenance["usage"]; duplicateOf?: string }): Provenance {
  const confidence = input.confidence != null && Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : undefined;
  return {
    model: input.model ?? aiConfig().model,
    generatedAt: new Date().toISOString(),
    promptHash: input.instructions != null ? promptHash(input.instructions, input.input ?? "") : undefined,
    sources: dedupeSources(input.sources ?? []),
    confidence,
    surface: input.surface,
    review: confidence != null && confidence < CONFIDENCE_GATE ? { status: "pending", note: "Below confidence gate" } : undefined,
    duplicateOf: input.duplicateOf,
    usage: input.usage,
  };
}

/** True when a record may be used by downstream automation without a human look. */
export function isTrusted(p: Provenance | undefined): boolean {
  if (!p) return false;
  if (p.review?.status === "rejected") return false;
  if (p.review?.status === "approved") return true;
  if (p.review?.status === "pending") return false;
  if (p.verification?.status === "contradicted") return false;
  if (p.confidence != null && p.confidence < CONFIDENCE_GATE) return false;
  return p.verification?.status === "verified" || p.verification?.status === "partially-verified" || p.sources.length > 0;
}

/** Why a record is (not) trusted, for run logs and gate messages. */
export function trustReason(p: Provenance | undefined): string {
  if (!p) return "no provenance recorded";
  if (p.review?.status === "rejected") return `rejected by ${p.review.by ?? "reviewer"}`;
  if (p.review?.status === "approved") return `approved by ${p.review.by ?? "reviewer"}`;
  if (p.review?.status === "pending") return p.review.note ? `awaiting review (${p.review.note})` : "awaiting human review";
  if (p.verification?.status === "contradicted") return `${p.verification.contradicted} claim(s) contradicted by the sources`;
  if (p.confidence != null && p.confidence < CONFIDENCE_GATE) return `confidence ${(p.confidence * 100).toFixed(0)}% is below the ${(CONFIDENCE_GATE * 100).toFixed(0)}% gate`;
  if (p.verification?.status === "verified") return "verified against sources";
  if (p.verification?.status === "partially-verified") return `partially verified (${p.verification.unsupported} unsupported claim(s))`;
  if (p.verification?.status === "unverified") return p.sources.length ? "source-backed but unverified" : "unverified and not source-backed";
  return p.sources.length ? "source-backed" : "not source-backed";
}

/** Re-evaluate the review gate after verification or a confidence change (never clears a human decision). */
export function gateReview(p: Provenance, reason?: string): Provenance {
  if (p.review?.status === "approved" || p.review?.status === "rejected") return p;
  const low = p.confidence != null && p.confidence < CONFIDENCE_GATE;
  const contradicted = p.verification?.status === "contradicted";
  const unverifiedWithoutSources = p.verification?.status === "unverified" && p.sources.length === 0 && p.confidence == null;
  if (low || contradicted || unverifiedWithoutSources || reason) {
    const note = reason ?? (contradicted ? "Contradicted by sources" : low ? "Below confidence gate" : "Not source-backed");
    return { ...p, review: { status: "pending", note } };
  }
  return p.review?.status === "pending" ? { ...p, review: undefined } : p;
}

/** Human-readable trust label for badges. */
export function trustLabel(p: Provenance | undefined): { label: string; tone: "success" | "warning" | "destructive" | "muted" } {
  if (!p) return { label: "Unverified", tone: "muted" };
  if (p.review?.status === "approved") return { label: "Reviewed", tone: "success" };
  if (p.review?.status === "rejected") return { label: "Rejected", tone: "destructive" };
  if (p.verification?.status === "contradicted") return { label: "Contradicted", tone: "destructive" };
  if (p.verification?.status === "verified") return { label: "Verified", tone: "success" };
  if (p.verification?.status === "partially-verified") return { label: "Partially verified", tone: "warning" };
  if (p.confidence != null && p.confidence < CONFIDENCE_GATE) return { label: "Needs review", tone: "warning" };
  if (p.review?.status === "pending") return { label: "Needs review", tone: "warning" };
  return { label: p.sources.length ? "Source-backed" : "Not source-backed", tone: p.sources.length ? "success" : "warning" };
}

/** Map a categorical confidence (as models often report it) to 0..1. */
export function confidenceFromLevel(level: string | undefined | null): number | undefined {
  switch ((level ?? "").toLowerCase()) {
    case "high": return 0.9;
    case "medium": return 0.65;
    case "low": return 0.35;
    default: return undefined;
  }
}

export function dedupeSources(sources: ProvenanceSource[]): ProvenanceSource[] {
  const seen = new Set<string>();
  const out: ProvenanceSource[] = [];
  for (const s of sources) {
    if (!s) continue;
    const k = `${s.kind}|${s.id ?? ""}|${s.cite ?? ""}|${s.url ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, 60);
}
