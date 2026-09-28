import "server-only";
import { diffLines } from "diff";
import { describeImage, generateJSON, generateText } from "@/lib/ai/agent";
import { extractPlainText } from "@/lib/ai/toolkit/internal";
import { currentPrincipal } from "@/lib/auth/context";
import { can } from "@/lib/auth/policy";
import { refs } from "@/lib/auth/resources";
import { createOfficeAgentHandler, type OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { OfficeAgentSuggestions } from "@/modules/office/shared/types";
import { createOfficeDoc, getOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { mergePdfs } from "./apply";
import { pdfAgentTools, type PdfToolDeps } from "./agent-tools";
import { STAMP_PRESETS, REDACTION_REASONS, type PdfPage } from "./model";
import { OCR_UNAVAILABLE_MESSAGE } from "./ocr";
import { ensureExtracted, extractionForModel, putLibraryItem, safeName, sourceBytes, splitToNewDocument } from "./service";
import { blobs } from "@/lib/db";
import { parseSnapshot, renderSnapshot, type PdfSnapshot } from "./snapshot";
import { PII_PATTERNS } from "./text-search";

export const PDF_SUGGESTIONS: OfficeAgentSuggestions = {
  draft: [
    "Bates-stamp ABC-0000001 onward, bottom right",
    "Find every SSN, DOB, account number, e-mail and phone number and redact them",
    "Highlight every mention of MW-7 and add a note",
    "Bookmark each section heading",
    "Fill the acknowledgment form and flatten it",
    "Split pages 1-3 into a new PDF",
    "Draft a privilege log entry for this document",
  ],
  review: [
    "Check for unredacted PII and privilege markers",
    "Is this ready to produce? Check Bates, legends and redactions",
    "Flag every deadline and who owns it",
    "Highlight every defined term that is used before it is defined",
  ],
  ask: [
    "Summarize this with page citations",
    "What does paragraph 12 require? Quote it",
    "Which pages mention the §8(e) notice?",
    "Extract the table on page 3",
  ],
};

/**
 * Stable editor instructions (identical for every PDF and turn, so the prompt prefix caches); everything that
 * varies — page count, labels, OCR state, annotations, text — is in the snapshot that follows.
 */
export function pdfInstructions(ctx: OfficeAgentContext<PdfSnapshot>): string {
  const mode = ctx.mode;
  return `PDF MODEL
- The PDF is fixed content. Its original bytes are never re-rendered: every change (annotations, redactions, Bates, form values, page operations, bookmarks, properties) is applied to the original file with pdf-lib when the user exports or applies edits. Every edit tool creates a previewed proposal the user applies in the editor (undoable); proposals made against an older version of the file are rejected as stale.
- Page numbers in tools and in your answers are DISPLAY numbers (position in the current page order, 1-based) — the same numbers the user sees in the viewer. Coordinates are PDF points (origin bottom-left); search_text returns rectangles and QuadPoints you can reuse.
- The snapshot shows each page's text truncated to ~2,000 characters. Read the full page with get_pages_text before quoting or annotating precise language; use search_text for exact locations. Never guess page numbers.
- ACCURACY: every factual statement about the document cites its page as (p. N). Quote exactly; verify each quote with verify_quote (or use summarize_with_page_cites, whose quotes are verified by code) and drop any quote that is not verified. If the document does not answer the question, say "the document does not establish this" — do not infer.
- NEEDS OCR: pages marked "needs OCR" are image-only scans with no machine-readable text. ${OCR_UNAVAILABLE_MESSAGE} Never quote, summarize or characterize their content from text; say they need OCR. describe_page_image gives a visual description only when a rendering is attached, and it is not verified text.
- Existing annotations: annotations marked "in PDF" already exist in the file (made in Acrobat/Preview or applied earlier); they round-trip untouched unless removed.

REDACTION (true redaction)
- redact_pattern (preview → apply) for PII sweeps: presets ${PII_PATTERNS.map((p) => p.id).join(", ")} plus a custom regex. Preview first and show the user the matches; then apply. redact_region for signatures, photos, handwriting or whole blocks; add_redaction for a literal/regex.
- Redaction tools only PROPOSE boxes. When the user applies them, the text under each box is removed from the page content stream (pages where that is unsafe — an image under a box — are rasterized and reported), annotations/form fields/metadata repeating it are scrubbed, and the output is re-extracted to verify the text is gone. Say this plainly; never claim anything was removed before the user applied it.
- Give each redaction a reason (${REDACTION_REASONS.slice(0, 5).join(", ")}…). After proposing, run check_pii_and_privilege to confirm coverage.

PRODUCTION
- bates_stamp with prefix/start/digits/position/font and an optional page range. Add a confidentiality endorsement (legend) ONLY when the user asked for one or the protective order they cite requires it (Confidential tier: "CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER"; AEO tier: "HIGHLY CONFIDENTIAL — ATTORNEYS' EYES ONLY"). Tell the user the first and last number. Deleted pages are skipped.
- Stamps: add_stamp for ${STAMP_PRESETS.slice(0, 6).join(", ")} or exhibit labels ("EXHIBIT 14"). Exhibit stamps normally go top-right of page 1 only.
- privilege_log_entry drafts a log entry from header fields and metadata without disclosing substance; it always requires attorney review. An attorney merely copied on a business e-mail is not a privilege basis.

PAGES, FORMS, OUTLINE
- rotate_pages / delete_pages / reorder_pages / insert_blank_page change this document; split_pdf and extract_pages create NEW documents (this one is unchanged); merge_pdfs appends other library PDFs by id.
- list_form_fields → fill_form (checkboxes true/false; dropdown/radio need an existing option) → flatten_form only when asked.
- add_bookmarks detects headings deterministically; add_bookmark for a single entry. Bookmarks are appended after the file's own outline.
- set_metadata for Title/Author/Subject/Keywords; never put privileged or redacted text there.
- extract_table is deterministic from text positions (method "layout"); a "model" result is a reading of unaligned text and must be checked.

LITIGATION PDF WORKFLOWS
- Exhibit prep: stamp the exhibit label, add a bookmark, check that Bates numbers are visible and not covered by stamps, flag privilege markers that should not be shown to a witness.
- Production: Bates sequence continuous with the prior volume, endorsement per protective order tier, redactions applied and reasons logged, no unredacted PII (SSN, DOB, account numbers, personal contact details), deleted pages excluded.
- Court orders: extract deadlines (date · event · responsible party · page), page limits and meet-and-confer requirements; compute nothing you cannot see; mark inferred dates "[VERIFY]".
- Keep chat replies short (2–6 bullets) with page cites. Do not paste the document into chat.

MODE TOOLSET: ${mode === "ask" ? "ASK — read-only tools only; no tool here can change the document." : mode === "review" ? "REVIEW — read tools plus annotation tools (add_highlight, highlight_matches, add_note) and report_finding; you cannot redact, stamp, change pages, forms or properties." : "DRAFT — all tools."}

REVIEW CHECKLIST (review mode): unredacted PII and privilege markers (check_pii_and_privilege); redaction boxes that cover less than the full string; missing or wrong Bates prefix/sequence; endorsement missing or inconsistent with the tier; stamps obscuring text or Bates numbers; rotated or blank pages; image-only pages that need OCR before production review; deadlines that conflict with the matter's key dates; form fields left empty; bookmarks pointing at the wrong page.`;
}

/** The principal may read the other office document (fails closed without a principal). */
function mayRead(docId: string): boolean {
  const principal = currentPrincipal();
  return Boolean(principal && can(principal, "read", refs.officeDoc(docId)));
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
        instructions: `You are a litigation associate summarizing a PDF for a partner. Document: "${context.title}"${context.matter ? ` (matter: ${context.matter})` : ""}. Write a tight summary in markdown: a two-sentence overview, then bullets grouped by ${focus ? `the user's focus (${focus})` : "obligations, deadlines, parties and open issues"}. Cite page numbers as (p. N) using the page markers. Quote operative language sparingly and exactly. Never invent dates or facts; mark inferences [VERIFY].`,
        input: text,
        reasoningEffort: "low",
      });
      return r.text;
    },
    async summarizeCited(text, focus, context) {
      return generateJSON<{ bullets: { text: string; page: number; quote: string }[] }>({
        instructions: `Summarize this PDF ("${context.title}"${context.matter ? `, matter ${context.matter}` : ""}) as 4–12 bullets${focus ? ` focused on: ${focus}` : " covering obligations, deadlines, parties and open issues"}. Each bullet: "text" (one sentence), "page" (the number from the "--- Page N ---" marker where the support is), and "quote" (an EXACT, contiguous excerpt of 5–30 words copied verbatim from that page that supports the bullet). Do not paraphrase inside "quote". Omit points you cannot support with a quote.`,
        input: text,
        schema: { type: "object", properties: { bullets: { type: "array", items: { type: "object", properties: { text: { type: "string" }, page: { type: "integer" }, quote: { type: "string" } }, required: ["text", "page", "quote"] } } }, required: ["bullets"] },
        name: "cited_summary",
        reasoningEffort: "low",
      });
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
      if (!mayRead(docId)) return null; // unauthorized reads look like "not found"
      const doc = getOfficeDoc(docId);
      if (!doc) return null;
      if (doc.kind === "pdf") { const r = await ensureExtracted(docId); if (!r) return null; const idx = r.loaded.model.textIndex ?? []; return { title: doc.title, text: idx.filter((t) => !t.needsOcr).map((t) => t.text).join("\n\n") }; }
      return { title: doc.title, text: extractPlainText(doc.content) };
    },
    async splitDocument(displayPages, title) {
      if (!s.docId) throw new Error("This document is not saved yet");
      const r = await splitToNewDocument(s.docId, displayPages, title);
      if (!r) throw new Error("Document not found");
      return { id: r.doc.id, url: r.url, title: r.doc.title, pages: displayPages.length };
    },
    async mergeDocuments(docIds) {
      const src = sourceBytes(s.model);
      if (!src) throw new Error("Source PDF bytes are missing");
      const others: { bytes: Uint8Array; name: string }[] = [];
      for (const id of docIds) {
        const doc = mayRead(id) ? getOfficeDoc(id) : null;
        if (!doc || doc.kind !== "pdf") throw new Error(`PDF ${id} not found`);
        const r = await ensureExtracted(id);
        const ob = r ? sourceBytes(r.loaded.model) : null;
        if (!ob) throw new Error(`Source bytes of ${doc.title} are missing`);
        others.push({ bytes: ob.bytes, name: doc.title });
      }
      const { bytes, added } = await mergePdfs(src.bytes, others.map((o) => o.bytes), others.map((o) => o.name));
      const rec = blobs.put(bytes, "application/pdf", { name: `${safeName(s.title)}.pdf`, meta: { kind: "pdf", mergedFrom: [src.id, ...docIds] } });
      const base = s.model.pageCount;
      const pages: PdfPage[] = added.map((p, i) => ({ id: `pg_${base + i + 1}`, index: base + i + 1, rotation: 0, width: p.width, height: p.height, order: 0 }));
      return { sourceBlobId: rec.id, pageCount: base + added.length, pages, names: others.map((o) => o.name) };
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

