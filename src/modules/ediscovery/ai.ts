import "server-only";
import { db } from "@/lib/db";
import { generateJSON, generateText } from "@/lib/ai/agent";
import { aiConfig, AIConfigError } from "@/lib/ai/config";
import { FIRM_NAME, LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import type { EDocument, IssueCode } from "@/lib/types/domain";
import type { AIAnalysis, PredictProgressEvent } from "./types";
import { getCodingRules, listIssueCodes, matterDocs, upsertPrivilegeEntry, privilegedDocsWithoutEntry, generatePrivilegeLogTemplate } from "./service";
import { templatePrivilegeDescription } from "./privilege";

const ANALYSIS_KEY = (docId: string) => `ediscovery:analysis:${docId}`;
const MAX_TEXT = 24_000;

export { AIConfigError };

function clip(text: string, n = MAX_TEXT) {
  return text.length > n ? text.slice(0, n) + "\n…[truncated]" : text;
}

function issueRubric(codes: IssueCode[]) {
  return codes.map((c) => `- ${c.code} — ${c.label}${c.description ? `: ${c.description}` : ""}`).join("\n");
}

function docHeader(d: EDocument) {
  return [`Bates: ${d.bates}${d.batesEnd ? ` – ${d.batesEnd}` : ""}`, `Date: ${d.date}`, `Type: ${d.type}`, `Custodian: ${d.custodianName}`, d.from ? `From: ${d.from}` : null, d.to?.length ? `To: ${d.to.join("; ")}` : null, d.cc?.length ? `Cc: ${d.cc.join("; ")}` : null, `Subject: ${d.subject}`].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Single-document analysis
// ---------------------------------------------------------------------------

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "3–5 sentence neutral summary written for a litigator. Cite the Bates number." },
    keyIssues: { type: "array", items: { type: "string" }, description: "Up to 6 short bullet points: the facts or statements in this document that matter for the case." },
    entities: {
      type: "object",
      properties: {
        people: { type: "array", items: { type: "string" } },
        orgs: { type: "array", items: { type: "string" } },
        places: { type: "array", items: { type: "string" } },
        chemicals: { type: "array", items: { type: "string" } },
      },
      required: ["people", "orgs", "places", "chemicals"],
    },
    suggestedCoding: {
      type: "object",
      properties: {
        responsive: { type: "boolean" },
        responsiveConfidence: { type: "integer", description: "0–100" },
        privileged: { type: "boolean" },
        privilegedConfidence: { type: "integer", description: "0–100" },
        privilegeBasis: { type: "string", enum: ["attorney-client", "work-product", "common-interest", "joint-defense", "none"] },
        hot: { type: "boolean" },
        issues: { type: "array", items: { type: "string" }, description: "Issue codes from the rubric, exact codes only." },
        rationale: { type: "string", description: "2–4 sentences explaining the suggested coding with reference to the protocol." },
      },
      required: ["responsive", "responsiveConfidence", "privileged", "privilegedConfidence", "privilegeBasis", "hot", "issues", "rationale"],
    },
    privilegeRisk: { type: "string", description: "One sentence on privilege risk (waiver, crime-fraud, dual-purpose) or 'None identified'." },
  },
  required: ["summary", "keyIssues", "entities", "suggestedCoding", "privilegeRisk"],
};

type RawAnalysis = Omit<AIAnalysis, "generatedAt" | "model" | "suggestedCoding"> & { suggestedCoding: Omit<AIAnalysis["suggestedCoding"], "privilegeBasis"> & { privilegeBasis: string } };

export function cachedAnalysis(docId: string): AIAnalysis | null {
  return db().kv.get<AIAnalysis>(ANALYSIS_KEY(docId));
}

