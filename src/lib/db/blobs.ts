import "server-only";
import { nanoid } from "nanoid";
import { getSqlite } from "./sqlite";

export interface BlobRecord { id: string; name?: string; mime: string; size: number; meta?: Record<string, unknown>; createdAt: string }

export const blobs = {
  put(bytes: Uint8Array, mime: string, opts: { id?: string; name?: string; meta?: Record<string, unknown> } = {}): BlobRecord {
    const id = opts.id ?? nanoid(16);
    const createdAt = new Date().toISOString();
    getSqlite()
      .prepare("INSERT INTO blobs (id, name, mime, size, bytes, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime, size = excluded.size, bytes = excluded.bytes, meta = excluded.meta")
      .run(id, opts.name ?? null, mime, bytes.byteLength, bytes, opts.meta ? JSON.stringify(opts.meta) : null, createdAt);
    return { id, name: opts.name, mime, size: bytes.byteLength, meta: opts.meta, createdAt };
  },
  get(id: string): (BlobRecord & { bytes: Uint8Array }) | null {
    const row = getSqlite().prepare("SELECT id, name, mime, size, bytes, meta, created_at FROM blobs WHERE id = ?").get(id) as
      | { id: string; name: string | null; mime: string; size: number; bytes: Uint8Array; meta: string | null; created_at: string }
      | undefined;
    if (!row) return null;
    return { id: row.id, name: row.name ?? undefined, mime: row.mime, size: row.size, bytes: row.bytes, meta: row.meta ? JSON.parse(row.meta) : undefined, createdAt: row.created_at };
  },
  meta(id: string): BlobRecord | null {
    const row = getSqlite().prepare("SELECT id, name, mime, size, meta, created_at FROM blobs WHERE id = ?").get(id) as { id: string; name: string | null; mime: string; size: number; meta: string | null; created_at: string } | undefined;
    if (!row) return null;
    return { id: row.id, name: row.name ?? undefined, mime: row.mime, size: row.size, meta: row.meta ? JSON.parse(row.meta) : undefined, createdAt: row.created_at };
  },
  delete(id: string) {
    getSqlite().prepare("DELETE FROM blobs WHERE id = ?").run(id);
  },
};
