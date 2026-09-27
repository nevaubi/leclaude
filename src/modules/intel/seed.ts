import "server-only";
import { db, type Database } from "@/lib/db";
import { indexDocuments } from "@/lib/ai/vector-store";
import { contentHash } from "@/lib/integrity/hash";
import { MATTERS } from "@/lib/seed/ids";
import { chunkIndexText, chunkIntelText, normalizeText } from "./chunk";
import { intelSampleMode } from "./config";
import { computeNextRunAt } from "./schedule";
import { SEED_DOCS, SEED_ENTITIES, type SeedSourceKey } from "./seed-corpus";
import { deleteDocument, docMetaForVector, textBlobIdFor } from "./store";
import { INTEL_COLLECTIONS, INTEL_VECTOR_NAMESPACE, type IntelChunk, type IntelDocument, type IntelEntity, type IntelInsight, type IntelRelation, type IntelSource } from "./types";

/**
 * Intel seeds, two modes (LECLAUDE_SEED, see src/lib/seed/index.ts):
 * - demo: one sample-configured system source per adapter (enabled where no key is needed) and the
 *   offline sample corpus (documents, chunks, keyword index, entities). Test suite and demos only.
 * - reference (production default): the same source catalog with neutral names and empty
 *   configuration, all disabled except the local folders when LECLAUDE_CORPUS_DIRS is set. No
 *   documents, entities or insights are created; the layer fills only from sources the firm turns on
 *   in Settings → Data & automation. Databases that received the sample corpus before this split are
 *   cleaned once (purgeSampleIntel).
 * Idempotent: stable ids, putMany; user edits to system sources are kept.
 */
export const INTEL_SEED_VERSION = 1;

export const SEED_SOURCE_IDS: Record<SeedSourceKey, string> = {
  clOpinions: "isrc_sys_cl_opinions",
  clDockets: "isrc_sys_cl_dockets",
  clJudges: "isrc_sys_cl_judges",
  ecfr: "isrc_sys_ecfr",
  federalRegister: "isrc_sys_federal_register",
  govinfo: "isrc_sys_govinfo",
  openfda: "isrc_sys_openfda",
  jpml: "isrc_sys_jpml",
  courtRules: "isrc_sys_court_rules",
  news: "isrc_sys_news",
  localCorpus: "isrc_sys_local_corpus",
  webList: "isrc_sys_web_list",
};

const hasEnv = (k: string) => Boolean(process.env[k]?.trim());

