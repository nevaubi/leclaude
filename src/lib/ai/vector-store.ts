import "server-only";
import MiniSearch from "minisearch";
import { getSqlite } from "@/lib/db/sqlite";
import { aiConfig } from "./config";
import { bufferToFloat32, chunkText, cosine, embedTexts, embedText, float32ToBuffer } from "./embeddings";

export interface VectorHit {
  docId: string;
  chunkIndex: number;
  text: string;
  score: number; // 0..1 fused score
  semantic?: number;
  keyword?: number;
  meta?: Record<string, unknown>;
}

interface Row { doc_id: string; chunk_index: number; text: string; embedding: Uint8Array | null; meta: string | null; model: string | null }

type G = typeof globalThis & { __leclaudeVecCache?: Map<string, { rows: Row[]; vecs: (Float32Array | null)[]; mini: MiniSearch<{ id: string; text: string }> }> };

function cache() {
  const g = globalThis as G;
  if (!g.__leclaudeVecCache) g.__leclaudeVecCache = new Map();
  return g.__leclaudeVecCache;
}

function loadCollection(collection: string) {
  const c = cache();
  let entry = c.get(collection);
  if (entry) return entry;
  const rows = getSqlite().prepare("SELECT doc_id, chunk_index, text, embedding, meta, model FROM vectors WHERE collection = ?").all(collection) as unknown as Row[];
  const vecs = rows.map((r) => (r.embedding ? bufferToFloat32(r.embedding) : null));
  const mini = new MiniSearch<{ id: string; text: string }>({ fields: ["text"], storeFields: [], searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "AND" } });
  mini.addAll(rows.map((r, i) => ({ id: String(i), text: r.text })));
  entry = { rows, vecs, mini };
  c.set(collection, entry);
  return entry;
}

function invalidate(collection: string) {
  cache().delete(collection);
}

/**
 * Index a document's text as embedded chunks. Keyword-only indexing happens
 * even when embeddings fail (no API key), so search degrades gracefully.
 */
