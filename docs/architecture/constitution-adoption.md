# Constitution adoption record

The root `CLAUDE.md` is the LeClaude engineering constitution. This record maps its
requirements to the mechanisms in this repository, states what is done, what is in
flight and what remains, and records the decisions taken while adopting it. It is
updated with every wave.

## Status legend

- **done** — implemented, tested, pushed
- **wave** — implemented by the current wave, pending integration and verification
- **planned** — designed, not started

## Mapping

| Constitution area | Mechanism in this repository | Status |
| --- | --- | --- |
| Governing document, appendix conventions | `CLAUDE.md` (root) + Appendix A; `.cursor/rules/leclaude.mdc` points at it | done |
| Repository hooks: destructive-command guard, per-file lint, verification stamps, stop gate, subagent contract and handoff check, pre-compaction state | `.claude/settings.json`, `.claude/hooks/*.sh`, state under `.claude/state/` (ignored) | done |
| Provider-neutral model runtime contracts | `src/lib/ai/providers/types.ts` | done |
| Coded capability matrix | `src/lib/ai/capabilities.ts` | done |
| Fail-closed model routing (role → provider order, explicit model, privacy boundary) | `src/lib/ai/router.ts` | done |
| Providers: OpenAI (Responses), Anthropic (Messages over fetch), Bedrock (SigV4 + eventstream), OpenRouter (router role only) | `src/lib/ai/providers/{openai,anthropic,bedrock,openrouter,sigv4,eventstream,registry}.ts` | wave 1 |
| Runtime entry with fallback and telemetry; `runAgent`/`generateText`/`generateJSON`/`describeImage` rewired | `src/lib/ai/runtime.ts`, `src/lib/ai/telemetry.ts`, `src/lib/ai/agent.ts` | wave 1 |
| Authorization contracts (principal ∩ tenant ∩ role ∩ matter ∩ resource ∩ action) | `src/lib/auth/types.ts` | done |
| Principal resolution (dev / header / jwt), policy matrix, route wrapper, audit log, request-scoped principal context | `src/lib/auth/{principal,policy,route,audit,context}.ts` | wave 1 |
| Routes wrapped with `withAuth` | library, search, blobs, home, integrity, intel, workflows, settings, matters (wave 1); office, ai, ediscovery, agents (wave 2) | wave 1 / planned |
| Evidence contract (refs, citation and claim states, trust states, hash-bound verification) | `src/lib/evidence/{types,trust}.ts` | done |
| Citation resolution without substitution, claim verification, trust records | `src/lib/evidence/{hash,resolve,verify,records}.ts` | wave 1 |
| Evidence fixes at known violations (`src/modules/ediscovery/analysis/ai.ts` first-document fallback; unscoped `resolvePersonName`) | wave 2 after the e-discovery analysis build completes | planned |
| Evals with the eight must-have adversarial cases | `evals/`, `tests/evals-*.test.ts` | wave 1 |
| Research engine: terminal/stop states, typed §46 events, cancellation, per-run metrics, fast-vs-deep trust UX | `src/modules/search/engine/**`, `src/lib/ai/events.ts`, `TrustBadge` states | wave 1 (W3) |
| Safe egress (SSRF guard, redirect validation, byte/time limits), rate limiting, upload guard, log redaction | `src/lib/net/{safe-fetch,rate-limit,upload-guard,redact}.ts` wired into intel providers and toolkit fetch tools | wave 1 (W4) |
| Durable jobs: leases, heartbeat, idempotency, dead-letter, boot recovery, one tick driver (cron in production, inline loop in dev) | `src/modules/intel/jobs.ts`, `background.ts`, `src/instrumentation.ts`, `vercel.json` | wave 1 (W4) |
| Retrieval matter scope (no implicit "all"), strict mode, unscoped-call report; tool contract (examples, timeouts, bounded results, authorization hook, `runTool`) | `src/lib/ai/vector-store.ts`, `src/lib/ai/tools.ts`, `src/lib/ai/toolkit/{internal,legal}.ts` | wave 1 (W5) |
| Workflow engine: terminal states, cancellation/retry, budgets and cost telemetry, leases/checkpoints, §46 events, upload validation | `src/modules/workflows/{engine,events,service,scheduler}.ts`, run UI | wave 1 (W6) |
| Orchestrator terminal states (never reduced to "done") | `RunTerminalState` in `src/lib/ai/providers/types.ts`; research engine (W3) and workflow engine (W6) | wave 1 |
| Durable background jobs with steward auto-fix and escalation | `src/modules/intel/jobs*`, `src/instrumentation.ts`, `vercel.json` cron | done |
| Trust signaling in UI (no overstated certainty) | `TrustBadge`, `ProvenanceBadge`, `trustLabel()` | done / wave 1 |

