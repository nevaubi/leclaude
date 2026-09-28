"use client";
import * as React from "react";
import type { AutoconfigState } from "../autoconfig-types";
import { hasActiveJobs, type CoverageResponse } from "./coverage-models";

export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string; data?: T };

const POLL_MS = 3000;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<{ status: number; body: T | null; error?: string }> {
  const res = await fetch(url, { cache: "no-store", signal });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  return { status: res.status, body: res.ok ? body : null, error: res.ok ? undefined : (body?.error ?? `${res.status} ${res.statusText}`) };
}

/**
 * Coverage data with polling while source runs are queued or running; polling stops when the layer is idle and
 * restarts on `kick()` (after an apply or a retry). `onSettled` fires once when active work finishes.
 */
export function useCoverage(onSettled?: () => void): { state: LoadState<CoverageResponse>; reload: () => void; kick: () => void; polling: boolean } {
  const [state, setState] = React.useState<LoadState<CoverageResponse>>({ kind: "loading" });
  const [tick, setTick] = React.useState(0);
  const [forcePoll, setForcePoll] = React.useState(0);
  const wasActive = React.useRef(false);
  const settledRef = React.useRef(onSettled);
  settledRef.current = onSettled;

  React.useEffect(() => {
    const ctrl = new AbortController();
    getJson<CoverageResponse>("/api/intel/coverage", ctrl.signal)
      .then((r) => {
        if (r.status === 403 || r.status === 401) setState({ kind: "denied" });
        else if (r.status === 404) setState({ kind: "unavailable" });
        else if (!r.body) setState((s) => ({ kind: "error", message: r.error ?? "Could not load coverage", data: s.kind === "ready" ? s.data : s.kind === "error" ? s.data : undefined }));
        else setState({ kind: "ready", data: r.body });
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setState((s) => ({ kind: "error", message: (e as Error).message, data: s.kind === "ready" ? s.data : undefined })); });
    return () => ctrl.abort();
  }, [tick]);

  const data = state.kind === "ready" ? state.data : state.kind === "error" ? state.data : undefined;
  const active = Boolean(data && hasActiveJobs(data.jobs));
  const polling = active || forcePoll > 0;

  React.useEffect(() => {
    if (active) wasActive.current = true;
    else if (wasActive.current && data) { wasActive.current = false; settledRef.current?.(); }
  }, [active, data]);

  React.useEffect(() => {
    if (!polling) return;
    const t = setTimeout(() => { setTick((n) => n + 1); setForcePoll((n) => Math.max(0, n - 1)); }, POLL_MS);
    return () => clearTimeout(t);
  }, [polling, tick]);

  return {
    state,
    polling,
    reload: () => setTick((n) => n + 1),
    // Keep polling for a few cycles even before the first job shows up as queued.
    kick: () => { setForcePoll(3); setTick((n) => n + 1); },
  };
}

/** The last autoconfigure state (GET /api/intel/autoconfigure); 404 means the feature is not deployed. */
export function useAutoconfigState(): { state: LoadState<AutoconfigState>; set: (s: AutoconfigState) => void; reload: () => void } {
  const [state, setState] = React.useState<LoadState<AutoconfigState>>({ kind: "loading" });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const ctrl = new AbortController();
    getJson<AutoconfigState>("/api/intel/autoconfigure", ctrl.signal)
      .then((r) => {
        if (r.status === 404 || r.status === 405) setState({ kind: "unavailable" });
        else if (r.status === 403 || r.status === 401) setState({ kind: "denied" });
        else if (!r.body) setState({ kind: "error", message: r.error ?? "Could not load the source plan" });
        else setState({ kind: "ready", data: r.body });
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setState({ kind: "error", message: (e as Error).message }); });
    return () => ctrl.abort();
  }, [tick]);
  return { state, set: (s) => setState({ kind: "ready", data: s }), reload: () => setTick((n) => n + 1) };
}

/** A clock that ticks every second only while `on` is true (elapsed times on running jobs). */
export function useNow(on: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