export async function indexDocument(collection: string, docId: string, text: string, meta: Record<string, unknown> = {}, opts: { embed?: boolean; chunkSize?: number } = {}) {
  const db = getSqlite();
  const chunks = chunkText(text, { size: opts.chunkSize ?? 1600 });
  let vecs: (Float32Array | null)[] = chunks.map(() => null);
  let model: string | null = null;
  if (opts.embed !== false && aiConfig().hasKey && chunks.length) {
    try { vecs = await embedTexts(chunks); model = aiConfig().embeddingModel; } catch (e) { console.warn(`[vector-store] embedding failed for ${collection}/${docId}:`, (e as Error).message); }
  }
  const del = db.prepare("DELETE FROM vectors WHERE collection = ? AND doc_id = ?");
  const ins = db.prepare("INSERT INTO vectors (collection, doc_id, chunk_index, text, embedding, meta, model) VALUES (?, ?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    del.run(collection, docId);
    chunks.forEach((t, i) => ins.run(collection, docId, i, t, vecs[i] ? float32ToBuffer(vecs[i]!) : null, JSON.stringify(meta), model));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  invalidate(collection);
  return { chunks: chunks.length, embedded: vecs.filter(Boolean).length };
}

/** Index many documents; embeds in batches for throughput. */
export async function indexDocuments(collection: string, docs: { id: string; text: string; meta?: Record<string, unknown> }[], opts: { embed?: boolean; chunkSize?: number; onProgress?: (done: number, total: number) => void } = {}) {
  const db = getSqlite();
  const all: { docId: string; idx: number; text: string; meta: Record<string, unknown> }[] = [];
  for (const d of docs) chunkText(d.text, { size: opts.chunkSize ?? 1600 }).forEach((t, i) => all.push({ docId: d.id, idx: i, text: t, meta: d.meta ?? {} }));
  let vecs: (Float32Array | null)[] = all.map(() => null);
  let model: string | null = null;
  if (opts.embed !== false && aiConfig().hasKey && all.length) {
    try { vecs = await embedTexts(all.map((a) => a.text)); model = aiConfig().embeddingModel; } catch (e) { console.warn(`[vector-store] batch embedding failed:`, (e as Error).message); }
  }
  const del = db.prepare("DELETE FROM vectors WHERE collection = ? AND doc_id = ?");
  const ins = db.prepare("INSERT INTO vectors (collection, doc_id, chunk_index, text, embedding, meta, model) VALUES (?, ?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    for (const d of docs) del.run(collection, d.id);
    all.forEach((a, i) => ins.run(collection, a.docId, a.idx, a.text, vecs[i] ? float32ToBuffer(vecs[i]!) : null, JSON.stringify(a.meta), model));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  invalidate(collection);
  opts.onProgress?.(docs.length, docs.length);
  return { docs: docs.length, chunks: all.length, embedded: vecs.filter(Boolean).length };
}

export function removeDocument(collection: string, docId: string) {
  getSqlite().prepare("DELETE FROM vectors WHERE collection = ? AND doc_id = ?").run(collection, docId);
  invalidate(collection);
}

export function indexStats(collection: string) {
  const { rows, vecs } = loadCollection(collection);
  const docs = new Set(rows.map((r) => r.doc_id)).size;
  return { docs, chunks: rows.length, embedded: vecs.filter(Boolean).length };
}

/**
 * Hybrid search: cosine similarity over embeddings fused (reciprocal rank)
 * with BM25 keyword results. Works keyword-only when no embeddings exist.
 */
export async function hybridSearch(collection: string, query: string, opts: { k?: number; filter?: (meta: Record<string, unknown>, docId: string) => boolean; perDoc?: number } = {}): Promise<VectorHit[]> {
  const k = opts.k ?? 10;
  const { rows, vecs, mini } = loadCollection(collection);
  if (!rows.length || !query.trim()) return [];

  const allowed = (i: number) => (opts.filter ? opts.filter(rows[i].meta ? JSON.parse(rows[i].meta!) : {}, rows[i].doc_id) : true);

  // keyword
  const kw = new Map<number, number>();
  try {
    const res = mini.search(query, { combineWith: "AND" });
    const res2 = res.length ? res : mini.search(query, { combineWith: "OR" });
    res2.forEach((r, rank) => { const i = Number(r.id); if (allowed(i)) kw.set(i, 1 / (60 + rank)); });
  } catch { /* ignore */ }

  // semantic
  const sem = new Map<number, number>();
  const semRaw = new Map<number, number>();
  const hasVecs = vecs.some(Boolean);
  if (hasVecs && aiConfig().hasKey) {
    try {
      const q = await embedText(query);
      const scored: { i: number; s: number }[] = [];
      for (let i = 0; i < rows.length; i++) { const v = vecs[i]; if (!v || !allowed(i)) continue; scored.push({ i, s: cosine(q, v) }); }
      scored.sort((a, b) => b.s - a.s).slice(0, k * 4).forEach((r, rank) => { sem.set(r.i, 1 / (60 + rank)); semRaw.set(r.i, r.s); });
    } catch (e) { console.warn("[vector-store] query embedding failed:", (e as Error).message); }
  }

  const fused = new Map<number, number>();
  for (const [i, s] of kw) fused.set(i, (fused.get(i) ?? 0) + s);
  for (const [i, s] of sem) fused.set(i, (fused.get(i) ?? 0) + s * 1.1);
  const max = Math.max(...fused.values(), 1e-9);

  const perDoc = opts.perDoc ?? 2;
  const seen = new Map<string, number>();
  const hits: VectorHit[] = [];
  for (const [i, s] of Array.from(fused.entries()).sort((a, b) => b[1] - a[1])) {
    const r = rows[i];
    const n = seen.get(r.doc_id) ?? 0;
    if (n >= perDoc) continue;
    seen.set(r.doc_id, n + 1);
    hits.push({ docId: r.doc_id, chunkIndex: r.chunk_index, text: r.text, score: s / max, semantic: semRaw.get(i), keyword: kw.get(i), meta: r.meta ? JSON.parse(r.meta) : undefined });
    if (hits.length >= k) break;
  }
  return hits;
}
