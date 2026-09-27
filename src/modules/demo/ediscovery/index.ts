import type { Conflict, Deposition, EDocument, IssueCode, PrivilegeLogEntry, Relationship, TimelineEvent } from "@/lib/types/domain";
import { CODING_RULES_KEY } from "@/modules/ediscovery/rules";
import { buildCorpus } from "./build-docs";
import { docIndex } from "./depo-helpers";
import { buildMarshDeposition } from "./depo-marsh";
import { buildOkoroDeposition } from "./depo-okoro";
import { buildFreyDeposition } from "./depo-frey";
import { buildConflicts, buildRelationships, buildStory, buildTimeline } from "./analysis";
import { buildIssueCodes } from "./issue-codes";
import { APPLE_DEMO_RULES, APPLE_DEMO_TOPICS, buildBatches, buildPrivilegeLog, buildProduction, buildSavedSearches } from "./review";
import { APPLE_DEMO_BATES_PREFIX, APPLE_DEMO_BATES_WIDTH, M, buildPeople } from "./people";

/**
 * E-discovery half of the Apple antitrust demonstration pack (consumer class action, plaintiffs' side).
 *
 * Pure and deterministic: no db access, no clock, no randomness. Every record is tagged
 * `meta.demo = "apple-antitrust"`, `meta.synthetic = true`, and every internal document, chat, deck and transcript is
 * FICTIONAL, authored by fictional custodians. The loader writes the typed collections, the module-private
 * `collections`, the `kv` entries, and indexes `edocs` for keyword search (see `APPLE_DEMO_EDISCOVERY_WRITES`).
 */

export { APPLE_DEMO_BATES_PREFIX, APPLE_DEMO_BATES_WIDTH } from "./people";
export { MARSH_CITES } from "./depo-marsh";
export { OKORO_CITES } from "./depo-okoro";
export { FREY_CITES } from "./depo-frey";
export { REVIEW_IDS } from "./review";

/** Module-private collection names the pack writes (mirrors ediscovery/review-store and analysis seed). */
export const APPLE_DEMO_COLLECTIONS = {
  people: "people",
  batches: "ediscovery_batches",
  savedSearches: "ediscovery_saved_searches",
  productions: "ediscovery_productions",
  stories: "ediscovery_stories",
} as const;

/** kv keys the pack writes (settings key mirrors ediscovery/ingest; topics key mirrors analysis/service). */
export const APPLE_DEMO_KV_KEYS = {
  settings: `ediscovery:settings:${M}`,
  rules: CODING_RULES_KEY(M),
  topics: `ediscovery:topics:${M}`,
} as const;

export interface AppleEdiscoveryDemo {
  edocs: EDocument[];
  issueCodes: IssueCode[];
  depositions: Deposition[];
  timeline: TimelineEvent[];
  relationships: Relationship[];
  conflicts: Conflict[];
  privilegeLog: PrivilegeLogEntry[];
  /** Records for module-private collections (people of the matter, saved searches, batches, production, story). */
  collections: { collection: string; docs: { id: string }[] }[];
  /** kv entries the modules need (Bates settings, coding protocol, suggested cross-analysis topics). */
  kv: Record<string, unknown>;
  /** Keyword-index text per document id (same shape as ediscovery/privilege `indexTextFor`). */
  textFor?: (docId: string) => string;
}

/** Text the e-discovery keyword index expects for a document (mirrors `indexTextFor`). */
export function demoIndexText(d: EDocument): string {
  return `${d.bates}\n${d.subject}\n${d.custodianName}\n${d.from ?? ""}\n${(d.to ?? []).join("; ")}\n\n${d.text}`;
}

export function buildAppleEdiscoveryDemo(): AppleEdiscoveryDemo {
  const edocs = buildCorpus();
  const ix = docIndex(edocs);
  const depositions = [buildMarshDeposition(ix), buildOkoroDeposition(ix), buildFreyDeposition(ix)];
  const ctx = { ix, depositions };
  const timeline = buildTimeline(ctx);
  const relationships = buildRelationships(ctx, edocs);
  const conflicts = buildConflicts(ctx);
  const story = buildStory(ctx, timeline);

  const counts = new Map<string, number>();
  for (const d of edocs) for (const c of d.coding.issues ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
  const issueCodes = buildIssueCodes().map((c) => ({ ...c, count: counts.get(c.code) ?? 0 }));

  let maxBates = 0;
  for (const d of edocs) for (const b of [d.bates, d.batesEnd]) if (b) maxBates = Math.max(maxBates, Number(b.slice(b.lastIndexOf("-") + 1)));

  const textById = new Map(edocs.map((d) => [d.id, demoIndexText(d)]));
  return {
    edocs,
    issueCodes,
    depositions,
    timeline,
    relationships,
    conflicts,
    privilegeLog: buildPrivilegeLog(edocs),
    collections: [
      { collection: APPLE_DEMO_COLLECTIONS.people, docs: buildPeople() },
      { collection: APPLE_DEMO_COLLECTIONS.savedSearches, docs: buildSavedSearches() },
      { collection: APPLE_DEMO_COLLECTIONS.batches, docs: buildBatches(edocs) },
      { collection: APPLE_DEMO_COLLECTIONS.productions, docs: [buildProduction(edocs)] },
      { collection: APPLE_DEMO_COLLECTIONS.stories, docs: [story] },
    ],
    kv: {
      [APPLE_DEMO_KV_KEYS.settings]: { batesPrefix: APPLE_DEMO_BATES_PREFIX, batesWidth: APPLE_DEMO_BATES_WIDTH, nextBates: maxBates + 1 },
      [APPLE_DEMO_KV_KEYS.rules]: APPLE_DEMO_RULES,
      [APPLE_DEMO_KV_KEYS.topics]: APPLE_DEMO_TOPICS,
    },
    textFor: (docId: string) => textById.get(docId) ?? "",
  };
}