export async function analyzeDocument(docId: string, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<AIAnalysis> {
  const d = db().edocs.get(docId);
  if (!d) throw new Error(`No document ${docId}`);
  if (!opts.force) {
    const cached = cachedAnalysis(docId);
    if (cached) return cached;
  }
  const matter = db().matters.get(d.matterId);
  const codes = listIssueCodes(d.matterId);
  const rules = getCodingRules(d.matterId);
  const instructions = `You are a senior document-review attorney at ${FIRM_NAME} conducting first-level review in ${matter?.name ?? "a litigation matter"} (${matter?.caption ?? ""}). The firm represents ${matter?.client ?? "the client"} (${matter?.clientSide ?? "party"}).
${todayLine()}
${LEGAL_STYLE_RULES}

Apply the matter's coding protocol below strictly. Suggest issue codes only from the rubric. Be conservative on privilege: a lawyer on cc does not make a business document privileged. Mark hot only for documents likely to be used as exhibits.

## Coding protocol
${rules}

## Issue code rubric
${issueRubric(codes)}`;
  const raw = await generateJSON<RawAnalysis>({
    fast: true,
    instructions,
    input: `Analyse the following document and return the structured review.\n\n${docHeader(d)}\n\n---\n${clip(d.text)}`,
    schema: ANALYSIS_SCHEMA,
    name: "document_analysis",
    maxOutputTokens: 1800,
    signal: opts.signal,
  });
  const valid = new Set(codes.map((c) => c.code));
  const analysis: AIAnalysis = {
    ...raw,
    suggestedCoding: {
      ...raw.suggestedCoding,
      privilegeBasis: raw.suggestedCoding.privilegeBasis === "none" ? undefined : (raw.suggestedCoding.privilegeBasis as AIAnalysis["suggestedCoding"]["privilegeBasis"]),
      issues: raw.suggestedCoding.issues.filter((i) => valid.has(i)),
      responsiveConfidence: Math.max(0, Math.min(100, raw.suggestedCoding.responsiveConfidence)),
      privilegedConfidence: Math.max(0, Math.min(100, raw.suggestedCoding.privilegedConfidence)),
    },
    generatedAt: new Date().toISOString(),
    model: aiConfig().fastModel,
  };
  db().kv.set(ANALYSIS_KEY(docId), analysis);
  db().edocs.update(docId, (cur) => ({
    ...cur,
    aiSummary: analysis.summary,
    aiIssues: analysis.suggestedCoding.issues,
    entities: analysis.entities,
    aiScore: analysis.suggestedCoding.responsive ? Math.max(50, analysis.suggestedCoding.responsiveConfidence) : Math.min(49, 100 - analysis.suggestedCoding.responsiveConfidence),
  }));
  return analysis;
}

// ---------------------------------------------------------------------------
// Batch responsiveness prediction (10 docs per call)
// ---------------------------------------------------------------------------

const BATCH_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          score: { type: "integer", description: "0–100 probability that the document is responsive under the protocol" },
          issues: { type: "array", items: { type: "string" } },
          rationale: { type: "string", description: "One sentence." },
        },
        required: ["id", "score", "issues", "rationale"],
      },
    },
  },
  required: ["results"],
};

export interface PredictOptions {
  matterId: string;
  ids?: string[];
  /** Re-score documents that already have an aiScore. */
  force?: boolean;
  batchSize?: number;
  signal?: AbortSignal;
  onEvent?: (e: PredictProgressEvent) => void;
}

