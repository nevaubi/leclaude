import { createHash } from "node:crypto";

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Normalized text hash for near-exact duplicate detection (whitespace/case-insensitive). */
export function contentHash(text: string): string {
  return sha256(text.toLowerCase().replace(/\s+/g, " ").trim());
}

/** Short, stable hash for prompts (instructions + input). */
export function promptHash(instructions: string, input: unknown): string {
  return sha256(instructions + "\u0000" + (typeof input === "string" ? input : JSON.stringify(input))).slice(0, 16);
}
