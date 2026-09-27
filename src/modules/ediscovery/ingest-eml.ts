/**
 * Minimal RFC 822 / MIME reader for e-discovery ingest (pure, no server imports).
 *
 * Returns the envelope headers reviewers code on (From, To, Cc, Date, Subject, Message-ID) and the best plain-text
 * body: the first text/plain part, else a text/html part reduced to text. Handles folded headers, RFC 2047 encoded
 * words, multipart (nested) bodies and quoted-printable / base64 transfer encodings. Attachments are listed by name
 * and type only; they are not extracted as separate documents.
 */
export interface ParsedEmail {
  from?: string;
  to: string[];
  cc: string[];
  subject?: string;
  /** ISO YYYY-MM-DD from the Date header, when it parses. */
  date?: string;
  messageId?: string;
  text: string;
  attachments: { name: string; mime: string }[];
}

type Headers = Map<string, string>;

function splitHeadBody(raw: string): { head: string; body: string } {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index == null) return { head: raw, body: "" };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

function parseHeaders(head: string): Headers {
  const out: Headers = new Map();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!out.has(k)) out.set(k, line.slice(i + 1).trim());
  }
  return out;
}

function decodeBytesAsText(bytes: Uint8Array, charset = "utf-8"): string {
  try { return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes); } catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
}

function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(clean, "base64"));
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function qpToBytes(s: string, header = false): Uint8Array {
  const src = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { bytes.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; continue; }
    const code = src.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else for (const b of new TextEncoder().encode(ch)) bytes.push(b);
  }
  return new Uint8Array(bytes);
}

/** Decode RFC 2047 encoded words (=?utf-8?Q?...?= / =?utf-8?B?...?=). */
export function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, charset: string, enc: string, text: string) => decodeBytesAsText(enc.toUpperCase() === "B" ? base64ToBytes(text) : qpToBytes(text, true), charset));
}

function param(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  const m = value.match(new RegExp(`${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  return m ? (m[1] ?? m[2]) : undefined;
}

function decodeBody(body: string, headers: Headers): string {
  const enc = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const charset = param(headers.get("content-type"), "charset") ?? "utf-8";
  if (enc === "base64") return decodeBytesAsText(base64ToBytes(body), charset);
  if (enc === "quoted-printable") return decodeBytesAsText(qpToBytes(body), charset);
  return body;
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

interface Part { headers: Headers; body: string }

function walk(part: Part, out: { plain?: string; html?: string; attachments: { name: string; mime: string }[] }, depth = 0) {
  const ct = (part.headers.get("content-type") ?? "text/plain").toLowerCase();
  const disposition = part.headers.get("content-disposition") ?? "";
  const name = param(disposition, "filename") ?? param(part.headers.get("content-type"), "name");
  if (ct.startsWith("multipart/") && depth < 8) {
    const boundary = param(part.headers.get("content-type"), "boundary");
    if (!boundary) return;
    const chunks = part.body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    for (const chunk of chunks.slice(1)) {
      if (!chunk.trim()) continue;
      const { head, body } = splitHeadBody(chunk);
      walk({ headers: parseHeaders(head), body }, out, depth + 1);
    }
    return;
  }
  if (name || /attachment/i.test(disposition)) { out.attachments.push({ name: decodeEncodedWords(name ?? "attachment"), mime: ct.split(";")[0].trim() }); return; }
  if (ct.startsWith("text/plain") && out.plain == null) out.plain = decodeBody(part.body, part.headers);
  else if (ct.startsWith("text/html") && out.html == null) out.html = decodeBody(part.body, part.headers);
}

function addresses(value: string | undefined): string[] {
  if (!value) return [];
  const decoded = decodeEncodedWords(value);
  // Split on commas that are not inside quotes or angle brackets.
  const parts: string[] = [];
  let cur = "", quoted = false, angle = false;
  for (const ch of decoded) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    if ((ch === "," || ch === ";") && !quoted && !angle) { if (cur.trim()) parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map(displayName).filter(Boolean);
}

/** "Jane Doe" <jane@x.com> → Jane Doe; bare addresses stay as the address. */
function displayName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return m[1].trim() || m[2].trim();
  return addr.replace(/[<>]/g, "").trim();
}

/** Date header → ISO date (YYYY-MM-DD, UTC), or undefined when it does not parse. */
export function emailDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value.replace(/\s*\([^)]*\)\s*$/, ""));
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

export function parseEmail(raw: string): ParsedEmail {
  const { head, body } = splitHeadBody(raw.replace(/^﻿/, ""));
  const headers = parseHeaders(head);
  const out: { plain?: string; html?: string; attachments: { name: string; mime: string }[] } = { attachments: [] };
  walk({ headers, body }, out);
  const text = (out.plain ?? (out.html ? htmlToPlain(out.html) : "")).replace(/\r\n/g, "\n").trim();
  const from = addresses(headers.get("from"))[0];
  return {
    from,
    to: addresses(headers.get("to")),
    cc: addresses(headers.get("cc")),
    subject: headers.has("subject") ? decodeEncodedWords(headers.get("subject")!).trim() : undefined,
    date: emailDate(headers.get("date")),
    messageId: headers.get("message-id")?.replace(/[<>]/g, "").trim() || undefined,
    text,
    attachments: out.attachments,
  };
}
