import { beforeAll, describe, expect, it } from "vitest";
import { db, resetSqlite } from "@/lib/db";
import { COURT_GROUPS } from "@/lib/ai/toolkit/legal";
import { markdownToDoc, docToText } from "@/modules/office/shared/markdown-doc";
import { JURISDICTIONS, classifyAuthority, resolveCourts, courtAbbreviation } from "@/modules/search/jurisdictions";
import { normalizeCaseLaw, normalizeDocket, normalizeCfr, normalizeFederalRegister, normalizeStatute, normalizeLibrary, normalizeEdoc, normalizeToolResult, formatBluebook, shortCite, preferredCitation, guessStatuteCite, bluebookDate, sortHits, dedupe } from "@/modules/search/normalize";
import { buildQuery, toCourtListenerSyntax, extractTerms, parseQuery, highlightSegments, datePresetRange } from "@/modules/search/query-builder";
import { spellingSuggestions, synonymSuggestions, editDistance } from "@/modules/search/synonyms";
import { buildMemoMarkdown, authoritiesTable, splitSynthesis, memoTitle } from "@/modules/search/memo";
import { extractCitations } from "@/modules/search/citations";
import { SEARCH_SEED_IDS, seedSearch } from "@/modules/search/seed";
import { createSavedSearch, deleteSavedSearch, listRuns, listSavedSearches, parseReadRef, parseRunRequest, recordRun, sanitizeSettings, saveHitToLibrary, updateSavedSearch, checkCitations, SAVED_RESEARCH_FOLDER_ID } from "@/modules/search/service";
import type { SearchHit } from "@/modules/search/types";

beforeAll(() => { resetSqlite(); });

const ctx4 = { jurisdiction: "4th-circuit", courts: "" };

describe("jurisdictions", () => {
  it("stays in sync with COURT_GROUPS in the legal toolkit", () => {
    for (const [key, courts] of Object.entries(COURT_GROUPS)) {
      const j = JURISDICTIONS.find((x) => x.key === key);
      if (key === "federal-district") continue; // toolkit placeholder with no court list
      expect(j, `missing jurisdiction ${key}`).toBeTruthy();
      expect(j!.courts).toBe(courts);
    }
  });
  it("classifies binding vs persuasive", () => {
    expect(classifyAuthority("scotus", "4th-circuit")).toBe("binding");
    expect(classifyAuthority("ca4", "4th-circuit")).toBe("binding");
    expect(classifyAuthority("dsc", "4th-circuit")).toBe("persuasive");
    expect(classifyAuthority("ca9", "4th-circuit")).toBe("persuasive");
    expect(classifyAuthority("ca7", "all-federal")).toBe("persuasive");
    expect(classifyAuthority("scotus", "all-federal")).toBe("binding");
    expect(classifyAuthority("cal", "california-state")).toBe("binding");
    expect(classifyAuthority("calctapp", "california-state")).toBe("binding");
    expect(classifyAuthority("cand", "california-state")).toBe("persuasive");
    expect(classifyAuthority(undefined, "4th-circuit")).toBe("n/a");
  });
  it("derives the binding circuit from a free-text district court id", () => {
    expect(classifyAuthority("ca4", "all-federal", "dsc")).toBe("binding");
    expect(classifyAuthority("dsc", "all-federal", "dsc")).toBe("persuasive");
    expect(classifyAuthority("ca7", "all-federal", "ilnd insd")).toBe("binding");
    expect(classifyAuthority("cal", "all-federal", "calctapp")).toBe("binding");
    expect(resolveCourts("4th-circuit", "  ca7, ilnd ")).toBe("ca7 ilnd");
    expect(resolveCourts("7th-circuit")).toContain("ca7");
    expect(courtAbbreviation("dsc")).toBe("D.S.C.");
    expect(courtAbbreviation("zzz", "Some Court")).toBe("Some Court");
  });
});

