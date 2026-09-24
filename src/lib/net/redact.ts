import "server-only";

/**
 * Log and record hygiene (CLAUDE.md §41 safe logging, §42 no indiscriminate
 * logging of confidential source text).
 *
 * - `redactSecrets` scrubs credentials (API keys, bearer/basic/token
 *   authorization values, AWS keys, JWTs, key=value assignments, query-string
 *   credentials, URL userinfo) from any string that is about to be persisted
 *   in a job record, an audit entry or a console line.
 * - `excerpt` bounds a piece of (possibly confidential) text to a short,
 *   whitespace-collapsed, redacted preview so full source text never lands in
 *   a log.
 * - `sanitizeForLog` applies both to a structured value (log `data` bags).
 */
export const REDACTED = "[REDACTED]";

const SCHEME_WORDS = /^(bearer|token|basic|digest)$/i;
const SECRET_KEY = /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|credential|authorization|private[_-]?key)/i;

type Rule = { re: RegExp; sub: string | ((...args: string[]) => string) };

const RULES: Rule[] = [
  // Credentials embedded in URLs: scheme://user:secret@host
  { re: /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/?#@]+)@/gi, sub: `$1${REDACTED}@` },
  // Authorization header schemes
  { re: /\b(Bearer|Token|Basic|Digest)\s+[A-Za-z0-9._~+/=-]{6,}/g, sub: `$1 ${REDACTED}` },
  // JSON web tokens
  { re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, sub: REDACTED },
  // OpenAI / Anthropic style keys
  { re: /\bsk-(?:proj-|ant-(?:api\d+-)?|svcacct-)?[A-Za-z0-9_-]{8,}/g, sub: REDACTED },
  // AWS access key ids and secret keys / session tokens
  { re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|ASCA)[0-9A-Z]{16}\b/g, sub: REDACTED },
  { re: /\b(aws_secret_access_key|aws_session_token|x-amz-security-token)(\s*[=:]\s*["']?)([A-Za-z0-9/+=]{16,})/gi, sub: `$1$2${REDACTED}` },
  // Google, GitHub, Slack, Firecrawl, Tavily
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, sub: REDACTED },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, sub: REDACTED },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, sub: REDACTED },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, sub: REDACTED },
  { re: /\b(?:fc|tvly)-[A-Za-z0-9_-]{16,}\b/g, sub: REDACTED },
  // Query-string credentials
  { re: /([?&](?:api[_-]?key|apikey|key|token|access_token|refresh_token|id_token|secret|client_secret|password|passwd|pwd|sig|signature|auth|authorization|x-amz-signature|x-amz-credential)=)[^&\s"'<>]+/gi, sub: `$1${REDACTED}` },
  // key=value / "key": "value" assignments (env files, JSON, headers)
  {
    re: /\b([A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|credential|authorization|private[_-]?key)[A-Za-z0-9_.-]*)("?)(\s*[=:]\s*)("?)([^\s"'&,;]{4,})/gi,
    sub: (m, key: string, q1: string, sep: string, q2: string, value: string) => {
      if (/^-?\d+(?:\.\d+)?$/.test(value) || /^(true|false|null|undefined)$/i.test(value)) return m;
      if (SCHEME_WORDS.test(value) || value === REDACTED) return m;
      return `${key}${q1}${sep}${q2}${REDACTED}`;
    },
  },
];

/** Scrub credentials from a string destined for a log, a job record or an error message. */
export function redactSecrets(text: string | undefined | null): string {
  if (!text) return "";
  let out = String(text);
  for (const rule of RULES) out = out.replace(rule.re, rule.sub as string);
  return out;
}

/** True when a key name looks like it holds a credential. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/**
 * Bounded, whitespace-collapsed, redacted preview of a text. Use it whenever
 * confidential source text (documents, transcripts, page bodies) must appear in
 * a log line or a diagnostic record; never log the full text.
 */
export function excerpt(text: string | undefined | null, max = 240): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const cut = s.length > max ? `${s.slice(0, max).trimEnd()}… [+${s.length - max} chars]` : s;
  return redactSecrets(cut);
}

export interface RedactedError { name: string; message: string; code?: string; status?: number; retryable?: boolean }

/** Name + bounded redacted message (+ code/status when present); never the stack, never the cause chain. */
export function redactError(e: unknown, max = 600): RedactedError {
  if (e instanceof Error) {
    const x = e as Error & { code?: unknown; status?: unknown; retryable?: unknown };
    return {
      name: e.name || "Error",
      message: excerpt(e.message, max),
      code: typeof x.code === "string" ? x.code : undefined,
      status: typeof x.status === "number" ? x.status : undefined,
      retryable: typeof x.retryable === "boolean" ? x.retryable : undefined,
    };
  }
  if (e && typeof e === "object") {
    const x = e as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
    return { name: typeof x.name === "string" ? x.name : "Error", message: excerpt(typeof x.message === "string" ? x.message : safeLogValue(e), max), code: typeof x.code === "string" ? x.code : undefined, status: typeof x.status === "number" ? x.status : undefined };
  }
  return { name: "Error", message: excerpt(String(e), max) };
}

/** One bounded, redacted string for any value (for console lines and trace attributes). */
export function safeLogValue(value: unknown, max = 600): string {
  if (value == null) return String(value);
  if (typeof value === "string") return excerpt(value, max);
  if (value instanceof Error) return excerpt(`${value.name}: ${value.message}`, max);
  try {
    const json = JSON.stringify(sanitizeForLog(value));
    return excerpt(json ?? String(value), max);
  } catch {
    return excerpt(String(value), max);
  }
}

export interface SanitizeOptions { maxString?: number; maxItems?: number; maxKeys?: number; maxDepth?: number }

/**
 * Structured equivalent of `excerpt`: bounded strings, bounded arrays and
 * objects, secret-looking keys replaced wholesale. Returns plain JSON data.
 */
export function sanitizeForLog(value: unknown, opts: SanitizeOptions = {}, depth = 0): unknown {
  const maxString = opts.maxString ?? 200;
  const maxItems = opts.maxItems ?? 20;
  const maxKeys = opts.maxKeys ?? 40;
  const maxDepth = opts.maxDepth ?? 4;
  if (value == null) return value;
  if (typeof value === "string") return excerpt(value, maxString);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value, maxString);
  if (depth >= maxDepth) return Array.isArray(value) ? `[array ${value.length}]` : "[object]";
  if (Array.isArray(value)) {
    const out = value.slice(0, maxItems).map((v) => sanitizeForLog(v, opts, depth + 1));
    if (value.length > maxItems) out.push(`… [+${value.length - maxItems} items]`);
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, maxKeys)) out[k] = isSecretKey(k) && v != null && v !== "" ? REDACTED : sanitizeForLog(v, opts, depth + 1);
    if (entries.length > maxKeys) out.__truncatedKeys = entries.length - maxKeys;
    return out;
  }
  return excerpt(String(value), maxString);
}
