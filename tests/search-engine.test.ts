import { beforeAll, describe, expect, it } from "vitest";
import { db, resetSqlite } from "@/lib/db";
import { listAudit } from "@/lib/integrity/audit";
import type { ToolDef } from "@/lib/ai/tools";
import { planLanes, retrievalQuery, contraryQuery } from "@/modules/search/engine/planner";
import { mergeSources, numberSources, sourceFromHit, sourceKey, normalizeUrl, toProvenanceSources, renderSourcesForPrompt } from "@/modules/search/engine/sources";
import { crossCheckCitations, markUnverifiedCitations, normCite } from "@/modules/search/engine/citecheck";
import { decideCoverage, broaden, claimToQuery } from "@/modules/search/engine/coverage";
import { assembleProvenance } from "@/modules/search/engine/provenance";
import { runResearch, fallbackFollowUps } from "@/modules/search/engine/run";
import { getThread, listThreadSummaries, setThreadPins } from "@/modules/search/engine/threads";
import { cacheKey, getCached, putCached, sweepCache } from "@/modules/search/engine/cache";
import type { EngineDeps } from "@/modules/search/engine/deps";
import type { ResearchSource, ResearchStreamEvent, VerificationSummary } from "@/modules/search/engine/types";
import { sanitizeSettings, searchRuns } from "@/modules/search/service";
import { SEARCH_SEED_IDS, citeMapFromSynthesis } from "@/modules/search/seed";
import type { SearchHit, SearchSettings } from "@/modules/search/types";
import type { AgentEvent } from "@/lib/ai/agent";

beforeAll(() => { resetSqlite(); db(); });

const settings = (over: Partial<SearchSettings> = {}) => sanitizeSettings({ sources: ["caselaw", "statutes", "regulations", "library"], jurisdiction: "4th-circuit", ...over });

// ---- fixtures ---------------------------------------------------------------

const boyle: SearchHit = { id: "caselaw:112120", source: "caselaw", title: "Boyle v. United Technologies Corp.", cite: "487 U.S. 500", citations: ["487 U.S. 500", "108 S. Ct. 2510"], courtId: "scotus", date: "1988-06-27", snippet: "three-part test", url: "https://www.courtlistener.com/opinion/112120/boyle/", authority: "binding", readRef: { kind: "opinion", id: 112120 } };
const sawyer: SearchHit = { id: "caselaw:4200001", source: "caselaw", title: "Sawyer v. Foster Wheeler LLC", cite: "860 F.3d 249", citations: ["860 F.3d 249"], courtId: "ca4", date: "2017-06-16", snippet: "colorable federal defense", url: "https://www.courtlistener.com/opinion/4381234/sawyer/", authority: "binding", readRef: { kind: "opinion", id: 4381234 } };
const cfr: SearchHit = { id: "regulations:40-141.61", source: "regulations", title: "40 C.F.R. § 141.61 — MCLs", cite: "40 C.F.R. § 141.61", date: "2024-06-25", snippet: "PFOA 4.0 ng/L", url: "https://www.ecfr.gov/current/title-40/section-141.61", authority: "n/a", readRef: { kind: "cfr", title: 40, section: "141.61" } };
const memo: SearchHit = { id: "library:lib1", source: "library", title: "AFFF government contractor memo", snippet: "Boyle prongs applied to MilSpec", authority: "n/a", readRef: { kind: "library", id: "lib1" }, url: "/library?item=lib1" };

const TEXTS: Record<string, string> = {
  "opinion:112120": "Boyle v. United Technologies Corp., 487 U.S. 500 (1988). Liability for design defects in military equipment cannot be imposed when (1) the United States approved reasonably precise specifications; (2) the equipment conformed to those specifications; and (3) the supplier warned the United States about dangers known to the supplier but not to the United States.",
  "opinion:4381234": "Sawyer v. Foster Wheeler LLC, 860 F.3d 249 (4th Cir. 2017). A government contractor need only show a colorable federal defense for purposes of removal under 28 U.S.C. § 1442(a)(1).",
  "cfr:40:141.61": "40 C.F.R. § 141.61 Maximum contaminant levels for organic contaminants. (c) PFOA 4.0 ng/L; PFOS 4.0 ng/L.",
  "library:lib1": "Internal memo: the Boyle defense turns on the disclosure prong for AFFF.",
};

