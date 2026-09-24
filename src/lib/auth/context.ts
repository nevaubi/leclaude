import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { AuthError } from "./errors";
import { authMode, devPrincipal } from "./principal";
import type { PolicyDecision, Principal } from "./types";

/**
 * Request-scoped principal propagation. Route wrappers establish the context; services and tools deep in the
 * call stack read it with `currentPrincipal()` / `requirePrincipal()` to enforce matter scope without threading
 * parameters through every signature.
 *
 * Outside a request (background jobs, scripts, tests) there is no store. In AUTH_MODE=dev the demo persona is
 * ambient, so `currentPrincipal()` falls back to it; in header/jwt modes it returns null and `requirePrincipal()`
 * fails closed.
 */
export interface AuthContext {
  principal: Principal;
  /** The route-level decision, when established by `withAuth`. */
  decision?: PolicyDecision;
  via?: string;
}

const storage = new AsyncLocalStorage<AuthContext>();

export function runWithPrincipal<T>(principal: Principal, fn: () => T, extra: Omit<AuthContext, "principal"> = {}): T {
  return storage.run({ principal, ...extra }, fn);
}

export function currentAuthContext(): AuthContext | null {
  return storage.getStore() ?? null;
}

export function currentPrincipal(): Principal | null {
  const ctx = storage.getStore();
  if (ctx) return ctx.principal;
  return authMode() === "dev" ? devPrincipal() : null;
}

export function requirePrincipal(): Principal {
  const p = currentPrincipal();
  if (!p) throw AuthError.unauthenticated("No principal in the current execution context");
  return p;
}

/** Obligations the route-level decision imposed (e.g. "redact-privileged"), empty outside a wrapped route. */
export function currentObligations(): string[] {
  return storage.getStore()?.decision?.obligations ?? [];
}
