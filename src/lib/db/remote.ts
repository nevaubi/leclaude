import "server-only";

/**
 * Remote (durable, shared) store for serverless deployments.
 *
 * On hosts where every request can land on a different instance with its own throwaway disk
 * (Vercel), the local SQLite file is only a per-instance mirror. The authoritative copy lives in
 * Postgres; `sync.ts` hydrates the mirror, pulls other instances' changes, and pushes local writes.
 *
 * The transport is Neon's HTTP SQL endpoint (the protocol of @neondatabase/serverless, spoken with
 * fetch so no driver dependency is needed): POST https://api.<host-without-first-label>/sql with the
 * connection string in a header; a `queries` array runs as one transaction.
 */

export type SqlValue = string | number | boolean | null | Uint8Array;
export interface SqlQuery { query: string; params?: SqlValue[] }
export type Row = Record<string, string | null>;

export interface RemoteStore {
  /** Run one statement; rows come back with text values. */
  query(q: SqlQuery): Promise<Row[]>;
  /** Run several statements in one transaction; returns rows per statement. */
  transaction(qs: SqlQuery[]): Promise<Row[][]>;
}

export class RemoteStoreError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RemoteStoreError";
  }
}

/** The configured connection string, if any (Vercel's Neon integration sets DATABASE_URL / POSTGRES_URL). */
export function remoteUrl(): string | null {
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  return url && /^postgres(ql)?:\/\//.test(url) ? url : null;
}

function hex(bytes: Uint8Array): string {
  let s = "\\x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Decode a Postgres bytea text value ("\x0a0b…") into bytes. */
export function fromBytea(v: string | null): Uint8Array | null {
  if (v == null) return null;
  const h = v.startsWith("\\x") ? v.slice(2) : v;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function encodeParam(v: SqlValue): string | number | boolean | null {
  if (v instanceof Uint8Array) return hex(v);
  return v;
}

/** Neon HTTP endpoint for a connection string: the first host label becomes "api". */
export function neonEndpoint(connectionString: string): string {
  const host = new URL(connectionString.replace(/^postgres(ql)?:/, "http:")).hostname;
  return `https://${host.replace(/^[^.]+\./, "api.")}/sql`;
}

export class NeonHttpStore implements RemoteStore {
  private endpoint: string;
  constructor(private readonly connectionString: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.endpoint = neonEndpoint(connectionString);
  }

  private async post(body: unknown, batch: boolean): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "Neon-Connection-String": this.connectionString,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "false",
    };
    if (batch) headers["Neon-Batch-Isolation-Level"] = "ReadCommitted";
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.fetchImpl(this.endpoint, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
        const text = await res.text();
        if (!res.ok) {
          let msg = text;
          try { msg = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* keep text */ }
          // 4xx are query errors: never retry. 5xx/429 are transient.
          if (res.status < 500 && res.status !== 429) throw new RemoteStoreError(`Database error: ${msg}`, res.status);
          lastErr = new RemoteStoreError(`Database unavailable (${res.status}): ${msg}`, res.status);
        } else {
          return JSON.parse(text);
        }
      } catch (e) {
        if (e instanceof RemoteStoreError && e.status && e.status < 500 && e.status !== 429) throw e;
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
    throw lastErr instanceof Error ? lastErr : new RemoteStoreError(String(lastErr));
  }

  async query(q: SqlQuery): Promise<Row[]> {
    const res = (await this.post({ query: q.query, params: (q.params ?? []).map(encodeParam) }, false)) as { rows?: Row[] };
    return res.rows ?? [];
  }

  async transaction(qs: SqlQuery[]): Promise<Row[][]> {
    if (!qs.length) return [];
    const res = (await this.post({ queries: qs.map((q) => ({ query: q.query, params: (q.params ?? []).map(encodeParam) })) }, true)) as { results?: { rows?: Row[] }[] };
    if (!Array.isArray(res.results)) throw new RemoteStoreError("Unexpected database response");
    return res.results.map((r) => r.rows ?? []);
  }
}

let override: RemoteStore | null | undefined;

/** Tests inject a fake; `null` forces local-only mode. */
export function setRemoteStoreForTests(store: RemoteStore | null | undefined) {
  override = store;
}

let cached: { url: string; store: RemoteStore } | null = null;

export function remoteStore(): RemoteStore | null {
  if (override !== undefined) return override;
  const url = remoteUrl();
  if (!url) return null;
  if (cached?.url !== url) cached = { url, store: new NeonHttpStore(url) };
  return cached.store;
}

export const REMOTE_SCHEMA: SqlQuery[] = [
  { query: `CREATE TABLE IF NOT EXISTS lc_docs (collection text NOT NULL, id text NOT NULL, json text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL, PRIMARY KEY (collection, id))` },
  { query: `CREATE TABLE IF NOT EXISTS lc_kv (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL)` },
  { query: `CREATE TABLE IF NOT EXISTS lc_blobs (id text PRIMARY KEY, name text, mime text NOT NULL, size integer NOT NULL, bytes bytea NOT NULL, meta text, created_at text NOT NULL)` },
  { query: `CREATE TABLE IF NOT EXISTS lc_vectors (collection text NOT NULL, doc_id text NOT NULL, chunk_index integer NOT NULL, row_json text NOT NULL, embedding bytea, PRIMARY KEY (collection, doc_id, chunk_index))` },
  { query: `CREATE TABLE IF NOT EXISTS lc_changes (seq bigserial PRIMARY KEY, tbl text NOT NULL, k1 text NOT NULL, k2 text NOT NULL DEFAULT '', at timestamptz NOT NULL DEFAULT now())` },
];