/** The twelve sample-configured system sources (demo mode). Enabled only where no key is needed. */
export function systemSources(now = new Date()): IntelSource[] {
  const ts = now.toISOString();
  const base = (key: SeedSourceKey, s: Omit<IntelSource, "id" | "status" | "health" | "stats" | "createdAt" | "updatedAt" | "system" | "nextRunAt">, order: number): IntelSource => ({
    id: SEED_SOURCE_IDS[key],
    ...s,
    status: s.enabled ? "idle" : "disabled",
    health: { ok: true, consecutiveFailures: 0 },
    // Enabled sources start staggered shortly after boot; later runs follow the schedule.
    nextRunAt: s.enabled ? new Date(now.getTime() + (order + 1) * 90_000).toISOString() : computeNextRunAt(s.schedule, now)?.toISOString(),
    stats: { documents: 0, chunks: 0, entities: 0, lastAdded: 0 },
    system: true,
    createdAt: ts,
    updatedAt: ts,
  });
  const corpusDirs = (process.env.LECLAUDE_CORPUS_DIRS ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [
    base("clOpinions", { adapter: "courtlistener-opinions", name: "Case law: PFAS, product liability and preemption", description: "CourtListener opinions matching the matters' research themes in the 4th, 9th and 11th Circuits and the Supreme Court.", config: { queries: ['"AFFF" OR "aqueous film-forming foam" PFAS', '"Depo-Provera" OR medroxyprogesterone meningioma', '"failure to warn" AND preemption AND "clear evidence"', '"government contractor defense" AND Boyle'], courts: "scotus ca4 dsc ca11 flnd ca9 cand", sinceDays: 60, maxResults: 15, fetchText: true }, schedule: { every: "daily", at: "05:00" }, enabled: true, scope: { matterIds: [MATTERS.afff, MATTERS.depo] } }, 0),
    base("clDockets", { adapter: "courtlistener-dockets", name: "Docket watch: matter dockets", description: "RECAP dockets for the AFFF and Depo-Provera MDLs; new entries become docket_entry documents.", config: { docketNumbers: ["2:18-mn-02873", "3:25-md-03140"], includeMatters: true, includeWatches: true, maxEntries: 50, entrySinceDays: 90 }, schedule: { every: "1h" }, enabled: true, scope: { matterIds: [MATTERS.afff, MATTERS.depo], targets: ["2:18-mn-02873", "3:25-md-03140"] } }, 1),
    base("clJudges", { adapter: "courtlistener-judges", name: "Judges: assigned and frequently seen", description: "Judge profiles (positions, courts, appointing authority) for the judges on matter dockets and opinions.", config: { names: ["Richard M. Gergel", "M. Casey Rodgers"], fromDocuments: true, maxJudges: 10 }, schedule: { every: "weekly", at: "03:00", weekday: 1 }, enabled: true, scope: { matterIds: [MATTERS.afff, MATTERS.depo] } }, 2),
    base("ecfr", { adapter: "ecfr", name: "Regulations: TSCA PFAS reporting, drinking water, FDA labeling", description: "Tracked CFR sections kept current from eCFR.", config: { sections: [{ title: 40, section: "705.3" }, { title: 40, section: "705.5" }, { title: 40, section: "705.20" }, { title: 40, section: "141.61" }, { title: 21, section: "314.70" }, { title: 21, section: "314.80" }, { title: 21, section: "314.81" }, { title: 21, section: "201.56" }, { title: 21, section: "201.57" }], queries: ["perfluoroalkyl reporting", "medroxyprogesterone"], maxResults: 5, fetchSections: true }, schedule: { every: "daily", at: "04:00" }, enabled: true }, 3),
    base("federalRegister", { adapter: "federal-register", name: "Federal Register: PFAS, TSCA, FDA labeling", description: "Rules, proposed rules and notices from EPA, FDA and DoD on the matters' subjects.", config: { queries: ["PFAS", "TSCA section 8(a)(7)", "aqueous film-forming foam", "medroxyprogesterone", "prescription drug labeling"], agencies: ["environmental-protection-agency", "food-and-drug-administration", "defense-department"], types: [], sinceDays: 30, maxResults: 15, fetchText: true }, schedule: { every: "daily", at: "06:30" }, enabled: true }, 4),
    base("govinfo", { adapter: "govinfo", name: "Statutes: TSCA, FDCA and MDL provisions", description: "U.S. Code sections from GovInfo (DEMO_KEY unless GOVINFO_API_KEY is set).", config: { queries: ["15 U.S.C. 2607", "21 U.S.C. 355", "28 U.S.C. 1407"], collection: "USCODE", maxResults: 5, fetchText: true }, schedule: { every: "weekly", at: "03:30", weekday: 2 }, enabled: true }, 5),
    base("openfda", { adapter: "openfda-recalls", name: "FDA enforcement: watched products", description: "openFDA recalls and current labeling for products in the matters.", config: { endpoints: ["drug", "device"], products: ["medroxyprogesterone", "Depo-Provera", "ranitidine"], firms: [], classifications: [], sinceDays: 365, maxResults: 50, labels: ["Depo-Provera"], deviceEvents: [], maxDeviceEvents: 25 }, schedule: { every: "daily", at: "05:30" }, enabled: true, scope: { matterIds: [MATTERS.depo] } }, 6),
    base("jpml", { adapter: "jpml-mdls", name: "JPML: pending MDL dockets", description: "The JPML pending MDL list, linked to the matters by MDL number; falls back to a seeded list when the page cannot be parsed.", config: { maxResults: 200, watch: ["2873", "3140"], allowFallback: true }, schedule: { every: "weekly", at: "02:30", weekday: 1 }, enabled: true }, 7),
    base("courtRules", { adapter: "court-rules", name: "Court rules: D.S.C., N.D. Fla., N.D. Cal. and FRCP", description: "Local rules, standing orders and MDL practice pages for the matters' courts.", config: { rules: [
      { court: "U.S. District Court for the District of South Carolina", courtId: "dsc", label: "D.S.C. Local Civil Rules", url: "https://www.scd.uscourts.gov/rules/localrules.asp" },
      { court: "U.S. District Court for the District of South Carolina", courtId: "dsc", label: "MDL 2873 (AFFF) case management page", url: "https://www.scd.uscourts.gov/mdl-2873/index.asp" },
      { court: "U.S. District Court for the Northern District of Florida", courtId: "flnd", label: "N.D. Fla. Local Rules", url: "https://www.flnd.uscourts.gov/local-rules" },
      { court: "U.S. District Court for the Northern District of California", courtId: "cand", label: "N.D. Cal. Civil Local Rules", url: "https://www.cand.uscourts.gov/rules/civil-local-rules/" },
      { court: "United States federal courts", label: "Federal Rules of Civil Procedure (LII)", url: "https://www.law.cornell.edu/rules/frcp", jurisdiction: "Federal" },
    ], maxTextChars: 200_000, prefer: "auto" }, schedule: { every: "weekly", at: "02:00", weekday: 0 }, enabled: true }, 8),
    base("news", { adapter: "news", name: "News: matters, products and regulators", description: "Recent news for the matters and their products (needs TAVILY_API_KEY or FIRECRAWL_API_KEY).", config: { queries: ["AFFF PFAS litigation", "Depo-Provera meningioma lawsuit", "EPA PFAS drinking water", "FDA medroxyprogesterone label"], includeMatters: true, sinceDays: 7, maxResults: 8, provider: "auto", includeDomains: [], maxTextChars: 20_000 }, schedule: { every: "daily", at: "07:00" }, enabled: hasEnv("TAVILY_API_KEY") || hasEnv("FIRECRAWL_API_KEY"), scope: { matterIds: [MATTERS.afff, MATTERS.depo] } }, 9),
    base("localCorpus", { adapter: "local-corpus", name: "Local document folders", description: "The firm's document folders (LECLAUDE_CORPUS_DIRS or the folders below), indexed incrementally and mapped to matters by folder name.", config: { dirs: corpusDirs, recursive: true, maxFileMb: 25, maxFiles: 500, skipHidden: true, matterMap: { "AFFF-PFAS": MATTERS.afff, "Depo-Provera": MATTERS.depo, "Northgate": MATTERS.northgate, "Project-Harbor": MATTERS.harbor, "Sterling": MATTERS.sterling }, maxTextChars: 400_000 }, schedule: { every: "daily", at: "02:00" }, enabled: corpusDirs.length > 0 }, 10),
    base("webList", { adapter: "web-list", name: "Watched web pages: EPA PFAS and FDA drug safety", description: "Agency hub pages kept current as web_page documents.", config: { urls: [{ url: "https://www.epa.gov/pfas", title: "EPA — Per- and Polyfluoroalkyl Substances (PFAS)", matterId: MATTERS.afff, tags: ["pfas"] }, { url: "https://www.fda.gov/drugs/drug-safety-and-availability", title: "FDA — Drug Safety and Availability", matterId: MATTERS.depo, tags: ["fda"] }], kind: "web_page", maxTextChars: 120_000, prefer: "auto" }, schedule: { every: "weekly", at: "01:30", weekday: 3 }, enabled: true }, 11),
  ];
}

/**
 * Production source catalog: one disabled, unconfigured source per adapter (same stable ids as the
 * demo catalog so the system workflows resolve them). Nothing runs until the firm enables a source;
 * the local folders are enabled only when LECLAUDE_CORPUS_DIRS names folders.
 */
export function referenceSources(now = new Date()): IntelSource[] {
  const ts = now.toISOString();
  const corpusDirs = (process.env.LECLAUDE_CORPUS_DIRS ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const base = (key: SeedSourceKey, s: Pick<IntelSource, "adapter" | "name" | "description" | "config" | "schedule"> & { enabled?: boolean }, order: number): IntelSource => {
    const enabled = Boolean(s.enabled);
    return {
      id: SEED_SOURCE_IDS[key],
      adapter: s.adapter,
      name: s.name,
      description: s.description,
      config: s.config,
      schedule: s.schedule,
      enabled,
      status: enabled ? "idle" : "disabled",
      health: { ok: true, consecutiveFailures: 0 },
      nextRunAt: enabled ? new Date(now.getTime() + (order + 1) * 90_000).toISOString() : computeNextRunAt(s.schedule, now)?.toISOString(),
      stats: { documents: 0, chunks: 0, entities: 0, lastAdded: 0 },
      system: true,
      createdAt: ts,
      updatedAt: ts,
    };
  };
  const configure = "Add queries to this source, then enable it.";
  return [
    base("clOpinions", { adapter: "courtlistener-opinions", name: "Case law (CourtListener opinions)", description: `Opinions matching saved queries. ${configure}`, config: { queries: [] }, schedule: { every: "daily", at: "05:00" } }, 0),
    base("clDockets", { adapter: "courtlistener-dockets", name: "Docket watch (CourtListener RECAP)", description: "Follows the dockets of your matters and watched docket numbers; new entries become records.", config: { docketNumbers: [], includeMatters: true, includeWatches: true }, schedule: { every: "1h" } }, 1),
    base("clJudges", { adapter: "courtlistener-judges", name: "Judge profiles (CourtListener)", description: "Profiles for judges named on your dockets and opinions.", config: { names: [], fromDocuments: true }, schedule: { every: "weekly", at: "03:00", weekday: 1 } }, 2),
    base("ecfr", { adapter: "ecfr", name: "Regulations (eCFR)", description: `Tracked CFR sections kept current. ${configure}`, config: { sections: [], queries: [] }, schedule: { every: "daily", at: "04:00" } }, 3),
    base("federalRegister", { adapter: "federal-register", name: "Federal Register", description: `Rules, proposed rules and notices matching saved queries. ${configure}`, config: { queries: [], agencies: [] }, schedule: { every: "daily", at: "06:30" } }, 4),
    base("govinfo", { adapter: "govinfo", name: "Statutes (GovInfo)", description: `U.S. Code sections from GovInfo. ${configure}`, config: { queries: [] }, schedule: { every: "weekly", at: "03:30", weekday: 2 } }, 5),
    base("openfda", { adapter: "openfda-recalls", name: "FDA enforcement (openFDA)", description: `Recalls and labeling for watched products. ${configure}`, config: { products: [], firms: [], labels: [] }, schedule: { every: "daily", at: "05:30" } }, 6),
    base("jpml", { adapter: "jpml-mdls", name: "JPML pending MDL list", description: "The JPML pending MDL list, linked to your matters by MDL number. Live page only.", config: { watch: [], allowFallback: false }, schedule: { every: "weekly", at: "02:30", weekday: 1 } }, 7),
    base("courtRules", { adapter: "court-rules", name: "Court rules and standing orders", description: `Local rules and standing orders for your courts. ${configure}`, config: { rules: [] }, schedule: { every: "weekly", at: "02:00", weekday: 0 } }, 8),
    base("news", { adapter: "news", name: "News on your matters", description: "Recent news for your matters (needs TAVILY_API_KEY or FIRECRAWL_API_KEY).", config: { queries: [], includeMatters: true }, schedule: { every: "daily", at: "07:00" } }, 9),
    base("localCorpus", { adapter: "local-corpus", name: "Local document folders", description: "The firm's document folders from LECLAUDE_CORPUS_DIRS, indexed incrementally and mapped to matters by folder name.", config: { dirs: corpusDirs, recursive: true, matterMap: {} }, schedule: { every: "daily", at: "02:00" }, enabled: corpusDirs.length > 0 }, 10),
    base("webList", { adapter: "web-list", name: "Watched web pages", description: `Web pages kept current as records. ${configure}`, config: { urls: [] }, schedule: { every: "weekly", at: "01:30", weekday: 3 } }, 11),
  ];
}

export const INTEL_REFERENCE_VERSION = 1;
const REFERENCE_KEY = "intel:reference:version";

export interface SamplePurgeReport { documents: number; entities: number; relations: number; insights: number; sources: number }

/**
 * Remove the bundled sample corpus and everything derived from it from a production (non-demo)
 * database: seeded documents (with chunks, blobs and vectors), documents fetched by sources that
 * still carry the sample configuration, seeded entities, and relations/insights whose evidence no
 * longer resolves. Sample-configured system sources are replaced by the neutral catalog. Records
 * from sources the firm configured itself are kept.
 */
export function purgeSampleIntel(database: Database = db(), now = new Date()): SamplePurgeReport {
  const sources = database.collection<IntelSource>(INTEL_COLLECTIONS.sources);
  const documents = database.collection<IntelDocument>(INTEL_COLLECTIONS.documents);
  const entities = database.collection<IntelEntity>(INTEL_COLLECTIONS.entities);
  const relations = database.collection<IntelRelation>(INTEL_COLLECTIONS.relations);
  const insights = database.collection<IntelInsight>(INTEL_COLLECTIONS.insights);
  const report: SamplePurgeReport = { documents: 0, entities: 0, relations: 0, insights: 0, sources: 0 };

  const sample = new Map(systemSources(now).map((s) => [s.id, JSON.stringify(s.config)]));
  const sampleSourceIds = new Set(sources.all().filter((s) => sample.get(s.id) === JSON.stringify(s.config)).map((s) => s.id));

  for (const d of documents.all()) {
    if (d.meta?.seeded === true || sampleSourceIds.has(d.sourceId)) { if (deleteDocument(d.id)) report.documents++; }
  }
  const alive = (docId: string) => documents.has(docId);
  for (const e of entities.all()) {
    const live = e.docIds.filter(alive);
    if (e.attributes?.seeded || (e.docIds.length > 0 && live.length === 0)) { entities.delete(e.id); report.entities++; }
    else if (live.length !== e.docIds.length) entities.put({ ...e, docIds: live, updatedAt: now.toISOString() });
  }
  for (const r of relations.all()) {
    if (!r.evidence.some((ev) => alive(ev.docId)) || !entities.has(r.from) || !entities.has(r.to)) { relations.delete(r.id); report.relations++; }
  }
  for (const i of insights.all()) {
    const evidenceGone = i.evidence.length > 0 && !i.evidence.some((ev) => alive(ev.docId));
    const scopeGone = i.evidence.length === 0 && (i.scope.entityIds ?? []).length > 0 && !(i.scope.entityIds ?? []).some((id) => entities.has(id));
    if (evidenceGone || scopeGone) { insights.delete(i.id); report.insights++; }
  }
  const neutral = new Map(referenceSources(now).map((s) => [s.id, s]));
  for (const id of sampleSourceIds) {
    const next = neutral.get(id);
    if (next) { sources.put(next); report.sources++; }
  }
  return report;
}

/** Production path of ensureIntelSeeded: neutral source catalog, one-time purge of any sample corpus. */
function ensureIntelReference(database: Database): boolean {
  if (database.kv.get<number>(REFERENCE_KEY) === INTEL_REFERENCE_VERSION) return false;
  const now = new Date();
  if (database.kv.get<number>("intel:seed:version") != null) {
    const r = purgeSampleIntel(database, now);
    if (r.documents || r.entities || r.insights || r.relations || r.sources) console.log(`[intel] removed sample data from a production workspace: ${r.documents} records, ${r.entities} entities, ${r.relations} relations, ${r.insights} insights; ${r.sources} sources reset`);
    database.kv.delete("intel:seed:version");
    database.kv.delete("intel:analysis:seed:version");
    if (r.documents || r.insights) { database.kv.delete("intel:analysis:lastRun"); database.kv.delete("intel:last-sweep"); }
  }
  const sources = database.collection<IntelSource>(INTEL_COLLECTIONS.sources);
  const missing = referenceSources(now).filter((s) => !sources.has(s.id));
  if (missing.length) sources.putMany(missing);
  database.kv.set(REFERENCE_KEY, INTEL_REFERENCE_VERSION);
  return true;
}

export function seedIntel(database: Database): void {
  const now = new Date();
  const ts = now.toISOString();
  const sources = database.collection<IntelSource>(INTEL_COLLECTIONS.sources);
  const documents = database.collection<IntelDocument>(INTEL_COLLECTIONS.documents);
  const chunks = database.collection<IntelChunk>(INTEL_COLLECTIONS.chunks);
  const entities = database.collection<IntelEntity>(INTEL_COLLECTIONS.entities);

  // Sources: keep user edits (enabled, schedule, config) on re-seed; only fill in missing ones.
  const missing = systemSources(now).filter((s) => !sources.has(s.id));
  if (missing.length) sources.putMany(missing);

  // Entities.
  entities.putMany(SEED_ENTITIES.map((e): IntelEntity => {
    const existing = entities.get(e.id);
    return { id: e.id, type: e.type, name: e.name, canonical: e.name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(), aliases: e.aliases ?? [], attributes: { ...(existing?.attributes ?? {}), ...e.attributes, seeded: true }, mentionCount: existing?.mentionCount ?? 0, docIds: existing?.docIds ?? [], sources: existing?.sources ?? [], externalIds: e.externalIds, flags: existing?.flags, createdAt: existing?.createdAt ?? ts, updatedAt: ts };
  }));

  // Documents: rows, blobs, chunks and the keyword index (embeddings are added later by the doc.index job when a key exists).
  const rows: IntelDocument[] = [];
  const chunkRows: IntelChunk[] = [];
  const vectorDocs: { id: string; text: string; meta: Record<string, unknown> }[] = [];
  for (const s of SEED_DOCS) {
    const text = normalizeText(s.text);
    const sourceId = SEED_SOURCE_IDS[s.source];
    const adapter = (sources.get(sourceId)?.adapter ?? systemSources(now).find((x) => x.id === sourceId)!.adapter);
    const blobId = textBlobIdFor(s.id);
    database.blobs.put(new TextEncoder().encode(text), "text/plain; charset=utf-8", { id: blobId, name: `${s.title.slice(0, 80)}.txt`, meta: { docId: s.id, kind: s.kind, seeded: true } });
    const parts = chunkIntelText(text, { size: 1200, overlap: 150 });
    const existing = documents.get(s.id);
    const doc: IntelDocument = {
      id: s.id,
      sourceId,
      adapter,
      kind: s.kind,
      title: s.title,
      summary: s.summary,
      jurisdiction: s.jurisdiction,
      court: s.court,
      courtId: s.courtId,
      docketNumber: s.docketNumber,
      caseName: s.caseName,
      citation: s.citation,
      judgeIds: s.judgeIds ?? [],
      attorneyIds: s.attorneyIds ?? [],
      firmIds: s.firmIds ?? [],
      partyIds: s.partyIds ?? [],
      mdlId: s.mdlId,
      productIds: s.productIds ?? [],
      agencies: s.agencies ?? [],
      dates: s.dates,
      url: s.url,
      externalId: s.externalId,
      hash: contentHash(text),
      textBlobId: blobId,
      textLength: text.length,
      chunkCount: parts.length,
      matterIds: s.matterIds ?? [],
      tags: s.tags ?? [],
      flags: (s.flags ?? []).map((f) => ({ ...f, at: ts })),
      confidence: s.confidence ?? 0.8,
      meta: { ...(s.meta ?? {}), seeded: true, entities: s.entities ?? [] },
      fetchedAt: existing?.fetchedAt ?? ts,
      updatedAt: ts,
    };
    rows.push(doc);
    for (const c of parts) {
      const chunk: IntelChunk = { id: `${doc.id}#${c.idx}`, docId: doc.id, idx: c.idx, text: c.text, section: c.section, page: c.page, startChar: c.startChar, endChar: c.endChar, hash: contentHash(c.text) };
      chunkRows.push(chunk);
      vectorDocs.push({ id: chunk.id, text: chunkIndexText(chunk, doc.title), meta: docMetaForVector(doc, chunk) });
    }
  }
  documents.putMany(rows);
  chunks.putMany(chunkRows);
  void indexDocuments(INTEL_VECTOR_NAMESPACE, vectorDocs, { embed: false, chunkSize: 4000 }).catch((e) => console.error("[seed:intel] index", e));

  // Link seeded entities to their documents.
  const docIdsByEntity = new Map<string, string[]>();
  for (const d of rows) for (const id of [...d.judgeIds, ...d.attorneyIds, ...d.firmIds, ...d.partyIds, ...d.productIds, d.mdlId]) if (id) docIdsByEntity.set(id, [...(docIdsByEntity.get(id) ?? []), d.id]);
  for (const [id, docIds] of docIdsByEntity) {
    const e = entities.get(id);
    if (e) entities.put({ ...e, docIds: Array.from(new Set([...e.docIds, ...docIds])).slice(-200), mentionCount: Math.max(e.mentionCount, docIds.length), updatedAt: ts });
  }

  // Source stats reflect the seeded corpus.
  for (const s of sources.all()) {
    const mine = rows.filter((d) => d.sourceId === s.id);
    if (!mine.length) continue;
    sources.put({ ...s, stats: { ...s.stats, documents: documents.count((d) => d.sourceId === s.id), chunks: mine.reduce((n, d) => n + d.chunkCount, 0), entities: SEED_ENTITIES.length }, updatedAt: ts });
  }
  database.kv.set("intel:seed:version", INTEL_SEED_VERSION);
}

/**
 * Seed the intel layer lazily (cheap kv check). Demo mode: the sample corpus, for databases created
 * before the intel seeder was registered. Production: the neutral source catalog only.
 */
export function ensureIntelSeeded(database: Database = db()): boolean {
  if (!intelSampleMode()) return ensureIntelReference(database);
  if (database.kv.get<number>("intel:seed:version") === INTEL_SEED_VERSION) return false;
  seedIntel(database);
  return true;
}
