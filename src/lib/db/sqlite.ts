import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * SQLite via Node's built-in `node:sqlite` (Node ≥ 22.13). Loaded through
 * process.getBuiltinModule so bundlers never try to resolve it.
 */
function loadDatabaseSync(): typeof DatabaseSync {
  const mod = (process as unknown as { getBuiltinModule: (n: string) => unknown }).getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  if (!mod?.DatabaseSync) throw new Error("node:sqlite is unavailable. LeClaude requires Node.js 22.13 or newer.");
  return mod.DatabaseSync;
}

export function dataDir() {
  const dir = process.env.LECLAUDE_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS docs_collection_updated ON docs(collection, updated_at DESC);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vectors (
  collection TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,
  meta TEXT,
  model TEXT,
  PRIMARY KEY (collection, doc_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS vectors_collection ON vectors(collection);
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  name TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
`;

type GlobalWithDb = typeof globalThis & { __leclaudeDb?: DatabaseSync; __leclaudeDbPath?: string };

export function getSqlite(): DatabaseSync {
  const g = globalThis as GlobalWithDb;
  const file = path.join(dataDir(), "leclaude.db");
  if (g.__leclaudeDb && g.__leclaudeDbPath === file) return g.__leclaudeDb;
  const Database = loadDatabaseSync();
  const db = new Database(file);
  db.exec(SCHEMA);
  g.__leclaudeDb = db;
  g.__leclaudeDbPath = file;
  return db;
}

/** Drop everything (used by scripts/reset-db.ts and tests). */
export function resetSqlite() {
  const g = globalThis as GlobalWithDb;
  if (g.__leclaudeDb) {
    try { g.__leclaudeDb.close(); } catch {}
    g.__leclaudeDb = undefined;
  }
  const file = path.join(dataDir(), "leclaude.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(file + suffix, { force: true }); } catch {}
  }
  cacheRegistry.clear();
}

/** Per-collection in-memory caches, shared with collections.ts. */
export const cacheRegistry = new Map<string, Map<string, unknown>>();
