import "server-only";
import { nanoid } from "nanoid";
import type { ResponseInput } from "openai/resources/responses/responses";
import { db } from "@/lib/db";
import { runAgent, strictJsonSchema, type AgentEvent } from "@/lib/ai/agent";
import { aiConfig } from "@/lib/ai/config";
import { researchToolset, searchEdiscoveryTool, getLibraryItemTool, searchLibraryTool, fetchUrlTool, LEGAL_TOOLS, extractPlainText } from "@/lib/ai/toolkit";
import type { ToolContext, ToolDef } from "@/lib/ai/tools";
import { FIRM_NAME, LEGAL_STYLE_RULES, RESEARCH_METHOD, todayLine } from "@/lib/ai/prompts";
import type { CalendarEvent, EDocument, LibraryItem, Task, TeamUpdate, Workflow, WorkflowNode, WorkflowNodeType } from "@/lib/types/domain";
import { createOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { evaluateBranch, type BranchRule } from "./conditions";
import { markdownTable, resolveDateRule, resolveDeep, resolveTemplate, stringify, type ResolveReport, type TemplateContext } from "./template-expr";
import type { RunArtifact, WorkflowRunRecord } from "./types";
import { WORKFLOW_CURRENT_USER } from "./types";

// ─────────────────────────── Context ───────────────────────────

export interface ExecContext {
  node: WorkflowNode;
  run: WorkflowRunRecord;
  workflow: Workflow;
  ctx: TemplateContext;
  config: Record<string, unknown>;
  report: ResolveReport;
  signal: AbortSignal;
  log: (line: string) => void;
  progress: (label: string, value?: number) => void;
  artifact: (a: Omit<RunArtifact, "nodeId">) => void;
  /** Incoming edge sources that were active for this node (for merge). */
  activeSources: string[];
}

export interface ExecResult {
  output: unknown;
  usage?: { input: number; output: number; total: number };
  calls?: number;
}

export type Executor = (x: ExecContext) => Promise<ExecResult>;

export class StepError extends Error {
  constructor(message: string, public code?: string) { super(message); this.name = "StepError"; }
}

function str(v: unknown): string { return stringify(v); }
function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function bool(v: unknown): boolean { return typeof v === "string" ? ["true", "yes", "1", "on"].includes(v.toLowerCase()) : Boolean(v); }
function person(id: unknown) { return id ? db().people.get(String(id)) : null; }
function personName(id: unknown) { return person(id)?.name ?? "Unassigned"; }

/** Resolve every string in the node config against the template context. */
export function resolveConfig(x: ExecContext): Record<string, unknown> {
  return resolveDeep(x.config, x.ctx, x.report);
}

function toolCtx(x: ExecContext): ToolContext {
  return {
    emit: (e) => { if (e.type === "citation") x.log(`cite: ${e.citation.title}${e.citation.cite ? ` (${e.citation.cite})` : ""}`); else if (e.type === "status") x.log(e.message); else if (e.type === "progress") x.progress(e.label, e.value); },
    signal: x.signal,
    state: { runId: x.run.id, nodeId: x.node.id, matterId: x.run.matterId },
  };
}

// ─────────────────────────── Matter context ───────────────────────────

/** Rich matter object exposed to templates as {{matter.*}}. */
export function matterContext(matterId?: string | null): Record<string, unknown> | null {
  if (!matterId) return null;
  const d = db();
  const m = d.matters.get(matterId);
  if (!m) return null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...m,
    team: m.teamIds.map((id) => d.people.get(id)).filter(Boolean).map((p) => ({ id: p!.id, name: p!.name, title: p!.title, email: p!.email })),
    leadAttorney: m.leadAttorneyId ? personName(m.leadAttorneyId) : undefined,
    openTasks: d.tasks.find((t) => t.matterId === m.id && t.status !== "done").sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")).slice(0, 25).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, assignee: personName(t.assigneeId) })),
    upcomingEvents: d.events.find((e) => e.matterId === m.id && e.startsAt.slice(0, 10) >= today).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 15).map((e) => ({ id: e.id, title: e.title, kind: e.kind, startsAt: e.startsAt, location: e.location, ruleSource: e.ruleSource })),
    recentUpdates: d.updates.find((u) => u.matterId === m.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map((u) => ({ author: personName(u.authorId), body: u.body, createdAt: u.createdAt, kind: u.kind })),
    documentCount: d.edocs.count((x) => x.matterId === m.id),
  };
}

// ─────────────────────────── Model helper ───────────────────────────

