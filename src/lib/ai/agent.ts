import "server-only";
import type { Response, ResponseInput, ResponseInputItem, ResponseStreamEvent, Tool } from "openai/resources/responses/responses";
import { getOpenAI } from "./openai";
import { aiConfig, isReasoningModel } from "./config";
import { normalizeArgs, toOpenAITool, toolLabel, toStrictSchema, type AgentEmit, type ToolContext, type ToolDef } from "./tools";

/**
 * Reasoning models spend hidden reasoning tokens against max_output_tokens.
 * Callers size caps for the visible answer, so give reasoning models generous
 * headroom; otherwise responses come back `incomplete` with empty JSON.
 */
export function outputTokenBudget(model: string, requested: number | undefined): number | undefined {
  if (requested == null) return undefined;
  if (!isReasoningModel(model)) return requested;
  return Math.max(requested * 3, requested + 16_000);
}

/** Extract the first JSON object/array from model text (tolerates code fences and prose). */
export function parseModelJSON<T = unknown>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t) as T; } catch { /* fall through */ }
  const start = Math.min(...[t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0));
  if (!Number.isFinite(start)) throw new Error("Model returned no JSON");
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  return JSON.parse(t.slice(start, end + 1)) as T;
}

function assertComplete(res: Response, what: string) {
  if (res.status === "incomplete") {
    const reason = res.incomplete_details?.reason ?? "unknown";
    throw new Error(`${what} was cut off (${reason === "max_output_tokens" ? "output token limit reached; the model's reasoning consumed the budget" : reason}). Try a narrower scope or raise OPENAI_REASONING_EFFORT down / max tokens up.`);
  }
  const refusal = res.output?.flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal") as { refusal?: string } | undefined;
  if (refusal?.refusal) throw new Error(`Model refused: ${refusal.refusal}`);
}

export type AgentEvent =
  | { type: "start"; model: string }
  | { type: "text.delta"; delta: string }
  | { type: "text.done"; text: string }
  | { type: "reasoning.delta"; delta: string }
  | { type: "tool.call"; id: string; name: string; label: string; args: Record<string, unknown> }
  | { type: "tool.result"; id: string; name: string; ok: boolean; result?: unknown; error?: string; durationMs: number }
  | { type: "web_search"; status: "searching" | "completed"; query?: string }
  | { type: "step"; step: number }
  | { type: "done"; responseId: string | null; usage?: { input: number; output: number; total: number }; text: string }
  | { type: "error"; message: string; code?: string }
  | AgentEmit;

export interface RunAgentOptions {
  /** Developer/system instructions. */
  instructions: string;
  /** Conversation input: string or Responses input items (messages, tool outputs). */
  input: string | ResponseInput;
  tools?: ToolDef<never, unknown>[];
  /** Built-in OpenAI tools (web_search, image_generation…). */
  builtinTools?: Tool[];
  model?: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  verbosity?: "low" | "medium" | "high";
  maxSteps?: number;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Shared state visible to tools. */
  state?: Record<string, unknown>;
  /** Continue a stored conversation. */
  previousResponseId?: string | null;
  /** Structured output: JSON schema for the final message. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  parallelToolCalls?: boolean;
  onEvent: (event: AgentEvent) => void;
  /** Where to emit tool progress; defaults to onEvent. */
  metadata?: Record<string, string>;
}

export interface RunAgentResult {
  text: string;
  responseId: string | null;
  steps: number;
  toolCalls: { name: string; args: Record<string, unknown>; result?: unknown; error?: string }[];
  usage: { input: number; output: number; total: number };
  json?: unknown;
}

interface PendingCall { callId: string; name: string; args: string }

