import "server-only";
import { db } from "@/lib/db";
import type { CachedHttpResponse, HttpCacheStore } from "@/lib/ai/toolkit/http";
import { INTEL_COLLECTIONS } from "../types";

/** One cached provider response, keyed by the request hash. */
export interface IntelHttpCacheRow extends CachedHttpResponse {
  id: string;
  url: string;
  size: number;
}

const MAX_BODY_CHARS = 1_000_000;
const MAX_ROWS = 400;

/**
 * 24h response cache in `intel_http_cache`. Bodies above 1MB are not cached
 * (the collection is fully memory-resident); expired and excess rows are
 * pruned on write so the cache stays bounded.
 */
export function dbHttpCache(): HttpCacheStore {
  const col = () => db().collection<IntelHttpCacheRow>(INTEL_COLLECTIONS.httpCache);
  return {
    get(key) {
      const row = col().get(key);
      if (!row) return null;
      if (new Date(row.expiresAt).getTime() < Date.now()) { col().delete(key); return null; }
      return row;
    },
    set(key, value) {
      if (value.body.length > MAX_BODY_CHARS) return;
      const c = col();
      c.put({ id: key, url: value.finalUrl, size: value.body.length, ...value });
      if (c.count() > MAX_ROWS) pruneHttpCache();
    },
  };
}

export function pruneHttpCache(now = Date.now()): number {
  const c = db().collection<IntelHttpCacheRow>(INTEL_COLLECTIONS.httpCache);
  let removed = 0;
  for (const row of c.all()) if (new Date(row.expiresAt).getTime() < now) { c.delete(row.id); removed++; }
  if (c.count() > MAX_ROWS) {
    const rows = c.list({ sortBy: "fetchedAt", direction: "asc" });
    for (const row of rows.slice(0, rows.length - MAX_ROWS)) { c.delete(row.id); removed++; }
  }
  return removed;
}

export function httpCacheStats() {
  const c = db().collection<IntelHttpCacheRow>(INTEL_COLLECTIONS.httpCache);
  let bytes = 0;
  for (const r of c.all()) bytes += r.size;
  return { rows: c.count(), bytes };
}