describe("normalization", () => {
  it("normalizes case law with authority, preferred cite and read ref", () => {
    const h = normalizeCaseLaw({ case_name: "Sawyer v. Foster Wheeler LLC", citations: ["2017 WL 2589046", "860 F.3d 249"], court: "Court of Appeals for the Fourth Circuit", court_id: "ca4", date_filed: "2017-06-16", docket_number: "16-1355", status: "Published", cite_count: 190, snippet: "<b>colorable</b> federal defense", opinion_id: 4381234, cluster_id: 4200001, url: "https://www.courtlistener.com/opinion/4381234/x/" }, ctx4);
    expect(h.id).toBe("caselaw:4200001");
    expect(h.cite).toBe("860 F.3d 249");
    expect(h.authority).toBe("binding");
    expect(h.snippet).toBe("colorable federal defense");
    expect(h.readRef).toEqual({ kind: "opinion", id: 4381234 });
    expect(formatBluebook(h)).toBe("Sawyer v. Foster Wheeler LLC, 860 F.3d 249 (4th Cir. 2017)");
    expect(shortCite(h)).toBe("Sawyer, 860 F.3d 249");
  });
  it("formats SCOTUS and unpublished opinions", () => {
    const scotus = normalizeCaseLaw({ case_name: "Bell Atlantic Corp. v. Twombly", citations: ["127 S. Ct. 1955", "550 U.S. 544"], court_id: "scotus", date_filed: "2007-05-21" }, ctx4);
    expect(formatBluebook(scotus)).toBe("Bell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007)");
    const slip = normalizeCaseLaw({ case_name: "Doe v. Roe", citations: [], court_id: "dsc", date_filed: "2024-03-02", docket_number: "2:23-cv-01234" }, ctx4);
    expect(formatBluebook(slip)).toBe("Doe v. Roe, No. 2:23-cv-01234, slip op. (D.S.C. Mar. 2, 2024)");
    expect(preferredCitation(["2020 WL 123", "980 F.3d 1"])).toBe("980 F.3d 1");
    expect(bluebookDate("2024-04-26")).toBe("Apr. 26, 2024");
  });
  it("normalizes dockets, CFR, Federal Register, statutes, library and e-discovery", () => {
    const d = normalizeDocket({ case_name: "In re AFFF", docket_number: "2:18-mn-02873", court: "D.S.C.", court_id: "dsc", date_filed: "2018-12-07", assigned_to: "Richard Gergel", nature_of_suit: "365", parties: ["3M"], docket_id: 55 }, ctx4);
    expect(d.id).toBe("dockets:55");
    expect(d.status).toBe("Open");
    expect(formatBluebook(d)).toBe("In re AFFF, No. 2:18-mn-02873 (D.S.C. filed Dec. 7, 2018)");

    const c = normalizeCfr({ cite: "40 C.F.R. § 141.61", title: "40", part: "141", section: "141.61", heading: "MCLs", excerpt: "PFOA <em>4.0</em> ng/L", effective: "2024-06-25", url: "https://www.ecfr.gov/current/title-40/section-141.61" });
    expect(c.readRef).toEqual({ kind: "cfr", title: 40, section: "141.61" });
    expect(c.snippet).toBe("PFOA 4.0 ng/L");
    expect(formatBluebook(c)).toBe("40 C.F.R. § 141.61 (2024)");

    const f = normalizeFederalRegister({ title: "PFAS NPDWR", type: "Rule", agencies: ["Environmental Protection Agency", undefined], published: "2024-04-26", citation: "89 FR 32532", document_number: "2024-07773", url: "https://www.federalregister.gov/d/2024-07773" });
    expect(f.readRef).toEqual({ kind: "fr", id: "2024-07773" });
    expect(f.fr?.agencies).toEqual(["Environmental Protection Agency"]);
    expect(formatBluebook(f)).toBe("PFAS NPDWR, 89 FR 32532 (Apr. 26, 2024)");

    const s = normalizeStatute({ title: "15 U.S.C. 2607 - Reporting and retention of information", package_id: "USCODE-2023-title15", granule_id: "g1", date: "2023-01-03", collection: "USCODE", text_url: "https://www.govinfo.gov/x.htm" });
    expect(s.cite).toBe("15 U.S.C. § 2607");
    expect(s.readRef).toEqual({ kind: "statute", url: "https://www.govinfo.gov/x.htm", id: "g1" });
    expect(guessStatuteCite("Public Law 114-182")).toBe("Pub. L. No. 114-182");

    const l = normalizeLibrary({ id: "lib1", name: "Indemnity clause bank", type: "clause", passage: "hold harmless", score: 0.8, practice_area: "Commercial" });
    expect(l.readRef).toEqual({ kind: "library", id: "lib1" });
    expect(l.url).toBe("/library?item=lib1");
    const l2 = normalizeLibrary({ id: "lib2", name: "Memo", type: "docx", passage: "x", score: 0.5, office_doc_id: "od1" });
    expect(l2.url).toBe("/office/word/od1");

    const e = normalizeEdoc({ id: "ed1", bates: "MFC-0041877", date: "2011-03-04", custodian: "Helen Voss", type: "Memo", subject: "Interim summary", passage: "rat liver", score: 0.9, ai_score: 88 });
    expect(e.cite).toBe("MFC-0041877");
    expect(formatBluebook(e)).toBe("MFC-0041877, Interim summary (Mar. 4, 2011)");
  });
  it("dispatches by source and dedupes", () => {
    const { hits, total } = normalizeToolResult("caselaw", { total: 42, results: [{ case_name: "A", cluster_id: 1 }, { case_name: "A", cluster_id: 1 }, { case_name: "B", cluster_id: 2 }] }, ctx4);
    expect(total).toBe(42);
    expect(hits.map((h) => h.title)).toEqual(["A", "B"]);
    expect(normalizeToolResult("web", { results: [{}] }, ctx4).hits).toEqual([]);
    expect(dedupe([{ id: "x", source: "web", title: "1" }, { id: "x", source: "web", title: "2" }]).length).toBe(1);
    const sorted = sortHits([{ id: "a", source: "caselaw", title: "a", date: "2020-01-01" }, { id: "b", source: "caselaw", title: "b", date: "2024-01-01" }], "date");
    expect(sorted[0].id).toBe("b");
  });
});

