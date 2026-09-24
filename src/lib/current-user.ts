/**
 * The signed-in user. LeClaude runs as a single demo persona (Jordan Whitfield,
 * Partner) until real authentication lands; every module reads the identity
 * from here instead of carrying its own constant.
 *
 * Client-safe: no server imports. `LECLAUDE_USER_ID` (server env) overrides the
 * id so a deployment can run as another seeded person; the name is resolved
 * lazily by callers that have the people collection (see `resolveCurrentUser`).
 */
export interface CurrentUser {
  id: string;
  name: string;
}

export const DEFAULT_USER: CurrentUser = { id: "p_jwhitfield", name: "Jordan Whitfield" };

/** Static identity for modules that need a constant (seeds, defaults). Prefer `currentUser()` at call time. */
export const CURRENT_USER: CurrentUser = DEFAULT_USER;

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
  const id = resolveUserId(env);
  if (id === DEFAULT_USER.id) return { id, name: lookupName?.(id) ?? DEFAULT_USER.name };
  return { id, name: lookupName?.(id) ?? id };
}
