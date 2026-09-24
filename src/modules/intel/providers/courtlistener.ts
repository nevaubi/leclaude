import "server-only";
import { htmlToText, stripXml } from "@/lib/ai/toolkit/http";
import { COURT_GROUPS } from "@/lib/ai/toolkit/legal";
import { clip, envValue, ProviderClient, ProviderError, type ProviderFactoryOptions } from "./base";

/**
 * CourtListener REST v4 (same endpoints as the research toolkit in
 * src/lib/ai/toolkit/legal.ts) with caching, rate limiting and structured
 * errors. Anonymous access works; COURTLISTENER_API_TOKEN raises the quota.
 */
const BASE = "https://www.courtlistener.com/api/rest/v4";
const SITE = "https://www.courtlistener.com";

export interface CLOpinionHit {
  clusterId?: number;
  opinionId?: number;
  caseName: string;
  citations: string[];
  court?: string;
  courtId?: string;
  dateFiled?: string;
  docketNumber?: string;
  judge?: string;
  status?: string;
  citeCount?: number;
  snippet?: string;
  url?: string;
}

export interface CLDocketHit {
  docketId?: number;
  caseName: string;
  docketNumber?: string;
  court?: string;
  courtId?: string;
  dateFiled?: string;
  dateTerminated?: string | null;
  assignedTo?: string;
  referredTo?: string;
  natureOfSuit?: string;
  cause?: string;
  parties: string[];
  attorneys: string[];
  url?: string;
}

export interface CLDocketEntry {
  id?: number;
  entryNumber?: number;
  dateFiled?: string;
  description: string;
  documents: { id?: number; description?: string; available?: boolean; url?: string; pageCount?: number }[];
}

export interface CLPerson {
  id: number;
  name: string;
  dateOfBirth?: string;
  gender?: string;
  positions: { title?: string; court?: string; courtId?: string; appointer?: string; dateStart?: string; dateTermination?: string; howSelected?: string }[];
  url?: string;
  raw?: Record<string, unknown>;
}

interface SearchResponse {
  count?: number;
  next?: string | null;
  results?: Array<Record<string, unknown>>;
}

export function courtsForJurisdiction(jurisdiction?: string, courts?: string): string | undefined {
  if (courts?.trim()) return courts.trim();
  return jurisdiction ? COURT_GROUPS[jurisdiction] : undefined;
}

