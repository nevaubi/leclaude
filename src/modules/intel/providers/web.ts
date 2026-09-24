import "server-only";
import { htmlToText } from "@/lib/ai/toolkit/http";
import { extractIntelText } from "../extract";
import { asProviderError, clip, isProviderError, ProviderClient, ProviderError, type ProviderFactoryOptions } from "./base";
import type { FirecrawlProvider } from "./firecrawl";

/**
 * Plain web fetch → readable text (HTML via htmlToText, PDF via pdfjs, JSON /
 * text as-is). Uses Firecrawl when it is configured and the caller does not
 * insist on a plain fetch; falls back to plain fetch when Firecrawl fails.
 */
export interface WebPage {
  url: string;
  finalUrl: string;
  title?: string;
  text: string;
  contentType: string;
  via: "firecrawl" | "plain" | "pdf";
  fetchedAt: string;
  cached: boolean;
  status?: number;
}

export function createWeb(opts: ProviderFactoryOptions & { firecrawl?: FirecrawlProvider } = {}) {
  const client = new ProviderClient({ name: "web", rps: 2, burst: 6, timeoutMs: 30_000, cache: opts.cache, fetchImpl: opts.fetchImpl, offline: opts.offline, limiter: opts.limiter, sleep: opts.sleep, maxWaitMs: opts.maxWaitMs });
  const firecrawl = opts.firecrawl;

  async function fetchPdf(url: string, signal?: AbortSignal, maxChars?: number): Promise<WebPage> {
    if (opts.offline) throw new ProviderError("web", "not_configured", "web: outbound network is disabled (INTEL_OFFLINE)", false, undefined, url);
    const ok = await client.limiter.take(opts.maxWaitMs ?? 8_000, opts.sleep);
    if (!ok) throw new ProviderError("web", "rate_limited", "web: local rate limit reached", true, undefined, url);
    const doFetch = opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45_000);
    signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const res = await doFetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "LeClaude/1.0 (+internal legal research platform)" } });
      if (!res.ok) throw new ProviderError("web", "http", `web: HTTP ${res.status}`, res.status >= 500, res.status, url);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 30_000_000) throw new ProviderError("web", "parse", "web: PDF larger than 30MB", false, res.status, url);
      const ex = await extractIntelText(bytes, "document.pdf", "application/pdf");
      if (!ex.text) throw new ProviderError("web", "parse", `web: ${ex.warning ?? "no text in PDF"}`, false, res.status, url);
      return { url, finalUrl: res.url || url, title: undefined, text: clip(ex.text, maxChars ?? 200_000), contentType: "application/pdf", via: "pdf", fetchedAt: new Date().toISOString(), cached: false, status: res.status };
    } catch (e) { throw asProviderError("web", e, url); } finally { clearTimeout(t); }
  }

  return {
    name: "web" as const,
    client,
    async fetchPage(url: string, o: { maxChars?: number; prefer?: "auto" | "plain" | "firecrawl"; signal?: AbortSignal; ttlMs?: number } = {}): Promise<WebPage> {
      if (!/^https?:\/\//i.test(url)) throw new ProviderError("web", "parse", `web: unsupported URL ${url}`, false, undefined, url);
      const prefer = o.prefer ?? "auto";
      if (prefer !== "plain" && firecrawl?.configured) {
        try {
          const p = await firecrawl.scrape(url, { maxChars: o.maxChars, signal: o.signal, ttlMs: o.ttlMs });
          if (p.markdown.trim()) return { url, finalUrl: p.url || url, title: p.title, text: p.markdown, contentType: "text/markdown", via: "firecrawl", fetchedAt: new Date().toISOString(), cached: false, status: p.statusCode };
        } catch (e) {
          if (prefer === "firecrawl") throw e;
          if (isProviderError(e) && e.code === "not_configured") { /* fall through to plain */ } else if (isProviderError(e) && e.code === "rate_limited") throw e;
        }
      }
      if (/\.pdf(?:$|\?)/i.test(url)) return fetchPdf(url, o.signal, o.maxChars);
      const res = await client.getText(url, { signal: o.signal, ttlMs: o.ttlMs, maxBytes: 3_000_000 });
      if (/pdf/i.test(res.contentType)) return fetchPdf(url, o.signal, o.maxChars);
      if (/json|text\/plain|markdown/i.test(res.contentType)) return { url, finalUrl: res.finalUrl, text: clip(res.text, o.maxChars ?? 120_000), contentType: res.contentType, via: "plain", fetchedAt: res.fetchedAt, cached: res.cached, status: res.status };
      const { title, text } = htmlToText(res.text, { maxChars: o.maxChars ?? 120_000 });
      if (!text.trim()) throw new ProviderError("web", "parse", `web: no readable text at ${url}`, false, res.status, url);
      return { url, finalUrl: res.finalUrl, title: title || undefined, text, contentType: res.contentType, via: "plain", fetchedAt: res.fetchedAt, cached: res.cached, status: res.status };
    },
    /** Reachability probe for the broken-link sweep. */
    probe(url: string, o: { signal?: AbortSignal; timeoutMs?: number } = {}) {
      return client.probe(url, o);
    },
  };
}

export type WebProvider = ReturnType<typeof createWeb>;
