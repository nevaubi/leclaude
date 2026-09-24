import "server-only";
import { collection } from "@/lib/db/collections";
import type { Provenance, ProvenanceKind, ProvenanceRecord } from "./types";

const PROVENANCE = "integrity_provenance";
const records = () => collection<ProvenanceRecord>(PROVENANCE);

export function provenanceRecordId(kind: ProvenanceKind, recordId: string) {
  return `${kind}:${recordId}`;
}

/** Store (or replace) the provenance for a record so the review queue and scans can find it. */
export function putProvenance(input: { kind: ProvenanceKind; recordId: string; matterId?: string; title: string; href?: string; provenance: Provenance }): ProvenanceRecord {
  const rec: ProvenanceRecord = { id: provenanceRecordId(input.kind, input.recordId), kind: input.kind, recordId: input.recordId, matterId: input.matterId, title: input.title.slice(0, 200), href: input.href, provenance: input.provenance, updatedAt: new Date().toISOString() };
  records().put(rec);
  return rec;
}

export function getProvenance(kind: ProvenanceKind, recordId: string): Provenance | null {
  return records().get(provenanceRecordId(kind, recordId))?.provenance ?? null;
}

export function getProvenanceRecord(kind: ProvenanceKind, recordId: string): ProvenanceRecord | null {
  return records().get(provenanceRecordId(kind, recordId));
}

export function deleteProvenance(kind: ProvenanceKind, recordId: string) {
  return records().delete(provenanceRecordId(kind, recordId));
}

export function listProvenance(opts: { matterId?: string; kind?: ProvenanceKind; pending?: boolean; limit?: number } = {}): ProvenanceRecord[] {
  return records().list({
    where: (r) => (!opts.matterId || r.matterId === opts.matterId) && (!opts.kind || r.kind === opts.kind) && (!opts.pending || r.provenance.review?.status === "pending"),
    sortBy: "updatedAt",
    direction: "desc",
    limit: opts.limit,
  });
}

/** Patch the stored provenance (used by review decisions and late verification). */
export function updateProvenance(kind: ProvenanceKind, recordId: string, patch: (p: Provenance) => Provenance): ProvenanceRecord | null {
  return records().update(provenanceRecordId(kind, recordId), (r) => ({ ...r, provenance: patch(r.provenance), updatedAt: new Date().toISOString() }));
}
