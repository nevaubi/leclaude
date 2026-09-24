import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/integrity/audit";
import { makeProvenance } from "@/lib/integrity/provenance";
import { putProvenance } from "@/lib/integrity/store";
import type { Provenance } from "@/lib/integrity/types";
import { safeVerifyClaims, type VerifySource } from "@/lib/ai/verify";
import { classifyError } from "@/modules/intel/steward";
import type { IntelDocumentKind } from "@/modules/intel/types";
import { nodeSpec, type AnyNodeType } from "./registry";
import { resolveText } from "./template-expr";
import { StepError, bool, idList, num, resolveConfig, str, upstreamProvenance, upstreamTrust, type ExecContext, type Executor } from "./executors";
import { extractDocuments, fetchSource, indexDocs, integritySweep, linkEntities, publishInsights, queryRecords, relativeDate, runAnalysis, verifyInsightSet, type AnalysisActor, type AnalysisKind, type PublishTarget } from "./intel-bridge";
import { renderOutputFile } from "./output-files";
import type { OutputFormat } from "./frontend";
import { OUTPUT_FORMATS } from "./frontend";

/**
 * Executors for the phase-3 node types that touch the intelligence layer,
 * records and deliverables: intel.*, review.auto (the steward), data.query,
 * output.file and logic.schedule_after. Agent steps live in executors-agents.ts.
 */

function actorOf(x: ExecContext): AnalysisActor {
  return { workflowId: x.workflow.id, workflowName: x.workflow.name, runId: x.run.id, nodeId: x.node.id, nodeLabel: x.node.label, href: `/workflows/runs/${x.run.id}`, userId: x.run.triggeredById };
}

function parseJsonMaybe(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) { try { const p = JSON.parse(v); return p && typeof p === "object" ? (p as Record<string, unknown>) : undefined; } catch { throw new StepError("Configuration is not valid JSON.", "bad_json"); } }
  return undefined;
}

// ───────────── intel.fetch ─────────────

const intelFetch: Executor = async (x) => {
  const c = resolveConfig(x);
  const sourceId = str(c.sourceId).trim();
  const adapter = str(c.adapter).trim();
  if (!sourceId && !adapter) throw new StepError("Choose a source id or an adapter.", "no_source");
  const r = await fetchSource({ sourceId: sourceId || undefined, adapter: sourceId ? undefined : adapter, config: parseJsonMaybe(c.config), name: `${x.workflow.name} › ${x.node.label}`, mode: str(c.mode) === "enqueue" ? "enqueue" : "run", maxDocs: c.maxDocs ? num(c.maxDocs, 100) : undefined, since: c.since ? str(c.since) : undefined, signal: x.signal, log: x.log });
  if (r.status === "failed" || r.status === "escalated") {
    const first = r.errors[0];
    throw new StepError(`Source ${r.sourceName} ${r.status}${first ? `: ${first.message}` : ""}`, first?.code ?? "source_failed");
  }
  return { output: { ...r, kinds: Array.from(new Set(r.docIds.map((id) => db().collection<{ id: string; kind: string }>("intel_documents").get(id)?.kind).filter(Boolean))) } };
};

// ───────────── intel.extract ─────────────

const intelExtract: Executor = async (x) => {
  const c = resolveConfig(x);
  const docIds = idList(c.docIds);
  const blobIds = idList(c.blobIds);
  if (!docIds.length && !blobIds.length) { x.log("No documents or uploads to extract."); return { output: { docs: 0, summarized: 0, entitiesFound: 0, flagged: 0, docIds: [], texts: [], uploaded: [] } }; }
  const r = await extractDocuments({ docIds, blobIds, summarize: c.summarize !== false, entities: c.entities !== false, maxDocs: num(c.maxDocs, 25), fast: c.modelTier !== "primary", matterId: x.run.matterId, signal: x.signal, log: x.log, tags: [x.workflow.name.slice(0, 40)] });
  x.log(`Extracted ${r.docs} document(s): ${r.summarized} summarized, ${r.entitiesFound} entity mention(s)${r.flagged ? `, ${r.flagged} flagged low confidence` : ""}${r.uploaded.length ? `, ${r.uploaded.length} upload(s) filed` : ""}`);
  return { output: r };
};

// ───────────── intel.index ─────────────

const intelIndex: Executor = async (x) => {
  const c = resolveConfig(x);
  const r = await indexDocs({ docIds: idList(c.docIds), embed: c.embed !== false, chunkSize: c.chunkSize ? num(c.chunkSize, 1200) : undefined, limit: num(c.limit, 25), log: x.log, signal: x.signal });
  return { output: r };
};

