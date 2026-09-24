import "server-only";
import { db } from "@/lib/db";
import { AuthError } from "./errors";
import { authorize, hasMatterAccess } from "./policy";
import type { Action, MatterScope, PolicyDecision, Principal } from "./types";

/**
 * Matter scope for query filtering (constitution §22): every data read narrows to the matters the principal may
 * touch. A missing matter filter must never become "search all matters", so callers pass an explicit
 * MatterScope and services filter on `scope.matterIds`.
 */

/** Concrete matter ids the principal may access; tenant-wide access enumerates the tenant's matters. */
export function accessibleMatterIds(principal: Principal): string[] {
  if (principal.matterIds === "*") return principal.roles.every((r) => r === "client_guest") ? [] : db().matters.all().map((m) => m.id);
  return Array.from(new Set(principal.matterIds));
}

/** The widest scope this principal has. */
export function matterScope(principal: Principal): MatterScope {
  return { tenantId: principal.tenantId, matterIds: accessibleMatterIds(principal) };
}

/** Assert the principal may `action` the matter; throws AuthError 403 otherwise. Returns the decision for its obligations. */
export function requireMatterAccess(principal: Principal, matterId: string, action: Action = "read", via?: string): PolicyDecision {
  const decision = authorize({ principal, action, resource: { kind: "matter", id: matterId }, via });
  if (!decision.allow) throw AuthError.forbidden(decision.reason);
  return decision;
}

/** A scope narrowed to one requested matter after checking access, or the principal's full scope when no matter was requested. */
export function scopeFor(principal: Principal, matterId?: string | null, action: Action = "read", via?: string): MatterScope {
  if (!matterId) return matterScope(principal);
  requireMatterAccess(principal, matterId, action, via);
  return { tenantId: principal.tenantId, matterIds: [matterId] };
}

/** Narrow a caller-supplied list of matters to the accessible ones; unknown or foreign matters drop out (never widen). */
export function narrowScope(principal: Principal, matterIds: readonly string[]): MatterScope {
  const ids = matterIds.filter((m) => hasMatterAccess(principal, m));
  return { tenantId: principal.tenantId, matterIds: Array.from(new Set(ids)) };
}

export function inScope(scope: MatterScope, matterId: string | undefined | null): boolean {
  return !!matterId && scope.matterIds.includes(matterId);
}
