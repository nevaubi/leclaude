import "server-only";
import { stripXml } from "@/lib/ai/toolkit/http";
import { clip, ProviderClient, ProviderError, type ProviderFactoryOptions } from "./base";

/** eCFR search + versioner APIs (public, no key). */
const SEARCH = "https://www.ecfr.gov/api/search/v1";
const VERSIONER = "https://www.ecfr.gov/api/versioner/v1";

export interface EcfrSearchHit {
  title?: string;
  part?: string;
  section?: string;
  subpart?: string;
  heading?: string;
  partHeading?: string;
  cite: string;
  excerpt?: string;
  startsOn?: string;
  url: string;
}

export interface EcfrSection {
  cite: string;
  title: number;
  part: string;
  section?: string;
  heading?: string;
  url: string;
  asOf: string;
  text: string;
  length: number;
}

/** CFR title → responsible agency (for `agencies`). */
export const CFR_TITLE_AGENCIES: Record<number, string[]> = {
  5: ["Office of Personnel Management"],
  10: ["Department of Energy", "Nuclear Regulatory Commission"],
  12: ["Federal Reserve", "FDIC", "OCC"],
  15: ["Department of Commerce"],
  16: ["Federal Trade Commission", "Consumer Product Safety Commission"],
  17: ["Securities and Exchange Commission", "CFTC"],
  21: ["Food and Drug Administration"],
  26: ["Internal Revenue Service"],
  28: ["Department of Justice"],
  29: ["Department of Labor"],
  30: ["Department of the Interior"],
  32: ["Department of Defense"],
  33: ["U.S. Army Corps of Engineers", "U.S. Coast Guard"],
  40: ["Environmental Protection Agency"],
  42: ["Department of Health and Human Services"],
  45: ["Department of Health and Human Services"],
  47: ["Federal Communications Commission"],
  49: ["Department of Transportation"],
};

export function cfrCite(title: number | string, section?: string, part?: string): string {
  return section ? `${title} C.F.R. § ${section}` : `${title} C.F.R. Part ${part}`;
}

export function createEcfr(opts: ProviderFactoryOptions = {}) {
  const client = new ProviderClient({ name: "ecfr", rps: 2, burst: 6, timeoutMs: 30_000, cache: opts.cache, fetchImpl: opts.fetchImpl, offline: opts.offline, limiter: opts.limiter, sleep: opts.sleep, maxWaitMs: opts.maxWaitMs });
  return {
    name: "ecfr" as const,
    client,
    async search(q: { query: string; title?: number; agencySlug?: string; limit?: number; signal?: AbortSignal }): Promise<{ total: number; results: EcfrSearchHit[] }> {
      const params = new URLSearchParams({ query: q.query, per_page: String(Math.min(q.limit ?? 10, 50)), page: "1", order: "relevance" });
      if (q.title) params.append("hierarchy[title]", String(q.title));
      if (q.agencySlug) params.append("agency_slugs[]", q.agencySlug);
      const data = await client.getJSON<{ results?: Array<{ hierarchy?: Record<string, string>; headings?: Record<string, string>; full_text_excerpt?: string; starts_on?: string }>; meta?: { total_count?: number } }>(`${SEARCH}/results?${params}`, { signal: q.signal });
      if (!data || !Array.isArray(data.results)) throw new ProviderError("ecfr", "parse", "ecfr: search response has no results array (schema drift?)", false);
      const results = data.results.map((r): EcfrSearchHit => {
        const h = r.hierarchy ?? {};
        return {
          title: h.title, part: h.part, section: h.section, subpart: h.subpart,
          heading: r.headings?.section ?? r.headings?.part,
          partHeading: r.headings?.part,
          cite: cfrCite(h.title ?? "?", h.section, h.part),
          excerpt: r.full_text_excerpt?.replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim(),
          startsOn: r.starts_on,
          url: h.section ? `https://www.ecfr.gov/current/title-${h.title}/section-${h.section}` : `https://www.ecfr.gov/current/title-${h.title}/part-${h.part}`,
        };
      });
      return { total: data.meta?.total_count ?? results.length, results };
    },
    /** Full text of a section (or a whole part when `section` is omitted — parts can be very large; capped). */
    async getSection(q: { title: number; section?: string; part?: string; date?: string; maxChars?: number; signal?: AbortSignal }): Promise<EcfrSection> {
      const asOf = q.date ?? new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
      const part = q.part ?? q.section?.split(".")[0];
      if (!part) throw new ProviderError("ecfr", "parse", "ecfr: a part or section is required", false);
      const params = new URLSearchParams({ part });
      if (q.section) params.set("section", q.section);
      const url = `${VERSIONER}/full/${asOf}/title-${q.title}.xml?${params}`;
      const res = await client.getText(url, { signal: q.signal, maxBytes: 4_000_000 });
      const body = stripXml(res.text);
      if (!body.trim()) throw new ProviderError("ecfr", "parse", `ecfr: empty section text for ${cfrCite(q.title, q.section, part)}`, false, res.status, url);
      const heading = res.text.match(/<SUBJECT>([\s\S]*?)<\/SUBJECT>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? res.text.match(/<HEAD>([\s\S]*?)<\/HEAD>/)?.[1]?.replace(/<[^>]+>/g, "").trim();
      return { cite: cfrCite(q.title, q.section, part), title: q.title, part, section: q.section, heading, url: q.section ? `https://www.ecfr.gov/current/title-${q.title}/section-${q.section}` : `https://www.ecfr.gov/current/title-${q.title}/part-${part}`, asOf, text: clip(body, q.maxChars ?? 120_000), length: body.length };
    },
    /** Structure (headings) for a part — used to enumerate sections cheaply. */
    async partSections(q: { title: number; part: string; date?: string; signal?: AbortSignal }): Promise<{ section: string; heading?: string }[]> {
      const asOf = q.date ?? new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
      const data = await client.getJSON<{ children?: unknown[] }>(`${VERSIONER}/structure/${asOf}/title-${q.title}.json`, { signal: q.signal, maxBytes: 6_000_000 });
      const out: { section: string; heading?: string }[] = [];
      const walk = (n: unknown) => {
        if (!n || typeof n !== "object") return;
        const node = n as { type?: string; identifier?: string; label_description?: string; children?: unknown[] };
        if (node.type === "section" && node.identifier?.startsWith(`${q.part}.`)) out.push({ section: node.identifier, heading: node.label_description });
        node.children?.forEach(walk);
      };
      walk(data);
      return out;
    },
  };
}

export type EcfrProvider = ReturnType<typeof createEcfr>;
