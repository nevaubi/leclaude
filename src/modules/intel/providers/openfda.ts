import "server-only";
import { envValue, ProviderClient, ProviderError, type ProviderFactoryOptions } from "./base";

/**
 * openFDA: enforcement (recalls), drug labels and device adverse events.
 * Anonymous access allows 240 requests/minute; OPENFDA_API_KEY raises it.
 */
const BASE = "https://api.fda.gov";

export type FdaEndpoint = "drug" | "device" | "food";

export interface FdaEnforcementRecord {
  recallNumber: string;
  eventId?: string;
  status?: string;
  classification?: string;
  product: string;
  productType?: string;
  reason?: string;
  recallingFirm?: string;
  city?: string;
  state?: string;
  country?: string;
  distribution?: string;
  codeInfo?: string;
  quantity?: string;
  initiationDate?: string;
  reportDate?: string;
  terminationDate?: string;
  centerClassificationDate?: string;
  voluntaryMandated?: string;
  openfda: { brandName?: string[]; genericName?: string[]; manufacturerName?: string[]; ndc?: string[]; applicationNumber?: string[] };
}

export interface FdaLabel {
  id?: string;
  setId?: string;
  effectiveTime?: string;
  brandName?: string[];
  genericName?: string[];
  manufacturerName?: string[];
  ndc?: string[];
  applicationNumber?: string[];
  boxedWarning?: string;
  warningsAndCautions?: string;
  warnings?: string;
  indications?: string;
  adverseReactions?: string;
  contraindications?: string;
  raw: Record<string, unknown>;
}

export interface FdaDeviceEvent {
  reportNumber: string;
  eventType?: string;
  dateReceived?: string;
  dateOfEvent?: string;
  brandName?: string;
  genericName?: string;
  manufacturer?: string;
  productProblems: string[];
  narrative: string;
}

/** openFDA date filter helper: [YYYYMMDD+TO+YYYYMMDD]. */
export function fdaDateRange(field: string, from: Date, to = new Date()): string {
  const f = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  return `${field}:[${f(from)}+TO+${f(to)}]`;
}

/** Normalize an openFDA date (YYYYMMDD) to ISO. */
export function fdaDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : v.length === 10 ? v : undefined;
}

export function fdaSearchClause(terms: string[], field?: string): string {
  const quote = (t: string) => `"${t.replace(/"/g, "").trim()}"`;
  const parts = terms.filter(Boolean).map((t) => (field ? `${field}:${quote(t)}` : quote(t)));
  return parts.length > 1 ? `(${parts.join("+OR+")})` : parts[0] ?? "";
}

