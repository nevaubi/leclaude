# Model runtime

The model runtime is the single path every model call takes (constitution §14–§17, §19, §37, §42, §53.5). Callers
keep using `runAgent` / `generateText` / `generateJSON` / `describeImage` from `src/lib/ai/agent.ts`; underneath, a
provider-neutral `InferenceRequest` is routed over the configured providers and streamed back as one event vocabulary.

```
caller (module / route)
  │  runAgent · generateText · generateJSON · describeImage       src/lib/ai/agent.ts
  │  OpenAI-shaped options → InferenceRequest (messages, tools, builtins, evidence, jsonSchema, …)
  ▼
runtime.infer()                                                   src/lib/ai/runtime.ts
  │  deriveNeeds(req)  → capability needs (structuredOutput, serverWebSearch, codeExecution, vision, …)
  │  routeModel()      → RoutingDecision {provider, model, fallbacks}   src/lib/ai/router.ts (pure)
  │  prepareForProvider() → drop previous_response_id / callers where unsupported, evidence → numbered text
  │  provider.infer() → InferenceEvents (text.delta, reasoning.delta, tool.call, citation, web_search, usage, done)
  │  retryable failure before any output → next fallback; anything else → fail closed
  │  recordTrace()    → ai_traces (latency, tokens, cache reads/writes, fallbackFrom, error)   src/lib/ai/telemetry.ts
  ▼
providers/registry.ts   buildProviders() from the environment only
  ├─ providers/openai.ts      OpenAI Responses API (SDK): streaming tool loop, strict tools, json_schema, previous_response_id,
  │                           web_search / code_interpreter / image_generation built-ins, reasoning effort, cached tokens
  ├─ providers/anthropic.ts   Messages API over fetch: SSE, prompt caching, search_result evidence, server web search/fetch,
  │                           programmatic tool calling, structured outputs, adaptive / budget thinking
  ├─ providers/bedrock.ts     same Anthropic wire (providers/anthropic-wire.ts) posted to bedrock-runtime
  │                           InvokeModelWithResponseStream, SigV4 (providers/sigv4.ts) or bearer token,
  │                           AWS event-stream decoding (providers/eventstream.ts); Titan / Cohere embeddings
  └─ providers/openrouter.ts  OpenAI-compatible chat completions, router role only (external boundary)
```

## Request flow in `runAgent`

1. `toInferenceMessages(input)` converts the historical Responses `input` (string or items) into provider-neutral
   messages. Every original item is kept in `InferenceMessage.raw` so the OpenAI provider replays it byte-for-byte;
   other providers render the typed parts.
2. The conversation is kept **locally** across tool rounds. Each round appends the provider's `assistantTurn`
   (Anthropic: the exact content blocks, thinking blocks and signatures included; OpenAI: the `message` /
   `function_call` output items) and one `tool` message carrying every `tool_result` of that round, in call order.
3. `previousResponseId` is honoured on OpenAI only. Non-OpenAI providers always get the full history and return
   `responseId: null`, so the chat client keeps sending history. A round served by a provider without server-side
   state resets the continuation id.
4. Tools execute in parallel per round through `executeTool()`; when `tools.ts` exports `runTool` /
   `toProviderToolSpec` (workstream W5) they are used automatically, otherwise the local mapping in `agent.ts`
   (`toToolSpec`, `executeTool`) applies. The `ToolContext` stays `{ emit, signal, state }` with `traceId`,
   `runId` and `matterId` copied into `state`.
5. Stop reasons are explicit: `tool_calls` → next round, `pause_turn` → resend the turn as-is (server tool loop),
   `max_tokens` → status event, `refusal` → status event + stop, `unknown` → `InferenceError("incomplete")` (never
   treated as success).
6. `generateText` / `generateJSON` are one-shot (`store: false`); `generateJSON` runs the schema through
   `strictJsonSchema()` and each provider's structured output (OpenAI `text.format`, Anthropic
   `output_config.format` or a forced tool on old models, OpenRouter `response_format`).

A model id equal to `aiConfig().model` / `aiConfig().fastModel` is treated as a **role hint** (primary / fast) so the
capability-aware router can still pick the provider; any other explicit id is routed as such.

## Environment matrix