// ───────────── intel.entities ─────────────

const intelEntitiesStep: Executor = async (x) => {
  const c = resolveConfig(x);
  const docIds = idList(c.docIds);
  if (!docIds.length) { x.log("No documents to link."); return { output: { docs: 0, entities: 0, relations: 0, entityIds: [], byType: {} } }; }
  const r = linkEntities({ docIds, relations: c.relations !== false, log: x.log, signal: x.signal });
  return { output: r };
};

// ───────────── intel.analyze ─────────────

const ANALYSES: AnalysisKind[] = ["trends", "clusters", "chronology", "profiles", "graph"];

const intelAnalyze: Executor = async (x) => {
  const c = resolveConfig(x);
  const analysis = str(c.analysis) as AnalysisKind;
  if (!ANALYSES.includes(analysis)) throw new StepError(`Unknown analysis "${analysis}".`, "bad_analysis");
  const scope = (c.scope && typeof c.scope === "object" ? c.scope : {}) as Record<string, unknown>;
  const kinds = idList(scope.kinds) as IntelDocumentKind[];
  const r = await runAnalysis({
    analysis,
    scope: { matterId: str(scope.matterId) || x.run.matterId || undefined, kinds: kinds.length ? kinds : undefined, entityIds: idList(scope.entityIds), court: str(scope.court) || undefined, jurisdiction: str(scope.jurisdiction) || undefined, dateFrom: str(scope.dateFrom) || undefined, dateTo: str(scope.dateTo) || undefined, q: str(scope.q) || undefined },
    title: str(c.title) || undefined,
    maxDocs: num(c.maxDocs, 400),
    actor: actorOf(x),
    now: new Date(),
    signal: x.signal,
    log: x.log,
  });
  for (const i of r.insights) x.artifact({ kind: "document", id: i.id, title: i.title, href: `/?insight=${i.id}`, meta: { kind: `insight.${i.kind}`, confidence: i.confidence } });
  x.log(`${analysis}: ${r.insightIds.length} insight(s) over ${r.docCount} document(s)`);
  return { output: r };
};

// ───────────── intel.verify ─────────────

function stepsVerification(x: ExecContext, ids: string[]): { trusted: boolean; steps: { id: string; trusted: boolean; reason: string; confidence?: number }[] } {
  const trust = upstreamTrust(x, { stepIds: ids.length ? ids : undefined });
  return { trusted: trust.every((t) => t.trusted), steps: trust.map((t) => ({ id: t.id, trusted: t.trusted, reason: t.reason, confidence: t.confidence })) };
}

const intelVerify: Executor = async (x) => {
  const c = resolveConfig(x);
  const target = str(c.target) || "insights";
  if (target === "sweep") {
    const report = await integritySweep({ network: bool(c.network), limit: num(c.limit, 25), signal: x.signal, log: x.log });
    x.log(`Sweep: ${report.insightsChecked} insight(s) checked, ${report.insightsFlagged} flagged; ${report.staleFlagged} stale, ${report.contradictions} contradiction(s), ${report.brokenLinks} broken link(s), ${report.orphanedEntities} orphaned entit${report.orphanedEntities === 1 ? "y" : "ies"}`);
    return { output: { target, checked: report.insightsChecked, verified: report.insightsChecked - report.insightsFlagged, flagged: report.insightsFlagged + report.contradictions + report.brokenLinks, skipped: 0, trusted: report.contradictions === 0 && report.brokenLinks === 0, insightIds: [], report, notes: report.notes } };
  }
  if (target === "steps") {
    const ids = str(c.steps).split(",").map((s) => s.trim()).filter(Boolean);
    const v = stepsVerification(x, ids);
    // With a key, narrative outputs of the listed steps are also re-checked against the evidence they carry.
    let claims: { supported: number; unsupported: number; contradicted: number } | undefined;
    for (const id of ids) {
      const out = (x.ctx.steps?.[id]?.output ?? {}) as Record<string, unknown>;
      const text = typeof out.text === "string" ? out.text : undefined;
      const sources: VerifySource[] = Array.isArray(out.citations) ? (out.citations as { title?: string; url?: string; cite?: string; snippet?: string }[]).map((s) => ({ title: s.title, url: s.url, cite: s.cite, text: s.snippet ?? s.title ?? "" })).filter((s) => s.text) : [];
      if (!text || !sources.length) continue;
      const r = await safeVerifyClaims({ answer: text, sources, signal: x.signal, maxClaims: 20 });
      if (!r.error) claims = { supported: (claims?.supported ?? 0) + r.supported, unsupported: (claims?.unsupported ?? 0) + r.unsupported, contradicted: (claims?.contradicted ?? 0) + r.contradicted };
    }
    x.log(`${v.steps.filter((s) => s.trusted).length} of ${v.steps.length} step(s) trusted${claims ? `; claims: ${claims.supported} supported, ${claims.unsupported} unsupported, ${claims.contradicted} contradicted` : ""}`);
    return { output: { target, checked: v.steps.length, verified: v.steps.filter((s) => s.trusted).length, flagged: v.steps.filter((s) => !s.trusted).length, skipped: 0, trusted: v.trusted && (!claims || claims.contradicted === 0), steps: v.steps, claims, insightIds: [] } };
  }
  const r = await verifyInsightSet({ insightIds: idList(c.insightIds), limit: num(c.limit, 25), signal: x.signal, log: x.log });
  return { output: { target, ...r } };
};

