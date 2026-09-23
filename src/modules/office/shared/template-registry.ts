import "server-only";
import type { OfficeKind, PracticeArea } from "@/lib/types/domain";
import { WORD_TEMPLATES } from "@/modules/office/word/templates";
import { SHEET_TEMPLATES } from "@/modules/office/sheet/templates";
import { SLIDES_TEMPLATES } from "@/modules/office/slides/templates";
import { PDF_TEMPLATES } from "@/modules/office/pdf/templates";

export interface OfficeTemplate {
  id: string;
  kind: OfficeKind;
  name: string;
  description: string;
  category: string; // "Litigation", "Transactional", "Internal", "Finance"…
  practiceArea?: PracticeArea;
  tags?: string[];
  /** Build the initial content model. */
  build: (ctx: { matterId?: string; title?: string }) => unknown;
}

export function allTemplates(): OfficeTemplate[] {
  return [...WORD_TEMPLATES, ...SHEET_TEMPLATES, ...SLIDES_TEMPLATES, ...PDF_TEMPLATES];
}

export function getTemplate(id: string) {
  return allTemplates().find((t) => t.id === id) ?? null;
}
