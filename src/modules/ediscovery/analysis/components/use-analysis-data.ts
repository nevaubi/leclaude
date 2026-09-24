"use client";
import * as React from "react";
import { toast } from "sonner";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import type { Conflict, Deposition, Relationship, TimelineEvent } from "@/lib/types/domain";
import { ApiError, api, useFetch } from "../../components/use-review-data";
import { useReview } from "../../components/review-page";
import type { AnalysisOverview, ConflictNote, ConflictRow, CrossAnalysisResponse, Designation, DepositionSummary, FactMatrix, GraphData, KnowledgeMap, ObjectionSummary, PersonDetail, TranscriptHit } from "../types";

export { ApiError, api, useFetch };

const enc = encodeURIComponent;

export function useOverview(matterId: string) {
  return useFetch<AnalysisOverview & { topics: string[] }>(`an:overview:${matterId}`, () => api(`/api/ediscovery/analysis/overview?matter=${enc(matterId)}`));
}

export function useDepositions(matterId: string) {
  return useFetch<{ depositions: DepositionSummary[] }>(`an:deps:${matterId}`, () => api(`/api/ediscovery/analysis/depositions?matter=${enc(matterId)}`));
}

export interface DepositionDetail { deposition: Deposition; designations: Designation[]; objections: ObjectionSummary | null; exhibits: { id: string; description: string; bates?: string; docId?: string }[] }

export function useDeposition(id: string | null) {
  return useFetch<DepositionDetail>(id ? `an:dep:${id}` : null, () => api(`/api/ediscovery/analysis/depositions/${enc(id!)}`));
}

export function useTranscriptSearch(matterId: string, q: string, opts: { depositionId?: string; flags?: string[] } = {}) {
  const key = q.trim() ? `an:search:${matterId}:${q}:${opts.depositionId ?? ""}:${(opts.flags ?? []).join(",")}` : null;
  return useFetch<{ hits: TranscriptHit[]; total: number }>(key, () => api(`/api/ediscovery/analysis/depositions/search?matter=${enc(matterId)}&q=${enc(q)}${opts.depositionId ? `&deposition=${enc(opts.depositionId)}` : ""}${opts.flags?.length ? `&flags=${opts.flags.join(",")}` : ""}`));
}

export function useCross(matterId: string, topic: string, witnessId: string | undefined, depositionId?: string) {
  return useFetch<CrossAnalysisResponse>(`an:cross:${matterId}:${topic}:${witnessId ?? ""}:${depositionId ?? ""}`, () => api(`/api/ediscovery/analysis/cross?matter=${enc(matterId)}&topic=${enc(topic)}${witnessId ? `&witness=${enc(witnessId)}` : ""}${depositionId ? `&deposition=${enc(depositionId)}` : ""}`));
}

export function useFactMatrices(matterId: string) {
  return useFetch<{ matrices: FactMatrix[] }>(`an:fm:${matterId}`, () => api(`/api/ediscovery/analysis/fact-matrix?matter=${enc(matterId)}`));
}

export interface TimelineResponse { events: TimelineEvent[]; people: { id: string; name: string; organization?: string }[]; total: number }
export function useTimeline(matterId: string) {
  return useFetch<TimelineResponse>(`an:tl:${matterId}`, () => api(`/api/ediscovery/analysis/timeline?matter=${enc(matterId)}`));
}

export function useGraph(matterId: string) {
  return useFetch<GraphData>(`an:graph:${matterId}`, () => api(`/api/ediscovery/analysis/people?matter=${enc(matterId)}`));
}

export function usePerson(matterId: string, personId: string | null) {
  return useFetch<PersonDetail>(personId ? `an:person:${matterId}:${personId}` : null, () => api(`/api/ediscovery/analysis/people/${enc(personId!)}?matter=${enc(matterId)}`));
}

export function useKnowledgeMaps(matterId: string) {
  return useFetch<{ maps: KnowledgeMap[] }>(`an:km:${matterId}`, () => api(`/api/ediscovery/analysis/knowledge-map?matter=${enc(matterId)}`));
}

export interface ConflictFilters { status?: Conflict["status"] | ""; kind?: Conflict["kind"] | ""; severity?: Conflict["severity"] | ""; witnessId?: string; q?: string }
export function useConflicts(matterId: string, f: ConflictFilters) {
  const qs = [f.status && `status=${f.status}`, f.kind && `kind=${f.kind}`, f.severity && `severity=${f.severity}`, f.witnessId && `witness=${enc(f.witnessId)}`, f.q && `q=${enc(f.q)}`].filter(Boolean).join("&");
  return useFetch<{ conflicts: ConflictRow[] }>(`an:cf:${matterId}:${qs}`, () => api(`/api/ediscovery/analysis/conflicts?matter=${enc(matterId)}${qs ? `&${qs}` : ""}`));
}

export function useConflict(id: string | null) {
  return useFetch<{ conflict: ConflictRow; notes: ConflictNote[] }>(id ? `an:cf:${id}` : null, () => api(`/api/ediscovery/analysis/conflicts/${enc(id!)}`));
}

export type { Relationship };

/** Trigger a browser download of an API endpoint that responds with Content-Disposition. */
export function downloadFile(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** markdownToDoc → POST /api/office/docs; opens the Word editor from the toast. */
export async function exportMarkdownToWord(opts: { title: string; markdown: string; matterId: string; tags: string[]; meta?: Record<string, unknown>; description?: string }) {
  try {
    const content = markdownToDoc(opts.markdown);
    const r = await api<{ doc: { id: string; title: string } }>("/api/office/docs", { method: "POST", json: { kind: "word", title: opts.title, content, matterId: opts.matterId, tags: opts.tags, meta: { source: "ediscovery.analysis", ...(opts.meta ?? {}) } } });
    toast.success(`${opts.title} saved to Word`, { description: opts.description ?? "Filed in the matter folder", action: { label: "Open", onClick: () => window.open(`/office/word/${r.doc.id}`, "_blank") } });
    return r.doc;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) toast.error("Office documents API unavailable");
    else toast.error("Export failed", { description: (e as Error).message });
    return null;
  }
}

export function isNoKey(e: unknown) {
  return e instanceof ApiError && (e.code === "no_api_key" || e.status === 503);
}

/** The review-page context when the tab is mounted inside it; null when rendered standalone. */
export function useOptionalReview() {
  try { return useReview(); } catch { return null; }
}

/** Navigate to a transcript position: writes ?depo=&qa= and switches to the Depositions tab. */
export function useOpenTestimony() {
  const review = useOptionalReview();
  return React.useCallback((depositionId: string, index?: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("depo", depositionId);
    if (index != null) url.searchParams.set("qa", String(index)); else url.searchParams.delete("qa");
    window.history.replaceState(window.history.state, "", url.toString());
    if (review) review.setTab("depositions");
    else toast.info("Open the Depositions tab to read the transcript");
  }, [review]);
}

/** Small helper for optimistic list patches. */
export function useLatest<T>(v: T) {
  const ref = React.useRef(v);
  ref.current = v;
  return ref;
}
