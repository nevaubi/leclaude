/**
 * Pure vector helpers for clustering: sparse TF-IDF vectors from text, a
 * deterministic k-means++ (seeded, cosine on L2-normalized vectors) that
 * accepts dense embeddings or sparse TF-IDF, and TF-IDF cluster labels.
 * Client-safe, no I/O.
 */

export interface SparseVector { idx: Int32Array | number[]; val: Float32Array | number[]; }

const STOP = new Set(("a an and are as at be by for from has have in is it its of on or that the to was were will with this these those which who whom whose there their they them then than into onto upon under over also any all not nor but if so such per via etc i ii iii iv v vi vii viii ix x court order motion case cases plaintiff plaintiffs defendant defendants party parties shall may must section subsection paragraph pursuant hereby herein thereof whether within without between among against because about after before during through each other same only more most less least very much many some both either neither can could would should did does do done make made being been having had here where when while yet still just even ever never also however therefore thus hence accordingly further furthermore moreover although though unless until since respect regard regarding including include includes included states united district judge dated entered filed docket entry text page pages no nos number numbers re et al inc llc corp co ltd").split(/\s+/));

export function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s-]+/g, " ").split(/\s+/).map((w) => w.replace(/^-+|-+$/g, "")).filter((w) => w.length >= 3 && w.length <= 40 && !STOP.has(w) && !/^\d+$/.test(w));
}

export interface TfidfModel { vocab: string[]; index: Map<string, number>; idf: Float32Array; vectors: SparseVector[]; }

/**
 * Build L2-normalized TF-IDF vectors. The vocabulary keeps the `maxTerms`
 * most frequent terms with document frequency ≥ `minDf` (1 for tiny corpora).
 */
export function tfidfVectors(texts: string[], opts: { maxTerms?: number; minDf?: number } = {}): TfidfModel {
  const maxTerms = opts.maxTerms ?? 3000;
  const docs = texts.map(tokenize);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const minDf = opts.minDf ?? (texts.length >= 8 ? 2 : 1);
  const vocab = Array.from(df.entries()).filter(([, n]) => n >= minDf && n < Math.max(2, texts.length * 0.9)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxTerms).map(([t]) => t);
  const index = new Map(vocab.map((t, i) => [t, i]));
  const n = Math.max(1, texts.length);
  const idf = new Float32Array(vocab.length);
  vocab.forEach((t, i) => { idf[i] = Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1; });
  const vectors: SparseVector[] = docs.map((d) => {
    const tf = new Map<number, number>();
    for (const t of d) { const i = index.get(t); if (i != null) tf.set(i, (tf.get(i) ?? 0) + 1); }
    const idxs = Array.from(tf.keys()).sort((a, b) => a - b);
    const vals = idxs.map((i) => (1 + Math.log(tf.get(i)!)) * idf[i]);
    const norm = Math.sqrt(vals.reduce((a, b) => a + b * b, 0)) || 1;
    return { idx: Int32Array.from(idxs), val: Float32Array.from(vals.map((v) => v / norm)) };
  });
  return { vocab, index, idf, vectors };
}

export function denseToSparse(v: Float32Array | number[]): SparseVector {
  const idx = new Int32Array(v.length);
  for (let i = 0; i < v.length; i++) idx[i] = i;
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const val = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) val[i] = v[i] / norm;
  return { idx, val };
}

/** Dot product between a sparse vector and a dense centroid. */
function dotDense(v: SparseVector, c: Float64Array): number {
  let s = 0;
  for (let k = 0; k < v.idx.length; k++) s += v.val[k] * c[v.idx[k]];
  return s;
}

function dotSparse(a: SparseVector, b: SparseVector): number {
  let i = 0, j = 0, s = 0;
  while (i < a.idx.length && j < b.idx.length) {
    if (a.idx[i] === b.idx[j]) { s += a.val[i] * b.val[j]; i++; j++; } else if (a.idx[i] < b.idx[j]) i++; else j++;
  }
  return s;
}

/** Small deterministic PRNG (mulberry32) so clustering is reproducible. */
export function seededRandom(seed = 42): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface KMeansResult { assignments: Int32Array; centroids: Float64Array[]; inertia: number; iterations: number; k: number; sizes: number[] }

/** Default k: √(n/2) clamped to [2, 8]. */
export function defaultK(n: number, max = 8): number {
  if (n < 4) return Math.max(1, Math.min(n, 2));
  return Math.max(2, Math.min(max, Math.round(Math.sqrt(n / 2))));
}

/**
 * k-means++ over L2-normalized sparse vectors using cosine similarity
 * (distance = 1 − cos). Centroids are dense; empty clusters are re-seeded
 * with the farthest point. Deterministic for a given seed.
 */