interface ModelCall {
  instructions: string;
  input: string | ResponseInput;
  tier?: "fast" | "primary";
  json?: { name: string; schema: Record<string, unknown> };
  research?: { web?: boolean; legal?: boolean; internal?: boolean };
  maxSteps?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

async function callModel(x: ExecContext, call: ModelCall): Promise<{ text: string; json?: unknown; usage: { input: number; output: number; total: number }; calls: number; citations: { title: string; url?: string; cite?: string; source?: string }[]; toolCalls: number }> {
  const cfg = aiConfig();
  const model = call.tier === "fast" ? cfg.fastModel : cfg.model;
  const research = call.research ?? {};
  const wantsResearch = Boolean(research.web || research.legal || research.internal);
  const toolset = wantsResearch ? researchToolset({ web: Boolean(research.web), legal: Boolean(research.legal), internal: Boolean(research.internal), webContextSize: "medium" }) : { tools: [] as ToolDef<never, unknown>[], builtinTools: [] };
  const citations: { title: string; url?: string; cite?: string; source?: string }[] = [];
  let toolCalls = 0;
  const onEvent = (e: AgentEvent) => {
    switch (e.type) {
      case "tool.call": toolCalls++; x.progress(e.label); x.log(`tool: ${e.label}`); break;
      case "tool.result": if (!e.ok) x.log(`tool error: ${e.name}: ${e.error}`); break;
      case "web_search": if (e.status === "completed") { toolCalls++; x.log(`web search: ${e.query ?? "(query)"}`); } break;
      case "citation": citations.push(e.citation); break;
      case "status": x.log(e.message); break;
      case "step": if (e.step > 1) x.progress(`Reasoning (step ${e.step})`); break;
      default: break;
    }
  };
  const res = await runAgent({
    instructions: call.instructions,
    input: call.input,
    model,
    tools: toolset.tools,
    builtinTools: toolset.builtinTools,
    maxSteps: call.maxSteps ?? (wantsResearch ? 10 : 1),
    reasoningEffort: call.reasoningEffort ?? (call.tier === "fast" ? "low" : cfg.reasoningEffort === "none" ? "medium" : cfg.reasoningEffort),
    signal: x.signal,
    jsonSchema: call.json ? { name: call.json.name, schema: strictJsonSchema(call.json.schema) } : undefined,
    metadata: { workflowRunId: x.run.id, nodeId: x.node.id },
    onEvent,
  });
  let json: unknown = res.json;
  if (call.json && json === undefined) {
    try { json = JSON.parse(res.text); } catch { throw new StepError("The model did not return valid JSON for the requested schema.", "bad_json"); }
  }
  return { text: res.text, json, usage: res.usage, calls: 1 + res.steps, citations: dedupe(citations), toolCalls };
}

function dedupe<T extends { title: string; url?: string; cite?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((c) => { const k = c.url ?? c.cite ?? c.title; if (seen.has(k)) return false; seen.add(k); return true; });
}

function firmPreamble(x: ExecContext) {
  const m = x.ctx.matter as Record<string, unknown> | null;
  return [
    `You are a workflow step of ${FIRM_NAME}'s internal legal AI platform, running inside the workflow "${x.workflow.name}" (step "${x.node.label}"). ${todayLine()}`,
    m ? `Matter context: ${m.name} (${m.caption ?? m.shortName}); client ${m.client} (${m.clientSide}); ${m.court ?? "no court"}; stage: ${m.stage ?? "n/a"}.` : "No matter is attached to this run.",
    "Output is consumed by later workflow steps and by lawyers; be precise, complete and free of filler. Never invent facts, citations or record cites.",
  ].join("\n");
}

const JSON_TYPES: Record<string, Record<string, unknown>> = {
  string: { type: "string" },
  text: { type: "string" },
  number: { type: "number" },
  integer: { type: "integer" },
  boolean: { type: "boolean" },
  date: { type: "string", description: "ISO 8601 date (YYYY-MM-DD) or empty string when unknown" },
  "string[]": { type: "array", items: { type: "string" } },
  "number[]": { type: "array", items: { type: "number" } },
  object: { type: "object", properties: {}, additionalProperties: true },
  "object[]": { type: "array", items: { type: "object", properties: {}, additionalProperties: true } },
};

function fieldsToSchema(fields: { name: string; type?: string; description?: string; required?: boolean }[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.name) continue;
    const key = f.name.trim().replace(/[^a-zA-Z0-9_]/g, "_");
    const base = JSON_TYPES[(f.type ?? "string").toLowerCase()] ?? JSON_TYPES.string;
    properties[key] = { ...base, description: f.description ?? f.name };
  }
  properties._evidence = { type: "array", description: "For each field, the quote or location that supports the value", items: { type: "object", properties: { field: { type: "string" }, quote: { type: "string" }, confidence: { type: "number" } }, required: ["field", "quote", "confidence"] } };
  return { type: "object", properties, required: Object.keys(properties) };
}

// ─────────────────────────── Executors ───────────────────────────

const trigger: Executor = async (x) => {
  const c = resolveConfig(x);
  const payload = (x.run.inputs.__event as Record<string, unknown> | undefined) ?? {};
  return { output: { inputs: x.run.inputs, startedAt: x.run.startedAt, triggeredBy: x.run.triggeredBy, matterId: x.run.matterId ?? null, note: c.note ?? undefined, ...payload } };
};

const aiPrompt: Executor = async (x) => {
  const c = resolveConfig(x);
  const instructions = `${firmPreamble(x)}\n\n${LEGAL_STYLE_RULES}\n\nStep instructions:\n${str(c.instructions)}`;
  const prompt = str(c.prompt);
  if (!prompt.trim()) throw new StepError("Prompt resolved to an empty string.", "empty_prompt");
  const wantsJson = c.output === "json";
  let schema: Record<string, unknown> | undefined;
  if (wantsJson) {
    const raw = c.jsonSchema;
    if (typeof raw === "string" && raw.trim()) { try { schema = JSON.parse(raw); } catch { throw new StepError("JSON schema is not valid JSON.", "bad_schema"); } }
    else if (raw && typeof raw === "object") schema = raw as Record<string, unknown>;
    else schema = { type: "object", properties: { result: { type: "string" } }, required: ["result"] };
  }
  const r = await callModel(x, { instructions, input: prompt, tier: c.modelTier === "fast" ? "fast" : "primary", json: schema ? { name: "step_output", schema } : undefined, research: c.research as ModelCall["research"] });
  const output = wantsJson ? { ...(r.json as Record<string, unknown>), _citations: r.citations.length ? r.citations : undefined } : { text: r.text, citations: r.citations, toolCalls: r.toolCalls };
  return { output, usage: r.usage, calls: r.calls };
};

const aiExtract: Executor = async (x) => {
  const c = resolveConfig(x);
  const source = str(c.source);
  if (!source.trim()) throw new StepError("Source text is empty; nothing to extract.", "empty_source");
  const fields = Array.isArray(c.fields) ? (c.fields as { name: string; type?: string; description?: string }[]) : [];
  if (!fields.length) throw new StepError("No fields configured.", "no_fields");
  const schema = fieldsToSchema(fields);
  const instructions = `${firmPreamble(x)}\n\nExtract the requested fields from the source document exactly as they appear; normalize dates to YYYY-MM-DD and amounts to numbers. Use empty values (\"\", 0, false, []) when a field is genuinely absent — never guess. For every field add an _evidence entry quoting the supporting language.\n${c.instructions ? `Additional guidance: ${str(c.instructions)}` : ""}`;
  const r = await callModel(x, { instructions, input: `SOURCE DOCUMENT:\n"""\n${source.slice(0, 120_000)}\n"""`, tier: c.modelTier === "fast" ? "fast" : "primary", json: { name: "extraction", schema } });
  x.log(`Extracted ${fields.length} field(s)`);
  return { output: r.json, usage: r.usage, calls: r.calls };
};

