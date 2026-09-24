import type { ID, ISODate, LibraryItem, LibraryItemType, OfficeKind, PracticeArea } from "@/lib/types/domain";

export type LibraryView = "folder" | "starred" | "recent" | "shared" | "all";

export type ClauseCategory =
  | "indemnity"
  | "limitation of liability"
  | "confidentiality"
  | "choice of law / forum"
  | "force majeure"
  | "assignment"
  | "termination"
  | "PFAS discovery definitions"
  | "deposition stipulations"
  | "protective order tiers"
  | "M&A definitions";

export const CLAUSE_CATEGORIES: ClauseCategory[] = [
  "indemnity",
  "limitation of liability",
  "confidentiality",
  "choice of law / forum",
  "force majeure",
  "assignment",
  "termination",
  "PFAS discovery definitions",
  "deposition stipulations",
  "protective order tiers",
  "M&A definitions",
];

export type ClauseStance = "pro-client" | "neutral" | "pro-counterparty";

export interface ClauseVariable {
  name: string; // "Party A"
  description?: string;
  example?: string;
}

/** Module-private metadata for clause-bank items (collection "library_clause_meta", keyed by item id). */
export interface ClauseMeta {
  id: ID; // library item id
  category: ClauseCategory;
  variables: ClauseVariable[];
  stance: ClauseStance;
  governingLaw?: string;
  /** Drafting notes / negotiation history shown next to the clause. */
  notes?: string;
  /** Id of the firm-standard clause this one is a variant of (for "Compare to standard"). */
  standardId?: ID;
  lastReviewedAt?: ISODate;
  reviewedBy?: string;
  useCount?: number;
}

export type ActivityAction =
  | "created" | "updated" | "renamed" | "moved" | "starred" | "unstarred" | "deleted" | "duplicated" | "shared" | "uploaded" | "summarized" | "inserted" | "tagged" | "restored" | "indexed";

export interface ActivityEntry {
  id: ID;
  itemId: ID;
  itemName: string;
  actorId: ID;
  actorName: string;
  action: ActivityAction;
  detail?: string;
  at: ISODate;
}

export interface LibraryItemVersion {
  id: ID;
  itemId: ID;
  version: number;
  content: string;
  authorName: string;
  summary?: string;
  at: ISODate;
}

export interface PathSegment { id: ID; name: string }

/** What the API returns for every item: the stored record plus denormalized display fields. */
export interface LibraryItemView extends LibraryItem {
  ownerName?: string;
  matterName?: string;
  matterShortName?: string;
  path: PathSegment[];
  clause?: ClauseMeta;
  officeKind?: OfficeKind;
  /** Folders only: number of direct children. */
  childCount?: number;
  /** Short text preview (notes, clauses, office docs). */
  excerpt?: string;
  /** Templates: the office template id encoded in the url. */
  templateId?: string;
  contentVersion?: number;
}

export interface FolderNode {
  id: ID;
  name: string;
  parentId: ID | null;
  depth: number;
  /** Direct non-folder children. */
  count: number;
  /** All non-folder descendants. */
  totalCount: number;
  children: FolderNode[];
  matterId?: ID;
  system: boolean;
  description?: string;
}

export interface LibraryTreeResponse {
  roots: FolderNode[];
  views: { starred: number; recent: number; shared: number; all: number };
  matters: { id: ID; shortName: string; name: string; practiceArea: PracticeArea; folderId: ID }[];
  people: { id: ID; name: string }[];
  tags: { tag: string; count: number }[];
  practiceAreas: PracticeArea[];
  index: { docs: number; chunks: number; embedded: number; officeDocs: number; officeEmbedded: number };
  aiConfigured: boolean;
}

export type LibrarySort = "name" | "updated" | "created" | "size" | "type";

export interface LibraryFilters {
  view?: LibraryView;
  folder?: ID | null;
  matterId?: string;
  type?: LibraryItemType | "office";
  practiceArea?: PracticeArea;
  tag?: string;
  ownerId?: string;
  from?: string; // YYYY-MM-DD (updatedAt >=)
  to?: string; // YYYY-MM-DD (updatedAt <=)
  q?: string;
  sort?: LibrarySort;
  dir?: "asc" | "desc";
  status?: LibraryItem["status"];
}

export interface LibraryListResponse {
  items: LibraryItemView[];
  folder: LibraryItemView | null;
  breadcrumbs: PathSegment[];
  total: number;
  view: LibraryView;
}

export interface LibrarySearchHit {
  item: LibraryItemView;
  score: number;
  passage: string;
  source: "library" | "office";
  semantic?: number;
  keyword?: number;
}

export interface LibrarySearchResponse {
  hits: LibrarySearchHit[];
  query: string;
  took: number;
  mode: "hybrid" | "keyword";
}

export interface LibraryItemDetail {
  item: LibraryItemView;
  activity: ActivityEntry[];
  versions: Omit<LibraryItemVersion, "content">[];
  children?: LibraryItemView[];
  office?: { id: ID; kind: OfficeKind; title: string; contentVersion: number; updatedAt: ISODate; versionCount: number; commentCount: number; words: number; text: string } | null;
  standard?: LibraryItemView | null;
}

export interface CreateItemInput {
  type: Exclude<LibraryItemType, "docx" | "xlsx" | "pptx" | "pdf" | "template"> | "template";
  name: string;
  parentId?: ID | null;
  matterId?: ID;
  content?: string;
  url?: string;
  description?: string;
  tags?: string[];
  practiceArea?: PracticeArea;
  sharedWith?: LibraryItem["sharedWith"];
  size?: number;
  clause?: Partial<Omit<ClauseMeta, "id">>;
  status?: LibraryItem["status"];
}

export interface UpdateItemInput {
  name?: string;
  parentId?: ID | null;
  content?: string;
  url?: string;
  description?: string;
  tags?: string[];
  practiceArea?: PracticeArea | null;
  sharedWith?: LibraryItem["sharedWith"];
  starred?: boolean;
  status?: LibraryItem["status"];
  matterId?: ID | null;
  clause?: Partial<Omit<ClauseMeta, "id">>;
  restoreVersion?: number;
  versionSummary?: string;
}

export const TYPE_LABEL: Record<LibraryItemType, string> = {
  folder: "Folder",
  docx: "Word document",
  xlsx: "Workbook",
  pptx: "Deck",
  pdf: "PDF",
  template: "Template",
  clause: "Clause",
  link: "Link",
  note: "Note",
};

export const OFFICE_KIND_BY_TYPE: Partial<Record<LibraryItemType, OfficeKind>> = { docx: "word", xlsx: "sheet", pptx: "slides", pdf: "pdf" };
export const TYPE_BY_OFFICE_KIND: Record<OfficeKind, LibraryItemType> = { word: "docx", sheet: "xlsx", slides: "pptx", pdf: "pdf" };

export const PRACTICE_AREAS: PracticeArea[] = ["Litigation", "Products Liability", "Commercial", "Corporate / M&A", "Employment", "Regulatory", "IP", "Real Estate"];

/** File extensions the office importer understands (routed to /api/office/import). */
export const OFFICE_IMPORT_EXTENSIONS = new Set(["docx", "doc", "rtf", "md", "txt", "html", "xlsx", "xlsm", "xls", "csv", "tsv", "pptx", "pdf"]);
