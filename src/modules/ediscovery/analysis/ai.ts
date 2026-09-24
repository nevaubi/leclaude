import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { generateJSON, generateText } from "@/lib/ai/agent";
import { aiConfig, AIConfigError } from "@/lib/ai/config";
import { hybridSearch } from "@/lib/ai/vector-store";
import { VECTOR_COLLECTIONS } from "@/lib/ai/toolkit/internal";
import { FIRM_NAME, LEGAL_STYLE_RULES, todayLine } from "@/lib/ai/prompts";
import type { Conflict, Deposition, EDocument, TimelineEvent } from "@/lib/types/domain";
import type { FactMatrix, KnowledgeMap } from "./types";
import { formatPageLine } from "./types";
import { transcriptText } from "./transcript";
import { createConflict, crossAnalysis, exhibitDocuments, getDeposition, listEvents, mergeEvents, saveFactMatrix, saveKnowledgeMap, setDigest } from "./service";
import { resolvePersonName } from "./graph";

export { AIConfigError };

function requireKey() {
  if (!aiConfig().hasKey) throw new AIConfigError();
}

function clip(text: string, n: number) {
  return text.length > n ? text.slice(0, n) + "\n…[truncated]" : text;
}

function matterLine(matterId: string) {
  const m = db().matters.get(matterId);
  return m ? `${m.name} (${m.caption ?? ""}); the firm represents ${m.client} (${m.clientSide}).` : "a litigation matter.";
}

function docBlock(d: EDocument, max = 3500) {
  return `[${d.bates}${d.batesEnd ? `–${d.batesEnd}` : ""}] ${d.date} · ${d.type} · ${d.custodianName}${d.from ? ` · From: ${d.from}` : ""}${d.to?.length ? ` · To: ${d.to.join("; ")}` : ""}\nSubject: ${d.subject}\n${clip(d.text.replace(/\f/g, "\n"), max)}`;
}

// ---------------------------------------------------------------------------
// Deposition digest
// ---------------------------------------------------------------------------

const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "6–10 sentence narrative digest of the testimony for the trial team. Reference page:line." },
    keyAdmissions: { type: "array", items: { type: "object", properties: { cite: { type: "string", description: "page:line, e.g. 24:05" }, text: { type: "string", description: "The admission in one or two sentences, quoting where possible." } }, required: ["cite", "text"] } },
    themes: { type: "array", items: { type: "string" }, description: "4–8 short theme labels the examiner pursued." },
    credibilityNotes: { type: "array", items: { type: "string" }, description: "Observations on consistency, evasiveness, corrections, and demeanour inferred from the record, each with a cite." },
    followUps: { type: "array", items: { type: "string" }, description: "Questions to ask this witness at a further volume or to put to other witnesses, each tied to a page:line or Bates." },
  },
  required: ["summary", "keyAdmissions", "themes", "credibilityNotes", "followUps"],
};

interface RawDigest { summary: string; keyAdmissions: { cite: string; text: string }[]; themes: string[]; credibilityNotes: string[]; followUps: string[] }