const aiClassify: Executor = async (x) => {
  const c = resolveConfig(x);
  const source = str(c.source);
  if (!source.trim()) throw new StepError("Source text is empty; nothing to classify.", "empty_source");
  const labels = (Array.isArray(c.labels) ? (c.labels as { label: string; description?: string }[]) : []).filter((l) => l.label);
  if (!labels.length) throw new StepError("No labels configured.", "no_labels");
  const multi = bool(c.multi);
  const enumValues = labels.map((l) => l.label);
  const schema = multi
    ? { type: "object", properties: { labels: { type: "array", items: { type: "object", properties: { label: { type: "string", enum: enumValues }, confidence: { type: "number" }, rationale: { type: "string" } }, required: ["label", "confidence", "rationale"] } } }, required: ["labels"] }
    : { type: "object", properties: { label: { type: "string", enum: enumValues }, confidence: { type: "number", description: "0..1" }, rationale: { type: "string", description: "One or two sentences citing the decisive language" } }, required: ["label", "confidence", "rationale"] };
  const instructions = `${firmPreamble(x)}\n\nClassify the text into ${multi ? "one or more" : "exactly one"} of these labels:\n${labels.map((l) => `- ${l.label}: ${l.description ?? ""}`).join("\n")}\nGive a calibrated confidence between 0 and 1 and a short rationale that quotes the decisive language.\n${c.instructions ? `Additional guidance: ${str(c.instructions)}` : ""}`;
  const r = await callModel(x, { instructions, input: `TEXT:\n"""\n${source.slice(0, 80_000)}\n"""`, tier: c.modelTier === "fast" ? "fast" : "primary", json: { name: "classification", schema } });
  const j = r.json as Record<string, unknown>;
  const output = multi ? { labels: j.labels, label: (j.labels as { label: string }[])?.[0]?.label ?? "", confidence: (j.labels as { confidence: number }[])?.[0]?.confidence ?? 0, rationale: (j.labels as { rationale: string }[])?.map((l) => l.rationale).join(" ") } : { ...j, labels: [{ label: j.label, confidence: j.confidence, rationale: j.rationale }] };
  x.log(`Label: ${str(output.label)} (${Math.round(num(output.confidence, 0) * 100)}%)`);
  return { output, usage: r.usage, calls: r.calls };
};

const aiSummarize: Executor = async (x) => {
  const c = resolveConfig(x);
  const source = str(c.source);
  if (!source.trim()) throw new StepError("Source text is empty; nothing to summarize.", "empty_source");
  const words = { short: 150, medium: 400, long: 900 }[str(c.length) as "short" | "medium" | "long"] ?? 400;
  const styles: Record<string, string> = {
    bullets: "Write tight bullet points grouped under short bold headings.",
    paragraphs: "Write flowing narrative paragraphs.",
    executive: "Write an executive summary: one-paragraph bottom line, then key points, then risks and next steps.",
    issues: "Produce an issues list: each issue with a heading, the relevant facts, and why it matters.",
    qa: "Produce a deposition-style digest: for each key exchange give page:line, the question, the answer in substance, and a flag (admission, contradiction, evasive, key).",
  };
  const instructions = `${firmPreamble(x)}\n\n${LEGAL_STYLE_RULES}\n\nSummarize the source in Markdown. ${styles[str(c.style)] ?? styles.bullets} Target about ${words} words.${c.focus ? ` Focus on: ${str(c.focus)}.` : ""} Preserve names, dates, Bates numbers, page:line cites and dollar figures exactly.`;
  const r = await callModel(x, { instructions, input: `SOURCE:\n"""\n${source.slice(0, 150_000)}\n"""`, tier: c.modelTier === "fast" ? "fast" : "primary" });
  return { output: { text: r.text, wordCount: r.text.split(/\s+/).filter(Boolean).length }, usage: r.usage, calls: r.calls };
};

const aiDraft: Executor = async (x) => {
  const c = resolveConfig(x);
  const brief = str(c.brief);
  if (!brief.trim()) throw new StepError("Drafting brief is empty.", "empty_prompt");
  const kinds: Record<string, string> = {
    memo: "an internal legal memorandum (heading block: TO / FROM / DATE / RE; sections: Question Presented, Short Answer, Background, Analysis, Recommendation)",
    letter: "a formal letter on firm letterhead conventions (date, addressee block, Re: line, salutation, body, closing, signature block)",
    email: "a concise professional email (subject line first as '# Subject: …', then the body)",
    checklist: "a checklist with grouped items, owners and deadlines where known, formatted as Markdown task lists",
    clause: "contract language: the clause itself in numbered sub-sections, followed by a short drafting note",
    brief_section: "a section of a court brief with headings, argument and record/authority cites",
    report: "a client-facing status report (Summary, Recent developments, Upcoming deadlines, Decisions needed, Budget/next steps)",
    chronology: "a chronology: a Markdown table with Date | Event | Source (Bates / cite) | Significance, sorted by date, followed by gaps and open questions",
  };
  const tones: Record<string, string> = { formal: "formal and precise", plain: "plain English, short sentences", persuasive: "persuasive but measured", neutral: "neutral and analytical" };
  const audiences: Record<string, string> = { partner: "a supervising partner", client: "the client (a sophisticated general counsel)", opposing: "opposing counsel", court: "the court", team: "the case team" };
  const instructions = `${firmPreamble(x)}\n\n${LEGAL_STYLE_RULES}\n\nDraft ${kinds[str(c.kind)] ?? kinds.memo}. Tone: ${tones[str(c.tone)] ?? tones.formal}. Audience: ${audiences[str(c.audience)] ?? audiences.partner}. Output Markdown only. Start with a single H1 title line. Use [VERIFY] for any fact or authority you could not confirm. Do not add commentary outside the document.`;
  const input = `DRAFTING BRIEF:\n${brief}${c.context ? `\n\nADDITIONAL CONTEXT:\n${str(c.context).slice(0, 100_000)}` : ""}`;
  const r = await callModel(x, { instructions, input, tier: c.modelTier === "fast" ? "fast" : "primary", research: c.research as ModelCall["research"], maxSteps: 8 });
  const title = r.text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `${x.workflow.name} — ${str(c.kind)}`;
  return { output: { title, text: r.text, wordCount: r.text.split(/\s+/).filter(Boolean).length, citations: r.citations }, usage: r.usage, calls: r.calls };
};

