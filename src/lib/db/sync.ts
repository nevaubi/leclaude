import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { cacheRegistry, getSqlite } from "./sqlite";
import { REMOTE_SCHEMA, fromBytea, remoteStore, type RemoteStore, type Row, type SqlQuery } from "./remote";

/**
 * Durable, shared storage for serverless hosts.
 *
 * With a remote store configured (DATABASE_URL / POSTGRES_URL), the local SQLite file is a
 * per-instance mirror and Postgres is authoritative:
 *
 *   request start  → syncDb(): hydrate the mirror on cold start, then apply the changes other
 *                    instances logged since this instance's last sync (lc_changes)
 *   during request → reads and writes stay synchronous against the mirror; writes mark keys dirty
 *   request end    → flushDb(): push dirty keys to Postgres in one transaction and log them
 *
 * Without a remote store every function here is a no-op and the app runs on plain SQLite
 * (local development, tests, single-server deployments with a persistent disk).
 *
 * Consistency: last writer wins per record. Unflushed local writes are never overwritten by a pull.
 */

export type SyncTable = "docs" | "kv" | "blobs" | "vectors";

interface State {
  hydrated: boolean;
  lastSeq: number;
  dirty: Map<string, { tbl: SyncTable; k1: string; k2: string }>;
  applying: boolean;
  syncing: Promise<void> | null;
  flushing: Promise<void> | null;
  listeners: Set<() => void>;
}

type G = typeof globalThis & { __leclaudeSync?: State };

function state(): State {
  const g = globalThis as G;
  if (!g.__leclaudeSync) g.__leclaudeSync = { hydrated: false, lastSeq: 0, dirty: new Map(), applying: false, syncing: null, flushing: null, listeners: new Set() };
  return g.__leclaudeSync;
}

/** True when a remote store is configured (serverless mode). */
export function remoteEnabled(): boolean {
  return remoteStore() !== null;
}

/** True once this instance's mirror holds the remote data (always true in local mode). */
export function mirrorReady(): boolean {
  return !remoteEnabled() || state().hydrated;
}

/** Called by the data layer after every local write. */
export function markDirty(tbl: SyncTable, k1: string, k2 = ""): void {
  const s = state();
  if (s.applying || !remoteEnabled()) return;
  s.dirty.set(`${tbl}\u0000${k1}\u0000${k2}`, { tbl, k1, k2 });
}

/** Run after each successful hydrate/pull (e.g. re-apply the workspace identity, seed reference data). */
export function onSynced(fn: () => void): void {
  state().listeners.add(fn);
}

export function pendingWrites(): number {
  return state().dirty.size;
}

// ---------------------------------------------------------------------------
// Local mirror helpers
// ---------------------------------------------------------------------------