describe("query builder", () => {
  it("builds boolean queries", () => {
    expect(buildQuery({ phrases: ["failure to warn"], all: ["PFAS"], any: ["PFOA", "PFOS"], none: ["asbestos"] })).toBe('"failure to warn" AND PFAS AND (PFOA OR PFOS) NOT asbestos');
    expect(buildQuery({ proximity: [{ a: "warning", b: "adequate", within: 10 }], fields: { caseName: "Meridian" } })).toBe('"warning adequate"~10 AND caseName:(Meridian)');
    expect(buildQuery({})).toBe("");
  });
  it("converts Westlaw operators to CourtListener syntax", () => {
    expect(toCourtListenerSyntax("warn /s adequate")).toBe('"warn adequate"~15');
    expect(toCourtListenerSyntax('"duty to warn" /p PFAS')).toBe('"duty to warn PFAS"~50');
    expect(toCourtListenerSyntax("indemnif! /5 hold")).toBe('"indemnif* hold"~5');
    expect(toCourtListenerSyntax("waiver & consequential % punitive")).toBe("waiver AND consequential NOT punitive");
    expect(toCourtListenerSyntax('"and now" and later or never')).toBe('"and now" AND later OR never');
  });
  it("extracts highlight terms and parses structure", () => {
    expect(extractTerms('"failure to warn" AND (PFAS OR PFOA) NOT asbestos caseName:Meridian')).toEqual(["failure to warn", "asbestos", "meridian", "pfas", "pfoa"]);
    const p = parseQuery('"failure to warn" AND PFAS AND (PFOA OR PFOS) NOT asbestos "warn adequate"~15');
    expect(p.phrases).toEqual(["failure to warn"]);
    expect(p.all).toEqual(["PFAS"]);
    expect(p.any).toEqual(["PFOA", "PFOS"]);
    expect(p.none).toEqual(["asbestos"]);
    expect(p.proximity).toEqual([{ a: "warn", b: "adequate", within: 15 }]);
    const segs = highlightSegments("The duty to warn arises when PFAS is known.", ["duty to warn", "pfas"]);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["duty to warn", "PFAS"]);
    expect(highlightSegments("plain", [])).toEqual([{ text: "plain", hit: false }]);
  });
  it("computes date presets", () => {
    const now = new Date("2026-09-23T00:00:00Z");
    expect(datePresetRange("any", {}, now)).toEqual({});
    expect(datePresetRange("5y", {}, now)).toEqual({ from: "2021-09-23" });
    expect(datePresetRange("custom", { from: "2020-01-01", to: "" }, now)).toEqual({ from: "2020-01-01", to: undefined });
  });
});

