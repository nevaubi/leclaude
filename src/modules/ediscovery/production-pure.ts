/**
 * Production helpers (pure, client-safe, unit-tested): Bates assignment,
 * Concordance-style DAT and Opticon OPT load files, PII detection and the
 * QC report that gates a production from draft → qc → final.
 */
import type { EDocument, ProductionQcReport, ProductionSet, Redaction } from "@/lib/types/domain";
import { compareBates, formatBates } from "./query";
import { applyTextRedactions } from "./redaction-pure";

export interface BatesAssignment { begin: string; end: string; pages: number }

/** Sequential production Bates numbers in the given document order; returns the map and the next free number. */
export function assignBates(docs: { id: string; pages?: number }[], opts: { prefix: string; padding: number; startNumber: number }): { bates: Record<string, BatesAssignment>; next: number } {
  const prefix = opts.prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "PROD";
  const padding = Math.max(4, Math.min(10, Math.floor(opts.padding || 7)));
  let n = Math.max(1, Math.floor(opts.startNumber || 1));
  const bates: Record<string, BatesAssignment> = {};
  for (const d of docs) {
    const pages = Math.max(1, Math.floor(d.pages ?? 1));
    bates[d.id] = { begin: formatBates(prefix, n, padding), end: formatBates(prefix, n + pages - 1, padding), pages };
    n += pages;
  }
  return { bates, next: n };
}

/** Production order: families together (parent then attachments), otherwise by original Bates. */
export function productionOrder(docs: EDocument[]): EDocument[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const inSet = (id: string) => byId.has(id);
  const roots = docs.filter((d) => !(d.family?.parentId && inSet(d.family.parentId))).sort((a, b) => compareBates(a.bates, b.bates));
  const out: EDocument[] = [];
  const placed = new Set<string>();
  for (const r of roots) {
    if (placed.has(r.id)) continue;
    out.push(r); placed.add(r.id);
    const kids = (r.family?.attachmentIds ?? []).map((id) => byId.get(id)).filter((x): x is EDocument => !!x && !placed.has(x.id)).sort((a, b) => compareBates(a.bates, b.bates));
    for (const k of kids) { out.push(k); placed.add(k.id); }
  }
  for (const d of docs) if (!placed.has(d.id)) { out.push(d); placed.add(d.id); }
  return out;
}

// ---------------------------------------------------------------------------
// Load files
// ---------------------------------------------------------------------------

/** Concordance default delimiters: þ (0xFE) text qualifier, ¶ (0x14) column separator, ® (0xAE) newline. */
export const DAT_QUOTE = "þ";
export const DAT_SEP = "\u0014";
export const DAT_NEWLINE = "®";

export const DAT_FIELDS = ["BEGBATES", "ENDBATES", "BEGATTACH", "ENDATTACH", "PRODVOLUME", "CUSTODIAN", "FROM", "TO", "CC", "SUBJECT", "DATESENT", "DOCTYPE", "PAGECOUNT", "CONFIDENTIALITY", "REDACTED", "ORIGBATES", "MD5HASH", "NATIVEPATH", "TEXTPATH"] as const;

function datCell(v: unknown): string {
  const s = v == null ? "" : String(v).replace(/\r?\n/g, DAT_NEWLINE).replace(new RegExp(DAT_QUOTE, "g"), "");
  return `${DAT_QUOTE}${s}${DAT_QUOTE}`;
}

export interface LoadFileInput {
  production: Pick<ProductionSet, "volume" | "bates" | "docIds" | "stampText">;
  docs: EDocument[];
  redactedIds?: Set<string>;
}

/** Family range for a document inside the production (begin of parent … end of last attachment). */
export function familyRange(doc: EDocument, byId: Map<string, EDocument>, bates: ProductionSet["bates"]): { beg: string; end: string } | null {
  const parent = doc.family?.parentId ? byId.get(doc.family.parentId) : undefined;
  const root = parent ?? doc;
  const members = [root, ...(root.family?.attachmentIds ?? []).map((id) => byId.get(id)).filter((x): x is EDocument => !!x)].filter((m) => bates[m.id]);
  if (members.length < 2) return null;
  const sorted = members.map((m) => bates[m.id]).sort((a, b) => compareBates(a.begin, b.begin));
  return { beg: sorted[0].begin, end: sorted[sorted.length - 1].end };
}