export async function predictResponsiveness(opts: PredictOptions) {
  const t0 = Date.now();
  const emit = opts.onEvent ?? (() => {});
  if (!aiConfig().hasKey) throw new AIConfigError();
  const matter = db().matters.get(opts.matterId);
  const codes = listIssueCodes(opts.matterId);
  const rules = getCodingRules(opts.matterId);
  let docs = opts.ids?.length ? (opts.ids.map((id) => db().edocs.get(id)).filter(Boolean) as EDocument[]) : matterDocs(opts.matterId).filter((d) => d.coding.responsive == null);
  if (!opts.force) docs = docs.filter((d) => d.aiScore == null || opts.ids?.length);
  docs = docs.sort((a, b) => a.bates.localeCompare(b.bates));
  const total = docs.length;
  emit({ type: "start", total });
  const instructions = `You are a predictive-coding model for ${FIRM_NAME} in ${matter?.name ?? "a matter"}. For each document, estimate the probability (0–100) that a careful reviewer applying the protocol below would code it Responsive, and list the applicable issue codes from the rubric (exact codes only). Judge each document independently. Be calibrated: routine business, HR, pricing and social messages score low; documents squarely within the RFP topics score high.
${todayLine()}

## Coding protocol
${rules}

## Issue code rubric
${issueRubric(codes)}`;
  const valid = new Set(codes.map((c) => c.code));
  const size = Math.max(1, Math.min(20, opts.batchSize ?? 10));
  let done = 0;
  let scored = 0;
  let likelyResponsive = 0;
  let likelyNonResponsive = 0;
  let uncertain = 0;
  for (let i = 0; i < docs.length; i += size) {
    if (opts.signal?.aborted) break;
    const batch = docs.slice(i, i + size);
    const input = batch.map((d, n) => `### Document ${n + 1} (id: ${d.id})\n${docHeader(d)}\n\n${clip(d.text, 6000)}`).join("\n\n");
    const res = await generateJSON<{ results: { id: string; score: number; issues: string[]; rationale: string }[] }>({
      fast: true,
      instructions,
      input: `Score the following ${batch.length} documents. Return one result per document id.\n\n${input}`,
      schema: BATCH_SCHEMA,
      name: "batch_prediction",
      maxOutputTokens: 200 * batch.length + 200,
      signal: opts.signal,
    });
    const byId = new Map(res.results.map((r) => [r.id, r]));
    const updates: EDocument[] = [];
    for (const d of batch) {
      const r = byId.get(d.id);
      done++;
      if (!r) { emit({ type: "progress", done, total, scored }); continue; }
      const score = Math.max(0, Math.min(100, Math.round(r.score)));
      const issues = r.issues.filter((x) => valid.has(x));
      updates.push({ ...d, aiScore: score, aiIssues: issues });
      scored++;
      if (score >= 70) likelyResponsive++; else if (score < 40) likelyNonResponsive++; else uncertain++;
      emit({ type: "doc", docId: d.id, bates: d.bates, aiScore: score, message: r.rationale, done, total, scored });
    }
    if (updates.length) db().edocs.putMany(updates);
    emit({ type: "progress", done, total, scored });
  }
  const summary = { scored, likelyResponsive, likelyNonResponsive, uncertain, tookMs: Date.now() - t0 };
  emit({ type: "done", done, total, scored, summary });
  return summary;
}

// ---------------------------------------------------------------------------
// Privilege log descriptions
// ---------------------------------------------------------------------------

export async function draftPrivilegeDescription(docId: string, opts: { signal?: AbortSignal } = {}): Promise<{ description: string; ai: boolean }> {
  const d = db().edocs.get(docId);
  if (!d) throw new Error(`No document ${docId}`);
  if (!aiConfig().hasKey) return { description: templatePrivilegeDescription(d), ai: false };
  const res = await generateText({
    fast: true,
    instructions: `You draft privilege-log entries for ${FIRM_NAME}. Write ONE sentence (max 45 words) describing the document for a Rule 26(b)(5)(A) privilege log: document type, author and role, recipients and roles, the general legal subject, and the basis (attorney-client communication / work product). Never disclose the substance of the advice, any conclusions, numbers, or the content of the document. Do not use quotation marks. Use the style: "Email from Robert Kaine (Associate General Counsel) to Martin Suarez providing legal advice regarding regulatory reporting obligations."`,
    input: `${docHeader(d)}\nPrivilege basis coded by reviewer: ${d.coding.privilegeBasis ?? "attorney-client"}\nReviewer note: ${d.coding.notes ?? "(none)"}\n\n---\n${clip(d.text, 8000)}`,
    maxOutputTokens: 160,
    signal: opts.signal,
  });
  const text = res.text.trim().replace(/^["“]|["”]$/g, "");
  return { description: text || templatePrivilegeDescription(d), ai: true };
}

export async function generatePrivilegeLog(matterId: string, opts: { regenerate?: boolean; useAI?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}) {
  const useAI = opts.useAI !== false && aiConfig().hasKey;
  if (!useAI) return generatePrivilegeLogTemplate(matterId, { regenerate: opts.regenerate });
  const docs = opts.regenerate ? matterDocs(matterId).filter((d) => d.coding.privileged === true) : privilegedDocsWithoutEntry(matterId);
  let n = 0;
  for (const d of docs) {
    if (opts.signal?.aborted) break;
    const { description } = await draftPrivilegeDescription(d.id, { signal: opts.signal });
    upsertPrivilegeEntry(d, description);
    n++;
    opts.onProgress?.(n, docs.length);
  }
  const stale = db().privilegeLog.find((e) => e.matterId === matterId && db().edocs.get(e.docId)?.coding.privileged !== true);
  for (const e of stale) db().privilegeLog.delete(e.id);
  return { created: n, removed: stale.length, ai: true };
}