// ───────────── intel.publish ─────────────

const TARGETS: PublishTarget[] = ["home", "matter", "library", "watch", "digest"];

const intelPublish: Executor = async (x) => {
  const c = resolveConfig(x);
  const to = str(c.to) as PublishTarget;
  if (!TARGETS.includes(to)) throw new StepError(`Unknown publish target "${to}".`, "bad_target");
  const items = Array.isArray(c.items) ? c.items : typeof c.items === "string" && c.items.trim().startsWith("[") ? (() => { try { return JSON.parse(c.items as string) as unknown[]; } catch { return []; } })() : [];
  const r = await publishInsights({ to, insightIds: idList(c.insightIds), items, title: str(c.title) || undefined, summary: str(c.summary) || undefined, matterId: str(c.matterId) || x.run.matterId || undefined, userId: str(c.userId) || undefined, recipientIds: idList(c.recipientIds), libraryFolderId: str(c.libraryFolderId) || undefined, requireVerified: bool(c.requireVerified), actor: actorOf(x), log: x.log });
  for (const id of r.itemIds) x.artifact({ kind: "library", id, title: str(c.title) || "Insights note", href: `/library?item=${id}`, meta: { provenance: upstreamProvenance(x) } });
  for (const id of r.itemIds) x.deliver({ kind: "library", format: "md", title: str(c.title) || "Insights note", href: `/library?item=${id}`, libraryItemId: id, matterId: x.run.matterId, meta: { source: "intel.publish" } });
  for (const id of r.insightIds.slice(0, 20)) x.deliver({ kind: "insight", title: db().collection<{ id: string; title: string }>("intel_insights").get(id)?.title ?? id, href: r.href ?? `/?insight=${id}`, matterId: x.run.matterId, meta: { insightId: id, to } });
  for (const id of r.taskIds) x.artifact({ kind: "task", id, title: db().tasks.get(id)?.title ?? id, href: `/?task=${id}` });
  x.log(`Published ${r.published} to ${to}${r.skipped ? ` (${r.skipped} skipped)` : ""}${r.notified.length ? `; notified ${r.notified.length}` : ""}`);
  return { output: r };
};

// ───────────── review.auto (steward over the run) ─────────────

type FixAction = "retry" | "narrow" | "fast_model" | "skip_verify" | "escalate" | "none";

/** Choose one allow-listed fix for a failed step from its error class and the node type. */
export function chooseFix(code: string, nodeType: string, allowed: Set<string>, attempted: Set<string>): FixAction {
  const spec = nodeSpec(nodeType);
  const ai = Boolean(spec?.usesAI) || nodeType.startsWith("ai.");
  const can = (a: FixAction) => allowed.has(a) && !attempted.has(a);
  if (code === "not_configured" || code === "cancelled") return code === "cancelled" ? "none" : "escalate";
  if (code === "verification") return can("skip_verify") ? "skip_verify" : "escalate";
  if (code === "timeout") return ai && can("fast_model") ? "fast_model" : can("narrow") ? "narrow" : can("retry") ? "retry" : "escalate";
  if (code === "parse" || code === "schema_drift") return can("narrow") ? "narrow" : can("retry") ? "retry" : "escalate";
  if (code === "empty" || code === "duplicate" || code === "low_confidence") return "none";
  // rate_limited, network, unknown
  return can("retry") ? "retry" : can("narrow") ? "narrow" : "escalate";
}

