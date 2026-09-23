import "server-only";
import { generateJSON } from "@/lib/ai/agent";
import { FIRM_NAME, todayLine } from "@/lib/ai/prompts";
import { db } from "@/lib/db";
import { autoLayout } from "./graph";
import { NODE_TYPES } from "./registry";
import { GENERATED_WORKFLOW_JSON_SCHEMA, validateGeneratedDraft, type GeneratedRaw, type ValidatedDraft } from "./schema";

/** Node reference the builder model sees: type, purpose, config keys with defaults. */
export function nodeReference(): string {
  return NODE_TYPES.map((n) => `- ${n.type} — ${n.description}\n  config: ${JSON.stringify(n.defaultConfig)}${n.outputs ? `\n  source handles: ${n.outputs.map((o) => o.id).join(", ")}` : ""}\n  output: ${n.outputShape}`).join("\n");
}

const RULES = `Rules:
1. Exactly one trigger node (usually trigger.manual; trigger.schedule for recurring monitors).
2. Node ids are short snake_case words that read well in expressions: "extract", "classify", "draft", "search_docs".
3. Every node's configJson is a JSON object string using the config keys listed for its type. Keep the defaults you do not need to change.
4. Template expressions: {{inputs.<key>}} for run inputs, {{steps.<nodeId>.output.<path>}} for earlier outputs (text steps expose output.text; extract/classify expose their fields; search steps expose output.results and output.text), {{matter.name}}, {{matter.client}}, {{matter.openTasks | json}}, {{loop.item}} / {{loop.index}} inside loop bodies. Filters: | json, | truncate:N, | join:", ", | pluck:key, | table, | date:short.
5. Branch: rules[].id are the source handles (plus "else"). Loop: body edges use sourceHandle "each", continuation uses "done"; optionally connect the last body node back with targetHandle "loop-back". Approval: source handles "approved" and "rejected".
6. Prefer ai.extract/ai.classify (typed) over ai.prompt for structured outputs; prefer ai.draft for documents and action.save_document (kind word) to file them; action.create_task for follow-ups; action.notify to tell the team.
7. Inputs: file inputs arrive as text (the platform extracts document text), so reference them as {{inputs.<key>}} in prompts. Use a "matter" input whenever the workflow files documents or creates tasks.
8. Write realistic legal prompts and checklists (a senior litigator's standard), never placeholders like "TODO".
9. Keep it tight: 4–9 nodes, every node connected, no dangling branches.`;

export interface GenerateOptions { category?: string; matterId?: string; signal?: AbortSignal }

/** Ask the model for a workflow draft; validate; retry once with the validation errors. */
export async function generateWorkflowDraft(description: string, opts: GenerateOptions = {}): Promise<ValidatedDraft> {
  const matter = opts.matterId ? db().matters.get(opts.matterId) : null;
  const instructions = [
    `You design automation workflows for ${FIRM_NAME}'s internal legal platform (a Zapier-for-law builder). ${todayLine()}`,
    "Translate the user's description into a runnable workflow graph using only the node types below.",
    RULES,
    `Available node types:\n${nodeReference()}`,
    matter ? `The user is working on matter ${matter.name} (${matter.client}); default matter-scoped searches to it via the matter input.` : "",
    opts.category ? `Preferred category: ${opts.category}.` : "",
  ].filter(Boolean).join("\n\n");

  let input = `Workflow description:\n"""\n${description.trim()}\n"""`;
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await generateJSON<GeneratedRaw>({ instructions, input, schema: GENERATED_WORKFLOW_JSON_SCHEMA, name: "workflow_draft", signal: opts.signal, reasoningEffort: "medium", maxOutputTokens: 12_000 });
    const result = validateGeneratedDraft(raw);
    if (result.ok) {
      const nodes = autoLayout(result.draft.nodes, result.draft.edges);
      return { ...result.draft, nodes };
    }
    lastErrors = result.errors;
    input = `${input}\n\nYour previous draft was rejected with these errors; fix them and return the complete corrected workflow:\n${lastErrors.map((e) => `- ${e}`).join("\n")}`;
  }
  throw new Error(`The generated workflow was invalid: ${lastErrors.slice(0, 4).join("; ")}`);
}
