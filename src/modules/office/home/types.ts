import type { ID, ISODate, OfficeDocument, OfficeKind, PracticeArea } from "@/lib/types/domain";

export interface OfficeDocSummary extends Omit<OfficeDocument, "content"> {
  versionCount: number;
  commentCount: number;
  matterShortName?: string;
  ownerName?: string;
  libraryItemId?: ID;
  folderName?: string;
}

export interface OfficeTemplateSummary {
  id: string;
  kind: OfficeKind;
  name: string;
  description: string;
  category: string;
  practiceArea?: PracticeArea;
  tags?: string[];
}

export interface OfficeHomeData {
  docs: OfficeDocSummary[];
  templates: OfficeTemplateSummary[];
  matters: { id: ID; shortName: string; name: string }[];
  counts: Record<OfficeKind, number>;
  aiConfigured: boolean;
  generatedAt: ISODate;
}

export const OFFICE_KINDS: OfficeKind[] = ["word", "sheet", "slides", "pdf"];

export const KIND_META: Record<OfficeKind, { label: string; plural: string; app: string; ext: string; blurb: string; accept: string }> = {
  word: { label: "Document", plural: "Documents", app: "Word", ext: "docx", blurb: "Briefs, memos, letters and agreements with tracked changes and a drafting agent.", accept: ".docx,.doc,.rtf,.md,.txt,.html" },
  sheet: { label: "Workbook", plural: "Workbooks", app: "Excel", ext: "xlsx", blurb: "Damages models, privilege logs and trackers with formulas and an analysis agent.", accept: ".xlsx,.xlsm,.xls,.csv,.tsv" },
  slides: { label: "Deck", plural: "Decks", app: "PowerPoint", ext: "pptx", blurb: "Case themes, pitches and hearing decks with layouts and a storyline agent.", accept: ".pptx" },
  pdf: { label: "PDF", plural: "PDFs", app: "PDF", ext: "pdf", blurb: "Stamp, redact, annotate and split productions with an extraction agent.", accept: ".pdf" },
};
