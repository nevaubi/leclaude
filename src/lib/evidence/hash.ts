/**
 * Artifact hashing (constitution §23 answer-version binding). Client-safe.
 *
 * Verification, citation checks and human approval bind to the sha256 of the canonical artifact text, so any
 * change to the answer (even whitespace-preserving rewording) produces a new hash and drops stale verification.
 * Whitespace is canonicalized so that re-serialization (CRLF, trailing spaces, indentation) does not churn hashes.
 */

/** Unicode NFC, all whitespace runs collapsed to one space, trimmed. */
export function canonicalText(text: string): string {
  return (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

async function nodeSha256(text: string): Promise<string> {
  // The module name is computed so browser bundlers do not try to resolve node:crypto.
  const name = "node:crypto";
  const mod = (await import(/* webpackIgnore: true */ name)) as { createHash: (alg: string) => { update(data: string): { digest(enc: "hex"): string } } };
  return mod.createHash("sha256").update(text).digest("hex");
}

/** sha256 hex of the given text (no canonicalization). Web Crypto first, node:crypto as fallback. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return toHex(digest);
  }
  return nodeSha256(text);
}

/** The artifact hash: sha256 of the canonical text. Everything in the evidence contract keys on this value. */
export async function artifactHash(text: string): Promise<string> {
  return sha256Hex(canonicalText(text));
}

/** Short display form of a hash (first 12 hex chars). */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
