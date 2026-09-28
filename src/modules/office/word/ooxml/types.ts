/** Isomorphic types for imported-.docx metadata (stored in officeDoc.meta.docx). */

export interface DocxSection {
  index: number;
  /** nextPage | continuous | evenPage | oddPage */
  type: string;
  pageWidth: number; // twips
  pageHeight: number; // twips
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number; gutter?: number };
  columns: { num: number; space?: number };
  titlePage: boolean;
  headers: Partial<Record<"default" | "first" | "even", string>>;
  footers: Partial<Record<"default" | "first" | "even", string>>;
}

export interface DocxStyleInfo { id: string; name: string; type: "paragraph" | "character" | "table" | "numbering"; basedOn?: string; outlineLevel?: number; numId?: string; isDefault?: boolean }

export interface DocxNumberingLevel { ilvl: number; format: string; text: string; start: number }
export interface DocxNumberingInfo { numId: string; abstractId: string; levels: DocxNumberingLevel[] }

export interface DocxImportedComment {
  /** Editor mark id (comment mark attrs.id). */
  id: string;
  /** w:id in comments.xml. */
  sourceId: string;
  author: string;
  initials?: string;
  date?: string;
  text: string;
  /** Anchor block id (first paragraph the range touches). */
  anchor: string;
  quote?: string;
  resolved?: boolean;
  replies?: { author: string; date?: string; text: string }[];
}

export interface DocxMeta {
  version: 1;
  /** sha256 of the original package bytes (hex). */
  sha256: string;
  mainPart: string;
  sections: DocxSection[];
  styles: DocxStyleInfo[];
  numbering: DocxNumberingInfo[];
  comments: DocxImportedComment[];
  footnotes: number;
  endnotes: number;
  bookmarks: string[];
  fields: string[];
  images: number;
  trackedChanges: number;
  /** Settings the importer mapped from the first section/defaults; export keeps raw sectPr while settings equal these. */
  importedSettings: Record<string, unknown>;
  warnings: string[];
}

export function isDocxMeta(v: unknown): v is DocxMeta {
  return Boolean(v && typeof v === "object" && (v as DocxMeta).version === 1 && typeof (v as DocxMeta).sha256 === "string");
}
