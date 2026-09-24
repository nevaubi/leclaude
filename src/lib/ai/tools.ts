import type { FunctionTool } from "openai/resources/responses/responses";
import type { MatterScope, Principal } from "@/lib/auth/types";
import type { EvidenceKind } from "@/lib/evidence/types";
import type { ToolSpec } from "./providers/types";
import type { RetrievalScope } from "./vector-store";

export type JSONSchema = Record<string, unknown>;

/** Runtime context handed to every tool execution. Modules extend it. */
export interface ToolContext {
  /** Emit an intermediate event to the client (progress, proposal, citation…). */
  emit: (event: AgentEmit) => void;
  signal?: AbortSignal;
  /** Free-form bag for module state (document snapshot, matter id, user…). */
  state: Record<string, unknown>;
  /** The authenticated principal the tool acts for (constitution §21/§22); tools fail closed without one. */
  principal?: Principal;
  /** The retrieval scope this run may touch; tools narrow to it and never widen. */
  scope?: RetrievalScope | MatterScope;
  traceId?: string;
  runId?: string;
}

/**
 * Application-side provenance for one evidence block a tool returned (constitution §53.4). Kept out of the
 * model-facing text: tools emit it through `ctx.emit({ type: "evidence" })` and `runTool` collects it.
 */
export interface EvidenceProvenance {
  /** Stable, server-resolvable identifier — the same `source` the model sees (matter://…, depo://…, authority://…). */
  source: string;
  kind: EvidenceKind;
  /** Retrieval provider (ediscovery, library, depositions, intel, courtlistener, ecfr, federalregister, govinfo…). */
  provider: string;
  tool: string;
  query?: string;
  rank: number;
  score?: number;
  documentId?: string;
  matterId?: string;
  tenantId?: string;
  bates?: string;
  page?: number;
  line?: number;
  lineEnd?: number;
  chunkIndex?: number;
  authorityId?: string;
  url?: string;
  /** Content hash of the source (or of the returned passage when the source has no stored hash). */
  hash?: string;
  retrievedAt: string;
}

export interface ToolTrace {
  tool: string;
  phase: "started" | "completed" | "failed" | "timeout" | "cancelled" | "unauthorized";
  durationMs?: number;
  ok?: boolean;
  code?: ToolErrorCode;
  truncated?: boolean;
  chars?: number;
  traceId?: string;
  runId?: string;
}

export type AgentEmit =
  | { type: "status"; message: string }
  | { type: "proposal"; proposal: unknown }
  | { type: "citation"; citation: { title: string; url?: string; cite?: string; snippet?: string; source?: string } }
  | { type: "artifact"; artifact: { kind: string; title: string; data: unknown } }
  | { type: "progress"; label: string; value?: number }
  | { type: "evidence"; evidence: EvidenceProvenance[] }
  | { type: "trace"; trace: ToolTrace };

export interface ToolDef<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  /** JSON Schema for the arguments (object). Optional properties are allowed; they are converted to nullable for strict mode. */
  parameters: JSONSchema;
  /** Default true. Strict mode guarantees schema-valid arguments. */
  strict?: boolean;
  execute: (args: TArgs, ctx: ToolContext) => Promise<TResult> | TResult;
  /** Optional short label shown in the UI while running. */
  label?: string | ((args: TArgs) => string);
  /** Concrete usage examples (Bates ranges, page:line cites, ISO dates, court ids); providers that support tool examples send them. */
  examples?: Record<string, unknown>[];
  /** Wall-clock budget for one execution (default TOOL_DEFAULT_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Model-facing result bound; longer results are truncated with an explicit marker (default TOOL_DEFAULT_MAX_RESULT_CHARS). */
  maxResultChars?: number;
  /** Deterministic authorization hook; throw to deny (the model never decides authorization). */
  authorize?: (args: TArgs, ctx: ToolContext) => void | Promise<void>;
}

export function defineTool<TArgs = Record<string, unknown>, TResult = unknown>(def: ToolDef<TArgs, TResult>): ToolDef<TArgs, TResult> {
  return def;
}

/**
 * Convert a permissive JSON schema into OpenAI strict-mode form:
 * every object gets additionalProperties:false and all keys required,
 * with previously optional keys made nullable.
 */