/**
 * Streaming agent loop over the Responses API. Emits fine-grained events for
 * text, tool calls and tool results, executes tools server-side (in parallel
 * per step) and continues via previous_response_id until the model stops
 * calling tools or maxSteps is reached.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const cfg = aiConfig();
  const model = opts.model ?? cfg.model;
  const client = getOpenAI();
  const toolMap = new Map((opts.tools ?? []).map((t) => [t.name, t]));
  const tools: Tool[] = [...(opts.tools ?? []).map(toOpenAITool), ...(opts.builtinTools ?? [])];
  const maxSteps = opts.maxSteps ?? 12;
  const emit = opts.onEvent;
  const ctx: ToolContext = { emit: (e) => emit(e), signal: opts.signal, state: opts.state ?? {} };

  let input: string | ResponseInput = opts.input;
  let previousResponseId: string | null = opts.previousResponseId ?? null;
  let fullText = "";
  let lastResponse: Response | null = null;
  const usage = { input: 0, output: 0, total: 0 };
  const toolCalls: RunAgentResult["toolCalls"] = [];

  emit({ type: "start", model });

  for (let step = 1; step <= maxSteps; step++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    emit({ type: "step", step });

    const params: Parameters<typeof client.responses.create>[0] = {
      model,
      instructions: opts.instructions,
      input,
      tools: tools.length ? tools : undefined,
      previous_response_id: previousResponseId ?? undefined,
      max_output_tokens: outputTokenBudget(model, opts.maxOutputTokens),
      parallel_tool_calls: opts.parallelToolCalls ?? true,
      store: true,
      metadata: opts.metadata,
      stream: true,
    };
    if (isReasoningModel(model)) {
      params.reasoning = { effort: opts.reasoningEffort ?? cfg.reasoningEffort, summary: "auto" };
      if (opts.verbosity) params.text = { ...(params.text ?? {}), verbosity: opts.verbosity };
    } else if (opts.temperature != null) {
      params.temperature = opts.temperature;
    }
    if (opts.jsonSchema) {
      params.text = { ...(params.text ?? {}), format: { type: "json_schema", name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true } };
    }

    const stream = await client.responses.create(params as Parameters<typeof client.responses.create>[0] & { stream: true }, { signal: opts.signal });

    const pending = new Map<string, PendingCall>(); // item_id → call
    let stepText = "";
    let completed: Response | null = null;

    for await (const ev of stream as AsyncIterable<ResponseStreamEvent>) {
      switch (ev.type) {
        case "response.output_text.delta":
          stepText += ev.delta;
          emit({ type: "text.delta", delta: ev.delta });
          break;
        case "response.reasoning_summary_text.delta":
          emit({ type: "reasoning.delta", delta: ev.delta });
          break;
        case "response.output_item.added":
          if (ev.item.type === "function_call") pending.set(ev.item.id ?? ev.item.call_id, { callId: ev.item.call_id, name: ev.item.name, args: "" });
          if (ev.item.type === "web_search_call") emit({ type: "web_search", status: "searching" });
          break;
        case "response.function_call_arguments.done": {
          const p = pending.get(ev.item_id);
          if (p) p.args = ev.arguments;
          break;
        }
        case "response.output_item.done":
          if (ev.item.type === "function_call") {
            const p = pending.get(ev.item.id ?? ev.item.call_id) ?? { callId: ev.item.call_id, name: ev.item.name, args: "" };
            p.args = ev.item.arguments || p.args;
            pending.set(ev.item.id ?? ev.item.call_id, p);
          }
          if (ev.item.type === "web_search_call") {
            const action = (ev.item as { action?: { query?: string } }).action;
            emit({ type: "web_search", status: "completed", query: action?.query });
          }
          break;
        case "response.output_text.annotation.added": {
          const a = (ev as { annotation?: { type?: string; url?: string; title?: string } }).annotation;
          if (a?.type === "url_citation" && a.url) emit({ type: "citation", citation: { title: a.title ?? a.url, url: a.url, source: "web" } });
          break;
        }
        case "response.completed":
          completed = ev.response;
          break;
        case "response.failed":
          throw new Error(ev.response.error?.message ?? "Model response failed");
        case "response.incomplete":
          completed = ev.response;
          emit({ type: "status", message: `Response incomplete: ${ev.response.incomplete_details?.reason ?? "unknown"}` });
          break;
        case "error":
          throw new Error((ev as { message?: string }).message ?? "Stream error");
        default:
          break;
      }
    }

    if (stepText) { fullText += (fullText ? "\n" : "") + stepText; emit({ type: "text.done", text: stepText }); }
    lastResponse = completed;
    if (completed?.usage) {
      usage.input += completed.usage.input_tokens ?? 0;
      usage.output += completed.usage.output_tokens ?? 0;
      usage.total += completed.usage.total_tokens ?? 0;
    }
    previousResponseId = completed?.id ?? previousResponseId;

    const calls = Array.from(pending.values()).filter((c) => c.name);
    if (!calls.length) break;

    // Execute tools (in parallel), stream results, then continue the loop.
    const outputs: ResponseInputItem[] = await Promise.all(
      calls.map(async (call): Promise<ResponseInputItem> => {
        const def = toolMap.get(call.name);
        let args: Record<string, unknown> = {};
        try { args = call.args ? normalizeArgs(JSON.parse(call.args)) : {}; } catch { args = {}; }
        const id = call.callId;
        const label = def ? toolLabel(def, args) : call.name;
        emit({ type: "tool.call", id, name: call.name, label, args });
        const started = Date.now();
        if (!def) {
          const error = `Unknown tool: ${call.name}`;
          emit({ type: "tool.result", id, name: call.name, ok: false, error, durationMs: 0 });
          toolCalls.push({ name: call.name, args, error });
          return { type: "function_call_output", call_id: id, output: JSON.stringify({ error }) };
        }
        try {
          const result = await def.execute(args as never, ctx);
          const durationMs = Date.now() - started;
          emit({ type: "tool.result", id, name: call.name, ok: true, result: summarizeForClient(result), durationMs });
          toolCalls.push({ name: call.name, args, result });
          return { type: "function_call_output", call_id: id, output: serializeToolOutput(result) };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          emit({ type: "tool.result", id, name: call.name, ok: false, error, durationMs: Date.now() - started });
          toolCalls.push({ name: call.name, args, error });
          return { type: "function_call_output", call_id: id, output: JSON.stringify({ error }) };
        }
      }),
    );
    input = outputs;
  }

  let json: unknown;
  if (opts.jsonSchema && fullText) { try { json = JSON.parse(fullText); } catch { /* leave undefined */ } }
  emit({ type: "done", responseId: lastResponse?.id ?? previousResponseId, usage, text: fullText });
  return { text: fullText, responseId: lastResponse?.id ?? previousResponseId, steps: toolCalls.length, toolCalls, usage, json };
}