| Variable | Provider | Meaning |
|---|---|---|
| `MODEL_PROVIDER` | all | Preferred provider (`bedrock` \| `anthropic` \| `openai` \| `openrouter`) placed first in the role order. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_FAST_MODEL`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_BASE_URL`, `OPENAI_REASONING_EFFORT` | openai | Unchanged. The model ids keep their legacy defaults (`gpt-5.4`, `gpt-5.4-mini`, `text-embedding-3-large`, `gpt-image-1.5`), so a key alone configures OpenAI. `OPENAI_REASONING_EFFORT` is the default effort for every provider. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | anthropic | Both required; no default model id. |
| `ANTHROPIC_FAST_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_THINKING_BUDGET`, `ANTHROPIC_MAX_OUTPUT_TOKENS`, `ANTHROPIC_TOOL_EXAMPLES`, `ANTHROPIC_STRUCTURED_OUTPUT` | anthropic | Fast/router model (the primary serves those roles when unset); proxy base URL; legacy `budget_tokens` for Haiku 4.5 / Sonnet 4.5 and older; default `max_tokens` (16000); send `input_examples` (off); `auto` \| `native` \| `tool`. |
| `AWS_REGION` (or `AWS_DEFAULT_REGION`), `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` [+ `AWS_SESSION_TOKEN`] or `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_MODEL` | bedrock | Region, credentials and a model / inference-profile id (`global.anthropic.claude-opus-4-6-v1`, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, an inference-profile ARN). |
| `BEDROCK_FAST_MODEL`, `BEDROCK_EMBEDDING_MODEL`, `BEDROCK_THINKING_BUDGET`, `BEDROCK_MAX_OUTPUT_TOKENS`, `BEDROCK_STRUCTURED_OUTPUT` | bedrock | As for Anthropic; embeddings through Titan v2 (`amazon.titan-embed-*`) or Cohere (`cohere.embed-*`). |
| `OPENROUTER_API_KEY`, `OPENROUTER_ROUTER_MODEL`, `OPENROUTER_HTTP_REFERER` | openrouter | External router only. |
| `ROUTER_ALLOW_MATTER_DATA` | router | `true` lets requests with `privacy: "internal"` (the default) reach OpenRouter. Default `false`. |

A provider counts as configured only when its credentials **and** at least one model id are present
(`providers/env.ts → providerStates`). `aiRuntimeStatus()` in `config.ts` reports configured providers, the chosen
model per role and what is missing — names only, never values.

## Capability matrix

`src/lib/ai/capabilities.ts` is the coded matrix the router consults; nobody remembers platform differences.

| Capability | anthropic | bedrock | openai | openrouter |
|---|---|---|---|---|
| messages / streaming / thinking / promptCaching | ✓ | ✓ | ✓ (caching automatic) | messages, streaming |
| citations, searchResultBlocks | ✓ | ✓ | – (URL citations only) | – |
| filesApi | ✓ (not used in production) | – | ✓ | – |
| serverWebSearch / serverWebFetch / codeExecution | ✓ | – | web search, code interpreter | – |
| programmaticToolCalling, toolUseExamples, deferredTools | ✓ | – | – | – |
| structuredOutput | ✓ | ✓ | ✓ | ✓ |
| strictTools | ✓ | – (schemas sent as-is) | ✓ | – |
| embeddings | – | ✓ (Titan / Cohere) | ✓ | – |
| imageGeneration | – | – | ✓ | – |
| vision | ✓ | ✓ (base64 only) | ✓ | ✓ |
| previousResponseId | – | – | ✓ | – |