const aiReview: Executor = async (x) => {
  const c = resolveConfig(x);
  const source = str(c.source);
  if (!source.trim()) throw new StepError("Document text is empty; nothing to review.", "empty_source");
  const checklist = (Array.isArray(c.checklist) ? (c.checklist as unknown[]).map(str) : str(c.checklist).split("\n")).map((s) => s.trim()).filter(Boolean);
  if (!checklist.length) throw new StepError("Checklist is empty.", "no_checklist");
  const schema = {
    type: "object",
    properties: {
      findings: { type: "array", items: { type: "object", properties: { item: { type: "string" }, status: { type: "string", enum: ["pass", "fail", "unclear", "n/a"] }, severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] }, note: { type: "string" }, quote: { type: "string", description: "Exact supporting language from the document, or empty" } }, required: ["item", "status", "severity", "note", "quote"] } },
      summary: { type: "string" },
      score: { type: "number", description: "0..100 overall compliance score" },
    },
    required: ["findings", "summary", "score"],
  };
  const instructions = `${firmPreamble(x)}\n\nReview the document against each checklist item. For each item report pass / fail / unclear / n/a, a severity, a one-sentence note and the exact quote you relied on. Then give a two-sentence summary and an overall score (100 = every item passes).\n${c.instructions ? `Additional guidance: ${str(c.instructions)}` : ""}`;
  const r = await callModel(x, { instructions, input: `CHECKLIST:\n${checklist.map((i, n) => `${n + 1}. ${i}`).join("\n")}\n\nDOCUMENT:\n"""\n${source.slice(0, 120_000)}\n"""`, tier: c.modelTier === "fast" ? "fast" : "primary", json: { name: "review", schema } });
  const j = r.json as { findings: { status: string }[]; summary: string; score: number };
  const failed = (j.findings ?? []).filter((f) => f.status === "fail").length;
  x.log(`${failed} failing item(s), score ${Math.round(num(j.score, 0))}`);
  return { output: { ...j, failed, passed: (j.findings ?? []).filter((f) => f.status === "pass").length }, usage: r.usage, calls: r.calls };
};

const aiResearch: Executor = async (x) => {
  const c = resolveConfig(x);
  const question = str(c.question);
  if (!question.trim()) throw new StepError("Research question is empty.", "empty_prompt");
  const sources = (c.sources as { web?: boolean; legal?: boolean; internal?: boolean }) ?? { web: true, legal: true, internal: true };
  const depth = str(c.depth) || "standard";
  const maxSteps = depth === "quick" ? 4 : depth === "deep" ? 14 : 8;
  const instructions = `${firmPreamble(x)}\n\n${RESEARCH_METHOD}\n\n${LEGAL_STYLE_RULES}\n\n${c.jurisdiction ? `Jurisdiction focus: ${str(c.jurisdiction)} (pass this as the jurisdiction argument to search_case_law).` : ""}\nDepth: ${depth}. ${depth === "deep" ? "Open and read the controlling opinions before quoting them." : depth === "quick" ? "Use at most four tool calls and answer from the search results." : ""}\nDeliver a research memo in Markdown: **Bottom line**, **Analysis** (with citations), **Authorities relied on** (bulleted with citations and one-line parentheticals), **Open questions / next steps**. Mark unverified points [VERIFY].\n${c.instructions ? `Additional guidance: ${str(c.instructions)}` : ""}`;
  const r = await callModel(x, { instructions, input: question, tier: c.modelTier === "fast" ? "fast" : "primary", research: sources, maxSteps, reasoningEffort: depth === "deep" ? "high" : "medium" });
  return { output: { text: r.text, citations: r.citations, toolCalls: r.toolCalls }, usage: r.usage, calls: r.calls };
};

// ───────────── Data ─────────────

interface LibraryHit { id: string; name: string; type: string; description?: string; tags?: string[]; practice_area?: string; office_doc_id?: string; passage: string; score: number; content?: string }

const dataSearchLibrary: Executor = async (x) => {
  const c = resolveConfig(x);
  const query = str(c.query).trim();
  if (!query) throw new StepError("Query is empty.", "empty_query");
  const res = (await searchLibraryTool.execute({ query, type: c.type ? str(c.type) : undefined, matter_id: c.matterId ? str(c.matterId) : undefined, limit: num(c.limit, 8) }, toolCtx(x))) as { count: number; results: LibraryHit[] };
  const results = res.results ?? [];
  if (bool(c.includeContent)) {
    for (const r of results) {
      try { const full = (await getLibraryItemTool.execute({ id: r.id, max_chars: 20_000 }, toolCtx(x))) as { content?: string }; r.content = full.content; } catch (e) { x.log(`could not read ${r.id}: ${(e as Error).message}`); }
    }
  }
  x.log(`${results.length} library hit(s) for "${query}"`);
  const text = results.map((r, i) => `${i + 1}. **${r.name}** (${r.type}${r.practice_area ? `, ${r.practice_area}` : ""})\n${r.content ? r.content.slice(0, 4000) : r.passage}`).join("\n\n");
  return { output: { count: results.length, query, results, text } };
};

interface EdocHit { id: string; bates: string; date: string; custodian: string; type: string; subject: string; from?: string; to?: string[]; passage: string; score: number; ai_score?: number; coding: EDocument["coding"] }

const dataSearchEdiscovery: Executor = async (x) => {
  const c = resolveConfig(x);
  const query = str(c.query).trim();
  const matterId = c.matterId ? str(c.matterId) : undefined;
  const limit = Math.min(num(c.limit, 10), 50);
  const filters = (doc: EDocument) =>
    (!matterId || doc.matterId === matterId) &&
    (!c.custodian || doc.custodianName.toLowerCase().includes(str(c.custodian).toLowerCase())) &&
    (!c.docType || doc.type.toLowerCase() === str(c.docType).toLowerCase()) &&
    (!c.dateAfter || doc.date >= str(c.dateAfter)) &&
    (!c.dateBefore || doc.date <= str(c.dateBefore)) &&
    (!bool(c.privilegedOnly) || doc.coding?.privileged === true) &&
    (!bool(c.hotOnly) || doc.coding?.hot === true) &&
    (!bool(c.responsiveOnly) || doc.coding?.responsive === true);
  let results: EdocHit[];
  if (!query || query === "*") {
    results = db().edocs.find(filters).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).map((doc) => ({ id: doc.id, bates: doc.bates, date: doc.date, custodian: doc.custodianName, type: doc.type, subject: doc.subject, from: doc.from, to: doc.to, passage: doc.text.slice(0, 900), score: 1, ai_score: doc.aiScore, coding: doc.coding }));
  } else {
    const res = (await searchEdiscoveryTool.execute({ query, matter_id: matterId, custodian: c.custodian ? str(c.custodian) : undefined, doc_type: c.docType ? str(c.docType) : undefined, date_after: c.dateAfter ? str(c.dateAfter) : undefined, date_before: c.dateBefore ? str(c.dateBefore) : undefined, limit: Math.min(limit * 2, 25) }, toolCtx(x))) as { count: number; results: EdocHit[] };
    results = (res.results ?? []).filter((r) => { const doc = db().edocs.get(r.id); return doc ? filters(doc) : true; }).slice(0, limit);
  }
  x.log(`${results.length} document(s)${query ? ` for "${query}"` : ""}`);
  const text = results.map((r) => `**${r.bates}** · ${r.date} · ${r.custodian} · ${r.type} — ${r.subject}${r.coding?.privileged ? " · PRIVILEGED" : ""}${r.coding?.hot ? " · HOT" : ""}\n> ${r.passage.replace(/\s+/g, " ").slice(0, 600)}`).join("\n\n");
  return { output: { count: results.length, query, results, batesNumbers: results.map((r) => r.bates), text } };
};

