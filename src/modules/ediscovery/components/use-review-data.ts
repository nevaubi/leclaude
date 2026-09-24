"use client";
import * as React from "react";
import type { EDocument, IssueCode, PrivilegeLogEntry } from "@/lib/types/domain";
import type { AIAnalysis, DocRow, MatterStats, SavedViewCounts, SearchRequest, SearchResponse, SimilarDoc, PrivilegeLogRow, ProductionSummary, ReviewBatchSummary, SavedSearchRecord, ReviewLayout, Redaction, ProductionSummary2, DocHistoryEntry, DisagreementReport } from "../types";

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

/**
 * Debounced search against POST /api/ediscovery/search; aborts stale requests.
 * `loadMore()` appends the next page; `refresh()` refetches everything loaded so far
 * (same query, larger limit) so facet counts and rows stay in sync after coding.
 */
export function useSearch(req: SearchRequest, opts: { debounceMs?: number } = {}) {
  const [data, setData] = React.useState<SearchResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [tick, setTick] = React.useState(0);
  const key = JSON.stringify(req);
  const abortRef = React.useRef<AbortController | null>(null);
  const lastKeyRef = React.useRef<string | null>(null);
  const loadedRef = React.useRef(0);
  React.useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setLoading(true);
    const base = JSON.parse(key) as SearchRequest;
    // A refresh of the same query keeps every page loaded so far; a new query starts from the first page.
    const limit = lastKeyRef.current === key ? Math.max(base.limit ?? 100, loadedRef.current) : (base.limit ?? 100);
    lastKeyRef.current = key;
    const t = setTimeout(() => {
      api<SearchResponse>("/api/ediscovery/search", { method: "POST", json: { ...base, limit }, signal: ctrl.signal })
        .then((d) => { if (!ctrl.signal.aborted) { loadedRef.current = d.hits.length; setData(d); setError(null); } })
        .catch((e) => { if (!ctrl.signal.aborted && e?.name !== "AbortError") setError(e instanceof ApiError ? e : new ApiError(String(e?.message ?? e), 0)); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, opts.debounceMs ?? 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [key, tick, opts.debounceMs]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  const loadMore = React.useCallback(async () => {
    const cur = data;
    if (!cur || loadingMore || cur.hits.length >= cur.total) return;
    setLoadingMore(true);
    try {
      const base = JSON.parse(key) as SearchRequest;
      const page = await api<SearchResponse>("/api/ediscovery/search", { method: "POST", json: { ...base, offset: cur.hits.length, limit: base.limit ?? 100 } });
      if (lastKeyRef.current !== key) return; // query changed meanwhile
      setData((d) => {
        if (!d) return d;
        const seen = new Set(d.hits.map((h) => h.id));
        const hits = [...d.hits, ...page.hits.filter((h) => !seen.has(h.id))];
        loadedRef.current = hits.length;
        return { ...d, hits, total: page.total, facets: page.facets, tookMs: page.tookMs };
      });
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError(String((e as Error)?.message ?? e), 0)); }
    finally { setLoadingMore(false); }
  }, [data, key, loadingMore]);
  const patchRow = React.useCallback((id: string, patch: Partial<DocRow>) => setData((d) => (d ? { ...d, hits: d.hits.map((h) => (h.id === id ? { ...h, ...patch } : h)) } : d)), []);
  const patchRows = React.useCallback((ids: string[], fn: (row: DocRow) => DocRow) => { const set = new Set(ids); setData((d) => (d ? { ...d, hits: d.hits.map((h) => (set.has(h.id) ? fn(h) : h)) } : d)); }, []);
  return { data, loading, loadingMore, error, refresh, loadMore, patchRow, patchRows };
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

/**
 * Pending AI-record count for the matter (Codes & privilege → Needs review). Resolves to
 * null when the integrity endpoint is missing so callers can hide the count.
 */
export function useReviewQueueCount(matterId: string) {
  const [pending, setPending] = React.useState<number | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    api<{ counts?: { pending?: number } }>(`/api/integrity/review?matter=${encodeURIComponent(matterId)}&limit=1`)
      .then((r) => { if (alive) setPending(Number(r?.counts?.pending ?? 0)); })
      .catch(() => { if (alive) setPending(null); });
    return () => { alive = false; };
  }, [matterId, tick]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  const set = React.useCallback((n: number) => setPending(n), []);
  return { pending, refresh, set };
}

export function useRules(matterId: string) {
  return useFetch<{ rules: string }>(`rules:${matterId}`, () => api(`/api/ediscovery/rules?matter=${encodeURIComponent(matterId)}`));
}

export function useBatches(matterId: string) {
  return useFetch<{ batches: ReviewBatchSummary[] }>(`batches:${matterId}`, () => api(`/api/ediscovery/batches?matter=${encodeURIComponent(matterId)}`));
}

export function useBatch(id: string | null) {
  return useFetch<{ batch: ReviewBatchSummary & { disagreements: DisagreementReport } }>(id ? `batch:${id}` : null, () => api(`/api/ediscovery/batches/${encodeURIComponent(id!)}`));
}

export function useSavedSearches(matterId: string) {
  return useFetch<{ searches: SavedSearchRecord[] }>(`saved:${matterId}`, () => api(`/api/ediscovery/saved-searches?matter=${encodeURIComponent(matterId)}`));
}

export function useLayouts(matterId: string) {
  return useFetch<{ layouts: ReviewLayout[] }>(`layouts:${matterId}`, () => api(`/api/ediscovery/layouts?matter=${encodeURIComponent(matterId)}`));
}

export function useRedactions(docId: string | null) {
  return useFetch<{ redactions: Redaction[] }>(docId ? `redactions:${docId}` : null, () => api(`/api/ediscovery/redactions?doc=${encodeURIComponent(docId!)}`));
}

export function useMatterRedactions(matterId: string) {
  return useFetch<{ redactions: Redaction[] }>(`redactions:m:${matterId}`, () => api(`/api/ediscovery/redactions?matter=${encodeURIComponent(matterId)}`));
}

export function useProductions(matterId: string) {
  return useFetch<{ productions: ProductionSummary2[] }>(`productions:${matterId}`, () => api(`/api/ediscovery/productions?matter=${encodeURIComponent(matterId)}`));
}

export function useDocHistory(docId: string | null, enabled: boolean) {
  return useFetch<{ history: DocHistoryEntry[]; batches: { id: string; name: string; qc: boolean }[]; redactions: Redaction[] }>(docId && enabled ? `history:${docId}` : null, () => api(`/api/ediscovery/docs/${encodeURIComponent(docId!)}/history`));
}

/** Browser download of a fetched file (blob URL). */
export async function downloadFile(url: string, fallbackName: string) {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({ error: res.statusText })) as { error?: string }).error ?? res.statusText, res.status);
  const blob = await res.blob();
  const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
}

export type { PrivilegeLogEntry };
