/**
 * Shared domain model for the platform. Every module persists these shapes
 * through `@/lib/db` collections; keep additions backwards compatible.
 */

import type { Provenance } from "@/lib/integrity/types";

export type ID = string;
export type ISODate = string; // ISO-8601

export type PracticeArea = "Litigation" | "Products Liability" | "Commercial" | "Corporate / M&A" | "Employment" | "Regulatory" | "IP" | "Real Estate";

export interface Person {
  id: ID;
  name: string;
  email?: string;
  title?: string; // e.g. "Partner", "Associate", "Paralegal", "VP Operations"
  organization?: string; // firm or client/company
  role: "attorney" | "paralegal" | "staff" | "client" | "custodian" | "witness" | "expert" | "opposing" | "judge" | "other";
  avatarColor?: string;
  tags?: string[];
}

export interface Matter {
  id: ID;
  slug: string;
  name: string; // "In re: AFFF Products Liability Litigation"
  shortName: string; // "AFFF / PFAS"
  caption?: string; // "MDL No. 2873 (D.S.C.)"
  client: string;
  clientSide: "plaintiff" | "defendant" | "petitioner" | "respondent" | "buyer" | "seller" | "other";
  practiceArea: PracticeArea;
  court?: string;
  jurisdiction?: string;
  judge?: string;
  status: "active" | "on hold" | "closed" | "pre-suit";
  stage?: string; // "Discovery", "Motion practice", "Diligence"
  openedAt: ISODate;
  teamIds: ID[];
  leadAttorneyId?: ID;
  description?: string;
  keyDates?: { label: string; date: ISODate }[];
  tags?: string[];
}

export interface Task {
  id: ID;
  title: string;
  description?: string;
  matterId?: ID;
  assigneeId?: ID;
  createdById?: ID;
  status: "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  dueAt?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
  tags?: string[];
  source?: "manual" | "workflow" | "agent" | "docket";
  links?: { label: string; href: string }[];
}

export interface CalendarEvent {
  id: ID;
  title: string;
  matterId?: ID;
  startsAt: ISODate;
  endsAt?: ISODate;
  allDay?: boolean;
  kind: "deadline" | "hearing" | "deposition" | "meeting" | "filing" | "internal" | "cle" | "other";
  location?: string;
  attendeeIds?: ID[];
  notes?: string;
  ruleSource?: string; // "FRCP 26(f)", "Local Rule 7.1"
}

export interface NewsItem {
  id: ID;
  title: string;
  summary: string;
  source: string; // "Federal Register", "Fourth Circuit", "Firm"
  url?: string;
  publishedAt: ISODate;
  category: "court" | "regulatory" | "legislative" | "industry" | "firm" | "client";
  practiceAreas?: PracticeArea[];
  matterIds?: ID[];
  relevance?: number; // 0-100 AI relevance to firm matters
}

export interface TeamUpdate {
  id: ID;
  authorId: ID;
  body: string;
  matterId?: ID;
  createdAt: ISODate;
  kind: "update" | "win" | "announcement" | "question";
  reactions?: Record<string, number>;
  attachments?: { label: string; href: string }[];
}

// ---------------- E-Discovery ----------------

export type DocType = "Email" | "Memo" | "Report" | "Presentation" | "Spreadsheet" | "Letter" | "Contract" | "Chat" | "Note" | "Image" | "Transcript" | "Other";

export interface CodingDecision {
  responsive?: boolean | null;
  privileged?: boolean | null;
  privilegeBasis?: "attorney-client" | "work-product" | "common-interest" | "joint-defense";
  hot?: boolean;
  confidentiality?: "public" | "confidential" | "highly confidential" | "AEO";
  issues?: string[]; // issue codes
  notes?: string;
  reviewerId?: ID;
  reviewedAt?: ISODate;
}

