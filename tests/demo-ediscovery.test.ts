import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { EDocument, Person, ProductionSet, ReviewBatch, SavedSearchRecord } from "@/lib/types/domain";
import { APPLE_DEMO_BATES_PREFIX, APPLE_DEMO_COLLECTIONS, APPLE_DEMO_KV_KEYS, MARSH_CITES, OKORO_CITES, buildAppleEdiscoveryDemo } from "@/modules/demo/ediscovery";
import { DEMO_CUSTODIANS, DEMO_DEPOSITIONS, DEMO_MATTERS, DEMO_TEAM, isDemoRecord } from "@/modules/demo/ids";
import { matchesQuery, parseBates, parseQuery } from "@/modules/ediscovery/query";
import { normalizeBatesPrefix } from "@/modules/ediscovery/ingest";
import { toSearchable } from "@/modules/ediscovery/service";
import { REVIEW_COLLECTIONS } from "@/modules/ediscovery/review-store";
import { CODING_RULES_KEY } from "@/modules/ediscovery/rules";
import { SUGGESTED_TOPICS_KEY } from "@/modules/ediscovery/analysis/service";
import { findCrossReferences } from "@/modules/ediscovery/analysis/cross-references";
import { batchProgress } from "@/modules/ediscovery/batch-pure";
import type { Story } from "@/modules/ediscovery/analysis/types";

const M = DEMO_MATTERS.consumer;
const demo = buildAppleEdiscoveryDemo();
const docs = demo.edocs;
const byId = new Map(docs.map((d) => [d.id, d]));
const byBates = new Map(docs.map((d) => [d.bates, d]));
const coll = <T,>(name: string) => (demo.collections.find((c) => c.collection === name)?.docs ?? []) as unknown as T[];
const people = coll<Person>(APPLE_DEMO_COLLECTIONS.people);
const savedSearches = coll<SavedSearchRecord>(APPLE_DEMO_COLLECTIONS.savedSearches);
const batches = coll<ReviewBatch>(APPLE_DEMO_COLLECTIONS.batches);
const productions = coll<ProductionSet>(APPLE_DEMO_COLLECTIONS.productions);
const stories = coll<Story>(APPLE_DEMO_COLLECTIONS.stories);
const meta = (x: object) => (x as { meta?: Record<string, unknown> }).meta;
const BATES_TOKEN = new RegExp(`\\b${APPLE_DEMO_BATES_PREFIX}-\\d{7}\\b`, "g");

/** Resolve a Bates token to a document (start number or any page inside a multi-page range). */
function resolveBates(b: string): EDocument | undefined {
  const p = parseBates(b);
  if (!p) return undefined;
  return docs.find((d) => { const s = parseBates(d.bates)!.number; const e = d.batesEnd ? parseBates(d.batesEnd)!.number : s; return p.number >= s && p.number <= e; });
}

function allRecords(): { kind: string; rec: { id: string } }[] {
  return [
    ...docs.map((rec) => ({ kind: "edoc", rec })), ...demo.issueCodes.map((rec) => ({ kind: "issue", rec })), ...demo.depositions.map((rec) => ({ kind: "deposition", rec })),
    ...demo.timeline.map((rec) => ({ kind: "timeline", rec })), ...demo.relationships.map((rec) => ({ kind: "relationship", rec })), ...demo.conflicts.map((rec) => ({ kind: "conflict", rec })),
    ...demo.privilegeLog.map((rec) => ({ kind: "privilege", rec })), ...demo.collections.flatMap((c) => c.docs.map((rec) => ({ kind: c.collection, rec }))),
  ];
}

