import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { indexDocuments } from "@/lib/ai/vector-store";
import { VECTOR_COLLECTIONS } from "@/lib/ai/toolkit/internal";
import { currentPrincipal } from "@/lib/auth/context";
import { audit } from "@/lib/integrity/audit";
import { contentHash, sha256 } from "@/lib/integrity/hash";
import { scanUpload, type DetectedKind, type UploadPolicy, type MalwareScanner } from "@/lib/net/upload-guard";
import { extractTextFromBytes } from "@/modules/workflows/extract-text";
import type { DocType, EDocument, Matter, Person } from "@/lib/types/domain";
import { createDocument, matterRetrievalScope } from "./service";
import { indexTextFor } from "./privilege";
import { formatBates, parseBates } from "./query";
import { parseEmail } from "./ingest-eml";
import { matterPeople } from "./analysis/service";
import { normalizeName } from "./analysis/graph";

/**
 * File ingest for e-discovery (constitution §20 file/evidence architecture, §27 pipeline, §41 upload validation):
 *
 *   upload → validate (size, name, magic bytes vs declared type) → malware scan → sha256 → dedupe by file hash in
 *   the matter → store original bytes (blob, with hash/size/mime/matter) → extract text (PDF text layer, DOCX, plain
 *   text, RFC 822 email; images and scanned PDFs are stored and flagged for OCR) → EDocument with a Bates number from
 *   the matter's prefix/counter → keyword index scoped to the matter.
 *
 * Every file gets an explicit result (created / duplicate / rejected with a reason); nothing is substituted.
 */
export const INGEST_VERSION = "ediscovery-ingest-1";
export const INGEST_MAX_FILES = 50;
export const INGEST_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const INGEST_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** Detected content kinds accepted for review documents. */
export const INGEST_KINDS: DetectedKind[] = ["pdf", "docx", "ooxml", "text", "csv", "html", "eml", "png", "jpeg", "gif", "webp"];
const IMAGE_KINDS = new Set<DetectedKind>(["png", "jpeg", "gif", "webp"]);
const MAX_TEXT_CHARS = 400_000;

export interface EDiscoverySettings {
  /** Bates prefix, 2–8 letters (A–Z). */
  batesPrefix: string;
  /** Digits in the number part. */
  batesWidth: number;
  /** Next number to assign (always ≥ the highest number in the matter + 1). */
  nextBates: number;
}

export interface OriginalFile {
  blobId: string;
  sha256: string;
  size: number;
  mime: string;
  name: string;
  kind: DetectedKind;
  extraction: { method: string; version: string; status: "extracted" | "needs_ocr" | "empty"; pages?: number; truncated?: boolean; note?: string };
  dateSource: "email-header" | "pdf-metadata" | "docx-metadata" | "file-modified" | "ingested";
  scan: { status: string; engine: string };
  uploadedBy: string;
  uploadedAt: string;
}

/** An EDocument created from an uploaded file carries its original-file record. */
export type IngestedDocument = EDocument & { original?: OriginalFile };

export interface IngestFile {
  name: string;
  /** Declared by the client; untrusted. */
  mime?: string | null;
  bytes: Uint8Array;
  /** Client-reported last-modified time (ms since epoch); used only when the file carries no date of its own. */
  lastModified?: number;
}

export interface IngestOptions {
  matterId: string;
  /** Free-text custodian; resolved to one of the matter's people by exact name, or created. */
  custodian?: string;
  /** Overrides (and saves) the matter's Bates prefix. */
  batesPrefix?: string;
  source?: string;
  /** Test seam for the malware scanner. */
  scanner?: MalwareScanner;
  /** Index the created documents for search (default true). */
  index?: boolean;
}

export type IngestFileResult =
  | { name: string; status: "created"; docId: string; bates: string; batesEnd?: string; pages: number; type: DocType; textStatus: OriginalFile["extraction"]["status"]; sha256: string; duplicateTextOf?: string }
  | { name: string; status: "duplicate"; sha256: string; existingId: string; existingBates: string }
  | { name: string; status: "rejected"; code: string; reason: string };

export interface IngestResult {
  matterId: string;
  results: IngestFileResult[];
  created: number;
  duplicates: number;
  rejected: number;
  indexed: number;
  settings: EDiscoverySettings;
}

// ---------------------------------------------------------------------------
// Settings (per matter): Bates prefix and counter
// ---------------------------------------------------------------------------