describe("precision aids", () => {
  it("suggests synonyms and spelling fixes", () => {
    const syn = synonymSuggestions("PFAS failure to warn in the 4th circuit");
    expect(syn.map((s) => s.term)).toContain("failure to warn");
    expect(syn.find((s) => s.term === "pfas")?.synonyms).toContain("PFOA");
    expect(editDistance("preemtion", "preemption")).toBe(1);
    const sp = spellingSuggestions("impossibility preemtion under Albrecht");
    expect(sp).toEqual([{ term: "preemtion", suggestion: "preemption" }]);
    expect(spellingSuggestions("summary judgment")).toEqual([]);
  });
});

describe("citation extraction", () => {
  it("finds case, statute, regulation and register cites", () => {
    const text = "See Bell Atl. Corp. v. Twombly, 550 U.S. 544, 555 (2007); 15 U.S.C. § 2607(e); 40 C.F.R. § 141.61; 89 Fed. Reg. 32532 (Apr. 26, 2024); Sawyer, 860 F.3d 249.";
    const cites = extractCitations(text);
    expect(cites.map((c) => c.citation)).toEqual(["550 U.S. 544, 555", "15 U.S.C. § 2607(e)", "40 C.F.R. § 141.61", "89 Fed. Reg. 32532", "860 F.3d 249"]);
    expect(cites.map((c) => c.kind)).toEqual(["case", "statute", "regulation", "register", "case"]);
    expect(cites[2].lookupUrl).toBe("https://www.ecfr.gov/current/title-40/section-141.61");
  });
});

