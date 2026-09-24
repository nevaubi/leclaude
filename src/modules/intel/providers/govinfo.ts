import "server-only";
import { htmlToText } from "@/lib/ai/toolkit/http";
import { clip, envValue, ProviderClient, ProviderError, type ProviderFactoryOptions } from "./base";

/** GovInfo search + content (DEMO_KEY works with a small daily quota). */
const BASE = "https://api.govinfo.gov";

export interface GovInfoHit {
  title: string;
  packageId?: string;
  granuleId?: string;
  dateIssued?: string;
  collection?: string;
  teaser?: string;
  textUrl?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  url?: string;
}

export function createGovInfo(opts: ProviderFactoryOptions = {}) {
  const key = envValue(opts, "GOVINFO_API_KEY") ?? "DEMO_KEY";
  const client = new ProviderClient({ name: "govinfo", rps: key === "DEMO_KEY" ? 0.5 : 2, burst: 3, timeoutMs: 30_000, cache: opts.cache, fetchImpl: opts.fetchImpl, offline: opts.offline, limiter: opts.limiter, sleep: opts.sleep, maxWaitMs: opts.maxWaitMs });
  const withKey = (url: string) => `${url}${url.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`;
  return {
    name: "govinfo" as const,
    client,
    keyed: key !== "DEMO_KEY",
    async search(q: { query: string; collection?: string; limit?: number; signal?: AbortSignal; ttlMs?: number }): Promise<{ total: number; results: GovInfoHit[] }> {
      const collection = (q.collection ?? "USCODE").toUpperCase();
      const data = await client.postJSON<{ count?: number; results?: Array<Record<string, unknown>> }>(withKey(`${BASE}/search`), { query: `collection:${collection} ${q.query}`, pageSize: Math.min(q.limit ?? 10, 50), offsetMark: "*", sorts: [{ field: "score", sortOrder: "DESC" }] }, { signal: q.signal, ttlMs: q.ttlMs });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("govinfo", "parse", "govinfo: search response has no results array (schema drift?)", false);
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      const results = data.results.map((r): GovInfoHit => {
        const dl = (r.download ?? {}) as Record<string, unknown>;
        return { title: str(r.title) ?? "Untitled", packageId: str(r.packageId), granuleId: str(r.granuleId), dateIssued: str(r.dateIssued), collection: str(r.collectionCode) ?? collection, teaser: str(r.teaser)?.replace(/<[^>]+>/g, "").trim(), textUrl: str(dl.txtLink), pdfUrl: str(dl.pdfLink), xmlUrl: str(dl.xmlLink), url: str(r.resultLink) };
      });
      return { total: data.count ?? results.length, results };
    },
    /** Read a hit's text rendition (txtLink is HTML-ish for many collections; converted to text). */
    async getText(hit: GovInfoHit, o: { maxChars?: number; signal?: AbortSignal } = {}): Promise<{ text: string; length: number }> {
      if (!hit.textUrl) return { text: clip(hit.teaser ?? "", o.maxChars ?? 60_000), length: hit.teaser?.length ?? 0 };
      const r = await client.getText(withKey(hit.textUrl), { signal: o.signal, maxBytes: 3_000_000 });
      const text = /html/i.test(r.contentType) || /<html/i.test(r.text.slice(0, 500)) ? htmlToText(r.text, { maxChars: 900_000 }).text : r.text;
      return { text: clip(text, o.maxChars ?? 60_000), length: text.length };
    },
  };
}

export type GovInfoProvider = ReturnType<typeof createGovInfo>;