function fakeDeps(over: Partial<EngineDeps> & { hasKey?: boolean; answer?: string; verdicts?: VerificationSummary["verdicts"] } = {}): EngineDeps & { calls: string[] } {
  const calls: string[] = [];
  const answer = over.answer ?? `## Answer\nThe Boyle defense requires reasonably precise specifications [1]. Removal needs only a colorable defense [2]. But see Doe v. Meridian Fluorochem, 999 F.3d 1234 (4th Cir. 2021).\n\n## Analysis\nThe third prong is disclosure [1]. The MCL is 4.0 ng/L [3].\n\n## Sources\n[1] Boyle v. United Technologies Corp., 487 U.S. 500 (1988)\n[2] Sawyer v. Foster Wheeler LLC, 860 F.3d 249 (4th Cir. 2017)\n[3] 40 C.F.R. § 141.61 (2024)`;
  const deps: EngineDeps & { calls: string[] } = {
    calls,
    hasKey: over.hasKey ?? true,
    model: "gpt-test",
    fastModel: "gpt-test-mini",
    async retrieve(source, query) {
      calls.push(`retrieve:${source}:${query.slice(0, 20)}`);
      if (source === "caselaw") return { hits: [boyle, sawyer], total: 2 };
      if (source === "regulations") return { hits: [cfr], total: 1 };
      if (source === "library") return { hits: [memo], total: 1 };
      if (source === "statutes") throw new Error("fetch failed");
      return { hits: [], total: 0 };
    },
    async read(ref) {
      calls.push(`read:${cacheKey(ref)}`);
      const text = TEXTS[cacheKey(ref)];
      if (!text) throw new Error("ENOTFOUND");
      return { text, cached: false };
    },
    async laneAgent(input) {
      calls.push(`agent:${input.maxSteps}`);
      // Read the first two found sources through the lane's read_source tool, like the model would.
      const read = input.tools.find((t) => t.name === "read_source") as ToolDef<{ source_id: string }, unknown> | undefined;
      const ids = Array.from(input.input.matchAll(/^(\S+) · /gm)).map((m) => m[1]).slice(0, 2);
      for (const id of ids) { try { await read!.execute({ source_id: id }, { emit: () => {}, state: {} }); } catch { /* cap or missing */ } }
      input.onEvent({ type: "tool.call", id: "x", name: "read_source", label: "Reading", args: {} } as AgentEvent);
      return { text: `- ${ids[0] ?? "none"} — read\nGaps: none`, steps: 2 };
    },
    async synthesize(input) { calls.push("synthesize"); for (const chunk of answer.match(/.{1,40}/gs) ?? []) input.onDelta(chunk); return answer; },
    async verify() {
      calls.push("verify");
      const verdicts = over.verdicts ?? [
        { claim: "Boyle requires reasonably precise specifications", status: "supported", sourceIndex: 0, quote: "reasonably precise specifications" },
        { claim: "Removal needs only a colorable defense", status: "supported", sourceIndex: 1 },
        { claim: "The MCL is 4.0 ng/L", status: "supported", sourceIndex: 2 },
        { claim: "Doe v. Meridian Fluorochem holds otherwise", status: "unsupported", sourceIndex: null, note: "not in any source" },
      ].map((v) => ({ claim: v.claim, status: v.status as "supported" | "unsupported", sourceIndex: (v as { sourceIndex: number | null }).sourceIndex, quote: (v as { quote?: string }).quote, note: (v as { note?: string }).note }));
      const supported = verdicts.filter((v) => v.status === "supported").length;
      const contradicted = verdicts.filter((v) => v.status === "contradicted").length;
      const unsupported = verdicts.length - supported - contradicted;
      const score = supported / (verdicts.length || 1);
      return { verdicts: verdicts.map((v) => ({ ...v, sourceIndex: (v as { sourceIndex: number | null }).sourceIndex ?? null })), supported, unsupported, contradicted, score, status: contradicted ? "contradicted" : score >= 0.9 ? "verified" : "partially-verified", sourceBacked: true, checkedAt: new Date().toISOString() } as never;
    },
    async correct(input) { calls.push("correct"); return input.input.split("ANSWER:\n")[1].split("\n\nSOURCES")[0].replace("But see Doe v. Meridian Fluorochem, 999 F.3d 1234 (4th Cir. 2021).", "Contrary authority was not located among the sources read."); },
    async refine() { calls.push("refine"); return { controlling: ["Boyle disclosure prong AFFF"] }; },
    async followUps() { calls.push("followups"); return ["Does the Fourth Circuit require actual knowledge for the disclosure prong?", "How did Judge Gergel apply Boyle in the Stuart bellwether?", "Is removal under § 1442 available to a sub-supplier?"]; },
    async verifyCitationsRemote() { calls.push("remote"); throw new Error("fetch failed"); },
    ...over,
  };
  return deps;
}

