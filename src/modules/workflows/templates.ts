/**
 * Built-in workflow templates: fully configured, runnable playbooks. Pure data
 * (positions are computed by autoLayout at seed time) so the seed, the service
 * and the tests can all import it.
 */
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowNodeType } from "@/lib/types/domain";
import { autoLayout } from "./graph";
import { defaultConfigFor } from "./registry";
import { PEOPLE } from "@/lib/seed/ids";

const P = PEOPLE;

function N(id: string, type: WorkflowNodeType, label: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, label, position: { x: 0, y: 0 }, config: { ...defaultConfigFor(type), ...config } };
}
function E(source: string, target: string, sourceHandle?: string, targetHandle?: string, label?: string): WorkflowEdge {
  return { id: `e_${source}__${target}${sourceHandle ? `__${sourceHandle}` : ""}`, source, target, sourceHandle, targetHandle, label };
}

export interface TemplateDef extends Omit<Workflow, "createdAt" | "updatedAt" | "status" | "isTemplate" | "ownerId"> { }

const T0 = "2026-06-01T09:00:00.000Z";

export const WORKFLOW_TEMPLATE_IDS = {
  ndaIntake: "wf_tpl_nda_intake",
  depoDigest: "wf_tpl_depo_digest",
  docketMonitor: "wf_tpl_docket_monitor",
  clauseWorkbook: "wf_tpl_clause_workbook",
  privilegeLog: "wf_tpl_privilege_log",
  chronology: "wf_tpl_chronology",
  researchMemo: "wf_tpl_research_memo",
  clientStatus: "wf_tpl_client_status",
  matterIntake: "wf_tpl_matter_intake",
  citeCheck: "wf_tpl_cite_check",
  meetConfer: "wf_tpl_meet_confer",
  pagaChecklist: "wf_tpl_paga_checklist",
  regulatoryWatch: "wf_tpl_regulatory_watch",
} as const;

const NO_RESEARCH = { web: false, legal: false, internal: false };
const INTERNAL_ONLY = { web: false, legal: false, internal: true };

