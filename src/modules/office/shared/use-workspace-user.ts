"use client";
import * as React from "react";

/**
 * Display name of the signed-in workspace user for client-side authorship (tracked changes, PDF
 * annotations). Fetched once per page load from GET /api/workspace; "You" while loading or when the
 * workspace has not been set up. Server-side records always take the author from the principal.
 */
const FALLBACK = "You";
let cached: string | null = null;
let inflight: Promise<string> | null = null;

function load(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch("/api/workspace")
    .then((r) => (r.ok ? r.json() : null))
    .then((w: { owner?: { name?: string } | null } | null) => { cached = w?.owner?.name?.trim() || FALLBACK; return cached; })
    .catch(() => FALLBACK)
    .finally(() => { inflight = null; });
  return inflight;
}

export function useWorkspaceUserName(): string {
  const [name, setName] = React.useState<string>(cached ?? FALLBACK);
  React.useEffect(() => {
    let live = true;
    void load().then((n) => { if (live) setName(n); });
    return () => { live = false; };
  }, []);
  return name;
}