function collect() {
  const events: (ResearchStreamEvent | AgentEvent)[] = [];
  return { events, send: (e: ResearchStreamEvent | AgentEvent) => { events.push(e); }, types: () => events.map((e) => e.type) };
}

// ---- planner ------------------------------------------------------------------

describe("lane planner", () => {
  it("plans 2–5 lanes from the scope and drops lanes whose providers are off", () => {
    const lanes = planLanes({ question: "Is the government contractor defense available to a MilSpec AFFF manufacturer?", settings: settings(), mode: "deep", hasMatter: false });
    expect(lanes.map((l) => l.kind)).toEqual(["controlling", "contrary", "regulatory", "secondary"]);
    expect(lanes.every((l) => l.maxSteps > 0 && l.maxReads > 0 && l.queries.length >= 1)).toBe(true);
    expect(lanes[0].tools).toContain("search_case_law");
    expect(lanes[3].tools).not.toContain("web_search");
    const withMatter = planLanes({ question: "q", settings: settings({ sources: ["caselaw", "dockets", "ediscovery", "web"] }), mode: "deep", hasMatter: true });
    expect(withMatter.map((l) => l.kind)).toEqual(["controlling", "contrary", "record", "secondary"]);
    expect(withMatter.find((l) => l.kind === "record")?.sources).toEqual(["dockets", "ediscovery"]);
    expect(withMatter.find((l) => l.kind === "secondary")?.tools).toContain("web_search");
    const noMatter = planLanes({ question: "q", settings: settings({ sources: ["ediscovery"] }), mode: "deep", hasMatter: false });
    expect(noMatter.map((l) => l.kind)).toEqual(["controlling"]); // fallback: never zero lanes
  });
  it("fast mode is a single lane with one deterministic read pass", () => {
    const lanes = planLanes({ question: "q", settings: settings({ fast: true, sources: ["caselaw", "web"] }), mode: "fast", hasMatter: false });
    expect(lanes.length).toBe(1);
    expect(lanes[0].kind).toBe("fast");
    expect(lanes[0].sources).toEqual(["caselaw"]);
  });
  it("round 2 re-runs only lanes with refinements and uses the refined queries", () => {
    const lanes = planLanes({ question: "q", settings: settings(), mode: "deep", hasMatter: false, round: 2, refinements: { regulatory: ["PFOA MCL hazard index"] } });
    expect(lanes.map((l) => l.kind)).toEqual(["regulatory"]);
    expect(lanes[0].queries).toEqual(["PFOA MCL hazard index"]);
    expect(lanes[0].id).toBe("lane_regulatory_r2");
  });
  it("turns natural language into retrieval terms and keeps boolean queries", () => {
    expect(retrievalQuery("Is a consequential damages waiver enforceable against gross negligence under Illinois law?")).toBe("consequential damages waiver enforceable gross negligence Illinois law");
    expect(retrievalQuery('"failure to warn" AND PFAS /s adequate')).toBe('"failure to warn" AND "PFAS adequate"~15');
    expect(contraryQuery("x")).toContain("distinguish*");
  });
});

