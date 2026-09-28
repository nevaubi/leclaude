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
import { getVersion, listVersions } from "@/modules/office/shared/docs-service";
import type { PMNode } from "./doc-model";

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
    "Which paragraphs discuss the notice deadline?",
  ],
};

/**
 * Stable Word instructions (identical for every turn of a mode, so the provider can cache the prefix). Volatile
 * state — track-changes toggle, page setup, selection, the document itself — lives in the snapshot block.
 */
export function wordInstructions(ctx: OfficeAgentContext<WordSnapshot>): string {
  void ctx;
  return WORD_INSTRUCTIONS;
}

const WORD_INSTRUCTIONS = `DOCUMENT MODEL
- The document is a numbered list of blocks (¶n) with stable ids [id:xxxxxxxx]; tools take those ids. Headings define sections. The snapshot below is COMPACT: outline plus one-line previews; exact text is NOT in context for long documents.
- Lists show as "• L1#3" (bullet, level, position) or "§ L2#1" (legal numbering). Table cells show as "td r,c". "style:X" is the Word paragraph style of an imported .docx; "fields" marks TOC/REF/PAGE fields.
- Inline formatting in tool arguments is markdown: **bold**, *italic*, __underline__, ~~strike~~, [text](url). Never put "#" in rewrite_paragraph — use set_heading_level / apply_style for structure and insert_after/insert_before for new blocks (markdown there may contain # headings, lists, tables).
- Every edit tool creates a previewed proposal bound to the text you read (a content hash); if the user changes that text first, the proposal is rejected as stale instead of overwriting their edit.

HOW TO WORK FAST AND ACCURATELY
- Read before you write, and read narrowly: get_outline for structure, then get_section or get_paragraphs with ranges/ids for exactly the blocks you will touch. Issue independent reads in the SAME turn (they run in parallel); do not re-read what you already have.
- Smallest correct edit: replace_text_in_paragraph for a phrase, rewrite_paragraph for a paragraph, find_replace for a term used throughout (preview=true first, then expected_count). Do not rewrite paragraphs that need no change.
- After proposing edits, call verify_edits once and fix what it reports. Batch related edits in one turn; the user reviews proposals before applying.
- Preserve defined terms exactly (“Agreement”, “Company”), citation form, numbering, cross-references, Bates numbers, party names and the author's voice.
- Never fabricate authority, facts, names, bar numbers or dates. If a citation is not verified with a tool, write the proposition, add "[VERIFY]" and an insert_comment explaining what must be confirmed. With research on, verify (search_case_law / get_opinion_text / verify_citations) before citing and give pin cites.
- Bluebook form: italicized case names (*…*), "Id." usage, short forms after a full cite, "§ 1746" with a space, dates like "September 23, 2026", defined terms in quotes and parentheses on first use, full-sentence persuasive argument headings, record cites (Bates, exhibit, page:line) for facts.

TOOLS BY TASK
- Structure: set_heading_level, apply_style (app styles or the document's Word styles from get_styles), move_block, numbering_fix (restart/continue lists), insert_table / edit_table_cell / merge_cells, insert_page_break_after, set_page_setup (orientation/margins/section break).
- Legal blocks: legal_caption (from the matter record; missing fields stay [PLACEHOLDERS]), signature_block, apply_template_section (certificate of service, TOA, verification, proposed order, definitions, exhibit list), insert_toc (real TOC field), insert_cross_reference (REF field to a heading), update_fields, insert_footnote (footnote or endnote).
- Review: check_defined_terms and check_citations are deterministic and flag only; fix_citations proposes normalizations and [VERIFY] comments; insert_comment / resolve_comment; get_tracked_changes then accept_reject_changes (by author, section or ids); redline_compare against a saved version or pasted text; polish_section for section-wide line edits with explicit goals; insert_diagram_after (Mermaid) and insert_image_after for demonstratives.
- Length requests ("8-page", "two paragraphs"): plan headings first, then fill each section with substantive text (~450–500 words per page), never filler.
- End with 2–6 bullets: what changed and what needs the drafter's judgment. Do not paste the document into chat.

MODES
- Draft: all tools. Review: comments and tracked-change suggestions only (rewrite/replace/insert/delete are applied as tracked changes; formatting and structure tools are unavailable); record each issue with report_finding. Ask: read-only — answer with ¶ references; no edit tools exist in this mode.

REVIEW CHECKLIST: citations and placeholders ([VERIFY], [CITE], [DATE]); defined terms (check_defined_terms); cross-references that point nowhere; numbering and heading hierarchy; missing standard provisions for the document type (caption, signature block, certificate of service, TOA/TOC for briefs; notice, term, governing law, assignment, counterparts for agreements); factual assertions without record cites; tone and consistency; privilege / confidentiality slips; local-rule requirements (page limits, font, spacing) when the court is known.

AVAILABLE TEMPLATE SECTIONS: ${TEMPLATE_SECTIONS.map((t) => t.id).join(", ")}.`;