export function createOpenFda(opts: ProviderFactoryOptions = {}) {
  const key = envValue(opts, "OPENFDA_API_KEY");
  const client = new ProviderClient({ name: "openfda", rps: key ? 6 : 3, burst: 10, timeoutMs: 25_000, cache: opts.cache, fetchImpl: opts.fetchImpl, offline: opts.offline, limiter: opts.limiter, sleep: opts.sleep, maxWaitMs: opts.maxWaitMs });
  const build = (path: string, params: Record<string, string | number | undefined>) => {
    const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2B/g, "+").replace(/%3A/g, ":").replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/%22/g, '"').replace(/%28/g, "(").replace(/%29/g, ")")}`);
    if (key) qs.push(`api_key=${encodeURIComponent(key)}`);
    return `${BASE}${path}?${qs.join("&")}`;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : undefined);
  const notFoundIsEmpty = async <T>(fn: () => Promise<T>, empty: T): Promise<T> => {
    try { return await fn(); } catch (e) { if (e instanceof ProviderError && e.status === 404) return empty; throw e; }
  };

  return {
    name: "openfda" as const,
    client,
    keyed: Boolean(key),
    /** Recalls / enforcement reports. `search` uses openFDA query syntax (e.g. product_description:"medroxyprogesterone"+AND+report_date:[20240101+TO+20241231]). */
    async enforcement(q: { endpoint?: FdaEndpoint; search: string; limit?: number; skip?: number; signal?: AbortSignal; ttlMs?: number }): Promise<{ total: number; results: FdaEnforcementRecord[] }> {
      const url = build(`/${q.endpoint ?? "drug"}/enforcement.json`, { search: q.search, limit: Math.min(q.limit ?? 50, 1000), skip: q.skip, sort: "report_date:desc" });
      const data = await notFoundIsEmpty(() => client.getJSON<{ meta?: { results?: { total?: number } }; results?: Array<Record<string, unknown>> }>(url, { signal: q.signal, ttlMs: q.ttlMs }), { meta: { results: { total: 0 } }, results: [] });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("openfda", "parse", "openfda: enforcement response has no results array (schema drift?)", false);
      const results = data.results.map((r): FdaEnforcementRecord => {
        const of = (r.openfda ?? {}) as Record<string, unknown>;
        return {
          recallNumber: str(r.recall_number) ?? "",
          eventId: str(r.event_id),
          status: str(r.status),
          classification: str(r.classification),
          product: (str(r.product_description) ?? "").replace(/\s+/g, " ").trim(),
          productType: str(r.product_type),
          reason: str(r.reason_for_recall)?.replace(/\s+/g, " ").trim(),
          recallingFirm: str(r.recalling_firm),
          city: str(r.city), state: str(r.state), country: str(r.country),
          distribution: str(r.distribution_pattern),
          codeInfo: str(r.code_info),
          quantity: str(r.product_quantity),
          initiationDate: fdaDate(r.recall_initiation_date),
          reportDate: fdaDate(r.report_date),
          terminationDate: fdaDate(r.termination_date),
          centerClassificationDate: fdaDate(r.center_classification_date),
          voluntaryMandated: str(r.voluntary_mandated),
          openfda: { brandName: arr(of.brand_name), genericName: arr(of.generic_name), manufacturerName: arr(of.manufacturer_name), ndc: arr(of.product_ndc), applicationNumber: arr(of.application_number) },
        };
      });
      return { total: data.meta?.results?.total ?? results.length, results };
    },
    async drugLabels(q: { search: string; limit?: number; signal?: AbortSignal; ttlMs?: number }): Promise<{ total: number; results: FdaLabel[] }> {
      const url = build("/drug/label.json", { search: q.search, limit: Math.min(q.limit ?? 10, 100) });
      const data = await notFoundIsEmpty(() => client.getJSON<{ meta?: { results?: { total?: number } }; results?: Array<Record<string, unknown>> }>(url, { signal: q.signal, ttlMs: q.ttlMs }), { meta: { results: { total: 0 } }, results: [] });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("openfda", "parse", "openfda: label response has no results array (schema drift?)", false);
      const first = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : undefined);
      const results = data.results.map((r): FdaLabel => {
        const of = (r.openfda ?? {}) as Record<string, unknown>;
        return { id: str(r.id), setId: str(r.set_id), effectiveTime: fdaDate(r.effective_time), brandName: arr(of.brand_name), genericName: arr(of.generic_name), manufacturerName: arr(of.manufacturer_name), ndc: arr(of.product_ndc), applicationNumber: arr(of.application_number), boxedWarning: first(r.boxed_warning), warningsAndCautions: first(r.warnings_and_cautions), warnings: first(r.warnings), indications: first(r.indications_and_usage), adverseReactions: first(r.adverse_reactions), contraindications: first(r.contraindications), raw: r };
      });
      return { total: data.meta?.results?.total ?? results.length, results };
    },
    async deviceEvents(q: { search: string; limit?: number; signal?: AbortSignal; ttlMs?: number }): Promise<{ total: number; results: FdaDeviceEvent[] }> {
      const url = build("/device/event.json", { search: q.search, limit: Math.min(q.limit ?? 25, 100), sort: "date_received:desc" });
      const data = await notFoundIsEmpty(() => client.getJSON<{ meta?: { results?: { total?: number } }; results?: Array<Record<string, unknown>> }>(url, { signal: q.signal, ttlMs: q.ttlMs }), { meta: { results: { total: 0 } }, results: [] });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("openfda", "parse", "openfda: device event response has no results array (schema drift?)", false);
      const results = data.results.map((r): FdaDeviceEvent => {
        const dev = (Array.isArray(r.device) ? (r.device as Array<Record<string, unknown>>)[0] : undefined) ?? {};
        const texts = Array.isArray(r.mdr_text) ? (r.mdr_text as Array<Record<string, unknown>>).map((t) => str(t.text) ?? "").filter(Boolean) : [];
        return { reportNumber: str(r.report_number) ?? str(r.mdr_report_key) ?? "", eventType: str(r.event_type), dateReceived: fdaDate(r.date_received), dateOfEvent: fdaDate(r.date_of_event), brandName: str(dev.brand_name), genericName: str(dev.generic_name), manufacturer: str(dev.manufacturer_d_name), productProblems: arr(r.product_problems) ?? [], narrative: texts.join("\n\n").slice(0, 20_000) };
      });
      return { total: data.meta?.results?.total ?? results.length, results };
    },
  };
}

export type OpenFdaProvider = ReturnType<typeof createOpenFda>;
