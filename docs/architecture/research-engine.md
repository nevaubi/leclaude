# Research engine

`src/modules/search/engine/**` runs one research turn: plan → parallel lanes → synthesis over citation-native
evidence → claim verification (model + code) → correction and re-verification bound to the new answer hash →
citation cross-check → coverage decision (another round or stop) → persist with an explicit terminal state.
The SSE route is `POST /api/search/run`; the UI is `src/modules/search/components/**`.

## Flow

```text
question + scope (sources, jurisdiction, matter, fast/deep)
  → planLanes()                       deterministic lanes (controlling, contrary, regulatory, record, secondary | fast)
  → planSubQuestions()                deterministic, jurisdiction-aware; always includes the adverse question in deep mode
  → deps.planQueries()  [fast role]   runs CONCURRENTLY with the first retrieval wave; refines sub-questions + queries
  → scheduleLanes()                   bounded concurrency (5), per-lane timeouts, hard deps (dependsOn) + soft deps (after)
      each lane: wave 1 (provider × query, parallel) → publish to the LaneBoard
                 wave 2 (bounded waits): plan queries + queries targeting the controlling lane's cases (contrary lane)
                 read: fast/no-key → deterministic triage + parallel reads; deep → fast-model lane agent with tools
      source.read of a case → deps.citing() treatment check starts immediately (≤4, deep mode)
  → treatment results (bounded wait) + currentness flags + stable evidence ids on every source
  → numberSources()                   read first, binding first
  → no sources? broaden and retry while rounds remain; then a deterministic "The sources reviewed do not establish this." memo
  → buildEvidenceBlocks()             one search_result block per source, focused ¶-numbered paragraphs
  → deps.synthesize()  [primary role] byte-stable instructions per mode, evidence first, question last, streamed deltas
  → deps.verify()      [fast role]    claim verdicts over the same focused passages
  → checkClaimEvidence()  [code]      read-before-characterize, literal quote check, answer quotations checked
  → correction [fast role] + re-verification against the new hash
  → crossCheckCitations() + remote resolution → citation states (resolved / requires_review / unresolved)
  → decideCoverage() → next round or stop; decideOutcome() → terminal + stop state
```

## Speed (constitution §36)

- Every lane starts at once. The contrary lane used to wait for the whole controlling lane (`dependsOn`); it now
  has a soft dependency (`after`): it runs its own adverse queries immediately and, after its first wave, waits
  (bounded by `softDepWaitMs`) only for the controlling lane's first-wave results to target those cases.
- Fast-model planning never blocks first evidence: lanes start on deterministic queries and pick up the plan's
  queries in their second wave (bounded by `planWaitMs`).
- Deterministic reads (fast mode, no key) run in parallel; the shared read registry dedupes in-flight reads across
  lanes and the 24h source cache serves repeats across rounds and threads.
- Model roles (`engine/model-policy.ts`): plan, refine, triage, lane agents, verification, correction and follow-ups
  run on the fast role (`taskType` extract/classify/summarize); only synthesis runs on the primary role.
- Prompt caching (§37): synthesis instructions (`synthesisInstructions(mode, …)`), lane instructions
  (`laneInstructions(kind, …)`), the planner instructions and lane tool definitions are byte-stable; today's date,
  the matter, the jurisdiction, sub-questions and the question travel in the user turn. `cacheStablePrefix` is set.
- Metrics per run (`RunMetrics`): acknowledged, first evidence, first read, first model token, first source-backed
  statement (pinpoint markers count), final answer, verified answer, tool/model time, queue wait, tokens.

Measured with the fake-latency harness (retrieve 150 ms, read 150 ms, lane agent 300 ms, synthesis 300 ms;
4 deep lanes): contrary lane start 1008 ms → 6 ms, first answer token 1840 ms → 1241 ms, verified answer
2255 ms → 1705 ms, total 2406 ms → 1837 ms.

## Evidence contract (§23, §25, §44)