export async function digestDeposition(depositionId: string, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<NonNullable<Deposition["aiDigest"]>> {
  const dep = getDeposition(depositionId);
  if (!dep) throw Object.assign(new Error(`No deposition ${depositionId}`), { status: 404 });
  if (dep.aiDigest && !opts.force) return dep.aiDigest;
  if (!dep.transcript.length) throw Object.assign(new Error("No transcript to digest"), { status: 400 });
  requireKey();
  const instructions = `You are a senior litigation associate at ${FIRM_NAME} preparing a deposition digest in ${matterLine(dep.matterId)}
${todayLine()}
${LEGAL_STYLE_RULES}
The digest is for the defending team. Be precise about what the witness actually said; do not overstate admissions. Every key admission, credibility note and follow-up must carry a page:line cite from the transcript.`;
  const raw = await generateJSON<RawDigest>({
    instructions,
    input: `Deposition of ${dep.witnessName}${dep.witnessTitle ? `, ${dep.witnessTitle}` : ""}, taken ${dep.date} by ${dep.takenBy}${dep.defendingBy ? `, defended by ${dep.defendingBy}` : ""}. ${dep.pages} pages; excerpted Q/A below.\n\nExhibits:\n${(dep.exhibits ?? []).map((e) => `- ${e.id}: ${e.description}${e.bates ? ` (${e.bates})` : ""}`).join("\n")}\n\nTranscript:\n${transcriptText(dep, { maxChars: 60_000 })}`,
    schema: DIGEST_SCHEMA,
    name: "deposition_digest",
    maxOutputTokens: 3000,
    signal: opts.signal,
  });
  const digest: NonNullable<Deposition["aiDigest"]> = {
    summary: raw.summary,
    keyAdmissions: raw.keyAdmissions.map((k) => `${k.cite} — ${k.text}`),
    themes: raw.themes,
    credibilityNotes: raw.credibilityNotes,
    followUps: raw.followUps,
  };
  setDigest(depositionId, digest);
  return digest;
}

// ---------------------------------------------------------------------------
// Outline for the next witness
// ---------------------------------------------------------------------------

export async function prepareOutline(matterId: string, opts: { witnessId?: string; witnessName: string; topics?: string[]; depositionId?: string; signal?: AbortSignal }): Promise<{ markdown: string; title: string; sources: string[] }> {
  requireKey();
  const d = db();
  const witnessName = opts.witnessName.trim();
  const people = d.people.all();
  const person = opts.witnessId ? d.people.get(opts.witnessId) : resolvePersonName(witnessName, people);
  const deps = d.depositions.find((x) => x.matterId === matterId && x.transcript.length > 0);
  const last = witnessName.split(" ").pop()!.toLowerCase();
  // Prior testimony about this witness from other deponents, plus their own prior volume(s).
  const prior = deps.flatMap((dep) => dep.transcript.map((qa, i) => ({ dep, qa, i })).filter(({ dep, qa }) => dep.witnessId === person?.id || `${qa.question} ${qa.answer}`.toLowerCase().includes(last) || (qa.flags?.length ?? 0) > 0)).slice(0, 80);
  const priorText = prior.map(({ dep, qa }) => `${dep.witnessName} ${formatPageLine(qa.page, qa.line)}${qa.flags?.length ? ` [${qa.flags.join(", ")}]` : ""}\nQ. ${qa.question}\nA. ${qa.answer}`).join("\n\n");
  // Documents: authored/received by the witness plus topic hits.
  const docs = d.edocs.find((x) => x.matterId === matterId);
  const own = docs.filter((x) => x.custodianId === person?.id || (x.from && resolvePersonName(x.from, people)?.id === person?.id) || (x.to ?? []).some((n) => resolvePersonName(n, people)?.id === person?.id)).sort((a, b) => (b.coding.hot ? 1 : 0) - (a.coding.hot ? 1 : 0) || (b.aiScore ?? 0) - (a.aiScore ?? 0)).slice(0, 14);
  const topicDocs: EDocument[] = [];
  for (const t of opts.topics ?? []) {
    const hits = await hybridSearch(VECTOR_COLLECTIONS.edocs, t, { k: 4, perDoc: 1, filter: (meta) => meta.matterId === matterId });
    for (const h of hits) { const doc = d.edocs.get(h.docId); if (doc && !own.includes(doc) && !topicDocs.includes(doc)) topicDocs.push(doc); }
  }
  const allDocs = [...own, ...topicDocs].slice(0, 20);
  const conflicts = d.conflicts.find((c) => c.matterId === matterId && c.status === "open");
  const events = listEvents(matterId, { personId: person?.id }).slice(0, 30);
  const matter = d.matters.get(matterId);
  const instructions = `You are ${matter?.clientSide === "plaintiff" ? "lead trial counsel" : "defending counsel"} at ${FIRM_NAME} in ${matterLine(matterId)}
${todayLine()}
${LEGAL_STYLE_RULES}
Write a deposition ${matter?.clientSide === "defendant" ? "preparation and defence" : "examination"} outline for the witness in Markdown. Structure: 1. Witness profile and role; 2. Objectives; 3. Chronology the witness can speak to (dated, with Bates); 4. Topic-by-topic outline with the documents to use (Bates), the prior testimony to confront or reconcile (witness page:line), the questions to ask, and the answers to prepare for; 5. Privilege and instruction points; 6. Open conflicts to resolve; 7. Exhibit list. Use only the record provided; mark anything unverified [VERIFY].`;
  const input = `Witness: ${witnessName}${person?.title ? `, ${person.title}` : ""}${person?.organization ? ` (${person.organization})` : ""}
Topics requested: ${(opts.topics ?? []).join("; ") || "(counsel did not specify; infer from the record)"}

## Chronology entries involving the witness
${events.map((e) => `- ${e.date} — ${e.title} [${e.sources.map((s) => s.bates ?? s.cite ?? "").filter(Boolean).join(", ")}]`).join("\n") || "(none)"}

## Open conflicts
${conflicts.map((c) => `- ${c.title} (${c.severity}): ${c.sides.map((s) => `${s.cite}`).join(" vs ")}`).join("\n") || "(none)"}

## Prior testimony (this witness and others)
${clip(priorText, 40_000) || "(none)"}

## Documents
${allDocs.map((x) => docBlock(x, 2200)).join("\n\n---\n\n") || "(none)"}`;
  const res = await generateText({ instructions, input, maxOutputTokens: 6000, signal: opts.signal });
  const title = `Deposition outline — ${witnessName}`;
  return { markdown: res.text, title, sources: [...allDocs.map((x) => x.bates), ...Array.from(new Set(prior.map((p) => p.dep.witnessName)))] };
}

// ---------------------------------------------------------------------------
// Find contradictions → Conflict records
// ---------------------------------------------------------------------------

const CONTRADICTIONS_SCHEMA = {
  type: "object",
  properties: {
    contradictions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "One-line description: '<Witness>: <claim> vs. <source> <what it says>'" },
          kind: { type: "string", enum: ["testimony_vs_document", "testimony_vs_testimony", "document_vs_document", "date_inconsistency", "position_inconsistency"] },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          testimonyCite: { type: "string", description: "Witness and page:line, e.g. 'Voss 19:15'" },
          testimonyExcerpt: { type: "string" },
          sourceKind: { type: "string", enum: ["document", "deposition"] },
          sourceCite: { type: "string", description: "Bates number or witness page:line" },
          sourceExcerpt: { type: "string" },
          analysis: { type: "string", description: "3–5 sentences: why they conflict, how serious it is, and how to handle it." },
        },
        required: ["title", "kind", "severity", "testimonyCite", "testimonyExcerpt", "sourceKind", "sourceCite", "sourceExcerpt", "analysis"],
      },
    },
  },
  required: ["contradictions"],
};

