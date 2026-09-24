# Anthropic platform notes applied to LeClaude

Working notes distilled from the Anthropic platform documentation and cookbooks reviewed
during constitution adoption (tool runner, tool use with prompt caching, advanced tool use,
programmatic tool calling, prompt caching, evals, legal summarization, prompting best
practices). Each note names the rule and where LeClaude applies it.

## Prompt caching

- The cache prefix is `tools` → `system` → `messages`, hashed cumulatively. A change at one
  level invalidates that level and everything after it. LeClaude keeps tool definitions and
  the system prompt byte-stable per agent persona (`src/lib/ai/agents/personas.ts`) and puts
  volatile context (matter facts, dates, the user turn) after them.
- Cache writes happen only at a breakpoint; lookback finds prior entries within 20 blocks.
  The runtime places one explicit breakpoint on the last stable system block and enables
  automatic caching (top-level `cache_control`) for the growing conversation; long tool loops
  therefore keep hitting the cache without manual breakpoint management. Automatic caching is
  not sent to the legacy Bedrock integration (400 there); Bedrock requests use explicit
  breakpoints only.
- Minimum cacheable prefix: 512 tokens on Fable 5.1 / Opus 5.5 / Opus 5, 1,024 on Sonnet 5
  and Sonnet 4.6. Shorter prefixes are silently uncached; telemetry records
  `cache_read_input_tokens` / `cache_creation_input_tokens` so misses are visible.
- Total input = `cache_read + cache_creation + input_tokens`; cost telemetry stores all three.
- Changing `tool_choice`, adding or removing images, or changing the thinking configuration
  or effort invalidates the cache. Routing keeps these constant within an agent run.
- Thinking blocks are cached alongside assistant turns and must be echoed back verbatim in
  tool loops; the Anthropic provider preserves assistant content blocks (including thinking
  signatures) when it appends the assistant turn.
- 1-hour TTL (`ttl: "1h"`) for background agents whose calls are more than five minutes apart
  (intel sweeps, steward retries); 1h entries must precede 5m entries in the prompt.
- Pre-warming with `max_tokens: 0` is available for latency-sensitive first turns; it is not
  combinable with streaming, thinking, structured outputs or forced tool choice, so LeClaude
  uses it only from the background loop, never in interactive routes.
- Server tool results (web search) are cached automatically and show up as unexpected 5m writes.

## Tool use

- Tool descriptions carry the "when" and the "when not"; parameters carry formats and
  examples. `input_examples` (Tool Use Examples) are sent by the Anthropic provider behind
  `ANTHROPIC_TOOL_EXAMPLES=true` and are the preferred place for tricky input formats
  (Bates ranges, page:line cites, ISO dates).
- Tool results are compact JSON; large text is truncated with an explicit marker so the
  model asks for the next window instead of assuming completeness.
- Deferred tools (Tool Search) keep the tool prefix small for large toolsets; `ToolSpec.defer`
  marks tools that providers with tool search may load on demand.
- Programmatic tool calling (`allowed_callers: ["code_execution_20250825"]` on tools plus the
  code execution tool, beta `advanced-tool-use-2025-11-20`) keeps large intermediate data out
  of the model's context: the cookbook shows an 85% token reduction on a multi-entity
  aggregation. Candidate LeClaude workloads: batch document coding statistics, intel sweeps
  that aggregate hundreds of docket entries, production QC counts. Only first-party Anthropic
  supports it; the capability matrix gates it and Bedrock routes stay on ordinary tool loops.
- The tool runner loop semantics apply to every provider: stop on `end_turn`, execute all tool
  calls in a `tool_use` turn, return every `tool_result` in one user turn, treat unknown stop
  reasons as terminal with the reason recorded (never as success).

## Long context and legal summarization

- Long documents go first, the question last; the model quotes the relevant passages before
  answering. LeClaude's evidence blocks (`search_result` with citations enabled) make the
  quote step verifiable: citations resolve to the block they came from.
- Meta-summarization for oversized records (chunk summaries → merged summary) and
  summary-indexed retrieval (search over summaries, then read the full source) are the two
  patterns behind the e-discovery chronology and the library digest; both keep the source
  read step explicit so trust states stay honest (`source_linked` before `citation_checked`).
- Domain-specific summaries use fixed fields (parties, dates, obligations, risks) so
  downstream code can grade completeness deterministically.

## Evals

- Success criteria are specific, measurable, achievable and relevant; multidimensional
  (fidelity, consistency, privacy, latency, cost).
- Prefer code-graded checks (exact / string / structural match), then LLM grading with a
  detailed rubric, reasoning first and a single verdict tag; avoid human grading except for
  calibration. Volume over polish: many cheap cases beat a few hand-graded ones.
- Include edge cases deliberately: irrelevant or nonexistent input, oversized input, hostile
  or injected content, ambiguous cases where experts disagree. The eight required adversarial
  cases under `evals/cases` follow this pattern and are code-graded wherever the behavior is
  deterministic (citation resolution, scope, hash binding, policy).
