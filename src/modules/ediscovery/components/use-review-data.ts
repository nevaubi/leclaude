"use client";
import * as React from "react";
import type { EDocument, IssueCode, PrivilegeLogEntry } from "@/lib/types/domain";
import type { AIAnalysis, DocRow, MatterStats, SavedViewCounts, SearchRequest, SearchResponse, SimilarDoc, PrivilegeLogRow, ProductionSummary } from "../types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = "ApiError"; }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, { ...rest, headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;
    throw new ApiError(d?.error ?? `${res.status} ${res.statusText}`, res.status, d?.code);
  }
  return data as T;
}

/** Minimal SWR-style hook: fetch on key change, expose mutate/refresh. */
export function useFetch<T>(key: string | null, fetcher: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [loading, setLoading] = React.useState<boolean>(!!key);
  const [tick, setTick] = React.useState(0);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  React.useEffect(() => {
    if (!key) { setData(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    fetcherRef.current()
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e : new ApiError(String(e?.message ?? e), 0)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, ...deps]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  const mutate = React.useCallback((fn: (cur: T | null) => T | null) => setData(fn), []);
  return { data, error, loading, refresh, mutate };
}

export type StatsResponse = MatterStats & { views: SavedViewCounts[]; aiConfigured: boolean };

export function useStats(matterId: string) {
  return useFetch<StatsResponse>(`stats:${matterId}`, () => api<StatsResponse>(`/api/ediscovery/stats?matter=${encodeURIComponent(matterId)}`));
}

export function useIssueCodes(matterId: string) {
  return useFetch<{ codes: IssueCode[] }>(`codes:${matterId}`, () => api(`/api/ediscovery/issue-codes?matter=${encodeURIComponent(matterId)}`));
}

/** Debounced search against POST /api/ediscovery/search; aborts stale requests. */
export function useSearch(req: SearchRequest, opts: { debounceMs?: number } = {}) {
  const [data, setData] = React.useState<SearchResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [tick, setTick] = React.useState(0);
  const key = JSON.stringify(req);
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setLoading(true);
    const t = setTimeout(() => {
      api<SearchResponse>("/api/ediscovery/search", { method: "POST", json: JSON.parse(key), signal: ctrl.signal })
        .then((d) => { if (!ctrl.signal.aborted) { setData(d); setError(null); } })
        .catch((e) => { if (!ctrl.signal.aborted && e?.name !== "AbortError") setError(e instanceof ApiError ? e : new ApiError(String(e?.message ?? e), 0)); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, opts.debounceMs ?? 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [key, tick, opts.debounceMs]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  const patchRow = React.useCallback((id: string, patch: Partial<DocRow>) => setData((d) => (d ? { ...d, hits: d.hits.map((h) => (h.id === id ? { ...h, ...patch } : h)) } : d)), []);
  const patchRows = React.useCallback((ids: string[], fn: (row: DocRow) => DocRow) => { const set = new Set(ids); setData((d) => (d ? { ...d, hits: d.hits.map((h) => (set.has(h.id) ? fn(h) : h)) } : d)); }, []);
  return { data, loading, error, refresh, patchRow, patchRows };
}

export interface DocDetailResponse {
  doc: EDocument;
  row: DocRow;
  family: { parent: DocRow | null; attachments: DocRow[]; thread: DocRow[]; duplicateOf: DocRow | null; duplicates: DocRow[]; nearDuplicates: DocRow[] };
  reviewerName?: string;
  analysis: AIAnalysis | null;
}

export function useDoc(id: string | null) {
  return useFetch<DocDetailResponse>(id ? `doc:${id}` : null, () => api<DocDetailResponse>(`/api/ediscovery/docs/${encodeURIComponent(id!)}`));
}

export function useSimilar(id: string | null, enabled: boolean) {
  return useFetch<{ similar: SimilarDoc[] }>(id && enabled ? `similar:${id}` : null, () => api(`/api/ediscovery/docs/${encodeURIComponent(id!)}/similar?k=12`));
}

export function usePrivilegeLog(matterId: string) {
  return useFetch<{ entries: PrivilegeLogRow[]; missing: { id: string; bates: string; subject: string }[] }>(`privlog:${matterId}`, () => api(`/api/ediscovery/privilege-log?matter=${encodeURIComponent(matterId)}`));
}

export function useProduction(matterId: string) {
  return useFetch<ProductionSummary>(`production:${matterId}`, () => api(`/api/ediscovery/production?matter=${encodeURIComponent(matterId)}`));
}

export function useRules(matterId: string) {
  return useFetch<{ rules: string }>(`rules:${matterId}`, () => api(`/api/ediscovery/rules?matter=${encodeURIComponent(matterId)}`));
}

export type { PrivilegeLogEntry };
