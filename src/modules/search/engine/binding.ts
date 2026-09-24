import "server-only";
import { createHash } from "node:crypto";

/**
 * Answer-version binding (constitution §23). Verification, citation checks and human
 * review attach to the sha256 of the exact answer text they examined; a changed answer
 * gets a new hash and every verdict for the old hash stops being current.
 *
 * The canonical form (NFC, whitespace runs collapsed, trimmed) matches
 * `src/lib/evidence/hash.ts` so hashes stay comparable across modules.
 */
export function canonicalAnswerText(text: string): string {
  return (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export function answerHash(text: string): string {
  return createHash("sha256").update(canonicalAnswerText(text)).digest("hex");
}

/** Artifact id for a research answer version: `<runId>@<version>`. */
export function answerArtifactId(runId: string, version: number): string {
  return `${runId}@${version}`;
}
