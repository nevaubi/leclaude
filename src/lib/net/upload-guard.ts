import "server-only";

/**
 * Upload validation (CLAUDE.md §41 secure upload validation, malware scan,
 * content-type checks, file-size limits). `validateUpload` is synchronous and
 * works on the file name, the declared MIME type, the size and the first bytes
 * (`head`, ideally ≥ 8 KB). It checks:
 *
 * - size limits and empty files;
 * - path traversal, separators, control characters, reserved names;
 * - the declared type against an allowlist;
 * - magic bytes against the declared type: PDF, OOXML (docx/xlsx/pptx zip
 *   signatures), PNG/JPEG/GIF/WEBP, plain text / CSV / JSON / Markdown / HTML,
 *   EML (RFC 822 headers) and MSG (OLE compound file).
 *
 * `scanUpload` runs the configured `MalwareScanner`. The development scanner
 * is a documented no-op that reports `skipped`; production wires a real engine
 * through `registerMalwareScanner` and sets MALWARE_SCANNER to its name (or
 * `required` to fail closed until one exists).
 */
export type DetectedKind = "pdf" | "docx" | "xlsx" | "pptx" | "ooxml" | "zip" | "ole" | "png" | "jpeg" | "gif" | "webp" | "json" | "csv" | "eml" | "html" | "text" | "binary" | "empty";

export interface SniffResult {
  kind: DetectedKind;
  /** Canonical MIME type for the detected kind, when there is one. */
  mime?: string;
  confidence: "high" | "medium" | "low";
  note?: string;
}

const OOXML_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OOXML_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OOXML_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const KIND_MIME: Partial<Record<DetectedKind, string>> = {
  pdf: "application/pdf",
  docx: OOXML_DOCX,
  xlsx: OOXML_XLSX,
  pptx: OOXML_PPTX,
  zip: "application/zip",
  ole: "application/vnd.ms-outlook",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  json: "application/json",
  csv: "text/csv",
  eml: "message/rfc822",
  html: "text/html",
  text: "text/plain",
};

/** Declared MIME type → detected kinds that are consistent with it. */
export const MIME_KINDS: Record<string, DetectedKind[]> = {
  "application/pdf": ["pdf"],
  [OOXML_DOCX]: ["docx", "ooxml"],
  [OOXML_XLSX]: ["xlsx", "ooxml"],
  [OOXML_PPTX]: ["pptx", "ooxml"],
  "application/msword": ["ole"],
  "application/vnd.ms-excel": ["ole", "csv", "text"],
  "application/vnd.ms-powerpoint": ["ole"],
  "application/vnd.ms-outlook": ["ole"],
  "message/rfc822": ["eml", "text"],
  "image/png": ["png"],
  "image/jpeg": ["jpeg"],
  "image/jpg": ["jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "text/plain": ["text", "csv", "json", "eml", "html"],
  "text/markdown": ["text", "html"],
  "text/csv": ["csv", "text"],
  "text/tab-separated-values": ["csv", "text"],
  "application/json": ["json", "text"],
  "text/html": ["html", "text"],
};

/** File extension → the kinds it implies (used when the declared type is missing or generic). */
export const EXTENSION_KINDS: Record<string, DetectedKind[]> = {
  pdf: ["pdf"], docx: ["docx", "ooxml"], xlsx: ["xlsx", "ooxml"], pptx: ["pptx", "ooxml"], doc: ["ole"], xls: ["ole"], ppt: ["ole"], msg: ["ole"],
  eml: ["eml", "text"], png: ["png"], jpg: ["jpeg"], jpeg: ["jpeg"], gif: ["gif"], webp: ["webp"], txt: ["text", "csv", "json", "eml", "html"], md: ["text", "html"], markdown: ["text", "html"],
  csv: ["csv", "text"], tsv: ["csv", "text"], json: ["json", "text"], html: ["html", "text"], htm: ["html", "text"],
};

export const DEFAULT_ALLOWED_MIMES = Object.keys(MIME_KINDS);
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-www-form-urlencoded", "application/unknown"]);

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < Math.min(bytes.length, start + len); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function looksText(head: Uint8Array): boolean {
  if (!head.length) return false;
  let control = 0;
  for (let i = 0; i < head.length; i++) {
    const b = head[i];
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) control++;
  }
  return control / head.length < 0.01;
}

