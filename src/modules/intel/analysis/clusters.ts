import "server-only";
import { db } from "@/lib/db";
import { bufferToFloat32 } from "@/lib/ai/embeddings";
import { INTEL_VECTOR_NAMESPACE, type IntelChunk, type IntelDocument, type IntelDocumentKind } from "../types";
import { documentMatches, intelChunks, intelDocuments, type ListDocumentsOptions } from "../store";
import { dateOf } from "./entities";
import { clip } from "./pure";
import { defaultK, denseToSparse, kmeans, labelClusters, memberSimilarity, tfidfVectors, type SparseVector } from "./vectors";
import type { ClusterResult, ClusterSummary } from "./types";

/**
 * Topic clusters over intel chunks for a scope (matter, kinds, entity, court,
 * query). Uses the stored embeddings when most chunks have them and falls
 * back to TF-IDF vectors otherwise; labels always come from TF-IDF terms.
 * Deterministic for a given scope (seeded k-means++).
 */
export interface ClusterScope extends Pick<ListDocumentsOptions, "matterId" | "kinds" | "entityId" | "court" | "courtId" | "jurisdiction" | "q" | "sourceId" | "dateFrom" | "dateTo"> {
  k?: number;
  maxChunks?: number;
  chunksPerDoc?: number;
  seed?: number;
  /** Force a method (tests). */
  method?: "embeddings" | "tfidf";
}

function loadEmbeddings(chunkIds: string[]): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  if (!chunkIds.length) return out;
  try {
    const raw = db().raw;
    const stmt = raw.prepare("SELECT doc_id, embedding FROM vectors WHERE collection = ? AND doc_id = ? AND embedding IS NOT NULL");
    for (const id of chunkIds) {
      const row = stmt.get(INTEL_VECTOR_NAMESPACE, id) as { doc_id: string; embedding: Uint8Array } | undefined;
      if (row?.embedding) out.set(row.doc_id, bufferToFloat32(row.embedding));
    }
  } catch { /* vectors table not ready */ }
  return out;
}

/** Select chunks for the scope: newest documents first, a few chunks per document, capped. */
export function selectChunks(scope: ClusterScope): { chunks: IntelChunk[]; docs: Map<string, IntelDocument> } {
  const maxChunks = scope.maxChunks ?? 600;
  const perDoc = scope.chunksPerDoc ?? 3;
  const filter: ListDocumentsOptions = { matterId: scope.matterId, kinds: scope.kinds, entityId: scope.entityId, court: scope.court, courtId: scope.courtId, jurisdiction: scope.jurisdiction, q: scope.q, sourceId: scope.sourceId, dateFrom: scope.dateFrom, dateTo: scope.dateTo };
  const docs = intelDocuments().find((d) => documentMatches(d, filter)).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? ""));
  const docMap = new Map<string, IntelDocument>();
  const chunks: IntelChunk[] = [];
  for (const d of docs) {
    if (chunks.length >= maxChunks) break;
    const mine = intelChunks().find((c) => c.docId === d.id).sort((a, b) => a.idx - b.idx).slice(0, perDoc);
    if (!mine.length) continue;
    docMap.set(d.id, d);
    chunks.push(...mine.slice(0, maxChunks - chunks.length));
  }
  return { chunks, docs: docMap };
}