export function createCourtListener(opts: ProviderFactoryOptions = {}) {
  const token = envValue(opts, "COURTLISTENER_API_TOKEN");
  const client = new ProviderClient({ name: "courtlistener", rps: token ? 2 : 0.5, burst: token ? 10 : 4, timeoutMs: 25_000, cache: opts.cache, fetchImpl: opts.fetchImpl, offline: opts.offline, limiter: opts.limiter, sleep: opts.sleep, maxWaitMs: opts.maxWaitMs });
  const headers = (): Record<string, string> => (token ? { Authorization: `Token ${token}` } : {});
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

  return {
    name: "courtlistener" as const,
    client,
    keyed: Boolean(token),

    async searchOpinions(q: { query: string; courts?: string; filedAfter?: string; filedBefore?: string; orderBy?: string; limit?: number; signal?: AbortSignal; ttlMs?: number }): Promise<{ total: number; results: CLOpinionHit[] }> {
      const params = new URLSearchParams({ q: q.query, type: "o", order_by: q.orderBy ?? "dateFiled desc" });
      if (q.courts) params.set("court", q.courts);
      if (q.filedAfter) params.set("filed_after", q.filedAfter);
      if (q.filedBefore) params.set("filed_before", q.filedBefore);
      const data = await client.getJSON<SearchResponse>(`${BASE}/search/?${params}`, { headers: headers(), signal: q.signal, ttlMs: q.ttlMs });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("courtlistener", "parse", "courtlistener: search response has no results array (schema drift?)", false);
      const results = data.results.slice(0, Math.min(q.limit ?? 20, 100)).map((r): CLOpinionHit => {
        const ops = Array.isArray(r.opinions) ? (r.opinions as Array<Record<string, unknown>>) : [];
        const first = ops[0] ?? {};
        return {
          clusterId: num(r.cluster_id),
          opinionId: num(first.id),
          caseName: str(r.caseName) ?? str(r.caseNameFull) ?? "Untitled",
          citations: Array.isArray(r.citation) ? (r.citation as unknown[]).map(String) : [],
          court: str(r.court),
          courtId: str(r.court_id),
          dateFiled: str(r.dateFiled)?.slice(0, 10),
          docketNumber: str(r.docketNumber),
          judge: str(r.judge),
          status: str(r.status),
          citeCount: num(r.citeCount),
          snippet: (str(first.snippet) ?? str(r.snippet) ?? "").replace(/\s+/g, " ").trim(),
          url: str(r.absolute_url) ? `${SITE}${str(r.absolute_url)}` : undefined,
        };
      });
      return { total: data.count ?? results.length, results };
    },

    async getOpinionText(opinionId: number, o: { maxChars?: number; signal?: AbortSignal } = {}): Promise<{ text: string; url?: string; length: number; author?: string; dateCreated?: string }> {
      const data = await client.getJSON<Record<string, unknown>>(`${BASE}/opinions/${opinionId}/`, { headers: headers(), signal: o.signal });
      const raw = str(data.plain_text)?.trim() || htmlToText(str(data.html_with_citations) ?? str(data.html) ?? str(data.html_lawbox) ?? str(data.html_columbia) ?? "", { maxChars: 600_000 }).text || stripXml(str(data.xml_harvard) ?? "");
      return { text: clip(raw, o.maxChars ?? 80_000), url: str(data.absolute_url) ? `${SITE}${str(data.absolute_url)}` : undefined, length: raw.length, author: str(data.author_str), dateCreated: str(data.date_created) };
    },

    async searchDockets(q: { query: string; courts?: string; filedAfter?: string; filedBefore?: string; docketNumber?: string; limit?: number; signal?: AbortSignal; ttlMs?: number }): Promise<{ total: number; results: CLDocketHit[] }> {
      const query = q.docketNumber ? `docketNumber:"${q.docketNumber}"${q.query ? ` ${q.query}` : ""}` : q.query;
      const params = new URLSearchParams({ q: query, type: "r", order_by: "dateFiled desc" });
      if (q.courts) params.set("court", q.courts);
      if (q.filedAfter) params.set("filed_after", q.filedAfter);
      if (q.filedBefore) params.set("filed_before", q.filedBefore);
      const data = await client.getJSON<SearchResponse>(`${BASE}/search/?${params}`, { headers: headers(), signal: q.signal, ttlMs: q.ttlMs });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("courtlistener", "parse", "courtlistener: docket search response has no results array (schema drift?)", false);
      const results = data.results.slice(0, Math.min(q.limit ?? 20, 100)).map((r): CLDocketHit => ({
        docketId: num(r.docket_id),
        caseName: str(r.caseName) ?? "Untitled",
        docketNumber: str(r.docketNumber),
        court: str(r.court),
        courtId: str(r.court_id),
        dateFiled: str(r.dateFiled)?.slice(0, 10),
        dateTerminated: str(r.dateTerminated) ?? null,
        assignedTo: str(r.assignedTo),
        referredTo: str(r.referredTo),
        natureOfSuit: str(r.suitNature),
        cause: str(r.cause),
        parties: Array.isArray(r.party) ? (r.party as unknown[]).map(String).slice(0, 40) : [],
        attorneys: Array.isArray(r.attorney) ? (r.attorney as unknown[]).map(String).slice(0, 40) : [],
        url: str(r.absolute_url) ? `${SITE}${str(r.absolute_url)}` : undefined,
      }));
      return { total: data.count ?? results.length, results };
    },

    async getDocket(docketId: number, o: { signal?: AbortSignal; ttlMs?: number } = {}): Promise<CLDocketHit & { raw: Record<string, unknown> }> {
      const r = await client.getJSON<Record<string, unknown>>(`${BASE}/dockets/${docketId}/`, { headers: headers(), signal: o.signal, ttlMs: o.ttlMs });
      return {
        docketId,
        caseName: str(r.case_name) ?? str(r.case_name_full) ?? "Untitled",
        docketNumber: str(r.docket_number),
        courtId: typeof r.court === "string" ? r.court.split("/").filter(Boolean).pop() : str(r.court_id),
        dateFiled: str(r.date_filed),
        dateTerminated: str(r.date_terminated) ?? null,
        assignedTo: str(r.assigned_to_str),
        referredTo: str(r.referred_to_str),
        natureOfSuit: str(r.nature_of_suit),
        cause: str(r.cause),
        parties: [],
        attorneys: [],
        url: str(r.absolute_url) ? `${SITE}${str(r.absolute_url)}` : undefined,
        raw: r,
      };
    },

    async getDocketEntries(docketId: number, o: { since?: string; limit?: number; signal?: AbortSignal; ttlMs?: number } = {}): Promise<CLDocketEntry[]> {
      const params = new URLSearchParams({ docket: String(docketId), order_by: "-date_filed", page_size: String(Math.min(o.limit ?? 50, 100)) });
      if (o.since) params.set("date_filed__gte", o.since);
      const data = await client.getJSON<{ results?: Array<Record<string, unknown>> }>(`${BASE}/docket-entries/?${params}`, { headers: headers(), signal: o.signal, ttlMs: o.ttlMs ?? 30 * 60_000 });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("courtlistener", "parse", "courtlistener: docket-entries response has no results array (schema drift?)", false);
      return data.results.map((e): CLDocketEntry => ({
        id: num(e.id),
        entryNumber: num(e.entry_number),
        dateFiled: str(e.date_filed),
        description: (str(e.description) ?? "").trim(),
        documents: Array.isArray(e.recap_documents) ? (e.recap_documents as Array<Record<string, unknown>>).slice(0, 5).map((d) => ({ id: num(d.id), description: str(d.description), available: Boolean(d.is_available), url: str(d.absolute_url) ? `${SITE}${str(d.absolute_url)}` : undefined, pageCount: num(d.page_count) })) : [],
      }));
    },

    async searchPeople(q: { name: string; limit?: number; signal?: AbortSignal }): Promise<CLPerson[]> {
      const params = new URLSearchParams({ q: q.name, type: "p" });
      const data = await client.getJSON<SearchResponse>(`${BASE}/search/?${params}`, { headers: headers(), signal: q.signal });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("courtlistener", "parse", "courtlistener: people search response has no results array (schema drift?)", false);
      return data.results.slice(0, q.limit ?? 5).map((r): CLPerson => ({
        id: num(r.id) ?? 0,
        name: str(r.name) ?? [str(r.name_first), str(r.name_middle), str(r.name_last)].filter(Boolean).join(" "),
        dateOfBirth: str(r.dob),
        gender: str(r.gender),
        positions: Array.isArray(r.positions) ? (r.positions as Array<Record<string, unknown>>).map((p) => ({ title: str(p.position_type) ?? str(p.job_title), court: str(p.court_full_name) ?? str(p.court), courtId: str(p.court_id), appointer: str(p.appointer), dateStart: str(p.date_start), dateTermination: str(p.date_termination), howSelected: str(p.how_selected) })) : [],
        url: str(r.absolute_url) ? `${SITE}${str(r.absolute_url)}` : undefined,
        raw: r,
      }));
    },

    async getPerson(personId: number, o: { signal?: AbortSignal } = {}): Promise<CLPerson> {
      const r = await client.getJSON<Record<string, unknown>>(`${BASE}/people/${personId}/`, { headers: headers(), signal: o.signal });
      const positions: CLPerson["positions"] = [];
      for (const p of Array.isArray(r.positions) ? (r.positions as unknown[]) : []) {
        if (typeof p === "string") {
          try {
            const pr = await client.getJSON<Record<string, unknown>>(p, { headers: headers(), signal: o.signal });
            positions.push({ title: str(pr.position_type) ?? str(pr.job_title), court: typeof pr.court === "string" ? pr.court : undefined, appointer: typeof pr.appointer === "string" ? pr.appointer : undefined, dateStart: str(pr.date_start), dateTermination: str(pr.date_termination), howSelected: str(pr.how_selected) });
          } catch { /* skip an unreadable position */ }
          if (positions.length >= 8) break;
        } else if (p && typeof p === "object") {
          const pr = p as Record<string, unknown>;
          positions.push({ title: str(pr.position_type) ?? str(pr.job_title), court: str(pr.court_full_name) ?? str(pr.court), courtId: str(pr.court_id), appointer: str(pr.appointer), dateStart: str(pr.date_start), dateTermination: str(pr.date_termination), howSelected: str(pr.how_selected) });
        }
      }
      return { id: personId, name: [str(r.name_first), str(r.name_middle), str(r.name_last), str(r.name_suffix)].filter(Boolean).join(" "), dateOfBirth: str(r.date_dob), gender: str(r.gender), positions, url: str(r.absolute_url) ? `${SITE}${str(r.absolute_url)}` : undefined, raw: r };
    },
  };
}

export type CourtListenerProvider = ReturnType<typeof createCourtListener>;