export function kmeans(vectors: SparseVector[], k: number, opts: { dims: number; iterations?: number; seed?: number } = { dims: 0 }): KMeansResult {
  const n = vectors.length;
  const dims = opts.dims || Math.max(0, ...vectors.map((v) => (v.idx.length ? Number(v.idx[v.idx.length - 1]) + 1 : 0)));
  const K = Math.max(1, Math.min(k, n));
  const assignments = new Int32Array(n);
  if (!n) return { assignments, centroids: [], inertia: 0, iterations: 0, k: 0, sizes: [] };
  const rnd = seededRandom(opts.seed ?? 42);
  const toDense = (v: SparseVector) => { const c = new Float64Array(dims); for (let i = 0; i < v.idx.length; i++) c[v.idx[i]] = v.val[i]; return c; };
  // k-means++ seeding
  const centroids: Float64Array[] = [];
  const first = Math.floor(rnd() * n);
  centroids.push(toDense(vectors[first]));
  const seedIdx = [first];
  while (centroids.length < K) {
    const d2 = vectors.map((v) => { let best = Infinity; for (const c of centroids) best = Math.min(best, 1 - dotDense(v, c)); return Math.max(0, best) ** 2; });
    const total = d2.reduce((a, b) => a + b, 0);
    let pick = 0;
    if (total <= 0) { pick = vectors.findIndex((_, i) => !seedIdx.includes(i)); if (pick < 0) pick = 0; }
    else { let r = rnd() * total; for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } } }
    seedIdx.push(pick);
    centroids.push(toDense(vectors[pick]));
  }
  const iterations = opts.iterations ?? 20;
  let iter = 0;
  let inertia = 0;
  for (; iter < iterations; iter++) {
    let changed = 0;
    inertia = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) { const s = dotDense(vectors[i], centroids[c]); if (s > bestSim) { bestSim = s; best = c; } }
      if (assignments[i] !== best) { assignments[i] = best; changed++; }
      inertia += 1 - bestSim;
    }
    // recompute centroids (mean of members, re-normalized)
    const sums = centroids.map(() => new Float64Array(dims));
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < n; i++) { const v = vectors[i]; const s = sums[assignments[i]]; for (let j = 0; j < v.idx.length; j++) s[v.idx[j]] += v.val[j]; counts[assignments[i]]++; }
    for (let c = 0; c < centroids.length; c++) {
      if (!counts[c]) {
        // empty cluster: move it to the point farthest from its centroid
        let far = 0, farD = -1;
        for (let i = 0; i < n; i++) { const d = 1 - dotDense(vectors[i], centroids[assignments[i]]); if (d > farD) { farD = d; far = i; } }
        centroids[c] = toDense(vectors[far]);
        assignments[far] = c;
        changed++;
        continue;
      }
      const s = sums[c];
      let norm = 0;
      for (let j = 0; j < dims; j++) norm += s[j] * s[j];
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < dims; j++) s[j] /= norm;
      centroids[c] = s;
    }
    if (!changed && iter > 0) break;
  }
  const sizes = new Array(centroids.length).fill(0);
  for (let i = 0; i < n; i++) sizes[assignments[i]]++;
  return { assignments, centroids, inertia: Number(inertia.toFixed(4)), iterations: iter, k: centroids.length, sizes };
}

/** Cosine similarity of a member to its centroid (for "representative" ordering). */
export function memberSimilarity(v: SparseVector, centroid: Float64Array): number {
  return dotDense(v, centroid);
}

export function cosineSparse(a: SparseVector, b: SparseVector): number {
  return dotSparse(a, b);
}

/**
 * Label each cluster with the terms whose mean TF-IDF weight inside the
 * cluster exceeds the corpus mean the most (distinctive, not merely frequent).
 */
export function labelClusters(model: TfidfModel, assignments: Int32Array | number[], k: number, opts: { terms?: number } = {}): { label: string; terms: string[] }[] {
  const T = opts.terms ?? 4;
  const dims = model.vocab.length;
  const global = new Float64Array(dims);
  const n = model.vectors.length || 1;
  for (const v of model.vectors) for (let i = 0; i < v.idx.length; i++) global[v.idx[i]] += v.val[i] / n;
  const out: { label: string; terms: string[] }[] = [];
  for (let c = 0; c < k; c++) {
    const acc = new Float64Array(dims);
    let count = 0;
    model.vectors.forEach((v, i) => { if (assignments[i] !== c) return; count++; for (let j = 0; j < v.idx.length; j++) acc[v.idx[j]] += v.val[j]; });
    if (!count) { out.push({ label: `Cluster ${c + 1}`, terms: [] }); continue; }
    const scored: { t: string; s: number }[] = [];
    for (let j = 0; j < dims; j++) { const mean = acc[j] / count; if (mean > 0) scored.push({ t: model.vocab[j], s: mean - global[j] * 0.5 }); }
    scored.sort((a, b) => b.s - a.s);
    const terms = scored.slice(0, T).map((x) => x.t);
    out.push({ label: terms.length ? terms.slice(0, 3).join(" · ") : `Cluster ${c + 1}`, terms });
  }
  return out;
}