describe("memo builder", () => {
  const hitA: SearchHit = { id: "caselaw:1", source: "caselaw", title: "Boyle v. United Technologies Corp.", cite: "487 U.S. 500", courtId: "scotus", date: "1988-06-27", snippet: "three-part test | with a pipe" };
  const hitB: SearchHit = { id: "regulations:2", source: "regulations", title: "40 C.F.R. § 141.61 — MCLs", cite: "40 C.F.R. § 141.61", cfr: { effective: "2024-06-25" }, snippet: "PFOA 4.0 ppt" };
  it("splits a synthesis into brief answer and analysis", () => {
    const s = splitSynthesis("## Answer\nYes.\n\n## Analysis\nBecause.\n\n## Next steps\n- x");
    expect(s.briefAnswer).toBe("Yes.");
    expect(s.analysis).toContain("Because.");
    expect(splitSynthesis("First para.\n\nSecond para.")).toEqual({ briefAnswer: "First para.", analysis: "Second para." });
  });
  it("produces a memo with all sections and a parseable authorities table", () => {
    const md = buildMemoMarkdown({ question: "Is the Boyle defense available for MilSpec AFFF?", synthesis: "## Answer\nYes, in principle.\n\n## Analysis\nSee [1].", sources: [{ hit: hitA, note: "Three-part test", addedAt: 1 }, { hit: hitB, addedAt: 2 }], openIssues: ["Pull the 2022 SJ order"], author: "Jordan Whitfield", matterName: "AFFF / PFAS", matterCaption: "MDL No. 2873 (D.S.C.)", jurisdictionLabel: "4th Circuit", date: "2026-09-23" });
    for (const h of ["## Question presented", "## Brief answer", "## Analysis", "## Authorities", "## Open issues and next steps"]) expect(md).toContain(h);
    expect(md).toContain("Yes, in principle.");
    expect(md).toContain("| 1 | Case law | Boyle v. United Technologies Corp., 487 U.S. 500 (1988) | U.S. | June 27, 1988 | Three-part test |");
    expect(md).toContain("three-part test \\| with a pipe".length ? "40 C.F.R. § 141.61 (2024)" : "");
    expect(md).toContain("- Pull the 2022 SJ order");
    expect(memoTitle("A very long question presented that should be truncated because it is longer than seventy characters")).toMatch(/…$/);
    const doc = markdownToDoc(md);
    const table = doc.content?.find((n) => n.type === "table");
    expect(table).toBeTruthy();
    expect(table!.content!.length).toBe(3); // header + 2 rows
    const text = docToText(doc);
    expect(text).toContain("Question presented");
    expect(text).toContain("Boyle v. United Technologies Corp.");
  });
  it("escapes pipes in table cells", () => {
    const t = authoritiesTable([{ hit: hitA, addedAt: 1 }]);
    expect(t).toContain("three-part test \\| with a pipe");
  });
});

