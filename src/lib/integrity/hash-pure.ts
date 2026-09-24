/** Dependency-free hashes usable in client and server bundles (no node:crypto). */

/** 64-bit FNV-1a as 16 hex chars; stable across runtimes. */
export function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5 ^ 0; // low 32 bits state (two 32-bit lanes for a 64-bit result)
  let h2 = 0x01000193 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c & 0xff;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c >>> 8) ^ (c & 0xff);
    h2 = Math.imul(h2, 0x0100019b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Short, stable hash for prompts (instructions + input); pure JS so it is safe in client components. */
export function promptHash(instructions: string, input: unknown): string {
  return fnv1a64(instructions + "\u0000" + (typeof input === "string" ? input : JSON.stringify(input ?? "")));
}
