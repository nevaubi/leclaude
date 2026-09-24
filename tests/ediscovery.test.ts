import { beforeAll, describe, expect, it } from "vitest";
import { db, resetSqlite } from "@/lib/db";
import { MATTERS, PEOPLE } from "@/lib/seed/ids";
import { parseQuery, parseBates, parseBatesRange, batesInRange, matchesQuery, compareBates, highlightRegex, makeSnippet, formatBates } from "@/modules/ediscovery/query";
import { buildSeedDocuments, AFFF_ISSUE_CODES, EDISCOVERY_SEED_IDS } from "@/modules/ediscovery/seed";
import { searchDocuments, computeFacets, applyFilters, matterStats, updateCoding, bulkCode, toSearchable, listIssueCodes, createIssueCode, updateIssueCode, deleteIssueCode, viewCounts, recordView, getDocument, similarDocuments, generatePrivilegeLogTemplate, listPrivilegeLog, production, productionCsv, sortDocs, getCodingRules, setCodingRules } from "@/modules/ediscovery/service";
import { templatePrivilegeDescription, privilegeLogCsv, privilegeLogMarkdown, batesRanges, productionLoadFileCsv } from "@/modules/ediscovery/privilege";
import { indexStats, hybridSearch } from "@/lib/ai/vector-store";
import { VECTOR_COLLECTIONS } from "@/lib/ai/toolkit/internal";

const AFFF = MATTERS.afff;

beforeAll(() => { resetSqlite(); });