describe("Apple antitrust demo — e-discovery corpus", () => {
  it("builds fast and deterministically", () => {
    const t = performance.now();
    const again = buildAppleEdiscoveryDemo();
    expect(performance.now() - t).toBeLessThan(1000);
    const strip = (x: typeof demo) => JSON.parse(JSON.stringify({ ...x, textFor: undefined }));
    expect(strip(again)).toEqual(strip(demo));
    expect(again.textFor?.(docs[0].id)).toBe(demo.textFor?.(docs[0].id));
  });

  it("has the requested volume and variety", () => {
    expect(docs.length).toBeGreaterThanOrEqual(180);
    const types = new Set(docs.map((d) => d.type));
    for (const t of ["Email", "Memo", "Presentation", "Spreadsheet", "Chat", "Report", "Contract", "Other", "Letter", "Note"]) expect(types.has(t as EDocument["type"]), t).toBe(true);
    expect(docs.some((d) => d.tags?.includes("calendar-invite"))).toBe(true);
    expect(docs.filter((d) => d.tags?.includes("board-materials")).length).toBeGreaterThanOrEqual(2);
    expect(new Set(docs.map((d) => d.custodianId))).toEqual(new Set(Object.values(DEMO_CUSTODIANS)));
    const years = new Set(docs.map((d) => d.date.slice(0, 4)));
    for (let y = 2016; y <= 2023; y++) expect(years.has(String(y)), String(y)).toBe(true);
    for (const d of docs) { expect(d.date >= "2016-01-01" && d.date <= "2023-12-31", d.id).toBe(true); expect(d.matterId).toBe(M); }
    const hot = docs.filter((d) => d.coding.hot).length;
    expect(hot).toBeGreaterThanOrEqual(25);
    expect(hot).toBeLessThanOrEqual(40);
    const priv = docs.filter((d) => d.coding.privileged === true);
    expect(priv.length).toBeGreaterThanOrEqual(22);
    expect(priv.length).toBeLessThanOrEqual(30);
    const reviewed = docs.filter((d) => d.coding.responsive != null).length / docs.length;
    expect(reviewed).toBeGreaterThan(0.5);
    expect(reviewed).toBeLessThan(0.7);
    expect(docs.some((d) => d.coding.responsive === false)).toBe(true);
    expect(docs.filter((d) => d.aiScore != null && d.aiIssues && d.aiSummary).length).toBeGreaterThan(docs.length * 0.7);
    expect(demo.issueCodes.length).toBeGreaterThanOrEqual(10);
    const codes = new Set(demo.issueCodes.map((c) => c.code));
    for (const d of docs) for (const c of d.coding.issues ?? []) expect(codes.has(c), `${d.id} ${c}`).toBe(true);
    for (const c of demo.issueCodes) expect(c.count ?? 0, c.code).toBeGreaterThan(0);
  });

  it("assigns contiguous Bates numbers the review services can parse", () => {
    expect(normalizeBatesPrefix(APPLE_DEMO_BATES_PREFIX)).toBe(APPLE_DEMO_BATES_PREFIX);
    const sorted = [...docs].sort((a, b) => parseBates(a.bates)!.number - parseBates(b.bates)!.number);
    expect(sorted[0].bates).toBe(`${APPLE_DEMO_BATES_PREFIX}-0000001`);
    let next = 1;
    for (const d of sorted) {
      const s = parseBates(d.bates)!;
      expect(s.prefix).toBe(APPLE_DEMO_BATES_PREFIX);
      expect(s.number, d.id).toBe(next);
      const e = d.batesEnd ? parseBates(d.batesEnd)!.number : s.number;
      expect(e - s.number + 1).toBe(d.pages ?? 1);
      next = e + 1;
    }
    expect((demo.kv[APPLE_DEMO_KV_KEYS.settings] as { nextBates: number }).nextBates).toBe(next);
  });

  it("models families, exact duplicates and near-duplicates", () => {
    const parents = docs.filter((d) => d.family?.attachmentIds?.length);
    expect(parents.length).toBeGreaterThanOrEqual(4);
    for (const p of parents) for (const a of p.family!.attachmentIds!) {
      const att = byId.get(a)!;
      expect(att.family?.parentId).toBe(p.id);
      expect(parseBates(att.bates)!.number).toBeGreaterThan(parseBates(p.bates)!.number);
    }
    const threads = new Map<string, number>();
    for (const d of docs) if (d.family?.threadId) threads.set(d.family.threadId, (threads.get(d.family.threadId) ?? 0) + 1);
    expect([...threads.values()].filter((n) => n >= 3).length).toBeGreaterThanOrEqual(4);
    const dups = docs.filter((d) => d.isDuplicateOf);
    expect(dups.length).toBeGreaterThanOrEqual(3);
    for (const d of dups) { const o = byId.get(d.isDuplicateOf!)!; expect(d.hash).toBe(o.hash); expect(d.text).toBe(o.text); expect(d.custodianId).not.toBe(o.custodianId); }
    const near = docs.filter((d) => d.nearDuplicateIds?.length);
    expect(near.length).toBeGreaterThanOrEqual(4);
    for (const d of near) for (const id of d.nearDuplicateIds!) { expect(byId.get(id)?.nearDuplicateIds).toContain(d.id); expect(d.nearDuplicateScores?.[id]).toBeGreaterThanOrEqual(0.5); }
    // Only the intended draft/final pairs are near-duplicates — generated volume must not collapse into noise.
    expect(near.length).toBeLessThanOrEqual(10);
  });

  it("tags every record as synthetic demo data with unique ids", () => {
    const seen = new Map<string, string>();
    for (const { kind, rec } of allRecords()) {
      const m = meta(rec);
      expect(m?.demo, `${kind} ${rec.id}`).toBe("apple-antitrust");
      expect(m?.synthetic, `${kind} ${rec.id}`).toBe(true);
      expect(isDemoRecord(rec as { id: string; meta?: Record<string, unknown> }), rec.id).toBe(true);
      const key = `${kind === "edoc" ? "edoc" : kind}:${rec.id}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.set(key, kind);
    }
    const ids = allRecords().map((r) => r.rec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of docs) expect(d.text).toContain("Synthetic demonstration record");
    for (const r of [...demo.depositions, ...demo.timeline, ...demo.relationships, ...demo.conflicts, ...demo.privilegeLog, ...demo.issueCodes]) expect(r.matterId).toBe(M);
  });

  it("uses no real executive, judge or attorney names", () => {
    const DENY = [
      "Tim Cook", "Phil Schiller", "Craig Federighi", "Eddy Cue", "Greg Joswiak", "Jeff Williams", "Luca Maestri", "Kevan Parekh", "Katherine Adams", "Kate Adams",
      "Matt Fischer", "Ann Thai", "Trystan Kosmynka", "Jony Ive", "Scott Forstall", "Steve Jobs", "Deirdre O'Brien", "Lisa Jackson", "Johny Srouji", "John Ternus",
      "Sabih Khan", "Jennifer Bailey", "Kyle Andeer", "Oliver Schusser", "Tim Sweeney", "Yvonne Gonzalez Rogers", "Gonzalez Rogers", "Julien Neals", "Merrick Garland",
      "Jonathan Kanter", "Lina Khan", "Sundar Pichai", "Satya Nadella", "Mark Zuckerberg", "Elon Musk", "Cook", "Schiller", "Federighi", "Joswiak",
    ];
    const text = JSON.stringify({ ...demo, textFor: undefined });
    for (const name of DENY) expect(new RegExp(`\\b${name}\\b`).test(text), name).toBe(false);
  });

  it("keeps privilege-CC business emails out of the privileged set", () => {
    const counsel = new Set(["Hannah Cole", "Ruth Adeyemi"]);
    const cc = docs.filter((d) => d.tags?.includes("privilege-cc"));
    expect(cc.length).toBeGreaterThanOrEqual(2);
    for (const d of cc) {
      expect(d.coding.privileged, d.id).toBe(false);
      expect(d.coding.responsive).toBe(true);
      expect((d.cc ?? []).some((n) => counsel.has(n)), d.id).toBe(true);
      expect((d.to ?? []).some((n) => counsel.has(n)) || counsel.has(d.from ?? ""), d.id).toBe(false);
    }
    // Every privileged document involves counsel as author or direct recipient and is on the log.
    const logged = new Map(demo.privilegeLog.map((e) => [e.docId, e]));
    const lawyers = new Set([...counsel, "Colin Mercer"]);
    for (const d of docs.filter((x) => x.coding.privileged === true)) {
      expect(lawyers.has(d.from ?? "") || (d.to ?? []).some((n) => lawyers.has(n)), d.id).toBe(true);
      const e = logged.get(d.id);
      expect(e, d.id).toBeDefined();
      expect(e!.bates.startsWith(d.bates)).toBe(true);
      expect(e!.description.length).toBeGreaterThan(40);
    }
    expect(logged.size).toBe(docs.filter((x) => x.coding.privileged === true).length);
    expect(new Set(demo.privilegeLog.map((e) => e.status))).toEqual(new Set(["draft", "review", "final"]));
  });

  it("has three long transcripts with exhibits that resolve to the corpus", () => {
    expect(demo.depositions.map((d) => d.id).sort()).toEqual(Object.values(DEMO_DEPOSITIONS).sort());
    const docLikes = docs.map((d) => ({ id: d.id, bates: d.bates, batesEnd: d.batesEnd, subject: d.subject, date: d.date, type: d.type }));
    for (const dep of demo.depositions) {
      expect(dep.pages, dep.id).toBeGreaterThanOrEqual(120);
      expect(dep.transcript.length, dep.id).toBeGreaterThanOrEqual(70);
      expect(dep.transcript[dep.transcript.length - 1].page).toBeGreaterThanOrEqual(120);
      expect(Object.values(DEMO_CUSTODIANS)).toContain(dep.witnessId);
      for (let i = 1; i < dep.transcript.length; i++) {
        const a = dep.transcript[i - 1], b = dep.transcript[i];
        expect(a.page < b.page || (a.page === b.page && a.line < b.line), `${dep.id} ${b.page}:${b.line}`).toBe(true);
      }
      for (const q of dep.transcript) expect(q.line >= 1 && q.line <= 25 && q.page <= dep.pages).toBe(true);
      expect(dep.transcript.some((q) => q.objection)).toBe(true);
      expect(dep.transcript.some((q) => q.flags?.includes("privilege"))).toBe(true);
      for (const ex of dep.exhibits ?? []) {
        expect(byBates.get(ex.bates!), `${dep.id} ${ex.id}`).toBeDefined();
        expect(dep.transcript.some((q) => q.exhibit === ex.id), ex.id).toBe(true);
      }
      // Every Bates token quoted in testimony resolves to a document.
      for (const q of dep.transcript) for (const m of `${q.question} ${q.answer} ${q.note ?? ""}`.matchAll(BATES_TOKEN)) expect(resolveBates(m[0]), `${dep.id} ${q.page}:${q.line} ${m[0]}`).toBeDefined();
      // The app's own cross-reference scanner binds every exhibit to its document.
      const refs = findCrossReferences(dep, docLikes);
      for (const ex of dep.exhibits ?? []) expect(refs.some((r) => r.docId === byBates.get(ex.bates!)!.id && r.confidence >= 0.95), ex.id).toBe(true);
    }
  });

  it("preserves the late-qualification pair and a witness-vs-witness contradiction", () => {
    const marsh = demo.depositions.find((d) => d.id === DEMO_DEPOSITIONS.appStorePolicy)!;
    const early = marsh.transcript.find((q) => q.page === MARSH_CITES.admission.page && q.line === MARSH_CITES.admission.line)!;
    const late = marsh.transcript.find((q) => q.page === MARSH_CITES.qualification.page && q.line === MARSH_CITES.qualification.line)!;
    expect(early.page).toBe(18);
    expect(late.page).toBe(97);
    expect(early.flags).toContain("admission");
    expect(early.answer).toMatch(/keep the purchase in the app/);
    expect(late.answer).toMatch(/page 18/);
    expect(late.answer).toMatch(/incomplete/);
    expect(late.note).toMatch(/18:4/);
    const pair = demo.conflicts.find((c) => c.kind === "position_inconsistency")!;
    expect(pair.sides.map((s) => s.cite).sort()).toEqual(["Marsh 18:4", "Marsh 97:3"]);
    const okoro = demo.depositions.find((d) => d.id === DEMO_DEPOSITIONS.paymentsFinance)!;
    expect(okoro.transcript.find((q) => q.page === OKORO_CITES.passThrough.page && q.line === OKORO_CITES.passThrough.line)?.flags).toContain("admission");
    const tvt = demo.conflicts.filter((c) => c.kind === "testimony_vs_testimony");
    expect(tvt.length).toBeGreaterThanOrEqual(1);
    for (const c of tvt) expect(new Set(c.sides.filter((s) => s.sourceKind === "deposition").map((s) => s.sourceId)).size).toBeGreaterThanOrEqual(2);
  });

  it("cites only documents and testimony that exist (timeline, conflicts, relationships, story)", () => {
    const deps = new Map(demo.depositions.map((d) => [d.id, d]));
    const WIT: Record<string, string> = { Marsh: DEMO_DEPOSITIONS.appStorePolicy, Okoro: DEMO_DEPOSITIONS.paymentsFinance, Frey: DEMO_DEPOSITIONS.wearables };
    const qaAt = (cite: string) => { const m = cite.match(/^(\w+) (\d+):(\d+)$/); if (!m) return undefined; return deps.get(WIT[m[1]])?.transcript.find((q) => q.page === Number(m[2]) && q.line === Number(m[3])); };
    expect(demo.timeline.length).toBeGreaterThanOrEqual(40);
    for (const ev of demo.timeline) {
      expect(ev.sources.length, ev.id).toBeGreaterThan(0);
      for (const s of ev.sources) {
        if (s.kind === "document") { const d = byId.get(s.id!); expect(d, ev.id).toBeDefined(); expect(d!.bates).toBe(s.bates); if (s.excerpt) expect(d!.text).toContain(s.excerpt); }
        if (s.kind === "deposition") { expect(deps.has(s.id!)).toBe(true); expect(qaAt(s.cite!), `${ev.id} ${s.cite}`).toBeDefined(); }
      }
    }
    expect(demo.timeline.filter((e) => e.sources.some((s) => s.kind === "document")).length).toBeGreaterThanOrEqual(35);
    expect(demo.conflicts.length).toBeGreaterThanOrEqual(6);
    for (const c of demo.conflicts) {
      expect(c.sides.length).toBeGreaterThanOrEqual(2);
      for (const s of c.sides) {
        if (s.sourceKind === "document") { const d = byId.get(s.sourceId)!; expect(d, c.id).toBeDefined(); expect(d.bates).toBe(s.cite); expect(d.text).toContain(s.excerpt); }
        else { const q = qaAt(s.cite)!; expect(q, `${c.id} ${s.cite}`).toBeDefined(); expect(deps.has(s.sourceId)).toBe(true); expect(q.answer).toBe(s.excerpt); }
      }
    }
    const personIds = new Set([...people.map((p) => p.id), ...Object.values(DEMO_TEAM)]);
    for (const r of demo.relationships) {
      expect(personIds.has(r.fromId), `${r.id} from ${r.fromId}`).toBe(true);
      expect(personIds.has(r.toId), `${r.id} to ${r.toId}`).toBe(true);
      expect(r.fromId).not.toBe(r.toId);
      for (const e of r.evidence ?? []) if (e.bates) { expect(byId.get(e.docId!)?.bates, r.id).toBe(e.bates); }
    }
    expect(new Set(demo.relationships.map((r) => r.kind)).size).toBeGreaterThanOrEqual(8);
    for (const ev of demo.timeline) for (const p of ev.personIds ?? []) expect(personIds.has(p), `${ev.id} ${p}`).toBe(true);
    const tlIds = new Set(demo.timeline.map((e) => e.id));
    expect(stories).toHaveLength(1);
    for (const f of stories[0].facts) for (const e of f.evidence) {
      if (e.kind === "document") expect(byId.get(e.docId!)?.bates).toBe(e.bates);
      if (e.kind === "testimony") expect(deps.get(e.depositionId)?.transcript.some((q) => q.page === e.page && q.line === e.line), `${f.id}`).toBe(true);
      if (e.kind === "event") expect(tlIds.has(e.eventId)).toBe(true);
    }
    // Every Bates token anywhere in the analysis records resolves.
    const analysisText = JSON.stringify([demo.timeline, demo.conflicts, demo.relationships, stories, demo.depositions]);
    for (const m of analysisText.matchAll(BATES_TOKEN)) expect(resolveBates(m[0]), m[0]).toBeDefined();
  });

  it("ships review workflow records that pass the service validations", () => {
    expect(APPLE_DEMO_COLLECTIONS.batches).toBe(REVIEW_COLLECTIONS.batches);
    expect(APPLE_DEMO_COLLECTIONS.savedSearches).toBe(REVIEW_COLLECTIONS.savedSearches);
    expect(APPLE_DEMO_COLLECTIONS.productions).toBe(REVIEW_COLLECTIONS.productions);
    expect(APPLE_DEMO_KV_KEYS.rules).toBe(CODING_RULES_KEY(M));
    expect(APPLE_DEMO_KV_KEYS.topics).toBe(SUGGESTED_TOPICS_KEY(M));
    expect(typeof demo.kv[APPLE_DEMO_KV_KEYS.rules]).toBe("string");

    expect(savedSearches.length).toBeGreaterThanOrEqual(4);
    expect(savedSearches.length).toBeLessThanOrEqual(5);
    for (const s of savedSearches) {
      const parsed = parseQuery(s.q);
      expect(parsed.warnings, s.name).toEqual([]);
      expect(docs.filter((d) => matchesQuery(toSearchable(d), parsed.ast)).length, s.name).toBeGreaterThan(0);
    }

    expect(batches).toHaveLength(3);
    const codingOf = (id: string) => byId.get(id)?.coding;
    for (const b of batches) {
      expect(b.docIds.length, b.id).toBeGreaterThan(0);
      for (const id of b.docIds) expect(byId.has(id)).toBe(true);
      for (const id of b.qcSampleIds) expect(b.docIds).toContain(id);
      for (const id of Object.keys(b.qcDecisions)) expect(b.qcSampleIds).toContain(id);
      const p = batchProgress(b, codingOf);
      expect(p.coded, b.id).toBeGreaterThan(0);
      expect(b.status).not.toBe("complete");
    }
    expect(batches.some((b) => batchProgress(b, codingOf).remaining > 0)).toBe(true);
    expect(batches.some((b) => Object.values(b.qcDecisions).some((d) => !d.agree))).toBe(true);

    expect(productions).toHaveLength(1);
    const prod = productions[0];
    expect(prod.volume).toBe("VOL001");
    expect(prod.docIds.length).toBeGreaterThanOrEqual(10);
    expect(prod.qc?.ok).toBe(true);
    for (const id of prod.docIds) {
      const d = byId.get(id)!;
      expect(d.coding.responsive).toBe(true);
      expect(d.coding.privileged).not.toBe(true);
      expect(d.isDuplicateOf).toBeUndefined();
      expect(prod.bates[id]?.pages).toBe(d.pages ?? 1);
    }
  });

  it("uses no clock or randomness in the pack sources", () => {
    const dir = path.resolve(__dirname, "../src/modules/demo/ediscovery");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(/Math\.random|Date\.now|new Date\(\)/.test(src), f).toBe(false);
    }
  });
});