// ---- sources ------------------------------------------------------------------

describe("source dedupe and numbering", () => {
  it("keys by provider id or normalised url and merges lanes/read state", () => {
    expect(sourceKey(boyle)).toBe("caselaw:112120");
    expect(sourceKey({ id: "web:0", source: "web", title: "EPA", url: "https://www.epa.gov/pfas/?utm_source=x#top" })).toBe("web:epa.gov/pfas");
    expect(normalizeUrl("https://WWW.Example.com/a/b/")).toBe("example.com/a/b");
    const a = sourceFromHit(boyle, "lane_a", 1);
    const b = { ...sourceFromHit(boyle, "lane_b", 2), read: true, chars: 500, excerpt: "text" };
    const merged = mergeSources([a], [b, sourceFromHit(sawyer, "lane_a", 3)]);
    expect(merged.length).toBe(2);
    expect(merged[0].laneIds).toEqual(["lane_a", "lane_b"]);
    expect(merged[0].read).toBe(true);
    expect(merged[0].chars).toBe(500);
    expect(merged[0].foundAt).toBe(1);
  });
  it("numbers read and binding sources first and maps provenance kinds", () => {
    const list = [sourceFromHit(cfr, "l", 1), { ...sourceFromHit(sawyer, "l", 2), authority: "persuasive" as const }, { ...sourceFromHit(boyle, "l", 3), read: true }];
    const { sources, citeMap } = numberSources(list);
    expect(sources.map((s) => s.id)).toEqual(["caselaw:112120", "caselaw:4200001", "regulations:40-141.61"]);
    expect(citeMap[1]).toBe("caselaw:112120");
    const prov = toProvenanceSources(sources);
    expect(prov.map((p) => p.kind)).toEqual(["case-law", "case-law", "regulation"]);
    expect(prov[0].cite).toBe("487 U.S. 500");
    const prompt = renderSourcesForPrompt(sources, new Map([["caselaw:112120", "FULL TEXT"]]));
    expect(prompt).toContain("[1] Boyle v. United Technologies Corp., 487 U.S. 500 (1988) (binding)");
    expect(prompt).toContain("FULL TEXT");
    expect(prompt).toContain("(not read — snippet only)");
  });
});

// ---- citation cross-check -----------------------------------------------------

describe("citation cross-check", () => {
  const read: ResearchSource[] = [{ ...sourceFromHit(boyle, "l"), n: 1, read: true }, { ...sourceFromHit(sawyer, "l"), n: 2, read: false }];
  it("matches pin cites to read sources and flags the rest", () => {
    const answer = "See Boyle, 487 U.S. 500, 512 (1988) [1]; Sawyer, 860 F.3d 249 [2]; Doe v. Roe, 999 F.3d 1234 (4th Cir. 2021).";
    const r = crossCheckCitations(answer, read);
    expect(r.checks).toEqual([
      { citation: "487 U.S. 500, 512", matched: true, sourceN: 1 },
      { citation: "860 F.3d 249", matched: false, sourceN: 2 },
      { citation: "999 F.3d 1234", matched: false },
    ]);
    expect(r.unmatched.map((c) => c.citation)).toEqual(["999 F.3d 1234"]);
    expect(r.unreadCitedNs).toEqual([2]);
    const marked = markUnverifiedCitations(answer, r);
    expect(marked).toContain("860 F.3d 249 [VERIFY]");
    expect(marked).toContain("999 F.3d 1234 [VERIFY]");
    expect(marked).not.toContain("487 U.S. 500, 512 [VERIFY]");
    expect(marked).toContain("> **Citation check.**");
    expect(marked).toContain("was found but not read");
    // idempotent: never doubles a marker
    expect(markUnverifiedCitations(marked, crossCheckCitations(marked, read)).match(/\[VERIFY\] \[VERIFY\]/)).toBeNull();
    expect(normCite("550 U.S. 544, 555")).toBe("550u.s.544");
    expect(normCite("860 F. 3d 249")).toBe(normCite("860 F.3d 249"));
  });
  it("returns the answer untouched when every citation is backed", () => {
    const answer = "Boyle, 487 U.S. 500 [1].";
    const r = crossCheckCitations(answer, read);
    expect(markUnverifiedCitations(answer, r)).toBe(answer);
  });
});