const WORD_REVIEW_GUIDANCE = `MODE: REVIEW. Do not restructure or reformat the document. Read the parts in scope (get_outline, then get_section / get_paragraphs), run check_defined_terms and check_citations where relevant, and record each issue with report_finding (severity, category, the block id as target, a concrete suggestion). Where a fix is a safe wording change, also propose it — review edits are always tracked changes (rewrite_paragraph, replace_text_in_paragraph, find_replace, insert/delete) or margin comments (insert_comment). Finish with a short prioritized summary.`;

export type WordRequestTier = "quick" | "standard" | "deep";

/**
 * Deterministic request classifier (no model call): short, targeted edits and questions run with low reasoning
 * effort and a small step budget; drafting, whole-document review and redlines get more.
 */
export function classifyWordRequest(message: string, mode: "draft" | "review" | "ask", scope?: { kind?: string } | null): { tier: WordRequestTier; reasoningEffort: "low" | "medium" | "high"; maxSteps: number } {
  const m = message.toLowerCase();
  const deep = /\b(draft|write|compose|prepare|comprehensive|entire|whole document|all sections|full review|redline|compare|restructure|reorganize|\d+[- ]page|memo|brief|motion|outline the|table of authorities|cite-?check)\b/.test(m) || message.length > 600;
  const quick = !deep && message.length < 200 && (mode === "ask" || /\b(fix|typo|bold|italic|underline|rename|replace|change|make .* (a )?heading|heading|align|center|capitali[sz]e|delete|remove|add (a )?comment|footnote|page break|insert (a )?(date|signature|caption)|resolve|accept|reject|restart|continue numbering|what|where|which|how many|summari[sz]e)\b/.test(m) || scope?.kind === "paragraph" || scope?.kind === "selection");
  if (deep) return { tier: "deep", reasoningEffort: "high", maxSteps: 32 };
  if (quick) return { tier: "quick", reasoningEffort: "low", maxSteps: 10 };
  return { tier: "standard", reasoningEffort: "medium", maxSteps: 24 };
}

/** Production dependencies: image generation, CourtListener verification, model-based polishing, version history. */
export function productionDeps(docId?: string): WordToolDeps {
  return {
    async listVersions() { return docId ? listVersions(docId).map((v) => ({ id: v.id, version: v.version, label: v.label, createdAt: v.createdAt })) : []; },
    async loadVersion(versionId) { if (!docId) return null; const v = getVersion(docId, versionId); return v ? { content: v.content as PMNode, label: v.label, version: v.version } : null; },
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
        instructions: `You are a senior litigator's line editor at a litigation firm. Rewrite each paragraph to meet the goals while preserving meaning, defined terms, citations, numbers, dates, names and cross-references exactly. Keep inline formatting as markdown (**bold**, *italic*). Return every paragraph id; if a paragraph needs no change, return it unchanged. Add a one-line note explaining a material change.`,
        input: JSON.stringify({ document: context.title, section: context.sectionTitle, matter: context.matter, goals, paragraphs }),
        schema: { type: "object", properties: { rewrites: { type: "array", items: { type: "object", properties: { id: { type: "string" }, markdown: { type: "string" }, note: { type: "string" } }, required: ["id", "markdown"] } } }, required: ["rewrites"] },
        name: "polish_rewrites",
        reasoningEffort: "low",
      });
      return result.rewrites;
    },
  };
}

/** Code-decided routing for one request: quick turns run on the fast model role with a small step budget. */
export function routeWordRequest(ctx: Pick<OfficeAgentContext<WordSnapshot>, "mode" | "scope">, message: string) {
  const c = classifyWordRequest(message, ctx.mode, ctx.scope);
  return { fast: c.tier === "quick", reasoningEffort: c.reasoningEffort, maxSteps: c.maxSteps, reason: `word:${c.tier}` };
}

export const wordAgentHandler = createOfficeAgentHandler<WordSnapshot>({
  kind: "word",
  parseSnapshot,
  instructions: wordInstructions,
  tools: (ctx) => wordAgentTools(ctx, productionDeps(ctx.docId)),
  renderSnapshot: (s, scope) => renderSnapshot(s, scope),
  // wordAgentTools enforces modes itself (Ask = read tools only, Review = read + suggestion tools).
  modeScopedTools: true,
  modeGuidance: { review: WORD_REVIEW_GUIDANCE },
  maxSteps: 24,
  route: routeWordRequest,
});
