import type { OfficeKind } from "@/lib/types/domain";

export type OfficeAgentMode = "draft" | "review" | "ask";

/** What part of the document the agent should focus on. Editors supply these. */
export interface OfficeScope {
  id: string; // "document" | "section:abc" | "selection" | "sheet:Sheet1" | "range:A1:C10" | "slide:3" | "page:2"
  label: string; // "Whole document", "This section", "¶10", "A1:C10", "Slide 3"
  kind: "document" | "section" | "selection" | "paragraph" | "sheet" | "range" | "slide" | "page";
  ref?: string;
  /** Optional text of the scoped region for prompt context. */
  text?: string;
}

/** `stale`: the target changed after the agent read it, so the edit was refused rather than applied to different content. */
export type ProposalStatus = "pending" | "applied" | "discarded" | "failed" | "stale";

/**
 * What the agent read when it made a proposal. Editors fill whichever fields fit their model (a content hash of the
 * paragraph/slide/range, the source blob of a PDF, existing annotation ids) and refuse to apply when it no longer matches.
 */
export interface ProposalBase {
  /** Content fingerprint of the target when it was read. */
  hash?: string;
  /** Document version or revision the proposal was made against. */
  version?: string | number;
  /** PDF: the source blob the page content came from. */
  sourceBlobId?: string;
  /** PDF: annotations that existed when the proposal was made. */
  annotationIds?: string[];
}

/**
 * An edit the agent wants to make. Editors define `kind`/`payload` vocabularies
 * (e.g. word: rewrite_paragraph, insert_after, format, comment, insert_table…;
 * sheet: set_cells, set_formula, style_range, sort…; slides: add_slide, set_text…;
 * pdf: annotate, insert_text, redact, add_page…). The shared panel renders and
 * applies them through the editor's `applyProposals` callback.
 */
export interface EditProposal {
  id: string;
  kind: string;
  title: string; // "Rewrite ¶12", "Format ¶10", "Comment on ¶10", "Set B2:B14"
  summary?: string; // preview text shown under the title
  target?: string; // paragraph id / cell ref / slide id / page
  targetLabel?: string; // "¶12", "B2:B14", "Slide 3"
  payload: Record<string, unknown>;
  status: ProposalStatus;
  risk?: "low" | "medium" | "high";
  error?: string;
  /** When true the editor applies it without preview (e.g. "ask" mode never proposes). */
  autoApply?: boolean;
  /** What the agent read when it proposed this edit (stale detection). Editors may also carry it inside `payload`. */
  base?: ProposalBase;
}

export interface OfficeAgentRequestBody {
  message: string;
  attachments?: { kind: "image"; name: string; dataUrl: string }[];
  history?: { role: "user" | "assistant"; content: string }[];
  mode: OfficeAgentMode;
  scope?: OfficeScope | null;
  research?: boolean;
  snapshot: unknown;
  docId?: string;
  docTitle?: string;
  matterId?: string | null;
  /** Editor-specific extras (selection, active sheet, cursor…). */
  context?: Record<string, unknown>;
}

export interface ReviewFinding {
  id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: string; // "citation" | "defined term" | "cross-reference" | "risk" | "style" | "numbering" | "formula" | "consistency" | "missing"
  title: string;
  detail: string;
  target?: string;
  targetLabel?: string;
  suggestion?: string;
  proposalId?: string; // when a fix proposal was generated
}

export interface OfficeAgentSuggestions { draft: string[]; review: string[]; ask: string[] }

export const OFFICE_KIND_LABEL: Record<OfficeKind, string> = { word: "Document", sheet: "Workbook", slides: "Deck", pdf: "PDF" };
export const OFFICE_KIND_EXT: Record<OfficeKind, string> = { word: "docx", sheet: "xlsx", slides: "pptx", pdf: "pdf" };
