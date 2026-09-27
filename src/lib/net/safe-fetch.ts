import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Egress-safe fetch (CLAUDE.md §41 URL fetchers, §53.1 network rules).
 *
 * Every outbound request from the application goes through `safeFetch`, which
 * enforces in code, not in a prompt:
 *
 * - HTTP/S only, no credentials in the URL;
 * - the hostname is resolved and every address is checked: loopback, private
 *   (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7), link-local (169.254/16
 *   including the cloud metadata endpoint, fe80::/10), unspecified, multicast,
 *   reserved and IPv4-mapped/NAT64 forms are rejected unless the policy says
 *   `allowPrivate`;
 * - redirects are followed manually (max 5 hops) and every hop is validated
 *   against the same policy; credentials are dropped on cross-origin hops;
 * - the body is read as a stream against a byte limit (default 8 MB): past the
 *   limit the transfer is aborted (or truncated when the caller opts in);
 * - a total timeout and an external AbortSignal cancel the whole exchange;
 * - optional host allowlist/denylist per policy plus NET_ALLOW_HOSTS /
 *   NET_DENY_HOSTS from the environment;
 * - TLS verification is never disabled; a process that turned it off is refused
 *   in production.
 *
 * Proxies: Node's built-in fetch ignores HTTPS_PROXY. Behind an egress proxy
 * the deployment passes a proxy-aware transport as `fetchImpl` and may set
 * `trustProxyResolution` (or NET_SKIP_DNS_CHECK=true) so the DNS pre-check,
 * which the proxy performs itself, is skipped; the URL/host/literal-address
 * policy still runs here. A caller-supplied `fetchImpl` also skips the DNS
 * pre-check because it does not open the socket this check protects (tests
 * inject fakes this way); a proxied transport must enforce its own network
 * allowlist (see docs/architecture/network-security.md).
 *
 * Known limitation: the DNS pre-check is time-of-check; a rebinding attacker
 * that flips a record between the check and the connect is only stopped by the
 * network layer (VPC egress rules, proxy allowlist), which production must also
 * have.
 */
export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked_scheme"
  | "blocked_host"
  | "blocked_address"
  | "blocked_port"
  | "dns"
  | "too_many_redirects"
  | "bad_redirect"
  | "body_too_large"
  | "timeout"
  | "aborted"
  | "network"
  | "insecure_tls";

export class SafeFetchError extends Error {
  readonly name = "SafeFetchError";
  constructor(public readonly code: SafeFetchErrorCode, message: string, public readonly details: { url?: string; hops?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message);
  }
  get retryable(): boolean { return this.details.retryable ?? false; }
  get url(): string | undefined { return this.details.url; }
  toJSON() { return { name: this.name, code: this.code, message: this.message, url: this.details.url, hops: this.details.hops, retryable: this.retryable }; }
}

export function isSafeFetchError(e: unknown): e is SafeFetchError {
  return Boolean(e) && typeof e === "object" && (e as { name?: string }).name === "SafeFetchError";
}

/** True for policy denials (never retry, never fall back to another route). */
export function isBlockedEgress(e: unknown): boolean {
  return isSafeFetchError(e) && (e.code === "blocked_scheme" || e.code === "blocked_host" || e.code === "blocked_address" || e.code === "blocked_port" || e.code === "insecure_tls");
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

export type AddressClass = "public" | "loopback" | "private" | "link_local" | "unspecified" | "multicast" | "reserved" | "invalid";

function parseIPv4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** Eight 16-bit groups, or null. Handles "::" compression, zone ids and embedded IPv4 tails. */
export function parseIPv6(raw: string): number[] | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s || !/^[0-9a-f:.]+$/.test(s)) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseIPv4(last);
    if (!v4 || lastColon < 0) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  if (parts.length === 1 && head.length !== 8) return null;
  if (parts.length === 2 && head.length + rest.length > 7) return null;
  const toNum = (g: string) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : null);
  const groups: number[] = [];
  for (const g of head) { const n = toNum(g); if (n === null) return null; groups.push(n); }
  if (parts.length === 2) {
    for (let i = 0, fill = 8 - head.length - rest.length; i < fill; i++) groups.push(0);
    for (const g of rest) { const n = toNum(g); if (n === null) return null; groups.push(n); }
  }
  if (groups.length !== 8) return null;
  if (tail.length) { groups[6] = tail[0]; groups[7] = tail[1]; }
  return groups;
}

