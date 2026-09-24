/**
 * Deterministic authorization policy (constitution §21 policy, §22 authorization invariant).
 *
 *   allow ⇔ authenticated principal ∩ tenant ∩ role ∩ matter access ∩ resource sensitivity ∩ action
 *
 * Pure and client-safe: no I/O, no clock unless `environment.at` is absent, no model involvement. Every decision
 * carries a reason; obligations tell the caller what it must still honor (redaction, export logging).
 * The model never decides authorization and a UI matter selection is never authorization.
 */
import type { Action, PolicyDecision, PolicyInput, Principal, ResourceKind, ResourceRef, Role } from "./types";

export const ALL_ROLES: readonly Role[] = ["partner", "associate", "paralegal", "litigation_support", "reviewer", "admin", "client_guest", "service"];
export const ALL_ACTIONS: readonly Action[] = ["read", "write", "code", "produce", "export", "download", "delete", "approve", "run", "admin"];

/** Roles that may write or edit matter work product. */
export const WRITE_ROLES: readonly Role[] = ["partner", "associate", "paralegal", "litigation_support", "reviewer"];
/** Roles that may produce, export, download or delete. */
export const EXPORT_ROLES: readonly Role[] = ["partner", "associate", "admin"];
/** Roles that may approve (human review is a control boundary, constitution §54). */
export const APPROVE_ROLES: readonly Role[] = ["partner", "associate", "reviewer", "admin"];
/** Roles that administer settings and the intelligence layer. */
export const ADMIN_ROLES: readonly Role[] = ["partner", "admin"];
/** Roles that read privileged material in full. */
export const PRIVILEGED_READERS: readonly Role[] = ["partner", "associate", "admin", "reviewer"];
/** Roles that read restricted material. */
export const RESTRICTED_READERS: readonly Role[] = ["partner", "admin"];

export const OBLIGATION_LOG_EXPORT = "log-export";
export const OBLIGATION_REDACT_PRIVILEGED = "redact-privileged";

const EXPORT_LIKE: ReadonlySet<Action> = new Set<Action>(["produce", "export", "download"]);

function deny(reason: string): PolicyDecision {
  return { allow: false, reason };
}

function allow(reason: string, obligations: string[]): PolicyDecision {
  return obligations.length ? { allow: true, reason, obligations: Array.from(new Set(obligations)) } : { allow: true, reason };
}

/** The matter a resource belongs to: a matter resource is identified by its own id. */
export function resourceMatterId(resource: ResourceRef): string | undefined {
  if (resource.kind === "matter") return resource.id ?? resource.matterId;
  return resource.matterId;
}

/** True when the principal may touch the matter (tenant-wide access or explicit membership). */
export function hasMatterAccess(principal: Principal, matterId: string): boolean {
  if (principal.matterIds === "*") return !isGuestOnly(principal);
  return principal.matterIds.includes(matterId);
}

/** The first matter in `matterIds` the principal can access; the first listed one when none is accessible (so a policy check denies); undefined for an empty list. */
export function firstAccessibleMatter(principal: Principal, matterIds: readonly string[] | undefined): string | undefined {
  if (!matterIds?.length) return undefined;
  return matterIds.find((m) => hasMatterAccess(principal, m)) ?? matterIds[0];
}

function isGuestOnly(principal: Principal): boolean {
  return principal.roles.length > 0 && principal.roles.every((r) => r === "client_guest");
}

function anyRole(principal: Principal, roles: readonly Role[]): Role | undefined {
  return principal.roles.find((r) => roles.includes(r));
}

function label(resource: ResourceRef): string {
  return resource.id ? `${resource.kind} ${resource.id}` : resource.kind;
}

/**
 * Decide whether `principal` may perform `action` on `resource`.
 *
 * Order of gates (the first failing gate is the reason): principal validity and expiry → tenant → matter access
 * → sensitivity → action/role matrix. Roles are unioned: a principal with several roles gets the most permissive
 * outcome any of them grants, except that obligations attach only when no fully-qualified role applies.
 */
