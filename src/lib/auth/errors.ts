/**
 * Authorization failures (constitution §22). Client-safe: no server imports.
 *
 * 401 means "no usable principal" (missing or invalid credentials); 403 means "the principal exists but the
 * policy denied the action". Routes map both to one JSON shape so a denial never leaks whether a record exists.
 */
export type AuthErrorCode = "unauthenticated" | "forbidden";

export class AuthError extends Error {
  readonly status: 401 | 403;
  readonly code: AuthErrorCode;
  /** Policy reason (kept for the audit log; not exposed to clients outside dev mode). */
  readonly reason?: string;

  constructor(status: 401 | 403, message: string, reason?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = status === 401 ? "unauthenticated" : "forbidden";
    this.reason = reason;
  }

  static unauthenticated(message = "Authentication required", reason?: string) {
    return new AuthError(401, message, reason ?? message);
  }

  static forbidden(reason: string) {
    return new AuthError(403, "Forbidden", reason);
  }
}

export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "AuthError");
}
