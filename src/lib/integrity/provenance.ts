import { aiConfig } from "@/lib/ai/config";
import { promptHash } from "./hash";
import { CONFIDENCE_GATE, type Provenance } from "./types";

/** Build a provenance record for an AI output. Attach as `provenance` on the stored record. */
export function makeProvenance(input: { surface: string; instructions?: string; input?: unknown; sources?: Provenance["sources"]; confidence?: number; model?: string }): Provenance {
  return {
    model: input.model ?? aiConfig().model,
    generatedAt: new Date().toISOString(),
    promptHash: input.instructions != null ? promptHash(input.instructions, input.input ?? "") : undefined,
    sources: input.sources ?? [],
    confidence: input.confidence,
    surface: input.surface,
    review: input.confidence != null && input.confidence < CONFIDENCE_GATE ? { status: "pending", note: "Below confidence gate" } : undefined,
  };
}

/** True when a record may be used by downstream automation without a human look. */
export function isTrusted(p: Provenance | undefined): boolean {
  if (!p) return false;
  if (p.review?.status === "rejected") return false;
  if (p.review?.status === "approved") return true;
  if (p.verification?.status === "contradicted") return false;
  if (p.confidence != null && p.confidence < CONFIDENCE_GATE) return false;
  return p.verification?.status === "verified" || p.verification?.status === "partially-verified" || p.sources.length > 0;
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
  return { label: p.sources.length ? "Source-backed" : "Not source-backed", tone: p.sources.length ? "success" : "warning" };
}