function classifyV4(p: number[]): AddressClass {
  const [a, b, c] = p;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private";
  if (a === 169 && b === 254) return "link_local";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  if ((a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return "reserved";
  return "public";
}

/** Classify an IPv4 or IPv6 literal (brackets and zone ids tolerated). */
export function classifyAddress(ip: string): AddressClass {
  const v4 = parseIPv4(ip.trim());
  if (v4) return classifyV4(v4);
  const g = parseIPv6(ip);
  if (!g) return "invalid";
  const v4Of = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (g.every((x) => x === 0)) return "unspecified";
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return "loopback";
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return classifyV4(v4Of(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return classifyV4(v4Of(g[6], g[7])); // ::a.b.c.d (deprecated v4-compatible)
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return classifyV4(v4Of(g[6], g[7])); // 64:ff9b::/96 NAT64
  if (g[0] === 0x2002) return classifyV4(v4Of(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return "private"; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return "link_local"; // fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return "private"; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return "multicast";
  if (g[0] === 0x2001 && g[1] === 0x0db8) return "reserved"; // documentation
  return "public";
}

/** Whether a resolved address may be connected to under the policy. */
export function isBlockedAddress(ip: string, allowPrivate = false): { blocked: boolean; klass: AddressClass } {
  const klass = classifyAddress(ip);
  if (klass === "public") return { blocked: false, klass };
  if (klass === "invalid" || klass === "unspecified" || klass === "multicast") return { blocked: true, klass };
  return { blocked: !allowPrivate, klass };
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface EgressPolicy {
  /** Label used in errors and traces (provider or tool name). */
  name?: string;
  /** When set, only these hosts (exact, or a bare domain covering its subdomains; "*.x" for subdomains only; "=x" for exact) may be fetched. */
  allowHosts?: string[];
  denyHosts?: string[];
  /** Development escape hatch: permit loopback/private/link-local targets. Never set in production. */
  allowPrivate?: boolean;
  /** Restrict destination ports (default: any). */
  allowedPorts?: number[];
  allowedSchemes?: Array<"http:" | "https:">;
  /** Byte limit on the (decompressed) body; default 8 MB. */
  maxBytes?: number;
  /** "abort" (default) throws body_too_large; "truncate" stops reading and marks the result truncated. */
  onLimit?: "abort" | "truncate";
  /** Total time for every hop and the body read; default 20 s. */
  timeoutMs?: number;
  /** Default 5. */
  maxRedirects?: number;
  /** Force the DNS pre-check on or off (see module notes for the defaults). */
  dnsCheck?: boolean;
  /** Skip the DNS pre-check when an egress proxy (HTTPS_PROXY) resolves names itself. */
  trustProxyResolution?: boolean;
  /** Injectable resolver (tests, custom DNS). Always consulted when present unless dnsCheck is false. */
  resolver?: (hostname: string) => Promise<string[]>;
}

export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_REDIRECTS = 5;

/** Hostnames that are blocked by name (they never need a DNS answer to be dangerous). */
const BLOCKED_NAMES = ["localhost", ".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".arpa", "metadata.google.internal", "metadata", "instance-data"];

function envList(v: string | undefined): string[] {
  return (v ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function envFlag(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

export interface GlobalEgressSettings {
  allowHosts: string[];
  denyHosts: string[];
  allowPrivate: boolean;
  skipDns: boolean;
  maxBytes?: number;
  timeoutMs?: number;
}

/** Global egress settings from the environment (NET_*). */
export function envEgressPolicy(source: NodeJS.ProcessEnv = process.env): GlobalEgressSettings {
  const maxBytes = Number(source.NET_MAX_BYTES);
  const timeoutMs = Number(source.NET_TIMEOUT_MS);
  return {
    allowHosts: envList(source.NET_ALLOW_HOSTS),
    denyHosts: envList(source.NET_DENY_HOSTS),
    allowPrivate: envFlag(source.NET_ALLOW_PRIVATE),
    skipDns: envFlag(source.NET_SKIP_DNS_CHECK),
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : undefined,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
  };
}

/** True when the process has an egress proxy configured (HTTPS_PROXY / HTTP_PROXY). */
export function proxyConfigured(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((source.HTTPS_PROXY ?? source.https_proxy ?? source.HTTP_PROXY ?? source.http_proxy ?? "").trim());
}

/** Host pattern matching: bare domain covers itself and subdomains; "*.d" subdomains only; "=h" exact. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  let p = pattern.toLowerCase().trim().replace(/\.$/, "");
  if (!p) return false;
  if (p.startsWith("=")) return h === p.slice(1);
  if (p.startsWith("*.")) { p = p.slice(2); return h.endsWith(`.${p}`); }
  if (p.startsWith(".")) p = p.slice(1);
  return h === p || h.endsWith(`.${p}`);
}

function bareHost(url: URL): string {
  let h = url.hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h.replace(/\.$/, "");
}

function describe(policy: EgressPolicy): string {
  return policy.name ? ` (policy ${policy.name})` : "";
}

/**
 * Synchronous checks: scheme, credentials, host allow/deny lists, blocked names,
 * literal addresses and ports. Returns the parsed URL. The DNS check is separate
 * (`assertResolvable`) because it is asynchronous.
 */
export function validateEgressUrl(input: string | URL, policy: EgressPolicy = {}, globals: GlobalEgressSettings = envEgressPolicy()): URL {
  let url: URL;
  try { url = new URL(input instanceof URL ? input.toString() : input); } catch { throw new SafeFetchError("invalid_url", `Invalid URL${describe(policy)}: ${String(input).slice(0, 200)}`, { url: String(input).slice(0, 500) }); }
  const schemes = policy.allowedSchemes ?? ["http:", "https:"];
  if (!schemes.includes(url.protocol as "http:" | "https:")) throw new SafeFetchError("blocked_scheme", `Only ${schemes.join("/")} URLs may be fetched${describe(policy)}; got ${url.protocol}`, { url: url.toString() });
  if (url.username || url.password) throw new SafeFetchError("invalid_url", `Credentials in URLs are not allowed${describe(policy)}`, { url: `${url.protocol}//${url.host}${url.pathname}` });
  const host = bareHost(url);
  if (!host) throw new SafeFetchError("invalid_url", `URL has no host${describe(policy)}`, { url: url.toString() });
  const allowPrivate = policy.allowPrivate ?? globals.allowPrivate;
  if (url.port) {
    const port = Number(url.port);
    if (policy.allowedPorts?.length && !policy.allowedPorts.includes(port)) throw new SafeFetchError("blocked_port", `Port ${port} is not allowed${describe(policy)}`, { url: url.toString() });
  }
  for (const d of [...globals.denyHosts, ...(policy.denyHosts ?? [])]) if (hostMatches(host, d)) throw new SafeFetchError("blocked_host", `Host ${host} is denied by the egress policy${describe(policy)}`, { url: url.toString() });
  if (globals.allowHosts.length && !globals.allowHosts.some((a) => hostMatches(host, a))) throw new SafeFetchError("blocked_host", `Host ${host} is not in NET_ALLOW_HOSTS${describe(policy)}`, { url: url.toString() });
  if (policy.allowHosts?.length && !policy.allowHosts.some((a) => hostMatches(host, a))) throw new SafeFetchError("blocked_host", `Host ${host} is not allowed${describe(policy)}; allowed: ${policy.allowHosts.join(", ")}`, { url: url.toString() });
  if (isIP(host)) {
    const { blocked, klass } = isBlockedAddress(host, allowPrivate);
    if (blocked) throw new SafeFetchError("blocked_address", `Address ${host} is ${klass} and may not be fetched${describe(policy)}`, { url: url.toString() });
  } else if (!allowPrivate && BLOCKED_NAMES.some((n) => hostMatches(host, n))) {
    throw new SafeFetchError("blocked_host", `Host ${host} is an internal name and may not be fetched${describe(policy)}`, { url: url.toString() });
  }
  return url;
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const addrs = await lookup(hostname, { all: true });
  return addrs.map((a) => a.address);
}

/** Resolve the host and reject when any answer is a blocked address. Returns the addresses. */
export async function assertResolvable(url: URL, policy: EgressPolicy = {}, globals: GlobalEgressSettings = envEgressPolicy()): Promise<string[]> {
  const host = bareHost(url);
  if (isIP(host)) return [host];
  const allowPrivate = policy.allowPrivate ?? globals.allowPrivate;
  let addresses: string[];
  try {
    addresses = await (policy.resolver ?? defaultResolver)(host);
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    const retryable = code === "EAI_AGAIN" || code === "ETIMEOUT" || code === "ECONNREFUSED" || code === "ESERVFAIL";
    throw new SafeFetchError("dns", `Could not resolve ${host}${describe(policy)}${code ? ` (${code})` : ""}`, { url: url.toString(), retryable, cause: e });
  }
  if (!addresses.length) throw new SafeFetchError("dns", `${host} has no addresses${describe(policy)}`, { url: url.toString(), retryable: false });
  for (const ip of addresses) {
    const { blocked, klass } = isBlockedAddress(ip, allowPrivate);
    if (blocked) throw new SafeFetchError("blocked_address", `${host} resolves to ${ip} (${klass}), which may not be fetched${describe(policy)}`, { url: url.toString() });
  }
  return addresses;
}

let warnedInsecureTls = false;

function assertTlsVerification(): void {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0") return;
  if (process.env.NODE_ENV === "production") throw new SafeFetchError("insecure_tls", "NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification; outbound requests are refused in production");
  if (!warnedInsecureTls) { warnedInsecureTls = true; console.warn("[net] NODE_TLS_REJECT_UNAUTHORIZED=0 is set; TLS verification is disabled for this process (refused in production)"); }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface SafeFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array | URLSearchParams | null;
  signal?: AbortSignal;
  /** Injectable transport (tests, proxy-aware clients). */
  fetchImpl?: typeof fetch;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  body: Uint8Array;
  /** Bytes actually read. */
  bytes: number;
  /** True when the body was cut at the limit (policy.onLimit = "truncate"). */
  truncated: boolean;
  finalUrl: string;
  /** Redirects followed. */
  hops: number;
  durationMs: number;
  contentType: string;
  /** Addresses the final host resolved to (empty when the DNS check was skipped). */
  addresses: string[];
  text(): string;
  json<T = unknown>(): T;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

function shouldCheckDns(policy: EgressPolicy, init: SafeFetchInit, globals: GlobalEgressSettings): boolean {
  if (policy.dnsCheck === false) return false;
  if (policy.resolver) return true;
  if (policy.dnsCheck === true) return true;
  if (globals.skipDns) return false;
  if (policy.trustProxyResolution && proxyConfigured()) return false;
  if (init.fetchImpl) return false;
  return true;
}

async function readBody(res: Response, maxBytes: number, truncate: boolean, url: string): Promise<{ body: Uint8Array; truncated: boolean }> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes && !truncate) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw new SafeFetchError("body_too_large", `Response declares ${declared} bytes, above the ${maxBytes}-byte limit`, { url });
  }
  const stream = res.body;
  if (!stream) {
    if (typeof res.arrayBuffer === "function") {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) {
        if (!truncate) throw new SafeFetchError("body_too_large", `Response is larger than the ${maxBytes}-byte limit`, { url });
        return { body: buf.subarray(0, maxBytes), truncated: true };
      }
      return { body: buf, truncated: false };
    }
    return { body: new Uint8Array(0), truncated: false };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      if (!truncate) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new SafeFetchError("body_too_large", `Response exceeded the ${maxBytes}-byte limit`, { url });
      }
      const room = maxBytes - total;
      if (room > 0) { chunks.push(value.subarray(0, room)); total += room; }
      truncated = true;
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { body.set(c, offset); offset += c.byteLength; }
  return { body, truncated };
}

/**
 * Fetch `url` under `policy`. Throws `SafeFetchError` for policy denials,
 * DNS failures, redirect problems, oversize bodies, timeouts, aborts and
 * network errors; HTTP error statuses are returned, not thrown.
 */
export async function safeFetch(url: string | URL, init: SafeFetchInit = {}, policy: EgressPolicy = {}): Promise<SafeFetchResponse> {
  assertTlsVerification();
  const globals = envEgressPolicy();
  const maxBytes = policy.maxBytes ?? globals.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = policy.timeoutMs ?? globals.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const truncate = policy.onLimit === "truncate";
  const checkDns = shouldCheckDns(policy, init, globals);
  const doFetch = init.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") throw new SafeFetchError("network", "fetch is not available in this runtime");

  let current = validateEgressUrl(url, policy, globals);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body ?? undefined;
  const headers = new Headers(init.headers ?? {});
  let hops = 0;
  let addresses: string[] = [];
  const started = Date.now();

  if (init.signal?.aborted) throw new SafeFetchError("aborted", "Request aborted before it started", { url: current.toString() });
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  const onAbort = () => ctrl.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      addresses = checkDns ? await assertResolvable(current, policy, globals) : [];
      const res = await doFetch(current.toString(), { method, headers, body: body as BodyInit | null | undefined, signal: ctrl.signal, redirect: "manual" });
      if (REDIRECT.has(res.status)) {
        const location = res.headers.get("location");
        if (!location) {
          const read = await readBody(res, maxBytes, truncate, current.toString());
          return finish(res, read, current, hops, started, addresses);
        }
        hops++;
        if (hops > maxRedirects) {
          try { await res.body?.cancel(); } catch { /* ignore */ }
          throw new SafeFetchError("too_many_redirects", `More than ${maxRedirects} redirects${describe(policy)}`, { url: current.toString(), hops });
        }
        let next: URL;
        try { next = new URL(location, current); } catch { throw new SafeFetchError("bad_redirect", `Redirect to an invalid location${describe(policy)}`, { url: current.toString(), hops }); }
        next = validateEgressUrl(next, policy, globals);
        try { await res.body?.cancel(); } catch { /* ignore */ }
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
          headers.delete("content-type");
          headers.delete("content-length");
        }
        if (next.origin !== current.origin) {
          headers.delete("authorization");
          headers.delete("cookie");
          headers.delete("proxy-authorization");
        }
        current = next;
        continue;
      }
      const read = await readBody(res, maxBytes, truncate, current.toString());
      return finish(res, read, current, hops, started, addresses);
    }
  } catch (e) {
    if (isSafeFetchError(e)) throw e;
    const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    if (timedOut) throw new SafeFetchError("timeout", `Request timed out after ${timeoutMs} ms${describe(policy)}`, { url: current.toString(), hops, retryable: true, cause: e });
    if (init.signal?.aborted || err?.name === "AbortError") throw new SafeFetchError("aborted", `Request aborted${describe(policy)}`, { url: current.toString(), hops, retryable: false, cause: e });
    const cause = err?.cause?.code ?? err?.cause?.message ?? "";
    throw new SafeFetchError("network", `${err?.message ?? String(e)}${cause ? ` (${cause})` : ""}${describe(policy)}`, { url: current.toString(), hops, retryable: true, cause: e });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

function finish(res: Response, read: { body: Uint8Array; truncated: boolean }, url: URL, hops: number, started: number, addresses: string[]): SafeFetchResponse {
  let text: string | undefined;
  const out: SafeFetchResponse = {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    statusText: res.statusText ?? "",
    headers: res.headers,
    body: read.body,
    bytes: read.body.byteLength,
    truncated: read.truncated,
    finalUrl: url.toString(),
    hops,
    durationMs: Date.now() - started,
    contentType: res.headers.get("content-type") ?? "",
    addresses,
    text() { if (text === undefined) text = new TextDecoder("utf-8", { fatal: false }).decode(read.body); return text; },
    json<T = unknown>() { return JSON.parse(out.text()) as T; },
  };
  return out;
}
