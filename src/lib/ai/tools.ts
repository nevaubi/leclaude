import type { FunctionTool } from "openai/resources/responses/responses";

export type JSONSchema = Record<string, unknown>;

/** Runtime context handed to every tool execution. Modules extend it. */
export interface ToolContext {
  /** Emit an intermediate event to the client (progress, proposal, citation…). */
  emit: (event: AgentEmit) => void;
  signal?: AbortSignal;
  /** Free-form bag for module state (document snapshot, matter id, user…). */
  state: Record<string, unknown>;
}

export type AgentEmit =
  | { type: "status"; message: string }
  | { type: "proposal"; proposal: unknown }
  | { type: "citation"; citation: { title: string; url?: string; cite?: string; snippet?: string; source?: string } }
  | { type: "artifact"; artifact: { kind: string; title: string; data: unknown } }
  | { type: "progress"; label: string; value?: number };

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
