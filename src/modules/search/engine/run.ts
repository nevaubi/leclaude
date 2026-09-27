import "server-only";
import { nanoid } from "nanoid";
import type { ResponseInput, ResponseInputItem } from "openai/resources/responses/responses";
import { db } from "@/lib/db";
import { AIConfigError } from "@/lib/ai/config";
import { classifyFailure, createEmitter, isAbortError, STOP_LABEL, type FailureKind, type ResearchStopState, type RunMetrics, type RunTerminalState } from "@/lib/ai/events";
import { LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import { firmLabel } from "../firm";
import type { VerificationResult } from "@/lib/ai/verify";
import { audit } from "@/lib/integrity/audit";
import { attachProvenance } from "@/lib/integrity/record";
import type { Matter } from "@/lib/types/domain";
import { jurisdictionByKey, resolveCourts } from "../jurisdictions";
import { formatBluebook } from "../normalize";
import { datePresetRange } from "../query-builder";
import { providerMessage, researchPrincipalId, savedSearches, searchRuns, updateSavedSearch } from "../service";
import { ALL_SOURCES, type SearchHit, type SearchRun, type SearchSettings, type SearchSource } from "../types";
import { answerArtifactId, answerHash } from "./binding";
import { createReadRegistry, sweepCache } from "./cache";
import { buildCitationCheck, crossCheckCitations, normCite, withCitationStates } from "./citecheck";
import { decideCoverage, type CoverageDecision } from "./coverage";
import { defaultDeps, type EngineDeps } from "./deps";
import { runLane, type LaneResult } from "./lanes";
import { planLanes } from "./planner";
import { CORRECTION_INSTRUCTIONS, LANE_NOTE_HEADER, SYNTHESIS_FORMAT, SYNTHESIS_RULES } from "./prompts";
import { assembleProvenance } from "./provenance";
import { MetricsRecorder, resolvePolicy, scheduleLanes, timedModelCall, withRetry, type RunPolicy } from "./runtime";
import { compactSource, mergeSources, numberSources, renderSourcesForPrompt } from "./sources";
import { appendToThread, createThread, deleteThreadIfEmpty, getThread } from "./threads";
import { messageTrustState } from "./trust";
import type { AnswerBanner, CoverageSummary, LaneKind, LaneSummary, ResearchEventInput, ResearchLane, ResearchMessage, ResearchMode, ResearchSource, ResearchStreamEvent, ResearchThread, RunStats, VerificationSummary } from "./types";

export interface RunResearchInput {
  question: string;
  settings: SearchSettings;
  threadId?: string | null;
  runId?: string;
  savedSearchId?: string;
  /** When the HTTP request was received (for the request → acknowledgement metric). Defaults to the run start. */
  requestedAt?: number;
  /** Overrides for concurrency, timeouts, retries and budgets (tests pass tiny backoffs). */
  policy?: Partial<RunPolicy>;
}

export interface RunResearchResult {
  runId: string;
  threadId: string;
  message: ResearchMessage;
  sources: ResearchSource[];
  stats: RunStats;
  aborted: boolean;
  terminal: RunTerminalState;
  stop?: ResearchStopState;
  failure?: FailureKind;
  metrics: RunMetrics;
}

type Send = (e: ResearchStreamEvent) => void;

const MAX_ROUNDS_DEEP = 3;

/** Inputs to the terminal/stop decision, kept explicit so the mapping is testable on its own. */
export interface OutcomeInput {
  aborted: boolean;
  answer: string;
  noKey: boolean;
  failure?: FailureKind;
  failureMessage?: string;
  coverage: CoverageDecision | null;
  timeExceeded: boolean;
  verification: VerificationSummary | null;
  verificationCurrent: boolean;
  verificationUnavailable: string | null;
  sourcesFound: number;
  lanes: LaneSummary[];
}

export interface Outcome {
  terminal: RunTerminalState;
  stop?: ResearchStopState;
  failure?: FailureKind;
  reason: string;
}

/**
 * Map what happened to one explicit terminal state and one stop state (constitution §14, §25).
 * Order: cancelled → failed → not configured → verification failed → budgets → partial reasons → succeeded.
 * The stop state says why evidence gathering stopped; the terminal state says what the run delivered.
 */
export function decideOutcome(i: OutcomeInput): Outcome {
  if (i.aborted) return { terminal: "cancelled", stop: "cancelled", failure: "cancelled", reason: i.answer ? "Stopped by the user; the partial answer is kept" : "Stopped by the user before an answer was produced" };
  if (!i.answer) {
    if (i.noKey) return { terminal: "partial", stop: "hard_limit", failure: "not_configured", reason: "No model provider is configured; the lanes retrieved and read sources but no answer was written" };
    const failure = i.failure ?? "no_result";
    return { terminal: "failed", stop: i.sourcesFound ? undefined : "source_unavailable", failure, reason: i.failureMessage ?? (i.sourcesFound ? "The answer could not be written" : "No sources were retrieved and no answer was written") };
  }
  if (i.verification && i.verificationCurrent && i.verification.contradicted > 0) {
    return { terminal: "verification_failed", stop: i.coverage?.exhausted ? "budget_exhausted" : "coverage_sufficient", failure: "verification_failure", reason: `${i.verification.contradicted} claim${i.verification.contradicted === 1 ? "" : "s"} contradicted by the sources read remain in the answer` };
  }
  if (i.coverage?.exhausted) return { terminal: "budget_exhausted", stop: "budget_exhausted", reason: i.coverage.reason };
  if (i.timeExceeded) return { terminal: "budget_exhausted", stop: "hard_limit", reason: "The run's time budget was spent before coverage was adequate" };
  if (i.sourcesFound === 0) return { terminal: "partial", stop: "source_unavailable", reason: "No sources were retrieved; the answer states general practice and is not source-backed" };
  if (i.verificationUnavailable) return { terminal: "partial", stop: "verification_unavailable", reason: i.verificationUnavailable };
  if (i.verification && !i.verificationCurrent) return { terminal: "partial", stop: "verification_unavailable", reason: "The answer was revised after verification and the revised text was not re-verified" };
  if (!i.verification) return { terminal: "partial", stop: "verification_unavailable", reason: "No claim was checked against a source read in full" };
  const failed = i.lanes.filter((l) => l.status === "error" || l.status === "timeout" || l.status === "skipped");
  const degraded = i.lanes.filter((l) => l.status === "done" && l.error);
  if (failed.length) return { terminal: "partial", stop: "coverage_sufficient", reason: `${failed.length} of ${i.lanes.length} lanes ${failed.length === 1 ? "did not finish" : "did not finish"}: ${failed.map((l) => `${l.name} (${l.status === "timeout" ? "timed out" : l.error ?? l.status})`).join("; ")}` };
  if (degraded.length) return { terminal: "partial", stop: "coverage_sufficient", reason: `Provider failures inside ${degraded.length === 1 ? "a lane" : `${degraded.length} lanes`}: ${degraded.map((l) => `${l.name} — ${l.error}`).join("; ")}` };
  return { terminal: "succeeded", stop: "coverage_sufficient", reason: i.coverage?.reason ?? "coverage adequate" };
}

/**
 * The research run: plan lanes → schedule them (bounded, dependency-aware) → synthesize
 * from the lane sources only → verify claims against the answer hash → correct and
 * re-verify → cross-check citations → decide whether another round is needed →
 * follow-ups → persist with an explicit terminal state + audit.
 * Streams the §46 event vocabulary; aborts everything on the client's signal.
 */
export async function runResearch(input: RunResearchInput, send: Send, signal: AbortSignal | undefined, deps: EngineDeps = defaultDeps()): Promise<RunResearchResult> {
  const startedAt = Date.now();
  const requestedAt = input.requestedAt ?? startedAt;
  const runId = input.runId ?? `run_${nanoid(10)}`;
  const question = input.question.trim();
  const settings = input.settings;
  const mode: ResearchMode = settings.fast ? "fast" : "deep";
  const policy = resolvePolicy(mode, input.policy);
  const maxRounds = mode === "fast" ? 1 : MAX_ROUNDS_DEEP;
  const matter: Matter | null = settings.matterId ? db().matters.get(settings.matterId) : null;
  const existing = input.threadId ? getThread(input.threadId) : null;
  const threadReplaced = Boolean(input.threadId && !existing);
  const thread: ResearchThread = existing ?? createThread({ question, settings });
  const createdThread = !existing;
  const aborted = () => Boolean(signal?.aborted);
  const metrics = new MetricsRecorder(requestedAt);

  const emitter = createEmitter<ResearchStreamEvent>(runId, send);
  const emit = (e: ResearchEventInput) => {
    if (e.type === "source.found") metrics.mark("firstEvidence");
    if (e.type === "source.read") metrics.mark("firstRead");
    if (e.type === "answer.delta") metrics.mark("firstModelToken");
    emitter.emit(e as never);
  };

  metrics.mark("acknowledged");
  emit({ type: "run.started", threadId: thread.id, question, mode, startedAt, requestedAt, threadReplaced: threadReplaced || undefined });

  const texts = new Map<string, string>();
  const reads = createReadRegistry(texts);
  // Sources from earlier turns in the thread stay citable (their excerpts stand in for text); new reads replace them.
  let pool: ResearchSource[] = thread.sources.map((s) => ({ ...s, laneIds: [] }));
  for (const s of pool) if (s.read && s.excerpt) texts.set(s.id, s.excerpt);
  // Prior-turn sources are stored without their text. Re-read them through the 24h cache (in parallel with the
  // lanes) so a follow-up answer is verified against full text rather than a 600-character excerpt.
  const rehydration = deps.hasKey ? rehydratePriorSources(pool, texts, deps, signal) : Promise.resolve(0);
  const laneSummaries: LaneSummary[] = [];
  let agents = 0;
  let rounds = 0;
  let answer = "";
  let artifactVersion = 0;
  let artifactHash = "";
  let citeMap: Record<number, string> = {};
  let numbered: ResearchSource[] = [];
  let verification: VerificationSummary | null = null;
  let verificationUnavailable: string | null = null;
  let verifiedAt: number | null = null;
  let citationChecks: ResearchMessage["citations"] = [];
  let citationCheck: ResearchMessage["citationCheck"];
  let banner: AnswerBanner = null;
  let synthesisInstructions = "";
  let refinements: Partial<Record<LaneKind, string[]>> | undefined;
  let noKey = !deps.hasKey;
  let failure: FailureKind | undefined;
  let failureMessage: string | undefined;
  let coverage: CoverageDecision | null = null;
  let timeExceeded = false;
  const laneNotes: string[] = [];

  const matterLine = matter
    ? `Active matter: ${matter.name} (${matter.caption ?? matter.shortName}); client ${matter.client} (${matter.clientSide}); ${matter.court ?? ""}; stage: ${matter.stage ?? "n/a"}. ${matter.description ?? ""}`
    : "No matter selected.";

  const modelRetry = { retries: policy.modelRetries, baseMs: policy.retryBaseMs, maxMs: policy.retryMaxMs, signal };

  /** Publish a new version of the answer text; every verdict from here on binds to its hash. */
  const publishVersion = (text: string, stage: "draft" | "revised") => {
    artifactVersion++;
    artifactHash = answerHash(text);
    emit({ type: "artifact.created", artifactId: answerArtifactId(runId, artifactVersion), artifactHash, version: artifactVersion, stage, kind: "research.answer", text, citeMap });
  };

  const verifiableSources = () => numbered.filter((s) => s.read && (texts.get(s.id) ?? s.excerpt));
  const verifyInput = (list: ResearchSource[]) => list.map((s) => ({ title: s.title, cite: s.cite ?? formatBluebook(s.hit), url: s.url, text: texts.get(s.id) ?? s.excerpt ?? "" }));

  /** One verification pass over the current answer text, bound to its hash. */
  const runVerification = async (pass: number, verifiable: ResearchSource[]): Promise<VerificationSummary> => {
    const hash = artifactHash;
    emit({ type: "verification.started", artifactHash: hash, sources: verifiable.length, pass });
    const v = await timedModelCall(metrics, () => withRetry(() => deps.verify({ answer, sources: verifyInput(verifiable), signal }), modelRetry));
    agents++;
    const summary = toSummary(v, verifiable, hash, pass);
    for (const x of summary.verdicts) {
      if (x.status === "supported") emit({ type: "claim.supported", artifactHash: hash, claim: x.claim, sourceN: x.sourceN, quote: x.quote });
      else if (x.status === "contradicted") emit({ type: "claim.contradicted", artifactHash: hash, claim: x.claim, sourceN: x.sourceN, quote: x.quote, note: x.note });
      else emit({ type: "claim.unsupported", artifactHash: hash, claim: x.claim, sourceN: x.sourceN, note: x.note });
    }
    emit({ type: "verification.completed", artifactHash: hash, status: summary.status, supported: summary.supported, unsupported: summary.unsupported, contradicted: summary.contradicted, score: summary.score, pass, verification: summary });
    verifiedAt = Date.now();
    return summary;
  };

  try {
    for (let round = 1; round <= maxRounds && !aborted(); round++) {
      if (round > 1 && Date.now() - startedAt > policy.runTimeMs) { timeExceeded = true; break; }
      rounds = round;
      const lanes: ResearchLane[] = planLanes({ question, settings, mode, hasMatter: Boolean(matter), round, refinements });
      emit({ type: "plan.created", round, reason: round === 1 ? undefined : "coverage was thin; refined queries", lanes });

      // --- lanes: bounded concurrency, dependency-aware, per-lane timeouts ------
      const known = pool;
      const laneResults = await scheduleLanes<ResearchLane, LaneResult>(
        lanes,
        (lane, slot) => runLane(lane, { question, settings, matter, deps, emit, signal: slot.signal, runSignal: signal, timedOut: slot.timedOut, texts, reads, known, policy, metrics, priors: slot.priors }, { queuedMs: slot.queuedMs }),
        {
          concurrency: policy.laneConcurrency,
          signal,
          defaultTimeoutMs: policy.laneTimeoutMs,
          onQueueWait: (ms) => metrics.addQueueWait(ms),
          skipped: (lane) => {
            emit({ type: "lane.completed", laneId: lane.id, status: "skipped", durationMs: 0, sources: 0, read: 0, failure: "cancelled" });
            return { laneId: lane.id, status: "skipped", sources: [], read: 0, note: "", agentRan: false, durationMs: 0, failure: "cancelled", failures: [] };
          },
        },
      );
      const results: LaneResult[] = lanes.map((l) => laneResults.get(l.id)!).filter(Boolean);
      for (const r of results) {
        pool = mergeSources(pool, r.sources);
        if (r.agentRan) agents++;
        const lane = lanes.find((l) => l.id === r.laneId)!;
        if (r.note) laneNotes.push(`### ${lane.name}\n${r.note}`);
        laneSummaries.push({ id: lane.id, name: lane.name, kind: lane.kind, status: r.status, sources: r.sources.length, read: r.read, durationMs: r.durationMs, round, error: r.error, failure: r.failure });
      }
      if (aborted()) break;

      const n = numberSources(pool);
      numbered = n.sources;
      citeMap = n.citeMap;

      // --- synthesis (primary model, lane sources only) ----------------------
      if (noKey) break;
      await rehydration;
      emit({ type: "synthesis.started", round, sources: numbered.length, read: numbered.filter((s) => s.read).length });
      const j = jurisdictionByKey(settings.jurisdiction);
      const courts = resolveCourts(settings.jurisdiction, settings.courts);
      const range = datePresetRange(settings.datePreset, { from: settings.dateFrom, to: settings.dateTo });
      synthesisInstructions = [
        `You are the legal research agent for ${firmLabel()}, writing the synthesis for a research thread. ${todayLine()}`,
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
      let tail = "";
      const sourceCount = numbered.length;
      try {
        const res = await timedModelCall(metrics, () => deps.synthesize({
          instructions: synthesisInstructions,
          input: synthInput,
          signal,
          onDelta: (d) => {
            emit({ type: "answer.delta", delta: d });
            if (!metrics.has("firstSourceBacked")) {
              tail = (tail + d).slice(-12);
              const m = tail.match(/\[(\d{1,2})\]/);
              if (m && Number(m[1]) >= 1 && Number(m[1]) <= sourceCount) metrics.mark("firstSourceBacked");
            }
          },
        }), (r) => (typeof r === "string" ? undefined : r.usage));
        draft = typeof res === "string" ? res : res.text;
        agents++;
      } catch (e) {
        if (isAbortError(e)) break;
        if (e instanceof AIConfigError) { noKey = true; break; }
        failure = classifyFailure(e);
        failureMessage = `Synthesis failed: ${providerMessage(e)}`;
        break;
      }
      answer = draft.trim();
      publishVersion(answer, "draft");
      if (aborted()) break;

      // --- verification loop (hash-bound) ----------------------------------------
      verificationUnavailable = null;
      const verifiable = verifiableSources();
      if (verifiable.length && answer) {
        try {
          const first = await runVerification(1, verifiable);
          verification = first;
          if (!aborted() && first.unsupported + first.contradicted > 0) {
            const draftHash = artifactHash;
            emit({ type: "correction.started", artifactHash: draftHash, unsupported: first.unsupported, contradicted: first.contradicted });
            try {
              const correctionInput = `ANSWER:\n${answer}\n\nSOURCES (read):\n${renderSourcesForPrompt(verifiable, texts, { maxCharsPerSource: 4000, maxTotalChars: 50_000 })}\n\nVERDICTS:\n${first.verdicts.map((x) => `- [${x.status}] ${x.claim}${x.sourceN ? ` (source [${x.sourceN}])` : ""}${x.quote ? ` — "${x.quote}"` : ""}${x.note ? ` — ${x.note}` : ""}`).join("\n")}`;
              const revisedRaw = await timedModelCall(metrics, () => withRetry(() => deps.correct({ instructions: CORRECTION_INSTRUCTIONS, input: correctionInput, signal }), modelRetry));
              agents++;
              const revised = revisedRaw.trim();
              const changed = revised.length > 0 && revised !== answer;
              if (changed) {
                answer = revised;
                publishVersion(answer, "revised");
                emit({ type: "correction.completed", artifactHash: draftHash, changed: true, note: `${first.unsupported + first.contradicted} claim(s) revised or flagged after verification`, newArtifactHash: artifactHash });
                // The answer changed, so the verdicts for the draft hash no longer count: re-verify the revised text.
                if (!aborted()) {
                  try {
                    verification = await runVerification(2, verifiable);
                  } catch (e) {
                    if (isAbortError(e)) break;
                    verificationUnavailable = `The revised answer could not be re-verified (${providerMessage(e)}); the verdicts shown are for the earlier draft`;
                    emit({ type: "verification.unavailable", artifactHash, reason: verificationUnavailable, failure: classifyFailure(e) });
                  }
                }
              } else {
                emit({ type: "correction.completed", artifactHash: draftHash, changed: false, note: "Verification flagged claims but the correction pass made no changes; unsupported claims remain marked in the verdicts." });
              }
            } catch (e) {
              if (isAbortError(e)) break;
              emit({ type: "correction.completed", artifactHash: draftHash, changed: false, note: `Correction pass unavailable (${providerMessage(e)}); unsupported claims are flagged in the verdicts.` });
            }
          }
        } catch (e) {
          if (isAbortError(e)) break;
          verificationUnavailable = `Verification unavailable: ${providerMessage(e)}`;
          emit({ type: "verification.unavailable", artifactHash, reason: verificationUnavailable, failure: classifyFailure(e) });
        }
      } else if (answer) {
        verificationUnavailable = numbered.length ? "No source was read in full, so no claim could be checked against its text" : "No sources were retrieved, so no claim could be checked";
        emit({ type: "verification.unavailable", artifactHash, reason: verificationUnavailable, failure: "no_result" });
      }
      if (aborted()) break;

      // --- coverage decision -------------------------------------------------
      const emptyLaneIds = results.filter((r) => r.sources.length === 0).map((r) => r.laneId);
      coverage = decideCoverage({ round, maxRounds, sources: pool, answer, verification, lanes, emptyLaneIds });
      if (!coverage.complete || coverage.exhausted) emit({ type: "coverage.gap", round, reason: coverage.reason, gaps: coverage.gaps, refinements: coverage.refinements as Record<string, string[]> });
      emit({ type: "round.completed", round, complete: coverage.complete, reason: coverage.reason });
      if (coverage.complete) break;
      refinements = coverage.refinements;
      if (coverage.gaps.length) {
        try {
          const modelRefinements = await timedModelCall(metrics, () => deps.refine({ question, gaps: coverage!.gaps, laneKinds: lanes.map((l) => l.kind), signal }));
          for (const [k, qs] of Object.entries(modelRefinements) as [LaneKind, string[]][]) if (qs?.length) refinements[k] = Array.from(new Set([...(refinements[k] ?? []), ...qs])).slice(0, 3);
        } catch (e) {
          if (isAbortError(e)) break;
          /* deterministic refinements are enough */
        }
      }
    }
  } catch (e) {
    if (!isAbortError(e)) { failure = classifyFailure(e); failureMessage = providerMessage(e); }
  }

  // --- citation integrity (structured; the answer text itself is not rewritten) ----
  if (answer && !aborted()) {
    const cross = crossCheckCitations(answer, numbered);
    let remote = new Set<string>();
    if (cross.unmatched.length) {
      try { remote = new Set((await deps.verifyCitationsRemote(cross.unmatched.map((c) => c.citation).join("; "), signal)).map(normCite)); } catch { /* offline: everything stays unresolved/requires review */ }
    }
    citationChecks = withCitationStates(cross.checks, remote);
    citationCheck = buildCitationCheck(artifactHash, citationChecks);
    emit({ type: "citation.checked", artifactHash, resolved: citationCheck.resolved, unresolved: citationCheck.unresolved, requiresReview: citationCheck.requiresReview, checks: citationChecks, citationCheck });
  }

  // --- banner -----------------------------------------------------------------
  const cited = citedNumbers(answer);
  if (noKey) banner = "no-api-key";
  else if (answer && (cited.size === 0 || numbered.length === 0)) banner = "not-source-backed";

  if (answer && !aborted()) {
    emit({ type: "artifact.created", artifactId: answerArtifactId(runId, artifactVersion), artifactHash, version: artifactVersion, stage: "final", kind: "research.answer", text: answer, citeMap });
    metrics.mark("finalAnswer");
  }
  const verificationCurrent = Boolean(verification && verification.artifactHash === artifactHash);
  if (verificationCurrent && verifiedAt != null) metrics.markAt("verifiedAnswer", verifiedAt);

  // --- follow-ups ---------------------------------------------------------------
  let followUps: string[] = [];
  if (!aborted()) {
    if (!noKey && answer) {
      try { followUps = await timedModelCall(metrics, () => deps.followUps({ question, answer, matterLine, signal })); } catch { followUps = []; }
    }
    if (!followUps.length) followUps = fallbackFollowUps(question, settings, matter);
  }

  // --- outcome -------------------------------------------------------------------
  const wasAborted = aborted();
  const outcome = decideOutcome({ aborted: wasAborted, answer, noKey, failure, failureMessage, coverage, timeExceeded, verification, verificationCurrent, verificationUnavailable, sourcesFound: pool.length, lanes: laneSummaries });

  // --- provenance, persistence, audit --------------------------------------------
  const finalNumbered = numbered.map((s) => (cited.has(s.n ?? -1) ? s : { ...s, n: undefined }));
  // Provenance describes an answer. A retrieval-only turn (no key, synthesis failed) has nothing to attest or review,
  // so it carries no provenance and never lands in the review queue.
  const provenance = answer && !noKey ? assembleProvenance({ sources: finalNumbered, verification: verificationCurrent ? verification : null, instructions: synthesisInstructions || undefined, question, model: deps.model, citationMismatches: citationChecks?.filter((c) => !c.matched).length ?? 0 }) : undefined;
  if (provenance && !wasAborted) {
    try { attachProvenance({ kind: "research", recordId: runId, matterId: settings.matterId ?? undefined, title: question.slice(0, 140), href: `/search?thread=${thread.id}`, provenance }); } catch (e) { console.warn("[research] provenance sidecar failed", (e as Error).message); }
    if (provenance.review?.status === "pending") emit({ type: "review.required", artifactHash, reason: provenance.review.note ?? "Below the confidence gate" });
  }
  const stats: RunStats = { sources: pool.length, read: pool.filter((s) => s.read).length, rounds, agents, durationMs: Date.now() - startedAt };
  const finalMetrics = metrics.snapshot();
  const coverageSummary: CoverageSummary | undefined = coverage ? { complete: coverage.complete && !coverage.exhausted, reason: coverage.reason, gaps: coverage.gaps } : undefined;
  const message: ResearchMessage = {
    id: `msg_${nanoid(8)}`,
    role: "assistant",
    content: answer,
    createdAt: new Date().toISOString(),
    runId,
    stats,
    verification: verification ? { ...verification, verdicts: verification.verdicts.slice(0, 40) } : undefined,
    citations: citationChecks?.length ? citationChecks : undefined,
    citationCheck,
    provenance,
    banner,
    followUps,
    citeMap: Object.fromEntries(Object.entries(citeMap).filter(([n]) => cited.has(Number(n)))),
    lanes: laneSummaries,
    artifactHash: answer ? artifactHash : undefined,
    artifactVersion: answer ? artifactVersion : undefined,
    terminal: outcome.terminal,
    stop: outcome.stop,
    failure: outcome.failure,
    failureMessage: outcome.terminal === "failed" || outcome.terminal === "cancelled" ? outcome.reason : failureMessage,
    metrics: finalMetrics,
    coverage: coverageSummary,
    mode,
  };
  message.trust = answer ? messageTrustState(message, finalNumbered) : "generated";
  const compact = pool.map(compactSource);
  // A cancelled run keeps its partial answer; one that was stopped before any answer leaves no trace (and no empty thread).
  const persist = !wasAborted || Boolean(answer);
  if (persist) {
    appendToThread(thread.id, { question, answer: message, sources: compact, runId, settings });
    recordResearchRun({ id: runId, threadId: thread.id, question, settings, startedAt, sources: compact, message, mode, savedSearchId: input.savedSearchId, noKey });
    audit("ai.generate", { kind: "research", id: runId, label: question.slice(0, 120), matterId: settings.matterId ?? undefined }, {
      threadId: thread.id, mode, terminal: outcome.terminal, stop: outcome.stop ?? null, failure: outcome.failure ?? null, sources: stats.sources, read: stats.read, rounds: stats.rounds, agents: stats.agents, durationMs: stats.durationMs,
      verification: verification ? { status: verification.status, supported: verification.supported, unsupported: verification.unsupported, contradicted: verification.contradicted, score: verification.score, artifactHash: verification.artifactHash, current: verificationCurrent } : null,
      citationsUnmatched: citationChecks?.filter((c) => !c.matched).length ?? 0, banner, model: noKey ? null : deps.model, artifactHash: message.artifactHash ?? null, trust: message.trust,
      metrics: { acknowledgedMs: finalMetrics.acknowledgedMs, firstEvidenceMs: finalMetrics.firstEvidenceMs, firstModelTokenMs: finalMetrics.firstModelTokenMs, firstSourceBackedMs: finalMetrics.firstSourceBackedMs, finalAnswerMs: finalMetrics.finalAnswerMs, verifiedAnswerMs: finalMetrics.verifiedAnswerMs, totalMs: finalMetrics.totalMs, toolTimeMs: finalMetrics.toolTimeMs, modelTimeMs: finalMetrics.modelTimeMs, tokens: finalMetrics.tokens.total },
    });
    try { sweepCache(); } catch { /* best effort */ }
  } else if (createdThread) {
    deleteThreadIfEmpty(thread.id);
  }

  const outcomePayload = { threadId: thread.id, message, sources: compact, metrics: finalMetrics };
  if (outcome.terminal === "cancelled") emit({ type: "run.cancelled", ...outcomePayload, terminal: "cancelled", stop: "cancelled", partial: Boolean(answer) });
  else if (outcome.terminal === "failed") emit({ type: "run.failed", ...outcomePayload, terminal: "failed", failure: outcome.failure ?? "unknown", error: outcome.reason, stop: outcome.stop });
  else if (outcome.terminal === "succeeded") emit({ type: "run.completed", ...outcomePayload, terminal: "succeeded", stop: "coverage_sufficient" });
  else emit({ type: "run.partial", ...outcomePayload, terminal: outcome.terminal, stop: outcome.stop ?? "hard_limit", reason: outcome.reason });

  return { runId, threadId: thread.id, message, sources: compact, stats, aborted: wasAborted, terminal: outcome.terminal, stop: outcome.stop, failure: outcome.failure, metrics: finalMetrics };
}

function citedNumbers(answer: string): Set<number> {
  const out = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) out.add(Number(m[1]));
  return out;
}

function toSummary(v: VerificationResult, sources: ResearchSource[], artifactHash: string, pass: number): VerificationSummary {
  return {
    status: v.status,
    supported: v.supported,
    unsupported: v.unsupported,
    contradicted: v.contradicted,
    score: v.score,
    checkedAt: v.checkedAt,
    artifactHash,
    pass,
    verdicts: v.verdicts.map((x) => ({ claim: x.claim, status: x.status, sourceN: x.sourceIndex != null ? sources[x.sourceIndex]?.n ?? null : null, quote: x.quote, note: x.note })),
  };
}

/** Ordinary legal words that read better lower-cased mid-sentence (a capitalised first word that is not on this list is treated as a name or acronym). */
const LOWERCASE_LEAD = new Set(["the", "a", "an", "government", "federal", "state", "court", "courts", "manufacturer", "manufacturers", "plaintiff", "plaintiffs", "defendant", "defendants", "removal", "preemption", "standard", "statute", "statutes", "regulation", "regulations", "consequential", "punitive", "strict", "comparative", "joint", "class", "expert", "discovery", "deposition", "privilege", "attorney", "work", "damages", "liability", "negligence", "breach", "contract", "warranty", "design", "failure", "product", "products", "jurisdiction", "venue", "choice", "forum", "collateral", "summary", "motion", "motions", "rule", "rules", "evidence", "testimony", "notice", "reporting", "liability"]);

/** The proposition inside a question, for deterministic follow-ups ("Is X available in Y?" → "X available in Y"). */
export function questionTopic(question: string): string {
  let t = question.replace(/\s+/g, " ").replace(/[?!.\s]+$/, "").trim();
  t = t.replace(/^(is|are|was|were|does|do|did|can|could|may|might|must|should|would|will|has|have|had)\s+(?:(?:a|an|the)\s+)?/i, "");
  t = t.replace(/^(what|which|when|how|whether|why|where|who)\s+(?:(?:is|are|does|do|did|can|must|should|would|will)\s+)?(?:(?:the|a|an)\s+)?/i, "");
  if (!t) return question.trim();
  // Lower-case a leading ordinary word ("Removal…" → "removal…") but leave acronyms and case names alone ("TSCA", "PAGA", "Boyle v.").
  if (/^[A-Z][a-z]+\s/.test(t) && !/^[A-Z][a-z]+\s+v\.\s/.test(t) && LOWERCASE_LEAD.has(t.split(" ")[0].toLowerCase())) t = t.charAt(0).toLowerCase() + t.slice(1);
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
  const m = input.message;
  const run: SearchRun = {
    id: input.id,
    threadId: input.threadId,
    query: input.question,
    settings: input.settings,
    createdAt: new Date(input.startedAt).toISOString(),
    durationMs: Date.now() - input.startedAt,
    counts,
    synthesis: m.content ? m.content.slice(0, 16_000) : undefined,
    topHits: topHits.slice(0, 12),
    ownerId: researchPrincipalId(),
    matterId: input.settings.matterId ?? null,
    savedSearchId: input.savedSearchId,
    aiStatus: input.noKey ? "no_api_key" : m.content ? "ok" : "error",
    mode: input.mode,
    stats: m.stats,
    verification: m.verification ? { status: m.verification.status, supported: m.verification.supported, unsupported: m.verification.unsupported, contradicted: m.verification.contradicted, score: m.verification.score, checkedAt: m.verification.checkedAt } : undefined,
    provenance: m.provenance,
    banner: m.banner ?? undefined,
    followUps: m.followUps,
    sources: input.sources.slice(0, 40),
    terminal: m.terminal,
    stop: m.stop,
    failure: m.failure,
    metrics: m.metrics,
    artifactHash: m.artifactHash,
    trust: m.trust,
  };
  searchRuns().put(run);
  if (input.savedSearchId) updateSavedSearch(input.savedSearchId, { lastRunAt: run.createdAt, runCount: (savedSearches().get(input.savedSearchId)?.runCount ?? 0) + 1 });
  const all = searchRuns().list({ sortBy: "createdAt", direction: "desc" });
  for (const old of all.slice(250)) searchRuns().delete(old.id);
  return run;
}

/** Human-readable stop reason for logs and the UI. */
export function describeStop(stop: ResearchStopState | undefined): string {
  return stop ? STOP_LABEL[stop] : "";
}