export function toStrictSchema(schema: JSONSchema): JSONSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = { ...(node as Record<string, unknown>) };
    if (n.type === "object" || n.properties) {
      const props = (n.properties ?? {}) as Record<string, unknown>;
      const required = new Set((n.required as string[] | undefined) ?? []);
      const nextProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        const walked = walk(v) as Record<string, unknown>;
        if (!required.has(k)) nextProps[k] = makeNullable(walked);
        else nextProps[k] = walked;
      }
      n.properties = nextProps;
      n.required = Object.keys(nextProps);
      n.additionalProperties = false;
    }
    if (n.items) n.items = walk(n.items);
    if (n.anyOf) n.anyOf = (n.anyOf as unknown[]).map(walk);
    if (n.oneOf) { n.anyOf = (n.oneOf as unknown[]).map(walk); delete n.oneOf; }
    // strict mode does not support these keywords
    for (const k of ["default", "minimum", "maximum", "minLength", "maxLength", "format", "pattern", "minItems", "maxItems", "examples"]) delete n[k];
    return n;
  };
  return walk(schema) as JSONSchema;
}

function makeNullable(node: Record<string, unknown>): Record<string, unknown> {
  if (node.anyOf) return { anyOf: [...(node.anyOf as unknown[]), { type: "null" }], description: node.description };
  if (typeof node.type === "string") return { ...node, type: [node.type, "null"] };
  if (Array.isArray(node.type)) return node.type.includes("null") ? node : { ...node, type: [...node.type, "null"] };
  return { anyOf: [node, { type: "null" }] };
}

export function toOpenAITool(def: ToolDef<never, unknown>): FunctionTool {
  const strict = def.strict !== false;
  return {
    type: "function",
    name: def.name,
    description: def.description,
    parameters: strict ? toStrictSchema(def.parameters) : def.parameters,
    strict,
  };
}

/**
 * Provider-neutral tool spec (constitution §15/§52): the permissive schema plus the strict flag and usage examples.
 * Providers apply their own strict-schema transform and send `examples` only when their capability profile allows.
 */
export function toProviderToolSpec(def: ToolDef<never, unknown>): ToolSpec {
  const spec: ToolSpec = { name: def.name, description: def.description, parameters: def.parameters, strict: def.strict !== false };
  if (def.examples?.length) spec.examples = def.examples.map((e) => ({ ...e }));
  return spec;
}

/** Strip nulls that strict mode introduced for optional params. */
export function normalizeArgs<T extends Record<string, unknown>>(args: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== null) out[k] = v;
  return out as T;
}

export function toolLabel(def: ToolDef<never, unknown>, args: Record<string, unknown>) {
  if (typeof def.label === "function") { try { return (def.label as (a: unknown) => string)(args); } catch { return def.name; } }
  return def.label ?? def.name.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Tool execution contract (constitution §52): authorize → timeout → execute → bounded result → deterministic errors.
// ---------------------------------------------------------------------------

export const TOOL_DEFAULT_TIMEOUT_MS = 30_000;
export const TOOL_DEFAULT_MAX_RESULT_CHARS = 12_000;

export type ToolErrorCode =
  | "timeout"
  | "cancelled"
  | "unauthorized"
  | "scope_required"
  | "not_found"
  | "invalid_args"
  | "upstream_error"
  | "tool_error"
  | "unknown_tool";

const TOOL_ERROR_CODES: readonly ToolErrorCode[] = ["timeout", "cancelled", "unauthorized", "scope_required", "not_found", "invalid_args", "upstream_error", "tool_error", "unknown_tool"];

/** The model-facing error shape. A tool may return one directly (e.g. `{ error: "scope_required", code: "scope_required" }`). */
export interface ToolErrorShape {
  error: string;
  code: ToolErrorCode;
  retryable?: boolean;
  status?: number;
}

/** Thrown by tools that want a specific deterministic code (not found, invalid args…); `runTool` shapes it. */
export class ToolExecutionError extends Error {
  readonly code: ToolErrorCode;
  readonly status?: number;
  readonly retryable?: boolean;
  constructor(code: ToolErrorCode, message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
    this.status = opts.status;
    this.retryable = opts.retryable;
  }
}

export function isToolErrorResult(value: unknown): value is ToolErrorShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.error === "string" && typeof v.code === "string" && (TOOL_ERROR_CODES as readonly string[]).includes(v.code);
}

