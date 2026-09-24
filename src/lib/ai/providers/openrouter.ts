import "server-only";
/**
 * OpenRouter provider (constitution §16): OpenAI-compatible chat completions used ONLY for the router role. It sits
 * outside the AWS/first-party data boundary, so the router refuses to send matter data to it unless
 * ROUTER_ALLOW_MATTER_DATA is set. Streaming SSE, json_schema response_format for structured decisions.
 */
import { renderEvidenceAsText } from "./anthropic-wire";
import type { OpenRouterEnv } from "./env";
import { SSEParser, abortError, fetchWithRetry, isAbortError, textChunks, toInferenceError } from "./http";
import { InferenceError, type ContentPart, type InferenceEvent, type InferenceRequest, type InferenceResult, type ModelDescriptor, type ModelProvider, type StopReason } from "./types";

const TIMEOUT_MS = 120_000;

function contentToChat(parts: ContentPart[]): string | Array<Record<string, unknown>> {
  const hasImage = parts.some((p) => p.type === "image");
  if (!hasImage) {
    return parts.map((p) => (p.type === "text" ? p.text : p.type === "search_result" ? renderEvidenceAsText([p]) : p.type === "tool_result" ? p.content : "")).filter(Boolean).join("\n");
  }
  const out: Array<Record<string, unknown>> = [];
  for (const p of parts) {
    if (p.type === "text") out.push({ type: "text", text: p.text });
    else if (p.type === "image") { const url = p.url ?? (p.data ? `data:${p.mime ?? "image/png"};base64,${p.data}` : null); if (url) out.push({ type: "image_url", image_url: { url } }); }
    else if (p.type === "search_result") out.push({ type: "text", text: renderEvidenceAsText([p]) });
  }
  return out;
}

export function buildOpenRouterBody(req: InferenceRequest, model: string): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  if (req.instructions?.trim()) messages.push({ role: "system", content: req.instructions });
  const evidence = req.evidence?.length ? `SOURCES (cite by number):\n${renderEvidenceAsText(req.evidence)}` : null;
  let evidenceAttached = false;
  for (const m of req.messages) {
    if (m.role === "tool") {
      for (const p of m.content) if (p.type === "tool_result") messages.push({ role: "tool", tool_call_id: p.callId, content: p.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text").map((p) => p.text).join("");
      const calls = m.content.filter((p): p is Extract<ContentPart, { type: "tool_call" }> => p.type === "tool_call");
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) });
      continue;
    }
    messages.push({ role: "user", content: contentToChat(m.content) });
  }
  if (evidence) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && typeof messages[i].content === "string") { messages[i] = { role: "user", content: `${evidence}\n\n${messages[i].content as string}` }; evidenceAttached = true; break; }
    }
    if (!evidenceAttached) messages.push({ role: "user", content: evidence });
  }
  const body: Record<string, unknown> = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (req.maxOutputTokens) body.max_tokens = req.maxOutputTokens;
  if (req.temperature != null) body.temperature = req.temperature;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    if (req.toolChoice) body.tool_choice = typeof req.toolChoice === "string" ? req.toolChoice : { type: "function", function: { name: req.toolChoice.name } };
    if (req.parallelToolCalls != null) body.parallel_tool_calls = req.parallelToolCalls;
  }
  if (req.jsonSchema) body.response_format = { type: "json_schema", json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
  return body;
}

interface ToolAcc { id: string; name: string; args: string }

export class OpenRouterProvider implements ModelProvider {
  readonly id = "openrouter" as const;
  constructor(private cfg: OpenRouterEnv, private descriptors: ModelDescriptor[]) {}

  models(): ModelDescriptor[] { return this.descriptors; }
  isConfigured(): boolean { return Boolean(this.cfg.apiKey && this.cfg.routerModel); }

