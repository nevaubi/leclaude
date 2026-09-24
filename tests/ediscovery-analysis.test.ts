import { beforeAll, describe, expect, it } from "vitest";
import { db, resetSqlite } from "@/lib/db";
import { MATTERS, PEOPLE } from "@/lib/seed/ids";
import type { Conflict, Person, Relationship, TimelineEvent } from "@/lib/types/domain";
import { searchTranscripts, designationsCsv, designationsMarkdown, summarizeObjections, qaInRange, normalizeRange, highlightTerms, transcriptText, resolvePageLine, pageLineOf } from "@/modules/ediscovery/analysis/transcript";
import { dedupeEvents, sortEvents, filterEvents, chronologyCsv, chronologyMarkdown, eventKey } from "@/modules/ediscovery/analysis/chronology";
import { buildGraph, resolvePersonName } from "@/modules/ediscovery/analysis/graph";
import { VOSS_DEPOSITION } from "@/modules/ediscovery/analysis/seed-depo-voss";
import { HALE_DEPOSITION } from "@/modules/ediscovery/analysis/seed-depo-hale";
import { PRYCE_DEPOSITION } from "@/modules/ediscovery/analysis/seed-depo-pryce";
import { AFFF_TIMELINE } from "@/modules/ediscovery/analysis/seed-timeline";
import { AFFF_CONFLICTS } from "@/modules/ediscovery/analysis/seed-conflicts";
import { ANALYSIS_SEED_IDS, EXPLICIT_RELATIONSHIPS, deriveEmailRelationships, seedAnalysis } from "@/modules/ediscovery/analysis/seed";
import { listDepositions, getDeposition, toggleFlag, updateQA, createDesignation, listDesignations, deleteDesignation, searchAllTranscripts, crossAnalysis, listEvents, createEvent, updateEvent, mergeEvents, eventsFromDocuments, graph, personDetail, createRelationship, listConflicts, createConflict, updateConflict, addConflictNote, getConflict, conflictsCsv, overview, resolveExhibit, objectionSummary, objectionRulings, setObjectionRuling } from "@/modules/ediscovery/analysis/service";
import { digestDeposition, findContradictions, buildFactMatrix, extractTimelineEvents, knowledgeMap, prepareOutline } from "@/modules/ediscovery/analysis/ai";

const AFFF = MATTERS.afff;

beforeAll(() => { resetSqlite(); delete process.env.OPENAI_API_KEY; });

