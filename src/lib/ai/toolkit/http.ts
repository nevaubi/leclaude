import "server-only";

export class HttpError extends Error {
  constructor(public status: number, message: string, public url: string) { super(message); this.name = "HttpError"; }
}

const UA = "LeClaude/1.0 (+internal legal research platform)";

export async function fetchJSON<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { ...init, signal: init.signal ?? ctrl.signal, headers: { Accept: "application/json", "User-Agent": UA, ...(init.headers ?? {}) } });
    if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}`, url);
    return (await res.json()) as T;
  } finally { clearTimeout(t); }
}

export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ text: string; contentType: string; status: number; finalUrl: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { ...init, signal: init.signal ?? ctrl.signal, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.8", ...(init.headers ?? {}) }, redirect: "follow" });
    const contentType = res.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await res.arrayBuffer());
    const max = init.maxBytes ?? 2_500_000;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, max));
    if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}`, url);
    return { text, contentType, status: res.status, finalUrl: res.url || url };
  } finally { clearTimeout(t); }
}

/** Lightweight HTML → readable text (no DOM dependency). */
export function htmlToText(html: string, opts: { maxChars?: number } = {}): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside|header)[\s\S]*?<\/\1>/gi, " ");
  // Prefer <main>/<article> when present.
  const main = s.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (main && main.replace(/<[^>]+>/g, "").trim().length > 400) s = main;
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|table|thead|tbody|dd|dt)>/gi, "\n")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<td[^>]*>|<th[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s).replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").replace(/^[ \t]+|[ \t]+$/gm, "").trim();
  const max = opts.maxChars ?? 40_000;
  return { title, text: s.length > max ? s.slice(0, max) + "\n…[truncated]" : s };
}

export function decodeEntities(s: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sect: "§", para: "¶", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return named[e.toLowerCase()] ?? m;
  });
}

export function stripXml(xml: string) {
  return decodeEntities(xml.replace(/<\/(P|HEAD|DIV\d|SECTNO|SUBJECT|FP|NOTE)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}