/** Concordance DAT (one row per document, fields in DAT_FIELDS order, CRLF line ends). */
export function generateDat(input: LoadFileInput): string {
  const byId = new Map(input.docs.map((d) => [d.id, d]));
  const lines = [DAT_FIELDS.map(datCell).join(DAT_SEP)];
  for (const id of input.production.docIds) {
    const d = byId.get(id);
    const b = input.production.bates[id];
    if (!d || !b) continue;
    const fam = familyRange(d, byId, input.production.bates);
    const ext = d.type === "Email" ? "msg" : d.type === "Spreadsheet" ? "xlsx" : d.type === "Presentation" ? "pptx" : d.type === "Image" ? "jpg" : "pdf";
    const row = [
      b.begin, b.end, fam?.beg ?? "", fam?.end ?? "", input.production.volume, d.custodianName, d.from ?? "", (d.to ?? []).join("; "), (d.cc ?? []).join("; "), d.subject, d.date, d.type, b.pages,
      d.coding.confidentiality ?? (input.production.stampText || ""), input.redactedIds?.has(id) ? "Y" : "N", d.batesEnd ? `${d.bates}-${d.batesEnd}` : d.bates, d.hash ?? "",
      `NATIVES\\${input.production.volume}\\${b.begin}.${ext}`, `TEXT\\${input.production.volume}\\${b.begin}.txt`,
    ];
    lines.push(row.map(datCell).join(DAT_SEP));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Opticon OPT: one line per page — BATES,VOLUME,IMAGEPATH,DOCBREAK(Y on first page),,,PAGECOUNT. */
export function generateOpt(input: Pick<LoadFileInput, "production">): string {
  const lines: string[] = [];
  for (const id of input.production.docIds) {
    const b = input.production.bates[id];
    if (!b) continue;
    const start = parseInt(b.begin.replace(/^[A-Z0-9]+-/, ""), 10);
    const prefix = b.begin.slice(0, b.begin.indexOf("-"));
    const width = b.begin.length - prefix.length - 1;
    for (let p = 0; p < b.pages; p++) {
      const page = formatBates(prefix, start + p, width);
      lines.push([page, input.production.volume, `IMAGES\\${input.production.volume}\\${page}.tif`, p === 0 ? "Y" : "", "", "", p === 0 ? String(b.pages) : ""].join(","));
    }
  }
  return lines.join("\r\n") + (lines.length ? "\r\n" : "");
}

/** Parse an OPT file back into per-document page counts (used by tests and the QC view). */
export function parseOpt(opt: string): { bates: string; volume: string; pages: number }[] {
  const out: { bates: string; volume: string; pages: number }[] = [];
  for (const line of opt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    if (cols[3] === "Y") out.push({ bates: cols[0], volume: cols[1], pages: Number(cols[6] || 1) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------

export const PII_PATTERNS: { id: string; label: string; re: RegExp }[] = [
  { id: "ssn", label: "Social Security number", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { id: "card", label: "Payment card number", re: /\b(?:\d[ -]?){15}\d\b/g },
  { id: "dob", label: "Date of birth", re: /\b(?:DOB|date of birth)\s*[:\-]?\s*\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/gi },
  { id: "account", label: "Bank account number", re: /\b(?:account|acct|routing)\s*(?:no\.?|number|#)\s*[:\-]?\s*\d{6,17}\b/gi },
  { id: "mrn", label: "Medical record number", re: /\bMRN\s*[:#]?\s*\d{5,12}\b/gi },
];

/** PII matches remaining after text redactions are applied. */
export function findUnredactedPii(text: string): { pattern: string; sample: string }[] {
  const out: { pattern: string; sample: string }[] = [];
  for (const p of PII_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(text)) && n < 3) { out.push({ pattern: p.label, sample: m[0].replace(/\d(?=\d{2})/g, "•") }); n++; }
  }
  return out;
}

export interface QcInput {
  production: Pick<ProductionSet, "docIds" | "bates">;
  /** Every document in the matter (family members outside the set are looked up here). */
  docs: EDocument[];
  redactions: Redaction[];
}

/** QC report: privileged documents in the set, family members left behind, unredacted PII and uncoded documents. */
export function qcProduction(input: QcInput, now = new Date().toISOString()): ProductionQcReport {
  const byId = new Map(input.docs.map((d) => [d.id, d]));
  const inSet = new Set(input.production.docIds);
  const label = (id: string) => byId.get(id)?.bates ?? id;
  const privilegedInSet: ProductionQcReport["privilegedInSet"] = [];
  const missingFamily: ProductionQcReport["missingFamily"] = [];
  const unredactedPii: ProductionQcReport["unredactedPii"] = [];
  const uncoded: ProductionQcReport["uncoded"] = [];
  const redacted = new Set(input.redactions.map((r) => r.docId));
  let redactedDocs = 0;
  for (const id of input.production.docIds) {
    const d = byId.get(id);
    if (!d) continue;
    if (d.coding.privileged === true) privilegedInSet.push({ docId: id, bates: d.bates });
    if (d.coding.responsive == null) uncoded.push({ docId: id, bates: d.bates });
    const members = [d.family?.parentId, ...(d.family?.attachmentIds ?? [])].filter((x): x is string => !!x);
    for (const m of members) if (byId.has(m) && !inSet.has(m) && byId.get(m)!.coding.privileged !== true) missingFamily.push({ docId: id, bates: d.bates, missingId: m, missingBates: label(m) });
    if (redacted.has(id)) redactedDocs++;
    const { text } = applyTextRedactions(d.text, input.redactions.filter((r) => r.docId === id));
    for (const hit of findUnredactedPii(text)) unredactedPii.push({ docId: id, bates: d.bates, ...hit });
  }
  return { ranAt: now, privilegedInSet, missingFamily, unredactedPii, uncoded, redactedDocs, ok: !privilegedInSet.length && !missingFamily.length && !unredactedPii.length && !uncoded.length };
}

export const PRODUCTION_STATUSES: { id: ProductionSet["status"]; label: string; hint: string }[] = [
  { id: "draft", label: "Draft", hint: "Document set and numbering can still change" },
  { id: "qc", label: "QC", hint: "Frozen; QC report must be clean before finalising" },
  { id: "final", label: "Final", hint: "Produced; load files and Bates numbers are locked" },
];

/** Allowed status transitions. */
export function canTransition(from: ProductionSet["status"], to: ProductionSet["status"], qc?: ProductionQcReport): { ok: boolean; reason?: string } {
  if (from === to) return { ok: true };
  if (from === "final") return { ok: false, reason: "A final production cannot be reopened; create a new volume instead" };
  if (from === "draft" && to === "qc") return { ok: true };
  if (from === "qc" && to === "draft") return { ok: true };
  if (from === "qc" && to === "final") return qc?.ok ? { ok: true } : { ok: false, reason: qc ? "The QC report has open findings" : "Run QC before finalising" };
  if (from === "draft" && to === "final") return { ok: false, reason: "Move the production through QC first" };
  return { ok: false, reason: `Cannot move from ${from} to ${to}` };
}

/** Which documents in a matter are production-ready: responsive, not privileged, not exact duplicates. */
export function isProductionReady(d: EDocument): boolean {
  return d.coding.responsive === true && d.coding.privileged !== true && !d.isDuplicateOf;
}

/** Highest production number used across earlier productions with the same prefix (so a new volume continues the sequence). */
export function nextBatesNumber(productions: Pick<ProductionSet, "prefix" | "bates">[], prefix: string, fallback = 1): number {
  let max = 0;
  for (const p of productions) {
    if (p.prefix.toUpperCase() !== prefix.toUpperCase()) continue;
    for (const b of Object.values(p.bates)) { const n = parseInt(b.end.slice(b.end.indexOf("-") + 1), 10); if (Number.isFinite(n) && n > max) max = n; }
  }
  return max ? max + 1 : fallback;
}
