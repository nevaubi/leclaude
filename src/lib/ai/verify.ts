import "server-only";
import { generateJSON } from "./agent";
import { aiConfig } from "./config";
import type { Provenance } from "@/lib/integrity/types";

export interface ClaimVerdict {
  claim: string;
  status: "supported" | "unsupported" | "contradicted";
  sourceIndex: number | null; // index into `sources`
  quote?: string;
  note?: string;
}

export interface VerificationResult {
  verdicts: ClaimVerdict[];
  supported: number;
  unsupported: number;
  contradicted: number;
  status: Provenance["verification"] extends infer V ? (V extends { status: infer S } ? S : never) : never;
  sourceBacked: boolean;
  /** 0..1 share of claims supported by the provided sources. */
  score: number;
  checkedAt: string;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          status: { type: "string", enum: ["supported", "unsupported", "contradicted"] },
          sourceIndex: { type: ["integer", "null"], description: "0-based index of the supporting/contradicting source, or null" },
          quote: { type: "string", description: "Short verbatim quote from the source that supports or contradicts the claim" },
          note: { type: "string" },
        },
        required: ["claim", "status", "sourceIndex"],
      },
    },
  },
  required: ["verdicts"],
};

/**
 * Self-correcting verification loop: extract the factual claims in `answer`
 * and check each one strictly against the supplied sources. Nothing outside
 * the sources counts as support. Used by research, e-discovery analysis and
 * the office agents before an AI output is marked source-backed.
 */
export async function verifyClaims(input: { answer: string; sources: { title?: string; cite?: string; url?: string; text: string }[]; maxClaims?: number; signal?: AbortSignal; fast?: boolean }): Promise<VerificationResult> {
  const checkedAt = new Date().toISOString();
  const sources = input.sources.filter((s) => s.text?.trim()).slice(0, 24);
  if (!sources.length) return { verdicts: [], supported: 0, unsupported: 0, contradicted: 0, status: "unverified", sourceBacked: false, score: 0, checkedAt };
  const sourceBlock = sources.map((s, i) => `[${i}] ${s.title ?? s.cite ?? s.url ?? "source"}${s.cite ? ` (${s.cite})` : ""}\n${s.text.slice(0, 6000)}`).join("\n\n");
  const res = await generateJSON<{ verdicts: ClaimVerdict[] }>({
    fast: input.fast ?? true,
    reasoningEffort: "low",
    instructions: `You are a meticulous verification clerk at a law firm. Extract every factual or legal claim in the ANSWER (dates, holdings, quotes, numbers, who-said-what, citations) — at most ${input.maxClaims ?? 25} — and decide for each whether the SOURCES support it verbatim or in substance, contradict it, or say nothing about it. Only the sources count; general knowledge is "unsupported". Quote the exact supporting or contradicting passage. Be strict about pin cites, dates and numbers.`,
    input: `ANSWER:\n${input.answer.slice(0, 20_000)}\n\nSOURCES:\n${sourceBlock}`,
    schema: VERDICT_SCHEMA,
    name: "claim_verification",
    maxOutputTokens: 6000,
    signal: input.signal,
  });
  const verdicts = (res.verdicts ?? []).map((v) => ({ ...v, sourceIndex: v.sourceIndex != null && v.sourceIndex >= 0 && v.sourceIndex < sources.length ? v.sourceIndex : null }));
  const supported = verdicts.filter((v) => v.status === "supported").length;
  const unsupported = verdicts.filter((v) => v.status === "unsupported").length;
  const contradicted = verdicts.filter((v) => v.status === "contradicted").length;
  const total = verdicts.length || 1;
  const score = supported / total;
  const status: VerificationResult["status"] = contradicted > 0 ? "contradicted" : verdicts.length === 0 ? "unverified" : score >= 0.9 ? "verified" : score >= 0.5 ? "partially-verified" : "unverified";
  return { verdicts, supported, unsupported, contradicted, status, sourceBacked: supported > 0 && contradicted === 0, score, checkedAt };
}

/** Fold a verification result into a provenance record. */
export function applyVerification(p: Provenance, v: VerificationResult, method: NonNullable<Provenance["verification"]>["method"] = "claims"): Provenance {
  return { ...p, verification: { status: v.status, checkedAt: v.checkedAt, method, supported: v.supported, unsupported: v.unsupported, contradicted: v.contradicted, notes: v.contradicted ? `${v.contradicted} claim(s) contradicted by sources` : undefined } };
}

/**
 * Second-pass self-critique for structured extractions (timeline events,
 * fact matrices, digests): the model re-reads its own output against the
 * evidence and returns corrected rows plus a list of dropped hallucinations.
 */
export async function selfCorrect<T>(input: { label: string; output: T; evidence: string; schema: Record<string, unknown>; instructions?: string; signal?: AbortSignal }): Promise<{ corrected: T; changes: string[] }> {
  if (!aiConfig().hasKey) return { corrected: input.output, changes: [] };
  const res = await generateJSON<{ corrected: T; changes: string[] }>({
    fast: true,
    reasoningEffort: "low",
    instructions: `You are auditing an AI-produced ${input.label} against the underlying evidence. Remove or fix any item not supported by the evidence (wrong dates, invented cites, misattributed statements), keep everything supported, and list each change you made in one line. Do not add new items. ${input.instructions ?? ""}`,
    input: `OUTPUT:\n${JSON.stringify(input.output).slice(0, 30_000)}\n\nEVIDENCE:\n${input.evidence.slice(0, 40_000)}`,
    schema: { type: "object", properties: { corrected: input.schema, changes: { type: "array", items: { type: "string" } } }, required: ["corrected", "changes"] },
    name: "self_correction",
    maxOutputTokens: 12_000,
    signal: input.signal,
  });
  return { corrected: res.corrected ?? input.output, changes: res.changes ?? [] };
}