function relativeDate(v: unknown): string | undefined {
  const s = str(v).trim();
  if (!s) return undefined;
  const d = resolveDateRule(s);
  return d ? d.toISOString().slice(0, 10) : s;
}

const LEGAL_TOOL_MAP = Object.fromEntries(LEGAL_TOOLS.map((t) => [t.name, t as ToolDef<Record<string, unknown>, unknown>]));

const dataLegalSearch: Executor = async (x) => {
  const c = resolveConfig(x);
  const source = str(c.source) || "case_law";
  const limit = Math.min(num(c.limit, 10), 20);
  const tc = toolCtx(x);
  const citations: { title: string; url?: string; cite?: string; source?: string }[] = [];
  tc.emit = (e) => { if (e.type === "citation") citations.push(e.citation); };
  let raw: unknown;
  let text = "";
  const query = str(c.query).trim();
  switch (source) {
    case "case_law": {
      if (!query) throw new StepError("Query is empty.", "empty_query");
      raw = await LEGAL_TOOL_MAP.search_case_law.execute({ query, jurisdiction: c.jurisdiction ? str(c.jurisdiction) : undefined, courts: c.courts ? str(c.courts) : undefined, filed_after: relativeDate(c.after), limit }, tc);
      const r = raw as { total: number; results: { case_name?: string; citations?: string[]; court?: string; date_filed?: string; snippet?: string; url?: string }[] };
      text = r.results.map((o) => `- **${o.case_name}**${o.citations?.[0] ? `, ${o.citations[0]}` : ""} (${o.court ?? ""} ${o.date_filed ?? ""})${o.url ? ` — ${o.url}` : ""}\n  ${o.snippet ?? ""}`).join("\n");
      break;
    }
    case "dockets": {
      if (!query) throw new StepError("Query is empty.", "empty_query");
      raw = await LEGAL_TOOL_MAP.search_dockets.execute({ query, courts: c.courts ? str(c.courts) : undefined, filed_after: relativeDate(c.after), limit }, tc);
      const r = raw as { total: number; results: { case_name?: string; docket_number?: string; court?: string; date_filed?: string; assigned_to?: string; url?: string }[] };
      text = r.results.map((o) => `- **${o.case_name}** · ${o.docket_number ?? ""} · ${o.court ?? ""} · filed ${o.date_filed ?? "?"}${o.assigned_to ? ` · ${o.assigned_to}` : ""}${o.url ? ` — ${o.url}` : ""}`).join("\n");
      break;
    }
    case "docket_entries": {
      const docketId = num(c.docketId, 0);
      if (!docketId) throw new StepError("Docket id is required.", "empty_query");
      raw = await LEGAL_TOOL_MAP.get_docket_entries.execute({ docket_id: docketId, limit }, tc);
      const r = raw as { entries: { entry?: number; date?: string; description?: string }[] };
      text = r.entries.map((e) => `- #${e.entry ?? "?"} (${e.date ?? "?"}): ${e.description ?? ""}`).join("\n");
      break;
    }
    case "cfr": {
      if (!query) throw new StepError("Query is empty.", "empty_query");
      raw = await LEGAL_TOOL_MAP.search_cfr.execute({ query, limit }, tc);
      const r = raw as { total: number; results: { cite: string; heading?: string; excerpt?: string; url?: string }[] };
      text = r.results.map((o) => `- **${o.cite}** — ${o.heading ?? ""}${o.url ? ` (${o.url})` : ""}\n  ${o.excerpt ?? ""}`).join("\n");
      break;
    }
    case "federal_register": {
      if (!query) throw new StepError("Query is empty.", "empty_query");
      raw = await LEGAL_TOOL_MAP.search_federal_register.execute({ query, agency: c.agency ? str(c.agency) : undefined, document_type: c.documentType ? str(c.documentType) : undefined, published_after: relativeDate(c.after), limit }, tc);
      const r = raw as { total: number; results: { title: string; type: string; agencies?: string[]; published: string; citation?: string; abstract?: string; url: string; comments_close_on?: string }[] };
      text = r.results.map((o) => `- **${o.title}** (${o.type}; ${(o.agencies ?? []).join(", ")}; ${o.published}${o.citation ? `; ${o.citation}` : ""}${o.comments_close_on ? `; comments close ${o.comments_close_on}` : ""}) — ${o.url}\n  ${o.abstract ?? ""}`).join("\n");
      break;
    }
    case "statutes": {
      if (!query) throw new StepError("Query is empty.", "empty_query");
      raw = await LEGAL_TOOL_MAP.search_statutes.execute({ query, limit }, tc);
      const r = raw as { total: number; results: { title?: string; date?: string; url?: string; teaser?: string }[] };
      text = r.results.map((o) => `- **${o.title}** (${o.date ?? ""})${o.url ? ` — ${o.url}` : ""}\n  ${o.teaser ?? ""}`).join("\n");
      break;
    }
    case "verify_citations": {
      const body = str(c.text);
      if (!body.trim()) throw new StepError("No text to check.", "empty_query");
      raw = await LEGAL_TOOL_MAP.verify_citations.execute({ text: body }, tc);
      const r = raw as { citations: { citation: string; resolved: boolean; matches?: { case_name?: string; url?: string }[]; error?: string }[] };
      const bad = r.citations.filter((k) => !k.resolved);
      text = `${r.citations.length} citation(s) checked, ${bad.length} unresolved.\n\n${r.citations.map((k) => `- ${k.resolved ? "✓" : "✗"} ${k.citation}${k.matches?.[0]?.case_name ? ` — ${k.matches[0].case_name}` : ""}${k.error ? ` (${k.error})` : ""}`).join("\n")}`;
      const out = { ...r, total: r.citations.length, unresolved: bad, unresolvedCount: bad.length, results: r.citations, text };
      x.log(text.split("\n")[0]);
      return { output: out };
    }
    default:
      throw new StepError(`Unknown legal source "${source}".`, "bad_source");
  }
  const rawObj = raw as Record<string, unknown>;
  const results = (rawObj.results ?? rawObj.entries ?? []) as unknown[];
  x.log(`${results.length} result(s) from ${source}`);
  return { output: { ...rawObj, source, query, results, text, citations: dedupe(citations) } };
};