export interface EDocument {
  id: ID;
  matterId: ID;
  bates: string; // "MFC-0041877"
  batesEnd?: string;
  date: ISODate;
  custodianId: ID;
  custodianName: string;
  type: DocType;
  subject: string;
  from?: string;
  to?: string[];
  cc?: string[];
  text: string; // full extracted text
  pages?: number;
  family?: { parentId?: ID; threadId?: ID; attachmentIds?: ID[] };
  hash?: string;
  aiScore?: number; // 0-100 predicted responsiveness
  aiSummary?: string;
  aiIssues?: string[];
  aiProvenance?: Provenance;
  entities?: { people: string[]; orgs: string[]; places: string[]; chemicals?: string[] };
  coding: CodingDecision;
  isDuplicateOf?: ID;
  nearDuplicateIds?: ID[];
  source?: string; // collection source
  tags?: string[];
}

export interface DepositionQA {
  page: number;
  line: number;
  question: string;
  answer: string;
  objection?: { by: string; basis: string; text?: string };
  exhibit?: string;
  flags?: ("admission" | "contradiction" | "evasive" | "key" | "privilege" | "objection")[];
  note?: string;
}

export interface Deposition {
  id: ID;
  matterId: ID;
  witnessId: ID;
  witnessName: string;
  witnessTitle?: string;
  date: ISODate;
  takenBy: string; // attorney name / side
  defendingBy?: string;
  location?: string;
  volume?: number;
  pages: number;
  transcript: DepositionQA[];
  exhibits?: { id: string; description: string; bates?: string }[];
  aiDigest?: { summary: string; keyAdmissions: string[]; themes: string[]; credibilityNotes?: string[]; followUps?: string[] };
  status: "scheduled" | "transcribed" | "reviewed";
}

export interface TimelineEvent {
  id: ID;
  matterId: ID;
  date: ISODate;
  dateEnd?: ISODate;
  precision?: "day" | "month" | "year";
  title: string;
  description?: string;
  category: "corporate" | "scientific" | "regulatory" | "communication" | "litigation" | "testimony" | "product" | "other";
  significance: 1 | 2 | 3 | 4 | 5;
  sources: { kind: "document" | "deposition" | "external"; id?: ID; bates?: string; cite?: string; excerpt?: string }[];
  personIds?: ID[];
  disputed?: boolean;
  createdBy: "ai" | "user";
  verified?: boolean;
  provenance?: Provenance;
}

export interface Relationship {
  id: ID;
  matterId: ID;
  fromId: ID;
  toId: ID;
  kind: "reports_to" | "emailed" | "cc" | "meeting" | "same_org" | "supervises" | "retained" | "represents" | "testified_about" | "authored" | "received" | "other";
  weight: number;
  evidence?: { bates?: string; excerpt?: string; docId?: ID }[];
  label?: string;
}

export interface Conflict {
  id: ID;
  matterId: ID;
  title: string;
  kind: "testimony_vs_document" | "testimony_vs_testimony" | "document_vs_document" | "date_inconsistency" | "position_inconsistency";
  severity: "low" | "medium" | "high";
  sides: { label: string; sourceKind: "document" | "deposition"; sourceId: ID; cite: string; excerpt: string }[];
  analysis: string;
  status: "open" | "resolved" | "dismissed";
  createdBy: "ai" | "user";
  provenance?: Provenance;
}

export interface IssueCode {
  id: ID;
  matterId: ID;
  code: string; // "TOX-01"
  label: string;
  description?: string;
  color?: string;
  parentId?: ID;
  count?: number;
}

export interface PrivilegeLogEntry {
  id: ID;
  matterId: ID;
  docId: ID;
  bates: string;
  date: ISODate;
  author: string;
  recipients: string[];
  docType: DocType;
  basis: string;
  description: string; // privilege-safe description
  status: "draft" | "final";
}

// ---------------- Workflows ----------------