/** Config patch a fix applies when the step is re-run. */
export function fixPatch(action: FixAction, config: Record<string, unknown>): Record<string, unknown> {
  const halve = (k: string, min: number) => (typeof config[k] === "number" ? { [k]: Math.max(min, Math.ceil((config[k] as number) / 2)) } : {});
  switch (action) {
    case "fast_model": return { modelTier: "fast", timeoutSec: Math.min(900, Math.round(Number(config.timeoutSec ?? 180) * 1.5)) };
    case "narrow": return { ...halve("limit", 3), ...halve("maxDocs", 5), ...halve("maxResults", 3), ...halve("maxChars", 2000), ...halve("maxClaims", 5), ...halve("maxIterations", 1), timeoutSec: Math.min(900, Math.round(Number(config.timeoutSec ?? 120) * 1.5)) };
    case "skip_verify": return { verify: false };
    default: return {};
  }
}

function classifyStepError(error: string | undefined): string {
  const msg = (error ?? "").toLowerCase();
  if (/openai key required|api key|no_api_key/.test(msg)) return "not_configured";
  if (/verif|unsupported claim|contradict/.test(msg)) return "verification";
  return classifyError(error ?? "");
}

export function escalateStep(x: ExecContext, nodeId: string, label: string, reason: string, reviewerId?: string) {
  const provenance: Provenance = makeProvenance({ surface: "workflow.steward", model: "steward", confidence: 0.2, sources: [{ kind: "internal", id: `${x.run.id}:${nodeId}`, title: label }] });
  provenance.review = { status: "pending", note: reason.slice(0, 300), by: reviewerId };
  putProvenance({ kind: "workflow.step", recordId: `${x.run.id}:${nodeId}`, matterId: x.run.matterId, title: `${x.workflow.name} › ${label}: ${reason}`.slice(0, 200), href: `/workflows/runs/${x.run.id}`, provenance });
  audit("ai.verify", { kind: "workflow.step", id: `${x.run.id}:${nodeId}`, label: `${x.workflow.name} › ${label}`, matterId: x.run.matterId }, { method: "schema", decision: "escalated", reason, runId: x.run.id, nodeId, workflowId: x.workflow.id, reviewerId });
}