// ---------------------------------------------------------------------------
describe("Bates parsing", () => {
  it("parses single Bates numbers", () => {
    expect(parseBates("MFC-0041877")).toMatchObject({ prefix: "MFC", number: 41877, width: 7 });
    expect(parseBates("mfc 0041877")?.prefix).toBe("MFC");
    expect(parseBates("hello")).toBeNull();
    expect(formatBates("MFC", 41877)).toBe("MFC-0041877");
  });
  it("parses ranges with en dash, hyphen, 'to' and abbreviated end", () => {
    for (const s of ["MFC-0041877–MFC-0041999", "MFC-0041877 - MFC-0041999", "MFC-0041877 to MFC-0041999", "MFC-0041877-0041999", "MFC-0041877..MFC-0041999"]) {
      const r = parseBatesRange(s);
      expect(r, s).not.toBeNull();
      expect(r!.start.number).toBe(41877);
      expect(r!.end.number).toBe(41999);
    }
    expect(parseBatesRange("MFC-0041999–MFC-0041877")!.start.number).toBe(41877);
    expect(parseBatesRange("MFC-0041877–NGL-0000101")).toBeNull();
  });
  it("range membership accounts for multi-page documents", () => {
    const r = parseBatesRange("MFC-0041880–MFC-0041890")!;
    expect(batesInRange("MFC-0041877", r, "MFC-0041879")).toBe(false);
    expect(batesInRange("MFC-0041877", r, "MFC-0041882")).toBe(true);
    expect(batesInRange("MFC-0041886", r, "MFC-0041897")).toBe(true);
    expect(batesInRange("NGL-0041886", r)).toBe(false);
  });
  it("compares Bates numbers numerically within a prefix", () => {
    expect(compareBates("MFC-0041877", "MFC-0041999")).toBeLessThan(0);
    expect(compareBates("MFC-0052210", "MFC-0043105")).toBeGreaterThan(0);
    expect(compareBates("MFC-0000001", "NGL-0000001")).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("query parser", () => {
  const doc = toSearchable({
    id: "x", matterId: AFFF, bates: "MFC-0041880", date: "2001-03-14", custodianId: PEOPLE.helenVoss, custodianName: "Helen Voss", type: "Email", subject: "Whitfield final — 90-day rat study",
    from: "Helen Voss", to: ["Gregory Hale"], cc: ["Alan Pryce"], text: "The liver effects are real. Serum concentration in the recovery group.", coding: { issues: ["TOX-01"] }, hash: "abc123", tags: ["key-doc"],
  });
  it("handles boolean operators with precedence NOT > AND > OR", () => {
    const q = parseQuery("liver AND (serum OR marketing) NOT budget");
    expect(q.ast.kind).toBe("and");
    expect(matchesQuery(doc, q.ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("liver NOT serum").ast)).toBe(false);
    expect(matchesQuery(doc, parseQuery("marketing OR liver").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("marketing budget").ast)).toBe(false);
    expect(matchesQuery(doc, parseQuery("-marketing liver").ast)).toBe(true);
  });
  it("handles quoted phrases and collects highlight terms", () => {
    const q = parseQuery('"recovery group" liver');
    expect(q.terms).toEqual(["recovery group", "liver"]);
    expect(matchesQuery(doc, q.ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery('"group recovery"').ast)).toBe(false);
    expect(highlightRegex(q.terms)!.test("the Recovery   group")).toBe(true);
  });
  it("handles field prefixes", () => {
    expect(matchesQuery(doc, parseQuery("custodian:voss").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("custodian:hale").ast)).toBe(false);
    expect(matchesQuery(doc, parseQuery("type:email from:voss to:hale cc:pryce").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("type:memo").ast)).toBe(false);
    expect(matchesQuery(doc, parseQuery('subject:"rat study"').ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("issue:tox-01").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("tag:key-doc hash:abc").ast)).toBe(true);
    expect(parseQuery("custodian:hale").fields).toEqual([{ field: "custodian", value: "hale" }]);
  });
  it("handles date expressions", () => {
    expect(matchesQuery(doc, parseQuery("date:2001").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("date:2001-03").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("date:2001-04").ast)).toBe(false);
    expect(matchesQuery(doc, parseQuery("date:2001-03-01..2001-03-31").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("date:>2001-03-14").ast)).toBe(false);
    expect(matchesQuery(doc, parseQuery("date:>=2001-03-14").ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("date:<2002").ast)).toBe(true);
    expect(parseQuery("date:yesterday").warnings.length).toBe(1);
  });
  it("handles Bates ranges and bare Bates numbers inline", () => {
    const q = parseQuery("MFC-0041877–MFC-0041999 liver");
    expect(q.bates).toHaveLength(1);
    expect(q.terms).toEqual(["liver"]);
    expect(matchesQuery(doc, q.ast)).toBe(true);
    expect(matchesQuery(doc, parseQuery("bates:MFC-0041890-0041999").ast)).toBe(false);
    expect(matchesQuery(doc, parseQuery("MFC-0041880").ast)).toBe(true);
  });
  it("tolerates malformed input", () => {
    const q = parseQuery('liver AND (serum "recovery group');
    expect(q.warnings.length).toBeGreaterThan(0);
    expect(matchesQuery(doc, q.ast)).toBe(true);
    expect(parseQuery("").ast.kind).toBe("empty");
    expect(parseQuery("AND OR NOT").ast.kind).toBe("empty");
  });
  it("makes snippets around the first hit", () => {
    const s = makeSnippet("aaaa ".repeat(50) + "the liver effects are real " + "bbbb ".repeat(50), ["liver"], 20);
    expect(s).toContain("liver");
    expect(s.startsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("seed integrity", () => {
  const docs = buildSeedDocuments();
  const afff = docs.filter((d) => d.matterId === AFFF);
  const ng = docs.filter((d) => d.matterId === MATTERS.northgate);
  const byId = new Map(docs.map((d) => [d.id, d]));

  it("has the required volume and unique ids / Bates", () => {
    expect(afff.length).toBeGreaterThanOrEqual(70);
    expect(ng.length).toBeGreaterThanOrEqual(15);
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
    expect(new Set(docs.map((d) => d.bates)).size).toBe(docs.length);
  });
  it("assigns the Bates numbers other modules cite", () => {
    expect(byId.get("ed_afff_0001")).toMatchObject({ bates: "MFC-0041877", batesEnd: "MFC-0041879", date: "2001-03-14", custodianName: "Helen Voss", type: "Report" });
    expect(byId.get("ed_afff_0011")).toMatchObject({ bates: "MFC-0041912", custodianName: "Gregory Hale", type: "Memo" });
    expect(byId.get("ed_afff_0016")).toMatchObject({ bates: "MFC-0041921", date: "2001-03-19", custodianName: "Robert Kaine" });
    expect(byId.get("ed_afff_0018")).toMatchObject({ bates: "MFC-0041930", date: "2001-03-22", custodianName: "Martin Suarez", type: "Memo" });
    expect(byId.get("ed_afff_0057")).toMatchObject({ bates: "MFC-0052210", date: "2002-07-08", custodianName: "Gregory Hale" });
    expect(byId.get("ed_afff_43105")?.bates).toBe("MFC-0043105");
    expect(byId.get("ed_afff_kaine_0001")?.bates).toBe("MFC-0043877");
    expect(byId.get("ed_afff_kaine_0006")?.bates).toBe("MFC-0043951");
    expect(byId.get(EDISCOVERY_SEED_IDS.northgateKeyDocs.mtsa)?.bates).toBe("NGL-0000101");
  });
  it("Bates numbers do not overlap across multi-page documents", () => {
    const ranges = afff.map((d) => ({ s: parseBates(d.bates)!.number, e: parseBates(d.batesEnd ?? d.bates)!.number })).sort((a, b) => a.s - b.s);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].s).toBeGreaterThan(ranges[i - 1].e);
    for (const d of afff) if (d.pages && d.pages > 1) expect(parseBates(d.batesEnd!)!.number - parseBates(d.bates)!.number + 1).toBe(d.pages);
  });
  it("families, threads, duplicates and near-duplicates reference existing documents", () => {
    for (const d of docs) {
      if (d.family?.parentId) { expect(byId.has(d.family.parentId), `${d.id} parent`).toBe(true); expect(byId.get(d.family.parentId)!.family?.attachmentIds).toContain(d.id); }
      for (const a of d.family?.attachmentIds ?? []) { expect(byId.has(a), `${d.id} attachment ${a}`).toBe(true); expect(byId.get(a)!.family?.parentId).toBe(d.id); }
      if (d.isDuplicateOf) { expect(byId.has(d.isDuplicateOf)).toBe(true); expect(byId.get(d.isDuplicateOf)!.hash).toBe(d.hash); expect(byId.get(d.isDuplicateOf)!.text).toBe(d.text); }
      for (const n of d.nearDuplicateIds ?? []) expect(byId.has(n), `${d.id} near-dup ${n}`).toBe(true);
      if (d.family?.threadId) expect(docs.filter((x) => x.family?.threadId === d.family?.threadId).length).toBeGreaterThan(1);
    }
    expect(docs.filter((d) => d.isDuplicateOf).length).toBeGreaterThanOrEqual(2);
    expect(docs.filter((d) => d.nearDuplicateIds?.length).length).toBeGreaterThanOrEqual(2);
  });
  it("uses the shared custodian ids and only known issue codes", () => {
    const custodians = new Set<string>([PEOPLE.gregoryHale, PEOPLE.helenVoss, PEOPLE.nadiaBrooks, PEOPLE.alanPryce, PEOPLE.robertKaine, PEOPLE.martinSuarez]);
    for (const d of afff) expect(custodians.has(d.custodianId), d.id).toBe(true);
    expect(new Set(afff.map((d) => d.custodianId)).size).toBe(6);
    const codes = new Set(AFFF_ISSUE_CODES.map((c) => c.code));
    for (const d of afff) for (const c of [...(d.coding.issues ?? []), ...(d.aiIssues ?? [])]) expect(codes.has(c), `${d.id} ${c}`).toBe(true);
  });
  it("has a realistic coding mix", () => {
    expect(afff.filter((d) => d.coding.hot).length).toBeGreaterThanOrEqual(5);
    expect(afff.filter((d) => d.coding.privileged === true).length).toBeGreaterThanOrEqual(4);
    expect(afff.filter((d) => d.coding.responsive == null).length).toBeGreaterThanOrEqual(3);
    expect(afff.filter((d) => d.coding.responsive === false).length).toBeGreaterThanOrEqual(3);
    expect(afff.filter((d) => d.aiScore != null).length).toBe(afff.length);
    expect(afff.some((d) => d.date >= "2012-01-01")).toBe(true);
    for (const d of docs) { expect(d.text.length, d.id).toBeGreaterThan(300); expect(d.text.toLowerCase()).not.toContain("lorem"); }
    const emails = afff.filter((d) => d.type === "Email");
    for (const e of emails) expect(e.text.startsWith("From:") || e.text.startsWith("Instant message"), e.id).toBe(true);
  });
  it("seeds into the database with issue codes, privilege log, rules and a keyword index", async () => {
    const d = db();
    expect(d.edocs.count((x) => x.matterId === AFFF)).toBe(afff.length);
    expect(d.issueCodes.count((x) => x.matterId === AFFF)).toBe(AFFF_ISSUE_CODES.length);
    expect(d.privilegeLog.count((x) => x.matterId === AFFF)).toBeGreaterThanOrEqual(8);
    expect(getCodingRules(AFFF)).toContain("Responsive");
    const stats = indexStats(VECTOR_COLLECTIONS.edocs);
    expect(stats.docs).toBeGreaterThanOrEqual(docs.length);
    const hits = await hybridSearch(VECTOR_COLLECTIONS.edocs, "monitoring well MW-7 groundwater", { k: 5, filter: (m) => m.matterId === AFFF });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.docId === "ed_afff_0057" || h.docId === "ed_afff_0064" || h.docId === "ed_afff_0058")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("search service", () => {
  it("returns everything for an empty query with facets and workspace totals", async () => {
    const res = await searchDocuments({ matterId: AFFF });
    expect(res.total).toBe(res.totalWorkspace);
    expect(res.hits.length).toBe(Math.min(100, res.total));
    expect(res.facets.custodian.length).toBe(6);
    expect(res.facets.custodian.reduce((n, f) => n + f.count, 0)).toBe(res.total);
    expect(res.facets.years.map((y) => y.year)).toContain("2001");
    expect(res.facets.status.find((s) => s.value === "needs_review")!.count).toBeGreaterThan(0);
    expect(res.hits[0].bates).toBe("MFC-0041877");
    expect(res.hits[0].family2.attachmentCount).toBe(0);
    expect(res.hits[0].family2.isAttachment).toBe(true);
  });
  it("applies boolean queries, Bates ranges and field prefixes server-side", async () => {
    const a = await searchDocuments({ matterId: AFFF, q: "MFC-0041877–MFC-0041999" });
    expect(a.total).toBeGreaterThan(50);
    expect(a.hits.every((h) => parseBates(h.bates)!.number <= 41999)).toBe(true);
    const b = await searchDocuments({ matterId: AFFF, q: 'custodian:kaine "timing of any submission"' });
    expect(b.hits.map((h) => h.id)).toContain("ed_afff_0016");
    expect(b.hits.every((h) => h.custodianName === "Robert Kaine")).toBe(true);
    expect(b.hits[0].snippet).toMatch(/timing of any submission/i);
    const c = await searchDocuments({ matterId: AFFF, q: "type:memo date:2001-03 NOT draft" });
    expect(c.hits.every((h) => h.type === "Memo" && h.date.startsWith("2001-03"))).toBe(true);
    expect(c.hits.map((h) => h.id)).not.toContain("ed_afff_0034");
    const d = await searchDocuments({ matterId: AFFF, q: "bioassay AND (adenoma OR carcinoma)" });
    expect(d.hits.map((h) => h.id)).toContain("ed_afff_0066");
  });
  it("facet counts respect the other active facets and views", async () => {
    const res = await searchDocuments({ matterId: AFFF, filters: { custodians: [PEOPLE.robertKaine] } });
    expect(res.hits.every((h) => h.custodianId === PEOPLE.robertKaine)).toBe(true);
    // custodian facet is counted without the custodian filter → other custodians still show counts
    expect(res.facets.custodian.length).toBe(6);
    // type facet is counted with the custodian filter → only Kaine's types
    expect(res.facets.type.reduce((n, f) => n + f.count, 0)).toBe(res.total);
    const hot = await searchDocuments({ matterId: AFFF, view: "hot" });
    expect(hot.total).toBeGreaterThanOrEqual(5);
    expect(hot.hits.every((h) => h.coding.hot)).toBe(true);
    const nr = await searchDocuments({ matterId: AFFF, view: "needs_review", filters: { scores: ["90+"] } });
    expect(nr.hits.every((h) => h.coding.responsive == null && (h.aiScore ?? 0) >= 90)).toBe(true);
  });
  it("sorts and pages", async () => {
    const desc = await searchDocuments({ matterId: AFFF, sort: "date", dir: "desc", limit: 5 });
    expect(desc.hits.length).toBe(5);
    expect(desc.hits[0].date >= desc.hits[4].date).toBe(true);
    const p2 = await searchDocuments({ matterId: AFFF, sort: "date", dir: "desc", limit: 5, offset: 5 });
    expect(p2.hits[0].id).not.toBe(desc.hits[0].id);
    const score = await searchDocuments({ matterId: AFFF, sort: "aiScore", limit: 3 });
    expect(score.hits[0].aiScore!).toBeGreaterThanOrEqual(score.hits[1].aiScore!);
    const sorted = sortDocs([{ doc: db().edocs.get("ed_afff_0001")! }, { doc: db().edocs.get("ed_afff_0057")! }], "custodian", "asc");
    expect(sorted[0].doc.custodianName).toBe("Gregory Hale");
  });
  it("semantic mode uses the hybrid index and keeps structural filters", async () => {
    const res = await searchDocuments({ matterId: AFFF, q: "groundwater plume municipal wellfield", semantic: true });
    expect(res.semantic).toBe(true);
    expect(res.total).toBeGreaterThan(0);
    expect(res.hits[0].score).toBeGreaterThan(0);
    const filtered = await searchDocuments({ matterId: AFFF, q: "groundwater plume custodian:pryce", semantic: true });
    expect(filtered.hits.every((h) => h.custodianId === PEOPLE.alanPryce)).toBe(true);
  });
  it("computes facets and filters directly", () => {
    const docs = db().edocs.find((d) => d.matterId === AFFF);
    const f = computeFacets(docs, undefined, AFFF);
    expect(f.issues.find((i) => i.value === "TOX-01")!.count).toBeGreaterThan(5);
    expect(f.score.map((s) => s.value)).toEqual(["90+", "70-89", "50-69", "<50", "unscored"]);
    expect(applyFilters(docs, { types: ["Email"], statuses: ["privileged"] }).every((d) => d.type === "Email" && d.coding.privileged === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("stats, views and document detail", () => {
  it("reports review progress and the production deadline", () => {
    const s = matterStats(AFFF);
    expect(s.total).toBeGreaterThanOrEqual(70);
    expect(s.pctReviewed).toBeGreaterThan(50);
    expect(s.hot).toBeGreaterThanOrEqual(5);
    expect(s.privileged).toBeGreaterThanOrEqual(4);
    expect(s.productionDeadline?.label).toMatch(/production/i);
    expect(s.views.find((v) => v.view === "all")!.count).toBe(s.total);
  });
  it("tracks recently viewed documents", async () => {
    expect(viewCounts(AFFF).find((v) => v.view === "recent")!.count).toBe(0);
    recordView(AFFF, "ed_afff_0001");
    getDocument("ed_afff_0057", { recordView: true });
    expect(viewCounts(AFFF).find((v) => v.view === "recent")!.count).toBe(2);
    const res = await searchDocuments({ matterId: AFFF, view: "recent" });
    expect(res.hits.map((h) => h.id).sort()).toEqual(["ed_afff_0001", "ed_afff_0057"]);
  });
  it("resolves families, threads and duplicates in document detail", () => {
    const d = getDocument("ed_afff_0002")!;
    expect(d.family.attachments.map((a) => a.id)).toEqual(["ed_afff_0001", "ed_afff_0007"]);
    expect(d.family.thread.length).toBeGreaterThanOrEqual(4);
    expect(d.family.duplicates.map((x) => x.id)).toContain("ed_afff_0024");
    const dup = getDocument("MFC-0041943")!;
    expect(dup.doc.id).toBe("ed_afff_0024");
    expect(dup.family.duplicateOf?.id).toBe("ed_afff_0002");
    const near = getDocument("ed_afff_0011")!;
    expect(near.family.nearDuplicates.map((x) => x.id)).toContain("ed_afff_0034");
    expect(near.reviewerName).toBe("Jordan Whitfield");
    expect(getDocument("nope")).toBeNull();
  });
  it("finds similar documents through family relations and the keyword index", async () => {
    const sim = await similarDocuments("ed_afff_0057", 8);
    expect(sim.find((s) => s.id === "ed_afff_0064")?.reason).toBe("duplicate");
    expect(sim.find((s) => s.id === "ed_afff_0058")?.reason).toBe("family");
    expect(sim.some((s) => s.reason === "keyword")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("coding", () => {
  it("updates a single document and stamps the reviewer", () => {
    const before = db().edocs.get("ed_afff_0015")!;
    expect(before.coding.responsive).toBeNull();
    const after = updateCoding("ed_afff_0015", { responsive: true, hot: true, issues: ["REG-01", "MKT-01", "MKT-01"], privileged: false, notes: "Commercial pressure on the 8(e) decision." }, PEOPLE.elenaMarsh)!;
    expect(after.coding.responsive).toBe(true);
    expect(after.coding.issues).toEqual(["REG-01", "MKT-01"]);
    expect(after.coding.reviewerId).toBe(PEOPLE.elenaMarsh);
    expect(after.coding.reviewedAt).toBeTruthy();
    expect(after.coding.privilegeBasis).toBeUndefined();
    expect(db().edocs.get("ed_afff_0015")!.coding.hot).toBe(true);
    expect(updateCoding("missing", { hot: true })).toBeNull();
  });
  it("drops the privilege basis when privilege is removed", () => {
    const after = updateCoding("ed_afff_0036", { privileged: false })!;
    expect(after.coding.privilegeBasis).toBeUndefined();
    updateCoding("ed_afff_0036", { privileged: true, privilegeBasis: "attorney-client" });
    expect(db().edocs.get("ed_afff_0036")!.coding.privilegeBasis).toBe("attorney-client");
  });
  it("bulk codes with issue add/remove", () => {
    const res = bulkCode({ ids: ["ed_afff_0050", "ed_afff_0051", "ed_afff_0050"], patch: { responsive: true }, addIssues: ["CUS-01"], removeIssues: ["TOX-01"] });
    expect(res.updated).toBe(2);
    for (const id of ["ed_afff_0050", "ed_afff_0051"]) {
      const d = db().edocs.get(id)!;
      expect(d.coding.responsive).toBe(true);
      expect(d.coding.issues).toContain("CUS-01");
    }
    bulkCode({ ids: ["ed_afff_0050", "ed_afff_0051"], patch: { responsive: false }, removeIssues: ["CUS-01"] });
    expect(db().edocs.get("ed_afff_0050")!.coding.issues).not.toContain("CUS-01");
  });
});

// ---------------------------------------------------------------------------
describe("issue codes and rules", () => {
  it("lists codes with live document counts", () => {
    const codes = listIssueCodes(AFFF);
    expect(codes.find((c) => c.code === "TOX-01")!.count).toBeGreaterThan(5);
    expect(codes.find((c) => c.code === "TOX-02")!.parentId).toBe("ic_afff_tox01");
  });
  it("creates, renames (propagating to documents) and deletes codes", () => {
    const created = createIssueCode(AFFF, { code: "exp-01", label: "Expert reliance", color: "chart-2" });
    expect(created.code).toBe("EXP-01");
    expect(() => createIssueCode(AFFF, { code: "EXP-01", label: "dup" })).toThrow(/exists/);
    bulkCode({ ids: ["ed_afff_0001"], patch: {}, addIssues: ["EXP-01"] });
    updateIssueCode(created.id, { code: "EXP-02", label: "Expert reliance (renamed)" });
    expect(db().edocs.get("ed_afff_0001")!.coding.issues).toContain("EXP-02");
    expect(listIssueCodes(AFFF).find((c) => c.code === "EXP-02")!.count).toBe(1);
    expect(deleteIssueCode(created.id)).toBe(true);
    expect(db().edocs.get("ed_afff_0001")!.coding.issues).not.toContain("EXP-02");
    expect(deleteIssueCode(created.id)).toBe(false);
  });
  it("stores coding rules per matter", () => {
    setCodingRules(AFFF, "# Test rules");
    expect(getCodingRules(AFFF)).toBe("# Test rules");
    expect(getCodingRules(MATTERS.northgate)).toContain("Northgate");
  });
});

// ---------------------------------------------------------------------------
describe("privilege log and production", () => {
  it("writes privilege-safe template descriptions", () => {
    const d = db().edocs.get("ed_afff_0016")!;
    const desc = templatePrivilegeDescription(d);
    expect(desc).toMatch(/^Email from Robert Kaine \(Associate General Counsel\)/);
    expect(desc).toMatch(/legal advice/);
    expect(desc).not.toMatch(/bioassay|board minutes|\$/);
    const wp = templatePrivilegeDescription(db().edocs.get("ed_afff_0018")!);
    expect(wp).toMatch(/anticipation of litigation/);
    const toCounsel = templatePrivilegeDescription(db().edocs.get("ed_afff_0014")!);
    expect(toCounsel).toMatch(/requesting legal advice/);
  });
  it("generates entries for privileged documents and removes stale ones", () => {
    const before = listPrivilegeLog(AFFF).length;
    const res = generatePrivilegeLogTemplate(AFFF);
    expect(res.created).toBeGreaterThan(0);
    const after = listPrivilegeLog(AFFF);
    expect(after.length).toBe(before + res.created);
    expect(after.every((e) => e.description.length > 20 && e.subject)).toBe(true);
    // un-privilege one doc → its entry is removed on the next generation
    updateCoding("ed_afff_0080", { privileged: false });
    const res2 = generatePrivilegeLogTemplate(AFFF);
    expect(res2.removed).toBe(1);
    expect(listPrivilegeLog(AFFF).some((e) => e.docId === "ed_afff_0080")).toBe(false);
    updateCoding("ed_afff_0080", { privileged: true, privilegeBasis: "attorney-client" });
  });
  it("exports CSV and markdown", () => {
    const rows = listPrivilegeLog(AFFF);
    const csv = privilegeLogCsv(rows);
    expect(csv.split("\r\n").length).toBe(rows.length + 1);
    expect(csv.startsWith("Log No.,Beg Bates,End Bates")).toBe(true);
    expect(csv).toContain("MFC-0041921");
    const md = privilegeLogMarkdown(rows, "In re: AFFF", "MDL 2873");
    expect(md).toContain("| No. | Bates |");
    expect(md).toContain("MDL 2873");
  });
  it("summarises the production set and writes a load file", () => {
    const p = production(AFFF);
    expect(p.produced).toBeGreaterThan(30);
    expect(p.privilegedWithheld).toBeGreaterThanOrEqual(4);
    expect(p.produced + p.privilegedWithheld).toBeLessThanOrEqual(p.responsive + 5);
    expect(p.batesRanges.length).toBeGreaterThan(1);
    expect(p.batesRanges[0].start).toBe("MFC-0041877");
    expect(p.byCustodian[0].count).toBeGreaterThan(0);
    const csv = productionCsv(AFFF);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("BegBates,EndBates,BegAttach,EndAttach");
    expect(lines.length).toBe(p.produced + 1);
    expect(csv).not.toContain("MFC-0041921"); // privileged withheld
    expect(csv).not.toContain("MFC-0041943"); // duplicate suppressed
    const family = lines.find((l) => l.startsWith("MFC-0041880"))!;
    expect(family.split(",")[2]).toBe("MFC-0041877"); // BegAttach for the Voss transmittal family
    const ranges = batesRanges([db().edocs.get("ed_afff_0001")!, db().edocs.get("ed_afff_0002")!, db().edocs.get("ed_afff_0057")!]);
    expect(ranges).toEqual([{ start: "MFC-0041877", end: "MFC-0041880", count: 2 }, { start: "MFC-0052210", end: "MFC-0052211", count: 1 }]);
    expect(productionLoadFileCsv([]).split("\r\n").length).toBe(1);
  });
});
