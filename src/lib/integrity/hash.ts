import { createHash } from "node:crypto";

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Normalized text hash for near-exact duplicate detection (whitespace/case-insensitive). */
export function contentHash(text: string): string {
  return sha256(text.toLowerCase().replace(/\s+/g, " ").trim());
}

export { promptHash, fnv1a64 } from "./hash-pure";
