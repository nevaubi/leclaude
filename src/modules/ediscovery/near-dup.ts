/**
 * Near-duplicate detection (pure, client-safe, unit-tested): word shingling +
 * MinHash signatures with LSH banding for candidate pairs. Estimated Jaccard
 * similarity over 4-word shingles of the normalised body text; email headers,
 * quoted-reply markers and Bates footers are stripped first so a forwarded
 * copy or a redlined draft scores high while distinct documents do not.
 */

export interface NearDupOptions {
  /** Shingle size in words (default 4). */
  k?: number;
  /** Signature length (default 64 hash functions). */
  hashes?: number;
  /** Minimum estimated similarity to report a pair (default 0.5). */
  threshold?: number;
  /** LSH bands (default 16; rows = hashes / bands). Fewer bands = fewer candidates. */
  bands?: number;
}

export interface NearDupPair { a: string; b: string; score: number }
export interface NearDupResult { pairs: NearDupPair[]; groups: string[][]; compared: number }

const HEADER_RE = /^(from|to|cc|bcc|date|sent|subject|re|fw|fwd):.*$/gim;
const QUOTE_RE = /^>.*$/gm;
const FOOTER_RE = /\b[A-Z]{2,8}-\d{4,10}\b/g;

/** Lowercase, drop email headers / quote markers / Bates stamps / punctuation, collapse whitespace. */
export function normalizeForShingles(text: string): string {
  return text
    .replace(HEADER_RE, " ")
    .replace(QUOTE_RE, " ")
    .replace(FOOTER_RE, " ")
    .replace(/\f/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a 32-bit over a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Hashed k-word shingles of a normalised text (a set of 32-bit ints). */
export function shingles(text: string, k = 4): Set<number> {
  const words = normalizeForShingles(text).split(" ").filter(Boolean);
  const out = new Set<number>();
  if (words.length < k) { if (words.length) out.add(hash32(words.join(" "))); return out; }
  for (let i = 0; i + k <= words.length; i++) out.add(hash32(words.slice(i, i + k).join(" ")));
  return out;
}

const P = 4294967311; // prime > 2^32

/** Deterministic (a, b) coefficients for the hash family h_i(x) = (a_i·x + b_i) mod P. */
function coefficients(n: number): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  let seed = 0x9e3779b9;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < n; i++) out.push({ a: (next() % (P - 1)) + 1, b: next() % P });
  return out;
}

const COEFF_CACHE = new Map<number, { a: number; b: number }[]>();

/** (a · x) mod P without leaving the exact-integer range (a, x < 2^33). */
function mulMod(a: number, x: number): number {
  const ah = Math.floor(a / 65536), al = a % 65536;
  return (((ah * x) % P) * 65536 + al * x) % P;
}

/** MinHash signature of a shingle set. An empty set yields a signature of Infinity values (never similar). */
export function minhash(set: Set<number>, hashes = 64): number[] {
  let coeff = COEFF_CACHE.get(hashes);
  if (!coeff) { coeff = coefficients(hashes); COEFF_CACHE.set(hashes, coeff); }
  const sig = new Array<number>(hashes).fill(Number.POSITIVE_INFINITY);
  for (const x of set) {
    for (let i = 0; i < hashes; i++) {
      const v = (mulMod(coeff[i].a, x) + coeff[i].b) % P;
      if (v < sig[i]) sig[i] = v;
    }
  }
  return sig;
}

/** Fraction of matching signature positions (≈ Jaccard similarity). */
export function estimateSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i] && Number.isFinite(a[i])) same++;
  return same / a.length;
}

/** Exact Jaccard over two shingle sets (used to confirm candidates on small corpora). */
export function jaccard(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Find near-duplicate pairs among documents. Small corpora (≤ 400 docs) are
 * compared exhaustively with exact Jaccard; larger ones use LSH banding over
 * the MinHash signatures to pick candidates, then the estimated similarity.
 */
export function detectNearDuplicates(docs: { id: string; text: string }[], opts: NearDupOptions = {}): NearDupResult {
  const k = opts.k ?? 4;
  const hashes = opts.hashes ?? 64;
  const threshold = opts.threshold ?? 0.5;
  const bands = Math.max(1, Math.min(hashes, opts.bands ?? 16));
  const rows = Math.max(1, Math.floor(hashes / bands));
  const sets = docs.map((d) => shingles(d.text, k));
  const pairs: NearDupPair[] = [];
  let compared = 0;
  const seen = new Set<string>();
  const consider = (i: number, j: number, score: number) => {
    const key = i < j ? `${i}|${j}` : `${j}|${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    compared++;
    if (score >= threshold) pairs.push({ a: docs[i].id, b: docs[j].id, score: Number(score.toFixed(3)) });
  };
  if (docs.length <= 400) {
    for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) consider(i, j, jaccard(sets[i], sets[j]));
  } else {
    const sigs = sets.map((s) => minhash(s, hashes));
    for (let b = 0; b < bands; b++) {
      const buckets = new Map<string, number[]>();
      for (let i = 0; i < sigs.length; i++) {
        const slice = sigs[i].slice(b * rows, (b + 1) * rows);
        if (!slice.every(Number.isFinite)) continue;
        const key = slice.join(",");
        const list = buckets.get(key) ?? [];
        list.push(i);
        buckets.set(key, list);
      }
      for (const list of buckets.values()) if (list.length > 1) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) consider(list[x], list[y], estimateSimilarity(sigs[list[x]], sigs[list[y]]));
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.a.localeCompare(b.a));
  return { pairs, groups: groupPairs(pairs), compared };
}

/** Connected components over the pairs (union-find), each sorted by id. */
export function groupPairs(pairs: NearDupPair[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let p = parent.get(x) ?? x; while (p !== x) { x = p; p = parent.get(x) ?? x; } return p; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const p of pairs) { if (!parent.has(p.a)) parent.set(p.a, p.a); if (!parent.has(p.b)) parent.set(p.b, p.b); union(p.a, p.b); }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) { const r = find(id); groups.set(r, [...(groups.get(r) ?? []), id]); }
  return Array.from(groups.values()).map((g) => g.sort()).filter((g) => g.length > 1).sort((a, b) => a[0].localeCompare(b[0]));
}

/** Merge detected pairs into per-document near-duplicate ids and scores (both directions). */
export function nearDuplicateMap(pairs: NearDupPair[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const p of pairs) {
    out.set(p.a, { ...(out.get(p.a) ?? {}), [p.b]: p.score });
    out.set(p.b, { ...(out.get(p.b) ?? {}), [p.a]: p.score });
  }
  return out;
}