## Decisions

**D1 — No new SDKs.** Anthropic, Bedrock and OpenRouter providers use `fetch`; Bedrock
requests are signed with an in-repo SigV4 implementation and the response stream is
decoded with an in-repo eventstream parser. Dependencies stay as they are (no
`npm install`), and every provider is unit-testable offline.

**D2 — Model ids come from configuration only.** `registry.ts` builds descriptors from
environment variables (`*_MODEL`, `*_FAST_MODEL`, `*_EMBEDDING_MODEL`). Nothing in the
code guesses a model id; a missing id means the provider is not configured.

**D3 — Routing fails closed.** A request whose needs no configured provider can serve
raises `InferenceError("capability_unavailable")`; matter data never reaches an
external-boundary provider unless `ROUTER_ALLOW_MATTER_DATA=true`. Fallback happens only
on retryable errors (rate limit, provider unavailable, timeout), never on capability,
privacy or auth errors.

**D4 — `AIConfigError` stays the 503 contract.** Existing routes already handle
`AIConfigError`; the runtime maps `not_configured` to it at the `agent.ts` boundary so no
route changes are needed for the provider work.

**D5 — Authorization is enforced at the route, tool and data boundaries.** `withAuth`
wraps route handlers, `requireMatterAccess` guards tools, and `matterScope()` filters
queries. `AUTH_MODE=dev` keeps the current single-user development identity so the dev
database and smoke suite keep working; `header` and `jwt` modes are opt-in.

**D6 — Evidence is never substituted.** `resolveCitation` returns `resolved` only when the
record exists and the location is valid; ambiguity returns `requires_review`; there is no
first-candidate fallback. Verification and review decisions bind to the artifact hash;
a changed artifact drops back to the trust state its remaining evidence supports.

**D7 — Waves with disjoint ownership.** Adoption runs in waves so it never conflicts with the
phase-3 build agents that own module paths. Wave 1 runs six workers with disjoint file
ownership: W1 model runtime (`src/lib/ai/providers/**`, `agent.ts`), W2 authorization, evidence
and evals (`src/lib/auth/**`, `src/lib/evidence/**`, `evals/**`, routes outside module builds),
W3 research engine (`src/modules/search/**`), W4 egress security and durable jobs
(`src/lib/net/**`, intel providers/jobs), W5 retrieval scope and tool contract
(`src/lib/ai/vector-store.ts`, `tools.ts`, toolkit internal/legal), W6 workflow engine runtime
(`src/modules/workflows/engine|events|service|scheduler`). The lead integrates, resolves the
few shared seams (tool loop ↔ `runTool`, upload guard ↔ workflow uploads, evidence verify ↔
research citecheck) and runs adversarial review. Wave 2 applies the contracts inside
e-discovery (evidence fixes, deposition coverage, privilege CC), office (stale proposals,
route authorization) and agent routes once those builds land.

## Verification

Every wave is verified with `npx tsc --noEmit`, `npx eslint <changed files>`,
`npx vitest run` (full suite before a push), the smoke suite against a mirror server, and
the eval harness (`npx vitest run tests/evals-*.test.ts` with `LECLAUDE_EVALS=1`).

## Open items

- Wave 2 route wrapping and tool-level matter scope (office, ai, ediscovery, agents).
- Workflow engine terminal states and per-run cost telemetry in the run detail UI.
- `src/modules/office/word/agent.ts` still imports the OpenAI client directly; move it
  onto the runtime once the office build completes.
- Tool-use examples on the highest-traffic tools once the runtime supports them.