const dataFetchUrl: Executor = async (x) => {
  const c = resolveConfig(x);
  const url = str(c.url).trim();
  if (!url) throw new StepError("URL is empty.", "empty_query");
  const r = (await fetchUrlTool.execute({ url, max_chars: num(c.maxChars, 30_000) }, toolCtx(x))) as { url: string; title?: string; text: string; contentType?: string };
  x.log(`Fetched ${r.url} (${r.text.length.toLocaleString()} chars)`);
  return { output: r };
};

// ───────────── Logic ─────────────

const logicBranch: Executor = async (x) => {
  const rules = (Array.isArray(x.config.rules) ? x.config.rules : []) as BranchRule[];
  const res = evaluateBranch(rules, x.ctx, x.report);
  x.log(`Matched "${res.label}"`);
  return { output: res };
};

const logicMerge: Executor = async (x) => {
  const branches: Record<string, unknown> = {};
  const succeeded: string[] = [];
  const skipped: string[] = [];
  const steps = x.ctx.steps ?? {};
  for (const e of x.workflow.edges.filter((e) => e.target === x.node.id)) {
    const s = steps[e.source];
    if (s && s.status === "succeeded" && x.activeSources.includes(e.source)) { branches[e.source] = s.output; succeeded.push(e.source); } else skipped.push(e.source);
  }
  return { output: { branches, succeeded, skipped, mode: x.config.mode ?? "all" } };
};

const logicDelay: Executor = async (x) => {
  const c = resolveConfig(x);
  const requestedMs = Math.max(0, num(c.minutes, 0)) * 60_000;
  const cap = num(process.env.WORKFLOW_MAX_DELAY_MS, 120_000);
  const waitMs = Math.min(requestedMs, cap);
  if (requestedMs > cap) x.log(`Delay of ${num(c.minutes, 0)} min capped to ${Math.round(cap / 1000)}s (WORKFLOW_MAX_DELAY_MS).`);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, waitMs);
    x.signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
  return { output: { waitedMs: waitMs, requestedMs, capped: requestedMs > cap } };
};

// ───────────── Actions ─────────────

function href(kind: RunArtifact["kind"], id: string, docKind?: string) {
  switch (kind) {
    case "task": return `/?task=${id}`;
    case "event": return `/?event=${id}`;
    case "document": return docKind === "sheet" ? `/office/sheet/${id}` : docKind === "slides" ? `/office/slides/${id}` : docKind === "pdf" ? `/office/pdf/${id}` : `/office/word/${id}`;
    case "library": return `/library?item=${id}`;
    case "file": return `/api/blobs/${id}`;
    default: return undefined;
  }
}

const actionCreateTask: Executor = async (x) => {
  const c = resolveConfig(x);
  const title = str(c.title).trim();
  if (!title) throw new StepError("Task title is empty.", "empty_title");
  const now = new Date();
  const due = resolveDateRule(c.dueRule, now);
  const matterId = c.matterId ? str(c.matterId) : x.run.matterId;
  const assigneeId = c.assigneeId ? str(c.assigneeId) : undefined;
  const task: Task = {
    id: `t_${nanoid(10)}`,
    title: title.slice(0, 200),
    description: c.description ? str(c.description).slice(0, 4000) : undefined,
    matterId: matterId || undefined,
    assigneeId: assigneeId && db().people.has(assigneeId) ? assigneeId : WORKFLOW_CURRENT_USER.id,
    createdById: x.run.triggeredById ?? WORKFLOW_CURRENT_USER.id,
    status: "todo",
    priority: (["low", "medium", "high", "urgent"].includes(str(c.priority)) ? str(c.priority) : "medium") as Task["priority"],
    dueAt: due ? due.toISOString().slice(0, 10) : undefined,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    tags: Array.isArray(c.tags) ? (c.tags as unknown[]).map(str).filter(Boolean) : undefined,
    source: "workflow",
    links: [{ label: `Run · ${x.workflow.name}`, href: `/workflows/runs/${x.run.id}` }],
  };
  db().tasks.put(task);
  x.artifact({ kind: "task", id: task.id, title: task.title, href: href("task", task.id), meta: { dueAt: task.dueAt, assignee: personName(task.assigneeId) } });
  x.log(`Task "${task.title}" → ${personName(task.assigneeId)}${task.dueAt ? `, due ${task.dueAt}` : ""}`);
  return { output: { taskId: task.id, title: task.title, dueAt: task.dueAt, assigneeId: task.assigneeId, assignee: personName(task.assigneeId), href: href("task", task.id) } };
};

const actionCreateEvent: Executor = async (x) => {
  const c = resolveConfig(x);
  const title = str(c.title).trim();
  if (!title) throw new StepError("Event title is empty.", "empty_title");
  const start = resolveDateRule(c.startsAt) ?? new Date(Date.now() + 86_400_000);
  const duration = num(c.durationMinutes, 60);
  const end = new Date(start.getTime() + duration * 60_000);
  const attendeeIds = (Array.isArray(c.attendeeIds) ? (c.attendeeIds as unknown[]).map(str) : []).filter((id) => db().people.has(id));
  const ev: CalendarEvent = {
    id: `ev_${nanoid(10)}`,
    title: title.slice(0, 200),
    matterId: c.matterId ? str(c.matterId) : x.run.matterId,
    startsAt: start.toISOString(),
    endsAt: duration > 0 ? end.toISOString() : undefined,
    allDay: duration === 0,
    kind: (["deadline", "hearing", "deposition", "meeting", "filing", "internal", "cle", "other"].includes(str(c.kind)) ? str(c.kind) : "other") as CalendarEvent["kind"],
    location: c.location ? str(c.location) : undefined,
    attendeeIds: attendeeIds.length ? attendeeIds : [WORKFLOW_CURRENT_USER.id],
    notes: c.notes ? `${str(c.notes)}\n\nCreated by workflow "${x.workflow.name}" (run ${x.run.id}).` : `Created by workflow "${x.workflow.name}" (run ${x.run.id}).`,
    ruleSource: c.ruleSource ? str(c.ruleSource) : undefined,
  };
  db().events.put(ev);
  x.artifact({ kind: "event", id: ev.id, title: ev.title, href: href("event", ev.id), meta: { startsAt: ev.startsAt, kind: ev.kind } });
  x.log(`Event "${ev.title}" on ${ev.startsAt.slice(0, 16).replace("T", " ")}`);
  return { output: { eventId: ev.id, title: ev.title, startsAt: ev.startsAt, kind: ev.kind, href: href("event", ev.id) } };
};

