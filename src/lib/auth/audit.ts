import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import type { Action, PolicyDecision, Principal, PrincipalSource, ResourceRef } from "./types";

/**
 * Append-only authorization audit (constitution §42 observability, §54 human review). Every denial and every
 * non-read allow is recorded; allowed plain reads are recorded when the resource is privileged/restricted or
 * when AUTH_AUDIT_READS=true (they are the bulk of traffic and the collection is cached in memory).
 *
 * This is the access-decision log; record mutations keep using the hash-chained integrity audit (`audit_log`).
 */
export const AUTH_AUDIT_COLLECTION = "audit_events";

export interface AuthAuditEvent {
  id: string;
  /** Monotonic sequence within this database. */
  seq: number;
  at: string;
  principalId: string;
  principalName?: string;
  source?: PrincipalSource;
  tenantId: string;
  action: Action;
  resource: ResourceRef;
  decision: "allow" | "deny";
  reason: string;
  via?: string;
  obligations?: string[];
  ip?: string;
}

function events() {
  return db().collection<AuthAuditEvent>(AUTH_AUDIT_COLLECTION);
}

export function shouldAuditRead(resource: ResourceRef): boolean {
  if (resource.sensitivity === "privileged" || resource.sensitivity === "restricted") return true;
  const flag = (process.env.AUTH_AUDIT_READS ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function recordAuthDecision(input: { principal: Principal; action: Action; resource: ResourceRef; decision: PolicyDecision; via?: string; ip?: string }): AuthAuditEvent {
  const d = db();
  const seq = (d.kv.get<number>("auth_audit:seq") ?? 0) + 1;
  const event: AuthAuditEvent = {
    id: `aa_${nanoid(12)}`,
    seq,
    at: new Date().toISOString(),
    principalId: input.principal.id,
    principalName: input.principal.name,
    source: input.principal.source,
    tenantId: input.principal.tenantId,
    action: input.action,
    resource: compactResource(input.resource),
    decision: input.decision.allow ? "allow" : "deny",
    reason: input.decision.reason.slice(0, 500),
    via: input.via,
    obligations: input.decision.obligations?.length ? input.decision.obligations : undefined,
    ip: input.ip,
  };
  events().put(event);
  d.kv.set("auth_audit:seq", seq);
  return event;
}

/** Record a decision when policy says it is worth keeping (see module doc). Returns the event or null. */
export function auditDecision(input: Parameters<typeof recordAuthDecision>[0]): AuthAuditEvent | null {
  if (input.decision.allow && input.action === "read" && !shouldAuditRead(input.resource)) return null;
  return recordAuthDecision(input);
}

export function recentAudit(opts: { limit?: number; principalId?: string; tenantId?: string; decision?: "allow" | "deny"; action?: Action; resourceKind?: string; matterId?: string; since?: string } = {}): AuthAuditEvent[] {
  return events().list({
    where: (e) =>
      (!opts.principalId || e.principalId === opts.principalId) &&
      (!opts.tenantId || e.tenantId === opts.tenantId) &&
      (!opts.decision || e.decision === opts.decision) &&
      (!opts.action || e.action === opts.action) &&
      (!opts.resourceKind || e.resource.kind === opts.resourceKind) &&
      (!opts.matterId || e.resource.matterId === opts.matterId || (e.resource.kind === "matter" && e.resource.id === opts.matterId)) &&
      (!opts.since || e.at >= opts.since),
    sortBy: "seq",
    direction: "desc",
    limit: opts.limit ?? 100,
  });
}

export function auditCount(): number {
  return events().count();
}

function compactResource(r: ResourceRef): ResourceRef {
  const out: ResourceRef = { kind: r.kind };
  if (r.id) out.id = r.id;
  if (r.matterId) out.matterId = r.matterId;
  if (r.tenantId) out.tenantId = r.tenantId;
  if (r.sensitivity) out.sensitivity = r.sensitivity;
  return out;
}