interface RawContradiction { title: string; kind: Conflict["kind"]; severity: Conflict["severity"]; testimonyCite: string; testimonyExcerpt: string; sourceKind: "document" | "deposition"; sourceCite: string; sourceExcerpt: string; analysis: string }

export async function findContradictions(matterId: string, opts: { depositionId: string; topic: string; indexes?: number[]; signal?: AbortSignal }): Promise<{ created: Conflict[]; considered: number }> {
  requireKey();
  const dep = getDeposition(opts.depositionId);
  if (!dep) throw Object.assign(new Error("Unknown deposition"), { status: 404 });
  const d = db();
  const cross = await crossAnalysis(matterId, { topic: opts.topic, depositionId: dep.id, k: 12 });
  const indexes = opts.indexes?.length ? opts.indexes : cross.testimony.map((t) => t.index!).filter((i) => i != null);
  const testimony = transcriptText(dep, { indexes, maxChars: 30_000 });
  const docs = cross.documents.map((x) => d.edocs.get(x.id)).filter((x): x is EDocument => !!x);
  const other = cross.otherTestimony.map((t) => `${t.cite}\n${t.text}`).join("\n\n");
  const existing = d.conflicts.find((c) => c.matterId === matterId).map((c) => c.title);
  const instructions = `You are a senior litigator at ${FIRM_NAME} in ${matterLine(matterId)}
${todayLine()}
${LEGAL_STYLE_RULES}
Compare the witness's testimony against the documents and other testimony. Report only genuine inconsistencies of fact, date, or position, quoting both sides verbatim with exact cites. Do not report differences of emphasis. Skip anything already in the existing conflicts list. Return an empty array if nothing qualifies.`;
  const raw = await generateJSON<{ contradictions: RawContradiction[] }>({
    instructions,
    input: `Topic: ${opts.topic}\nWitness: ${dep.witnessName} (${dep.date})\n\n## Existing conflicts (skip)\n${existing.map((t) => `- ${t}`).join("\n") || "(none)"}\n\n## Testimony under review\n${testimony}\n\n## Other witnesses on this topic\n${other || "(none)"}\n\n## Documents\n${docs.map((x) => docBlock(x, 3000)).join("\n\n---\n\n") || "(none)"}`,
    schema: CONTRADICTIONS_SCHEMA,
    name: "contradictions",
    maxOutputTokens: 4000,
    signal: opts.signal,
  });
  const created: Conflict[] = [];
  for (const c of raw.contradictions) {
    let sourceId = "";
    if (c.sourceKind === "document") sourceId = d.edocs.findOne((x) => c.sourceCite.toUpperCase().includes(x.bates.toUpperCase()))?.id ?? docs[0]?.id ?? "";
    else { const last = c.sourceCite.split(" ")[0].toLowerCase(); sourceId = d.depositions.findOne((x) => x.matterId === matterId && x.witnessName.toLowerCase().includes(last))?.id ?? dep.id; }
    if (!sourceId) continue;
    created.push(createConflict(matterId, {
      title: c.title, kind: c.kind, severity: c.severity, analysis: c.analysis, createdBy: "ai",
      sides: [
        { label: `${dep.witnessName} testimony`, sourceKind: "deposition", sourceId: dep.id, cite: c.testimonyCite, excerpt: c.testimonyExcerpt },
        { label: c.sourceKind === "document" ? (d.edocs.get(sourceId)?.subject ?? "Document") : `${d.depositions.get(sourceId)?.witnessName ?? "Witness"} testimony`, sourceKind: c.sourceKind, sourceId, cite: c.sourceCite, excerpt: c.sourceExcerpt },
      ],
    }));
  }
  return { created, considered: indexes.length + docs.length + cross.otherTestimony.length };
}

