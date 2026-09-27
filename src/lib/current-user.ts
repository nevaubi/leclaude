/**
 * The signed-in user. Until an identity provider is configured (AUTH_MODE=jwt/header, see
 * src/lib/auth), the identity is the workspace owner recorded by first-run setup
 * (src/lib/workspace.ts applies it at database init). Every module reads the identity from
 * here instead of carrying its own constant.
 *
 * Client-safe: no server imports. `LECLAUDE_USER_ID` (server setting) overrides the id; the
 * name is resolved lazily by callers that have the people collection.
 */
export interface CurrentUser {
  id: string;
  name: string;
}

/** Placeholder identity before first-run setup; never a real person. */
export const DEFAULT_USER: CurrentUser = { id: "u_owner", name: "Workspace owner" };

let workspaceUser: CurrentUser | null = null;

/** Set by the workspace layer from the stored owner (first-run setup, or the demo seed). */
export function setWorkspaceUser(user: CurrentUser | null) {
  workspaceUser = user ? { id: user.id, name: user.name } : null;
}

/** Live view of the current identity for modules that read `.id` / `.name`; resolved at each access. Prefer `currentUser()`. */
export const CURRENT_USER: CurrentUser = {
  get id() { return currentUser().id; },
  get name() { return currentUser().name; },
};

/** Pure resolver, unit-tested: an env override wins when it is a non-empty person id. */
export function resolveUserId(env: { LECLAUDE_USER_ID?: string } | undefined, fallback = DEFAULT_USER.id): string {
  const raw = env?.LECLAUDE_USER_ID?.trim();
  return raw && /^[\w-]{2,64}$/.test(raw) ? raw : fallback;
}

/**
 * The current user, honouring `LECLAUDE_USER_ID`. When the override points at a
 * different person the display name falls back to a neutral label unless the
 * caller supplies a lookup (`currentUser((id) => db().people.get(id)?.name)`).
 */
export function currentUser(lookupName?: (id: string) => string | undefined): CurrentUser {
  const env = typeof process !== "undefined" ? (process.env as { LECLAUDE_USER_ID?: string }) : undefined;
  const base = workspaceUser ?? DEFAULT_USER;
  const id = resolveUserId(env, base.id);
  if (id === base.id) return { id, name: lookupName?.(id) ?? base.name };
  return { id, name: lookupName?.(id) ?? id };
}
