import "server-only";
import type { Tool } from "openai/resources/responses/responses";
import { defineTool } from "../tools";
import { fetchText, htmlToText } from "./http";

/** OpenAI built-in web search tool configuration. */
export function webSearchTool(opts: { contextSize?: "low" | "medium" | "high"; allowedDomains?: string[] } = {}): Tool {
  return {
    type: "web_search",
    search_context_size: opts.contextSize ?? "medium",
    ...(opts.allowedDomains?.length ? { filters: { allowed_domains: opts.allowedDomains } } : {}),
    user_location: { type: "approximate", country: "US" },
  };
}

export const fetchUrlTool = defineTool<{ url: string; max_chars?: number }>({
  name: "fetch_url",
  description: "Fetch a public web page, PDF-less HTML document, JSON or plain-text URL and return its readable text. Use it to read a source you found via search, a statute or regulation page, a court website, or a client-provided link.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL" },
      max_chars: { type: "integer", description: "Maximum characters of text to return (default 30000)" },
    },
    required: ["url"],
  },
  label: (a) => `Reading ${safeHost(a.url)}`,
  async execute({ url, max_chars }, ctx) {
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs are supported");
    const { text, contentType, finalUrl } = await fetchText(url, { signal: ctx.signal });
    if (/json/i.test(contentType)) return { url: finalUrl, contentType, text: text.slice(0, max_chars ?? 30_000) };
    if (/text\/plain/i.test(contentType)) return { url: finalUrl, contentType, text: text.slice(0, max_chars ?? 30_000) };
    const { title, text: body } = htmlToText(text, { maxChars: max_chars ?? 30_000 });
    ctx.emit({ type: "citation", citation: { title: title || finalUrl, url: finalUrl, source: "web" } });
    return { url: finalUrl, title, contentType, text: body };
  },
});

function safeHost(url: string) { try { return new URL(url).host; } catch { return "page"; } }