export interface ToolRunResult {
  name: string;
  ok: boolean;
  /** What the model sees: the (possibly truncated) result, or the error shape. */
  value: unknown;
  /** `value` serialized for the provider's tool-result message. */
  output: string;
  error?: ToolErrorShape;
  durationMs: number;
  truncated: boolean;
  /** Characters of the full serialized result before truncation. */
  fullChars: number;
  timedOut: boolean;
  /** Provenance the tool emitted for its evidence blocks (never part of `output`). */
  evidence: EvidenceProvenance[];
}

export function truncationMarker(remainingChars: number): string {
  return `\n[truncated: ${remainingChars} more chars; ask for the next window]`;
}

function serialize(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

/** First line, no markup, bounded — never a stack trace or an HTML error page. */
export function sanitizeErrorMessage(message: unknown, max = 400): string {
  const raw = typeof message === "string" ? message : message instanceof Error ? message.message : String(message ?? "");
  const line = raw.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const clean = line.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "Tool failed";
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

interface StringLeaf { parent: Record<string, unknown> | unknown[]; key: string | number; value: string }

function longestStringLeaf(node: unknown, best: StringLeaf | null = null, parent: Record<string, unknown> | unknown[] | null = null, key: string | number = ""): StringLeaf | null {
  if (typeof node === "string") {
    if (parent && (!best || node.length > best.value.length)) return { parent, key, value: node };
    return best;
  }
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) best = longestStringLeaf(node[i], best, node, i); return best; }
  if (node && typeof node === "object") { for (const [k, v] of Object.entries(node)) best = longestStringLeaf(v, best, node as Record<string, unknown>, k); }
  return best;
}

/**
 * Bound a tool result to `maxChars` of serialized output. Structured results keep valid JSON by trimming their
 * longest text fields (each with an explicit marker); anything still too long is hard-cut with the marker.
 */
export function boundToolResult(result: unknown, maxChars: number = TOOL_DEFAULT_MAX_RESULT_CHARS): { value: unknown; output: string; truncated: boolean; fullChars: number } {
  const full = serialize(result);
  if (full.length <= maxChars) return { value: result, output: full, truncated: false, fullChars: full.length };
  if (result && typeof result === "object") {
    let value: unknown;
    try { value = JSON.parse(full); } catch { value = undefined; }
    for (let round = 0; value !== undefined && round < 8; round++) {
      const s = JSON.stringify(value);
      if (s.length <= maxChars) return { value, output: s, truncated: true, fullChars: full.length };
      const leaf = longestStringLeaf(value);
      if (!leaf || leaf.value.length < 160) break;
      const over = s.length - maxChars;
      const keep = Math.max(0, leaf.value.length - over - 64);
      const trimmed = leaf.value.slice(0, keep) + truncationMarker(leaf.value.length - keep);
      (leaf.parent as Record<string | number, unknown>)[leaf.key] = trimmed;
    }
  }
  const marker = truncationMarker(Math.max(0, full.length - maxChars));
  const head = full.slice(0, Math.max(0, maxChars - marker.length));
  return { value: head + marker, output: head + marker, truncated: true, fullChars: full.length };
}

