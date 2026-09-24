import "server-only";
import { generateJSON } from "@/lib/ai/agent";
import { generateImage } from "@/lib/ai/images";
import { createOfficeAgentHandler, type OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { OfficeAgentSuggestions } from "@/modules/office/shared/types";
import { slidesAgentTools, type SlidesToolDeps } from "./agent-tools";
import { LAYOUT_LABEL, SLIDE_LAYOUTS, THEMES } from "./model";
import { parseSnapshot, renderSnapshot, type SlidesSnapshot } from "./snapshot";

export const SLIDES_SUGGESTIONS: OfficeAgentSuggestions = {
  draft: [
    "Build a 10-slide case strategy deck for the AFFF bellwether",
    "Turn these notes into slides",
    "Tighten every slide to ≤5 bullets",
    "Add a timeline slide from the chronology",
    "Apply the Client Light theme and add speaker notes",
    "Add a key documents slide with Bates cites",
    "Add a damages summary chart from the exposure model",
  ],
  review: [
    "Check consistency, hierarchy and overflow",
    "Is the narrative arc clear? Flag gaps",
    "Check every cite and Bates number",
    "Is this deck ready for a client audience?",
  ],
  ask: [
    "What's the narrative arc?",
    "Summarize the deck in three sentences",
    "Which slides mention the TSCA §8(e) timeline?",
    "What should the partner emphasize on the damages slide?",
  ],
};

export function slidesInstructions(ctx: OfficeAgentContext<SlidesSnapshot>): string {
  const { deck } = ctx.snapshot;
  return `DECK MODEL
- The deck is an ordered list of slides on a 1280×720 canvas. Every slide has a stable id [sl_…]; every element an id [el_…]. Tools accept slide ids or 1-based slide numbers. Placeholder roles (title, subtitle, body, left, right, leftTitle, rightTitle, quote, attribution, caption, kicker, date, number) identify the layout's text boxes; set_slide_text takes either an element id or a placeholder role.
- Text is markdown-lite: "- bullet", "  - nested bullet", "1. numbered", **bold**, *italic*. Font sizes are points. Colors may be theme tokens (accent, accent2, muted, fg, bg, surface) so the deck restyles when the theme changes.
- Layouts: ${SLIDE_LAYOUTS.map((l) => `${l} (${LAYOUT_LABEL[l]})`).join(", ")}. Themes: ${THEMES.map((t) => `${t.id}`).join(", ")}. Current theme: ${deck.theme.id}.
- Every edit tool creates a previewed proposal; the user applies them in the editor (undoable). Read before you write: use get_deck_outline / get_slide to see exact ids and text. Never guess ids.

PRESENTATION CRAFT
- One idea per slide; the title states the takeaway as a full sentence when the slide argues something ("Meridian had no §8(e) knowledge before 2001"), a noun phrase when it labels ("Key documents").
- ≤ 6 bullets per slide, ≤ 12 words per bullet, parallel grammar, no orphan sub-bullets. Body text 20–24 pt, never below 14 pt; titles 30–40 pt. If text overflows (the snapshot flags it), split_slide or condense rather than shrinking below 14 pt.
- Consistent hierarchy: same title position, same bullet style, same fonts across slides; use the layouts rather than free-floating text boxes. Add visual variety across the deck: mix bullets with a timeline, a table, a chart, a comparison and a quote — but never decoration for its own sake.
- Legal decks: case caption slide (parties, court, judge, docket, posture); a chronology/timeline slide with dated events; a key documents slide with Bates numbers and one-line significance; a damages summary (chart or table with sources); risks & recommendations (comparison layout works well); next steps with owners and dates; end with questions/contact. Mark every unverified cite or number "[VERIFY]".
- Speaker notes: presenter-facing, 40–90 words, say what to emphasize, which cite to read aloud, and the transition to the next slide.
- Use get_matter_context, search_ediscovery and search_library for facts, Bates numbers, dates and names before writing fact slides. Never fabricate citations, Bates numbers, dates or figures; if the record does not support a number, say so and mark it [VERIFY].
- generate_deck builds a full deck from an outline in one call — prefer it for "build a deck" requests (10–14 slides for a strategy deck: title → agenda → caption/posture → facts → timeline → key documents → issues → damages → risks/recommendations → next steps). For edits to an existing deck use the targeted tools (set_slide_text, add_slide, set_layout, restyle_slide, condense_deck, add_speaker_notes_all).
- When you finish, reply with a 2–6 bullet summary of what changed and what needs the presenter's judgment. Do not paste slide text into chat.

REVIEW CHECKLIST (review mode): titles that do not state the point; slides over the bullet/word limits or flagged overflow; inconsistent hierarchy (font sizes, positions, layouts) across slides; missing standard legal slides (caption, timeline, key documents, damages, risks, next steps); cites, Bates numbers and dates that need verification; narrative arc gaps (setup → tension → resolution → ask); audience mismatch (internal work product vs client vs court); missing speaker notes on argument slides; privilege/confidentiality footers. Where a fix is mechanical (restyle, split, condense, notes), also propose it with a tool.`;
}

/** Production dependencies: OpenAI image generation and model-based condensing / notes. */
export function productionDeps(): SlidesToolDeps {
  return {
    async generateImage(prompt, size) {
      const r = await generateImage(`${prompt}. Clean, professional legal presentation graphic; no text artifacts; restrained palette; high contrast.`, { size, quality: "medium", name: `slide-${Date.now()}.png` });
      return { url: r.url, blobId: r.blobId };
    },
    async condenseSlides(slides, goals, limits, context) {
      const result = await generateJSON<{ slides: { id: string; title?: string; body: string }[] }>({
        instructions: `You are a senior litigator's presentation editor at Calloway & Reyes LLP. Rewrite each slide body in markdown-lite ("- bullet" lines; "  - " for a sub-bullet; **bold** for the key term) to at most ${limits.maxBullets} bullets of at most ${limits.maxWords} words each. Preserve meaning, defined terms, citations, Bates numbers, dates and figures exactly; drop filler, merge overlapping points, keep parallel grammar. Return every slide id; keep the title unless it can state the takeaway more sharply.`,
        input: JSON.stringify({ deck: context.deckTitle, matter: context.matter, goals, slides }),
        schema: { type: "object", properties: { slides: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["id", "body"] } } }, required: ["slides"] },
        name: "condensed_slides",
        reasoningEffort: "low",
      });
      return result.slides;
    },
    async generateNotes(slides, style, context) {
      const result = await generateJSON<{ notes: { id: string; notes: string }[] }>({
        instructions: `Write presenter-facing speaker notes for each slide of a legal presentation by Calloway & Reyes LLP. Style: ${style}. 40–90 words per slide: what to emphasize, which cite or document to read aloud, one anticipated question, and the transition to the next slide. Plain text, no markdown. Never invent facts, cites or figures beyond the slide text; if a point needs verification say "[VERIFY]".`,
        input: JSON.stringify({ deck: context.deckTitle, matter: context.matter, slides }),
        schema: { type: "object", properties: { notes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, notes: { type: "string" } }, required: ["id", "notes"] } } }, required: ["notes"] },
        name: "speaker_notes",
        reasoningEffort: "low",
      });
      return result.notes;
    },
  };
}

export const slidesAgentHandler = createOfficeAgentHandler<SlidesSnapshot>({
  kind: "slides",
  parseSnapshot,
  instructions: slidesInstructions,
  tools: (ctx) => slidesAgentTools(ctx, productionDeps()),
  renderSnapshot: (s, scope) => renderSnapshot(s, scope),
  maxSteps: 24,
});