// ---- coverage -----------------------------------------------------------------

describe("coverage decision", () => {
  const lanes = planLanes({ question: "q", settings: settings(), mode: "deep", hasMatter: false });
  const good: VerificationSummary = { status: "verified", supported: 5, unsupported: 0, contradicted: 0, score: 1, checkedAt: "x", verdicts: [] };
  it("completes when sources, reads and verification are adequate", () => {
    const sources = [{ ...sourceFromHit(boyle, "l"), read: true, n: 1 }, sourceFromHit(sawyer, "l"), sourceFromHit(cfr, "l")];
    const d = decideCoverage({ round: 1, maxRounds: 3, sources, answer: "x [1]", verification: good, lanes });
    expect(d.complete).toBe(true);
    expect(d.reason).toContain("coverage adequate");
  });
  it("asks for another round with refinements when thin, and stops at the cap", () => {
    const thin: VerificationSummary = { status: "unverified", supported: 1, unsupported: 3, contradicted: 0, score: 0.25, checkedAt: "x", verdicts: [{ claim: "The disclosure prong requires actual knowledge of PFAS toxicity", status: "unsupported", sourceN: null }, { claim: "Removal is timely within thirty days", status: "unsupported", sourceN: null }] };
    const d = decideCoverage({ round: 1, maxRounds: 3, sources: [sourceFromHit(boyle, "l")], answer: "x", verification: thin, lanes, emptyLaneIds: ["lane_regulatory_r1"] });
    expect(d.complete).toBe(false);
    expect(d.reason).toContain("only 1 source");
    expect(d.refinements.controlling?.length).toBeGreaterThan(0);
    expect(d.refinements.regulatory).toBeTruthy();
    expect(d.gaps.length).toBe(2);
    const capped = decideCoverage({ round: 3, maxRounds: 3, sources: [], answer: "", verification: null, lanes });
    expect(capped.complete).toBe(true);
    expect(capped.reason).toContain("stopping after round 3");
  });
  it("broadens boolean queries and turns claims into queries", () => {
    expect(broaden('"duty to warn" AND PFAS AND adequate NOT asbestos')).toBe('"duty to warn" AND (PFAS OR adequate)');
    expect(claimToQuery("The court held that the disclosure prong requires actual knowledge [1].")).toBe("disclosure prong requires actual knowledge");
  });
});

// ---- provenance ---------------------------------------------------------------

describe("provenance assembly", () => {
  it("uses the verification score as confidence and records mismatches", () => {
    const sources = [{ ...sourceFromHit(boyle, "l"), n: 1, read: true }, { ...sourceFromHit(cfr, "l"), read: true }];
    const v: VerificationSummary = { status: "partially-verified", supported: 3, unsupported: 1, contradicted: 0, score: 0.75, checkedAt: "2026-09-24T00:00:00Z", verdicts: [] };
    const p = assembleProvenance({ sources, verification: v, question: "q", instructions: "i", model: "m", citationMismatches: 1 });
    expect(p.surface).toBe("research");
    expect(p.confidence).toBe(0.75);
    expect(p.sources.length).toBe(1); // only cited sources
    expect(p.verification?.status).toBe("partially-verified");
    expect(p.verification?.notes).toContain("1 citation(s) not matched");
    expect(p.promptHash).toBeTruthy();
    expect(p.model).toBe("m");
    const none = assembleProvenance({ sources: [], verification: null, question: "q" });
    expect(none.confidence).toBe(0);
    expect(none.review?.status).toBe("pending");
    const unverified = assembleProvenance({ sources, verification: null, question: "q", citationMismatches: 2 });
    expect(unverified.confidence).toBe(0.5);
    expect(unverified.verification?.method).toBe("citations");
  });
});