// ---------------------------------------------------------------------------
describe("seed content", () => {
  it("seeds three full depositions with ≥35 Q/A pairs spanning ≥60 pages, objections from both sides, exhibits and flags", () => {
    for (const dep of [VOSS_DEPOSITION, HALE_DEPOSITION, PRYCE_DEPOSITION]) {
      expect(dep.transcript.length, dep.witnessName).toBeGreaterThanOrEqual(35);
      const pages = dep.transcript.map((q) => q.page);
      expect(Math.max(...pages) - Math.min(...pages), dep.witnessName).toBeGreaterThanOrEqual(60);
      // page:line monotonic
      for (let i = 1; i < dep.transcript.length; i++) {
        const a = dep.transcript[i - 1], b = dep.transcript[i];
        expect(b.page > a.page || (b.page === a.page && b.line > a.line), `${dep.witnessName} order at ${i}`).toBe(true);
        expect(b.line).toBeLessThanOrEqual(25);
      }
      const objectors = new Set(dep.transcript.filter((q) => q.objection).map((q) => q.objection!.by));
      expect(objectors.has("Jordan Whitfield"), dep.witnessName).toBe(true);
      expect(objectors.has("Rebecca Klein"), dep.witnessName).toBe(true);
      expect(dep.transcript.some((q) => q.exhibit)).toBe(true);
      expect(dep.transcript.some((q) => q.flags?.includes("admission"))).toBe(true);
      expect(dep.transcript.some((q) => q.flags?.includes("contradiction"))).toBe(true);
      // every exhibit Bates resolves to a seeded document
      for (const ex of dep.exhibits ?? []) expect(db().edocs.findOne((d) => d.bates === ex.bates), `${dep.witnessName} ${ex.id} ${ex.bates}`).not.toBeNull();
    }
  });
  it("seeds ≥40 timeline events 1998–2027 citing seeded Bates numbers", () => {
    expect(AFFF_TIMELINE.length).toBeGreaterThanOrEqual(40);
    expect(AFFF_TIMELINE[0].date.slice(0, 4)).toBe("1998");
    expect(new Set(AFFF_TIMELINE.map((e) => e.id)).size).toBe(AFFF_TIMELINE.length);
    for (const e of AFFF_TIMELINE) for (const s of e.sources) {
      if (s.kind === "document") { expect(db().edocs.get(s.id!), `${e.title} ${s.bates}`).not.toBeNull(); expect(db().edocs.get(s.id!)!.bates).toBe(s.bates); }
      if (s.kind === "deposition") expect(db().depositions.get(s.id!), `${e.title} ${s.id}`).not.toBeNull();
    }
    const cats = new Set(AFFF_TIMELINE.map((e) => e.category));
    expect(cats.size).toBeGreaterThanOrEqual(6);
  });
  it("seeds ≥60 relationships (explicit + derived from email headers) and ≥8 conflicts", () => {
    const rels = db().relationships.find((r) => r.matterId === AFFF);
    expect(rels.length).toBeGreaterThanOrEqual(60);
    expect(EXPLICIT_RELATIONSHIPS.some((r) => r.kind === "reports_to")).toBe(true);
    expect(EXPLICIT_RELATIONSHIPS.some((r) => r.kind === "retained")).toBe(true);
    expect(EXPLICIT_RELATIONSHIPS.some((r) => r.kind === "represents")).toBe(true);
    const derived = deriveEmailRelationships(db().edocs.find((d) => d.matterId === AFFF), db().people.all());
    expect(derived.length).toBeGreaterThan(20);
    const vossToHale = derived.find((r) => r.fromId === PEOPLE.helenVoss && r.toId === PEOPLE.gregoryHale && r.kind === "emailed");
    expect(vossToHale?.weight).toBeGreaterThan(1);
    expect(vossToHale?.evidence?.[0]?.bates).toMatch(/^MFC-/);
    for (const r of rels) { expect(db().people.get(r.fromId), r.id).not.toBeNull(); expect(db().people.get(r.toId), r.id).not.toBeNull(); }
    expect(AFFF_CONFLICTS.length).toBeGreaterThanOrEqual(8);
    for (const c of AFFF_CONFLICTS) for (const s of c.sides) {
      if (s.sourceKind === "deposition") expect(db().depositions.get(s.sourceId), c.id).not.toBeNull();
      else expect(db().edocs.get(s.sourceId), `${c.id} ${s.cite}`).not.toBeNull();
    }
    expect(db().conflicts.count((c) => c.matterId === AFFF)).toBe(AFFF_CONFLICTS.length);
  });
  it("is idempotent across repeated seeding", () => {
    const before = { deps: db().depositions.count(), rels: db().relationships.count(), tl: db().timeline.count(), cf: db().conflicts.count() };
    seedAnalysis(db());
    seedAnalysis(db());
    expect({ deps: db().depositions.count(), rels: db().relationships.count(), tl: db().timeline.count(), cf: db().conflicts.count() }).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
describe("transcript search", () => {
  const deps = [VOSS_DEPOSITION, HALE_DEPOSITION, PRYCE_DEPOSITION];
  it("finds answers across witnesses, ranks answers above questions and returns page:line", () => {
    const hits = searchTranscripts(deps, "preliminary");
    expect(hits.length).toBeGreaterThan(3);
    expect(new Set(hits.map((h) => h.depositionId)).size).toBeGreaterThanOrEqual(2);
    const top = hits[0];
    expect(top.page).toBeGreaterThan(0);
    expect(top.snippet.toLowerCase()).toContain("preliminary");
    expect(hits.every((h) => h.snippet.toLowerCase().includes("preliminary"))).toBe(true);
  });
  it("requires every token (AND) and supports exact phrases", () => {
    expect(searchTranscripts(deps, "adenomas high-dose controls").length).toBeGreaterThan(0);
    expect(searchTranscripts(deps, "adenomas zebra", { mode: "any" }).length).toBeGreaterThan(0);
    expect(searchTranscripts(deps, "liver zebra").length).toBe(0);
    const phrase = searchTranscripts(deps, '"do not put this in email"');
    expect(phrase.length).toBeGreaterThan(0);
    expect(phrase.every((h) => h.depositionId === HALE_DEPOSITION.id || h.depositionId === PRYCE_DEPOSITION.id)).toBe(true);
    expect(searchTranscripts(deps, "").length).toBe(0);
  });
  it("filters by flag and builds a highlight regex", () => {
    const flagged = searchTranscripts(deps, "study", { flags: ["admission"] });
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((h) => deps.find((d) => d.id === h.depositionId)!.transcript[h.index].flags?.includes("admission"))).toBe(true);
    expect("The MW-7 result".replace(highlightTerms("mw-7 result")!, "[$1]")).toBe("The [MW-7] [result]");
    expect(highlightTerms("")).toBeNull();
  });
  it("searches the persisted transcripts through the service", () => {
    const hits = searchAllTranscripts(AFFF, "41 micrograms");
    expect(hits.some((h) => h.witnessName === "Gregory Hale")).toBe(true);
    expect(searchAllTranscripts(AFFF, "bioassay", { depositionId: VOSS_DEPOSITION.id }).every((h) => h.depositionId === VOSS_DEPOSITION.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("designations and objections", () => {
  it("resolves page:line locators to the Q/A pair that contains them", () => {
    const t = VOSS_DEPOSITION.transcript;
    expect(resolvePageLine(t, `${t[3].page}:${t[3].line}`)).toBe(3);
    // a line inside a pair (but not its first line) resolves to that pair
    const i = t.findIndex((qa, k) => k < t.length - 1 && (t[k + 1].page > qa.page || t[k + 1].line > qa.line + 1));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(resolvePageLine(t, `${t[i].page}:${t[i].line + 1}`)).toBe(i);
    // a page far beyond the excerpt is not found; garbage is rejected
    expect(resolvePageLine(t, "9999:1")).toBe(-1);
    expect(resolvePageLine(t, "abc")).toBe(-1);
    expect(pageLineOf("Hale 46:07–46:20")).toBe("46:7");
    expect(pageLineOf("MFC-0041877")).toBeNull();
  });
  it("normalises reversed ranges and selects the Q/A pairs inside", () => {
    expect(normalizeRange({ startPage: 24, startLine: 5, endPage: 19, endLine: 15 })).toEqual({ startPage: 19, startLine: 15, endPage: 24, endLine: 5 });
    const inside = qaInRange(VOSS_DEPOSITION.transcript, { startPage: 19, startLine: 15, endPage: 22, endLine: 19 });
    expect(inside.map(({ qa }) => `${qa.page}:${qa.line}`)).toEqual(["19:15", "20:8", "20:17", "22:2", "22:11", "22:19"]);
  });
  it("exports designations as CSV with vendor columns and as markdown with excerpts", () => {
    const d1 = createDesignation({ matterId: AFFF, depositionId: VOSS_DEPOSITION.id, startPage: 22, startLine: 19, endPage: 19, endLine: 15, purpose: "impeachment", note: "\"Final\" sequence" });
    const d2 = createDesignation({ matterId: AFFF, depositionId: VOSS_DEPOSITION.id, startPage: 91, startLine: 18, endPage: 93, endLine: 14, purpose: "affirmative" });
    expect(d1.startPage).toBe(19); // normalised
    const list = listDesignations(VOSS_DEPOSITION.id);
    expect(list.map((d) => d.id)).toEqual([d1.id, d2.id]);
    const csv = designationsCsv(VOSS_DEPOSITION, list);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Witness,Deposition date,Begin page,Begin line,End page,End line,Range,Purpose,Note,Excerpt");
    expect(lines[1].startsWith("Helen Voss,2026-06-17,19,15,22,19,19:15–22:19,impeachment,")).toBe(true);
    expect(lines[1]).toContain('"""Final"" sequence"');
    expect(lines).toHaveLength(3);
    const md = designationsMarkdown(VOSS_DEPOSITION, list, { matterName: "AFFF" });
    expect(md).toContain("# Deposition designations — Helen Voss");
    expect(md).toContain("| 1 | 19:15–22:19 | impeachment |");
    expect(md).toContain("**19:15** Q. The document is titled 'final report summary.'");
    expect(md).toContain("## 2. 91:18–93:14 (affirmative)");
    expect(deleteDesignation(d1.id)).toBe(true);
    expect(deleteDesignation(d2.id)).toBe(true);
    expect(listDesignations(VOSS_DEPOSITION.id)).toHaveLength(0);
  });
  it("summarises objections by basis and attorney", () => {
    const s = summarizeObjections(VOSS_DEPOSITION.transcript);
    expect(s.total).toBeGreaterThan(8);
    expect(s.byAttorney[0].attorney).toBe("Jordan Whitfield");
    expect(s.byBasis.find((b) => b.basis === "privilege")!.count).toBeGreaterThanOrEqual(3);
    expect(s.rulings.pending).toBe(s.total);
    expect(s.byBasis.reduce((n, b) => n + b.count, 0)).toBe(s.total);
    const idx = VOSS_DEPOSITION.transcript.findIndex((qa) => qa.objection);
    const ruled = summarizeObjections(VOSS_DEPOSITION.transcript, { [idx]: "sustained", 999: "overruled" });
    expect(ruled.rulings).toEqual({ sustained: 1, overruled: 0, pending: s.total - 1 });
  });
  it("records objection rulings in a module-private store and rejects Q/A without an objection", () => {
    seedAnalysis(db());
    const dep = getDeposition(ANALYSIS_SEED_IDS.depositions.voss)!;
    const withObjection = dep.transcript.findIndex((qa) => qa.objection);
    const without = dep.transcript.findIndex((qa) => !qa.objection);
    expect(objectionSummary(dep.id)!.rulings.sustained).toBe(0);
    const rec = setObjectionRuling(dep.id, withObjection, "sustained");
    expect(rec).toMatchObject({ id: `${dep.id}:${withObjection}`, ruling: "sustained", depositionId: dep.id });
    expect(objectionRulings(dep.id)).toEqual({ [withObjection]: "sustained" });
    expect(objectionSummary(dep.id)!.rulings.sustained).toBe(1);
    expect(() => setObjectionRuling(dep.id, without, "overruled")).toThrow(/No objection/);
    expect(() => setObjectionRuling(dep.id, 10_000, "overruled")).toThrow(/out of range/);
    expect(setObjectionRuling("dep_missing", 0, "overruled")).toBeNull();
    // back to pending clears the record; the deposition itself is untouched
    setObjectionRuling(dep.id, withObjection, "pending");
    expect(objectionRulings(dep.id)).toEqual({});
    expect(getDeposition(dep.id)!.transcript[withObjection]).toEqual(dep.transcript[withObjection]);
  });
  it("renders transcript text for prompts with cites, objections and exhibits", () => {
    const t = transcriptText(VOSS_DEPOSITION, { indexes: [6, 7] });
    expect(t).toContain("19:03\nQ. I am handing you what has been marked Voss Exhibit 1.");
    expect(t).toContain("(Exhibit Voss-1)");
    expect(t).toContain("[contradiction, key]");
  });
});

// ---------------------------------------------------------------------------
describe("deposition service", () => {
  it("lists depositions with counts and resolves exhibits to documents", () => {
    const list = listDepositions(AFFF);
    expect(list.map((d) => d.id)).toContain(ANALYSIS_SEED_IDS.depositions.voss);
    const voss = list.find((d) => d.id === ANALYSIS_SEED_IDS.depositions.voss)!;
    expect(voss.qaCount).toBe(VOSS_DEPOSITION.transcript.length);
    expect(voss.flagCounts.admission).toBeGreaterThan(5);
    expect(voss.objectionCount).toBeGreaterThan(5);
    expect(voss.hasDigest).toBe(false);
    expect((voss as unknown as { transcript?: unknown }).transcript).toBeUndefined();
    expect(list.filter((d) => d.status === "scheduled").length).toBe(2);
    const dep = getDeposition(voss.id)!;
    expect(resolveExhibit(dep, "Voss-1").docId).toBe("ed_afff_0001");
    expect(resolveExhibit(dep, "MFC-0041880").docId).toBe("ed_afff_0002");
    expect(resolveExhibit(dep, "Nope-9").docId).toBeUndefined();
  });
  it("toggles flags and edits notes on a Q/A pair", () => {
    const id = ANALYSIS_SEED_IDS.depositions.hale;
    const before = getDeposition(id)!.transcript[0].flags ?? [];
    expect(before).not.toContain("key");
    toggleFlag(id, 0, "key");
    expect(getDeposition(id)!.transcript[0].flags).toContain("key");
    toggleFlag(id, 0, "key");
    expect(getDeposition(id)!.transcript[0].flags).toBeUndefined();
    updateQA(id, 0, { note: "Check spelling on the record." });
    expect(getDeposition(id)!.transcript[0].note).toBe("Check spelling on the record.");
    updateQA(id, 0, { note: null });
    expect(getDeposition(id)!.transcript[0].note).toBeUndefined();
    expect(() => updateQA(id, 9999, { note: "x" })).toThrow(/out of range/);
  });
  it("cross-analysis returns testimony, BM25 document passages and matching seeded conflicts without a key", async () => {
    const res = await crossAnalysis(AFFF, { topic: "preliminary final report", witnessId: PEOPLE.helenVoss });
    expect(res.aiConfigured).toBe(false);
    expect(res.testimony.length).toBeGreaterThan(0);
    expect(res.testimony[0].cite).toMatch(/^Voss \d+:\d{2}$/);
    expect(res.documents.length).toBeGreaterThan(0);
    expect(res.documents[0].cite).toMatch(/^MFC-/);
    expect(res.otherTestimony.every((t) => t.label !== "Helen Voss")).toBe(true);
    expect(res.conflicts.some((c) => c.id === "cf_afff_001")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("chronology", () => {
  const base = (over: Partial<TimelineEvent>): TimelineEvent => ({ id: "x", matterId: AFFF, date: "2001-03-14", title: "Whitfield final report received", category: "scientific", significance: 3, sources: [{ kind: "document", bates: "MFC-0041877", id: "ed_afff_0001" }], createdBy: "ai", ...over });
  it("sorts by date then significance and normalises keys for dedupe", () => {
    const sorted = sortEvents([base({ id: "b", date: "2002-01-01" }), base({ id: "a", significance: 5, title: "Zeta" }), base({ id: "c", significance: 3, title: "Alpha" })]);
    expect(sorted.map((e) => e.id)).toEqual(["a", "c", "b"]);
    expect(eventKey({ date: "2001-03-14", title: "The Whitfield FINAL report, received!" })).toBe(eventKey({ date: "2001-03-14", title: "Whitfield final report received" }));
  });
  it("dedupes by date+title, unions sources and keeps the longer description", () => {
    const existing = [base({ id: "e1", description: "short" })];
    const incoming = [base({ id: "n1", description: "a much longer description of the event", significance: 5, sources: [{ kind: "document", bates: "MFC-0041880", id: "ed_afff_0002" }] }), base({ id: "n2", date: "2001-03-15", title: "Pryce restricts distribution" })];
    const res = dedupeEvents(existing, incoming);
    expect(res.added.map((e) => e.id)).toEqual(["n2"]);
    expect(res.merged).toHaveLength(2);
    const merged = res.merged.find((e) => e.id === "e1")!;
    expect(merged.sources.map((s) => s.bates)).toEqual(["MFC-0041877", "MFC-0041880"]);
    expect(merged.description).toBe("a much longer description of the event");
    expect(merged.significance).toBe(5);
  });
  it("filters by category, person, significance, dates, source kind and text", () => {
    const events = listEvents(AFFF);
    expect(events.length).toBe(AFFF_TIMELINE.length);
    expect(filterEvents(events, { categories: ["testimony"] }).every((e) => e.category === "testimony")).toBe(true);
    expect(filterEvents(events, { personId: PEOPLE.helenVoss }).length).toBeGreaterThan(5);
    expect(filterEvents(events, { minSignificance: 5 }).every((e) => e.significance === 5)).toBe(true);
    expect(filterEvents(events, { from: "2002-07-01", to: "2002-07-31" }).map((e) => e.date.slice(0, 7))).toEqual(expect.arrayContaining(["2002-07"]));
    expect(filterEvents(events, { from: "2002-07-01", to: "2002-07-31" }).every((e) => e.date.startsWith("2002-07"))).toBe(true);
    expect(filterEvents(events, { sourceKind: "external" }).length).toBeGreaterThan(0);
    expect(filterEvents(events, { q: "MFC-0052210" }).length).toBeGreaterThan(0);
    expect(filterEvents(events, { disputedOnly: true }).every((e) => e.disputed)).toBe(true);
  });
  it("creates, updates and merges events through the service and exports CSV/markdown", () => {
    const e = createEvent(AFFF, { date: "2001-03-20", title: "Sponsor QA re-analysis: half-life 98–103 days", category: "scientific", significance: 4, sources: [{ kind: "document", id: "ed_afff_0017", bates: "MFC-0041922" }] });
    expect(e.id).toMatch(/^tl_/);
    updateEvent(e.id, { verified: true, disputed: true });
    expect(db().timeline.get(e.id)?.verified).toBe(true);
    const again = mergeEvents(AFFF, [{ ...e, id: "tl_dup", description: "Recovery-group serum re-analysed." }]);
    expect(again.added).toHaveLength(0);
    expect(again.merged).toBe(1);
    expect(db().timeline.get(e.id)?.description).toBe("Recovery-group serum re-analysed.");
    const meta = eventsFromDocuments(AFFF, ["ed_afff_0057", "ed_afff_0059", "missing"]);
    expect(meta).toHaveLength(2);
    expect(meta[0].sources[0].bates).toBe("MFC-0052210");
    expect(meta[0].personIds).toContain(PEOPLE.gregoryHale);
    const csv = chronologyCsv(listEvents(AFFF), new Map([[PEOPLE.helenVoss, "Helen Voss"]]));
    expect(csv.split("\r\n")[0]).toBe("Date,End date,Precision,Event,Description,Category,Significance,Sources,People,Verified,Disputed,Created by");
    expect(csv).toContain("MFC-0041877");
    const md = chronologyMarkdown(listEvents(AFFF), { title: "Chronology", matterName: "AFFF" });
    expect(md).toContain("| Date | Event | Category | Sources | Status |");
    expect(md).toContain("### Mar 14, 2001 — Whitfield final report");
    expect(db().timeline.delete(e.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("graph builder", () => {
  const people: Person[] = [
    { id: "a", name: "Helen Voss", role: "custodian", organization: "Meridian" },
    { id: "b", name: "Gregory Hale", role: "custodian", organization: "Meridian" },
    { id: "c", name: "Dr. Linda Whitfield", role: "expert", organization: "Whitfield Labs" },
    { id: "d", name: "Nobody Here", role: "other", organization: "Elsewhere" },
  ];
  const rels: Relationship[] = [
    { id: "r1", matterId: AFFF, fromId: "a", toId: "b", kind: "emailed", weight: 3, evidence: [{ bates: "MFC-1" }] },
    { id: "r2", matterId: AFFF, fromId: "a", toId: "b", kind: "emailed", weight: 2, evidence: [{ bates: "MFC-2" }] },
    { id: "r3", matterId: AFFF, fromId: "a", toId: "c", kind: "retained", weight: 4 },
    { id: "r4", matterId: AFFF, fromId: "a", toId: "zzz", kind: "other", weight: 1 },
  ];
  it("aggregates parallel edges, sizes nodes by document counts, clusters by organisation and drops unknown ids", () => {
    const g = buildGraph(people, rels, [{ id: "d1", from: "Helen Voss", to: ["Gregory Hale", "Dr. Whitfield"], custodianId: "a" }, { id: "d2", from: "Hale, Gregory", to: ["Voss"], custodianId: "b" }]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    const a = g.nodes.find((n) => n.id === "a")!;
    expect(a.authored).toBe(1);
    expect(a.received).toBe(1);
    expect(a.docCount).toBe(2);
    expect(a.degree).toBe(9);
    expect(g.edges).toHaveLength(2);
    const ab = g.edges.find((e) => e.kind === "emailed")!;
    expect(ab.weight).toBe(5);
    expect(ab.evidence.map((e) => e.bates)).toEqual(["MFC-1", "MFC-2"]);
    expect(g.clusters.map((c) => c.id)).toEqual(["Meridian", "Whitfield Labs"]);
    expect(g.clusters[0].size).toBe(2);
  });
  it("resolves header names with titles, initials and last-name-only forms", () => {
    expect(resolvePersonName("Dr. Linda Whitfield", people)?.id).toBe("c");
    expect(resolvePersonName("Voss", people)?.id).toBe("a");
    expect(resolvePersonName("G. Hale", people)?.id).toBe("b");
    expect(resolvePersonName("Unknown Person", people)).toBeUndefined();
  });
  it("builds the seeded matter graph with custodians, counsel and external parties", () => {
    const g = graph(AFFF);
    expect(g.nodes.length).toBeGreaterThan(15);
    expect(g.edges.length).toBeGreaterThan(40);
    const voss = g.nodes.find((n) => n.id === PEOPLE.helenVoss)!;
    expect(voss.authored).toBeGreaterThan(10);
    expect(voss.depositions).toBe(1);
    expect(g.nodes.find((n) => n.id === "x_afff_jrourke")?.organization).toBe("Illinois EPA");
    expect(g.clusters[0].id).toBe("Meridian Fluorochem Corp.");
    const detail = personDetail(AFFF, PEOPLE.alanPryce)!;
    expect(detail.authored.length).toBeGreaterThan(5);
    expect(detail.depositions.some((d) => d.witnessName === "Alan Pryce")).toBe(true);
    expect(detail.relationships.some((r) => r.kind === "reports_to" && r.direction === "out")).toBe(true);
    expect(detail.conflicts.some((c) => c.id === "cf_afff_004")).toBe(true);
    expect(detail.timeline.length).toBeGreaterThan(5);
    expect(personDetail(AFFF, "nobody")).toBeNull();
  });
  it("adds a relationship with validation", () => {
    const r = createRelationship(AFFF, { fromId: PEOPLE.nadiaBrooks, toId: PEOPLE.helenVoss, kind: "meeting", label: "MSDS drafting" });
    expect(db().relationships.get(r.id)).not.toBeNull();
    expect(graph(AFFF).edges.some((e) => e.id === r.id)).toBe(true);
    expect(() => createRelationship(AFFF, { fromId: PEOPLE.nadiaBrooks, toId: PEOPLE.nadiaBrooks, kind: "meeting" })).toThrow(/two different/);
    expect(() => createRelationship(AFFF, { fromId: "ghost", toId: PEOPLE.nadiaBrooks, kind: "meeting" })).toThrow(/Unknown person/);
    db().relationships.delete(r.id);
  });
});

// ---------------------------------------------------------------------------
describe("conflicts", () => {
  it("lists seeded conflicts open-first by severity with witness names and filters", () => {
    const rows = listConflicts(AFFF);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows[0].status).toBe("open");
    expect(rows[0].severity).toBe("high");
    expect(rows.find((c) => c.id === "cf_afff_001")!.witnessNames).toEqual(["Helen Voss"]);
    expect(listConflicts(AFFF, { witnessId: PEOPLE.gregoryHale }).every((c) => c.witnessNames.includes("Gregory Hale"))).toBe(true);
    expect(listConflicts(AFFF, { status: "dismissed" }).map((c) => c.id)).toEqual(["cf_afff_011"]);
    expect(listConflicts(AFFF, { kind: "date_inconsistency" }).length).toBe(2);
    expect(listConflicts(AFFF, { q: "budget" }).map((c) => c.id)).toContain("cf_afff_005");
  });
  it("creates a conflict, changes status, links a side, adds notes and exports", () => {
    const c = createConflict(AFFF, {
      title: "Brooks: learned of MW-7 'in the hallway' vs. Hale's action-item email distribution",
      kind: "testimony_vs_document", severity: "low", analysis: "Minor; Brooks was removed from the thread (MFC-0052217).",
      sides: [
        { label: "Brooks testimony", sourceKind: "deposition", sourceId: ANALYSIS_SEED_IDS.depositions.brooks, cite: "Brooks 72:12", excerpt: "I learned about the 41 microgram result from Greg in the hallway." },
        { label: "Pryce email", sourceKind: "document", sourceId: "ed_afff_0059", cite: "MFC-0052217", excerpt: "Nadia — you are off this thread." },
      ],
    });
    expect(c.id).toMatch(/^cf_/);
    expect(c.status).toBe("open");
    expect(c.createdBy).toBe("user");
    expect(() => createConflict(AFFF, { title: "", kind: "testimony_vs_document", severity: "low", analysis: "", sides: c.sides })).toThrow(/title/);
    expect(() => createConflict(AFFF, { title: "x", kind: "testimony_vs_document", severity: "low", analysis: "", sides: [c.sides[0]] })).toThrow(/two sides/);
    updateConflict(c.id, { status: "resolved", addSide: { label: "Hale action items", sourceKind: "document", sourceId: "ed_afff_0061", cite: "MFC-0052219", excerpt: "actions from 7/9 meeting" } });
    let got = getConflict(c.id)!;
    expect(got.conflict.status).toBe("resolved");
    expect(got.conflict.sides).toHaveLength(3);
    updateConflict(c.id, { status: "open", removeSideIndex: 2 });
    updateConflict(c.id, { status: "dismissed" });
    const note = addConflictNote(c.id, "Discussed with PR; no action.");
    expect(note.authorName).toBe("Jordan Whitfield");
    got = getConflict(c.id)!;
    expect(got.notes.map((n) => n.body)).toEqual(["Discussed with PR; no action."]);
    expect(got.conflict.noteCount).toBe(1);
    expect(got.conflict.sides).toHaveLength(2);
    const csv = conflictsCsv(AFFF);
    expect(csv.split("\r\n")[0]).toBe("ID,Severity,Kind,Status,Title,Witnesses,Side 1,Cite 1,Side 2,Cite 2,Side 3,Cite 3,Analysis,Created by");
    expect(csv).toContain("Brooks 72:12");
    expect(() => addConflictNote("nope", "x")).toThrow(/Unknown conflict/);
    expect(db().conflicts.delete(c.id)).toBe(true);
    const ov = overview(AFFF);
    expect(ov.depositions).toBe(6);
    expect(ov.transcribed).toBe(4);
    expect(ov.conflicts.open).toBeGreaterThanOrEqual(8);
    expect(ov.aiConfigured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("AI features without a key", () => {
  it("throw AIConfigError (503 no_api_key) rather than failing silently", async () => {
    const isCfg = (e: unknown) => (e as { name?: string }).name === "AIConfigError";
    await expect(digestDeposition(ANALYSIS_SEED_IDS.depositions.voss)).rejects.toSatisfy(isCfg);
    await expect(prepareOutline(AFFF, { witnessName: "Martin Suarez" })).rejects.toSatisfy(isCfg);
    await expect(findContradictions(AFFF, { depositionId: ANALYSIS_SEED_IDS.depositions.voss, topic: "preliminary" })).rejects.toSatisfy(isCfg);
    await expect(buildFactMatrix(AFFF, { topic: "MW-7" })).rejects.toSatisfy(isCfg);
    await expect(extractTimelineEvents(AFFF, { docIds: ["ed_afff_0057"] })).rejects.toSatisfy(isCfg);
    await expect(knowledgeMap(AFFF, { topic: "half-life" })).rejects.toSatisfy(isCfg);
    // a cached digest is returned without a key
    db().depositions.update(ANALYSIS_SEED_IDS.depositions.brooks, { aiDigest: { summary: "cached", keyAdmissions: [], themes: [] } });
    await expect(digestDeposition(ANALYSIS_SEED_IDS.depositions.brooks)).resolves.toMatchObject({ summary: "cached" });
    db().depositions.update(ANALYSIS_SEED_IDS.depositions.brooks, { aiDigest: undefined });
    // scheduled depositions have nothing to digest
    await expect(digestDeposition("dep_afff_hale_v2")).rejects.toThrow(/No transcript/);
  });
  it("seeded conflicts have the right shape for the UI", () => {
    const c: Conflict = db().conflicts.get("cf_afff_002")!;
    expect(c.kind).toBe("date_inconsistency");
    expect(c.sides[0].cite).toBe("Hale 46:7");
    expect(c.sides[1].cite).toBe("MFC-0052210");
  });
});
