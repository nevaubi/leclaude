import "server-only";
import { nanoid } from "nanoid";
import type { ResponseInput, ResponseInputItem } from "openai/resources/responses/responses";
import { db } from "@/lib/db";
import type { AgentEvent } from "@/lib/ai/agent";
import { AIConfigError } from "@/lib/ai/config";
import { FIRM_NAME, LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import type { VerificationResult } from "@/lib/ai/verify";
import { audit } from "@/lib/integrity/audit";
import type { Matter } from "@/lib/types/domain";
import { jurisdictionByKey, resolveCourts } from "../jurisdictions";
import { formatBluebook } from "../normalize";
import { datePresetRange } from "../query-builder";
import { providerMessage, savedSearches, searchRuns, updateSavedSearch } from "../service";
import { ALL_SOURCES, type SearchHit, type SearchRun, type SearchSettings, type SearchSource } from "../types";
import { sweepCache } from "./cache";
import { crossCheckCitations, markUnverifiedCitations, normCite } from "./citecheck";
import { decideCoverage } from "./coverage";
import { defaultDeps, type EngineDeps } from "./deps";
import { runLane, type LaneResult } from "./lanes";
import { planLanes } from "./planner";
import { CORRECTION_INSTRUCTIONS, LANE_NOTE_HEADER, SYNTHESIS_FORMAT, SYNTHESIS_RULES } from "./prompts";
import { assembleProvenance } from "./provenance";
import { attachProvenance } from "@/lib/integrity/record";
import { compactSource, mergeSources, numberSources, renderSourcesForPrompt } from "./sources";
import { appendToThread, createThread, getThread } from "./threads";
import type { AnswerBanner, LaneKind, ResearchLane, ResearchMessage, ResearchMode, ResearchSource, ResearchStreamEvent, ResearchThread, RunStats, VerificationSummary } from "./types";

export interface RunResearchInput {
  question: string;
  settings: SearchSettings;
  threadId?: string | null;
  runId?: string;
  savedSearchId?: string;
}

export interface RunResearchResult {
  runId: string;
  threadId: string;
  message: ResearchMessage;
  sources: ResearchSource[];
  stats: RunStats;
  aborted: boolean;
}

type Send = (e: ResearchStreamEvent | AgentEvent) => void;

const MAX_ROUNDS_DEEP = 3;

/**
 * The research run: plan lanes → run them in parallel → synthesize from the
 * lane sources only → verify claims → correct/flag → cross-check citations →
 * decide whether another round is needed → follow-ups → persist + audit.
 * Streams every step; aborts everything on the client's signal.
 */
export async function runResearch(input: RunResearchInput, send: Send, signal: AbortSignal | undefined, deps: EngineDeps = defaultDeps()): Promise<RunResearchResult> {
  const startedAt = Date.now();
  const runId = input.runId ?? `run_${nanoid(10)}`;
  const question = input.question.trim();
  const settings = input.settings;
  const mode: ResearchMode = settings.fast ? "fast" : "deep";
  const maxRounds = mode === "fast" ? 1 : MAX_ROUNDS_DEEP;
  const matter: Matter | null = settings.matterId ? db().matters.get(settings.matterId) : null;
  const thread: ResearchThread = (input.threadId ? getThread(input.threadId) : null) ?? createThread({ question, settings });
  const aborted = () => Boolean(signal?.aborted);

  send({ type: "run.start", runId, threadId: thread.id, question, mode, startedAt });

  const texts = new Map<string, string>();
  // Sources from earlier turns in the thread stay citable (their excerpts stand in for text); new reads replace them.
  let pool: ResearchSource[] = thread.sources.map((s) => ({ ...s, laneIds: [] }));
  for (const s of pool) if (s.read && s.excerpt) texts.set(s.id, s.excerpt);
  // Prior-turn sources are stored without their text. Re-read them through the 24h cache (in parallel with the
  // lanes) so a follow-up answer is verified against full text rather than a 600-character excerpt.
  const rehydration = deps.hasKey ? rehydratePriorSources(pool, texts, deps, signal) : Promise.resolve(0);
  const laneSummaries: NonNullable<ResearchMessage["lanes"]> = [];
  let agents = 0;
  let rounds = 0;
  let answer = "";
  let citeMap: Record<number, string> = {};
  let numbered: ResearchSource[] = [];
  let verification: VerificationSummary | null = null;
  let citationChecks: ResearchMessage["citations"] = [];
  let banner: AnswerBanner = null;
  let synthesisInstructions = "";
  let refinements: Partial<Record<LaneKind, string[]>> | undefined;
  let noKey = !deps.hasKey;
  const laneNotes: string[] = [];

  const matterLine = matter
    ? `Active matter: ${matter.name} (${matter.caption ?? matter.shortName}); client ${matter.client} (${matter.clientSide}); ${matter.court ?? ""}; stage: ${matter.stage ?? "n/a"}. ${matter.description ?? ""}`
    : "No matter selected.";

  try {
    for (let round = 1; round <= maxRounds && !aborted(); round++) {
      rounds = round;
      const lanes: ResearchLane[] = planLanes({ question, settings, mode, hasMatter: Boolean(matter), round, refinements });
      send({ type: "plan", round, lanes });
      send({ type: "round.start", round, reason: round === 1 ? undefined : "coverage was thin; refined queries" });

      // --- lanes in parallel -------------------------------------------------
      const results: LaneResult[] = await Promise.all(lanes.map((lane) => runLane(lane, { question, settings, matter, deps, send, signal, texts, known: pool })));
      for (const r of results) {
        pool = mergeSources(pool, r.sources);
        if (r.agentRan) agents++;
        if (r.note) laneNotes.push(`### ${lanes.find((l) => l.id === r.laneId)?.name ?? r.laneId}\n${r.note}`);
        const lane = lanes.find((l) => l.id === r.laneId)!;
        laneSummaries.push({ id: lane.id, name: lane.name, kind: lane.kind, status: r.status, sources: r.sources.length, durationMs: r.durationMs, round });
      }
      if (aborted()) break;

      const n = numberSources(pool);
      numbered = n.sources;
      citeMap = n.citeMap;

      // --- synthesis (primary model, lane sources only) ----------------------
      if (noKey) { break; }
      await rehydration;
      send({ type: "synthesis.start", round, sources: numbered.length });
      const j = jurisdictionByKey(settings.jurisdiction);
      const courts = resolveCourts(settings.jurisdiction, settings.courts);
      const range = datePresetRange(settings.datePreset, { from: settings.dateFrom, to: settings.dateTo });
      synthesisInstructions = [
        `You are the ${FIRM_NAME} legal research agent writing the synthesis for a research thread. ${todayLine()}`,
        matterLine,
        `Jurisdiction: ${j.label}${courts ? ` (courts: ${courts})` : ""}.${range.from ? ` Date range from ${range.from}.` : ""}${range.to ? ` Through ${range.to}.` : ""}`,
        LEGAL_STYLE_RULES,
        SYNTHESIS_RULES,
        SYNTHESIS_FORMAT,
      ].join("\n\n");
      const sourceBlock = renderSourcesForPrompt(numbered, texts);
      const prior = thread.messages.slice(-4).filter((m) => m.content).map((m) => `${m.role === "user" ? "Earlier question" : "Earlier answer"}: ${m.content.slice(0, m.role === "user" ? 600 : 2500)}`).join("\n\n");
      const synthInput: ResponseInput = [{
        role: "user",
        content: [{ type: "input_text", text: [prior ? `Conversation so far:\n${prior}` : "", `Research question: ${question}`, laneNotes.length ? `${LANE_NOTE_HEADER}\n${laneNotes.join("\n\n")}` : "", `SOURCES (${numbered.length}; cite by number):\n${sourceBlock || "(none)"}`].filter(Boolean).join("\n\n") }],
      } as ResponseInputItem];
      let draft = "";
      try {
        draft = await deps.synthesize({ instructions: synthesisInstructions, input: synthInput, signal, onDelta: (d) => { draft += ""; send({ type: "text.delta", delta: d }); } });
        agents++;
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
        if (e instanceof AIConfigError) { noKey = true; break; }
        send({ type: "error", message: `Synthesis failed: ${providerMessage(e)}` });
        break;
      }
      answer = draft.trim();
      send({ type: "answer.text", text: answer, citeMap, stage: "draft" });
      if (aborted()) break;

      // --- verification loop -------------------------------------------------
      const verifiable = numbered.filter((s) => s.read && (texts.get(s.id) ?? s.excerpt));
      if (verifiable.length && answer) {
        send({ type: "verify.start" });
        try {
          const v = await deps.verify({ answer, sources: verifiable.map((s) => ({ title: s.title, cite: s.cite ?? formatBluebook(s.hit), url: s.url, text: texts.get(s.id) ?? s.excerpt ?? "" })), signal });
          agents++;
          verification = toSummary(v, verifiable);
          send({ type: "verify.done", verification });
          if (!aborted() && (v.unsupported + v.contradicted) > 0) {
            try {
              const revised = await deps.correct({
                instructions: CORRECTION_INSTRUCTIONS,
                input: `ANSWER:\n${answer}\n\nSOURCES (read):\n${renderSourcesForPrompt(verifiable, texts, { maxCharsPerSource: 4000, maxTotalChars: 50_000 })}\n\nVERDICTS:\n${verification.verdicts.map((x) => `- [${x.status}] ${x.claim}${x.sourceN ? ` (source [${x.sourceN}])` : ""}${x.quote ? ` — "${x.quote}"` : ""}${x.note ? ` — ${x.note}` : ""}`).join("\n")}`,
                signal,
              });
              agents++;
              const changed = revised.trim().length > 0 && revised.trim() !== answer;
              if (changed) { answer = revised.trim(); send({ type: "answer.text", text: answer, citeMap, stage: "revised" }); }
              send({ type: "correction", changed, note: changed ? `${v.unsupported + v.contradicted} claim(s) revised or flagged after verification` : "Verification flagged claims but the correction pass made no changes; unsupported claims remain marked in the verdicts." });
              if (changed && v.contradicted > 0 && !aborted()) {
                // A contradiction is serious enough to re-check once after the rewrite.
                const v2 = await deps.verify({ answer, sources: verifiable.map((s) => ({ title: s.title, cite: s.cite ?? formatBluebook(s.hit), url: s.url, text: texts.get(s.id) ?? s.excerpt ?? "" })), signal });
                agents++;
                verification = toSummary(v2, verifiable);
                send({ type: "verify.done", verification });
              }
            } catch (e) {
              if ((e as Error).name === "AbortError") break;
              send({ type: "correction", changed: false, note: `Correction pass unavailable (${providerMessage(e)}); unsupported claims are flagged in the verdicts.` });
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") break;
          send({ type: "status", message: `Verification unavailable: ${providerMessage(e)}` });
        }
      }
      if (aborted()) break;

      // --- coverage decision -------------------------------------------------
      const emptyLaneIds = results.filter((r) => r.sources.length === 0).map((r) => r.laneId);
      const decision = decideCoverage({ round, maxRounds, sources: pool, answer, verification, lanes, emptyLaneIds });
      send({ type: "round.done", round, complete: decision.complete, reason: decision.reason });
      if (decision.complete) break;
      refinements = decision.refinements;
      if (decision.gaps.length) {
        try {
          const modelRefinements = await deps.refine({ question, gaps: decision.gaps, laneKinds: lanes.map((l) => l.kind), signal });
          for (const [k, qs] of Object.entries(modelRefinements) as [LaneKind, string[]][]) if (qs?.length) refinements[k] = Array.from(new Set([...(refinements[k] ?? []), ...qs])).slice(0, 3);
        } catch { /* deterministic refinements are enough */ }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") send({ type: "error", message: providerMessage(e) });
  }

  // --- citation integrity ------------------------------------------------------
  if (answer && !aborted()) {
    const cross = crossCheckCitations(answer, numbered);
    let remote = new Set<string>();
    if (cross.unmatched.length) {
      try { remote = new Set((await deps.verifyCitationsRemote(cross.unmatched.map((c) => c.citation).join("; "), signal)).map(normCite)); } catch { /* offline: everything stays [VERIFY] */ }
    }
    citationChecks = cross.checks.map((c) => ({ ...c, resolvedRemotely: !c.matched && remote.has(normCite(c.citation)) ? true : undefined }));
    answer = markUnverifiedCitations(answer, cross, { remotelyResolved: remote });
  }

  // --- banner -----------------------------------------------------------------
  const cited = citedNumbers(answer);
  if (noKey) banner = "no-api-key";
  else if (answer && (cited.size === 0 || numbered.length === 0)) banner = "not-source-backed";

  if (answer && !aborted()) send({ type: "answer.text", text: answer, citeMap, stage: "final" });

  // --- follow-ups ---------------------------------------------------------------
  let followUps: string[] = [];
  if (!aborted()) {
    if (!noKey && answer) {
      try { followUps = await deps.followUps({ question, answer, matterLine, signal }); } catch { followUps = []; }
    }
    if (!followUps.length) followUps = fallbackFollowUps(question, settings, matter);
    send({ type: "followups", questions: followUps });
  }

  // --- provenance, persistence, audit --------------------------------------------
  const finalNumbered = numbered.map((s) => (cited.has(s.n ?? -1) ? s : { ...s, n: undefined }));
  // Provenance describes an answer. A retrieval-only turn (no key, synthesis failed) has nothing to attest or review,
  // so it carries no provenance and never lands in the review queue.
  const provenance = answer && !noKey ? assembleProvenance({ sources: finalNumbered, verification, instructions: synthesisInstructions || undefined, question, model: deps.model, citationMismatches: citationChecks?.filter((c) => !c.matched).length ?? 0 }) : undefined;
  if (provenance && !aborted()) {
    try { attachProvenance({ kind: "research", recordId: runId, matterId: settings.matterId ?? undefined, title: question.slice(0, 140), href: `/search?thread=${thread.id}`, provenance }); } catch (e) { console.warn("[research] provenance sidecar failed", (e as Error).message); }
  }
  const stats: RunStats = { sources: pool.length, read: pool.filter((s) => s.read).length, rounds, agents, durationMs: Date.now() - startedAt };
  const message: ResearchMessage = {
    id: `msg_${nanoid(8)}`,
    role: "assistant",
    content: answer,
    createdAt: new Date().toISOString(),
    runId,
    stats,
    verification: verification ? { ...verification, verdicts: verification.verdicts.slice(0, 40) } : undefined,
    citations: citationChecks?.length ? citationChecks : undefined,
    provenance,
    banner,
    followUps,
    citeMap: Object.fromEntries(Object.entries(citeMap).filter(([n]) => cited.has(Number(n)))),
    lanes: laneSummaries,
  };
  const wasAborted = aborted();
  const compact = pool.map(compactSource);
  if (!wasAborted) {
    appendToThread(thread.id, { question, answer: message, sources: compact, runId, settings });
    recordResearchRun({ id: runId, threadId: thread.id, question, settings, startedAt, sources: compact, message, mode, savedSearchId: input.savedSearchId, noKey });
    audit("ai.generate", { kind: "research", id: runId, label: question.slice(0, 120), matterId: settings.matterId ?? undefined }, {
      threadId: thread.id, mode, sources: stats.sources, read: stats.read, rounds: stats.rounds, agents: stats.agents, durationMs: stats.durationMs,
      verification: verification ? { status: verification.status, supported: verification.supported, unsupported: verification.unsupported, contradicted: verification.contradicted, score: verification.score } : null,
      citationsUnmatched: citationChecks?.filter((c) => !c.matched).length ?? 0, banner, model: noKey ? null : deps.model,
    });
    try { sweepCache(); } catch { /* best effort */ }
    send({ type: "answer.final", message, sources: compact });
    send({ type: "run.done", runId, threadId: thread.id, stats });
  }
  return { runId, threadId: thread.id, message, sources: compact, stats, aborted: wasAborted };
}

function citedNumbers(answer: string): Set<number> {
  const out = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) out.add(Number(m[1]));
  return out;
}

function toSummary(v: VerificationResult, sources: ResearchSource[]): VerificationSummary {
  return {
    status: v.status,
    supported: v.supported,
    unsupported: v.unsupported,
    contradicted: v.contradicted,
    score: v.score,
    checkedAt: v.checkedAt,
    verdicts: v.verdicts.map((x) => ({ claim: x.claim, status: x.status, sourceN: x.sourceIndex != null ? sources[x.sourceIndex]?.n ?? null : null, quote: x.quote, note: x.note })),
  };
}

/** The proposition inside a question, for deterministic follow-ups ("Is X available in Y?" → "X available in Y"). */
export function questionTopic(question: string): string {
  let t = question.replace(/\s+/g, " ").replace(/[?!.\s]+$/, "").trim();
  t = t.replace(/^(is|are|was|were|does|do|did|can|could|may|might|must|should|would|will|has|have|had)\s+(?:(?:a|an|the)\s+)?/i, "");
  t = t.replace(/^(what|which|when|how|whether|why|where|who)\s+(?:(?:is|are|does|do|did|can|must|should|would|will)\s+)?(?:(?:the|a|an)\s+)?/i, "");
  if (!t) return question.trim();
  t = t.charAt(0).toLowerCase() + t.slice(1);
  return t.length > 140 ? t.slice(0, 139).trimEnd() + "…" : t;
}

/** Deterministic follow-ups when the model is unavailable: bound to jurisdiction and matter. */
export function fallbackFollowUps(question: string, settings: SearchSettings, matter: Matter | null): string[] {
  const j = jurisdictionByKey(settings.jurisdiction);
  const label = j.label.split(" (")[0];
  const where = j.key === "all-federal" ? "in the federal courts" : j.group === "State" ? `in ${label}` : `in the ${label}`;
  const topic = questionTopic(question);
  const out = [
    `What is the strongest contrary authority ${where} on ${topic}?`,
    matter ? `How does the record in ${matter.shortName} (documents and depositions) bear on ${topic}?` : `Which statutes or regulations bear on ${topic}?`,
    `What standard governs ${topic} at the motion-to-dismiss stage versus summary judgment?`,
  ];
  return out.map((s) => (s.length > 220 ? s.slice(0, 219) + "…" : s));
}

/** Re-read prior-turn sources (cached reads are instant; misses keep the stored excerpt). Returns how many were rehydrated. */
async function rehydratePriorSources(pool: ResearchSource[], texts: Map<string, string>, deps: EngineDeps, signal: AbortSignal | undefined, limit = 8): Promise<number> {
  const stale = pool.filter((s) => s.read && s.hit.readRef && (texts.get(s.id)?.length ?? 0) <= 600).slice(0, limit);
  let n = 0;
  await Promise.all(stale.map(async (s) => {
    try {
      const r = await deps.read(s.hit.readRef!, { title: s.title, signal });
      if (r.text && r.text.length > (texts.get(s.id)?.length ?? 0)) { texts.set(s.id, r.text); n++; }
    } catch { /* keep the excerpt */ }
  }));
  return n;
}

/** Persist the run in `search_runs` (history), keeping the legacy fields the seeds and history UI rely on. */
export function recordResearchRun(input: { id: string; threadId: string; question: string; settings: SearchSettings; startedAt: number; sources: ResearchSource[]; message: ResearchMessage; mode: ResearchMode; savedSearchId?: string; noKey: boolean }): SearchRun {
  const counts: Partial<Record<SearchSource, number>> = {};
  const topHits: SearchHit[] = [];
  for (const s of ALL_SOURCES) {
    const list = input.sources.filter((x) => x.kind === s);
    if (list.length) { counts[s] = list.length; topHits.push(...list.slice(0, 3).map((x) => x.hit)); }
  }
  const run: SearchRun = {
    id: input.id,
    threadId: input.threadId,
    query: input.question,
    settings: input.settings,
    createdAt: new Date(input.startedAt).toISOString(),
    durationMs: Date.now() - input.startedAt,
    counts,
    synthesis: input.message.content ? input.message.content.slice(0, 16_000) : undefined,
    topHits: topHits.slice(0, 12),
    ownerId: "p_jwhitfield",
    matterId: input.settings.matterId ?? null,
    savedSearchId: input.savedSearchId,
    aiStatus: input.noKey ? "no_api_key" : input.message.content ? "ok" : "error",
    mode: input.mode,
    stats: input.message.stats,
    verification: input.message.verification ? { status: input.message.verification.status, supported: input.message.verification.supported, unsupported: input.message.verification.unsupported, contradicted: input.message.verification.contradicted, score: input.message.verification.score, checkedAt: input.message.verification.checkedAt } : undefined,
    provenance: input.message.provenance,
    banner: input.message.banner ?? undefined,
    followUps: input.message.followUps,
    sources: input.sources.slice(0, 40),
  };
  searchRuns().put(run);
  if (input.savedSearchId) updateSavedSearch(input.savedSearchId, { lastRunAt: run.createdAt, runCount: (savedSearches().get(input.savedSearchId)?.runCount ?? 0) + 1 });
  const all = searchRuns().list({ sortBy: "createdAt", direction: "desc" });
  for (const old of all.slice(250)) searchRuns().delete(old.id);
  return run;
}
