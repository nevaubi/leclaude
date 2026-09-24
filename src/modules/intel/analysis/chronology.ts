import "server-only";
import { db } from "@/lib/db";
import { findNearDuplicateEvent } from "@/lib/integrity/dedupe";
import { sha256 } from "@/lib/integrity/hash";
import { makeProvenance } from "@/lib/integrity/provenance";
import { CONFIDENCE_GATE, type ProvenanceSource } from "@/lib/integrity/types";
import type { TimelineEvent } from "@/lib/types/domain";
import type { IntelDocument, IntelEvidence, IntelTimelineEntry } from "../types";
import { entityIdsOf, intelDocuments, intelEntities, listChunks } from "../store";
import { entityDocuments } from "./entities";
import { clip, documentHref, mergeTimelineEntries } from "./pure";
import type { ChronologyExportResult, ChronologyQuery, ChronologyResult } from "./types";

/**
 * Sourced chronologies: docket entries, opinions, regulatory events (Federal
 * Register publication/effective dates, CFR effective dates), recalls, MDL
 * transfers and news merged with the e-discovery timeline of a matter, then
 * deduplicated with the platform's timeline rules. Entries that pass the
 * confidence gate can be exported to the e-discovery timeline as AI-created,
 * provenance-carrying events.
 */

const SKIP_KINDS = new Set<IntelDocument["kind"]>(["judge", "attorney", "firm", "expert", "web_page", "local_file", "court_rule", "statute"]);

function confidenceOf(doc: IntelDocument): number {
  let c = doc.confidence;
  if (doc.flags.some((f) => f.kind === "unverified")) c = Math.min(c, 0.55);
  if (doc.flags.some((f) => f.kind === "contradicted" || f.kind === "parse_error")) c = Math.min(c, 0.4);
  if (doc.flags.some((f) => f.kind === "low_confidence")) c = Math.min(c, 0.5);
  return Number(c.toFixed(2));
}

function evidenceFor(doc: IntelDocument): IntelEvidence {
  const chunk = listChunks(doc.id)[0];
  return { docId: doc.id, chunkId: chunk?.id, quote: clip(doc.summary ?? chunk?.text ?? doc.title, 200), url: doc.url, href: documentHref(doc.id) };
}

/** One or two timeline entries per document, by kind-specific dates. */
export function entriesFromDocument(doc: IntelDocument): IntelTimelineEntry[] {
  if (SKIP_KINDS.has(doc.kind)) return [];
  const conf = confidenceOf(doc);
  const ev = [evidenceFor(doc)];
  const title = clip(doc.title, 140);
  const base = (at: string | undefined, t: string, kind: string, detail?: string): IntelTimelineEntry | null => (at ? { at: at.slice(0, 10), title: t, detail, kind, evidence: ev, confidence: conf } : null);
  const out: (IntelTimelineEntry | null)[] = [];
  const detail = doc.summary ? clip(doc.summary, 240) : undefined;
  switch (doc.kind) {
    case "docket_entry": out.push(base(doc.dates.event ?? doc.dates.filed, title, "docket", detail)); break;
    case "docket": out.push(base(doc.dates.filed, `Docket opened: ${clip(doc.caseName ?? doc.title, 100)}`, "docket", detail)); break;
    case "opinion": out.push(base(doc.dates.decided ?? doc.dates.filed, `${clip(doc.caseName ?? doc.title, 90)}${doc.citation ? `, ${doc.citation}` : ""}`, "opinion", detail)); break;
    case "register_notice":
      out.push(base(doc.dates.published, title, "regulatory", detail));
      if (doc.dates.effective && doc.dates.effective !== doc.dates.published) out.push(base(doc.dates.effective, `Effective: ${clip(doc.title, 110)}`, "regulatory"));
      break;
    case "regulation": out.push(base(doc.dates.effective ?? doc.dates.modified, `${doc.citation ? `${doc.citation} — ` : ""}${clip(doc.title, 100)}`, "regulatory", detail)); break;
    case "recall": out.push(base(doc.dates.event ?? doc.dates.published, title, "recall", detail)); break;
    case "adverse_event": out.push(base(doc.dates.event, title, "recall", detail)); break;
    case "mdl": out.push(base(typeof doc.meta?.transferDate === "string" ? (doc.meta.transferDate as string) : doc.dates.filed, `MDL created: ${clip(doc.title, 110)}`, "mdl", detail)); break;
    case "news": out.push(base(doc.dates.published ?? doc.dates.event, title, "news", detail)); break;
    default: out.push(base(doc.dates.event ?? doc.dates.published ?? doc.dates.filed, title, doc.kind, detail));
  }
  return out.filter((e): e is IntelTimelineEntry => Boolean(e));
}

function ediscoveryEntries(matterId: string): IntelTimelineEntry[] {
  return db().timeline.find((e) => e.matterId === matterId && !e.id.startsWith("tl_intel_")).map((e) => ({
    at: e.date.slice(0, 10),
    title: e.title,
    detail: e.description ? clip(e.description, 240) : undefined,
    kind: `ediscovery:${e.category}`,
    evidence: [{ docId: e.id, quote: e.sources[0]?.excerpt ? clip(e.sources[0].excerpt, 200) : undefined, href: `/ediscovery?matter=${matterId}&tab=timeline` }],
    confidence: e.provenance?.confidence ?? (e.verified ? 0.95 : e.createdBy === "user" ? 0.9 : 0.7),
  }));
}

