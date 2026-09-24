import "server-only";
import { nanoid } from "nanoid";
import { collection } from "@/lib/db/collections";
import { kv } from "@/lib/db/kv";
import { sha256 } from "./hash";
import type { AuditAction, AuditEvent } from "./types";

const AUDIT = "audit_log";
const CURRENT_USER = { id: "p_jwhitfield", name: "Jordan Whitfield" };

/**
 * Append-only, hash-chained audit log. Every AI generation/application,
 * coding change, import/export, workflow run and integrity fix records an
 * event so any AI-derived fact can be traced back to who/what produced it.
 */
export function audit(action: AuditAction, target: AuditEvent["target"], meta?: Record<string, unknown>, actor: { id: string; name: string } = CURRENT_USER): AuditEvent {
  const prevHash = kv.get<string>("audit:head") ?? undefined;
  const seq = (kv.get<number>("audit:seq") ?? 0) + 1;
  const base: Omit<AuditEvent, "hash"> = { id: `au_${nanoid(12)}`, seq, ts: new Date().toISOString(), actorId: actor.id, actorName: actor.name, action, target, meta: compact(meta), prevHash };
  const hash = sha256((prevHash ?? "") + JSON.stringify(base));
  const event: AuditEvent = { ...base, hash };
  collection<AuditEvent>(AUDIT).put(event);
  kv.set("audit:head", hash);
  kv.set("audit:seq", seq);
  return event;
}

export function listAudit(opts: { limit?: number; action?: AuditAction; targetKind?: string; targetId?: string; matterId?: string; since?: string } = {}): AuditEvent[] {
  return collection<AuditEvent>(AUDIT).list({
    where: (e) => (!opts.action || e.action === opts.action) && (!opts.targetKind || e.target.kind === opts.targetKind) && (!opts.targetId || e.target.id === opts.targetId) && (!opts.matterId || e.target.matterId === opts.matterId) && (!opts.since || e.ts >= opts.since),
    sortBy: "seq",
    direction: "desc",
    limit: opts.limit ?? 200,
  });
}

/** Verify the hash chain end to end; returns the first broken link if any. */
export function verifyAuditChain(): { ok: boolean; checked: number; brokenAt?: string } {
  const events = collection<AuditEvent>(AUDIT).list({ sortBy: "seq", direction: "asc" });
  let prev: string | undefined;
  for (const e of events) {
    const { hash, ...rest } = e;
    const expected = sha256((rest.prevHash ?? "") + JSON.stringify(rest));
    if (hash !== expected || (rest.prevHash ?? undefined) !== prev) return { ok: false, checked: events.length, brokenAt: e.id };
    prev = hash;
  }
  return { ok: true, checked: events.length };
}

function compact(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const s = JSON.stringify(meta);
  return s.length > 4000 ? { truncated: true, preview: s.slice(0, 4000) } : meta;
}
