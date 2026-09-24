import "server-only";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/integrity/hash";
import type { ReadRef } from "../types";

/** Full-text source reads are cached for 24 hours so lanes, the reader sheet and re-runs never fetch the same page twice. */
export const SOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 120_000;

export interface CachedSource {
  id: string;
  key: string;
  kind: ReadRef["kind"];
  title?: string;
  cite?: string;
  url?: string;
  text: string;
  length: number;
  fetchedAt: string;
  hits: number;
}

export const sourceCache = () => db().collection<CachedSource>("search_source_cache");

export function cacheKey(ref: ReadRef): string {
  switch (ref.kind) {
    case "opinion": return `opinion:${ref.id}`;
    case "cfr": return `cfr:${ref.title}:${ref.section}`;
    case "fr": return `fr:${ref.id}`;
    case "library": return `library:${ref.id}`;
    case "edoc": return `edoc:${ref.id}`;
    case "url":
    case "statute": return `url:${ref.url.trim()}`;
  }
}

export function getCached(ref: ReadRef, now = Date.now()): CachedSource | null {
  const key = cacheKey(ref);
  const row = sourceCache().get(sha256(key).slice(0, 24));
  if (!row) return null;
  if (now - new Date(row.fetchedAt).getTime() > SOURCE_CACHE_TTL_MS) { sourceCache().delete(row.id); return null; }
  sourceCache().put({ ...row, hits: row.hits + 1 });
  return row;
}

export function putCached(ref: ReadRef, r: { title?: string; cite?: string; url?: string; text: string }): CachedSource {
  const key = cacheKey(ref);
  // Matter documents and library items are already local; caching them buys nothing and risks staleness after edits.
  const row: CachedSource = { id: sha256(key).slice(0, 24), key, kind: ref.kind, title: r.title, cite: r.cite, url: r.url, text: r.text.slice(0, MAX_TEXT), length: r.text.length, fetchedAt: new Date().toISOString(), hits: 0 };
  if (ref.kind !== "edoc" && ref.kind !== "library") sourceCache().put(row);
  return row;
}

/** Drop expired rows (called opportunistically at the end of a run). */
export function sweepCache(now = Date.now()): number {
  const c = sourceCache();
  let n = 0;
  for (const row of c.all()) if (now - new Date(row.fetchedAt).getTime() > SOURCE_CACHE_TTL_MS) { c.delete(row.id); n++; }
  return n;
}
