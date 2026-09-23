import "server-only";
import { defineTool } from "../tools";
import { db } from "@/lib/db";
import { hybridSearch } from "../vector-store";
import type { EDocument, LibraryItem } from "@/lib/types/domain";

export const VECTOR_COLLECTIONS = { edocs: "ediscovery_documents", library: "library_items", office: "office_documents", depositions: "depositions" } as const;

function keywordScore(text: string, terms: string[]) {
  const t = text.toLowerCase();
  let s = 0;
  for (const term of terms) { let i = 0; while ((i = t.indexOf(term, i)) >= 0) { s++; i += term.length; if (s > 50) break; } }
  return s;
}

/** Keyword fallback search when a vector index is empty. */
function keywordFallback<T>(items: T[], query: string, textOf: (t: T) => string, k: number): { item: T; score: number; excerpt: string }[] {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!terms.length) return [];
  return items
    .map((item) => { const text = textOf(item); const score = keywordScore(text, terms); return { item, score, excerpt: excerptAround(text, terms[0]) }; })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function excerptAround(text: string, term: string, radius = 180) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text.slice(0, radius * 2).replace(/\s+/g, " ");
  return (i > radius ? "…" : "") + text.slice(Math.max(0, i - radius), i + radius).replace(/\s+/g, " ") + "…";
}

export const searchEdiscoveryTool = defineTool<{ query: string; matter_id?: string; custodian?: string; doc_type?: string; date_after?: string; date_before?: string; limit?: number }>({
  name: "search_ediscovery",
  description: "Semantic + keyword search over the matter's e-discovery document set (emails, memos, reports, depositions). Returns Bates numbers, custodians, dates, subjects and the most relevant passages. Use for fact development, chronology building and locating exhibits.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      matter_id: { type: "string", description: "Restrict to a matter id" },
      custodian: { type: "string", description: "Custodian name filter (contains)" },
      doc_type: { type: "string", description: "Email | Memo | Report | Presentation | Spreadsheet | Letter | Contract | Chat | Transcript" },
      date_after: { type: "string", description: "YYYY-MM-DD" },
      date_before: { type: "string", description: "YYYY-MM-DD" },
      limit: { type: "integer", description: "Default 8, max 25" },
    },
    required: ["query"],
  },
  label: (a) => `Searching documents: ${a.query}`,
  async execute(args, ctx) {
    const k = Math.min(args.limit ?? 8, 25);
    const d = db();
    const matches = (doc: EDocument) =>
      (!args.matter_id || doc.matterId === args.matter_id) &&
      (!args.custodian || doc.custodianName.toLowerCase().includes(args.custodian.toLowerCase())) &&
      (!args.doc_type || doc.type.toLowerCase() === args.doc_type.toLowerCase()) &&
      (!args.date_after || doc.date >= args.date_after) &&
      (!args.date_before || doc.date <= args.date_before);
    const hits = await hybridSearch(VECTOR_COLLECTIONS.edocs, args.query, { k, filter: (_m, id) => { const doc = d.edocs.get(id); return !!doc && matches(doc); } });
    let results = hits.map((h) => { const doc = d.edocs.get(h.docId)!; return { id: doc.id, bates: doc.bates, date: doc.date, custodian: doc.custodianName, type: doc.type, subject: doc.subject, from: doc.from, to: doc.to, passage: h.text.slice(0, 900), score: Number(h.score.toFixed(3)), ai_score: doc.aiScore, coding: doc.coding }; });
    if (!results.length) {
      results = keywordFallback(d.edocs.find(matches), args.query, (doc) => `${doc.subject}\n${doc.text}`, k).map(({ item: doc, score, excerpt }) => ({ id: doc.id, bates: doc.bates, date: doc.date, custodian: doc.custodianName, type: doc.type, subject: doc.subject, from: doc.from, to: doc.to, passage: excerpt, score, ai_score: doc.aiScore, coding: doc.coding }));
    }
    for (const r of results.slice(0, 5)) ctx.emit({ type: "citation", citation: { title: `${r.bates} — ${r.subject}`, cite: r.bates, source: "e-discovery", snippet: r.passage.slice(0, 200) } });
    return { count: results.length, results };
  },
});

export const getEdiscoveryDocumentTool = defineTool<{ id_or_bates: string; max_chars?: number }>({
  name: "get_ediscovery_document",
  description: "Read the full text and metadata of an e-discovery document by id or Bates number.",
  parameters: { type: "object", properties: { id_or_bates: { type: "string" }, max_chars: { type: "integer", description: "Default 30000" } }, required: ["id_or_bates"] },
  label: (a) => `Reading ${a.id_or_bates}`,
  async execute({ id_or_bates, max_chars }) {
    const d = db();
    const doc = d.edocs.get(id_or_bates) ?? d.edocs.findOne((x) => x.bates.toLowerCase() === id_or_bates.toLowerCase());
    if (!doc) throw new Error(`No document ${id_or_bates}`);
    const max = max_chars ?? 30_000;
    return { ...doc, text: doc.text.length > max ? doc.text.slice(0, max) + "…[truncated]" : doc.text };
  },
});