function validUtf8(head: Uint8Array): boolean {
  const cut = head.length > 3 ? head.subarray(0, head.length - 3) : head;
  try { new TextDecoder("utf-8", { fatal: true }).decode(cut); return true; } catch { return false; }
}

const HEADER_LINE = /^[A-Za-z][A-Za-z0-9-]{1,40}:\s?\S/;

/** Identify the content by its first bytes (and a name hint for text subtypes). */
export function sniffType(head: Uint8Array, hint: { name?: string; mime?: string } = {}): SniffResult {
  if (!head.length) return { kind: "empty", confidence: "high" };
  const first1k = ascii(head, 0, 1024);
  if (first1k.includes("%PDF-")) return { kind: "pdf", mime: KIND_MIME.pdf, confidence: "high" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "png", mime: KIND_MIME.png, confidence: "high" };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: "jpeg", mime: KIND_MIME.jpeg, confidence: "high" };
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return { kind: "gif", mime: KIND_MIME.gif, confidence: "high" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return { kind: "webp", mime: KIND_MIME.webp, confidence: "high" };
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { kind: "ole", mime: KIND_MIME.ole, confidence: "high", note: "OLE compound file (Outlook .msg or legacy Office)" };
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]) || startsWith(head, [0x50, 0x4b, 0x07, 0x08])) {
    const names = ascii(head, 0, head.length);
    const ooxml = names.includes("[Content_Types].xml") || names.includes("_rels/.rels") || names.includes("docProps/");
    if (names.includes("word/")) return { kind: "docx", mime: KIND_MIME.docx, confidence: "medium" };
    if (names.includes("xl/")) return { kind: "xlsx", mime: KIND_MIME.xlsx, confidence: "medium" };
    if (names.includes("ppt/")) return { kind: "pptx", mime: KIND_MIME.pptx, confidence: "medium" };
    if (ooxml) return { kind: "ooxml", confidence: "medium", note: "Office Open XML container; the part type is beyond the sampled bytes" };
    return { kind: "zip", mime: KIND_MIME.zip, confidence: "medium" };
  }
  if (!looksText(head)) return { kind: "binary", confidence: "medium" };
  const utf8 = validUtf8(head);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
  const trimmed = text.replace(/^﻿/, "").trimStart();
  const ext = extensionOf(hint.name ?? "");
  const lines = trimmed.split(/\r?\n/, 25);
  const headerLines = lines.filter((l) => HEADER_LINE.test(l) || l.startsWith("From ")).length;
  const firstIsHeader = HEADER_LINE.test(lines[0] ?? "") || (lines[0] ?? "").startsWith("From ");
  if (firstIsHeader && (headerLines >= 3 || (ext === "eml" && headerLines >= 2))) return { kind: "eml", mime: KIND_MIME.eml, confidence: headerLines >= 3 ? "high" : "medium" };
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && (ext === "json" || hint.mime === "application/json" || /^[{[][\s\S]{0,200}["}\]]/.test(trimmed))) return { kind: "json", mime: KIND_MIME.json, confidence: ext === "json" ? "high" : "medium" };
  if (/^\s*<(!doctype html|html|head|body|div|p|meta|title)\b/i.test(trimmed)) return { kind: "html", mime: KIND_MIME.html, confidence: "medium" };
  if (ext === "csv" || ext === "tsv" || hint.mime === "text/csv") return { kind: "csv", mime: KIND_MIME.csv, confidence: "medium", note: utf8 ? undefined : "not valid UTF-8" };
  const seps = [",", ";", "\t"];
  const count = (l: string, sep: string) => l.split(sep).length - 1;
  if (lines.length >= 2 && seps.some((sep) => count(lines[0], sep) > 0 && count(lines[0], sep) === count(lines[1], sep))) return { kind: "csv", mime: KIND_MIME.csv, confidence: "low" };
  return { kind: "text", mime: KIND_MIME.text, confidence: utf8 ? "medium" : "low", note: utf8 ? undefined : "not valid UTF-8" };
}

export function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return m ? m[1] : "";
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * A safe basename for storage: no directories, no traversal, no control
 * characters, bounded length. Returns null when nothing usable remains.
 */
export function safeFileName(name: string, max = 180): string | null {
  let s = (name ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]+/g, "_").trim();
  s = s.replace(/^\.+/, "").replace(/[. ]+$/, "").replace(/\s+/g, " ");
  if (!s || s === "." || s === "..") return null;
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  if (s.length > max) {
    const ext = extensionOf(s);
    const base = ext ? s.slice(0, s.length - ext.length - 1) : s;
    s = ext ? `${base.slice(0, Math.max(1, max - ext.length - 1))}.${ext}` : base.slice(0, max);
  }
  return s;
}

export type UploadRejectCode = "empty" | "too_large" | "bad_name" | "path_traversal" | "mime_not_allowed" | "type_mismatch" | "unknown_type" | "malware" | "scan_failed";

export interface UploadInput {
  name: string;
  /** Declared by the client; untrusted. */
  mime?: string | null;
  size: number;
  /** First bytes of the file (≥ 8 KB recommended, more for OOXML part detection). */
  head: Uint8Array;
}

export interface UploadPolicy {
  maxBytes?: number;
  /** Declared MIME types accepted (default: every type in MIME_KINDS). */
  allowedMimes?: string[];
  /** Detected kinds accepted regardless of the declared type (narrows further when set). */
  allowedKinds?: DetectedKind[];
  allowEmpty?: boolean;
}

export interface UploadAccepted {
  ok: true;
  /** Sanitized basename for storage. */
  safeName: string;
  extension: string;
  /** The type to store: the detected canonical MIME when known, else the declared one. */
  mime: string;
  detected: SniffResult;
}

export interface UploadRejected {
  ok: false;
  code: UploadRejectCode;
  message: string;
  detected?: SniffResult;
}

export type UploadVerdict = UploadAccepted | UploadRejected;

function envMaxBytes(): number {
  const n = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
}

/** Synchronous checks on name, size, declared type and magic bytes. Never throws. */
export function validateUpload(input: UploadInput, policy: UploadPolicy = {}): UploadVerdict {
  const maxBytes = policy.maxBytes ?? envMaxBytes();
  const rawName = input.name ?? "";
  if (/[\\/]/.test(rawName) || rawName.split(/[\\/]/).some((seg) => seg === "..") || rawName.includes("\0")) return { ok: false, code: "path_traversal", message: "File names may not contain directory separators or traversal segments" };
  const safeName = safeFileName(rawName);
  if (!safeName) return { ok: false, code: "bad_name", message: "File name is empty or not usable" };
  if (!Number.isFinite(input.size) || input.size < 0) return { ok: false, code: "bad_name", message: "File size is not a number" };
  if (input.size === 0 || !input.head?.length) { if (policy.allowEmpty) return { ok: true, safeName, extension: extensionOf(safeName), mime: (input.mime ?? "").toLowerCase() || "application/octet-stream", detected: { kind: "empty", confidence: "high" } }; return { ok: false, code: "empty", message: "File is empty" }; }
  if (input.size > maxBytes) return { ok: false, code: "too_large", message: `File is ${input.size} bytes; the limit is ${maxBytes} bytes` };
  const declared = (input.mime ?? "").split(";")[0].trim().toLowerCase();
  const extension = extensionOf(safeName);
  const detected = sniffType(input.head, { name: safeName, mime: declared });
  const allowedMimes = (policy.allowedMimes ?? DEFAULT_ALLOWED_MIMES).map((m) => m.toLowerCase());
  const generic = GENERIC_MIMES.has(declared);
  let expected: DetectedKind[] | undefined;
  if (!generic) {
    if (!allowedMimes.includes(declared)) return { ok: false, code: "mime_not_allowed", message: `Type ${declared} is not accepted`, detected };
    expected = MIME_KINDS[declared];
    if (!expected) return { ok: false, code: "mime_not_allowed", message: `Type ${declared} is not recognized`, detected };
  } else {
    expected = EXTENSION_KINDS[extension];
    if (!expected) return { ok: false, code: "unknown_type", message: `No usable type: declared ${declared || "nothing"} and the extension .${extension || "?"} is not recognized`, detected };
    const impliedMime = KIND_MIME[expected[0]];
    if (impliedMime && !allowedMimes.includes(impliedMime)) return { ok: false, code: "mime_not_allowed", message: `Type ${impliedMime} (from .${extension}) is not accepted`, detected };
  }
  if (detected.kind === "binary" || detected.kind === "empty") return { ok: false, code: "type_mismatch", message: `Content does not look like ${expected.join("/")} (unrecognized binary data)`, detected };
  if (!expected.includes(detected.kind)) return { ok: false, code: "type_mismatch", message: `Declared ${generic ? `.${extension}` : declared} but the content looks like ${detected.kind}${detected.note ? ` (${detected.note})` : ""}`, detected };
  if (policy.allowedKinds?.length && !policy.allowedKinds.includes(detected.kind)) return { ok: false, code: "mime_not_allowed", message: `${detected.kind} uploads are not accepted here`, detected };
  const mime = detected.mime ?? (generic ? KIND_MIME[expected[0]] ?? "application/octet-stream" : declared);
  return { ok: true, safeName, extension, mime, detected };
}

// ---------------------------------------------------------------------------
// Malware scanning
// ---------------------------------------------------------------------------

export interface MalwareScanResult {
  status: "clean" | "infected" | "error" | "skipped";
  engine: string;
  signature?: string;
  detail?: string;
  durationMs: number;
}

export interface MalwareScanner {
  readonly name: string;
  scan(file: { name: string; mime: string; bytes: Uint8Array }): Promise<MalwareScanResult>;
}

/** Development scanner: records that no scan happened. Uploads are accepted with `scan.status = "skipped"`. */
export const noopScanner: MalwareScanner = {
  name: "none",
  async scan() { return { status: "skipped", engine: "none", detail: "No malware scanner configured (MALWARE_SCANNER)", durationMs: 0 }; },
};

/** Fail-closed scanner for deployments that require scanning but have no engine wired yet. */
export const failClosedScanner: MalwareScanner = {
  name: "required",
  async scan() { return { status: "error", engine: "required", detail: "MALWARE_SCANNER=required but no scanner adapter is registered", durationMs: 0 }; },
};

type ScannerFactory = () => MalwareScanner;
type G = typeof globalThis & { __leclaudeMalwareScanners?: Map<string, ScannerFactory> };

/**
 * Adapter point for a production engine (ClamAV over TCP/unix socket, an AWS
 * GuardDuty Malware Protection for S3 result poller, a vendor API). Register
 * the factory at boot and set MALWARE_SCANNER=<name>.
 */
export function registerMalwareScanner(name: string, factory: ScannerFactory): void {
  const g = globalThis as G;
  if (!g.__leclaudeMalwareScanners) g.__leclaudeMalwareScanners = new Map();
  g.__leclaudeMalwareScanners.set(name.toLowerCase(), factory);
}

/** The scanner selected by MALWARE_SCANNER: unset/"none" → no-op (dev), "required" → fail closed, otherwise a registered adapter (or fail closed when missing). */
export function malwareScanner(env: NodeJS.ProcessEnv = process.env): MalwareScanner {
  const name = (env.MALWARE_SCANNER ?? "none").trim().toLowerCase();
  if (!name || name === "none" || name === "off") return noopScanner;
  if (name === "required") return failClosedScanner;
  const factory = (globalThis as G).__leclaudeMalwareScanners?.get(name);
  return factory ? factory() : failClosedScanner;
}

/** Validate, then scan the full bytes. An `infected` or `error` result rejects the upload. */
export async function scanUpload(input: UploadInput & { bytes: Uint8Array }, policy: UploadPolicy & { scanner?: MalwareScanner } = {}): Promise<(UploadAccepted & { scan: MalwareScanResult }) | UploadRejected> {
  const verdict = validateUpload({ ...input, head: input.head?.length ? input.head : input.bytes.subarray(0, 16_384) }, policy);
  if (!verdict.ok) return verdict;
  const scanner = policy.scanner ?? malwareScanner();
  const started = Date.now();
  let scan: MalwareScanResult;
  try {
    scan = await scanner.scan({ name: verdict.safeName, mime: verdict.mime, bytes: input.bytes });
  } catch (e) {
    scan = { status: "error", engine: scanner.name, detail: (e as Error).message?.slice(0, 200), durationMs: Date.now() - started };
  }
  if (scan.status === "infected") return { ok: false, code: "malware", message: `Malware detected${scan.signature ? ` (${scan.signature})` : ""}`, detected: verdict.detected };
  if (scan.status === "error") return { ok: false, code: "scan_failed", message: `Malware scan failed: ${scan.detail ?? "unknown error"}`, detected: verdict.detected };
  return { ...verdict, scan };
}