/** Build a workbook content model from rows (array of objects / arrays), CSV or a Markdown table. */
export function workbookFromRows(sheetName: string, rowsInput: unknown): { version: number; sheets: { name: string; columns: { key: string; title: string; width: number }[]; rows: unknown[][]; header: string[] }[] } {
  let rows: unknown[] = [];
  if (Array.isArray(rowsInput)) rows = rowsInput;
  else if (typeof rowsInput === "string") {
    const t = rowsInput.trim();
    if (t.startsWith("[")) { try { rows = JSON.parse(t); } catch { rows = []; } }
    else if (t.startsWith("|")) {
      const lines = t.split("\n").filter((l) => l.trim().startsWith("|"));
      const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
      const header = cells(lines[0]);
      rows = lines.slice(1).filter((l) => !/^\|?\s*:?-{2,}/.test(l)).map((l) => Object.fromEntries(cells(l).map((v, i) => [header[i] ?? `col${i + 1}`, v])));
    } else if (t) {
      const lines = t.split("\n").filter(Boolean);
      const parse = (l: string) => { const out: string[] = []; let cur = ""; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
      const header = parse(lines[0]);
      rows = lines.slice(1).map((l) => Object.fromEntries(parse(l).map((v, i) => [header[i] ?? `col${i + 1}`, v])));
    }
  }
  const objs = rows.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : null));
  const header = objs.every(Boolean)
    ? Array.from(objs.reduce((s, o) => { Object.keys(o!).forEach((k) => s.add(k)); return s; }, new Set<string>()))
    : Array.from({ length: Math.max(0, ...rows.map((r) => (Array.isArray(r) ? r.length : 1))) }, (_, i) => `Column ${i + 1}`);
  const data = rows.map((r) => (Array.isArray(r) ? r : r && typeof r === "object" ? header.map((h) => { const v = (r as Record<string, unknown>)[h]; return v != null && typeof v === "object" ? JSON.stringify(v) : (v ?? ""); }) : [r]));
  return { version: 1, sheets: [{ name: sheetName.slice(0, 31) || "Sheet1", header, columns: header.map((h) => ({ key: h, title: h.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), width: Math.min(60, Math.max(12, h.length + 6)) })), rows: [header, ...data] }] };
}

const actionSaveDocument: Executor = async (x) => {
  const c = resolveConfig(x);
  const kind = c.kind === "sheet" ? "sheet" : "word";
  const title = str(c.title).trim() || `${x.workflow.name} — ${new Date().toISOString().slice(0, 10)}`;
  const matterId = c.matterId ? str(c.matterId) : x.run.matterId;
  let content: unknown;
  if (kind === "word") {
    const md = str(c.content);
    if (!md.trim()) throw new StepError("Document content is empty.", "empty_content");
    content = markdownToDoc(md.startsWith("#") ? md : md, md.startsWith("#") ? {} : { title });
  } else {
    const rowsRaw = c.rows ?? c.content;
    content = workbookFromRows(title, rowsRaw);
    const sheet = (content as { sheets: { rows: unknown[][] }[] }).sheets[0];
    if (sheet.rows.length <= 1) throw new StepError("Rows resolved to an empty table.", "empty_content");
    x.log(`${sheet.rows.length - 1} row(s), ${sheet.rows[0].length} column(s)`);
  }
  const doc = createOfficeDoc({ kind, title, content, matterId: matterId || undefined, tags: Array.isArray(c.tags) ? (c.tags as unknown[]).map(str) : ["workflow"], meta: { source: "workflow", workflowId: x.workflow.id, runId: x.run.id, nodeId: x.node.id } });
  let libraryItemId: string | undefined;
  if (c.addToLibrary !== false) {
    const now = new Date().toISOString();
    const item: LibraryItem = { id: `lib_${nanoid(10)}`, parentId: null, name: doc.title, type: kind === "sheet" ? "xlsx" : "docx", matterId: doc.matterId, officeDocId: doc.id, createdAt: now, updatedAt: now, size: doc.size, ownerId: WORKFLOW_CURRENT_USER.id, sharedWith: ["matter-team"], tags: doc.tags, description: `Generated by workflow "${x.workflow.name}"`, status: "draft" };
    db().library.put(item);
    libraryItemId = item.id;
    x.artifact({ kind: "library", id: item.id, title: item.name, href: href("library", item.id) });
  }
  const link = href("document", doc.id, kind);
  x.artifact({ kind: "document", id: doc.id, title: doc.title, href: link, meta: { kind } });
  x.log(`Saved ${kind === "sheet" ? "workbook" : "document"} "${doc.title}"`);
  return { output: { docId: doc.id, kind, title: doc.title, href: link, libraryItemId, size: doc.size } };
};

const actionNotify: Executor = async (x) => {
  const c = resolveConfig(x);
  const message = str(c.message).trim();
  if (!message) throw new StepError("Message is empty.", "empty_content");
  const recipients = (Array.isArray(c.recipientIds) ? (c.recipientIds as unknown[]).map(str) : []).filter((id) => db().people.has(id));
  const now = new Date().toISOString();
  const update: TeamUpdate = {
    id: `tu_${nanoid(10)}`,
    authorId: x.run.triggeredById ?? WORKFLOW_CURRENT_USER.id,
    body: `${message}${recipients.length ? `\n\ncc: ${recipients.map(personName).join(", ")}` : ""}`,
    matterId: c.matterId ? str(c.matterId) : x.run.matterId,
    createdAt: now,
    kind: (["update", "win", "announcement", "question"].includes(str(c.kind)) ? str(c.kind) : "update") as TeamUpdate["kind"],
    attachments: [{ label: `Workflow run · ${x.workflow.name}`, href: `/workflows/runs/${x.run.id}` }],
  };
  db().updates.put(update);
  const notif = { id: `wn_${nanoid(10)}`, runId: x.run.id, workflowId: x.workflow.id, nodeId: x.node.id, channel: "in-app", recipientIds: recipients, message, createdAt: now, read: false, updateId: update.id };
  db().collection<typeof notif>("workflow_notifications").put(notif);
  x.artifact({ kind: "notification", id: notif.id, title: message.split("\n")[0].slice(0, 80), href: "/", meta: { recipients: recipients.map(personName) } });
  x.log(`Notified ${recipients.length ? recipients.map(personName).join(", ") : "the team"}`);
  return { output: { notificationId: notif.id, updateId: update.id, recipients, channel: "in-app" } };
};

