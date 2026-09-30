/**
 * Research agent: speed (concurrent lanes, fast-model planning off the critical path), accuracy
 * (read-before-characterize, code-checked quotes, adverse lane, explicit no-answer), tools
 * (resolve_citation, fetch allowlist, build_citation, compare_authorities) and output (memo, TOA,
 * Send to Word). Fakes only; no network model calls.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db, resetSqlite } from "@/lib/db";
import type { ToolDef } from "@/lib/ai/tools";
import { resolutionFromLookup, isLegalFetchHost } from "@/lib/ai/toolkit/legal";
import { runResearch, mergeSubQuestions, researchWallMs } from "@/modules/search/engine/run";
import { planLanes, planSubQuestions, contraryQuery } from "@/modules/search/engine/planner";
import { buildLaneTools, rankForReading } from "@/modules/search/engine/lanes";
import { createReadRegistry, cacheKey } from "@/modules/search/engine/cache";
import { resolvePolicy } from "@/modules/search/engine/runtime";
import { sourceFromHit } from "@/modules/search/engine/sources";
import { checkClaimEvidence, answerQuotations } from "@/modules/search/engine/quotes";
import { focusParagraphs, splitParagraphs, quoteExists, paragraphOfQuote } from "@/modules/search/engine/paragraphs";
import { parseCiteMarkers, citedNumbers } from "@/modules/search/engine/markers";
import { buildEvidenceBlocks, evidenceSourceId } from "@/modules/search/engine/evidence";
import { classifyTreatment, currentnessOf } from "@/modules/search/engine/treatment";
import { compareAuthorities, tableOfAuthorities, tableOfAuthoritiesMarkdown } from "@/modules/search/engine/authorities";
import { NO_ANSWER_SENTENCE, synthesisInstructions } from "@/modules/search/engine/prompts";
import { messageTrustState, sourceTrustState } from "@/modules/search/engine/trust";
import type { EngineDeps, ResearchPlan } from "@/modules/search/engine/deps";
import type { AuthorityTreatment, ResearchLane, ResearchSource, ResearchStreamEvent } from "@/modules/search/engine/types";
import { buildCitation, abbreviateCaseName, parseReporterCite } from "@/modules/search/bluebook";
import { buildResearchMemo, sourcesForMessage } from "@/modules/search/memo";
import { sendResearchToWord, researchToaMarkdown } from "@/modules/search/export";
import { getThread } from "@/modules/search/engine/threads";
import { sanitizeSettings } from "@/modules/search/service";
import type { SearchHit, SearchSettings } from "@/modules/search/types";
import type { AgentEvent } from "@/lib/ai/agent";
import type { VerificationResult } from "@/lib/ai/verify";

beforeAll(() => { resetSqlite(); db(); });

const settings = (over: Partial<SearchSettings> = {}) => sanitizeSettings({ sources: ["caselaw", "statutes", "regulations", "library"], jurisdiction: "4th-circuit", ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const boyle: SearchHit = { id: "caselaw:112120", source: "caselaw", title: "Boyle v. United Technologies Corp.", cite: "487 U.S. 500", citations: ["487 U.S. 500"], courtId: "scotus", date: "1988-06-27", snippet: "three-part test for the government contractor defense", url: "https://www.courtlistener.com/opinion/112120/boyle/", authority: "binding", readRef: { kind: "opinion", id: 112120 } };
const sawyer: SearchHit = { id: "caselaw:4381234", source: "caselaw", title: "Sawyer v. Foster Wheeler LLC", cite: "860 F.3d 249", citations: ["860 F.3d 249"], courtId: "ca4", date: "2017-06-16", snippet: "colorable federal defense", url: "https://www.courtlistener.com/opinion/4381234/sawyer/", authority: "binding", readRef: { kind: "opinion", id: 4381234 } };
const doe: SearchHit = { id: "caselaw:999001", source: "caselaw", title: "Doe v. Meridian Fluorochem", cite: "999 F.3d 1234", citations: ["999 F.3d 1234"], courtId: "ca9", date: "2021-03-01", snippet: "declined to extend the defense", authority: "persuasive", readRef: { kind: "opinion", id: 999001 } };
const cfr: SearchHit = { id: "regulations:40-141.61", source: "regulations", title: "40 C.F.R. § 141.61 — MCLs", cite: "40 C.F.R. § 141.61", date: "2024-06-25", snippet: "PFOA 4.0 ng/L", url: "https://www.ecfr.gov/current/title-40/section-141.61", authority: "n/a", readRef: { kind: "cfr", title: 40, section: "141.61" } };

const BOYLE_TEXT = [
  "Boyle v. United Technologies Corp., 487 U.S. 500 (1988).",
  "JUSTICE SCALIA delivered the opinion of the Court.",
  "Liability for design defects in military equipment cannot be imposed, pursuant to state law, when (1) the United States approved reasonably precise specifications; (2) the equipment conformed to those specifications; and (3) the supplier warned the United States about the dangers in the use of the equipment that were known to the supplier but not to the United States.",
  "We hold that the government contractor defense displaces state law in these circumstances.",
].join("\n");
const TEXTS: Record<string, string> = {
  "opinion:112120": BOYLE_TEXT,
  "opinion:4381234": "Sawyer v. Foster Wheeler LLC, 860 F.3d 249 (4th Cir. 2017).\nA government contractor need only show a colorable federal defense for removal under 28 U.S.C. § 1442(a)(1).",
  "opinion:999001": "Doe v. Meridian Fluorochem.\nWe decline to extend the defense to commercial products.",
  "cfr:40:141.61": "40 C.F.R. § 141.61 Maximum contaminant levels for organic contaminants.\n(c) PFOA 4.0 ng/L; PFOS 4.0 ng/L.",
};

interface FakeOpts {
  latency?: { retrieve?: number; read?: number; agent?: number; plan?: number; synth?: number };
  answer?: string;
  verify?: EngineDeps["verify"];
  correct?: EngineDeps["correct"];
  retrieve?: EngineDeps["retrieve"];
  plan?: ResearchPlan | null;
  citing?: EngineDeps["citing"];
  readIds?: number;
}

function fakeDeps(o: FakeOpts = {}) {
  const calls: string[] = [];
  const queries: string[] = [];
  const synth: { instructions: string; evidence: NonNullable<Parameters<EngineDeps["synthesize"]>[0]["evidence"]>; input: unknown }[] = [];
  const lat = o.latency ?? {};
  const answer = o.answer ?? "## Question Presented\nWhether Boyle applies.\n\n## Short Answer\nThe defense requires “reasonably precise specifications” [1 ¶3]. Removal needs only a colorable defense [2].\n\n## Analysis\nThe Court held that “the government contractor defense displaces state law” [1 ¶4].\n\n## Contrary Authority\nDoe declined to extend the defense [3].\n\n## Open Issues\n- None.\n\n## Sources\n[1] Boyle\n[2] Sawyer\n[3] Doe";
  const deps: EngineDeps = {
    hasKey: true,
    model: "primary-test",
    fastModel: "fast-test",
    async retrieve(source, query, s, signal) {
      if (o.retrieve) return o.retrieve(source, query, s, signal);
      calls.push(`retrieve:${source}`);
      queries.push(`${source}|${query}`);
      if (lat.retrieve) await sleep(lat.retrieve);
      if (source === "caselaw") return { hits: [boyle, sawyer, doe], total: 3 };
      if (source === "regulations") return { hits: [cfr], total: 1 };
      return { hits: [], total: 0 };
    },
    async read(ref) {
      calls.push(`read:${cacheKey(ref)}`);
      if (lat.read) await sleep(lat.read);
      const text = TEXTS[cacheKey(ref)];
      if (!text) throw new Error("ENOTFOUND");
      return { text, cached: false };
    },
    async laneAgent(input) {
      calls.push("agent");
      if (lat.agent) await sleep(lat.agent);
      const read = input.tools.find((t) => t.name === "read_source") as unknown as ToolDef<{ source_id: string }, unknown>;
      const ids = Array.from(input.input.matchAll(/^(\S+) · /gm)).map((m) => m[1]).filter((id) => id !== "caselaw:999001").slice(0, o.readIds ?? 2);
      await Promise.all(ids.map((id) => Promise.resolve(read.execute({ source_id: id }, { emit: () => {}, state: {} })).catch(() => null)));
      input.onEvent({ type: "tool.call", id: "x", name: "read_source", label: "Reading", args: {} } as AgentEvent);
      return { text: `- ${ids[0] ?? "none"} — read\nGaps: none`, steps: 1 };
    },
    async synthesize(input) {
      calls.push("synthesize");
      synth.push({ instructions: input.instructions, evidence: input.evidence ?? [], input: input.input });
      if (lat.synth) await sleep(lat.synth);
      for (const chunk of answer.match(/.{1,40}/gs) ?? []) input.onDelta(chunk);
      return answer;
    },
    verify: o.verify ?? (async () => verification([{ claim: "The defense requires reasonably precise specifications", status: "supported", sourceIndex: 0, quote: "the United States approved reasonably precise specifications" }])),
    correct: o.correct ?? (async (i) => { calls.push("correct"); return i.input.split("ANSWER:\n")[1].split("\n\nSOURCES")[0]; }),
    async refine() { calls.push("refine"); return {}; },
    async followUps() { return ["a?", "b?", "c?"]; },
    async verifyCitationsRemote() { throw new Error("offline"); },
  };
  if (o.plan !== undefined) deps.planQueries = async () => { calls.push("plan"); if (lat.plan) await sleep(lat.plan); if (!o.plan) throw new Error("planner down"); return o.plan; };
  if (o.citing) deps.citing = o.citing;
  return Object.assign(deps, { calls, queries, synth });
}

function verification(verdicts: VerificationResult["verdicts"]): VerificationResult {
  const supported = verdicts.filter((v) => v.status === "supported").length;
  const contradicted = verdicts.filter((v) => v.status === "contradicted").length;
  const score = verdicts.length ? supported / verdicts.length : 0;
  return { verdicts, supported, unsupported: verdicts.length - supported - contradicted, contradicted, score, status: contradicted ? "contradicted" : score >= 0.9 ? "verified" : "partially-verified", sourceBacked: supported > 0, checkedAt: new Date().toISOString() };
}

function collect() {
  const t0 = Date.now();
  const events: { t: number; e: ResearchStreamEvent }[] = [];
  return { events, send: (e: ResearchStreamEvent) => { events.push({ t: Date.now() - t0, e }); }, of: <T extends ResearchStreamEvent["type"]>(type: T) => events.filter((x) => x.e.type === type) as { t: number; e: Extract<ResearchStreamEvent, { type: T }> }[] };
}

// ---- planning -------------------------------------------------------------------

describe("planner: adverse lane and sub-questions", () => {
  it("always plans a contrary lane in deep mode that starts at once (soft dependency), not after the controlling lane", () => {
    const lanes = planLanes({ question: "Is the government contractor defense available to a MilSpec AFFF manufacturer?", settings: settings(), mode: "deep", hasMatter: false });
    const contrary = lanes.find((l) => l.kind === "contrary")!;
    expect(contrary).toBeTruthy();
    expect(contrary.queries[0]).toBe(contraryQuery(lanes[0].queries[0]));
    expect(contrary.after).toEqual(["lane_controlling_r1"]);
    expect(contrary.dependsOn).toBeUndefined();
    expect(contrary.tools).toEqual(expect.arrayContaining(["find_citing_opinions", "get_opinion", "resolve_citation"]));
  });
  it("writes jurisdiction-aware sub-questions that include adverse authority, and keeps it when the model plan drops it", () => {
    const qs = planSubQuestions({ question: "Is removal under § 1442 available to a sub-supplier?", settings: settings(), mode: "deep", hasMatter: false });
    expect(qs[0]).toContain("4th Circuit");
    expect(qs.some((q) => /rejects, distinguishes or limits/.test(q))).toBe(true);
    const merged = mergeSubQuestions(qs, ["What test governs federal officer removal in the Fourth Circuit?", "Does § 1442 reach sub-suppliers?"]);
    expect(merged.some((q) => /rejects, distinguishes or limits/.test(q))).toBe(true);
    expect(planSubQuestions({ question: "q", settings: settings(), mode: "fast", hasMatter: false }).length).toBe(1);
  });
});

// ---- speed: concurrency, planning off the critical path, metrics -------------------

describe("run speed (fake latency)", () => {
  it("starts every lane at once, keeps planning off the critical path, uses plan queries, targets the controlling lane's cases, and records the §36 metrics", async () => {
    const plan: ResearchPlan = { subQuestions: ["What test governs the government contractor defense in the Fourth Circuit?", "Which courts decline to extend Boyle to commercial products?"], queries: { controlling: ["\"government contractor defense\" AND disclosure prong"] } };
    const deps = fakeDeps({ latency: { retrieve: 120, read: 80, agent: 150, plan: 260, synth: 60 }, plan });
    const c = collect();
    const res = await runResearch({ question: "Is the government contractor defense available to a MilSpec AFFF manufacturer?", settings: settings(), runId: "run_speed_1" }, c.send, undefined, deps);
    const starts = c.of("lane.started").map((x) => x.t);
    expect(starts.length).toBe(4);
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(60); // contrary no longer waits for controlling
    const done = c.of("lane.completed");
    const sumLaneMs = done.reduce((a, x) => a + x.e.durationMs, 0);
    const window = Math.max(...done.map((x) => x.t)) - Math.min(...starts);
    expect(window).toBeLessThan(sumLaneMs * 0.6); // lanes overlap
    // planning ran on the side: the first evidence arrived before the plan finished
    const planDone = c.of("tool.completed").find((x) => x.e.name === "plan_research")!;
    const firstFound = c.of("source.found")[0];
    expect(firstFound.t).toBeLessThan(planDone.t);
    expect(deps.queries).toContain("caselaw|\"government contractor defense\" AND disclosure prong");
    // the contrary lane's second wave targets what the controlling lane found
    expect(deps.queries.some((q) => q.startsWith("caselaw|\"Boyle v. United Technologies Corp.\" AND (distinguish*"))).toBe(true);
    const m = res.metrics;
    for (const k of ["acknowledgedMs", "firstEvidenceMs", "firstReadMs", "firstModelTokenMs", "firstSourceBackedMs", "finalAnswerMs", "verifiedAnswerMs"] as const) expect(m[k], k).not.toBeNull();
    expect(m.firstEvidenceMs!).toBeLessThanOrEqual(m.firstModelTokenMs!);
    expect(m.firstModelTokenMs!).toBeLessThanOrEqual(m.finalAnswerMs!);
    expect(m.modelCalls).toBeGreaterThanOrEqual(3);
    expect(res.message.subQuestions?.[0]).toBe(plan.subQuestions[0]);
    expect(res.message.subQuestions?.some((q) => /decline to extend/.test(q))).toBe(true);
  });

  it("keeps the synthesis prefix byte-stable across questions and matters and passes citation-native evidence with stable ids", async () => {
    const a = fakeDeps();
    await runResearch({ question: "First question about Boyle", settings: settings(), runId: "run_cache_a" }, () => {}, undefined, a);
    const matter = db().matters.all()[0];
    const b = fakeDeps();
    await runResearch({ question: "A different question entirely?", settings: settings({ matterId: matter?.id ?? null, jurisdiction: "9th-circuit" }), runId: "run_cache_b" }, () => {}, undefined, b);
    expect(a.synth[0].instructions).toBe(b.synth[0].instructions);
    expect(a.synth[0].instructions).toContain("## Question Presented");
    expect(synthesisInstructions("fast", "Firm")).not.toBe(synthesisInstructions("deep", "Firm"));
    expect(a.synth[0].instructions).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no date in the cached prefix
    const ev = a.synth[0].evidence;
    const bySource = new Map(ev.map((e) => [e.source, e]));
    expect(bySource.has("authority://courtlistener/opinion/112120")).toBe(true);
    expect(bySource.has("authority://ecfr/title-40/section-141.61")).toBe(true);
    ev.forEach((e, i) => expect(e.title.startsWith(`Source ${i + 1} — `)).toBe(true));
    const boyleBlock = bySource.get("authority://courtlistener/opinion/112120")!;
    expect(boyleBlock.title).toContain("READ IN FULL");
    expect(boyleBlock.content.join("\n")).toContain(`¶4 ${splitParagraphs(BOYLE_TEXT)[3]}`);
    const doeBlock = bySource.get("authority://courtlistener/opinion/999001")!;
    expect(doeBlock.title).toContain("NOT READ — SEARCH SNIPPET ONLY");
    expect(doeBlock.content[0]).toMatch(/^\(not read — search snippet only/);
    // documents first (runtime prepends evidence), question last
    const text = JSON.stringify(a.synth[0].input);
    expect(text.lastIndexOf("Research question: First question about Boyle")).toBeGreaterThan(text.indexOf("Today's date"));
  });
});

// ---- accuracy ----------------------------------------------------------------------

describe("read before characterize and code-checked quotes", () => {
  const read = (h: SearchHit, n: number): ResearchSource => ({ ...sourceFromHit(h, "l"), n, read: true });
  const unread = (h: SearchHit, n: number): ResearchSource => ({ ...sourceFromHit(h, "l"), n, read: false });
  const textOf = (s: ResearchSource) => TEXTS[cacheKey(s.hit.readRef!)];

  it("only read sources can support a claim; a quote not in the source is demoted; answer quotations are checked", () => {
    const sources = [read(boyle, 1), unread(sawyer, 2)];
    const r = checkClaimEvidence(
      "Boyle requires “the United States approved reasonably precise specifications” [1 ¶3]. The court said “contractors are always immune from suit” [1]. Sawyer held “removal is automatic for contractors” [2].",
      [
        { claim: "Boyle requires reasonably precise specifications", status: "supported", sourceN: 1, quote: "the United States approved reasonably precise specifications" },
        { claim: "Contractors are always immune", status: "supported", sourceN: 1, quote: "contractors are always immune from suit" },
        { claim: "Removal is automatic", status: "supported", sourceN: 2, quote: "colorable federal defense" },
      ],
      sources,
      textOf,
    );
    expect(r.verdicts[0].status).toBe("supported");
    expect(r.verdicts[0].quoteVerified).toBe(true);
    expect(r.verdicts[0].paragraph).toBe(3);
    expect(r.verdicts[1].status).toBe("unsupported");
    expect(r.verdicts[1].note).toContain("does not appear");
    expect(r.verdicts[2].status).toBe("unsupported");
    expect(r.verdicts[2].note).toContain("not read in full");
    expect(r.demoted).toBe(2);
    expect(r.misquotes).toBe(2); // "always immune" (not in [1]) and the quotation from unread [2]
    expect(answerQuotations("He wrote “one two three four” [3].")).toEqual([{ quote: "one two three four", n: 3 }]);
    expect(quoteExists(BOYLE_TEXT, "[L]iability for design defects … cannot be imposed")).toBe(true);
    expect(paragraphOfQuote(BOYLE_TEXT, "We hold that the government contractor defense")).toBe(4);
  });

  it("demotes a misquote during the run, corrects the answer and re-verifies the revised hash", async () => {
    const answer = "## Short Answer\nBoyle requires “reasonably precise specifications” [1 ¶3].\n\n## Analysis\nThe Court said “contractors are always immune from design defect claims” [1].";
    let pass = 0;
    const deps = fakeDeps({
      answer,
      verify: async () => { pass++; return verification(pass === 1 ? [{ claim: "Boyle requires reasonably precise specifications", status: "supported", sourceIndex: 0, quote: "reasonably precise specifications" }, { claim: "Contractors are always immune", status: "supported", sourceIndex: 0, quote: "contractors are always immune from design defect claims" }] : [{ claim: "Boyle requires reasonably precise specifications", status: "supported", sourceIndex: 0, quote: "reasonably precise specifications" }]); },
      correct: async (i) => i.input.split("ANSWER:\n")[1].split("\n\nSOURCES")[0].replace("The Court said “contractors are always immune from design defect claims” [1].", "The Court limited the defense to its three conditions [1 ¶3]."),
    });
    const c = collect();
    const res = await runResearch({ question: "Misquote test", settings: settings({ sources: ["caselaw"] }), runId: "run_quote_1" }, c.send, undefined, deps);
    const unsupported = c.of("claim.unsupported").map((x) => x.e);
    expect(unsupported.some((u) => /does not appear/.test(u.note ?? ""))).toBe(true);
    expect(c.of("correction.started").length).toBe(1);
    expect(res.message.content).not.toContain("always immune");
    expect(res.message.verification?.pass).toBe(2);
    expect(res.message.verification?.artifactHash).toBe(res.message.artifactHash);
    expect(res.message.verification?.unsupported).toBe(0);
    expect(res.message.verification?.verdicts?.[0].paragraph).toBe(3);
  });

  it("citation exists but does not support the proposition → resolved citation, unsupported claim, never 'verified'", async () => {
    const answer = "## Short Answer\nBoyle v. United Technologies Corp., 487 U.S. 500 (1988) [1], holds that PFAS manufacturers owe no duty to warn.";
    const deps = fakeDeps({ answer, verify: async () => verification([{ claim: "Boyle holds that PFAS manufacturers owe no duty to warn", status: "unsupported", sourceIndex: 0, note: "Boyle says nothing about PFAS or duty to warn" }]) });
    const res = await runResearch({ question: "Does Boyle eliminate the duty to warn?", settings: settings({ sources: ["caselaw"] }), runId: "run_nosupport_1" }, () => {}, undefined, deps);
    const m = res.message;
    expect(m.citations?.find((x) => x.citation.startsWith("487 U.S. 500"))?.state).toBe("resolved");
    expect(m.verification?.unsupported).toBe(1);
    expect(m.trust).not.toBe("verified");
    const thread = getThread(res.threadId)!;
    const numbered = sourcesForMessage(m, thread.sources);
    const b = numbered.find((s) => s.id === "caselaw:112120")!;
    expect(sourceTrustState(b, { artifactHash: m.artifactHash, verification: m.verification })).toBe("claim_checked");
    expect(messageTrustState(m, numbered)).not.toBe("verified");
    expect(buildResearchMemo({ question: "q", message: m, sources: thread.sources })).toContain("Unsupported: Boyle holds that PFAS manufacturers owe no duty to warn [1]");
  });

  it("no answer in the record → explicit 'do not establish' answer, no model synthesis, no invented authority", async () => {
    const matter = db().matters.all()[0];
    const deps = fakeDeps({ retrieve: async () => ({ hits: [], total: 0 }) });
    const res = await runResearch({ question: "Did the plant manager approve the 2003 discharge permit?", settings: settings({ sources: ["ediscovery"], matterId: matter.id, fast: true }), runId: "run_noanswer_1" }, () => {}, undefined, deps);
    expect(res.message.noAnswer).toBe(true);
    expect(res.message.content).toContain(NO_ANSWER_SENTENCE);
    expect(res.message.content).toContain(`the ${matter.shortName} record`);
    expect(deps.calls).not.toContain("synthesize");
    expect(citedNumbers(res.message.content).size).toBe(0);
    expect(res.terminal).toBe("partial");
    expect(res.stop).toBe("source_unavailable");
    expect(res.message.banner).toBe("not-source-backed");
    const deep = fakeDeps({ retrieve: async () => ({ hits: [], total: 0 }) });
    const r2 = await runResearch({ question: "Is there any authority on widget torts?", settings: settings({ sources: ["caselaw"] }), runId: "run_noanswer_2" }, () => {}, undefined, deep);
    expect(r2.stats.rounds).toBe(3); // broadened twice before saying so
    expect(r2.message.noAnswer).toBe(true);
  });
});

// ---- treatment, currentness, evidence ------------------------------------------------

describe("authority treatment and currentness", () => {
  it("classifies negative citing language as 'possibly negative, review' and never as good law", () => {
    const neg = classifyTreatment({ citing: [{ title: "X v. Y", snippet: "We decline to follow Boyle on these facts." }], citingCount: 12 });
    expect(neg.signal).toBe("possibly_negative");
    expect(neg.note).toMatch(/^Treatment: possibly negative, review/);
    const none = classifyTreatment({ citing: [{ title: "A v. B", snippet: "Applying Boyle, we affirm." }], citingCount: 1 });
    expect(none.signal).toBe("no_negative_signal");
    expect(none.note).toContain("not a citator");
    expect(`${neg.note} ${none.note}`).not.toMatch(/good law(?! )/);
    const now = Date.UTC(2026, 8, 28);
    expect(currentnessOf({ kind: "caselaw", date: "1988-06-27", hit: boyle }, now).flag).toBe("dated");
    expect(currentnessOf({ kind: "federal_register", date: "2025-01-01", hit: { ...cfr, source: "federal_register", fr: { documentNumber: "x", type: "PRORULE" } } }, now).flag).toBe("proposed");
  });

  it("checks treatment of read cases while lanes run and labels the evidence the model sees", async () => {
    const t: AuthorityTreatment = classifyTreatment({ citing: [{ title: "Doe v. Roe", snippet: "Boyle was called into doubt" }] });
    const deps = fakeDeps({ citing: async ({ opinionId }) => (opinionId === 112120 ? t : classifyTreatment({ citing: [] })) });
    const res = await runResearch({ question: "Treatment test", settings: settings({ sources: ["caselaw"] }), runId: "run_treat_1" }, () => {}, undefined, deps);
    const b = res.sources.find((s) => s.id === "caselaw:112120")!;
    expect(b.treatment?.signal).toBe("possibly_negative");
    expect(deps.synth[0].evidence.find((e) => e.source === "authority://courtlistener/opinion/112120")?.title).toContain("TREATMENT: POSSIBLY NEGATIVE, REVIEW");
    expect(b.currentness?.flag).toBe("dated");
  });

  it("focuses long sources on the paragraphs that match, keeping reader numbering", () => {
    const text = Array.from({ length: 60 }, (_, i) => (i === 36 ? "The disclosure prong requires warning of known dangers." : `Paragraph ${i + 1} about procedure and unrelated background facts that fill space.`.repeat(3))).join("\n");
    const focused = focusParagraphs(text, ["disclosure", "prong"], { maxChars: 1200 });
    expect(focused.map((p) => p.n)).toContain(37);
    expect(focused[0].n).toBe(1);
    const blocks = buildEvidenceBlocks([{ ...sourceFromHit(boyle, "l"), n: 1, read: true }], () => text, { terms: ["disclosure"], maxCharsPerSource: 1200 });
    expect(blocks[0].content.join("\n")).toContain("¶37 The disclosure prong");
    expect(evidenceSourceId({ ...sourceFromHit({ id: "ediscovery:D1", source: "ediscovery", title: "memo", readRef: { kind: "edoc", id: "D1" } }, "l") }, { matterId: "m_1" })).toBe("matter://m_1/document/D1");
  });

  it("parses plain and pinpoint markers", () => {
    expect(parseCiteMarkers("See [1 ¶12] and [2, ¶3-4] and [3].").map((m) => [m.n, m.paragraph])).toEqual([[1, 12], [2, 3], [3, undefined]]);
  });
});

// ---- tools --------------------------------------------------------------------------

describe("research tools", () => {
  it("resolve_citation never substitutes: one match resolves, several are ambiguous, none stays unresolved", () => {
    const rows = resolutionFromLookup([
      { citation: "487 U.S. 500", status: 200, clusters: [{ id: 112120, case_name: "Boyle v. United Technologies Corp." }] },
      { citation: "1 F.3d 1", status: 300, clusters: [{ id: 1, case_name: "A v. B" }, { id: 2, case_name: "C v. D" }] },
      { citation: "999 F.3d 1234", status: 404, error_message: "Citation not found" },
    ]);
    expect(rows[0]).toMatchObject({ state: "resolved", source: "authority://courtlistener/cluster/112120" });
    expect(rows[1].state).toBe("ambiguous");
    expect("source" in rows[1]).toBe(false);
    expect(rows[2]).toEqual({ citation: "999 F.3d 1234", state: "unresolved", reason: "Citation not found" });
  });

  const laneCtx = (deps: EngineDeps, s: SearchSettings = settings()) => ({ question: "q", settings: s, matter: null, deps, emit: () => {}, texts: new Map<string, string>(), reads: createReadRegistry(), known: [], policy: resolvePolicy("deep"), priors: [] });
  const lane = (kind: ResearchLane["kind"], tools: string[]): ResearchLane => ({ id: `lane_${kind}_r1`, kind, name: kind, brief: "", sources: ["caselaw"], tools, queries: ["q"], maxSteps: 3, maxReads: 3, round: 1 });

  it("lane tools: unresolved citations are returned as such, the fetch allowlist holds without web scope, matter tools need a matter", async () => {
    const deps = fakeDeps();
    deps.resolveCitation = async (citation) => ({ citation, state: "unresolved", reason: "no reported decision has this citation" });
    const record = vi.fn();
    const tools = buildLaneTools(lane("controlling", ["resolve_citation", "fetch_url", "build_citation", "compare_authorities", "search_matter_documents", "get_opinion"]), laneCtx(deps), { found: new Map([[boyle.id, { ...sourceFromHit(boyle, "l"), read: true }]]), record, readOne: async () => BOYLE_TEXT });
    const byName = new Map(tools.map((t) => [t.name, t as unknown as ToolDef<Record<string, unknown>, unknown>]));
    expect(byName.has("search_matter_documents")).toBe(false);
    expect(await byName.get("resolve_citation")!.execute({ citation: "999 F.3d 1234" }, { emit: () => {}, state: {} })).toMatchObject({ state: "unresolved" });
    expect(record).not.toHaveBeenCalled();
    await expect(Promise.resolve().then(() => byName.get("fetch_url")!.execute({ url: "https://example.com/blog" }, { emit: () => {}, state: {} }))).rejects.toThrow(/not an allowlisted legal source/);
    expect(isLegalFetchHost("https://www.ecfr.gov/current/title-40")).toBe(true);
    expect(isLegalFetchHost("https://evil-ecfr.gov.example.com/")).toBe(false);
    expect(isLegalFetchHost("ftp://ecfr.gov/x")).toBe(false);
    const para = (await byName.get("get_opinion")!.execute({ source_id: boyle.id, start_paragraph: 3, count: 2 }, { emit: () => {}, state: {} })) as { paragraphs: { n: number; text: string }[] };
    expect(para.paragraphs.map((p) => p.n)).toEqual([3, 4]);
    expect(await byName.get("build_citation")!.execute({ fields: { type: "regulation", title: 40, sections: ["141.61"], year: 2024 } }, { emit: () => {}, state: {} })).toMatchObject({ citation: "40 C.F.R. § 141.61 (2024)" });
  });

  it("compare_authorities states holdings only for sources read in full", () => {
    const rows = compareAuthorities([{ ...sourceFromHit(boyle, "l"), n: 1, read: true }, { ...sourceFromHit(doe, "l"), n: 2, read: false }], () => BOYLE_TEXT);
    expect(rows[0].holdings[0]).toMatchObject({ paragraph: 4 });
    expect(rows[1].holdings).toEqual([]);
    expect(rows[1].note).toContain("Not read");
    expect(rankForReading([sourceFromHit(doe, "l"), sourceFromHit(boyle, "l")], ["contractor"])[0].id).toBe(boyle.id);
  });
});

describe("Bluebook builder", () => {
  it("formats cases, statutes, regulations, Federal Register and dockets deterministically", () => {
    expect(buildCitation({ type: "case", caseName: "Boyle v. United Technologies Corporation", volume: 487, reporter: "U.S.", page: 500, pinpoint: "512", year: 1988 })).toMatchObject({ citation: "Boyle v. United Techs. Corp., 487 U.S. 500, 512 (1988)", short: "Boyle, 487 U.S. at 512" });
    expect(buildCitation({ type: "case", caseName: "Sawyer v. Foster Wheeler LLC", volume: 860, reporter: "F. 3d", page: 249, court: "ca4", date: "2017-06-16" }).citation).toBe("Sawyer v. Foster Wheeler LLC, 860 F.3d 249 (4th Cir. 2017)");
    expect(buildCitation({ type: "case", caseName: "Doe v. Roe", docketNumber: "2:18-mn-2873", wl: "2021 WL 123456", pinpoint: "3", court: "dsc", date: "2021-03-01" }).citation).toBe("Doe v. Roe, No. 2:18-mn-2873, 2021 WL 123456, at *3 (D.S.C. Mar. 1, 2021)");
    const missing = buildCitation({ type: "case", caseName: "Doe v. Roe", volume: 1, reporter: "F.4th", page: 2, court: "ca9" });
    expect(missing.citation).toBeNull();
    expect(missing.errors).toContain("year (or date) is required");
    expect(buildCitation({ type: "statute", title: 15, sections: ["2607(e)"], year: 2018 }).citation).toBe("15 U.S.C. § 2607(e) (2018)");
    expect(buildCitation({ type: "statute", title: 28, sections: ["1441", "1442"] }).citation).toBe("28 U.S.C. §§ 1441, 1442");
    expect(buildCitation({ type: "regulation", title: 40, sections: ["141.61"], year: 2024 }).citation).toBe("40 C.F.R. § 141.61 (2024)");
    expect(buildCitation({ type: "regulation", title: 40, sections: ["141.61"] }).errors).toContain("year is required (the CFR edition cited)");
    expect(buildCitation({ type: "federal_register", volume: 89, page: 32532, pinpoint: "32540", date: "2024-04-26" }).citation).toBe("89 Fed. Reg. 32532, 32540 (Apr. 26, 2024)");
    expect(buildCitation({ type: "docket", caseName: "In re Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-2873", court: "dsc", filed: "2018-12-07", ecf: 1 }).citation).toBe("In re Aqueous Film-Forming Foams Prods. Liab. Litig., No. 2:18-mn-2873 (D.S.C. filed Dec. 7, 2018), ECF No. 1");
    expect(abbreviateCaseName("United States of America v. National Chemical Corporation")).toBe("United States v. Nat'l Chem. Corp.");
    expect(parseReporterCite("487 U.S. 500, 512")).toEqual({ volume: "487", reporter: "U.S.", page: "500", pinpoint: "512" });
  });
});

// ---- output ---------------------------------------------------------------------------

describe("memo, table of authorities and Send to Word", () => {
  it("builds the memo and TOA from the stored answer and creates a Word document bound to the answer hash", async () => {
    const deps = fakeDeps();
    const res = await runResearch({ question: "Is the government contractor defense available?", settings: settings({ sources: ["caselaw"] }), runId: "run_word_1" }, () => {}, undefined, deps);
    const thread = getThread(res.threadId)!;
    const memo = buildResearchMemo({ question: "Is the government contractor defense available?", message: res.message, sources: thread.sources, jurisdictionLabel: "4th Circuit" });
    for (const h of ["## Question Presented", "## Short Answer", "## Analysis", "## Contrary Authority", "## Open Issues", "## Sources", "## Table of Authorities"]) expect(memo, h).toContain(h);
    expect(memo).toMatch(/\| 1 \| Boyle v\. United Technologies Corp\., 487 U\.S\. 500 \(1988\).*\| (Verified|Claim-checked|Source-backed) \|/);
    expect(memo).toContain("[1] ¶3, ¶4");
    const toa = tableOfAuthorities(res.message.content, sourcesForMessage(res.message, thread.sources));
    expect(toa.map((e) => e.group)).toEqual(["Cases", "Cases", "Cases"]);
    expect(tableOfAuthoritiesMarkdown(toa)).toContain("### Cases");
    expect(researchToaMarkdown(res.threadId)).toContain("Authorities cited");
    const { doc } = sendResearchToWord({ threadId: res.threadId });
    const stored = db().officeDocs.get(doc.id)!;
    expect(stored.kind).toBe("word");
    expect(stored.meta?.artifactHash).toBe(res.message.artifactHash);
    expect(JSON.stringify(stored.content)).toContain("Question Presented");
    expect(JSON.stringify(stored.content)).toContain("Table of Authorities");
    expect(() => sendResearchToWord({ threadId: "thr_missing" })).toThrow(/Thread not found/);
  });
});

// ---- time budget -------------------------------------------------------------------

describe("run wall (serverless limit)", () => {
  /** A synthesis that streams part of the answer and then stalls until its stage signal fires. */
  const stalling = (partial: string): EngineDeps["synthesize"] => async (input) => {
    input.onDelta(partial);
    await new Promise((_, reject) => {
      const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (input.signal?.aborted) fail();
      input.signal?.addEventListener("abort", fail, { once: true });
    });
    return partial;
  };

  it("defaults under the 300s function limit and honours RESEARCH_WALL_MS only when sane", () => {
    expect(researchWallMs({})).toBe(265_000);
    expect(researchWallMs({ RESEARCH_WALL_MS: "600000" })).toBe(600_000);
    expect(researchWallMs({ RESEARCH_WALL_MS: "5000" })).toBe(265_000);
    expect(researchWallMs({ RESEARCH_WALL_MS: "abc" })).toBe(265_000);
  });

  it("keeps a streamed partial answer when synthesis hits its deadline and ends as budget_exhausted, not failed", async () => {
    const deps = Object.assign(fakeDeps(), { wallMs: 2_000 });
    deps.synthesize = stalling("## Short Answer\nThe defense requires reasonably precise specifications [1 ¶3].");
    const c = collect();
    const t0 = Date.now();
    const res = await runResearch({ question: "Is Boyle available to a MilSpec manufacturer?", settings: settings(), runId: "run_wall_partial" }, c.send, undefined, deps);
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(res.message.content).toContain("reasonably precise specifications");
    expect(res.message.content).toContain("cut short by the run's time limit");
    expect(res.message.terminal).toBe("budget_exhausted");
    expect(res.message.stop).toBe("hard_limit");
  });

  it("reports a timeout failure when synthesis produced nothing before the deadline", async () => {
    const deps = Object.assign(fakeDeps(), { wallMs: 1_500 });
    deps.synthesize = stalling("");
    const res = await runResearch({ question: "Is Boyle available to a MilSpec manufacturer?", settings: settings(), runId: "run_wall_empty" }, () => {}, undefined, deps);
    expect(res.message.terminal).toBe("failed");
    expect(res.message.failure).toBe("timeout");
  });

  it("a client cancel during synthesis is still a cancel, not a timeout", async () => {
    const deps = fakeDeps();
    deps.synthesize = stalling("Partial");
    const ctrl = new AbortController();
    const res = await runResearch({ question: "Is Boyle available?", settings: settings(), runId: "run_wall_cancel" }, (e) => { if (e.type === "answer.delta") ctrl.abort(); }, ctrl.signal, deps);
    expect(res.message.terminal).toBe("cancelled");
  });
});