const MAX_TOOL_OUTPUT_CHARS = 60_000;

function serializeToolOutput(result: unknown): string {
  const s = typeof result === "string" ? result : JSON.stringify(result ?? null);
  return s.length > MAX_TOOL_OUTPUT_CHARS ? s.slice(0, MAX_TOOL_OUTPUT_CHARS) + "\n…[truncated]" : s;
}

/** Keep client-side tool result payloads small. */
function summarizeForClient(result: unknown): unknown {
  const s = typeof result === "string" ? result : JSON.stringify(result ?? null);
  if (s.length <= 4000) return result;
  return { preview: s.slice(0, 4000) + "…", truncated: true, length: s.length };
}

// ---------------------------------------------------------------------------
// Non-streaming helpers for background work (classification, summaries, extraction).
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  instructions?: string;
  input: string | ResponseInput;
  model?: string;
  fast?: boolean;
  reasoningEffort?: RunAgentOptions["reasoningEffort"];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  tools?: Tool[];
}

export async function generateText(opts: GenerateOptions): Promise<{ text: string; responseId: string; usage?: Response["usage"] }> {
  const cfg = aiConfig();
  const model = opts.model ?? (opts.fast ? cfg.fastModel : cfg.model);
  const client = getOpenAI();
  const params: Parameters<typeof client.responses.create>[0] = {
    model,
    instructions: opts.instructions,
    input: opts.input,
    max_output_tokens: outputTokenBudget(model, opts.maxOutputTokens),
    tools: opts.tools,
    store: false,
  };
  if (isReasoningModel(model)) params.reasoning = { effort: opts.reasoningEffort ?? (opts.fast ? "low" : cfg.reasoningEffort) };
  else if (opts.temperature != null) params.temperature = opts.temperature;
  const res = (await client.responses.create(params, { signal: opts.signal })) as Response;
  if (!res.output_text?.trim()) assertComplete(res, "Generation");
  return { text: res.output_text, responseId: res.id, usage: res.usage };
}

export async function generateJSON<T = unknown>(opts: GenerateOptions & { schema: Record<string, unknown>; name?: string }): Promise<T> {
  const cfg = aiConfig();
  const model = opts.model ?? (opts.fast ? cfg.fastModel : cfg.model);
  const client = getOpenAI();
  const params: Parameters<typeof client.responses.create>[0] = {
    model,
    instructions: opts.instructions,
    input: opts.input,
    max_output_tokens: outputTokenBudget(model, opts.maxOutputTokens),
    store: false,
    text: { format: { type: "json_schema", name: opts.name ?? "result", schema: strictJsonSchema(opts.schema), strict: true } },
  };
  if (isReasoningModel(model)) params.reasoning = { effort: opts.reasoningEffort ?? (opts.fast ? "low" : cfg.reasoningEffort) };
  else if (opts.temperature != null) params.temperature = opts.temperature;
  const res = (await client.responses.create(params, { signal: opts.signal })) as Response;
  assertComplete(res, "Structured generation");
  const text = res.output_text?.trim();
  if (!text) throw new Error("Model returned no structured output");
  try {
    return parseModelJSON<T>(text);
  } catch (e) {
    throw new Error(`Model returned malformed JSON (${(e as Error).message}); output began: ${text.slice(0, 200)}`);
  }
}

/** Same rules as function-tool strict mode. */
export function strictJsonSchema(schema: Record<string, unknown>) {
  return toStrictSchema(schema);
}

/** Vision helper: describe / transcribe an image (data URL or https URL). */
export async function describeImage(imageUrl: string, prompt = "Transcribe all text and describe the content of this image precisely.", opts: { fast?: boolean } = {}) {
  return generateText({
    fast: opts.fast ?? true,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: imageUrl, detail: "high" }] }],
  });
}
