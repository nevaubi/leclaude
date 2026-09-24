import "server-only";
import { db } from "@/lib/db";
import type { ProductionSet, Redaction, ReviewBatch, ReviewLayout, SavedSearchRecord, SearchTermReport } from "@/lib/types/domain";

/** Module-private collections behind the review workflow (batches, saved searches, layouts, redactions, productions). */
export const REVIEW_COLLECTIONS = {
  batches: "ediscovery_batches",
  savedSearches: "ediscovery_saved_searches",
  layouts: "ediscovery_layouts",
  redactions: "ediscovery_redactions",
  productions: "ediscovery_productions",
  termReports: "ediscovery_term_reports",
} as const;

export const batches = () => db().collection<ReviewBatch>(REVIEW_COLLECTIONS.batches);
export const savedSearches = () => db().collection<SavedSearchRecord>(REVIEW_COLLECTIONS.savedSearches);
export const layouts = () => db().collection<ReviewLayout>(REVIEW_COLLECTIONS.layouts);
export const redactions = () => db().collection<Redaction>(REVIEW_COLLECTIONS.redactions);
export const productions = () => db().collection<ProductionSet>(REVIEW_COLLECTIONS.productions);
export const termReports = () => db().collection<SearchTermReport & { id: string }>(REVIEW_COLLECTIONS.termReports);

export function redactionsForDoc(docId: string): Redaction[] {
  return redactions().find((r) => r.docId === docId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function redactionsForMatter(matterId: string): Redaction[] {
  return redactions().find((r) => r.matterId === matterId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