function toCsv(v: unknown): string {
  const rows = Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : null;
  if (!Array.isArray(rows)) return str(v);
  const wb = workbookFromRows("export", rows);
  const esc = (c: unknown) => { const s = c == null ? "" : typeof c === "object" ? JSON.stringify(c) : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return wb.sheets[0].rows.map((r) => r.map(esc).join(",")).join("\n");
}

const actionExport: Executor = async (x) => {
  const c = resolveConfig(x);
  const format = str(c.format) || "markdown";
  const source = c.source;
  const ext = { markdown: "md", json: "json", csv: "csv", text: "txt" }[format] ?? "txt";
  const mime = { markdown: "text/markdown", json: "application/json", csv: "text/csv", text: "text/plain" }[format] ?? "text/plain";
  const body = format === "json" ? JSON.stringify(source ?? null, null, 2) : format === "csv" ? toCsv(source) : str(source);
  if (!body.trim()) throw new StepError("Nothing to export.", "empty_content");
  const base = (str(c.filename).trim() || `${x.workflow.name}-${Date.now()}`).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
  const filename = base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  const rec = db().blobs.put(new TextEncoder().encode(body), mime, { name: filename, meta: { workflowId: x.workflow.id, runId: x.run.id, nodeId: x.node.id } });
  const url = href("file", rec.id)!;
  let libraryItemId: string | undefined;
  if (c.addToLibrary !== false) {
    const now = new Date().toISOString();
    const item: LibraryItem = { id: `lib_${nanoid(10)}`, parentId: null, name: filename, type: format === "markdown" || format === "text" ? "note" : "link", matterId: c.matterId ? str(c.matterId) : x.run.matterId, createdAt: now, updatedAt: now, size: rec.size, ownerId: WORKFLOW_CURRENT_USER.id, sharedWith: ["matter-team"], tags: ["workflow", "export"], url, content: format === "markdown" || format === "text" ? body.slice(0, 200_000) : undefined, description: `Exported by workflow "${x.workflow.name}"` };
    db().library.put(item);
    libraryItemId = item.id;
  }
  x.artifact({ kind: "file", id: rec.id, title: filename, href: url, meta: { size: rec.size, format } });
  x.log(`Exported ${filename} (${rec.size.toLocaleString()} bytes)`);
  return { output: { blobId: rec.id, url, size: rec.size, filename, format, libraryItemId } };
};

const actionUpdateCoding: Executor = async (x) => {
  const c = resolveConfig(x);
  const docsRaw = c.documents;
  const ids = (Array.isArray(docsRaw) ? docsRaw : str(docsRaw).split(/[,\n]/)).map((v) => (v && typeof v === "object" ? String((v as Record<string, unknown>).id ?? (v as Record<string, unknown>).bates ?? "") : String(v ?? ""))).map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new StepError("No documents resolved.", "empty_content");
  const field = str(c.field);
  const valueRaw = c.value;
  const now = new Date().toISOString();
  const updated: string[] = [];
  const skipped: string[] = [];
  const d = db();
  for (const key of ids) {
    const doc = d.edocs.get(key) ?? d.edocs.findOne((e) => e.bates.toLowerCase() === key.toLowerCase());
    if (!doc) { skipped.push(key); continue; }
    d.edocs.update(doc.id, (cur) => {
      const coding = { ...cur.coding, reviewerId: WORKFLOW_CURRENT_USER.id, reviewedAt: now };
      switch (field) {
        case "responsive": coding.responsive = bool(valueRaw); break;
        case "privileged": coding.privileged = bool(valueRaw); if (coding.privileged && !coding.privilegeBasis) coding.privilegeBasis = "attorney-client"; break;
        case "hot": coding.hot = bool(valueRaw); break;
        case "confidentiality": { const v = str(valueRaw).toLowerCase(); coding.confidentiality = (["public", "confidential", "highly confidential", "aeo"].includes(v) ? (v === "aeo" ? "AEO" : v) : "confidential") as EDocument["coding"]["confidentiality"]; break; }
        case "issues": coding.issues = Array.from(new Set([...(coding.issues ?? []), ...(Array.isArray(valueRaw) ? (valueRaw as unknown[]).map(str) : str(valueRaw).split(",")).map((s) => s.trim()).filter(Boolean)])); break;
        case "notes": coding.notes = `${coding.notes ? coding.notes + "\n" : ""}${str(valueRaw)}`; break;
        default: throw new StepError(`Unknown coding field "${field}".`, "bad_field");
      }
      if (c.note) coding.notes = `${coding.notes ? coding.notes + "\n" : ""}[${now.slice(0, 10)}] ${str(c.note)}`;
      return { ...cur, coding };
    });
    updated.push(doc.id);
  }
  x.artifact({ kind: "coding", id: x.node.id, title: `${updated.length} document(s) coded ${field} = ${str(valueRaw)}`, href: x.run.matterId ? `/ediscovery?matter=${x.run.matterId}` : "/ediscovery" });
  x.log(`Updated ${updated.length}, skipped ${skipped.length}`);
  return { output: { updated: updated.length, documentIds: updated, skipped, field, value: valueRaw } };
};

const notDirect = (what: string): Executor => async () => { throw new StepError(`${what} is executed by the engine, not as a plain step.`, "engine_only"); };

export const EXECUTORS: Record<WorkflowNodeType, Executor> = {
  "trigger.manual": trigger,
  "trigger.schedule": trigger,
  "trigger.document_added": trigger,
  "trigger.docket_update": trigger,
  "trigger.email": trigger,
  "ai.prompt": aiPrompt,
  "ai.extract": aiExtract,
  "ai.classify": aiClassify,
  "ai.summarize": aiSummarize,
  "ai.draft": aiDraft,
  "ai.review": aiReview,
  "ai.research": aiResearch,
  "data.search_library": dataSearchLibrary,
  "data.search_ediscovery": dataSearchEdiscovery,
  "data.fetch_url": dataFetchUrl,
  "data.legal_search": dataLegalSearch,
  "logic.branch": logicBranch,
  "logic.loop": notDirect("Loop"),
  "logic.merge": logicMerge,
  "logic.approval": notDirect("Approval"),
  "logic.delay": logicDelay,
  "action.create_task": actionCreateTask,
  "action.create_event": actionCreateEvent,
  "action.save_document": actionSaveDocument,
  "action.notify": actionNotify,
  "action.export": actionExport,
  "action.update_coding": actionUpdateCoding,
};

/** Plain-text digest helpers exposed to the engine for run outputs. */
export { markdownTable, extractPlainText, resolveTemplate };