const reviewAuto: Executor = async (x) => {
  const c = resolveConfig(x);
  const watch = str(c.steps).split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(Array.isArray(c.fixes) ? (c.fixes as unknown[]).map(String) : ["retry", "narrow", "fast_model", "skip_verify"]);
  const maxFixes = Math.max(0, num(c.maxFixes, 3));
  const escalate = c.escalate !== false;
  const reviewerId = str(c.reviewerId) || undefined;
  const steps = x.ctx.steps ?? {};
  const nodes = new Map((x.run.snapshot?.nodes ?? x.workflow.nodes).map((n) => [n.id, n]));
  const failed = Object.entries(steps).filter(([id, s]) => id !== x.node.id && s.status === "failed" && (!watch.length || watch.includes(id)));
  const failures: { nodeId: string; label: string; code: string; action: FixAction; ok: boolean; error?: string; note?: string }[] = [];
  const notes: string[] = [];
  let fixed = 0, escalated = 0, applied = 0;
  for (const [id, s] of failed) {
    const node = nodes.get(id);
    const label = node?.label ?? id;
    const type: string = node?.type ?? "";
    const code = classifyStepError(typeof (s as { error?: unknown }).error === "string" ? ((s as { error?: string }).error as string) : undefined);
    const attempted = new Set((x.run.stewardship ?? []).filter((r) => r.nodeId === id && r.action).map((r) => r.action as string));
    let action = chooseFix(code, type, allowed, attempted);
    if (action !== "none" && action !== "escalate" && applied >= maxFixes) { action = "escalate"; notes.push(`Fix budget (${maxFixes}) exhausted before "${label}".`); }
    const rec: (typeof failures)[number] = { nodeId: id, label, code, action, ok: false, error: (s as { error?: string }).error };
    if (action === "none") { rec.ok = true; rec.note = "Not an error worth fixing"; notes.push(`"${label}" failed with ${code}; nothing to fix.`); failures.push(rec); continue; }
    if (action === "escalate") {
      if (escalate) { escalateStep(x, id, label, `${code}: ${(s as { error?: string }).error ?? "failed"}`.slice(0, 300), reviewerId); escalated++; rec.note = "Escalated to the review queue"; }
      else rec.note = "No automatic fix; escalation disabled";
      notes.push(`"${label}" (${code}) needs a person${escalate ? " — added to the review queue" : ""}.`);
      x.run.stewardship = [...(x.run.stewardship ?? []), { nodeId: id, code, action, fixed: false, escalated: escalate, note: rec.note }];
      failures.push(rec);
      continue;
    }
    applied++;
    const patch = fixPatch(action, node?.config ?? {});
    x.log(`Steward: "${label}" failed (${code}) → ${action}${Object.keys(patch).length ? ` ${JSON.stringify(patch)}` : ""}`);
    x.progress(`Re-running ${label} (${action})`);
    let result;
    try { result = await x.rerunStep(id, patch); } catch (e) { result = { nodeId: id, status: "failed" as const, error: (e as Error).message }; }
    rec.ok = result.status === "succeeded";
    audit("scan.fix", { kind: "workflow.step", id: `${x.run.id}:${id}`, label: `${x.workflow.name} › ${label}`, matterId: x.run.matterId }, { steward: true, code, action, patch, ok: rec.ok, runId: x.run.id, nodeId: id, error: result.error });
    if (rec.ok) { fixed++; rec.note = `Fixed by ${action}`; notes.push(`"${label}" recovered after ${action}.`); }
    else {
      rec.error = result.error;
      if (escalate) { escalateStep(x, id, label, `Re-run after ${action} failed again (${classifyStepError(result.error)}: ${result.error ?? "failed"})`.slice(0, 300), reviewerId); escalated++; rec.note = `Re-run failed; escalated`; }
      else rec.note = "Re-run failed";
      notes.push(`"${label}" still failing after ${action}${escalate ? "; escalated" : ""}.`);
    }
    x.run.stewardship = [...(x.run.stewardship ?? []), { nodeId: id, code, action, fixed: rec.ok, escalated: !rec.ok && escalate, note: rec.note }];
    failures.push(rec);
  }
  if (!failed.length) notes.push("No failed steps to review.");
  x.log(`Steward: ${failed.length} failure(s) reviewed, ${fixed} fixed, ${escalated} escalated`);
  if (escalated && bool(c.stopOnEscalate)) throw new StepError(`Steward escalated ${escalated} step(s): ${failures.filter((f) => !f.ok).map((f) => f.label).join(", ")}`, "escalated");
  return { output: { checked: failed.length, fixed, escalated, notes, failures } };
};

// ───────────── data.query ─────────────

const dataQuery: Executor = async (x) => {
  const c = resolveConfig(x);
  const source = str(c.source);
  if (!source) throw new StepError("Choose a source to query.", "no_source");
  const filters = (c.filters && typeof c.filters === "object" ? c.filters : {}) as Record<string, unknown>;
  try {
    const r = queryRecords({ source, q: str(c.q) || undefined, filters, matterId: str(c.matterId) || x.run.matterId || undefined, since: str(c.since) || undefined, limit: num(c.limit, 50), sort: str(c.sort) || undefined, direction: str(c.direction) === "asc" ? "asc" : "desc" });
    x.log(`${r.count} of ${r.total} ${source.replace(/_/g, " ")} row(s)`);
    return { output: r };
  } catch (e) {
    throw e instanceof StepError ? e : new StepError((e as Error).message, "bad_query");
  }
};

// ───────────── output.file ─────────────