const TEMPLATES: TemplateDef[] = [
  // 1 ───────────────────────── NDA intake review ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.ndaIntake,
    name: "NDA intake review",
    description: "Extract parties, term, governing law and key protections from an incoming NDA, score its risk against firm positions, draft an issues memo, file it and route the review to the right person.",
    category: "intake",
    tags: ["NDA", "contracts", "intake", "risk"],
    inputs: [
      { key: "nda_text", label: "NDA (upload or paste)", type: "file", required: true, placeholder: "Drop the .docx / .pdf or paste the agreement text" },
      { key: "matter", label: "Matter", type: "matter", required: true },
      { key: "our_side", label: "Our client is the", type: "select", required: true, options: ["Receiving Party", "Disclosing Party", "Mutual"] },
      { key: "counterparty", label: "Counterparty", type: "text", placeholder: "Bluewater Analytics, Inc." },
    ],
    nodes: [
      N("start", "trigger.manual", "Run with NDA", { note: "Upload the NDA (or paste the text), pick the matter and tell the workflow which side the client is on." }),
      N("extract", "ai.extract", "Extract NDA terms", {
        source: "{{inputs.nda_text}}",
        modelTier: "primary",
        instructions: "Read the entire agreement. If a term is mutual, say so in the value. Convert periods to months. Quote the operative clause in _evidence.",
        fields: [
          { name: "parties", type: "string[]", description: "Full legal names of the parties as written in the preamble" },
          { name: "effective_date", type: "date", description: "Effective date of the agreement" },
          { name: "term_months", type: "number", description: "Term of the agreement in months (0 if indefinite)" },
          { name: "confidentiality_period_months", type: "number", description: "How long confidentiality obligations survive after termination, in months (0 if perpetual)" },
          { name: "governing_law", type: "string", description: "Governing law state or country" },
          { name: "venue", type: "string", description: "Exclusive forum / venue, if any" },
          { name: "purpose", type: "string", description: "Permitted purpose for use of confidential information" },
          { name: "mutual", type: "boolean", description: "True when obligations run both ways" },
          { name: "non_solicit", type: "boolean", description: "True when the NDA contains an employee non-solicitation covenant" },
          { name: "residuals_clause", type: "boolean", description: "True when a residuals clause lets the recipient use retained information" },
          { name: "injunctive_relief", type: "boolean", description: "True when the agreement stipulates to irreparable harm / injunctive relief" },
          { name: "assignment_restriction", type: "string", description: "Assignment / change-of-control restriction, summarized" },
          { name: "standard_carve_outs", type: "string[]", description: "Which standard exclusions are present: public, already known, independently developed, third-party source, compelled disclosure" },
          { name: "unusual_terms", type: "string[]", description: "Any term a senior lawyer would flag as unusual for an NDA (indemnity, liquidated damages, exclusivity, IP assignment, audit rights…)" },
        ],
      }),
      N("classify", "ai.classify", "Score risk", {
        source: "Our client is the {{inputs.our_side}}.\n\nExtracted terms:\n{{steps.extract.output | json}}\n\nAgreement text (excerpt):\n{{inputs.nda_text | truncate:20000}}",
        modelTier: "primary",
        labels: [
          { label: "low", description: "Standard mutual NDA: 2–5 year term, ordinary carve-outs, no non-solicit, no residuals, familiar governing law (DE/NY/CA/IL/SC)" },
          { label: "medium", description: "Negotiable issues: one-way obligations against our client, perpetual confidentiality for non-trade-secret information, non-solicit, unusual venue, broad definition of Confidential Information" },
          { label: "high", description: "Unacceptable as drafted: residuals clause against a disclosing client, IP assignment or license grant, indemnity or liquidated damages, exclusivity or standstill, compelled-disclosure carve-out missing, unlimited term with no return/destroy obligation" },
        ],
        instructions: "Apply Calloway & Reyes standard NDA positions. Weight issues by which side the client is on: a residuals clause is high risk for a disclosing client but low risk for a receiving client.",
      }),
      N("draft", "ai.draft", "Draft issues memo", {
        kind: "memo",
        tone: "formal",
        audience: "partner",
        modelTier: "primary",
        research: INTERNAL_ONLY,
        brief: "Draft an NDA review memo for {{matter.name}} ({{matter.client}}). Our client is the {{inputs.our_side}}{{inputs.counterparty | default:\"\"}}.\n\nRisk classification: {{steps.classify.output.label | upper}} ({{steps.classify.output.confidence}}) — {{steps.classify.output.rationale}}\n\nExtracted terms:\n{{steps.extract.output | json}}\n\nStructure: (1) Bottom line with the recommendation (sign / sign with edits / do not sign); (2) Deal terms table (Term | As drafted | Firm position | Recommended edit); (3) Issues, worst first, each with the clause quote, why it matters for a {{inputs.our_side}}, and proposed replacement language; (4) Items needing client input. Cite the clause numbers from the agreement.",
        context: "Agreement text:\n{{inputs.nda_text | truncate:60000}}",
      }),
      N("save", "action.save_document", "Save memo to matter", { kind: "word", title: "NDA review — {{inputs.counterparty | default:\"counterparty\"}} — {{now | date:short}}", content: "{{steps.draft.output.text}}", matterId: "{{inputs.matter}}", tags: ["NDA", "review", "workflow"] }),
      N("route", "logic.branch", "Route by risk", { rules: [{ id: "high", label: "High risk", logic: "all", conditions: [{ left: "{{steps.classify.output.label}}", op: "equals", right: "high" }] }, { id: "medium", label: "Medium risk", logic: "all", conditions: [{ left: "{{steps.classify.output.label}}", op: "equals", right: "medium" }] }], elseLabel: "Low risk" }),
      N("task_partner", "action.create_task", "Partner review (urgent)", { title: "NDA review: {{inputs.counterparty | default:\"counterparty\"}} — HIGH risk, partner sign-off needed", description: "{{steps.classify.output.rationale}}\n\nMemo: {{steps.save.output.href}}", assigneeId: P.danielOkafor, priority: "urgent", dueRule: "+1bd", matterId: "{{inputs.matter}}", tags: ["NDA", "review"] }),
      N("task_associate", "action.create_task", "Associate markup", { title: "NDA markup: {{inputs.counterparty | default:\"counterparty\"}} ({{steps.classify.output.label}} risk)", description: "Turn the issues memo into a redline. {{steps.classify.output.rationale}}\n\nMemo: {{steps.save.output.href}}", assigneeId: P.samuelChen, priority: "high", dueRule: "+3bd", matterId: "{{inputs.matter}}", tags: ["NDA", "markup"] }),
      N("task_clear", "action.create_task", "Clear for signature", { title: "NDA cleared: {{inputs.counterparty | default:\"counterparty\"}} — confirm and send for signature", description: "Low risk per intake review. Memo: {{steps.save.output.href}}", assigneeId: P.samuelChen, priority: "medium", dueRule: "+5bd", matterId: "{{inputs.matter}}", tags: ["NDA"] }),
      N("notify", "action.notify", "Post to team", { recipientIds: [P.danielOkafor, P.samuelChen], kind: "update", message: "NDA intake review finished for {{inputs.counterparty | default:\"counterparty\"}} on {{matter.shortName}}: **{{steps.classify.output.label | upper}} risk**. {{steps.classify.output.rationale | truncate:300}}\n\nMemo: {{steps.save.output.href}}", matterId: "{{inputs.matter}}" }),
    ],
    edges: [E("start", "extract"), E("extract", "classify"), E("classify", "draft"), E("draft", "save"), E("save", "route"), E("route", "task_partner", "high"), E("route", "task_associate", "medium"), E("route", "task_clear", "else"), E("task_partner", "notify"), E("task_associate", "notify"), E("task_clear", "notify")],
  },

  // 2 ───────────────────────── Deposition digest ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.depoDigest,
    name: "Deposition digest",
    description: "Turn a rough transcript into a page:line digest of key admissions, contradictions and exhibits, save the memo to the matter and tell the team.",
    category: "discovery",
    tags: ["deposition", "transcript", "digest", "MDL"],
    inputs: [
      { key: "transcript_text", label: "Transcript (upload or paste)", type: "file", required: true },
      { key: "witness", label: "Witness", type: "text", required: true, placeholder: "Gregory Hale, Director EHS" },
      { key: "matter", label: "Matter", type: "matter", required: true },
      { key: "focus", label: "Themes to focus on", type: "textarea", placeholder: "2016 EHS memo; TSCA § 8(e) decision; what Hale told Pryce in August 2016" },
    ],
    nodes: [
      N("start", "trigger.manual", "Run with transcript"),
      N("digest", "ai.summarize", "Page:line digest", { source: "{{inputs.transcript_text}}", style: "qa", length: "long", focus: "{{inputs.focus | default:\"admissions, contradictions with documents, evasive answers, exhibits\"}}", modelTier: "primary" }),
      N("extract", "ai.extract", "Pull admissions & exhibits", {
        source: "Witness: {{inputs.witness}}\n\nDigest:\n{{steps.digest.output.text}}\n\nTranscript:\n{{inputs.transcript_text | truncate:90000}}",
        modelTier: "primary",
        instructions: "Every item must carry a page:line cite in the form 142:8–143:2. Contradictions should name the document (Bates) or prior testimony they conflict with.",
        fields: [
          { name: "key_admissions", type: "string[]", description: "Admissions helpful to our client, each with page:line" },
          { name: "harmful_testimony", type: "string[]", description: "Testimony that hurts our client, each with page:line" },
          { name: "contradictions", type: "string[]", description: "Statements that conflict with documents or earlier testimony, with cites on both sides" },
          { name: "exhibits", type: "string[]", description: "Exhibits marked, with Bates numbers where stated" },
          { name: "objections_instructions", type: "string[]", description: "Objections and instructions not to answer with page:line and basis" },
          { name: "follow_up", type: "string[]", description: "Follow-up questions or documents to chase before the next session" },
          { name: "credibility_notes", type: "string[]", description: "Demeanor / credibility observations supported by the record" },
        ],
      }),
      N("memo", "ai.draft", "Draft digest memo", {
        kind: "memo", tone: "neutral", audience: "team", modelTier: "primary", research: NO_RESEARCH,
        brief: "Draft the deposition digest memo for the deposition of {{inputs.witness}} in {{matter.name}}.\n\nSections: Summary (5 bullets); Key admissions; Harmful testimony and how to contain it; Contradictions (table: Testimony | Conflicts with | Significance); Exhibits; Objections and instructions; Follow-up. Keep every page:line cite exactly as given.\n\nStructured findings:\n{{steps.extract.output | json}}",
        context: "Page:line digest:\n{{steps.digest.output.text}}",
      }),
      N("save", "action.save_document", "Save digest", { kind: "word", title: "Deposition digest — {{inputs.witness}} — {{now | date:short}}", content: "{{steps.memo.output.text}}", matterId: "{{inputs.matter}}", tags: ["deposition", "digest"] }),
      N("notify", "action.notify", "Notify case team", { recipientIds: [P.jordanWhitfield, P.priyaRaman, P.elenaMarsh], kind: "update", message: "Deposition digest for **{{inputs.witness}}** is ready on {{matter.shortName}}.\n\nTop admissions:\n{{steps.extract.output.key_admissions | slice:0,3 | bullets}}\n\n{{steps.save.output.href}}", matterId: "{{inputs.matter}}" }),
      N("task", "action.create_task", "Attorney review", { title: "Review deposition digest: {{inputs.witness}}", description: "Check page:line cites against the certified transcript and confirm the contradictions list before it goes into the outline.\n\n{{steps.save.output.href}}", assigneeId: P.elenaMarsh, priority: "high", dueRule: "+3bd", matterId: "{{inputs.matter}}", tags: ["deposition"] }),
    ],
    edges: [E("start", "digest"), E("digest", "extract"), E("extract", "memo"), E("memo", "save"), E("save", "notify"), E("save", "task")],
  },

  // 3 ───────────────────────── Docket monitor ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.docketMonitor,
    name: "Docket monitor",
    description: "Every morning, search PACER/RECAP for new docket activity matching the matter, open a task for each new entry and post a digest to the team.",
    category: "operations",
    tags: ["docket", "PACER", "monitor", "scheduled"],
    inputs: [
      { key: "docket_query", label: "Docket search", type: "text", required: true, placeholder: "Meridian Fluorochem AFFF" },
      { key: "courts", label: "Courts (CourtListener ids)", type: "text", placeholder: "dsc" },
      { key: "matter", label: "Matter", type: "matter", required: true },
    ],
    nodes: [
      N("schedule", "trigger.schedule", "Every morning 07:00", { schedule: { frequency: "daily", time: "07:00" }, enabled: true, presetInputs: { docket_query: "Meridian Fluorochem AFFF", courts: "dsc", matter: "m_afff_2873" } }),
      N("search", "data.legal_search", "New docket activity", { source: "dockets", query: "{{inputs.docket_query}}", courts: "{{inputs.courts}}", after: "-1d", limit: 20 }),
      N("any_new", "logic.branch", "Anything new?", { rules: [{ id: "yes", label: "New entries", logic: "all", conditions: [{ left: "{{steps.search.output.results | length}}", op: "gt", right: "0" }] }], elseLabel: "Nothing new" }),
      N("each", "logic.loop", "For each entry", { over: "{{steps.search.output.results}}", maxIterations: 20, itemLabel: "docket entry", stopOnError: false }),
      N("task", "action.create_task", "Task: review filing", { title: "Docket: {{loop.item.case_name}} — {{loop.item.docket_number}} ({{loop.item.date_filed}})", description: "{{loop.item.court}} · filed {{loop.item.date_filed}}{{loop.item.assigned_to | default:\"\"}}\n{{loop.item.url}}\n\nPull the filing, calendar any response deadline, and note it in the matter chronology.", assigneeId: P.mariaLopez, priority: "high", dueRule: "+1bd", matterId: "{{inputs.matter}}", tags: ["docket"] }),
      N("digest", "action.notify", "Post digest", { recipientIds: [P.jordanWhitfield, P.mariaLopez], kind: "update", message: "Docket monitor: **{{steps.search.output.results | length}}** new item(s) for \"{{inputs.docket_query}}\" since yesterday.\n\n{{steps.search.output.text | truncate:1500}}", matterId: "{{inputs.matter}}" }),
    ],
    edges: [E("schedule", "search"), E("search", "any_new"), E("any_new", "each", "yes"), E("each", "task", "each"), E("task", "each", undefined, "loop-back"), E("each", "digest", "done")],
  },

  // 4 ───────────────────────── Contract clause extraction → workbook ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.clauseWorkbook,
    name: "Contract clause extraction to workbook",
    description: "Extract the commercial and risk terms from a contract into typed fields, turn them into a clause-by-clause review table and save it as a workbook for the diligence tracker.",
    category: "transactional",
    tags: ["diligence", "contracts", "workbook", "M&A"],
    inputs: [
      { key: "contract_text", label: "Contract (upload or paste)", type: "file", required: true },
      { key: "contract_name", label: "Contract name", type: "text", required: true, placeholder: "Aurora Health MSA (2023)" },
      { key: "matter", label: "Matter", type: "matter", required: true },
    ],
    nodes: [
      N("start", "trigger.manual", "Run with contract"),
      N("extract", "ai.extract", "Extract key terms", {
        source: "{{inputs.contract_text}}", modelTier: "primary",
        instructions: "This is buy-side diligence. Read every section including schedules. Quote the section number in _evidence.",
        fields: [
          { name: "parties", type: "string[]", description: "Legal names of the parties" },
          { name: "effective_date", type: "date", description: "Effective date" },
          { name: "initial_term", type: "string", description: "Initial term as written" },
          { name: "auto_renewal", type: "boolean", description: "Whether the agreement auto-renews" },
          { name: "renewal_notice_days", type: "number", description: "Days of notice required to prevent renewal (0 if none)" },
          { name: "termination_for_convenience", type: "string", description: "Who may terminate for convenience and on what notice" },
          { name: "change_of_control", type: "string", description: "Change-of-control / assignment consent requirement, quoted or summarized" },
          { name: "exclusivity", type: "string", description: "Exclusivity, non-compete or most-favored-nation obligations" },
          { name: "limitation_of_liability", type: "string", description: "Cap and exclusions (consequential damages, carve-outs)" },
          { name: "indemnities", type: "string", description: "Indemnity scope, direction and caps" },
          { name: "ip_ownership", type: "string", description: "IP ownership, licenses back, work-product terms" },
          { name: "data_privacy", type: "string", description: "Data protection / security obligations and breach notice periods" },
          { name: "payment_terms", type: "string", description: "Fees, payment timing, price escalators" },
          { name: "governing_law", type: "string", description: "Governing law and forum" },
          { name: "insurance", type: "string", description: "Insurance requirements" },
          { name: "other_flags", type: "string[]", description: "Anything else a buyer must know (minimum commitments, audit rights, set-off, source-code escrow)" },
        ],
      }),
      N("rows", "ai.prompt", "Build review rows", {
        instructions: "You convert extracted contract terms into a diligence review table. Return only JSON matching the schema. One row per clause topic, in the order given. Risk is from the buyer's perspective: Low / Medium / High. 'Location' is the section number(s) quoted in the evidence.",
        prompt: "Contract: {{inputs.contract_name}}\nMatter: {{matter.name}} ({{matter.client}}, {{matter.clientSide}})\n\nExtracted terms with evidence:\n{{steps.extract.output | json}}",
        output: "json", modelTier: "fast", research: NO_RESEARCH,
        jsonSchema: JSON.stringify({ type: "object", properties: { rows: { type: "array", items: { type: "object", properties: { clause: { type: "string" }, as_drafted: { type: "string" }, location: { type: "string" }, risk: { type: "string", enum: ["Low", "Medium", "High"] }, issue: { type: "string" }, recommended_action: { type: "string" } }, required: ["clause", "as_drafted", "location", "risk", "issue", "recommended_action"] } } }, required: ["rows"] }),
      }),
      N("workbook", "action.save_document", "Save review workbook", { kind: "sheet", content: "", title: "Clause review — {{inputs.contract_name}}", rows: "{{steps.rows.output.rows}}", matterId: "{{inputs.matter}}", tags: ["diligence", "clause-review"] }),
      N("export", "action.export", "Export CSV", { format: "csv", filename: "clause-review-{{inputs.contract_name}}", source: "{{steps.rows.output.rows}}", matterId: "{{inputs.matter}}", addToLibrary: true }),
      N("task", "action.create_task", "Add to diligence tracker", { title: "Diligence: fold {{inputs.contract_name}} review into the tracker ({{steps.rows.output.rows | where:risk,High | length}} high-risk items)", description: "Workbook: {{steps.workbook.output.href}}\nCSV: {{steps.export.output.url}}", assigneeId: P.samuelChen, priority: "medium", dueRule: "+2bd", matterId: "{{inputs.matter}}", tags: ["diligence"] }),
    ],
    edges: [E("start", "extract"), E("extract", "rows"), E("rows", "workbook"), E("rows", "export"), E("workbook", "task"), E("export", "task")],
  },

  // 5 ───────────────────────── Privilege log builder ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.privilegeLog,
    name: "Privilege log builder",
    description: "Collect the documents coded privileged for a custodian, draft a privilege-safe description and basis for each, and save the log as a workbook ready for paralegal QC.",
    category: "discovery",
    tags: ["privilege", "log", "e-discovery", "CMO"],
    inputs: [
      { key: "matter", label: "Matter", type: "matter", required: true },
      { key: "custodian", label: "Custodian (optional)", type: "text", placeholder: "Kaine" },
      { key: "limit", label: "Max documents", type: "number", placeholder: "25" },
    ],
    nodes: [
      N("start", "trigger.manual", "Run for custodian"),
      N("search", "data.search_ediscovery", "Privileged documents", { query: "*", matterId: "{{inputs.matter}}", custodian: "{{inputs.custodian}}", privilegedOnly: true, limit: 25 }),
      N("entries", "logic.loop", "For each document", { over: "{{steps.search.output.results}}", maxIterations: 50, itemLabel: "document", stopOnError: false }),
      N("describe", "ai.prompt", "Draft log entry", {
        instructions: "You draft privilege log entries that comply with FRCP 26(b)(5)(A) and the MDL case management order: describe the nature of the document without revealing privileged content, identify the attorney involved and state the basis. Never quote legal advice. Use the pattern 'Email chain reflecting/requesting legal advice of counsel (R. Kaine, AGC) regarding [subject matter category]'. Return JSON only.",
        prompt: "Document:\nBates {{loop.item.bates}} · {{loop.item.date}} · {{loop.item.type}}\nFrom: {{loop.item.from}}\nTo: {{loop.item.to | join:\"; \"}}\nSubject: {{loop.item.subject}}\nCustodian: {{loop.item.custodian}}\nCurrent coding: {{loop.item.coding | json:compact}}\n\nPassage:\n{{loop.item.passage}}",
        output: "json", modelTier: "fast", research: NO_RESEARCH,
        jsonSchema: JSON.stringify({ type: "object", properties: { bates: { type: "string" }, date: { type: "string" }, doc_type: { type: "string" }, author: { type: "string" }, recipients: { type: "string" }, attorney: { type: "string" }, privilege_type: { type: "string", enum: ["Attorney-Client", "Work Product", "Attorney-Client; Work Product", "Common Interest"] }, description: { type: "string" }, basis: { type: "string" }, withheld: { type: "string", enum: ["Withheld in full", "Redacted"] } }, required: ["bates", "date", "doc_type", "author", "recipients", "attorney", "privilege_type", "description", "basis", "withheld"] }),
      }),
      N("log", "action.save_document", "Save privilege log", { kind: "sheet", content: "", title: "Privilege log — {{inputs.custodian | default:\"all custodians\"}} — {{now | date:short}}", rows: "{{steps.entries.output.results | pluck:steps.describe}}", matterId: "{{inputs.matter}}", tags: ["privilege-log"] }),
      N("qc", "action.create_task", "Paralegal QC", { title: "QC privilege log ({{steps.entries.output.count}} entries) — {{inputs.custodian | default:\"all custodians\"}}", description: "Check every description is privilege-safe and consistent with the CMO 26 Ex. B format; confirm attorney names and dates.\n\n{{steps.log.output.href}}", assigneeId: P.mariaLopez, priority: "high", dueRule: "+2bd", matterId: "{{inputs.matter}}", tags: ["privilege"] }),
    ],
    edges: [E("start", "search"), E("search", "entries"), E("entries", "describe", "each"), E("describe", "entries", undefined, "loop-back"), E("entries", "log", "done"), E("log", "qc")],
  },

  // 6 ───────────────────────── Chronology from documents ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.chronology,
    name: "Chronology from documents",
    description: "Search the review set on a topic, extract dated events with Bates cites, and draft a chronology memo with gaps and open questions.",
    category: "discovery",
    tags: ["chronology", "timeline", "e-discovery"],
    inputs: [
      { key: "matter", label: "Matter", type: "matter", required: true },
      { key: "topic", label: "Topic", type: "text", required: true, placeholder: "TSCA § 8(e) substantial risk decision 2016" },
      { key: "date_after", label: "Documents after", type: "date" },
      { key: "date_before", label: "Documents before", type: "date" },
    ],
    nodes: [
      N("start", "trigger.manual", "Run on topic"),
      N("search", "data.search_ediscovery", "Find documents", { query: "{{inputs.topic}}", matterId: "{{inputs.matter}}", dateAfter: "{{inputs.date_after}}", dateBefore: "{{inputs.date_before}}", limit: 25 }),
      N("events", "ai.prompt", "Extract dated events", {
        instructions: "You build litigation chronologies. From the document excerpts, list every dated event (meetings, decisions, reports, communications). One event per row; date in YYYY-MM-DD (use YYYY-MM or YYYY when that is all the source gives); cite the Bates number; significance 1–5 (5 = case-dispositive). Never infer a date that is not in the text. Return JSON only.",
        prompt: "Topic: {{inputs.topic}}\nMatter: {{matter.name}}\n\nDocuments:\n{{steps.search.output.text}}",
        output: "json", modelTier: "primary", research: NO_RESEARCH,
        jsonSchema: JSON.stringify({ type: "object", properties: { events: { type: "array", items: { type: "object", properties: { date: { type: "string" }, event: { type: "string" }, actors: { type: "string" }, source: { type: "string" }, significance: { type: "integer" }, category: { type: "string", enum: ["corporate", "scientific", "regulatory", "communication", "litigation", "product", "other"] } }, required: ["date", "event", "actors", "source", "significance", "category"] } }, gaps: { type: "array", items: { type: "string" } } }, required: ["events", "gaps"] }),
      }),
      N("memo", "ai.draft", "Draft chronology memo", {
        kind: "chronology", tone: "neutral", audience: "team", modelTier: "primary", research: NO_RESEARCH,
        brief: "Prepare the chronology memo for \"{{inputs.topic}}\" in {{matter.name}}. Sort by date. After the table add: Key inflection points (3–5 bullets), Gaps in the record, Documents to collect next.\n\nEvents:\n{{steps.events.output.events | table:date,event,actors,source,significance}}\n\nGaps noted during extraction:\n{{steps.events.output.gaps | bullets}}",
      }),
      N("save", "action.save_document", "Save chronology", { kind: "word", title: "Chronology — {{inputs.topic}} — {{now | date:short}}", content: "{{steps.memo.output.text}}", matterId: "{{inputs.matter}}", tags: ["chronology"] }),
      N("task", "action.create_task", "Verify and merge into timeline", { title: "Chronology: verify {{steps.events.output.events | length}} events for \"{{inputs.topic}}\" and merge into the matter timeline", description: "Gaps flagged:\n{{steps.events.output.gaps | bullets}}\n\n{{steps.save.output.href}}", assigneeId: P.elenaMarsh, priority: "medium", dueRule: "+5bd", matterId: "{{inputs.matter}}", tags: ["chronology"] }),
    ],
    edges: [E("start", "search"), E("search", "events"), E("events", "memo"), E("memo", "save"), E("save", "task")],
  },

  // 7 ───────────────────────── Research memo ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.researchMemo,
    name: "Research memo with partner approval",
    description: "Run agentic legal research on a question, save the memo, pause for partner approval, then open the follow-up task (or a revision task with the partner's comments).",
    category: "research",
    tags: ["research", "memo", "approval", "case law"],
    inputs: [
      { key: "question", label: "Research question", type: "textarea", required: true, placeholder: "Under Illinois law, does a consequential-damages waiver bar lost-profit claims where the breach was willful?" },
      { key: "jurisdiction", label: "Jurisdiction", type: "select", options: ["Any", "7th-circuit", "4th-circuit", "9th-circuit", "11th-circuit", "california-state", "new-york-state", "delaware", "illinois-state", "federal-appellate", "scotus"] },
      { key: "matter", label: "Matter", type: "matter", required: true },
    ],
    nodes: [
      N("start", "trigger.manual", "Run with question"),
      N("research", "ai.research", "Research the question", { question: "{{inputs.question}}\n\nContext: {{matter.name}} — {{matter.description | truncate:600}}", jurisdiction: "{{inputs.jurisdiction | replace:Any,}}", depth: "deep", sources: { web: true, legal: true, internal: true }, instructions: "Verify every citation you rely on by reading the opinion. Distinguish binding from persuasive authority for this forum." }),
      N("save", "action.save_document", "Save memo", { kind: "word", title: "Research memo — {{inputs.question | truncate:60}}", content: "{{steps.research.output.text}}", matterId: "{{inputs.matter}}", tags: ["research", "memo"] }),
      N("approval", "logic.approval", "Partner review", { approverId: P.jordanWhitfield, title: "Approve research memo", message: "A research memo is ready for {{matter.shortName}}.\n\n**Question:** {{inputs.question}}\n\n**Bottom line (excerpt):**\n{{steps.research.output.text | truncate:1800}}\n\nFull memo: {{steps.save.output.href}}\n\nApprove to circulate, or reject with comments to send it back for revision.", timeoutHours: 48 }),
      N("task_circulate", "action.create_task", "Circulate memo", { title: "Circulate approved research memo: {{inputs.question | truncate:70}}", description: "Approved by {{steps.approval.output.decidedByName}}{{steps.approval.output.comment | default:\"\"}}.\n{{steps.save.output.href}}", assigneeId: P.elenaMarsh, priority: "medium", dueRule: "+2bd", matterId: "{{inputs.matter}}", tags: ["research"] }),
      N("task_revise", "action.create_task", "Revise memo", { title: "Revise research memo per partner comments: {{inputs.question | truncate:60}}", description: "Comments from {{steps.approval.output.decidedByName}}:\n{{steps.approval.output.comment}}\n\n{{steps.save.output.href}}", assigneeId: P.elenaMarsh, priority: "high", dueRule: "+2bd", matterId: "{{inputs.matter}}", tags: ["research", "revision"] }),
    ],
    edges: [E("start", "research"), E("research", "save"), E("save", "approval"), E("approval", "task_circulate", "approved"), E("approval", "task_revise", "rejected")],
  },

  // 8 ───────────────────────── Client status report ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.clientStatus,
    name: "Client status report",
    description: "Assemble the matter's open tasks, upcoming deadlines, recent team updates and key dates into a client-ready status report, route it for approval and queue the send.",
    category: "operations",
    tags: ["client", "reporting", "status", "approval"],
    inputs: [
      { key: "matter", label: "Matter", type: "matter", required: true },
      { key: "period", label: "Reporting period", type: "select", required: true, options: ["Weekly", "Biweekly", "Monthly"] },
      { key: "highlights", label: "Highlights to include", type: "textarea", placeholder: "Tier 2 production on track; Hale Vol. II completed; expert rebuttal drafts due Nov 6" },
    ],
    nodes: [
      N("start", "trigger.manual", "Run for matter"),
      N("draft", "ai.draft", "Draft status report", {
        kind: "report", tone: "plain", audience: "client", modelTier: "primary", research: INTERNAL_ONLY,
        brief: "Draft the {{inputs.period | lower}} status report for {{matter.client}} on {{matter.name}} ({{matter.caption | default:matter.shortName}}). Stage: {{matter.stage}}.\n\nHighlights from the team: {{inputs.highlights | default:\"none provided\"}}\n\nKey dates:\n{{matter.keyDates | table:label,date}}\n\nUpcoming events:\n{{matter.upcomingEvents | table:startsAt,title,kind,ruleSource}}\n\nOpen tasks (internal — summarize, do not list verbatim):\n{{matter.openTasks | table:title,status,priority,dueAt}}\n\nRecent internal updates:\n{{matter.recentUpdates | table:createdAt,author,body}}\n\nWrite for a general counsel: no internal task names, no privileged strategy detail, clear 'Decisions needed from you' section, and a 30-day look-ahead.",
      }),
      N("save", "action.save_document", "Save report", { kind: "word", title: "{{inputs.period}} status report — {{matter.shortName}} — {{now | date:short}}", content: "{{steps.draft.output.text}}", matterId: "{{inputs.matter}}", tags: ["client-report"] }),
      N("approval", "logic.approval", "Lead attorney approval", { approverId: P.jordanWhitfield, title: "Approve client status report", message: "{{inputs.period}} status report for {{matter.client}} ({{matter.shortName}}) is ready.\n\n{{steps.draft.output.text | truncate:2000}}\n\nFull report: {{steps.save.output.href}}", timeoutHours: 24 }),
      N("send", "action.create_task", "Send to client", { title: "Send {{inputs.period | lower}} status report to {{matter.client}}", description: "Approved by {{steps.approval.output.decidedByName}}. {{steps.save.output.href}}", assigneeId: P.mariaLopez, priority: "medium", dueRule: "+1bd", matterId: "{{inputs.matter}}", tags: ["client"] }),
      N("post", "action.notify", "Post to team", { recipientIds: [P.jordanWhitfield, P.priyaRaman], kind: "update", message: "{{inputs.period}} client status report for {{matter.shortName}} approved and queued for sending. {{steps.save.output.href}}", matterId: "{{inputs.matter}}" }),
      N("revise", "action.create_task", "Revise report", { title: "Revise {{inputs.period | lower}} status report for {{matter.client}}", description: "Comments: {{steps.approval.output.comment}}\n{{steps.save.output.href}}", assigneeId: P.elenaMarsh, priority: "high", dueRule: "+1bd", matterId: "{{inputs.matter}}", tags: ["client"] }),
    ],
    edges: [E("start", "draft"), E("draft", "save"), E("save", "approval"), E("approval", "send", "approved"), E("approval", "post", "approved"), E("approval", "revise", "rejected")],
  },

  // 9 ───────────────────────── New matter intake ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.matterIntake,
    name: "New matter intake",
    description: "Run a conflicts search across the firm library and knowledge base, classify the result, and either open the file (engagement letter, intake meeting, opening tasks) or escalate a potential conflict.",
    category: "intake",
    tags: ["intake", "conflicts", "engagement", "onboarding"],
    inputs: [
      { key: "client_name", label: "Client", type: "text", required: true, placeholder: "Harborline Technologies, Inc." },
      { key: "adverse_parties", label: "Adverse / related parties", type: "textarea", required: true, placeholder: "Bluewater Analytics, Inc.; Snowfield Reseller LLC; Aurora Health" },
      { key: "matter_name", label: "Matter name", type: "text", required: true },
      { key: "practice_area", label: "Practice area", type: "select", required: true, options: ["Litigation", "Products Liability", "Commercial", "Corporate / M&A", "Employment", "Regulatory", "IP", "Real Estate"] },
      { key: "summary", label: "Matter summary", type: "textarea", required: true },
    ],
    nodes: [
      N("start", "trigger.manual", "Run intake"),
      N("conflicts", "data.search_library", "Conflicts search", { query: "{{inputs.client_name}} {{inputs.adverse_parties}}", limit: 15, includeContent: false }),
      N("assess", "ai.classify", "Assess conflicts", {
        source: "Prospective client: {{inputs.client_name}}\nAdverse / related parties: {{inputs.adverse_parties}}\nMatter: {{inputs.matter_name}} ({{inputs.practice_area}})\nSummary: {{inputs.summary}}\n\nFirm records matching those names ({{steps.conflicts.output.count}} hits):\n{{steps.conflicts.output.text | truncate:12000}}",
        modelTier: "primary",
        labels: [
          { label: "clear", description: "No firm record involves the client or adverse parties in a related capacity" },
          { label: "potential", description: "A record mentions one of the parties (e.g., as a counterparty, witness or former client) and needs partner review under Rule 1.7/1.9" },
          { label: "conflict", description: "The firm currently represents an adverse party or holds confidential information from a former client on a substantially related matter" },
        ],
        instructions: "Apply ABA Model Rules 1.7, 1.9 and 1.10. Treat any hit that is not clearly the same entity as 'potential', not 'clear'.",
      }),
      N("route", "logic.branch", "Conflict?", { rules: [{ id: "escalate", label: "Potential or actual conflict", logic: "any", conditions: [{ left: "{{steps.assess.output.label}}", op: "equals", right: "conflict" }, { left: "{{steps.assess.output.label}}", op: "equals", right: "potential" }] }], elseLabel: "Clear" }),
      N("escalate", "action.create_task", "Escalate to GC", { title: "Conflicts: {{steps.assess.output.label | upper}} for {{inputs.client_name}} — {{inputs.matter_name}}", description: "{{steps.assess.output.rationale}}\n\nMatching records:\n{{steps.conflicts.output.results | pluck:name | bullets}}", assigneeId: P.jordanWhitfield, priority: "urgent", dueRule: "+1bd", tags: ["conflicts", "intake"] }),
      N("engagement", "action.create_task", "Engagement letter", { title: "Engagement letter: {{inputs.client_name}} — {{inputs.matter_name}}", description: "Conflicts clear ({{steps.assess.output.confidence}}). Use the {{inputs.practice_area}} engagement template; confirm billing arrangement and scope: {{inputs.summary | truncate:400}}", assigneeId: P.aishaKhan, priority: "high", dueRule: "+2bd", tags: ["intake", "engagement"] }),
      N("open_file", "action.create_task", "Open matter file", { title: "Open file and folders: {{inputs.matter_name}}", description: "Create the matter in the system, library folder structure, and billing number. Practice area: {{inputs.practice_area}}.", assigneeId: P.aishaKhan, priority: "medium", dueRule: "+2bd", tags: ["intake"] }),
      N("kickoff", "action.create_event", "Intake meeting", { title: "Intake meeting — {{inputs.client_name}} ({{inputs.matter_name}})", kind: "meeting", startsAt: "+3bd 10:00", durationMinutes: 60, location: "Conference Room 2A / Teams", notes: "{{inputs.summary}}", attendeeIds: [P.jordanWhitfield, P.danielOkafor] }),
      N("notify", "action.notify", "Announce new matter", { recipientIds: [P.jordanWhitfield, P.danielOkafor, P.aishaKhan], kind: "announcement", message: "New matter cleared conflicts: **{{inputs.matter_name}}** for {{inputs.client_name}} ({{inputs.practice_area}}). Intake meeting {{steps.kickoff.output.startsAt | date:datetime}}." }),
    ],
    edges: [E("start", "conflicts"), E("conflicts", "assess"), E("assess", "route"), E("route", "escalate", "escalate"), E("route", "engagement", "else"), E("route", "open_file", "else"), E("route", "kickoff", "else"), E("engagement", "notify"), E("open_file", "notify"), E("kickoff", "notify")],
  },

  // 10 ───────────────────────── Cite-check a brief ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.citeCheck,
    name: "Cite-check a brief",
    description: "Resolve every citation in a brief against CourtListener, write a cite-check report with the unresolved and suspicious cites, and open a fix-it task when anything fails.",
    category: "drafting",
    tags: ["cite-check", "brief", "citations", "quality"],
    inputs: [
      { key: "brief_text", label: "Brief (upload or paste)", type: "file", required: true },
      { key: "brief_name", label: "Brief", type: "text", required: true, placeholder: "MSJ opposition v3" },
      { key: "matter", label: "Matter", type: "matter", required: true },
    ],
    nodes: [
      N("start", "trigger.manual", "Run with brief"),
      N("verify", "data.legal_search", "Verify citations", { source: "verify_citations", text: "{{inputs.brief_text}}" }),
      N("report", "ai.prompt", "Write cite-check report", {
        instructions: "You are a cite-checker. Using the verification results, produce a Markdown report: (1) Summary counts; (2) Table: Citation | Status | Resolved case name | Issue | Suggested fix; (3) Citations that resolved but whose case name does not match how the brief describes the case (possible wrong cite or wrong proposition); (4) Bluebook form issues you can see in the brief (missing pin cites, wrong reporter abbreviations, missing court/year parentheticals). Do not invent corrections; propose where to look.",
        prompt: "Brief: {{inputs.brief_name}} ({{matter.name}})\n\nVerification results:\n{{steps.verify.output.text}}\n\nRaw results:\n{{steps.verify.output.results | json}}\n\nBrief text:\n{{inputs.brief_text | truncate:80000}}",
        output: "text", modelTier: "primary", research: NO_RESEARCH,
      }),
      N("save", "action.save_document", "Save report", { kind: "word", title: "Cite-check — {{inputs.brief_name}} — {{now | date:short}}", content: "{{steps.report.output.text}}", matterId: "{{inputs.matter}}", tags: ["cite-check"] }),
      N("any_bad", "logic.branch", "Unresolved cites?", { rules: [{ id: "bad", label: "Unresolved", logic: "all", conditions: [{ left: "{{steps.verify.output.unresolvedCount}}", op: "gt", right: "0" }] }], elseLabel: "All resolved" }),
      N("fix", "action.create_task", "Fix citations", { title: "Fix {{steps.verify.output.unresolvedCount}} unresolved citation(s) in {{inputs.brief_name}}", description: "{{steps.verify.output.unresolved | pluck:citation | bullets}}\n\nReport: {{steps.save.output.href}}", assigneeId: P.elenaMarsh, priority: "urgent", dueRule: "+1bd", matterId: "{{inputs.matter}}", tags: ["cite-check"] }),
      N("clean", "action.notify", "All clear", { recipientIds: [P.danielOkafor, P.elenaMarsh], kind: "update", message: "Cite-check of **{{inputs.brief_name}}**: all {{steps.verify.output.total}} citations resolved. Report: {{steps.save.output.href}}", matterId: "{{inputs.matter}}" }),
    ],
    edges: [E("start", "verify"), E("verify", "report"), E("report", "save"), E("save", "any_bad"), E("any_bad", "fix", "bad"), E("any_bad", "clean", "else")],
  },

  // 11 ───────────────────────── Meet-and-confer letter ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.meetConfer,
    name: "Meet-and-confer letter",
    description: "Pull the firm's meet-and-confer precedents and clause bank, draft the letter with the dispute facts and requested relief, file it and calendar the response deadline.",
    category: "drafting",
    tags: ["discovery", "letter", "meet-and-confer", "Rule 37"],
    inputs: [
      { key: "matter", label: "Matter", type: "matter", required: true },
      { key: "opposing_counsel", label: "Addressee", type: "text", required: true, placeholder: "Rebecca Klein, Klein & Associates" },
      { key: "dispute", label: "Dispute summary", type: "textarea", required: true, placeholder: "PEC's Sept 12 deficiency letter demands custodial date ranges from January 2012; CMO 26 fixed 2014 for Hale/Voss…" },
      { key: "relief", label: "What we are asking for", type: "textarea", required: true },
      { key: "response_deadline", label: "Response deadline", type: "date", required: true },
    ],
    nodes: [
      N("start", "trigger.manual", "Run with dispute"),
      N("precedents", "data.search_library", "Find precedents", { query: "meet and confer letter discovery deficiency {{inputs.dispute | truncate:120}}", limit: 6, includeContent: true }),
      N("draft", "ai.draft", "Draft letter", {
        kind: "letter", tone: "persuasive", audience: "opposing", modelTier: "primary", research: INTERNAL_ONLY,
        brief: "Draft a meet-and-confer letter in {{matter.name}} ({{matter.caption}}) to {{inputs.opposing_counsel}} from Jordan Whitfield.\n\nDispute: {{inputs.dispute}}\n\nRequested relief: {{inputs.relief}}\n\nRequest a written response by {{inputs.response_deadline | date:long}} and reserve the right to seek relief under FRCP 37(a)(1) and Local Civ. Rule 7.02 (D.S.C.) if applicable to this court. Keep the tone firm and courteous; recite the prior conferrals with dates; cite the case management orders by number.",
        context: "Firm precedents and clauses:\n{{steps.precedents.output.text | truncate:20000}}",
      }),
      N("save", "action.save_document", "Save letter", { kind: "word", title: "Meet-and-confer letter — {{inputs.opposing_counsel | truncate:40}} — {{now | date:short}}", content: "{{steps.draft.output.text}}", matterId: "{{inputs.matter}}", tags: ["meet-and-confer", "letter"] }),
      N("deadline", "action.create_event", "Calendar response deadline", { title: "Meet-and-confer response due — {{inputs.opposing_counsel | truncate:40}}", kind: "deadline", startsAt: "{{inputs.response_deadline}} 17:00", durationMinutes: 0, notes: "{{inputs.dispute | truncate:500}}", ruleSource: "FRCP 37(a)(1); Local Civ. Rule 7.02", attendeeIds: [P.jordanWhitfield, P.mariaLopez], matterId: "{{inputs.matter}}" }),
      N("send", "action.create_task", "Finalize and send", { title: "Finalize and send meet-and-confer letter to {{inputs.opposing_counsel | truncate:40}}", description: "Response requested by {{inputs.response_deadline | date:long}}.\n{{steps.save.output.href}}", assigneeId: P.jordanWhitfield, priority: "high", dueRule: "+1bd", matterId: "{{inputs.matter}}", tags: ["meet-and-confer"] }),
    ],
    edges: [E("start", "precedents"), E("precedents", "draft"), E("draft", "save"), E("save", "deadline"), E("save", "send")],
  },

  // 12 ───────────────────────── PAGA notice response checklist ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.pagaChecklist,
    name: "PAGA notice response checklist",
    description: "Parse an LWDA / PAGA notice, break the allegations into cure-eligible work items with deadlines, open the tasks, calendar the cure window and draft the response checklist.",
    category: "compliance",
    tags: ["PAGA", "employment", "California", "cure", "checklist"],
    inputs: [
      { key: "notice_text", label: "PAGA notice (upload or paste)", type: "file", required: true },
      { key: "matter", label: "Matter", type: "matter", required: true },
      { key: "employer", label: "Employer", type: "text", required: true, placeholder: "Sterling Medical Group, P.C." },
    ],
    nodes: [
      N("start", "trigger.manual", "Run with notice"),
      N("extract", "ai.extract", "Parse the notice", {
        source: "{{inputs.notice_text}}", modelTier: "primary",
        instructions: "This is a PAGA notice under Cal. Lab. Code § 2699.3. Capture every Labor Code section alleged and the factual theory for each.",
        fields: [
          { name: "notice_date", type: "date", description: "Date the notice was submitted to the LWDA / served" },
          { name: "lwda_case_number", type: "string", description: "LWDA case number if stated" },
          { name: "claimant", type: "string", description: "Named aggrieved employee(s) and counsel" },
          { name: "employer_named", type: "string", description: "Employer entity as named" },
          { name: "alleged_violations", type: "string[]", description: "Each alleged Labor Code / Wage Order violation with section number and one-line theory" },
          { name: "period", type: "string", description: "Time period covered" },
          { name: "employee_group", type: "string", description: "Description of the aggrieved employees / positions / locations" },
          { name: "cure_eligible_sections", type: "string[]", description: "Sections that appear curable under § 2699.3(c) or the 2024 amendments (e.g., wage statement, meal/rest premium payment)" },
        ],
      }),
      N("plan", "ai.prompt", "Build work items", {
        instructions: "You are a California wage-and-hour defense specialist. Convert the alleged violations into a response plan under the post-AB 2288 / SB 92 framework. For each allegation give: the section; the defense/cure action; whether it is curable and the statutory window; a due rule relative to today like '+10bd' (cure decision before the 33-day LWDA window closes; early evaluation conference request within the timeline; payroll data pull first); the owner role (partner / associate / paralegal / client HR). Return JSON only.",
        prompt: "Employer: {{inputs.employer}} · Matter: {{matter.name}}\nNotice date: {{steps.extract.output.notice_date}} · LWDA no. {{steps.extract.output.lwda_case_number}}\n\nParsed notice:\n{{steps.extract.output | json}}",
        output: "json", modelTier: "primary", research: NO_RESEARCH,
        jsonSchema: JSON.stringify({ type: "object", properties: { items: { type: "array", items: { type: "object", properties: { section: { type: "string" }, allegation: { type: "string" }, action: { type: "string" }, curable: { type: "boolean" }, cure_window: { type: "string" }, due_rule: { type: "string" }, owner_role: { type: "string", enum: ["partner", "associate", "paralegal", "client HR"] }, priority: { type: "string", enum: ["low", "medium", "high", "urgent"] } }, required: ["section", "allegation", "action", "curable", "cure_window", "due_rule", "owner_role", "priority"] } }, strategy_note: { type: "string" } }, required: ["items", "strategy_note"] }),
      }),
      N("each", "logic.loop", "For each allegation", { over: "{{steps.plan.output.items}}", maxIterations: 25, itemLabel: "allegation" }),
      N("task", "action.create_task", "Open work item", { title: "PAGA {{loop.item.section}}: {{loop.item.action | truncate:90}}", description: "Allegation: {{loop.item.allegation}}\nCurable: {{loop.item.curable}} ({{loop.item.cure_window}})\nOwner: {{loop.item.owner_role}}", assigneeId: P.samuelChen, priority: "{{loop.item.priority}}", dueRule: "{{loop.item.due_rule}}", matterId: "{{inputs.matter}}", tags: ["PAGA", "cure"] }),
      N("cure_deadline", "action.create_event", "Calendar LWDA window", { title: "PAGA: LWDA 33-day cure / response window closes — {{inputs.employer}}", kind: "deadline", startsAt: "{{steps.extract.output.notice_date | add_days:33}} 17:00", durationMinutes: 0, ruleSource: "Cal. Lab. Code § 2699.3(c)", notes: "Notice date {{steps.extract.output.notice_date}}; LWDA no. {{steps.extract.output.lwda_case_number}}", attendeeIds: [P.samuelChen, P.jordanWhitfield], matterId: "{{inputs.matter}}" }),
      N("checklist", "ai.draft", "Draft response checklist", {
        kind: "checklist", tone: "plain", audience: "team", modelTier: "fast", research: NO_RESEARCH,
        brief: "Write the PAGA notice response checklist for {{inputs.employer}} ({{matter.name}}). Group by phase: (1) Immediate (litigation hold, payroll and timekeeping data pull, insurance notice); (2) Evaluation (exposure model, cure eligibility per section, early evaluation conference decision); (3) Cure and response (cure notice content, LWDA submission, employee communications); (4) Calendar. Include the strategy note.\n\nWork items:\n{{steps.plan.output.items | table:section,action,curable,cure_window,due_rule,owner_role}}\n\nStrategy note: {{steps.plan.output.strategy_note}}",
      }),
      N("save", "action.save_document", "Save checklist", { kind: "word", title: "PAGA response checklist — {{inputs.employer}} — {{now | date:short}}", content: "{{steps.checklist.output.text}}", matterId: "{{inputs.matter}}", tags: ["PAGA", "checklist"] }),
      N("notify", "action.notify", "Notify team", { recipientIds: [P.samuelChen, P.jordanWhitfield], kind: "update", message: "PAGA notice parsed for **{{inputs.employer}}**: {{steps.plan.output.items | length}} work items opened; LWDA window calendared for {{steps.cure_deadline.output.startsAt | date:long}}.\n\nChecklist: {{steps.save.output.href}}", matterId: "{{inputs.matter}}" }),
    ],
    edges: [E("start", "extract"), E("extract", "plan"), E("plan", "each"), E("each", "task", "each"), E("task", "each", undefined, "loop-back"), E("each", "cure_deadline", "done"), E("each", "checklist", "done"), E("checklist", "save"), E("cure_deadline", "notify"), E("save", "notify")],
  },

  // 13 ───────────────────────── Regulatory watch ─────────────────────────
  {
    id: WORKFLOW_TEMPLATE_IDS.regulatoryWatch,
    name: "Regulatory watch (Federal Register)",
    description: "Every Monday, search the Federal Register for the past week on a topic and agency, summarize what changed and why it matters for the matter, and post a team update.",
    category: "compliance",
    tags: ["regulatory", "Federal Register", "PFAS", "scheduled"],
    inputs: [
      { key: "topic", label: "Topic", type: "text", required: true, placeholder: "PFAS OR PFOA OR PFOS" },
      { key: "agency", label: "Agency slug", type: "text", placeholder: "environmental-protection-agency" },
      { key: "matter", label: "Matter", type: "matter", required: true },
    ],
    nodes: [
      N("schedule", "trigger.schedule", "Weekly, Monday 06:30", { schedule: { frequency: "weekly", time: "06:30", weekday: 1 }, enabled: true, presetInputs: { topic: "PFAS OR PFOA OR PFOS", agency: "environmental-protection-agency", matter: "m_afff_2873" } }),
      N("fr", "data.legal_search", "Federal Register, last 7 days", { source: "federal_register", query: "{{inputs.topic}}", agency: "{{inputs.agency}}", after: "-7d", limit: 20 }),
      N("any", "logic.branch", "Anything published?", { rules: [{ id: "yes", label: "New documents", logic: "all", conditions: [{ left: "{{steps.fr.output.results | length}}", op: "gt", right: "0" }] }], elseLabel: "Quiet week" }),
      N("summary", "ai.summarize", "Summarize for the matter", { source: "Matter: {{matter.name}} — {{matter.description}}\n\nFederal Register documents this week:\n{{steps.fr.output.text}}", style: "executive", length: "medium", focus: "what changed, comment deadlines, effective dates, and consequences for {{matter.client}}", modelTier: "primary" }),
      N("post", "action.notify", "Post regulatory update", { recipientIds: [P.jordanWhitfield, P.priyaRaman, P.aishaKhan], kind: "announcement", message: "**Regulatory watch — {{inputs.topic}} ({{now | date:short}})**\n\n{{steps.summary.output.text | truncate:2500}}", matterId: "{{inputs.matter}}" }),
      N("file", "action.export", "File the digest", { format: "markdown", filename: "regulatory-watch-{{inputs.topic | truncate:20}}-{{now | date:date}}", source: "# Regulatory watch — {{inputs.topic}} — {{now | date:long}}\n\n{{steps.summary.output.text}}\n\n## Documents\n\n{{steps.fr.output.text}}", matterId: "{{inputs.matter}}", addToLibrary: true }),
      N("quiet", "action.notify", "Quiet week", { recipientIds: [P.aishaKhan], kind: "update", message: "Regulatory watch — {{inputs.topic}}: no Federal Register documents in the last 7 days.", matterId: "{{inputs.matter}}" }),
    ],
    edges: [E("schedule", "fr"), E("fr", "any"), E("any", "summary", "yes"), E("summary", "post"), E("summary", "file"), E("any", "quiet", "else")],
  },
];

/** Templates with positions computed by the layered layout. */
export function buildTemplates(): Workflow[] {
  return TEMPLATES.map((t) => ({
    ...t,
    nodes: autoLayout(t.nodes, t.edges),
    status: "active",
    isTemplate: true,
    ownerId: undefined,
    createdAt: T0,
    updatedAt: T0,
    runsCount: 0,
  }));
}

export function templateById(id: string): Workflow | undefined {
  return buildTemplates().find((t) => t.id === id);
}