/** Documents for a chronology scope. */
export function chronologyDocuments(q: ChronologyQuery): IntelDocument[] {
  let docs: IntelDocument[];
  if (q.matterId) docs = intelDocuments().find((d) => d.matterIds.includes(q.matterId!));
  else if (q.mdlId) docs = intelDocuments().find((d) => d.mdlId === q.mdlId || entityIdsOf(d).includes(q.mdlId!));
  else if (q.productId) docs = intelDocuments().find((d) => d.productIds.includes(q.productId!));
  else if (q.entityId) docs = entityDocuments(q.entityId);
  else docs = [];
  if (q.kinds?.length) docs = docs.filter((d) => q.kinds!.includes(d.kind));
  return docs;
}

export function chronologyLabel(q: ChronologyQuery): string {
  const d = db();
  if (q.matterId) return d.matters.get(q.matterId)?.shortName ?? q.matterId;
  const id = q.mdlId ?? q.productId ?? q.entityId;
  return id ? intelEntities().get(id)?.name ?? id : "Chronology";
}

export function buildChronology(q: ChronologyQuery): ChronologyResult {
  const docs = chronologyDocuments(q);
  const intel = docs.flatMap(entriesFromDocument);
  const edisc = q.matterId && q.includeEdiscovery !== false ? ediscoveryEntries(q.matterId) : [];
  const { entries, merged } = mergeTimelineEntries([intel, edisc]);
  let filtered = entries;
  if (q.from) filtered = filtered.filter((e) => e.at >= q.from!);
  if (q.to) filtered = filtered.filter((e) => e.at <= q.to!);
  if (q.limit && filtered.length > q.limit) filtered = filtered.slice(-q.limit);
  return { query: q, entries: filtered, merged, sources: { intel: intel.length, ediscovery: edisc.length }, label: chronologyLabel(q) };
}

function categoryFor(kind: string | undefined): TimelineEvent["category"] {
  switch (kind) {
    case "docket": case "opinion": case "mdl": return "litigation";
    case "regulatory": case "recall": return "regulatory";
    case "news": return "other";
    default: return "other";
  }
}

function provenanceSource(doc: IntelDocument | null, ev: IntelEvidence): ProvenanceSource {
  const kind: ProvenanceSource["kind"] = !doc ? "internal" : doc.kind === "opinion" ? "case-law" : doc.kind === "docket" || doc.kind === "docket_entry" || doc.kind === "mdl" ? "docket" : doc.kind === "regulation" || doc.kind === "register_notice" || doc.kind === "statute" ? "regulation" : doc.kind === "news" || doc.kind === "web_page" ? "web" : "document";
  return { kind, id: ev.docId, title: doc?.title, cite: doc?.citation ?? doc?.docketNumber, url: ev.url ?? doc?.url };
}

/**
 * Export chronology entries to the e-discovery timeline. Only entries whose
 * confidence passes the gate and that do not already exist (date + title, or a
 * near-duplicate on the same day) are written; every event is createdBy "ai"
 * and carries provenance with schema verification, so the review queue and the
 * trust badge can see where it came from.
 */
export function exportChronologyToTimeline(matterId: string, opts: { entries?: IntelTimelineEntry[]; minConfidence?: number; now?: string } = {}): ChronologyExportResult {
  const gate = opts.minConfidence ?? CONFIDENCE_GATE;
  const now = opts.now ?? new Date().toISOString();
  const entries = opts.entries ?? buildChronology({ matterId, includeEdiscovery: false }).entries;
  const existing = db().timeline.find((e) => e.matterId === matterId);
  const result: ChronologyExportResult = { matterId, created: 0, skippedDuplicates: 0, belowGate: 0, eventIds: [] };
  const created: TimelineEvent[] = [];
  for (const e of entries) {
    if (e.evidence.every((ev) => ev.docId.startsWith("tl_"))) continue; // already an e-discovery event
    if (e.confidence < gate) { result.belowGate++; continue; }
    const dup = findNearDuplicateEvent([...existing, ...created], { date: e.at, title: e.title, sources: e.evidence.map((ev) => ({ id: ev.docId, cite: ev.docId })) });
    if (dup) { result.skippedDuplicates++; continue; }
    const docs = e.evidence.map((ev) => intelDocuments().get(ev.docId));
    const provenance = makeProvenance({ surface: "intel.chronology", model: "analysis", confidence: e.confidence, sources: e.evidence.map((ev, i) => provenanceSource(docs[i] ?? null, ev)) });
    // Dates and titles are copied from the records, so the export is schema-checked; records that are themselves flagged
    // unverified keep the event at "partially-verified" so the review queue does not present a sample date as confirmed.
    const flaggedDocs = docs.filter((d) => d?.flags.some((f) => f.kind === "unverified" || f.kind === "low_confidence" || f.kind === "contradicted")).length;
    provenance.verification = { status: flaggedDocs ? "partially-verified" : "verified", checkedAt: now, method: "schema", supported: e.evidence.length - flaggedDocs, unsupported: flaggedDocs, contradicted: 0, notes: flaggedDocs ? `${flaggedDocs} of ${e.evidence.length} cited records are flagged unverified or low-confidence` : "Dates and titles taken directly from the cited records" };
    const id = `tl_intel_${sha256(`${matterId}|${e.at}|${e.title.toLowerCase()}`).slice(0, 12)}`;
    const event: TimelineEvent = {
      id, matterId, date: e.at, precision: "day", title: e.title, description: e.detail, category: categoryFor(e.kind), significance: e.kind === "news" ? 2 : 3,
      sources: e.evidence.map((ev, i) => ({ kind: "external", id: ev.docId, cite: docs[i]?.citation ?? docs[i]?.docketNumber ?? docs[i]?.title, excerpt: ev.quote })),
      createdBy: "ai", verified: false, provenance,
    };
    created.push(event);
    result.eventIds.push(id);
  }
  if (created.length) db().timeline.putMany(created);
  result.created = created.length;
  return result;
}