export const searchLibraryTool = defineTool<{ query: string; type?: string; matter_id?: string; limit?: number }>({
  name: "search_library",
  description: "Search the firm's shared library: templates, precedents, clause bank, knowledge notes, prior work product and matter folders. Returns items with excerpts; use get_library_item to read one fully.",
  parameters: { type: "object", properties: { query: { type: "string" }, type: { type: "string", description: "folder | docx | xlsx | pptx | pdf | template | clause | link | note" }, matter_id: { type: "string" }, limit: { type: "integer", description: "Default 8" } }, required: ["query"] },
  label: (a) => `Searching library: ${a.query}`,
  async execute(args) {
    const k = Math.min(args.limit ?? 8, 25);
    const d = db();
    const matches = (it: LibraryItem) => it.type !== "folder" && (!args.type || it.type === args.type) && (!args.matter_id || it.matterId === args.matter_id);
    const hits = await hybridSearch(VECTOR_COLLECTIONS.library, args.query, { k, filter: (_m, id) => { const it = d.library.get(id); return !!it && matches(it); } });
    let results = hits.map((h) => { const it = d.library.get(h.docId)!; return { id: it.id, name: it.name, type: it.type, description: it.description, tags: it.tags, practice_area: it.practiceArea, office_doc_id: it.officeDocId, passage: h.text.slice(0, 800), score: Number(h.score.toFixed(3)) }; });
    if (!results.length) {
      results = keywordFallback(d.library.find(matches), args.query, (it) => `${it.name}\n${it.description ?? ""}\n${it.content ?? ""}\n${(it.tags ?? []).join(" ")}`, k).map(({ item: it, score, excerpt }) => ({ id: it.id, name: it.name, type: it.type, description: it.description, tags: it.tags, practice_area: it.practiceArea, office_doc_id: it.officeDocId, passage: excerpt, score }));
    }
    return { count: results.length, results };
  },
});

export const getLibraryItemTool = defineTool<{ id: string; max_chars?: number }>({
  name: "get_library_item",
  description: "Read a library item (clause, template, note) in full, including its text content when available.",
  parameters: { type: "object", properties: { id: { type: "string" }, max_chars: { type: "integer" } }, required: ["id"] },
  label: (a) => `Reading library item ${a.id}`,
  async execute({ id, max_chars }) {
    const d = db();
    const it = d.library.get(id);
    if (!it) throw new Error(`No library item ${id}`);
    let content = it.content ?? "";
    if (!content && it.officeDocId) {
      const od = d.officeDocs.get(it.officeDocId);
      if (od) content = extractPlainText(od.content);
    }
    const max = max_chars ?? 30_000;
    return { ...it, content: content.length > max ? content.slice(0, max) + "…[truncated]" : content };
  },
});

export const matterContextTool = defineTool<{ matter_id?: string; query?: string }>({
  name: "get_matter_context",
  description: "Get the firm's matter context: matter caption, client, posture, court, judge, team, key dates, open tasks and upcoming events. Call with matter_id, or with a query to find matters by name.",
  parameters: { type: "object", properties: { matter_id: { type: "string" }, query: { type: "string" } }, required: [] },
  label: () => "Loading matter context",
  async execute({ matter_id, query }) {
    const d = db();
    const matters = matter_id ? [d.matters.get(matter_id)].filter(Boolean) : query ? d.matters.find((m) => `${m.name} ${m.shortName} ${m.client} ${m.caption ?? ""}`.toLowerCase().includes(query.toLowerCase())) : d.matters.all();
    return matters.map((m) => {
      const matter = m!;
      return {
        ...matter,
        team: matter.teamIds.map((id) => d.people.get(id)).filter(Boolean).map((p) => ({ name: p!.name, title: p!.title })),
        open_tasks: d.tasks.find((t) => t.matterId === matter.id && t.status !== "done").slice(0, 15).map((t) => ({ title: t.title, status: t.status, priority: t.priority, due: t.dueAt })),
        upcoming_events: d.events.find((e) => e.matterId === matter.id && e.startsAt >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 10).map((e) => ({ title: e.title, kind: e.kind, at: e.startsAt })),
      };
    });
  },
});

/** Best-effort plain text from any office content model (TipTap JSON, workbook, deck). */
export function extractPlainText(content: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n) return;
    if (typeof n === "string") { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === "object") {
      const o = n as Record<string, unknown>;
      if (typeof o.text === "string") out.push(o.text);
      if (typeof o.value === "string" || typeof o.value === "number") out.push(String(o.value));
      for (const k of ["content", "children", "cells", "rows", "slides", "elements", "sheets", "blocks", "paragraphs"]) if (o[k]) walk(o[k]);
      if (o.type === "paragraph" || o.type === "heading") out.push("\n");
    }
  };
  walk(content);
  return out.join(" ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export const INTERNAL_TOOLS = [searchEdiscoveryTool, getEdiscoveryDocumentTool, searchLibraryTool, getLibraryItemTool, matterContextTool];
