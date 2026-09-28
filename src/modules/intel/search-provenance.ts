import "server-only";
import { db } from "@/lib/db";
import type { AutoconfigState, MatterIntelPlan } from "./autoconfig-types";
import { intelDocuments } from "./store";
import type { IntelAdapterId, IntelDocument } from "./types";

/**
 * Search provenance: which matters a record belongs to because it was found by a search that was derived from those
 * matters (the per-matter plans stored by "Set up from matters"). The link is deterministic — the record's own saved
 * query or docket number is matched exactly against the plans — and it is limited to the matters the source serves.
 * Nothing is inferred from the record's content here; entity resolution links records by content separately.
 */

export const AUTOCONFIG_KEY = "intel:autoconfig";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The plan fields whose values an adapter searches with. */
function planValues(adapter: IntelAdapterId, p: MatterIntelPlan): string[] {
  switch (adapter) {
    case "courtlistener-opinions": return p.caseLaw.map((q) => q.text);
    case "federal-register": return p.regulatory.map((q) => q.text);
    case "govinfo": return p.statutes.map((q) => q.text);
    case "news": return p.news.map((q) => q.text);
    case "courtlistener-dockets": return p.dockets;
    default: return [];
  }
}

/** Index of normalized search value → matter ids, per adapter, from the stored plans. */
function searchIndex(): Map<IntelAdapterId, Map<string, string[]>> {
  const state = db().kv.get<AutoconfigState>(AUTOCONFIG_KEY);
  const out = new Map<IntelAdapterId, Map<string, string[]>>();
  for (const p of state?.plans ?? []) {
    for (const adapter of ["courtlistener-opinions", "federal-register", "govinfo", "news", "courtlistener-dockets"] as IntelAdapterId[]) {
      let byValue = out.get(adapter);
      if (!byValue) { byValue = new Map(); out.set(adapter, byValue); }
      for (const v of planValues(adapter, p)) {
        const k = norm(v);
        const ids = byValue.get(k) ?? [];
        if (!ids.includes(p.matterId)) byValue.set(k, [...ids, p.matterId]);
      }
    }
  }
  return out;
}

/** Matters whose plan produced this search (a saved query, or a docket number for docket watches). */
export function mattersForSearch(adapter: IntelAdapterId, o: { query?: string; docketNumber?: string }, index = searchIndex()): string[] {
  const byValue = index.get(adapter);
  if (!byValue) return [];
  const key = adapter === "courtlistener-dockets" ? o.docketNumber : o.query;
  return key ? byValue.get(norm(key)) ?? [] : [];
}

function searchKeyOf(doc: Pick<IntelDocument, "meta" | "docketNumber">): { query?: string; docketNumber?: string } {
  const q = doc.meta?.query;
  return { query: typeof q === "string" ? q : undefined, docketNumber: doc.docketNumber };
}

/**
 * Link a source's existing records to the matters their searches were derived from (records ingested before the
 * link existed, or skipped on later runs because their text was already held). Only matters in `allowed` are linked.
 * Returns the number of records updated.
 */
export function linkSourceRecordsToMatters(sourceId: string, adapter: IntelAdapterId, allowed: Set<string>): number {
  const index = searchIndex();
  if (!index.get(adapter)?.size) return 0;
  const docs = intelDocuments();
  let changed = 0;
  for (const doc of docs.find((d) => d.sourceId === sourceId)) {
    const add = mattersForSearch(adapter, searchKeyOf(doc), index).filter((id) => allowed.has(id) && !doc.matterIds.includes(id));
    if (!add.length) continue;
    docs.put({ ...doc, matterIds: [...doc.matterIds, ...add] });
    changed++;
  }
  return changed;
}