export function authorize(input: PolicyInput): PolicyDecision {
  const { principal, action, resource } = input;
  if (!principal || !principal.id || !principal.tenantId) return deny("no authenticated principal");
  if (!Array.isArray(principal.roles) || principal.roles.length === 0) return deny(`principal ${principal.id} has no roles`);
  if (!ALL_ACTIONS.includes(action)) return deny(`unknown action ${String(action)}`);
  if (!resource || !resource.kind) return deny("no resource");

  const now = input.environment?.at ?? new Date().toISOString();
  if (principal.expiresAt && principal.expiresAt <= now) return deny(`principal ${principal.id} expired at ${principal.expiresAt}`);

  if (resource.tenantId && resource.tenantId !== principal.tenantId) return deny(`tenant mismatch: resource belongs to ${resource.tenantId}, principal to ${principal.tenantId}`);

  const isService = principal.roles.includes("service");
  const guestOnly = isGuestOnly(principal);
  const matterId = resourceMatterId(resource);
  const obligations: string[] = [];

  // Matter access.
  if (matterId) {
    if (guestOnly && principal.matterIds === "*") return deny("client guests may only access explicitly shared matters");
    if (!hasMatterAccess(principal, matterId)) return deny(`principal ${principal.id} has no access to matter ${matterId}`);
  } else if (guestOnly) {
    return deny(`client guests may only access shared matters, not ${label(resource)}`);
  }

  // Sensitivity.
  if (resource.sensitivity === "restricted") {
    if (!isService && !anyRole(principal, RESTRICTED_READERS)) return deny(`restricted ${label(resource)} requires partner or admin`);
  } else if (resource.sensitivity === "privileged") {
    if (!isService && !anyRole(principal, PRIVILEGED_READERS)) {
      if (action === "read" && principal.roles.includes("paralegal")) obligations.push(OBLIGATION_REDACT_PRIVILEGED);
      else return deny(`privileged ${label(resource)} is not accessible to role(s) ${principal.roles.join(", ")} for ${action}`);
    }
  }

  // Action × role matrix.
  if (isService) {
    if (action === "approve") return deny("service principals may not approve; approval is a human control boundary");
    if (EXPORT_LIKE.has(action)) obligations.push(OBLIGATION_LOG_EXPORT);
    return allow(`service principal may ${action} ${label(resource)} within tenant ${principal.tenantId}`, obligations);
  }

  switch (action) {
    case "read": {
      if (guestOnly) return allow(`client guest may read shared ${label(resource)}`, obligations);
      return allow(`role ${principal.roles[0]} may read ${label(resource)}`, obligations);
    }
    case "write":
    case "code": {
      const roles: readonly Role[] = matterId ? WRITE_ROLES : [...WRITE_ROLES, "admin"];
      const r = anyRole(principal, roles);
      if (!r) return deny(`role(s) ${principal.roles.join(", ")} may not ${action} ${label(resource)}`);
      return allow(`role ${r} may ${action} ${label(resource)}`, obligations);
    }
    case "produce":
    case "export":
    case "download": {
      const r = anyRole(principal, EXPORT_ROLES);
      if (r) return allow(`role ${r} may ${action} ${label(resource)}`, [...obligations, OBLIGATION_LOG_EXPORT]);
      if (principal.roles.includes("litigation_support") && (action === "export" || action === "produce") && resource.kind === "document") {
        return allow(`role litigation_support may ${action} productions (${label(resource)})`, [...obligations, OBLIGATION_LOG_EXPORT]);
      }
      return deny(`role(s) ${principal.roles.join(", ")} may not ${action} ${label(resource)}`);
    }
    case "delete": {
      const r = anyRole(principal, EXPORT_ROLES);
      if (!r) return deny(`role(s) ${principal.roles.join(", ")} may not delete ${label(resource)}`);
      return allow(`role ${r} may delete ${label(resource)}`, obligations);
    }
    case "approve": {
      const r = anyRole(principal, APPROVE_ROLES);
      if (!r) return deny(`role(s) ${principal.roles.join(", ")} may not approve ${label(resource)}`);
      return allow(`role ${r} may approve ${label(resource)}`, obligations);
    }
    case "run": {
      if (guestOnly) return deny(`client guests may not run ${label(resource)}`);
      return allow(`role ${principal.roles.find((x) => x !== "client_guest")} may run ${label(resource)}`, obligations);
    }
    case "admin": {
      const r = anyRole(principal, ADMIN_ROLES);
      if (!r) return deny(`role(s) ${principal.roles.join(", ")} may not administer ${label(resource)}`);
      return allow(`role ${r} may administer ${label(resource)}`, obligations);
    }
    default:
      return deny(`unknown action ${String(action)}`);
  }
}

/** Convenience: true when the policy allows. */
export function can(principal: Principal, action: Action, resource: ResourceRef, via?: string): boolean {
  return authorize({ principal, action, resource, via }).allow;
}

export interface PolicyPartition<T> {
  allowed: { item: T; resource: ResourceRef; decision: PolicyDecision }[];
  denied: { item: T; resource: ResourceRef; decision: PolicyDecision }[];
}

/**
 * Apply the policy to a set of records (an export set, a search result page). Denied records are returned with
 * their reasons so callers can report "n records withheld" instead of silently widening or narrowing the set.
 */
export function partitionByPolicy<T>(principal: Principal, action: Action, items: readonly T[], toResource: (item: T) => ResourceRef, via?: string): PolicyPartition<T> {
  const out: PolicyPartition<T> = { allowed: [], denied: [] };
  for (const item of items) {
    const resource = toResource(item);
    const decision = authorize({ principal, action, resource, via });
    (decision.allow ? out.allowed : out.denied).push({ item, resource, decision });
  }
  return out;
}

/** Resource kinds whose records are always matter-scoped; a missing matterId on these is a bug, not "all matters". */
export const MATTER_SCOPED_KINDS: readonly ResourceKind[] = ["document", "deposition", "timeline", "conflict", "knowledge_graph"];
