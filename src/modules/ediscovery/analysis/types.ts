/**
 * Client-safe types for the e-discovery analysis module (depositions,
 * cross-analysis, chronology, people graph, conflicts). No server imports.
 */
import type { Conflict, Deposition, DepositionQA, Relationship, TimelineEvent } from "@/lib/types/domain";

export type QAFlag = NonNullable<DepositionQA["flags"]>[number];
export const QA_FLAGS: { id: QAFlag; label: string; hint: string }[] = [
  { id: "admission", label: "Admission", hint: "Concession useful to our side or damaging to the witness" },
  { id: "contradiction", label: "Contradiction", hint: "Inconsistent with a document or other testimony" },
  { id: "evasive", label: "Evasive", hint: "Non-responsive or memory failure on a key point" },
  { id: "key", label: "Key", hint: "Important testimony for motions or trial" },
  { id: "privilege", label: "Privilege", hint: "Instruction not to answer / privilege assertion" },
];

export const OBJECTION_BASES = ["form", "foundation", "speculation", "privilege", "asked-and-answered", "compound", "relevance", "argumentative", "mischaracterizes", "hearsay"] as const;
export type ObjectionBasis = (typeof OBJECTION_BASES)[number];

/** Deposition list row (transcript omitted for the list endpoint). */
export interface DepositionSummary extends Omit<Deposition, "transcript"> {
  qaCount: number;
  flagCounts: Record<QAFlag, number>;
  objectionCount: number;
  exhibitCount: number;
  designationCount: number;
  hasDigest: boolean;
}

/** Full-text hit across transcripts. */
export interface TranscriptHit {
  depositionId: string;
  witnessName: string;
  index: number; // index into transcript[]
  page: number;
  line: number;
  field: "question" | "answer" | "objection" | "note";
  snippet: string;
  score: number;
}

/** A page:line designation range on a deposition. */
export interface Designation {
  id: string;
  matterId: string;
  depositionId: string;
  startPage: number;
  startLine: number;
  endPage: number;
  endLine: number;
  purpose: "affirmative" | "counter" | "impeachment" | "objection";
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface ObjectionSummary {
  total: number;
  byBasis: { basis: string; count: number }[];
  byAttorney: { attorney: string; count: number }[];
  /** Placeholder until rulings are entered on the record. */
  rulings: { sustained: number; overruled: number; pending: number };
}

export interface CrossExcerpt {
  kind: "deposition" | "document";
  id: string; // deposition id or edoc id
  label: string; // witness name or subject
  cite: string; // "Voss 84:12" or Bates
  date?: string;
  text: string;
  score: number;
  index?: number; // qa index for deposition excerpts
  flags?: QAFlag[];
}

export interface CrossAnalysisResponse {
  topic: string;
  witnessId?: string;
  testimony: CrossExcerpt[];
  documents: CrossExcerpt[];
  otherTestimony: CrossExcerpt[];
  conflicts: Conflict[];
  aiConfigured: boolean;
}

export interface FactMatrix {
  id: string;
  matterId: string;
  topic: string;
  createdAt: string;
  createdBy: "ai" | "user";
  topics: string[];
  sources: { id: string; kind: "document" | "deposition"; label: string; cite: string }[];
  cells: { topic: string; sourceId: string; position: string; cite: string; stance: "supports" | "contradicts" | "neutral" | "silent" }[];
}

export type TimelineCategory = TimelineEvent["category"];
export const TIMELINE_CATEGORIES: { id: TimelineCategory; label: string; color: string }[] = [
  { id: "scientific", label: "Scientific", color: "chart-1" },
  { id: "regulatory", label: "Regulatory", color: "chart-2" },
  { id: "corporate", label: "Corporate", color: "chart-3" },
  { id: "communication", label: "Communication", color: "chart-4" },
  { id: "product", label: "Product", color: "chart-5" },
  { id: "litigation", label: "Litigation", color: "primary" },
  { id: "testimony", label: "Testimony", color: "info" },
  { id: "other", label: "Other", color: "muted" },
];

export interface TimelineFilters {
  categories?: TimelineCategory[];
  personId?: string;
  minSignificance?: number;
  from?: string;
  to?: string;
  sourceKind?: "document" | "deposition" | "external";
  q?: string;
  disputedOnly?: boolean;
  unverifiedOnly?: boolean;
}

export type TimelineEventInput = Omit<TimelineEvent, "id" | "matterId" | "createdBy"> & { id?: string; createdBy?: TimelineEvent["createdBy"] };

export interface GraphNode {
  id: string;
  label: string;
  kind: "person" | "org";
  role?: string;
  organization?: string;
  title?: string;
  docCount: number; // documents authored or received
  authored: number;
  received: number;
  depositions: number;
  cluster: string; // organization key
  color: string; // token name
  degree: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: Relationship["kind"];
  weight: number;
  label?: string;
  evidence: { bates?: string; docId?: string; excerpt?: string }[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: { id: string; label: string; color: string; size: number }[];
}

export interface PersonDetail {
  person: { id: string; name: string; title?: string; organization?: string; role: string; email?: string };
  authored: { id: string; bates: string; date: string; subject: string; type: string }[];
  received: { id: string; bates: string; date: string; subject: string; type: string }[];
  counts: { authored: number; received: number; cc: number; mentioned: number };
  depositions: { id: string; date: string; witnessName: string; pages: number; status: string; mentions: number }[];
  timeline: { id: string; date: string; title: string; category: string; significance: number }[];
  relationships: { id: string; otherId: string; otherName: string; kind: string; direction: "out" | "in"; weight: number; label?: string; evidence: { bates?: string; docId?: string; excerpt?: string }[] }[];
  conflicts: { id: string; title: string; severity: string; status: string }[];
}

export interface KnowledgeMap {
  id: string;
  matterId: string;
  topic: string;
  createdAt: string;
  entries: { personId?: string; personName: string; knew: string; firstKnownDate: string; confidence: "high" | "medium" | "low"; cites: { cite: string; sourceKind: "document" | "deposition"; sourceId?: string }[] }[];
  narrative: string;
}

export interface ConflictNote {
  id: string;
  conflictId: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface ConflictRow extends Conflict {
  witnessNames: string[];
  noteCount: number;
  updatedAt?: string;
}

export interface AnalysisOverview {
  matterId: string;
  aiConfigured: boolean;
  depositions: number;
  transcribed: number;
  events: number;
  relationships: number;
  conflicts: { open: number; resolved: number; dismissed: number };
}

export const CONFLICT_KINDS: { id: Conflict["kind"]; label: string }[] = [
  { id: "testimony_vs_document", label: "Testimony vs. document" },
  { id: "testimony_vs_testimony", label: "Testimony vs. testimony" },
  { id: "document_vs_document", label: "Document vs. document" },
  { id: "date_inconsistency", label: "Date inconsistency" },
  { id: "position_inconsistency", label: "Position inconsistency" },
];

export function formatPageLine(page: number, line: number) {
  return `${page}:${String(line).padStart(2, "0")}`;
}

export function formatRange(d: Pick<Designation, "startPage" | "startLine" | "endPage" | "endLine">) {
  return `${formatPageLine(d.startPage, d.startLine)}–${formatPageLine(d.endPage, d.endLine)}`;
}