export type WorkflowNodeType =
  | "trigger.manual" | "trigger.schedule" | "trigger.document_added" | "trigger.docket_update" | "trigger.email"
  | "ai.prompt" | "ai.extract" | "ai.classify" | "ai.summarize" | "ai.draft" | "ai.review" | "ai.research"
  | "data.search_library" | "data.search_ediscovery" | "data.fetch_url" | "data.legal_search"
  | "logic.branch" | "logic.loop" | "logic.merge" | "logic.approval" | "logic.delay"
  | "action.create_task" | "action.create_event" | "action.save_document" | "action.notify" | "action.export" | "action.update_coding";

export interface WorkflowNode {
  id: ID;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge { id: ID; source: ID; target: ID; sourceHandle?: string; targetHandle?: string; label?: string }

export interface Workflow {
  id: ID;
  name: string;
  description?: string;
  category: "intake" | "discovery" | "drafting" | "research" | "compliance" | "transactional" | "operations";
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputs?: { key: string; label: string; type: "text" | "textarea" | "file" | "matter" | "select" | "number" | "date"; required?: boolean; options?: string[]; placeholder?: string }[];
  status: "draft" | "active" | "archived";
  ownerId?: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  isTemplate?: boolean;
  runsCount?: number;
  lastRunAt?: ISODate;
  tags?: string[];
}

export interface WorkflowRunStep {
  nodeId: ID;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting_approval";
  startedAt?: ISODate;
  finishedAt?: ISODate;
  input?: unknown;
  output?: unknown;
  error?: string;
  logs?: string[];
  tokens?: number;
}

export interface WorkflowRun {
  id: ID;
  workflowId: ID;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "waiting_approval";
  inputs: Record<string, unknown>;
  steps: WorkflowRunStep[];
  outputs?: Record<string, unknown>;
  startedAt: ISODate;
  finishedAt?: ISODate;
  triggeredBy: "manual" | "schedule" | "event" | "api";
  matterId?: ID;
}

// ---------------- Office & Library ----------------

export type OfficeKind = "word" | "sheet" | "slides" | "pdf";

export interface OfficeDocument {
  id: ID;
  kind: OfficeKind;
  title: string;
  matterId?: ID;
  folderId?: ID;
  /** Editor-specific content model (TipTap JSON, workbook JSON, deck JSON, PDF ops + base64 reference). */
  content: unknown;
  contentVersion: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  createdById?: ID;
  updatedById?: ID;
  templateId?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
  /** Byte size of the serialized content, for the library view. */
  size?: number;
}

export interface OfficeVersion {
  id: ID;
  docId: ID;
  version: number;
  label?: string; // "Before partner review"
  summary?: string; // "Agent edit: …"
  authorId?: ID;
  authorName?: string;
  createdAt: ISODate;
  content: unknown;
  changedFields?: number;
}

export interface OfficeComment {
  id: ID;
  docId: ID;
  anchor: string; // paragraph id / cell ref / slide id / page+rect
  quote?: string;
  body: string;
  authorId?: ID;
  authorName: string;
  createdAt: ISODate;
  resolved?: boolean;
  replies?: { id: ID; body: string; authorName: string; createdAt: ISODate }[];
  source?: "user" | "agent";
}

export type LibraryItemType = "folder" | "docx" | "xlsx" | "pptx" | "pdf" | "template" | "clause" | "link" | "note";

export interface LibraryItem {
  id: ID;
  parentId: ID | null; // null = root
  name: string;
  type: LibraryItemType;
  matterId?: ID;
  officeDocId?: ID; // for editable office documents
  description?: string;
  size?: number;
  tags?: string[];
  ownerId?: ID;
  sharedWith?: ("firm" | "matter-team" | "private")[];
  createdAt: ISODate;
  updatedAt: ISODate;
  starred?: boolean;
  content?: string; // for notes/clauses/text
  url?: string; // for links
  practiceArea?: PracticeArea;
  version?: number;
  status?: "draft" | "approved" | "archived";
}
