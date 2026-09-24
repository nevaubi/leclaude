import "server-only";
import { htmlToText, stripXml } from "@/lib/ai/toolkit/http";
import { clip, ProviderClient, ProviderError, type ProviderFactoryOptions } from "./base";

/** Federal Register API v1 (public, no key). */
const BASE = "https://www.federalregister.gov/api/v1";

export interface FRDocument {
  documentNumber: string;
  title: string;
  type?: string;
  abstract?: string;
  agencies: string[];
  publicationDate?: string;
  effectiveOn?: string;
  commentsCloseOn?: string;
  citation?: string;
  docketIds: string[];
  cfrReferences: { title?: number; part?: number }[];
  url: string;
  pdfUrl?: string;
  rawTextUrl?: string;
  bodyHtmlUrl?: string;
  fullTextXmlUrl?: string;
}

const FIELDS = ["title", "type", "abstract", "document_number", "html_url", "pdf_url", "publication_date", "agencies", "citation", "effective_on", "comments_close_on", "docket_ids", "cfr_references", "raw_text_url", "body_html_url", "full_text_xml_url"];

function mapDoc(r: Record<string, unknown>): FRDocument {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const agencies = Array.isArray(r.agencies) ? (r.agencies as Array<{ name?: string; raw_name?: string }>).map((a) => a.name ?? a.raw_name).filter((x): x is string => Boolean(x)) : [];
  return {
    documentNumber: str(r.document_number) ?? "",
    title: str(r.title) ?? "Untitled",
    type: str(r.type),
    abstract: str(r.abstract),
    agencies,
    publicationDate: str(r.publication_date),
    effectiveOn: str(r.effective_on) ?? undefined,
    commentsCloseOn: str(r.comments_close_on) ?? undefined,
    citation: str(r.citation) ?? undefined,
    docketIds: Array.isArray(r.docket_ids) ? (r.docket_ids as unknown[]).map(String) : [],
    cfrReferences: Array.isArray(r.cfr_references) ? (r.cfr_references as Array<{ title?: number; part?: number }>).map((c) => ({ title: c.title, part: c.part })) : [],
    url: str(r.html_url) ?? "",
    pdfUrl: str(r.pdf_url),
    rawTextUrl: str(r.raw_text_url),
    bodyHtmlUrl: str(r.body_html_url),
    fullTextXmlUrl: str(r.full_text_xml_url),
  };
}

export function createFederalRegister(opts: ProviderFactoryOptions = {}) {
  const client = new ProviderClient({ name: "federal-register", rps: 2, burst: 6, timeoutMs: 30_000, cache: opts.cache, fetchImpl: opts.fetchImpl, offline: opts.offline, limiter: opts.limiter, sleep: opts.sleep, maxWaitMs: opts.maxWaitMs });
  return {
    name: "federal-register" as const,
    client,
    async search(q: { term: string; agencies?: string[]; types?: string[]; publishedAfter?: string; publishedBefore?: string; limit?: number; signal?: AbortSignal; ttlMs?: number }): Promise<{ total: number; results: FRDocument[] }> {
      const params = new URLSearchParams({ "conditions[term]": q.term, per_page: String(Math.min(q.limit ?? 20, 100)), order: "newest" });
      for (const a of q.agencies ?? []) params.append("conditions[agencies][]", a);
      for (const t of q.types ?? []) params.append("conditions[type][]", t);
      if (q.publishedAfter) params.set("conditions[publication_date][gte]", q.publishedAfter);
      if (q.publishedBefore) params.set("conditions[publication_date][lte]", q.publishedBefore);
      for (const f of FIELDS) params.append("fields[]", f);
      const data = await client.getJSON<{ count?: number; results?: Array<Record<string, unknown>> }>(`${BASE}/documents.json?${params}`, { signal: q.signal, ttlMs: q.ttlMs });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("federal-register", "parse", "federal-register: search response has no results array (schema drift?)", false);
      return { total: data.count ?? data.results.length, results: data.results.map(mapDoc) };
    },
    async getDocument(documentNumber: string, o: { signal?: AbortSignal } = {}): Promise<FRDocument> {
      const data = await client.getJSON<Record<string, unknown>>(`${BASE}/documents/${encodeURIComponent(documentNumber)}.json`, { signal: o.signal });
      return mapDoc(data);
    },
    /** Full text (raw text preferred; falls back to body HTML and XML). */
    async getText(doc: FRDocument, o: { maxChars?: number; signal?: AbortSignal } = {}): Promise<{ text: string; length: number; source: "raw" | "html" | "xml" | "abstract" }> {
      const src = doc.rawTextUrl ?? doc.bodyHtmlUrl ?? doc.fullTextXmlUrl;
      if (!src) return { text: clip(doc.abstract ?? "", o.maxChars ?? 80_000), length: doc.abstract?.length ?? 0, source: "abstract" };
      const r = await client.getText(src, { signal: o.signal, maxBytes: 3_000_000 });
      const text = /xml/i.test(r.contentType) ? stripXml(r.text) : /html/i.test(r.contentType) ? htmlToText(r.text, { maxChars: 900_000 }).text : r.text;
      return { text: clip(text, o.maxChars ?? 80_000), length: text.length, source: /xml/i.test(r.contentType) ? "xml" : /html/i.test(r.contentType) ? "html" : "raw" };
    },
  };
}

export type FederalRegisterProvider = ReturnType<typeof createFederalRegister>;