const SETTINGS_KEY = (matterId: string) => `ediscovery:settings:${matterId}`;
const STOP = new Set(["v", "vs", "in", "re", "the", "of", "and", "for", "a", "an", "llc", "inc", "corp", "co", "ltd", "lp", "llp", "et", "al"]);

/** Default Bates prefix: the letter code of the matter number ("ACME-0012" → ACME) when it has one, else initials of the short name (or name), 2–4 letters. */
export function defaultBatesPrefix(matter: (Pick<Matter, "name" | "shortName"> & { number?: string }) | null | undefined): string {
  const fromNumber = matter?.number?.trim().match(/^([A-Za-z]{2,8})(?:[-_ .\d]|$)/)?.[1];
  if (fromNumber) return fromNumber.toUpperCase();
  const src = `${matter?.shortName || matter?.name || ""}`;
  const words = src.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  let p = words.map((w) => w[0]).join("").toUpperCase().slice(0, 4);
  if (p.length < 2) p = (words[0] ?? "").toUpperCase().slice(0, 3);
  return /^[A-Z]{2,8}$/.test(p) ? p : "DOC";
}

export function normalizeBatesPrefix(raw: string): string | null {
  const p = raw.trim().toUpperCase().replace(/[-_\s]+$/, "");
  return /^[A-Z]{2,8}$/.test(p) ? p : null;
}

/** Highest Bates number under `prefix` among the matter's documents (begin and end numbers). */
function maxBatesNumber(matterId: string, prefix: string): number {
  let max = 0;
  for (const d of db().edocs.find((x) => x.matterId === matterId)) {
    for (const b of [d.bates, d.batesEnd]) {
      const p = b ? parseBates(b) : null;
      if (p && p.prefix === prefix && p.number > max) max = p.number;
    }
  }
  return max;
}

export function getEDiscoverySettings(matterId: string): EDiscoverySettings {
  const stored = db().kv.get<Partial<EDiscoverySettings>>(SETTINGS_KEY(matterId)) ?? {};
  const batesPrefix = (stored.batesPrefix && normalizeBatesPrefix(stored.batesPrefix)) || defaultBatesPrefix(db().matters.get(matterId) as (Matter & { number?: string }) | null);
  const batesWidth = Number.isInteger(stored.batesWidth) && stored.batesWidth! >= 4 && stored.batesWidth! <= 10 ? stored.batesWidth! : 7;
  const nextBates = Math.max(Number.isInteger(stored.nextBates) && stored.nextBates! > 0 ? stored.nextBates! : 1, maxBatesNumber(matterId, batesPrefix) + 1);
  return { batesPrefix, batesWidth, nextBates };
}

export function updateEDiscoverySettings(matterId: string, patch: Partial<Pick<EDiscoverySettings, "batesPrefix" | "batesWidth" | "nextBates">>): EDiscoverySettings {
  const cur = getEDiscoverySettings(matterId);
  const next: Partial<EDiscoverySettings> = { ...cur };
  if (patch.batesPrefix != null) {
    const p = normalizeBatesPrefix(patch.batesPrefix);
    if (!p) throw Object.assign(new Error("Bates prefix must be 2–8 letters (A–Z)"), { status: 400 });
    next.batesPrefix = p;
    next.nextBates = undefined; // recomputed for the new prefix
  }
  if (patch.batesWidth != null) {
    if (!Number.isInteger(patch.batesWidth) || patch.batesWidth < 4 || patch.batesWidth > 10) throw Object.assign(new Error("Bates width must be 4–10 digits"), { status: 400 });
    next.batesWidth = patch.batesWidth;
  }
  if (patch.nextBates != null) {
    if (!Number.isInteger(patch.nextBates) || patch.nextBates < 1) throw Object.assign(new Error("The next Bates number must be a positive integer"), { status: 400 });
    next.nextBates = patch.nextBates;
  }
  db().kv.set(SETTINGS_KEY(matterId), next);
  if (patch.batesPrefix != null && patch.batesPrefix !== cur.batesPrefix) audit("settings.change", { kind: "ediscovery.settings", matterId, label: "Bates numbering" }, { from: cur.batesPrefix, to: next.batesPrefix });
  return getEDiscoverySettings(matterId);
}