// ---------------------------------------------------------------------------
// Fact matrix
// ---------------------------------------------------------------------------

const MATRIX_SCHEMA = {
  type: "object",
  properties: {
    topics: { type: "array", items: { type: "string" }, description: "4–8 fact questions or sub-topics, short." },
    cells: { type: "array", items: { type: "object", properties: { topic: { type: "string" }, sourceId: { type: "string", description: "Exactly one of the provided source ids" }, position: { type: "string", description: "What this source says on the topic, one or two sentences; 'Silent' if nothing." }, cite: { type: "string", description: "page:line or Bates" }, stance: { type: "string", enum: ["supports", "contradicts", "neutral", "silent"], description: "Relative to the client's position" } }, required: ["topic", "sourceId", "position", "cite", "stance"] } },
  },
  required: ["topics", "cells"],
};

export async function buildFactMatrix(matterId: string, opts: { topic: string; witnessId?: string; signal?: AbortSignal }): Promise<FactMatrix> {
  requireKey();
  const d = db();
  const cross = await crossAnalysis(matterId, { topic: opts.topic, witnessId: opts.witnessId, k: 8 });
  const sources: FactMatrix["sources"] = [];
  const blocks: string[] = [];
  const deps = new Map<string, number[]>();
  for (const t of [...cross.testimony, ...cross.otherTestimony]) { const arr = deps.get(t.id) ?? []; if (t.index != null) arr.push(t.index); deps.set(t.id, arr); }
  for (const [id, idx] of deps) {
    const dep = d.depositions.get(id)!;
    sources.push({ id, kind: "deposition", label: `${dep.witnessName} deposition`, cite: `${dep.witnessName.split(" ").pop()} Vol. ${dep.volume ?? 1}` });
    blocks.push(`### Source ${id} — ${dep.witnessName} testimony\n${transcriptText(dep, { indexes: idx, maxChars: 12_000 })}`);
  }
  for (const x of cross.documents.slice(0, 8)) {
    const doc = d.edocs.get(x.id);
    if (!doc) continue;
    sources.push({ id: doc.id, kind: "document", label: doc.subject, cite: doc.bates });
    blocks.push(`### Source ${doc.id} — ${doc.bates}\n${docBlock(doc, 2500)}`);
  }
  const instructions = `You are a litigation analyst at ${FIRM_NAME} in ${matterLine(matterId)}
${todayLine()}
Build a fact matrix: rows are sub-topics of the requested topic, columns are the sources. For every (topic, source) pair produce one cell. Quote or closely paraphrase; cite page:line for testimony and Bates for documents. Use sourceId values exactly as given.`;
  const raw = await generateJSON<{ topics: string[]; cells: FactMatrix["cells"] }>({
    instructions,
    input: `Topic: ${opts.topic}\n\nSources:\n${sources.map((s) => `- ${s.id}: ${s.label} (${s.cite})`).join("\n")}\n\n${blocks.join("\n\n")}`,
    schema: MATRIX_SCHEMA,
    name: "fact_matrix",
    maxOutputTokens: 5000,
    signal: opts.signal,
  });
  const valid = new Set(sources.map((s) => s.id));
  const matrix: FactMatrix = { id: `fm_${nanoid(10)}`, matterId, topic: opts.topic, createdAt: new Date().toISOString(), createdBy: "ai", topics: raw.topics, sources, cells: raw.cells.filter((c) => valid.has(c.sourceId)) };
  return saveFactMatrix(matrix);
}

