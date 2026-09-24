import "server-only";
import { generateJSON } from "@/lib/ai/agent";
import { aiConfig, getOpenAI } from "@/lib/ai/openai";
import { verifyCitationsTool } from "@/lib/ai/toolkit/legal";
import { blobs } from "@/lib/db";
import { createOfficeAgentHandler, type OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { OfficeAgentSuggestions } from "@/modules/office/shared/types";
import { wordAgentTools, type WordToolDeps } from "./agent-tools";
import { TEMPLATE_SECTIONS } from "./sections";
import { parseSnapshot, renderSnapshot, type WordSnapshot } from "./snapshot";

export const WORD_SUGGESTIONS: OfficeAgentSuggestions = {
  draft: [
    "Draft a model 8-page comprehensive mock report on the current state of the case with headings, a timeline table and next steps",
    "Tighten the Legal standard section and add FRCP 56(a)",
    "Convert the argument to a numbered outline",
    "Insert a signature block and certificate of service",
    "Add a table of contents after the caption",
    "Insert a flowchart of the procedural history",
  ],
  review: [
    "Cite-check and flag placeholders",
    "Check defined terms and cross-references",
    "Review for consistency and tone",
    "Check every heading level and list numbering",
    "What is missing for a D.S.C. filing?",
  ],
  ask: [
    "Summarize the argument",
    "What authorities are cited?",
    "What is missing for a D.S.C. filing?",
    "Which paragraphs mention the TSCA 8(e) timeline?",
  ],
};

export function wordInstructions(ctx: OfficeAgentContext<WordSnapshot>): string {
  return `DOCUMENT MODEL
- The document is a numbered list of blocks (¶n). Every block has a stable id shown as [id:xxxxxxxx]; tools take those ids. Headings define sections; use get_outline for structure and get_section(heading_id) to read a whole section. Lists show as "• L1#3" (bullet, level, position) or "§ L2#1" (legal numbering). Table cells show as "td r,c".
- Inline formatting is written in markdown in tool arguments: **bold**, *italic*, __underline__, ~~strike~~, [text](url). Never put "#" headings in rewrite_paragraph — use set_style for structure and insert_after/insert_before for new blocks (markdown there may contain # headings, lists, tables).
- Every edit tool creates a previewed proposal; the user applies them as tracked changes (insertions underlined, deletions struck). Track changes is ${ctx.snapshot.trackChangesOn ? "ON" : "OFF"}.

EDITING DISCIPLINE
- Read before you write: use get_section / get_paragraphs / find_text to see exact text and ids. Do not guess ids or paraphrase from memory.
- Prefer the smallest correct edit: replace_text_in_paragraph for a phrase, rewrite_paragraph for a whole paragraph, find_replace_all for a term used throughout. Do not rewrite paragraphs that do not need to change.
- Preserve defined terms exactly (e.g. “Agreement”, “Meridian”, “the Products”), citation form, numbering, cross-references, Bates numbers and party names. If you rename a defined term, use find_replace_all with whole_word so every instance follows.
- Keep the author's structure and voice unless asked to restructure. When restructuring, use set_style / move_block / insert_* rather than deleting and retyping.
- Batch related edits in one turn; there is no need to ask permission for each proposal — the user reviews them before applying.
- Never fabricate authority. If you need a citation you have not verified with a tool, write the proposition and add "[VERIFY]" in the text plus add_comment explaining what must be confirmed. When research is on, verify with search_case_law / get_opinion_text / verify_citations before citing, and give pin cites.
- Legal drafting conventions: Bluebook citations (italicize case names with *…*), "Id." usage, short-form cites after a full cite, section symbols with a non-breaking space (§ 1746), dates as "September 23, 2026", defined terms in quotes and parentheses on first use, numbered headings in the same style as the document, signature blocks and certificates of service at the end of filings, captions at the top. Argument headings are full-sentence, persuasive. Facts cite the record (Bates, exhibit, transcript page:line).
- Use apply_template_section for captions, signature blocks, certificates of service, TOA placeholders, verifications, proposed orders; use insert_toc_after for a table of contents; insert_table_after for tabular data; insert_diagram_after (Mermaid) for flowcharts, timelines and org charts; insert_image_after with a prompt for illustrative demonstratives; insert_footnote for footnotes.
- For "cite-check" or citation clean-up use fix_citations; for section-wide line edits use polish_section with explicit goals.
- Word count matters: when asked for length ("8-page", "two paragraphs"), plan the outline first (insert headings), then fill each section with substantive text — roughly 450–500 words per page — and never leave sections empty or with filler.
- End with a brief summary (2–6 bullets) of what changed and what needs the drafter's judgment. Do not paste the document into chat.

AVAILABLE TEMPLATE SECTIONS: ${TEMPLATE_SECTIONS.map((t) => t.id).join(", ")}.

REVIEW CHECKLIST (review mode): citations and placeholders ([VERIFY], [CITE], [DATE]); defined-term consistency and first-use definitions; cross-references (Section numbers, exhibit letters) that point nowhere; numbering and heading hierarchy; missing standard provisions for the document type (caption, signature block, certificate of service, TOA/TOC for briefs; notice, term, governing law, assignment, counterparts for agreements); factual assertions without record cites; tone and consistency (tense, party names, capitalization of defined terms); privilege / confidentiality slips; local-rule requirements (page limits, font, line spacing) when the court is known.`;
}

/** Production dependencies: image generation through the OpenAI images API, CourtListener verification, model-based polishing. */
export function productionDeps(): WordToolDeps {
  return {
    async generateImage(prompt, size) {
      const client = getOpenAI();
      const res = await client.images.generate({ model: aiConfig().imageModel, prompt: `${prompt}. Clean, professional legal demonstrative style; no text artifacts; neutral palette.`, size, n: 1 });
      const first = res.data?.[0];
      let bytes: Uint8Array | null = null;
      if (first?.b64_json) bytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
      else if (first?.url) { const r = await fetch(first.url); bytes = new Uint8Array(await r.arrayBuffer()); }
      if (!bytes) throw new Error("Image model returned no image");
      const rec = blobs.put(bytes, "image/png", { name: `generated-${Date.now()}.png`, meta: { prompt, source: "openai-images" } });
      return { url: `/api/blobs/${rec.id}`, blobId: rec.id };
    },
    async verifyCitations(text) {
      return (await verifyCitationsTool.execute({ text }, { emit: () => {}, state: {} })) as { citations: { citation: string; resolved: boolean; matches?: { case_name?: string; url?: string; date_filed?: string }[] }[] };
    },
    async polishParagraphs(paragraphs, goals, context) {
      const result = await generateJSON<{ rewrites: { id: string; markdown: string; note?: string }[] }>({
        instructions: `You are a senior litigator's line editor at Seeger Weiss LLP. Rewrite each paragraph to meet the goals while preserving meaning, defined terms, citations, numbers, dates, names and cross-references exactly. Keep inline formatting as markdown (**bold**, *italic*). Return every paragraph id; if a paragraph needs no change, return it unchanged. Add a one-line note explaining a material change.`,
        input: JSON.stringify({ document: context.title, section: context.sectionTitle, matter: context.matter, goals, paragraphs }),
        schema: { type: "object", properties: { rewrites: { type: "array", items: { type: "object", properties: { id: { type: "string" }, markdown: { type: "string" }, note: { type: "string" } }, required: ["id", "markdown"] } } }, required: ["rewrites"] },
        name: "polish_rewrites",
        reasoningEffort: "low",
      });
      return result.rewrites;
    },
  };
}

export const wordAgentHandler = createOfficeAgentHandler<WordSnapshot>({
  kind: "word",
  parseSnapshot,
  instructions: wordInstructions,
  tools: (ctx) => wordAgentTools(ctx, productionDeps()),
  renderSnapshot: (s, scope) => renderSnapshot(s, scope),
  maxSteps: 24,
});
