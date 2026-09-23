import "server-only";
import { getSqlite } from "./sqlite";

export const kv = {
  get<T = unknown>(key: string): T | null {
    const row = getSqlite().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  },
  set(key: string, value: unknown) {
    getSqlite().prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, JSON.stringify(value), new Date().toISOString());
  },
  delete(key: string) {
    getSqlite().prepare("DELETE FROM kv WHERE key = ?").run(key);
  },
};