// ---------------------------------------------------------------------------
// Timeline extraction
// ---------------------------------------------------------------------------

const EVENTS_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "ISO date YYYY-MM-DD; use the first of the month or year if only that precision is known" },
          precision: { type: "string", enum: ["day", "month", "year"] },
          title: { type: "string", description: "Short factual headline, under 120 characters" },
          description: { type: "string" },
          category: { type: "string", enum: ["corporate", "scientific", "regulatory", "communication", "litigation", "testimony", "product", "other"] },
          significance: { type: "integer", description: "1 (background) to 5 (case-critical)" },
          bates: { type: "string", description: "Bates number of the source document" },
          excerpt: { type: "string", description: "Short quotation supporting the event" },
          people: { type: "array", items: { type: "string" }, description: "Names of people involved" },
        },
        required: ["date", "precision", "title", "description", "category", "significance", "bates", "excerpt", "people"],
      },
    },
  },
  required: ["events"],
};

interface RawEvent { date: string; precision: "day" | "month" | "year"; title: string; description: string; category: TimelineEvent["category"]; significance: number; bates: string; excerpt: string; people: string[] }

export async function extractTimelineEvents(matterId: string, opts: { docIds: string[]; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<{ added: TimelineEvent[]; merged: number; extracted: number }> {
  requireKey();
  const d = db();
  const docs = opts.docIds.map((id) => d.edocs.get(id)).filter((x): x is EDocument => !!x && x.matterId === matterId);
  if (!docs.length) throw Object.assign(new Error("No documents to extract from"), { status: 400 });
  const people = d.people.all();
  const instructions = `You are a litigation analyst at ${FIRM_NAME} building a chronology in ${matterLine(matterId)}
${todayLine()}
Extract dated events from the documents: things that happened (a study delivered, a decision made, a letter sent, a result received, a meeting held), not the document itself. Use the document date for events the document itself records unless the text gives a different date. One event per distinct fact; skip trivial scheduling. Cite the Bates number of the document that supports each event.`;
  const all: TimelineEvent[] = [];
  const batchSize = 6;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const raw = await generateJSON<{ events: RawEvent[] }>({
      fast: true,
      instructions,
      input: batch.map((x) => docBlock(x, 4000)).join("\n\n---\n\n"),
      schema: EVENTS_SCHEMA,
      name: "timeline_events",
      maxOutputTokens: 4000,
      signal: opts.signal,
    });
    for (const e of raw.events) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
      const src = d.edocs.findOne((x) => x.matterId === matterId && x.bates.toUpperCase() === e.bates.toUpperCase()) ?? batch[0];
      all.push({ id: `tl_${nanoid(10)}`, matterId, date: e.date, precision: e.precision, title: e.title, description: e.description, category: e.category, significance: Math.min(5, Math.max(1, Math.round(e.significance))) as TimelineEvent["significance"], sources: [{ kind: "document", id: src.id, bates: src.bates, excerpt: e.excerpt }], personIds: e.people.map((n) => resolvePersonName(n, people)?.id).filter((x): x is string => !!x), createdBy: "ai", verified: false });
    }
    opts.onProgress?.(Math.min(docs.length, i + batchSize), docs.length);
  }
  const res = mergeEvents(matterId, all);
  return { added: res.added, merged: res.merged, extracted: all.length };
}

