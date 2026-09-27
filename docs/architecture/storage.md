# Storage seam (development vs production)

Constitution §40: development may use local lightweight storage; production authoritative
state must be durable and shared. This document fixes the interface both must satisfy so the
adapter can change without touching modules.

## Interface today

`src/lib/db/index.ts` exposes `db()` with typed collections plus `db().collection<T>(name)` for
module-private data, `kv` for small settings, `blobs` for full text and binary content, and the
vector table behind `src/lib/ai/vector-store.ts`. Every collection implements:

```
get(id) · has(id) · count(where?) · all() · list({ where, sort, offset, limit }) ·
find(where) · findOne(where) · put(doc) · putMany(docs) · update(id, patch | fn) ·
delete(id) · clear()
```

Reads are served from an in-memory cache loaded from SQLite (`node:sqlite`); writes are
synchronous and write-through. Predicates are plain functions, which is why the cache exists.

## Production adapter requirements

A production adapter (Aurora PostgreSQL or DynamoDB behind the same interface) must provide:

- **Durability and sharing**: every write is acknowledged by the shared store before the call
  returns; no process-local authoritative state. Caches are read-through with explicit
  invalidation, never the source of truth.
- **Tenant partitioning**: every row carries `tenantId`; matter-scoped rows carry `matterId`;
  the adapter refuses queries without a tenant partition (the retrieval-scope rules in
  `docs/architecture/retrieval-scope.md` apply to the vector table as well).
- **Predicate pushdown**: `list`/`find` accept an indexed filter object in addition to the
  function predicate (`{ matterId, kind, status }`) so hot paths do not scan; the function
  predicate remains for the long tail and is applied after the indexed filter.
- **Optimistic versioning**: `update` takes an optional expected version; a mismatch throws a
  `ConflictError` that callers surface as the stale/conflict UI state (§35), which is also how
  stale Office proposals are rejected (§31).
- **Immutable audit**: the audit hash chain (`src/lib/integrity/audit.ts`) and trust records
  are append-only; the adapter exposes append and read, never update or delete, for those
  collections.
- **Blobs on object storage**: full text, uploads and exports live in S3 with SSE-KMS; the
  `blobs` interface returns streams and ranges (`src/lib/http-range.ts`) and records
  `sha256`, `size`, `mime`, `versionId` (constitution §20).
- **Vectors**: the vector index moves to an ANN-capable store (pgvector or OpenSearch) with
  the same `hybridSearch(scope, query)` contract; scope filters are applied inside the index
  query, not after retrieval.
- **Migrations**: schema changes are versioned scripts under `scripts/migrations/` run by the
  deploy pipeline; the SQLite adapter runs them at startup for development parity.

## Migration path

1. Add the indexed-filter form of `list`/`find` and `ConflictError` to the SQLite adapter (no
   caller changes; callers opt in on hot paths).
2. Introduce `DatabaseAdapter` with `sqlite` and `postgres` implementations selected by
   `LECLAUDE_DB` (`sqlite` default); keep `db()` as the only entry point.
3. Move blobs to S3 behind `blobs` with a local-disk implementation for development.
4. Move vectors to pgvector/OpenSearch behind `vector-store.ts`.
5. Turn on tenant partition enforcement in strict mode, then by default.

Nothing in `src/modules/**` should import a storage driver directly; the seam is `db()`.

## Serverless mode (implemented)

On Vercel every request can run on a different instance with its own throwaway `/tmp`, so a
local SQLite file cannot be the source of truth. When `DATABASE_URL` (or `POSTGRES_URL`) is set:

- Postgres (Neon, via its HTTP SQL endpoint in `src/lib/db/remote.ts`) is authoritative, in tables
  `lc_docs`, `lc_kv`, `lc_blobs`, `lc_vectors` and the change log `lc_changes`.
- Each instance keeps a local SQLite mirror (`leclaude-mirror.db`); the data API stays synchronous.
- `src/lib/db/sync.ts`: cold start hydrates the mirror; each request pulls changes logged since the
  instance's last sync; writes mark keys dirty and are pushed in one transaction before the response.
- `src/lib/db/request.ts`: every API route is wrapped with `withDb`, every page/layout calls
  `pageDb()`. Streaming responses flush when the stream ends.
- Without a database on a serverless host, writes are refused with `db_not_configured` so data is
  never silently lost.
- Limits: last writer wins per record; kv counters (Bates, audit sequence) can race between
  instances under concurrent writes; blobs are hydrated in full on cold start (move file bytes to
  object storage as volume grows).