  async infer(req: InferenceRequest, onEvent: (e: InferenceEvent) => void = () => {}): Promise<InferenceResult> {
    if (!this.cfg.apiKey) throw new InferenceError("not_configured", "OPENROUTER_API_KEY is not configured.", { provider: "openrouter" });
    const model = req.model ?? this.cfg.routerModel;
    if (!model) throw new InferenceError("not_configured", "OPENROUTER_ROUTER_MODEL is not configured.", { provider: "openrouter" });
    const body = buildOpenRouterBody(req, model);
    const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${this.cfg.apiKey}`, "X-Title": this.cfg.title };
    if (this.cfg.referer) headers["HTTP-Referer"] = this.cfg.referer;
    const started = Date.now();
    onEvent({ type: "start", provider: "openrouter", model });
    const { res, clear } = await fetchWithRetry(`${this.cfg.baseURL}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) }, { provider: "openrouter", signal: req.signal, timeoutMs: TIMEOUT_MS, maxRetries: 2 });
    let text = "";
    let finish: string | null = null;
    const tools = new Map<number, ToolAcc>();
    let usage = { input: 0, output: 0, total: 0, cacheRead: 0 };
    let responseModel = model;
    let responseId: string | undefined;
    try {
      if (!res.body) throw new InferenceError("provider_unavailable", "openrouter: empty response body", { provider: "openrouter", retryable: true });
      const sse = new SSEParser();
      for await (const chunk of textChunks(res.body, req.signal)) {
        for (const msg of sse.push(chunk)) {
          if (msg.data.trim() === "[DONE]") continue;
          let j: Record<string, unknown>;
          try { j = JSON.parse(msg.data) as Record<string, unknown>; } catch { continue; }
          if (j.error) { const err = j.error as { message?: string; code?: number }; throw new InferenceError(err.code === 429 ? "rate_limited" : "provider_unavailable", `openrouter: ${err.message ?? "error"}`, { provider: "openrouter", retryable: !text }); }
          if (typeof j.model === "string") responseModel = j.model;
          if (typeof j.id === "string") responseId = j.id;
          const choice = (j.choices as Array<Record<string, unknown>> | undefined)?.[0];
          const delta = (choice?.delta ?? {}) as Record<string, unknown>;
          if (typeof delta.content === "string" && delta.content) { text += delta.content; onEvent({ type: "text.delta", delta: delta.content }); }
          if (typeof delta.reasoning === "string" && delta.reasoning) onEvent({ type: "reasoning.delta", delta: delta.reasoning });
          for (const tc of (delta.tool_calls as Array<Record<string, unknown>> | undefined) ?? []) {
            const idx = Number(tc.index ?? 0);
            const acc = tools.get(idx) ?? { id: "", name: "", args: "" };
            if (typeof tc.id === "string") acc.id = tc.id;
            const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
            if (fn.name) acc.name = fn.name;
            if (fn.arguments) acc.args += fn.arguments;
            tools.set(idx, acc);
          }
          if (typeof choice?.finish_reason === "string") finish = choice.finish_reason;
          const u = j.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
          if (u) usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0), cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0 };
        }
      }
    } catch (e) {
      if (isAbortError(e) || req.signal?.aborted) throw abortError();
      throw toInferenceError(e, "openrouter");
    } finally {
      clear();
    }
    const toolCalls = Array.from(tools.values()).filter((t) => t.name).map((t, i) => { let args: Record<string, unknown> = {}; try { args = t.args ? (JSON.parse(t.args) as Record<string, unknown>) : {}; } catch { args = {}; } return { id: t.id || `call_${i}`, name: t.name, args }; });
    for (const c of toolCalls) onEvent({ type: "tool.call", id: c.id, name: c.name, args: c.args });
    const stopReason: StopReason = toolCalls.length ? "tool_calls" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : finish === "stop" || finish === "end_turn" || finish == null ? "end" : "unknown";
    let json: unknown;
    if (req.jsonSchema && text) { try { json = JSON.parse(text); } catch { /* caller parses leniently */ } }
    onEvent({ type: "usage", usage });
    onEvent({ type: "done", stopReason });
    const parts: ContentPart[] = [];
    if (text.trim()) parts.push({ type: "text", text });
    for (const c of toolCalls) parts.push({ type: "tool_call", id: c.id, name: c.name, args: c.args });
    return { provider: "openrouter", model: responseModel, text, json, toolCalls, citations: [], usage, stopReason, rawStopReason: stopReason === "unknown" ? finish ?? undefined : undefined, responseId: null, messageId: responseId, latencyMs: Date.now() - started, assistantTurn: { role: "assistant", content: parts } };
  }
}
