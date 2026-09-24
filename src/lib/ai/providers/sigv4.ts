/**
 * AWS Signature Version 4 (pure, node:crypto only). Used to sign Bedrock runtime requests (service "bedrock")
 * with static or temporary credentials. Reference: AWS General Reference, "Signature Version 4 signing process".
 */
import { createHash, createHmac } from "node:crypto";

export interface SigV4Credentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

export interface SigV4Request {
  method: string;
  /** Request path as it will be sent (already percent-encoded once, e.g. `/model/anthropic.claude%3A0/invoke`). */
  path: string;
  /** Query string parameters (unencoded). */
  query?: Record<string, string>;
  /** Headers to send; `host` is required. Header names are case-insensitive. */
  headers: Record<string, string>;
  body: string | Uint8Array;
}

export interface SigV4Options {
  region: string;
  service: string;
  credentials: SigV4Credentials;
  /** ISO basic timestamp `YYYYMMDDTHHMMSSZ`; defaults to now. */
  date?: string;
  /** Double-encode path segments (every service except S3). */
  doubleEncodePath?: boolean;
}

export interface SigV4Result {
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  signedHeaders: string;
  /** Headers to send: the input headers plus x-amz-date, x-amz-security-token (when set) and authorization. */
  headers: Record<string, string>;
  amzDate: string;
  scope: string;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 percent-encoding (unreserved: A-Z a-z 0-9 - _ . ~). */
export function rfc3986Encode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function amzDateNow(d = new Date()): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalUri(path: string, doubleEncode: boolean): string {
  const p = path || "/";
  if (!doubleEncode) return p;
  return p.split("/").map((seg) => rfc3986Encode(seg)).join("/");
}

function canonicalQuery(query: Record<string, string> | undefined): string {
  if (!query) return "";
  return Object.entries(query)
    .map(([k, v]) => [rfc3986Encode(k), rfc3986Encode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Sign a request. Pure: the same inputs and date always produce the same signature. */
export function signV4(req: SigV4Request, opts: SigV4Options): SigV4Result {
  const amzDate = opts.date ?? amzDateNow();
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
  headers["x-amz-date"] = amzDate;
  if (opts.credentials.sessionToken) headers["x-amz-security-token"] = opts.credentials.sessionToken;
  if (!headers.host) throw new Error("SigV4: a host header is required");

  const names = Object.keys(headers).filter((n) => n !== "authorization").sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const payloadHash = headers["x-amz-content-sha256"] && headers["x-amz-content-sha256"] !== "UNSIGNED-PAYLOAD" ? headers["x-amz-content-sha256"] : sha256Hex(req.body);

  const canonicalRequest = [req.method.toUpperCase(), canonicalUri(req.path, opts.doubleEncodePath ?? true), canonicalQuery(req.query), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${opts.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { canonicalRequest, stringToSign, signature, signedHeaders, headers, amzDate, scope };
}