function localCols(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

function ensureLocalCols(db: DatabaseSync, table: string, names: string[]): void {
  const have = localCols(db, table);
  for (const n of names) if (!have.has(n) && /^[a-z_][a-z0-9_]*$/i.test(n)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${n}`);
}

function setCachedDoc(collection: string, id: string, json: string | null): void {
  const c = cacheRegistry.get(collection);
  if (!c) return;
  if (json == null) c.delete(id);
  else c.set(id, JSON.parse(json));
}

type VecInvalidator = (collection: string) => void;
let vectorInvalidator: VecInvalidator | null = null;

/** The vector store registers how to drop its per-collection cache when remote rows arrive. */
export function registerVectorInvalidator(fn: VecInvalidator): void {
  vectorInvalidator = fn;
}

function applyDoc(db: DatabaseSync, collection: string, id: string, row: Row | undefined): void {
  if (!row) {
    db.prepare("DELETE FROM docs WHERE collection = ? AND id = ?").run(collection, id);
    setCachedDoc(collection, id, null);
    return;
  }
  db.prepare("INSERT INTO docs (collection, id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .run(collection, id, row.json!, row.created_at!, row.updated_at!);
  setCachedDoc(collection, id, row.json!);
}

function applyKv(db: DatabaseSync, key: string, row: Row | undefined): void {
  if (!row) db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  else db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, row.value!, row.updated_at!);
}

function applyBlob(db: DatabaseSync, id: string, row: Row | undefined): void {
  if (!row) { db.prepare("DELETE FROM blobs WHERE id = ?").run(id); return; }
  db.prepare("INSERT INTO blobs (id, name, mime, size, bytes, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime, size = excluded.size, bytes = excluded.bytes, meta = excluded.meta")
    .run(id, row.name, row.mime!, Number(row.size), fromBytea(row.bytes) ?? new Uint8Array(), row.meta, row.created_at!);
}

function applyVectors(db: DatabaseSync, collection: string, docId: string, rows: Row[]): void {
  db.prepare("DELETE FROM vectors WHERE collection = ? AND doc_id = ?").run(collection, docId);
  for (const r of rows) {
    const obj = JSON.parse(r.row_json!) as Record<string, unknown>;
    const cols = Object.keys(obj).filter((k) => k !== "embedding");
    ensureLocalCols(db, "vectors", cols);
    const names = [...cols, "embedding"];
    const values = [...cols.map((k) => (obj[k] == null ? null : typeof obj[k] === "object" ? JSON.stringify(obj[k]) : (obj[k] as string | number))), fromBytea(r.embedding)];
    db.prepare(`INSERT INTO vectors (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...(values as (string | number | null | Uint8Array)[]));
  }
  vectorInvalidator?.(collection);
}

function withApplying<T>(fn: () => T): T {
  const s = state();
  s.applying = true;
  try { return fn(); } finally { s.applying = false; }
}

// ---------------------------------------------------------------------------
// Hydrate / pull
// ---------------------------------------------------------------------------

async function ensureRemoteSchema(store: RemoteStore): Promise<void> {
  await store.transaction(REMOTE_SCHEMA);
}

/** Upper bound on the payload of one hydration request (bytea travels as hex, so bytes count twice). */
const HYDRATE_BATCH_BYTES = 2_500_000;
const HYDRATE_BATCH_ROWS = 500;

/** Group keys into batches whose summed size stays under the byte and row budgets (a single oversized row gets its own batch). */
function sizeBatches<K>(rows: { key: K; size: number }[]): K[][] {
  const out: K[][] = [];
  let cur: K[] = [];
  let bytes = 0;
  for (const r of rows) {
    if (cur.length && (bytes + r.size > HYDRATE_BATCH_BYTES || cur.length >= HYDRATE_BATCH_ROWS)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(r.key);
    bytes += r.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

const placeholders = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `$${i + from}`).join(", ");

/**
 * Cold-start hydration in size-bounded requests. One request per table used to return every document, file and
 * embedding at once, which exceeds the database HTTP endpoint's response limit once a workspace holds real data
 * (a demo pack alone is several MB of files) and made every server-rendered page fail on a fresh instance.
 * Keys and sizes are listed first, then rows are fetched in batches under HYDRATE_BATCH_BYTES.
 */
async function fetchInBatches(store: RemoteStore): Promise<{ seq: string; docs: Row[]; kv: Row[]; blobs: Row[]; vectors: Row[] }> {
  const [[seqRow], docKeys, kv, blobKeys, vecKeys] = await store.transaction([
    { query: "SELECT COALESCE(MAX(seq), 0)::text AS seq FROM lc_changes" },
    { query: "SELECT collection, id, octet_length(json)::text AS size FROM lc_docs ORDER BY collection, id" },
    { query: "SELECT key, value, updated_at FROM lc_kv" },
    { query: "SELECT id, (size * 2)::text AS size FROM lc_blobs ORDER BY id" },
    { query: "SELECT collection, doc_id, SUM(octet_length(row_json) + COALESCE(octet_length(embedding), 0) * 2)::text AS size FROM lc_vectors GROUP BY collection, doc_id ORDER BY collection, doc_id" },
  ]);
  const docs: Row[] = [];
  for (const batch of sizeBatches(docKeys.map((r) => ({ key: [r.collection!, r.id!] as [string, string], size: Number(r.size ?? 0) })))) {
    const where = batch.map((_, i) => `(collection = $${i * 2 + 1} AND id = $${i * 2 + 2})`).join(" OR ");
    docs.push(...(await store.query({ query: `SELECT collection, id, json, created_at, updated_at FROM lc_docs WHERE ${where}`, params: batch.flat() })));
  }
  const blobs: Row[] = [];
  for (const batch of sizeBatches(blobKeys.map((r) => ({ key: r.id!, size: Number(r.size ?? 0) })))) {
    blobs.push(...(await store.query({ query: `SELECT id, name, mime, size::text AS size, bytes, meta, created_at FROM lc_blobs WHERE id IN (${placeholders(batch.length)})`, params: batch })));
  }
  const vectors: Row[] = [];
  for (const batch of sizeBatches(vecKeys.map((r) => ({ key: [r.collection!, r.doc_id!] as [string, string], size: Number(r.size ?? 0) })))) {
    const where = batch.map((_, i) => `(collection = $${i * 2 + 1} AND doc_id = $${i * 2 + 2})`).join(" OR ");
    vectors.push(...(await store.query({ query: `SELECT collection, doc_id, chunk_index::text AS chunk_index, row_json, embedding FROM lc_vectors WHERE ${where} ORDER BY collection, doc_id, chunk_index`, params: batch.flat() })));
  }
  return { seq: seqRow?.seq ?? "0", docs, kv, blobs, vectors };
}

async function hydrate(store: RemoteStore): Promise<void> {
  await ensureRemoteSchema(store);
  const { seq, docs, kv, blobs, vectors } = await fetchInBatches(store);
  const db = getSqlite();
  withApplying(() => {
    db.exec("BEGIN");
    try {
      db.exec("DELETE FROM docs; DELETE FROM kv; DELETE FROM blobs; DELETE FROM vectors;");
      for (const r of docs) applyDoc(db, r.collection!, r.id!, r);
      for (const r of kv) applyKv(db, r.key!, r);
      for (const r of blobs) applyBlob(db, r.id!, r);
      const byDoc = new Map<string, Row[]>();
      for (const r of vectors) {
        const k = `${r.collection}\u0000${r.doc_id}`;
        byDoc.set(k, [...(byDoc.get(k) ?? []), r]);
      }
      for (const [k, rows] of byDoc) { const [c, d] = k.split("\u0000"); applyVectors(db, c, d, rows); }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  cacheRegistry.clear();
  const s = state();
  s.lastSeq = Number(seq);
  s.hydrated = true;
}

const PULL_GROUP = 100;
const PULL_BLOB_GROUP = 4;

async function pull(store: RemoteStore): Promise<void> {
  const s = state();
  for (;;) {
    const changes = await store.query({ query: "SELECT seq::text AS seq, tbl, k1, k2 FROM lc_changes WHERE seq > $1 ORDER BY seq LIMIT 2000", params: [s.lastSeq] });
    if (!changes.length) return;
    const keys = new Map<string, { tbl: SyncTable; k1: string; k2: string }>();
    for (const c of changes) {
      const key = `${c.tbl}\u0000${c.k1}\u0000${c.k2 ?? ""}`;
      if (s.dirty.has(key)) continue; // local unflushed write wins until flushed
      keys.set(key, { tbl: c.tbl as SyncTable, k1: c.k1!, k2: c.k2 ?? "" });
    }
    const items = Array.from(keys.values());
    const reads: SqlQuery[] = items.map((it) => {
      switch (it.tbl) {
        case "docs": return { query: "SELECT collection, id, json, created_at, updated_at FROM lc_docs WHERE collection = $1 AND id = $2", params: [it.k1, it.k2] };
        case "kv": return { query: "SELECT key, value, updated_at FROM lc_kv WHERE key = $1", params: [it.k1] };
        case "blobs": return { query: "SELECT id, name, mime, size::text AS size, bytes, meta, created_at FROM lc_blobs WHERE id = $1", params: [it.k1] };
        case "vectors": return { query: "SELECT collection, doc_id, chunk_index::text AS chunk_index, row_json, embedding FROM lc_vectors WHERE collection = $1 AND doc_id = $2 ORDER BY chunk_index", params: [it.k1, it.k2] };
      }
    });
    // Read in small groups so one large change set (a demo load, a bulk import) never exceeds the endpoint's response
    // limit: files alone can be several MB, so they travel a few at a time.
    const results: Row[][] = [];
    for (let i = 0; i < reads.length;) {
      const group: SqlQuery[] = [];
      let groupBlobs = 0;
      while (i < reads.length && group.length < PULL_GROUP && groupBlobs < PULL_BLOB_GROUP) {
        if (items[i].tbl === "blobs") groupBlobs++;
        group.push(reads[i]);
        i++;
      }
      results.push(...(await store.transaction(group)));
    }
    const db = getSqlite();
    withApplying(() => {
      items.forEach((it, i) => {
        const rows = results[i] ?? [];
        if (it.tbl === "docs") applyDoc(db, it.k1, it.k2, rows[0]);
        else if (it.tbl === "kv") applyKv(db, it.k1, rows[0]);
        else if (it.tbl === "blobs") applyBlob(db, it.k1, rows[0]);
        else applyVectors(db, it.k1, it.k2, rows);
      });
    });
    s.lastSeq = Number(changes[changes.length - 1].seq);
    if (changes.length < 2000) return;
  }
}

/** Bring this instance's mirror up to date with the shared store. No-op without a remote store. */
let lastError: string | null = null;

/** The message of the most recent failed sync on this instance (null once a sync succeeds). */
export function lastSyncError(): string | null {
  return lastError;
}

export async function syncDb(): Promise<void> {
  const store = remoteStore();
  if (!store) return;
  const s = state();
  if (s.syncing) return s.syncing;
  s.syncing = (async () => {
    try {
      try {
        if (!s.hydrated) await hydrate(store);
        else await pull(store);
        lastError = null;
      } catch (e) {
        lastError = `${(e as Error).message}${(e as Error & { cause?: Error }).cause ? ` (cause: ${((e as Error & { cause?: Error }).cause as Error).message})` : ""}`;
        throw e;
      }
      for (const fn of s.listeners) { try { fn(); } catch (e) { console.warn("[db-sync] listener failed", (e as Error).message); } }
    } finally {
      s.syncing = null;
    }
  })();
  return s.syncing;
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

function writeQueries(db: DatabaseSync, it: { tbl: SyncTable; k1: string; k2: string }): SqlQuery[] {
  const log: SqlQuery = { query: "INSERT INTO lc_changes (tbl, k1, k2) VALUES ($1, $2, $3)", params: [it.tbl, it.k1, it.k2] };
  switch (it.tbl) {
    case "docs": {
      const r = db.prepare("SELECT json, created_at, updated_at FROM docs WHERE collection = ? AND id = ?").get(it.k1, it.k2) as { json: string; created_at: string; updated_at: string } | undefined;
      return [r
        ? { query: "INSERT INTO lc_docs (collection, id, json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (collection, id) DO UPDATE SET json = EXCLUDED.json, updated_at = EXCLUDED.updated_at", params: [it.k1, it.k2, r.json, r.created_at, r.updated_at] }
        : { query: "DELETE FROM lc_docs WHERE collection = $1 AND id = $2", params: [it.k1, it.k2] }, log];
    }
    case "kv": {
      const r = db.prepare("SELECT value, updated_at FROM kv WHERE key = ?").get(it.k1) as { value: string; updated_at: string } | undefined;
      return [r
        ? { query: "INSERT INTO lc_kv (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at", params: [it.k1, r.value, r.updated_at] }
        : { query: "DELETE FROM lc_kv WHERE key = $1", params: [it.k1] }, log];
    }
    case "blobs": {
      const r = db.prepare("SELECT name, mime, size, bytes, meta, created_at FROM blobs WHERE id = ?").get(it.k1) as { name: string | null; mime: string; size: number; bytes: Uint8Array; meta: string | null; created_at: string } | undefined;
      return [r
        ? { query: "INSERT INTO lc_blobs (id, name, mime, size, bytes, meta, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, size = EXCLUDED.size, bytes = EXCLUDED.bytes, meta = EXCLUDED.meta", params: [it.k1, r.name, r.mime, r.size, new Uint8Array(r.bytes), r.meta, r.created_at] }
        : { query: "DELETE FROM lc_blobs WHERE id = $1", params: [it.k1] }, log];
    }
    case "vectors": {
      const rows = db.prepare("SELECT * FROM vectors WHERE collection = ? AND doc_id = ? ORDER BY chunk_index").all(it.k1, it.k2) as Record<string, unknown>[];
      const qs: SqlQuery[] = [{ query: "DELETE FROM lc_vectors WHERE collection = $1 AND doc_id = $2", params: [it.k1, it.k2] }];
      for (const r of rows) {
        const { embedding, ...rest } = r;
        qs.push({ query: "INSERT INTO lc_vectors (collection, doc_id, chunk_index, row_json, embedding) VALUES ($1, $2, $3, $4, $5)", params: [it.k1, it.k2, Number(rest.chunk_index), JSON.stringify(rest), embedding ? new Uint8Array(embedding as Uint8Array) : null] });
      }
      return [...qs, log];
    }
  }
}

const MAX_BATCH_BYTES = 3_000_000;

/** Push this instance's writes to the shared store. Throws when they could not be made durable. */
export async function flushDb(): Promise<void> {
  const store = remoteStore();
  if (!store) return;
  const s = state();
  if (s.flushing) await s.flushing;
  if (!s.dirty.size) return;
  const items = Array.from(s.dirty.entries());
  s.dirty.clear();
  s.flushing = (async () => {
    const db = getSqlite();
    let batch: SqlQuery[] = [];
    let size = 0;
    let done = 0;
    try {
      for (const [, it] of items) {
        const qs = writeQueries(db, it);
        const bytes = JSON.stringify(qs.map((q) => q.params?.map((p) => (p instanceof Uint8Array ? p.byteLength * 2 : p)))).length;
        if (batch.length && size + bytes > MAX_BATCH_BYTES) { await store.transaction(batch); batch = []; size = 0; }
        batch.push(...qs);
        size += bytes;
        done++;
      }
      if (batch.length) await store.transaction(batch);
    } catch (e) {
      // Put everything back so the next flush retries it; local unflushed writes stay authoritative for this instance.
      for (const [k, it] of items) if (!s.dirty.has(k)) s.dirty.set(k, it);
      console.error(JSON.stringify({ level: "error", event: "db.flush_failed", pending: items.length, attempted: done, error: (e as Error).message }));
      throw e;
    } finally {
      s.flushing = null;
    }
  })();
  return s.flushing;
}

/** Test helper: forget hydration so the next sync behaves like a cold start. */
export function resetSyncStateForTests(): void {
  const s = state();
  s.hydrated = false;
  s.lastSeq = 0;
  s.dirty.clear();
  s.syncing = null;
  s.flushing = null;
}
