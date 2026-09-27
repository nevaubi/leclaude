"use client";
import type { TeamMember } from "@/modules/workspace/roles";

/** Error from a JSON API call, carrying the status and any per-field messages. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly fields?: Record<string, string>) {
    super(message);
  }
}

export async function apiJSON<T>(url: string, init: { method?: string; json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers: init.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    signal: init.signal,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; fields?: Record<string, string> };
  if (!res.ok) {
    const msg = res.status === 403 ? "You do not have permission to do that." : res.status === 401 ? "Sign in to continue." : body.error ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body.fields);
  }
  return body;
}

/** Firm team (active members) for pickers; loaded once per mount. */
export async function loadTeam(signal?: AbortSignal): Promise<TeamMember[]> {
  const r = await apiJSON<{ people: TeamMember[] }>("/api/people", { signal });
  return r.people;
}