/** Reserve `pages` consecutive Bates numbers (synchronous: no await between read and write). */
function allocateBates(matterId: string, pages: number): { bates: string; batesEnd?: string } {
  const s = getEDiscoverySettings(matterId);
  const start = s.nextBates;
  const end = start + Math.max(1, pages) - 1;
  db().kv.set(SETTINGS_KEY(matterId), { batesPrefix: s.batesPrefix, batesWidth: s.batesWidth, nextBates: end + 1 });
  return { bates: formatBates(s.batesPrefix, start, s.batesWidth), batesEnd: end > start ? formatBates(s.batesPrefix, end, s.batesWidth) : undefined };
}

// ---------------------------------------------------------------------------
// Custodians
// ---------------------------------------------------------------------------

const UNASSIGNED = { id: "unassigned", name: "Unassigned" };

/** Resolve a free-text custodian to one of the matter's people by exact name; create the person when absent. */
export function resolveCustodian(matterId: string, raw: string | undefined): { id: string; name: string; created: boolean } {
  const name = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { ...UNASSIGNED, created: false };
  const n = normalizeName(name);
  const hit = matterPeople(matterId).find((p) => normalizeName(p.name) === n);
  if (hit) return { id: hit.id, name: hit.name, created: false };
  const person: Person = { id: `p_${nanoid(10)}`, name, role: "custodian" };
  db().people.put(person);
  audit("create", { kind: "person", id: person.id, label: name, matterId }, { role: "custodian", via: "ediscovery ingest" });
  return { id: person.id, name, created: true };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface Extracted {
  text: string;
  pages: number;
  type: DocType;
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  date?: string;
  dateSource?: OriginalFile["dateSource"];
  extraction: OriginalFile["extraction"];
}

function baseName(name: string) {
  return name.replace(/\.[A-Za-z0-9]{1,10}$/, "").replace(/[_]+/g, " ").trim() || name;
}

function isoDay(d: Date | undefined | null): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  const y = d.getUTCFullYear();
  if (y < 1950 || y > new Date().getUTCFullYear() + 1) return undefined;
  return d.toISOString().slice(0, 10);
}

async function pdfMetadata(bytes: Uint8Array): Promise<{ title?: string; date?: string; pages?: number }> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { title: pdf.getTitle()?.trim() || undefined, date: isoDay(pdf.getCreationDate() ?? pdf.getModificationDate()), pages: pdf.getPageCount() };
  } catch {
    return {};
  }
}

async function docxMetadata(bytes: Uint8Array): Promise<{ title?: string; date?: string }> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const core = await zip.file("docProps/core.xml")?.async("string");
    if (!core) return {};
    const title = core.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1]?.trim();
    const created = core.match(/<dcterms:created[^>]*>([^<]+)<\/dcterms:created>/)?.[1];
    return { title: title || undefined, date: created ? isoDay(new Date(created)) : undefined };
  } catch {
    return {};
  }
}

async function extract(bytes: Uint8Array, name: string, mime: string, kind: DetectedKind): Promise<Extracted> {
  if (IMAGE_KINDS.has(kind)) {
    return { text: "", pages: 1, type: "Image", subject: baseName(name), extraction: { method: "none", version: INGEST_VERSION, status: "needs_ocr", note: "Image stored without text; run OCR before relying on search." } };
  }
  if (kind === "eml") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const e = parseEmail(raw);
    const attachments = e.attachments.length ? `\n\n[Attachments not extracted: ${e.attachments.map((a) => a.name).join(", ")}]` : "";
    return {
      text: (e.text + attachments).trim(), pages: 1, type: "Email", subject: e.subject || baseName(name), from: e.from, to: e.to, cc: e.cc, date: e.date, dateSource: e.date ? "email-header" : undefined,
      extraction: { method: "rfc822", version: INGEST_VERSION, status: e.text.trim() ? "extracted" : "empty" },
    };
  }
  if (kind === "pdf") {
    const meta = await pdfMetadata(bytes);
    try {
      const r = await extractTextFromBytes(bytes, name, "application/pdf");
      return { text: r.text, pages: r.pages ?? meta.pages ?? 1, type: "Other", subject: meta.title || baseName(name), date: meta.date, dateSource: meta.date ? "pdf-metadata" : undefined, extraction: { method: r.method, version: INGEST_VERSION, status: "extracted", pages: r.pages, truncated: r.truncated } };
    } catch {
      // No text layer (scanned) or unreadable text: keep the original, mark for OCR. Never invent text.
      return { text: "", pages: meta.pages ?? 1, type: "Other", subject: meta.title || baseName(name), date: meta.date, dateSource: meta.date ? "pdf-metadata" : undefined, extraction: { method: "pdfjs", version: INGEST_VERSION, status: "needs_ocr", pages: meta.pages, note: "No text layer found; OCR required." } };
    }
  }
  if (kind === "docx" || kind === "ooxml") {
    const meta = await docxMetadata(bytes);
    // mammoth directly: the shared extractor classifies OOXML MIME types as text (its pattern matches "xml").
    const mammoth = (await import("mammoth")).default;
    const raw = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const text = raw.slice(0, MAX_TEXT_CHARS);
    return { text, pages: 1, type: "Other", subject: meta.title || baseName(name), date: meta.date, dateSource: meta.date ? "docx-metadata" : undefined, extraction: { method: "mammoth", version: INGEST_VERSION, status: text ? "extracted" : "empty", truncated: raw.length > MAX_TEXT_CHARS } };
  }
  // text / markdown / csv / html
  const r = await extractTextFromBytes(bytes, name, kind === "html" ? "text/html" : kind === "csv" ? "text/csv" : mime.startsWith("text/") ? mime : "text/plain");
  return { text: r.text, pages: 1, type: kind === "csv" ? "Spreadsheet" : "Other", subject: baseName(name), extraction: { method: r.method, version: INGEST_VERSION, status: r.text.trim() ? "extracted" : "empty", truncated: r.truncated } };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