/** Pure clustering over given chunk texts/vectors (tests call this without the database). */
export function clusterChunks(input: { chunks: { id: string; docId: string; text: string }[]; vectors?: Map<string, Float32Array>; k?: number; seed?: number; method?: "embeddings" | "tfidf" }): { assignments: Int32Array; labels: { label: string; terms: string[] }[]; method: "embeddings" | "tfidf"; k: number; iterations: number; similarity: number[] } {
  const n = input.chunks.length;
  const k = Math.max(1, Math.min(input.k ?? defaultK(n), n));
  const model = tfidfVectors(input.chunks.map((c) => c.text));
  const withVec = input.vectors ? input.chunks.filter((c) => input.vectors!.has(c.id)).length : 0;
  const useEmbeddings = input.method === "embeddings" ? withVec === n : input.method === "tfidf" ? false : n > 0 && withVec / n >= 0.8;
  let vectors: SparseVector[];
  let dims: number;
  if (useEmbeddings) {
    const dim = input.vectors!.get(input.chunks[0].id)!.length;
    vectors = input.chunks.map((c) => { const v = input.vectors!.get(c.id); return v ? denseToSparse(v) : denseToSparse(new Float32Array(dim)); });
    dims = dim;
  } else {
    vectors = model.vectors;
    dims = model.vocab.length;
  }
  if (!n || !dims) return { assignments: new Int32Array(n), labels: n ? [{ label: "All records", terms: [] }] : [], method: useEmbeddings ? "embeddings" : "tfidf", k: n ? 1 : 0, iterations: 0, similarity: new Array(n).fill(1) };
  const km = kmeans(vectors, k, { dims, seed: input.seed ?? 7, iterations: 25 });
  const labels = labelClusters(model, km.assignments, km.k);
  const similarity = vectors.map((v, i) => memberSimilarity(v, km.centroids[km.assignments[i]]));
  return { assignments: km.assignments, labels, method: useEmbeddings ? "embeddings" : "tfidf", k: km.k, iterations: km.iterations, similarity };
}

export function clusterScope(scope: ClusterScope = {}): ClusterResult {
  const { chunks, docs } = selectChunks(scope);
  const vectors = scope.method === "tfidf" ? undefined : loadEmbeddings(chunks.map((c) => c.id));
  const res = clusterChunks({ chunks, vectors, k: scope.k, seed: scope.seed, method: scope.method });
  const groups = new Map<number, IntelChunk[]>();
  chunks.forEach((c, i) => { const g = groups.get(res.assignments[i]) ?? []; g.push(c); groups.set(res.assignments[i], g); });
  const clusters: ClusterSummary[] = Array.from(groups.entries()).map(([c, members]) => {
    const docIds = Array.from(new Set(members.map((m) => m.docId)));
    const byKind: Partial<Record<IntelDocumentKind, number>> = {};
    let from: string | undefined, to: string | undefined;
    for (const id of docIds) { const d = docs.get(id); if (!d) continue; byKind[d.kind] = (byKind[d.kind] ?? 0) + 1; const date = dateOf(d); if (date) { if (!from || date < from) from = date; if (!to || date > to) to = date; } }
    const ranked = members.map((m) => ({ m, sim: res.similarity[chunks.indexOf(m)] ?? 0 })).sort((a, b) => b.sim - a.sim);
    const seen = new Set<string>();
    const topDocs: ClusterSummary["topDocs"] = [];
    for (const { m, sim } of ranked) { if (seen.has(m.docId) || topDocs.length >= 6) continue; seen.add(m.docId); const d = docs.get(m.docId); if (!d) continue; topDocs.push({ docId: d.id, title: d.title, kind: d.kind, similarity: Number(sim.toFixed(3)), chunkId: m.id, excerpt: clip(m.text, 220) }); }
    return { id: `c${c + 1}`, label: res.labels[c]?.label ?? `Cluster ${c + 1}`, terms: res.labels[c]?.terms ?? [], size: members.length, share: Number((members.length / Math.max(1, chunks.length)).toFixed(3)), docIds, chunkIds: members.map((m) => m.id), topDocs, byKind, dateRange: from && to ? { from, to } : undefined };
  }).sort((a, b) => b.size - a.size);
  return { method: res.method, k: res.k, chunks: chunks.length, documents: docs.size, iterations: res.iterations, clusters, scope: { matterId: scope.matterId, kinds: scope.kinds, entityId: scope.entityId, court: scope.court ?? scope.courtId, jurisdiction: scope.jurisdiction, q: scope.q, k: scope.k }, generatedAt: new Date().toISOString() };
}