// ---- cache --------------------------------------------------------------------

describe("source cache", () => {
  it("stores external reads for 24h and skips local records", () => {
    const ref = { kind: "opinion" as const, id: 424242 };
    expect(getCached(ref)).toBeNull();
    putCached(ref, { title: "X", text: "hello" });
    expect(getCached(ref)?.text).toBe("hello");
    expect(getCached(ref)?.hits).toBe(1);
    putCached({ kind: "edoc", id: "MFC-1" }, { text: "local" });
    expect(getCached({ kind: "edoc", id: "MFC-1" })).toBeNull();
    expect(getCached(ref, Date.now() + 25 * 3600 * 1000)).toBeNull();
    expect(sweepCache()).toBe(0);
  });
});

// ---- full run with fakes ------------------------------------------------------

describe("research run (fakes, no key needed)", () => {
  it("plans, runs lanes, synthesizes, verifies, corrects, cross-checks citations and persists with provenance + audit", async () => {
    const deps = fakeDeps();
    const c = collect();
    const res = await runResearch({ question: "Is the government contractor defense available to a MilSpec AFFF manufacturer in the Fourth Circuit?", settings: settings({ sources: ["caselaw", "statutes", "regulations", "library"] }), runId: "run_t_1" }, c.send, undefined, deps);
    const types = c.types();
    for (const t of ["run.start", "plan", "round.start", "lane.start", "lane.step", "lane.source", "lane.done", "synthesis.start", "text.delta", "answer.text", "verify.start", "verify.done", "correction", "round.done", "followups", "answer.final", "run.done"]) expect(types, t).toContain(t);
    expect(res.aborted).toBe(false);
    expect(res.stats.rounds).toBe(1);
    expect(res.stats.sources).toBe(4);
    expect(res.stats.read).toBeGreaterThanOrEqual(3);
    expect(res.stats.agents).toBeGreaterThanOrEqual(6); // 4 lane agents + synthesis + verifier (+ corrector)
    // statutes provider failed → surfaced as a lane step, never fatal
    const errSteps = c.events.filter((e): e is Extract<ResearchStreamEvent, { type: "lane.step" }> => e.type === "lane.step" && e.status === "error");
    expect(errSteps.some((s) => /Statutes.*unreachable/.test(s.label))).toBe(true);
    // correction replaced the unsupported sentence; citation integrity marked nothing else
    const msg = res.message;
    expect(msg.content).toContain("Contrary authority was not located among the sources read.");
    expect(msg.content).not.toContain("999 F.3d 1234");
    expect(msg.content).not.toContain("[VERIFY]");
    expect(msg.verification?.status).toBe("partially-verified");
    expect(msg.provenance?.surface).toBe("research");
    expect(msg.provenance?.confidence).toBe(0.75);
    expect(msg.provenance?.sources.length).toBe(3);
    expect(msg.banner).toBeNull();
    expect(msg.followUps?.length).toBe(3);
    expect(Object.keys(msg.citeMap ?? {})).toEqual(["1", "2", "3"]);
    expect(deps.calls).toContain("correct");
    expect(deps.calls.filter((x) => x === "synthesize").length).toBe(1);
    // persisted: thread, run history, audit
    const thread = getThread(res.threadId)!;
    expect(thread.messages.length).toBe(2);
    expect(thread.sources.length).toBe(4);
    expect(thread.runIds).toEqual(["run_t_1"]);
    expect(listThreadSummaries(5)[0].id).toBe(res.threadId);
    const run = searchRuns().get("run_t_1")!;
    expect(run.threadId).toBe(res.threadId);
    expect(run.aiStatus).toBe("ok");
    expect(run.stats?.sources).toBe(4);
    expect(run.provenance?.verification?.supported).toBe(3);
    const au = listAudit({ action: "ai.generate", targetId: "run_t_1" });
    expect(au.length).toBe(1);
    expect(au[0].meta?.sources).toBe(4);
    expect((au[0].meta?.verification as { status: string }).status).toBe("partially-verified");
  });

  it("marks unread citations [VERIFY] when the correction pass changes nothing and keeps the conversation in the thread", async () => {
    const first = await runResearch({ question: "First question about Boyle", settings: settings({ sources: ["caselaw"] }), runId: "run_t_2a" }, () => {}, undefined, fakeDeps({ answer: "## Answer\nBoyle [1]. See Doe v. Roe, 999 F.3d 1234 (4th Cir. 2021).\n\n## Sources\n[1] Boyle v. United Technologies Corp., 487 U.S. 500 (1988)", correct: async (i) => i.input.split("ANSWER:\n")[1].split("\n\nSOURCES")[0] }));
    expect(first.message.content).toContain("999 F.3d 1234 [VERIFY]");
    expect(first.message.content).toContain("Citation check");
    expect(first.message.citations?.some((c) => c.citation === "999 F.3d 1234" && !c.matched)).toBe(true);
    const c = collect();
    const second = await runResearch({ question: "And the removal standard?", settings: settings({ sources: ["caselaw"] }), threadId: first.threadId, runId: "run_t_2b" }, c.send, undefined, fakeDeps());
    expect(second.threadId).toBe(first.threadId);
    const thread = getThread(first.threadId)!;
    expect(thread.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(thread.runIds).toEqual(["run_t_2a", "run_t_2b"]);
    expect(setThreadPins(first.threadId, [{ id: "pin1", kind: "source", sourceId: "caselaw:112120", hit: boyle, addedAt: 1 }])?.pins.length).toBe(1);
  });

  it("runs a second round when coverage is thin, capped at three", async () => {
    let n = 0;
    const deps = fakeDeps({
      async retrieve(source) { n++; return source === "caselaw" ? { hits: [boyle], total: 1 } : { hits: [], total: 0 }; },
      answer: "## Answer\nBoyle says something [1]. Removal is timely within thirty days. The MCL is four parts per trillion.\n\n## Sources\n[1] Boyle v. United Technologies Corp., 487 U.S. 500 (1988)",
      verdicts: [
        { claim: "Boyle says something", status: "supported", sourceN: 1 },
        { claim: "Removal is timely within thirty days", status: "unsupported", sourceN: null },
        { claim: "The MCL is four parts per trillion", status: "unsupported", sourceN: null },
        { claim: "Something else entirely", status: "unsupported", sourceN: null },
      ],
    });
    // verdicts above are given in view form; adapt fake verify to return them as the engine expects
    deps.verify = async () => ({ verdicts: [{ claim: "Boyle says something", status: "supported", sourceIndex: 0 }, { claim: "Removal is timely within thirty days", status: "unsupported", sourceIndex: null }, { claim: "The MCL is four parts per trillion", status: "unsupported", sourceIndex: null }, { claim: "Something else entirely", status: "unsupported", sourceIndex: null }], supported: 1, unsupported: 3, contradicted: 0, score: 0.25, status: "unverified", sourceBacked: true, checkedAt: "x" });
    const c = collect();
    const res = await runResearch({ question: "thin question", settings: settings({ sources: ["caselaw", "regulations"] }), runId: "run_t_3" }, c.send, undefined, deps);
    expect(res.stats.rounds).toBe(3);
    const rounds = c.events.filter((e): e is Extract<ResearchStreamEvent, { type: "round.done" }> => e.type === "round.done");
    expect(rounds.map((r) => r.complete)).toEqual([false, false, true]);
    expect(rounds[0].reason).toContain("verification score 25%");
    expect(rounds[2].reason).toContain("stopping after round 3");
    expect(deps.calls.filter((x) => x === "refine").length).toBe(2);
    expect(c.events.filter((e) => e.type === "plan").length).toBe(3);
    expect(n).toBeGreaterThan(2);
  });

  it("degrades to retrieval-only with an explicit no-key banner and still records the run", async () => {
    const deps = fakeDeps({ hasKey: false });
    const c = collect();
    const res = await runResearch({ question: "no key question", settings: settings({ sources: ["caselaw", "regulations"] }), runId: "run_t_4" }, c.send, undefined, deps);
    expect(res.message.banner).toBe("no-api-key");
    expect(res.message.content).toBe("");
    expect(res.stats.sources).toBe(3);
    expect(res.stats.read).toBeGreaterThanOrEqual(2); // deterministic reads keep the run source-backed
    expect(res.stats.agents).toBe(0);
    expect(res.message.followUps?.length).toBe(3);
    expect(deps.calls).not.toContain("synthesize");
    expect(c.types()).not.toContain("synthesis.start");
    expect(searchRuns().get("run_t_4")?.aiStatus).toBe("no_api_key");
    expect(fallbackFollowUps("Is X preempted?", settings(), null)[0]).toContain("4th Circuit");
  });

  it("shows the not-source-backed banner when nothing was retrieved", async () => {
    const deps = fakeDeps({ async retrieve() { return { hits: [], total: 0 }; }, answer: "**General practice (not source-backed).** Courts generally require [VERIFY].\n\n## Sources\n" });
    const res = await runResearch({ question: "nothing found", settings: settings({ sources: ["caselaw"] }), runId: "run_t_5" }, () => {}, undefined, deps);
    expect(res.message.banner).toBe("not-source-backed");
    expect(res.message.provenance?.sources.length).toBe(0);
    expect(res.message.provenance?.confidence).toBe(0);
    expect(deps.calls).not.toContain("verify");
  });

  it("aborts everything on the client signal without persisting", async () => {
    const ctrl = new AbortController();
    const deps = fakeDeps({ async retrieve() { ctrl.abort(); return { hits: [boyle], total: 1 }; } });
    const c = collect();
    const res = await runResearch({ question: "abort me", settings: settings({ sources: ["caselaw"] }), runId: "run_t_6" }, c.send, ctrl.signal, deps);
    expect(res.aborted).toBe(true);
    expect(c.types()).not.toContain("answer.final");
    expect(searchRuns().get("run_t_6")).toBeNull();
    expect(deps.calls).not.toContain("synthesize");
  });
});

// ---- seeds --------------------------------------------------------------------

describe("seeded threads", () => {
  it("derives one thread per cached run with citation numbers mapped to hits", () => {
    const t = getThread("thr_seed_pfas_ftw_01")!;
    expect(t).toBeTruthy();
    expect(t.messages.length).toBe(2);
    expect(t.sources.length).toBe(7);
    const a = t.messages[1];
    expect(a.citeMap?.[2]).toBe("caselaw:112120");
    expect(a.citeMap?.[3]).toBe("caselaw:sawyer-foster-wheeler");
    expect(a.citeMap?.[6]).toBe("regulations:40-141.61");
    expect(a.provenance?.surface).toBe("research");
    expect(a.stats?.sources).toBe(7);
    expect(SEARCH_SEED_IDS.threads).toContain("thr_seed_mcl_08");
    expect(getThread("thr_seed_mcl_08")?.messages[1].banner).toBe("no-api-key");
    expect(searchRuns().get("run_seed_pfas_ftw_01")?.threadId).toBe("thr_seed_pfas_ftw_01");
    expect(citeMapFromSynthesis("## Sources\n[1] 487 U.S. 500\n[2] nothing", [boyle])).toEqual({ 1: "caselaw:112120" });
  });
});