function findByFileHash(matterId: string, hash: string): IngestedDocument | null {
  return (db().edocs.findOne((x) => x.matterId === matterId && (x as IngestedDocument).original?.sha256 === hash) as IngestedDocument | null) ?? null;
}

export async function ingestFiles(files: IngestFile[], opts: IngestOptions): Promise<IngestResult> {
  const d = db();
  const matter = d.matters.get(opts.matterId);
  if (!matter) throw Object.assign(new Error(`Unknown matter ${opts.matterId}`), { status: 404 });
  if (!files.length) throw Object.assign(new Error("No files to ingest"), { status: 400 });
  if (files.length > INGEST_MAX_FILES) throw Object.assign(new Error(`At most ${INGEST_MAX_FILES} files per upload`), { status: 413 });
  const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
  if (total > INGEST_MAX_TOTAL_BYTES) throw Object.assign(new Error(`Upload is ${total} bytes; the limit is ${INGEST_MAX_TOTAL_BYTES} bytes per request`), { status: 413 });
  if (opts.batesPrefix && opts.batesPrefix.trim()) {
    const p = normalizeBatesPrefix(opts.batesPrefix);
    if (!p) throw Object.assign(new Error("Bates prefix must be 2–8 letters (A–Z)"), { status: 400 });
    if (p !== getEDiscoverySettings(opts.matterId).batesPrefix) updateEDiscoverySettings(opts.matterId, { batesPrefix: p });
  }
  const principal = currentPrincipal();
  const actor = principal ? { id: principal.id, name: principal.name ?? principal.id } : undefined;
  const policy: UploadPolicy & { scanner?: MalwareScanner } = { maxBytes: INGEST_MAX_FILE_BYTES, allowedKinds: INGEST_KINDS, scanner: opts.scanner };
  const custodian = opts.custodian?.trim() ? resolveCustodian(opts.matterId, opts.custodian) : { ...UNASSIGNED, created: false };
  const results: IngestFileResult[] = [];
  const createdDocs: IngestedDocument[] = [];

  for (const f of files) {
    const name = f.name || "upload";
    const verdict = await scanUpload({ name, mime: f.mime, size: f.bytes.byteLength, head: f.bytes.subarray(0, 64 * 1024), bytes: f.bytes }, policy);
    if (!verdict.ok) { results.push({ name, status: "rejected", code: verdict.code, reason: verdict.message }); continue; }
    const fileHash = sha256(f.bytes);
    const dup = findByFileHash(opts.matterId, fileHash);
    if (dup) { results.push({ name: verdict.safeName, status: "duplicate", sha256: fileHash, existingId: dup.id, existingBates: dup.bates }); continue; }
    let ex: Extracted;
    try {
      // Extractors get a copy: pdf.js transfers (detaches) the buffer it is given, and the original bytes must survive intact.
      ex = await extract(f.bytes.slice(), verdict.safeName, verdict.mime, verdict.detected.kind);
    } catch (e) {
      results.push({ name: verdict.safeName, status: "rejected", code: "extraction_failed", reason: `Could not read the file: ${((e as Error).message ?? "unknown error").slice(0, 200)}` });
      continue;
    }
    // Everything below is synchronous, so two concurrent uploads cannot allocate the same Bates number.
    const again = findByFileHash(opts.matterId, fileHash);
    if (again) { results.push({ name: verdict.safeName, status: "duplicate", sha256: fileHash, existingId: again.id, existingBates: again.bates }); continue; }
    const fileDate = f.lastModified && Number.isFinite(f.lastModified) ? isoDay(new Date(f.lastModified)) : undefined;
    const date = ex.date ?? fileDate ?? new Date().toISOString().slice(0, 10);
    const dateSource: OriginalFile["dateSource"] = ex.date ? ex.dateSource ?? "ingested" : fileDate ? "file-modified" : "ingested";
    const now = new Date().toISOString();
    const docId = `ed_${nanoid(10)}`;
    const blob = d.blobs.put(f.bytes, verdict.mime, { name: verdict.safeName, meta: { matterId: opts.matterId, sha256: fileHash, kind: "ediscovery.original", size: f.bytes.byteLength, docId } });
    const { bates, batesEnd } = allocateBates(opts.matterId, ex.pages);
    const original: OriginalFile = {
      blobId: blob.id, sha256: fileHash, size: f.bytes.byteLength, mime: verdict.mime, name: verdict.safeName, kind: verdict.detected.kind, extraction: ex.extraction, dateSource,
      scan: { status: verdict.scan.status, engine: verdict.scan.engine }, uploadedBy: actor?.id ?? "unknown", uploadedAt: now,
    };
    // Text hash for exact-text duplicate linking; an empty text (image, scanned PDF) hashes the file instead so two
    // different images are never linked as duplicates of each other.
    const hash = ex.text.trim() ? contentHash(ex.text) : `file:${fileHash}`;
    const res = createDocument({
      id: docId, matterId: opts.matterId, bates, batesEnd, date, custodianId: custodian.id, custodianName: custodian.name, type: ex.type, subject: (ex.subject ?? verdict.safeName).slice(0, 300),
      from: ex.from, to: ex.to?.length ? ex.to : undefined, cc: ex.cc?.length ? ex.cc : undefined, text: ex.text, pages: ex.pages, hash, source: opts.source ?? "upload",
      tags: ex.extraction.status === "needs_ocr" ? ["needs-ocr"] : undefined,
    }, { source: opts.source ?? "upload" });
    const doc: IngestedDocument = { ...res.doc, original };
    d.edocs.put(doc as EDocument);
    createdDocs.push(doc);
    results.push({ name: verdict.safeName, status: "created", docId: doc.id, bates, batesEnd, pages: ex.pages, type: ex.type, textStatus: ex.extraction.status, sha256: fileHash, duplicateTextOf: res.duplicateOf?.id });
  }

  let indexed = 0;
  if (createdDocs.length && opts.index !== false) {
    const r = await indexDocuments(VECTOR_COLLECTIONS.edocs, createdDocs.map((x) => ({ id: x.id, text: indexTextFor(x), meta: { matterId: x.matterId, custodianId: x.custodianId, type: x.type, date: x.date, bates: x.bates } })), { embed: false, scope: matterRetrievalScope(opts.matterId) });
    indexed = r.docs;
  }
  const summary = { created: results.filter((r) => r.status === "created").length, duplicates: results.filter((r) => r.status === "duplicate").length, rejected: results.filter((r) => r.status === "rejected").length };
  audit("import", { kind: "edoc.ingest", label: `${summary.created} of ${files.length} file${files.length === 1 ? "" : "s"} ingested`, matterId: opts.matterId }, {
    ...summary, custodian: custodian.name, files: results.slice(0, 100).map((r) => ({ name: r.name, status: r.status, ...(r.status === "created" ? { bates: r.bates, sha256: r.sha256 } : r.status === "duplicate" ? { existing: r.existingBates } : { code: r.code }) })),
  }, actor);
  return { matterId: opts.matterId, results, ...summary, indexed, settings: getEDiscoverySettings(opts.matterId) };
}

/** The original file behind an ingested document (bytes stay in the blob store). */
export function originalOf(doc: EDocument): OriginalFile | undefined {
  return (doc as IngestedDocument).original;
}
