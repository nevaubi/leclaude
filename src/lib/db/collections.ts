import "server-only";
import { getSqlite, cacheRegistry } from "./sqlite";

export interface HasId { id: string }

export interface ListOptions<T> {
  limit?: number;
  offset?: number;
  /** Sort by a field (asc) or a comparator. */
  sortBy?: keyof T | ((a: T, b: T) => number);
  direction?: "asc" | "desc";
  where?: (doc: T) => boolean;
}

/**
 * A typed JSON document collection backed by the `docs` table. All reads go
 * through an in-memory Map that is populated lazily and kept in sync with
 * writes, so list/find are sub-millisecond for tens of thousands of records.
 */
export class Collection<T extends HasId> {
  constructor(public readonly name: string) {}

  private cache(): Map<string, T> {
    let c = cacheRegistry.get(this.name) as Map<string, T> | undefined;
    if (!c) {
      c = new Map<string, T>();
      const rows = getSqlite().prepare("SELECT id, json FROM docs WHERE collection = ?").all(this.name) as { id: string; json: string }[];
      for (const r of rows) c.set(r.id, JSON.parse(r.json) as T);
      cacheRegistry.set(this.name, c);
    }
    return c;
  }

  get(id: string): T | null {
    return this.cache().get(id) ?? null;
  }

  has(id: string) {
    return this.cache().has(id);
  }

  count(where?: (doc: T) => boolean) {
    if (!where) return this.cache().size;
    let n = 0;
    for (const d of this.cache().values()) if (where(d)) n++;
    return n;
  }

  all(): T[] {
    return Array.from(this.cache().values());
  }

  list(opts: ListOptions<T> = {}): T[] {
    let items = this.all();
    if (opts.where) items = items.filter(opts.where);
    if (opts.sortBy) {
      const dir = opts.direction === "desc" ? -1 : 1;
      const key = opts.sortBy;
      items.sort(typeof key === "function" ? key : (a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
      if (typeof key === "function" && opts.direction === "desc") items.reverse();
    }
    const start = opts.offset ?? 0;
    const end = opts.limit != null ? start + opts.limit : undefined;
    return items.slice(start, end);
  }

  find(where: (doc: T) => boolean): T[] {
    return this.all().filter(where);
  }

  findOne(where: (doc: T) => boolean): T | null {
    for (const d of this.cache().values()) if (where(d)) return d;
    return null;
  }

  put(doc: T): T {
    const now = new Date().toISOString();
    const existing = getSqlite().prepare("SELECT created_at FROM docs WHERE collection = ? AND id = ?").get(this.name, doc.id) as { created_at: string } | undefined;
    getSqlite()
      .prepare("INSERT INTO docs (collection, id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
      .run(this.name, doc.id, JSON.stringify(doc), existing?.created_at ?? now, now);
    this.cache().set(doc.id, doc);
    return doc;
  }

  putMany(docs: T[]): void {
    if (!docs.length) return;
    const db = getSqlite();
    const now = new Date().toISOString();
    const stmt = db.prepare("INSERT INTO docs (collection, id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at");
    db.exec("BEGIN");
    try {
      for (const d of docs) stmt.run(this.name, d.id, JSON.stringify(d), now, now);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const c = this.cache();
    for (const d of docs) c.set(d.id, d);
  }

  update(id: string, patch: Partial<T> | ((doc: T) => T)): T | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = typeof patch === "function" ? patch(cur) : ({ ...cur, ...patch } as T);
    return this.put(next);
  }

  delete(id: string): boolean {
    const res = getSqlite().prepare("DELETE FROM docs WHERE collection = ? AND id = ?").run(this.name, id);
    this.cache().delete(id);
    return Number(res.changes) > 0;
  }

  clear() {
    getSqlite().prepare("DELETE FROM docs WHERE collection = ?").run(this.name);
    this.cache().clear();
  }
}

const registry = new Map<string, Collection<HasId>>();

export function collection<T extends HasId>(name: string): Collection<T> {
  let c = registry.get(name);
  if (!c) {
    c = new Collection<HasId>(name);
    registry.set(name, c);
  }
  return c as unknown as Collection<T>;
}
