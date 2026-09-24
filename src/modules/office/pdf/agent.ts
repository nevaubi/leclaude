import "server-only";
import { diffLines } from "diff";
import { describeImage, generateJSON, generateText } from "@/lib/ai/agent";
import { extractPlainText } from "@/lib/ai/toolkit/internal";
import { createOfficeAgentHandler, type OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { OfficeAgentSuggestions } from "@/modules/office/shared/types";
import { createOfficeDoc, getOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { pdfAgentTools, type PdfToolDeps } from "./agent-tools";
import { STAMP_PRESETS, REDACTION_REASONS, activePages } from "./model";
import { ensureExtracted, extractionForModel, putLibraryItem } from "./service";
import { parseSnapshot, renderSnapshot, type PdfSnapshot } from "./snapshot";
import { PII_PATTERNS } from "./text-search";

export const PDF_SUGGESTIONS: OfficeAgentSuggestions = {
  draft: [
    "Bates-stamp MFC-0060000 onward, bottom right",
    "Redact every SSN and account number",
    "Highlight every mention of MW-7 and add a note",
    "Stamp CONFIDENTIAL on every page",
    "Summarize this order and list deadlines",
    "Bookmark each section heading",
    "Convert to Word",
  ],
  review: [
    "Check for unredacted PII and privilege markers",
    "Is this ready to produce? Check Bates, legends and redactions",
    "Flag every deadline and who owns it",
    "Compare the Schedule A requests with what was produced",
  ],
  ask: [
    "What does paragraph 12 require?",
    "Which pages mention the §8(e) notice?",
    "List the custodians and the relevant period for each",
    "What is the confidentiality tier for deposition transcripts?",
  ],
};

export function pdfInstructions(ctx: OfficeAgentContext<PdfSnapshot>): string {
  const m = ctx.snapshot.model;
  const n = activePages(m).length;
  return `PDF MODEL
- The document is ${n} page${n === 1 ? "" : "s"} of fixed PDF content. You cannot edit the underlying text; you work with annotations (highlight, underline, strikeout, sticky note, text box, stamp, redaction, bookmark), page operations (rotate, delete, reorder, insert blank), Bates numbering, headers/footers/watermarks and form fields. Every edit tool creates a previewed proposal the user applies in the editor (undoable); nothing changes the file until they export or "apply to source".
- Page numbers in tools and in your answers are DISPLAY numbers (position in the current page order, 1-based) — the same numbers the user sees in the viewer. Coordinates are PDF points; find_text returns the rectangles you can reuse.
- The snapshot shows each page's text truncated to ~2,000 characters. Read the full page with get_pages_text before quoting or annotating precise language; use find_text for exact locations. Never guess page numbers — verify with find_text.
- Redactions: add_redaction only PROPOSES boxes. Say so plainly. Text under a redaction is removed only when the user applies redactions (the editor rasterizes those pages and burns them into a new source). Never claim a redaction removed anything until the model shows it as applied. For "redact every SSN / account number / phone / email", use the PII presets (${PII_PATTERNS.map((p) => p.id).join(", ")}) and then check_pii_and_privilege to confirm coverage. Give each redaction a reason (${REDACTION_REASONS.slice(0, 5).join(", ")}…).
- Production stamping: bates_stamp with prefix/start/digits/position, plus a confidentiality legend when the protective order requires it (default legend for AFFF/Meridian material: "CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER"; AEO tier: "HIGHLY CONFIDENTIAL — ATTORNEYS' EYES ONLY"). Numbers run consecutively over active pages in display order; tell the user the first and last number. Deleted pages are skipped.
- Stamps: add_stamp for ${STAMP_PRESETS.slice(0, 6).join(", ")} or custom exhibit labels ("EXHIBIT 14", "PLAINTIFF'S EXHIBIT 7"). Exhibit stamps normally go top-right of page 1 only; confidentiality stamps go on every page.
- Highlights carry an optional note; for "highlight every mention of X and add a note" call add_highlight with the note once (it marks all matches) rather than one note per hit unless asked.
- Forms: get_form_fields lists names; fill_form takes name → value. Checkboxes are true/false; dropdowns need an existing option.
- Deadlines and obligations: when asked to list them, read every page, quote the operative language with the page number, and present a table (date · event · responsible party · source page). Compute nothing you cannot see; mark inferred dates "[VERIFY]".
- summarize_document, extract_table, compare_to_document and create_word_document use the model or the library; relay their output faithfully and add the page references. create_word_document is how you "convert to Word" or save a memo/summary; report the link.
- describe_page_image sees the page the user has open (the editor attaches it) or screenshots they paste; use it for scanned pages, signatures, stamps and handwriting.

LITIGATION PDF WORKFLOWS
- Exhibit prep: stamp the exhibit label, add a bookmark, check that Bates numbers are visible and not covered by stamps, flag privilege markers that should not be shown to a witness.
- Production: Bates sequence continuous with the prior volume, legend per protective order tier, redactions applied and reasons logged, no unredacted PII (SSN, DOB, account numbers, personal contact details), slip sheets for natives, deleted pages excluded.
- Deposition exhibits: exhibit number, deponent, date; highlight the passages counsel will read; note contradictory prior statements by page.
- Protective order tiers: Confidential (Tier 1) may go to the party; Highly Confidential – AEO (Tier 2) only to outside counsel, experts under Exhibit A and approved in-house designees. Warn when a stamp or legend is inconsistent with the tier the document carries.
- Court orders: extract deadlines, responsible parties, page limits and meet-and-confer requirements; propose bookmarks per section.
- Be precise about pages, quote exactly, and keep chat replies short (2–6 bullets). Do not paste the document into chat.

REVIEW CHECKLIST (review mode): unredacted PII and privilege markers (run check_pii_and_privilege); redaction boxes that cover less than the full string (e.g. part of an SSN); missing or wrong Bates prefix/sequence; confidentiality legend missing or inconsistent with the tier; stamps obscuring text or Bates numbers; rotated or blank pages; deleted pages that still carry cross-references; deadlines that conflict with the matter's key dates; form fields left empty; bookmarks pointing at the wrong page. Where the fix is mechanical (redact a pattern, add a legend, add a bookmark), also propose it with a tool.`;
}

/** Production dependencies for the tools (model calls, library access). */
export function productionDeps(ctx: OfficeAgentContext<PdfSnapshot>): PdfToolDeps {
  const s = ctx.snapshot;
  const pageImages: Record<number, string> = {};
  const attached = ctx.context.pageImages as Record<string, string> | undefined;
  if (attached && typeof attached === "object") for (const [k, v] of Object.entries(attached)) if (typeof v === "string" && v.startsWith("data:image/")) pageImages[Number(k)] = v;
  return {
    pageImages,
    extraction: () => extractionForModel(s.model),
    async summarize(text, focus, context) {
      const r = await generateText({
        instructions: `You are a litigation associate at Seeger Weiss LLP summarizing a PDF for a partner. Document: "${context.title}"${context.matter ? ` (matter: ${context.matter})` : ""}. Write a tight summary in markdown: a two-sentence overview, then bullets grouped by ${focus ? `the user's focus (${focus})` : "obligations, deadlines, parties and open issues"}. Cite page numbers as (p. N) using the page markers. Quote operative language sparingly and exactly. Never invent dates or facts; mark inferences [VERIFY].`,
        input: text,
        reasoningEffort: "low",
      });
      return r.text;
    },
    async extractTable(text, hint) {
      return generateJSON<{ columns: string[]; rows: string[][]; caption?: string }>({
        instructions: `Extract ${hint ? `the table described as "${hint}"` : "the main table"} from this PDF page text into columns and rows. Keep cell text exactly as written (numbers, Bates ranges, dates). If cells are ambiguous because the text lost its layout, use your best reading and keep the row count faithful. Return an empty rows array if there is no table.`,
        input: text.slice(0, 20_000),
        schema: { type: "object", properties: { caption: { type: "string" }, columns: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["columns", "rows"] },
        name: "extracted_table",
        fast: true,
      });
    },
    async describeImage(dataUrl, prompt) { return (await describeImage(dataUrl, prompt)).text; },
    async createWordDocument(title, markdown) {
      const content = markdownToDoc(markdown.replace(/^# .*\n+/, ""), { title });
      const doc = createOfficeDoc({ kind: "word", title, content, matterId: ctx.matter?.id ?? s.matterId ?? undefined, meta: { convertedFrom: s.docId, source: "pdf-agent" } });
      putLibraryItem(doc, doc.size ?? 0);
      return { id: doc.id, url: `/office/word/${doc.id}` };
    },
    async otherDocumentText(docId) {
      const doc = getOfficeDoc(docId);
      if (!doc) return null;
      if (doc.kind === "pdf") { const r = await ensureExtracted(docId); if (!r) return null; const idx = r.loaded.model.textIndex ?? []; return { title: doc.title, text: idx.map((t) => t.text).join("\n\n") }; }
      return { title: doc.title, text: extractPlainText(doc.content) };
    },
    diffTexts(a, b) {
      const parts = diffLines(normalize(a), normalize(b));
      const changes: { kind: "added" | "removed"; text: string }[] = [];
      let added = 0, removed = 0;
      for (const p of parts) {
        const lines = p.value.split("\n").filter((l) => l.trim());
        if (p.added) { added += lines.length; for (const l of lines) changes.push({ kind: "added", text: l }); }
        else if (p.removed) { removed += lines.length; for (const l of lines) changes.push({ kind: "removed", text: l }); }
      }
      return { added, removed, changes };
    },
  };
}

function normalize(t: string) { return t.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"); }

export const pdfAgentHandler = createOfficeAgentHandler<PdfSnapshot>({
  kind: "pdf",
  parseSnapshot,
  instructions: pdfInstructions,
  tools: (ctx) => pdfAgentTools(ctx, productionDeps(ctx)),
  renderSnapshot: (s, scope) => renderSnapshot(s, scope),
  maxSteps: 24,
});