Model-family knowledge for the Anthropic wire lives in `providers/claude-models.ts` (pure, tested): Bedrock /
inference-profile ids are normalised (`us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `claude-sonnet-4-5`) and the
family decides the thinking shape, effort levels, server tool versions, native structured output and forced tool use.

## Routing rules

* Task → role: `route` → router, `classify` / `extract` / `summarize` → fast, `embed`, `image`, `vision`; everything
  else → primary. Callers pass `fast: true` or a role hint; runAgent defaults to `chat` / primary.
* Provider order per role: primary/fast/vision `bedrock → anthropic → openai`; router `openrouter → bedrock →
  anthropic → openai`; embedding `openai → bedrock`; image `openai`. `MODEL_PROVIDER` moves its provider first.
* Needs are derived from the request: `jsonSchema` → structuredOutput; built-ins → serverWebSearch / serverWebFetch /
  codeExecution / imageGeneration; image parts → vision. A provider lacking a need is skipped; if nobody satisfies
  it the router fails closed with a message naming the capability (Bedrock + web search: "configure Anthropic or
  OpenAI for this request, or run it without those built-in tools").
* Evidence prefers providers with `search_result` blocks + citations; when none qualifies it is rendered as numbered
  plain-text sources (`prepareForProvider`). Structured output + evidence also renders text (native citations are
  incompatible with `output_config.format`).
* Privacy: `privacy: "internal"` (default) never routes to an `external` model unless `ROUTER_ALLOW_MATTER_DATA` is
  set; the router role without an internal fast model fails with `privacy_boundary`.
* Explicit models must be served by a configured provider (`not_configured` otherwise) and eligible for the needs
  (`capability_unavailable` / `privacy_boundary` otherwise).

## Prompt caching (Anthropic / Bedrock)

Prefix order is `tools → system → messages`. With `cacheStablePrefix` (runAgent default `true`, generate* `false`):

* Anthropic: one explicit `cache_control: {type:"ephemeral"}` on the **last system block** (covers tools + system)
  plus the **top-level** `cache_control` field (automatic caching moves the second breakpoint to the last cacheable
  block each turn, so long tool loops keep hitting).
* Bedrock: the top-level field returns 400 there, so the second breakpoint is the **last `tool_result` block of the
  current turn** (explicit breakpoints only). Never more than 4 breakpoints, never on volatile content.
* `metadata.cacheTtl === "1h"` switches both markers to `ttl: "1h"` (1h entries precede 5m entries).
* Assistant turns are replayed verbatim (`InferenceMessage.raw`), including thinking blocks with their signatures,
  in the same block order; tool inputs keep their key order; the thinking configuration, `tool_choice` and tool
  set stay constant across a loop. Every `tool_result` of a round goes back in one user turn, in call order.
* Usage: `input` = uncached input + `cache_read_input_tokens` + `cache_creation_input_tokens`; `cacheRead` and
  `cacheWrite` are recorded separately (never added twice). Server web search inserts its own cache writes — expected.
* Minimum cacheable prefix is model-dependent (512–4096 tokens); short prompts are silently uncached.

Thinking per family (`thinkingConfig`): Fable / Mythos / Opus 5 — always on, `thinking: {type:"adaptive"}` when
effort ≥ low and `output_config.effort`, never `disabled` or `budget_tokens`; Opus/Sonnet 4.6–4.8, Sonnet 5 —
adaptive + effort, omitted for `none`/`minimal` (`xhigh` → `max` on 4.6); Haiku 4.5 / Sonnet 4.5 and older —
`{type:"enabled", budget_tokens}` when `*_THINKING_BUDGET > 0` and effort ≥ medium. `max_tokens` gets the same
headroom the OpenAI path gives reasoning models; temperature is sent only where the family accepts it.

Structured output: `output_config.format` (json_schema, `toAnthropicSchema`: strict transform + nullable `anyOf`)
on 4.5+ models; older models get a forced tool named after the schema (`tool_choice: tool`, or `any` when other
tools exist; Bedrock additionally sends `thinking: {type:"disabled"}`). Fable / Mythos / Opus 5.5 reject forced
tool use, so `*_STRUCTURED_OUTPUT=tool` fails closed there.

Programmatic tool calling (Anthropic first-party only): tools with `callers: ["code_execution"]` get
`allowed_callers: ["code_execution_20260120"]` when the request also asks for the `code_execution` built-in; the
container id is passed back on later turns; `tool.call` events carry `caller`. Bedrock/OpenAI ignore `callers`.

## What falls back, what fails closed

| Situation | Behaviour |
|---|---|
| 429 / 529 / 5xx / network error / timeout before any output | provider-level retry with backoff honouring `retry-after`; then the next eligible fallback model (max 2) |
| Same, after output was streamed | fail (no duplicated output); the error is traced |
| `capability_unavailable`, `privacy_boundary`, `auth`, `malformed_output`, 4xx | fail closed immediately |
| No provider configured / explicit model not served | `InferenceError("not_configured")` → `AIConfigError` (503, `no_api_key` in existing routes) |
| Unknown stop reason | `InferenceError("incomplete")`, never success |
| Refusal | `stopReason: "refusal"`: runAgent emits a status and stops; generate* throws "Model refused" |
| Caller abort | `AbortError` (unchanged; SSE layer treats it as cancellation) |

`ai_traces` keeps the last ~1000 calls (`recentTraces`, `traceSummary`): provider, model, task, latency, tokens,
cache reads/writes, fallback origin, error code. No prompt or source text.

## Follow-ups

* `src/modules/office/word/agent.ts` still imports `getOpenAI` for image generation; switch it to
  `generateImage()` from `src/lib/ai/images.ts` (image role) so a non-OpenAI deployment fails closed instead of
  crashing on a missing key.
* `src/lib/ai/tools.ts` (W5): once `runTool` / `toProviderToolSpec` land, `agent.ts` picks them up automatically;
  `ToolDef.examples` then flows into `input_examples` behind `ANTHROPIC_TOOL_EXAMPLES`.
* `src/lib/ai/agents/registry.ts` and `src/modules/workflows/executors.ts` pass `cfg.model` / `cfg.fastModel`
  explicitly; they work through the role hint but should pass `taskType` / `privacy` / `matterId` for telemetry
  and the data boundary.
* Embedding availability: several callers gate embeddings on `aiConfig().hasKey`; use
  `aiConfig().embeddingProvider != null` so an Anthropic-only deployment indexes keyword-only without retrying.
* `researchToolset({ web: true })` always adds the OpenAI-shaped web search built-in; a Bedrock-only deployment fails
  closed for such requests. The toolkit should consult `aiRuntimeStatus()` and omit server web search when no
  routable provider has it (fetch_url + legal tools remain).
* Bedrock: IAM role / container credential providers (IMDS, ECS) are not implemented — static keys, session tokens or
  a Bedrock API key only. The newer Messages-API Bedrock endpoint (`/anthropic/v1/messages`, SSE) could be added as a
  base-URL variant of the Anthropic provider once its signing is confirmed.
* `evals/harness.ts` treats `generateText()` as returning a string; it returns `{ text, responseId, usage }`.