const outputFile: Executor = async (x) => {
  const c = resolveConfig(x);
  const format = (str(c.format).trim().toLowerCase() || "docx") as OutputFormat;
  if (!OUTPUT_FORMATS.includes(format)) throw new StepError(`Unknown output format "${format}".`, "bad_format");
  // Front-end label templates arrive as text; resolve them a second time against the run. An empty label
  // falls back to the front end's default label template, then to "<workflow> — <date>".
  const fe = x.workflow.frontend ?? x.run.snapshot?.frontend;
  let label = str(c.label).trim();
  if (label.includes("{{")) label = resolveText(label, x.ctx, x.report).trim();
  if (!label && fe?.output?.defaultLabel) label = resolveText(fe.output.defaultLabel, x.ctx, x.report).trim();
  if (!label) label = `${x.workflow.name} — ${new Date().toISOString().slice(0, 10)}`;
  const matterId = str(c.matterId) || x.run.matterId || undefined;
  const folderId = str(c.libraryFolderId) || fe?.output?.libraryFolderId || undefined;
  const provenance = upstreamProvenance(x);
  const markdown = typeof c.content === "string" ? c.content : c.content != null ? JSON.stringify(c.content, null, 2) : "";
  let rendered;
  try {
    rendered = await renderOutputFile({ format, title: label, markdown, rows: c.rows !== "" && c.rows != null ? c.rows : undefined, matterId, folderId, addToLibrary: c.addToLibrary !== false, tags: Array.isArray(c.tags) ? (c.tags as unknown[]).map(str).filter(Boolean) : ["workflow"], description: `Generated by workflow "${x.workflow.name}"`, provenance, meta: { source: "workflow", workflowId: x.workflow.id, runId: x.run.id, nodeId: x.node.id } });
  } catch (e) {
    throw new StepError((e as Error).message, "render_failed");
  }
  if (rendered.docId && rendered.href) x.artifact({ kind: "document", id: rendered.docId, title: rendered.title, href: rendered.href, meta: { kind: rendered.kind, provenance } });
  if (rendered.libraryItemId) x.artifact({ kind: "library", id: rendered.libraryItemId, title: rendered.title, href: `/library?item=${rendered.libraryItemId}`, meta: { provenance } });
  x.artifact({ kind: "file", id: rendered.blobId, title: rendered.filename, href: rendered.url, meta: { size: rendered.size, format } });
  x.deliver({ kind: rendered.docId ? "document" : "file", format, title: rendered.title, href: rendered.href ?? (rendered.libraryItemId ? `/library?item=${rendered.libraryItemId}` : undefined), downloadHref: rendered.url, blobId: rendered.blobId, docId: rendered.docId, libraryItemId: rendered.libraryItemId, libraryFolderId: rendered.libraryFolderId, matterId, mime: rendered.mime, size: rendered.size, meta: { provenance, source: "output.file", filename: rendered.filename } });
  x.log(`${format.toUpperCase()} "${rendered.title}" (${rendered.size.toLocaleString()} bytes)${rendered.libraryItemId ? " filed in the library" : ""}`);
  return { output: { format, label: rendered.title, title: rendered.title, filename: rendered.filename, blobId: rendered.blobId, url: rendered.url, size: rendered.size, mime: rendered.mime, kind: rendered.kind ?? null, docId: rendered.docId ?? null, href: rendered.href ?? rendered.url, libraryItemId: rendered.libraryItemId ?? null, libraryFolderId: rendered.libraryFolderId ?? null, provenance } };
};

// ───────────── logic.schedule_after ─────────────

const scheduleAfter: Executor = async (x) => {
  const c = resolveConfig(x);
  const workflowId = str(c.workflowId).trim();
  if (!workflowId) throw new StepError("Choose a workflow to start.", "no_workflow");
  if (workflowId === x.workflow.id) throw new StepError("A workflow cannot start itself from a step.", "self_start");
  const base = c.includeInputs !== false ? Object.fromEntries(Object.entries(x.run.inputs).filter(([k]) => k !== "__event")) : {};
  const mapped = (c.inputs && typeof c.inputs === "object" ? c.inputs : {}) as Record<string, unknown>;
  const inputs = { ...base, ...mapped, parent_run_id: x.run.id, parent_workflow: x.workflow.name, parent_deliverables: (x.run.deliverables ?? []).map((d) => ({ id: d.id, title: d.title, format: d.format, href: d.href, downloadHref: d.downloadHref, docId: d.docId, libraryItemId: d.libraryItemId })) };
  const child = await x.startWorkflow(workflowId, { inputs, matterId: str(c.matterId) || x.run.matterId || null, wait: bool(c.wait) });
  x.log(`Started "${child.name}" (${child.id})${bool(c.wait) ? ` → ${child.status}` : ""}`);
  return { output: { runId: child.id, workflowId: child.workflowId, name: child.name, status: child.status, href: `/workflows/runs/${child.id}` } };
};

export const INTEL_EXECUTORS: Partial<Record<AnyNodeType, Executor>> = {
  "intel.fetch": intelFetch,
  "intel.extract": intelExtract,
  "intel.index": intelIndex,
  "intel.entities": intelEntitiesStep,
  "intel.analyze": intelAnalyze,
  "intel.verify": intelVerify,
  "intel.publish": intelPublish,
  "review.auto": reviewAuto,
  "data.query": dataQuery,
  "output.file": outputFile,
  "logic.schedule_after": scheduleAfter,
};

export { relativeDate };