// ---------------------------------------------------------------------------
// Who knew what, when
// ---------------------------------------------------------------------------

const KNOWLEDGE_SCHEMA = {
  type: "object",
  properties: {
    narrative: { type: "string", description: "One paragraph summarising the knowledge timeline across people." },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          personName: { type: "string" },
          knew: { type: "string", description: "What this person knew or was told, precisely." },
          firstKnownDate: { type: "string", description: "ISO date of the earliest evidence" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          cites: { type: "array", items: { type: "object", properties: { cite: { type: "string", description: "Bates or witness page:line" }, sourceKind: { type: "string", enum: ["document", "deposition"] } }, required: ["cite", "sourceKind"] } },
        },
        required: ["personName", "knew", "firstKnownDate", "confidence", "cites"],
      },
    },
  },
  required: ["narrative", "entries"],
};

export async function knowledgeMap(matterId: string, opts: { topic: string; signal?: AbortSignal }): Promise<KnowledgeMap> {
  requireKey();
  const d = db();
  const cross = await crossAnalysis(matterId, { topic: opts.topic, k: 16 });
  const docs = cross.documents.map((x) => d.edocs.get(x.id)).filter((x): x is EDocument => !!x);
  const testimony = [...cross.testimony, ...cross.otherTestimony].map((t) => `${t.cite} (${t.date})\n${t.text}`).join("\n\n");
  const events = listEvents(matterId, { q: opts.topic.split(/\s+/)[0] }).slice(0, 25);
  const people = d.people.all();
  const instructions = `You are a litigation analyst at ${FIRM_NAME} in ${matterLine(matterId)}
${todayLine()}
Produce a "who knew what, when" map for the topic. For each person with evidence, state precisely what they knew, the earliest date the record shows it, and the cites. Distinguish direct knowledge (author or recipient) from inference. Do not invent people or dates.`;
  const raw = await generateJSON<{ narrative: string; entries: (KnowledgeMap["entries"][number] & { personName: string })[] }>({
    instructions,
    input: `Topic: ${opts.topic}\n\n## Chronology\n${events.map((e) => `- ${e.date} — ${e.title} [${e.sources.map((s) => s.bates ?? s.cite ?? "").filter(Boolean).join(", ")}]`).join("\n") || "(none)"}\n\n## Testimony\n${clip(testimony, 30_000) || "(none)"}\n\n## Documents\n${docs.map((x) => docBlock(x, 2500)).join("\n\n---\n\n") || "(none)"}`,
    schema: KNOWLEDGE_SCHEMA,
    name: "knowledge_map",
    maxOutputTokens: 4000,
    signal: opts.signal,
  });
  const map: KnowledgeMap = {
    id: `km_${nanoid(10)}`, matterId, topic: opts.topic, createdAt: new Date().toISOString(), narrative: raw.narrative,
    entries: raw.entries.map((e) => {
      const p = resolvePersonName(e.personName, people);
      return { personId: p?.id, personName: p?.name ?? e.personName, knew: e.knew, firstKnownDate: e.firstKnownDate, confidence: e.confidence, cites: e.cites.map((c) => ({ ...c, sourceId: c.sourceKind === "document" ? d.edocs.findOne((x) => c.cite.toUpperCase().includes(x.bates.toUpperCase()))?.id : d.depositions.findOne((x) => x.matterId === matterId && c.cite.toLowerCase().includes(x.witnessName.split(" ").pop()!.toLowerCase()))?.id })) };
    }).sort((a, b) => a.firstKnownDate.localeCompare(b.firstKnownDate)),
  };
  return saveKnowledgeMap(map);
}

export function exhibitDocs(dep: Deposition) { return exhibitDocuments(dep); }