/** Deterministic error shaping: known error classes map to codes; messages are sanitized; nothing is rethrown. */
export function shapeToolError(e: unknown, state: { timedOut?: boolean; cancelled?: boolean } = {}): ToolErrorShape {
  if (state.timedOut) return { error: "timeout", code: "timeout", retryable: true };
  const err = (e ?? {}) as { name?: string; code?: unknown; status?: unknown; message?: unknown; retryable?: unknown };
  if (state.cancelled || err.name === "AbortError") return { error: "cancelled", code: "cancelled" };
  if (e instanceof ToolExecutionError || (err.name === "ToolExecutionError" && typeof err.code === "string")) {
    const status = typeof err.status === "number" ? err.status : undefined;
    return { error: sanitizeErrorMessage(err.message), code: err.code as ToolErrorCode, ...(status != null ? { status } : {}), ...(typeof err.retryable === "boolean" ? { retryable: err.retryable } : {}) };
  }
  if (err.name === "ScopeError") return { error: "scope_required", code: "scope_required" };
  if (err.name === "AuthError") return { error: err.status === 401 ? "unauthenticated" : "forbidden", code: "unauthorized", status: typeof err.status === "number" ? err.status : 403 };
  if (err.name === "HttpError") {
    const status = typeof err.status === "number" ? err.status : undefined;
    return { error: sanitizeErrorMessage(err.message), code: "upstream_error", ...(status != null ? { status } : {}), retryable: status === 429 || (status != null && status >= 500) };
  }
  if (err.name === "InferenceError") {
    const retryable = err.code === "rate_limited" || err.code === "provider_unavailable" || err.code === "timeout";
    return { error: sanitizeErrorMessage(err.message), code: retryable ? "upstream_error" : "tool_error", retryable };
  }
  if (isToolErrorResult(e)) return e;
  return { error: sanitizeErrorMessage(err.message ?? e), code: "tool_error" };
}

const TIMEOUT = Symbol("tool-timeout");

/**
 * Execute one tool under the §52 contract. Never throws: authorization denial, timeout, cancellation, thrown errors
 * and oversized results all come back as a `ToolRunResult` with a deterministic model-facing `output`.
 */
export async function runTool<TArgs, TResult>(def: ToolDef<TArgs, TResult>, args: TArgs, ctx: ToolContext): Promise<ToolRunResult> {
  const started = Date.now();
  const evidence: EvidenceProvenance[] = [];
  const parentEmit = typeof ctx.emit === "function" ? ctx.emit : () => {};
  const emit = (e: AgentEmit) => { if (e.type === "evidence") evidence.push(...e.evidence); parentEmit(e); };
  const trace = (t: Omit<ToolTrace, "tool" | "traceId" | "runId">) => parentEmit({ type: "trace", trace: { tool: def.name, traceId: ctx.traceId, runId: ctx.runId, ...t } });
  const fail = (error: ToolErrorShape, extra: Partial<ToolRunResult> = {}): ToolRunResult => {
    const output = JSON.stringify(error);
    const durationMs = Date.now() - started;
    trace({ phase: error.code === "timeout" ? "timeout" : error.code === "cancelled" ? "cancelled" : error.code === "unauthorized" ? "unauthorized" : "failed", durationMs, ok: false, code: error.code });
    return { name: def.name, ok: false, value: error, output, error, durationMs, truncated: false, fullChars: output.length, timedOut: false, evidence, ...extra };
  };

  if (ctx.signal?.aborted) return fail({ error: "cancelled", code: "cancelled" });

  if (def.authorize) {
    try { await def.authorize(args, ctx); } catch (e) {
      const shaped = shapeToolError(e);
      return fail(shaped.code === "scope_required" ? shaped : { ...shaped, code: "unauthorized", error: shaped.code === "unauthorized" ? shaped.error : sanitizeErrorMessage((e as Error)?.message ?? "forbidden") });
    }
  }

  const timeoutMs = def.timeoutMs ?? TOOL_DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(TIMEOUT); }, timeoutMs); });
  const runCtx: ToolContext = { ...ctx, emit, signal: controller.signal };

  trace({ phase: "started" });
  try {
    const outcome = await Promise.race([Promise.resolve().then(() => def.execute(args, runCtx)), timeout]);
    if (outcome === TIMEOUT) return fail({ error: "timeout", code: "timeout", retryable: true }, { timedOut: true });
    if (isToolErrorResult(outcome)) return fail(outcome);
    const bounded = boundToolResult(outcome, def.maxResultChars ?? TOOL_DEFAULT_MAX_RESULT_CHARS);
    const durationMs = Date.now() - started;
    trace({ phase: "completed", durationMs, ok: true, truncated: bounded.truncated, chars: bounded.fullChars });
    return { name: def.name, ok: true, value: bounded.value, output: bounded.output, durationMs, truncated: bounded.truncated, fullChars: bounded.fullChars, timedOut: false, evidence };
  } catch (e) {
    const shaped = shapeToolError(e, { timedOut, cancelled: ctx.signal?.aborted });
    return fail(shaped, { timedOut });
  } finally {
    if (timer) clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}