- **Citation-native evidence.** `buildEvidenceBlocks()` turns each numbered source into a `search_result` block:
  `source` is a stable server-side id (`authority://courtlistener/opinion/<id>`, `authority://ecfr/title-<t>/section-<s>`,
  `authority://federalregister/<doc>`, `authority://govinfo/<pkg>[/<granule>]`, `matter://<matter>/document/<id>`,
  `library://…`, `intel://…`, or the canonical URL); the title carries the source number, Bluebook cite,
  binding/persuasive, MATTER RECORD / FIRM LIBRARY, treatment and currentness labels and READ vs SNIPPET ONLY; the
  content is focused paragraphs prefixed `¶k` (numbering = `splitParagraphs`, the reader's numbering). Array order
  equals the source number, so providers without `search_result` support render the same numbering as text.
- **Pinpoints.** Answers cite `[n]` or `[n ¶k]` (`engine/markers.ts`); chips open the reader at paragraph k.
- **Read before characterize.** `checkClaimEvidence()` demotes any "supported"/"contradicted" verdict whose source was
  not read in full, and any verdict whose quote does not literally appear in the source text (curly quotes, whitespace,
  ellipses and bracketed alterations normalised). Quotations in the answer attributed to `[n]` are checked the same way.
  The model's verdicts are only ever demoted, never upgraded.
- **Citation exists ≠ supports.** Citation states (resolved/requires_review/unresolved) and claim verdicts stay separate;
  a resolved citation with an unsupported claim is `claim_checked`, never `verified`.
- **No answer.** When nothing is retrieved after the allowed rounds, the engine writes a deterministic memo stating
  "The sources reviewed do not establish this." with what was searched — no model call, no authority.
- **Treatment.** `find_citing_opinions` / `deps.citing` searches CourtListener for citing opinions and for citing
  opinions using negative-treatment language. Result: "Treatment: possibly negative, review" or "No negative signal
  found … not a citator result". The engine never asserts good law.
- **Currentness.** `currentnessOf()`: proposed Federal Register rules are "not in force"; cases older than 25 years
  and secondary sources older than 10 are "dated".
- **Binding vs persuasive** comes from `classifyAuthority()` for the selected jurisdiction (or court override).

## Tools

Toolkit (`src/lib/ai/toolkit/legal.ts`, `RESEARCH_LEGAL_TOOLS`): `search_case_law` (court/date filters),
`get_opinion` (paragraph windows), `find_citing_opinions`, `resolve_citation` (resolved / ambiguous / unresolved —
never picks among candidates), `search_dockets`, `get_docket_entries`, `verify_citations`, `search_cfr`,
`get_cfr_section`, `search_federal_register`, `get_federal_register_document`, `search_statutes`,
`get_statute_section` (GovInfo U.S. Code). `LEGAL_TOOLS` is unchanged for existing consumers.

Lane tools (`engine/lanes.ts`, byte-stable per lane kind): provider searches through `deps.retrieve`, `read_source`,
`get_opinion` (reads through the run's read registry), `find_citing_opinions`, `resolve_citation`, `build_citation`
(deterministic Bluebook, `src/modules/search/bluebook.ts`), `compare_authorities` (holding sentences with ¶ only for
sources read in full), `search_matter_documents` / `read_matter_document` (built only when a matter is selected;
never widened), `fetch_url` (legal-domain allowlist unless Web is in scope; SSRF rules from `safe-fetch` apply),
`get_matter_context`, `verify_citations`.

## Output

`buildResearchMemo()` (`src/modules/search/memo.ts`): Question Presented, Short Answer, Analysis (pinpoints),
Contrary Authority, Open Issues plus engine-generated flags (unresolved citations, unsupported/contradicted claims,
treatment and currentness flags, coverage gaps), Sources with per-source state (Found / Snippet / Read / Source-backed /
Claim-checked / Verified / Contradicted), and a Table of Authorities (`engine/authorities.ts`) grouped by kind with the
pinpoints used. `POST /api/search/threads/:id/export {format: word|memo|toa, messageId?}` builds it server-side from
the stored thread; `word` creates an office Word document (`createOfficeDoc`) carrying the answer hash.

## Tests

`tests/search-engine.test.ts`, `tests/search.test.ts`, `tests/search-url-sync.test.ts`,
`tests/search-research-agent.test.ts` (concurrency with fake latency, adverse lane, evidence ids, quote demotion,
citation-exists-but-unsupported, no-answer, treatment, resolve_citation, Bluebook, memo/TOA/Send to Word) and
`tests/search-model-policy.test.ts` (fast vs primary routing through the real `defaultDeps()` with the agent facade mocked).