describe("service + seeds", () => {
  it("seeds saved searches and runs idempotently", () => {
    const d = db();
    const saved = d.collection("search_saved");
    const runs = d.collection("search_runs");
    expect(saved.count()).toBeGreaterThanOrEqual(8);
    expect(runs.count()).toBeGreaterThanOrEqual(6);
    const before = { s: saved.count(), r: runs.count() };
    seedSearch(d);
    expect(saved.count()).toBe(before.s);
    expect(runs.count()).toBe(before.r);
    expect(SEARCH_SEED_IDS.savedSearches).toContain("ss_pfas_ftw_ca4");
    expect(listSavedSearches()[0].pinned).toBe(true);
    const named = listSavedSearches().map((s) => s.name);
    for (const n of ["PFAS failure to warn — 4th Cir.", "Consequential damages waiver enforceability — 7th Cir.", "TSCA 8(e) substantial risk", "PAGA manageability", "Meningioma DMPA"]) expect(named).toContain(n);
    const run = listRuns(50).find((r) => r.id === "run_seed_pfas_ftw_01");
    expect(run?.synthesis).toContain("## Answer");
    expect(run?.topHits?.length).toBeGreaterThan(3);
  });
  it("sanitizes settings and parses run requests", () => {
    const s = sanitizeSettings({ sources: ["caselaw", "bogus" as never, "caselaw"], limit: 999, order: "date", datePreset: "5y", dateFrom: "nope" });
    expect(s.sources).toEqual(["caselaw"]);
    expect(s.limit).toBe(50);
    expect(s.order).toBe("date");
    expect(s.dateFrom).toBeUndefined();
    expect(sanitizeSettings(undefined).sources.length).toBeGreaterThan(0);
    expect(parseRunRequest({})).toEqual({ error: "`message` (the research query) is required" });
    const ok = parseRunRequest({ message: "  PFAS  ", sources: ["dockets"], runId: "run_x" });
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) { expect(ok.query).toBe("PFAS"); expect(ok.runId).toBe("run_x"); expect(ok.settings.sources).toEqual(["dockets"]); }
  });
  it("saved search CRUD", () => {
    const created = createSavedSearch({ query: "spoliation Rule 37(e) adverse inference", settings: { jurisdiction: "7th-circuit", sources: ["caselaw"] }, tags: ["test"] });
    expect(created.name).toBe("spoliation Rule 37(e) adverse inference");
    expect(created.settings.jurisdiction).toBe("7th-circuit");
    const updated = updateSavedSearch(created.id, { name: "Spoliation", pinned: true, settings: { limit: 30 } });
    expect(updated?.name).toBe("Spoliation");
    expect(updated?.settings.limit).toBe(30);
    expect(updated?.settings.jurisdiction).toBe("7th-circuit");
    expect(listSavedSearches()[0].id).toBe(created.id);
    expect(deleteSavedSearch(created.id)).toBe(true);
    expect(updateSavedSearch("missing", { name: "x" })).toBeNull();
  });
  it("records runs and bumps saved-search counters", () => {
    const before = listSavedSearches().find((s) => s.id === "ss_tsca_8e")!.runCount ?? 0;
    const run = recordRun({ id: "run_test_1", query: "substantial risk", settings: sanitizeSettings({ sources: ["caselaw", "statutes"] }), startedAt: Date.now() - 1500, outcome: { hits: { caselaw: [{ id: "caselaw:9", source: "caselaw", title: "X v. Y" }], statutes: [] }, totals: { caselaw: 10, statutes: 0 }, errors: [{ source: "statutes", message: "Provider unreachable (network). Retry when online." }], durationMs: 1200 }, synthesis: "## Answer\nok", aiStatus: "ok", savedSearchId: "ss_tsca_8e" });
    expect(run.counts).toEqual({ caselaw: 1, statutes: 0 });
    expect(run.errors?.length).toBe(1);
    expect(run.durationMs).toBeGreaterThanOrEqual(1500);
    expect(listRuns(1)[0].id).toBe("run_test_1");
    expect(listSavedSearches().find((s) => s.id === "ss_tsca_8e")!.runCount).toBe(before + 1);
  });
  it("parses read refs", () => {
    expect(parseReadRef({ kind: "opinion", id: "123" })).toEqual({ kind: "opinion", id: 123 });
    expect(parseReadRef({ kind: "cfr", title: 40, section: "141.61" })).toEqual({ kind: "cfr", title: 40, section: "141.61" });
    expect(parseReadRef({ kind: "url", url: "ftp://x" })).toBeNull();
    expect(parseReadRef({ kind: "edoc", id: "MFC-0041877" })).toEqual({ kind: "edoc", id: "MFC-0041877" });
    expect(parseReadRef({ kind: "nope" })).toBeNull();
  });
  it("saves a hit to the library once", () => {
    const hit: SearchHit = { id: "caselaw:77", source: "caselaw", title: "Estrada v. Royalty Carpet Mills, Inc.", cite: "15 Cal. 5th 582", courtId: "cal", date: "2024-01-18", url: "https://www.courtlistener.com/x", snippet: "manageability", authority: "binding" };
    const a = saveHitToLibrary(hit, { matterId: "m_sterling_employment" });
    const b = saveHitToLibrary(hit);
    expect(a.id).toBe(b.id);
    expect(a.parentId).toBe(SAVED_RESEARCH_FOLDER_ID);
    expect(a.type).toBe("link");
    expect(db().library.get(SAVED_RESEARCH_FOLDER_ID)?.type).toBe("folder");
    expect(a.tags).toContain("binding");
  });
  it("citation check degrades gracefully when the provider is unreachable", async () => {
    const r = await checkCitations("See 550 U.S. 544 and 40 C.F.R. § 141.61.");
    expect(r.extracted.length).toBe(2);
    expect(r.summary.total).toBe(2);
    // offline sandbox: provider error is reported, extraction still returned
    expect(r.checks.length === 0 ? typeof r.providerError === "string" : r.checks.length > 0).toBe(true);
  }, 40_000);
});
