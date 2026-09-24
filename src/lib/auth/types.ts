/**
 * Authorization contracts (constitution §21 identity, §22 authorization invariant).
 * Every sensitive read or action satisfies principal ∩ tenant ∩ role ∩ matter access ∩ resource ∩ action,
 * enforced at the route, tool and data boundaries. UI selection and prompts are never authorization.
 * Client-safe: types and constants only.
 */
export type Role = "partner" | "associate" | "paralegal" | "litigation_support" | "reviewer" | "admin" | "client_guest" | "service";

export type PrincipalSource = "dev" | "header" | "jwt" | "service";

export interface Principal {
  id: string;
  name: string;
  tenantId: string;
  roles: Role[];
  /** Matter ids this principal may access, or "*" for tenant-wide access (admins and partners). */
  matterIds: string[] | "*";
  email?: string;
  source: PrincipalSource;
  sessionId?: string;
  /** ISO time after which the principal must be re-resolved. */
  expiresAt?: string;
}

export interface MatterScope {
  tenantId: string;
  /** Concrete matter ids the current operation may touch; never empty for a scoped operation. */
  matterIds: string[];
}

export type Action = "read" | "write" | "code" | "produce" | "export" | "download" | "delete" | "approve" | "run" | "admin";

export type ResourceKind =
  | "matter"
  | "document"
  | "deposition"
  | "timeline"
  | "conflict"
  | "knowledge_graph"
  | "office_doc"
  | "library_item"
  | "workflow"
  | "workflow_run"
  | "research"
  | "review"
  | "memory"
  | "audit"
  | "intel"
  | "settings"
  | "blob"
  | "task"
  | "event";

export type Sensitivity = "normal" | "privileged" | "restricted";

export interface ResourceRef {
  kind: ResourceKind;
  id?: string;
  matterId?: string;
  tenantId?: string;
  sensitivity?: Sensitivity;
}

export interface PolicyInput {
  principal: Principal;
  action: Action;
  resource: ResourceRef;
  /** The tool or route requesting access, for audit. */
  via?: string;
  environment?: { origin?: string; ip?: string; at?: string };
}

export interface PolicyDecision {
  allow: boolean;
  reason: string;
  /** Extra conditions the caller must honor (e.g. "redact-privileged", "log-export"). */
  obligations?: string[];
}

export const AUTH_HEADER_USER = "x-leclaude-user";
export const AUTH_MODES = ["dev", "jwt"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];
