import "server-only";
import { generateJSON } from "@/lib/ai/agent";
import { generateImage } from "@/lib/ai/images";
import { blobs, db } from "@/lib/db";
import { createOfficeAgentHandler, type OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { OfficeAgentSuggestions } from "@/modules/office/shared/types";
import { slidesAgentTools, type SlidesDataAccess, type SlidesToolDeps } from "./agent-tools";
import type { ExhibitDoc } from "./deck-builders";
import { LAYOUT_LABEL, SLIDE_LAYOUTS, THEMES } from "./model";
import { parseSnapshot, renderSnapshot, type SlidesSnapshot } from "./snapshot";

export const SLIDES_SUGGESTIONS: OfficeAgentSuggestions = {
  draft: [
    "Build a 10-slide case strategy deck for this matter",
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
    "Which slides mention the key dates?",
    "What should the partner emphasize on the damages slide?",
  ],
};

/**
 * Editor instructions. Deliberately independent of the deck (no titles, theme or counts) so the instruction + tool
 * prefix stays byte-stable across turns and decks and is served from the prompt cache; the volatile deck state
 * arrives in the snapshot block after it.
 */
export function slidesInstructions(ctx: OfficeAgentContext<SlidesSnapshot>): string {
  void ctx;
  return SLIDES_INSTRUCTIONS;
}

const SLIDES_INSTRUCTIONS = `DECK MODEL
- The deck is an ordered list of slides on a 1280×720 canvas. Every slide has a stable id [sl_…]; every element an id [el_…]. Tools accept slide ids or 1-based slide numbers. Placeholder roles (title, subtitle, body, left, right, leftTitle, rightTitle, quote, attribution, caption, kicker, date, number) identify text boxes; imported PowerPoint slides also carry the template placeholder (type/idx).
- The snapshot below is a compact OUTLINE: each slide's title and placeholders with element ids, word counts, bullet counts and overflow flags. It has no geometry or full text except for the focused slide. Read before you write: get_slides for several slides in one call (preferred), get_slide for one. Never guess ids. Issue independent reads together in one step.
- Text is markdown-lite: "- bullet", "  - nested bullet", "1. numbered", **bold**, *italic*. Font sizes are points. Colors may be theme tokens (accent, accent2, muted, fg, bg, surface) so the deck restyles when the theme changes.
- Built-in layouts: ${SLIDE_LAYOUTS.map((l) => `${l} (${LAYOUT_LABEL[l]})`).join(", ")}. Built-in themes: ${THEMES.map((t) => t.id).join(", ")}.
- Imported PowerPoint decks keep their template: add slides with add_slide_from_layout (layout names from get_layouts), fill placeholders with set_placeholder_text, restyle colors/fonts with restyle_deck (rewrites the template's theme on export). Avoid set_layout / restyle_slide on imported slides unless the user wants the slide rebuilt.
- Every edit tool creates a previewed proposal bound to the version of the slide/element it read; the user applies it in the editor (undoable). If the user changes that slide first, the proposal is rejected as stale — read again and redo it.

VERIFY BEFORE FINISHING
- Text-changing tools return a "verify" list from a deterministic text-fit check against the box. "fixed" means a grow/shrink fix was proposed with it; "overflow" means it still does not fit at the minimum size — condense it with rewrite_for_brevity (fast model) or split_slide. Never leave overflow.
- After a batch of edits run check_consistency once and fix real outliers (title size/font/position, body size, overflow, density).

PRESENTATION CRAFT
- One idea per slide; the title states the takeaway as a full sentence when the slide argues something ("The company had no notice of the defect before 2019"), a noun phrase when it labels ("Key documents").
- ≤ 6 bullets per slide, ≤ 12 words per bullet, parallel grammar, no orphan sub-bullets. Body text 20–24 pt, never below 14 pt; titles 30–40 pt.
- Consistent hierarchy: same title position, same bullet style, same fonts across slides; use layouts rather than free-floating boxes. Vary the deck with a timeline, a table, a chart, a comparison and a quote where the content supports it — never decoration for its own sake.
- Legal decks: case caption slide (parties, court, judge, docket, posture); chronology (timeline_slide builds it from the matter chronology with cites); key documents with Bates numbers (exhibit_slide builds a callout for one Bates number and verifies quotes against the document text); damages (chart or table with sources); risks & recommendations (comparison); next steps with owners and dates; questions/contact. Mark every unverified cite or number "[VERIFY]".
- Never fabricate citations, Bates numbers, dates or figures. Use get_matter_context, search_ediscovery and search_library for facts. An unresolved Bates number is reported as unresolved — never replaced by a similar document.
- Speaker notes: presenter-facing, 40–90 words: what to emphasize, which cite to read aloud, the transition. add_speaker_notes (one slide) / add_speaker_notes_all.

BUILDING DECKS
- "Turn this outline into slides" → outline_to_deck (layouts chosen deterministically, reasons returned). "Make a deck from this memo/brief" → deck_from_document (Word doc id, library item id, or pasted markdown; bullets are quoted from the source). Full DSL with charts/tables/timelines → generate_deck. Strategy deck: 10–14 slides, title → agenda → caption/posture → facts → timeline → key documents → issues → damages → risks/recommendations → next steps.
- For edits to an existing deck use the targeted tools (set_placeholder_text, set_slide_text, rewrite_for_brevity, fit_text, add_slide_from_layout, reorder_slides, duplicate_slide, delete_slide, insert_table, insert_chart, insert_image, restyle_deck).
- When you finish, reply with a 2–6 bullet summary of what changed and what needs the presenter's judgment. Do not paste slide text into chat.

REVIEW MODE: comment only — add_review_comment on the slide (or report_finding) for: titles that do not state the point; slides over the bullet/word limits or with overflow (check_text_fit); inconsistent hierarchy (check_consistency); missing standard legal slides; cites, Bates numbers and dates that need verification; narrative arc gaps (setup → tension → resolution → ask); audience mismatch; missing speaker notes on argument slides; privilege/confidentiality footers. No edits in review mode.
ASK MODE: answer from the deck with slide references; read-only tools only.`;

/** Deterministic JSON schema helpers for the fast-model calls (stable instructions → cacheable prefix). */
const REWRITE_INSTRUCTIONS = "You are a senior litigator's presentation editor. Rewrite the given slide text box in markdown-lite (\"- bullet\" lines; \"  - \" for a sub-bullet; **bold** for the key term) within the given bullet and word limits. Preserve meaning, defined terms, citations, Bates numbers, dates and figures exactly; never add facts; drop filler, merge overlapping points, keep parallel grammar. If the text is a title or a single sentence, return one tighter sentence without a bullet.";

/**
 * Server data access for matter-aware tools. The deck's matter is resolved from the stored document (the route
 * already authorized the principal for that document and any requested matter); without a stored document the
 * request's authorized matter is used. Every accessor returns only records; the tools enforce matter binding.
 */
export function serverDataAccess(ctx: OfficeAgentContext<SlidesSnapshot>): SlidesDataAccess {
  const matterId = () => {
    const doc = ctx.docId ? db().officeDocs.get(ctx.docId) : null;
    if (doc) return doc.matterId ?? null;
    return ctx.matter?.id ?? null;
  };
  const batesNum = (b: string) => { const m = /^(.*?)(\d+)$/.exec(b.trim()); return m ? { prefix: m[1].toUpperCase(), n: Number(m[2]), width: m[2].length } : null; };
  return {
    matterId,
    timeline: (matter) => db().timeline.find((e) => e.matterId === matter).sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ id: e.id, date: e.date, title: e.title, significance: e.significance, verified: e.verified, disputed: e.disputed, sources: e.sources.map((x) => ({ kind: x.kind, id: x.id, bates: x.bates, cite: x.cite })) })),
    exhibitByBates: (matter, bates): ExhibitDoc | null => {
      const want = bates.trim().toUpperCase();
      const docs = db().edocs.find((d) => d.matterId === matter);
      let hit = docs.find((d) => d.bates.toUpperCase() === want);
      if (!hit) {
        const w = batesNum(want);
        if (w) hit = docs.find((d) => { const a = batesNum(d.bates), z = d.batesEnd ? batesNum(d.batesEnd) : null; return Boolean(a && z && a.prefix === w.prefix && z.prefix === w.prefix && w.n >= a.n && w.n <= z.n); });
      }
      return hit ? { id: hit.id, bates: hit.bates, batesEnd: hit.batesEnd, date: hit.date, custodianName: hit.custodianName, type: hit.type, subject: hit.subject, text: hit.text, aiSummary: hit.aiSummary } : null;
    },
    officeDoc: (id) => { const d = db().officeDocs.get(id); return d ? { id: d.id, title: d.title, kind: d.kind, matterId: d.matterId, content: d.content } : null; },
    libraryItem: (id) => { const l = db().library.get(id); return l ? { id: l.id, name: l.name, type: l.type, matterId: l.matterId, sharedWith: l.sharedWith, content: l.content, url: l.url } : null; },
    blob: (id) => { const b = blobs.meta(id); return b ? { id: b.id, mime: b.mime, name: b.name, matterId: typeof b.meta?.matterId === "string" ? b.meta.matterId : undefined } : null; },
    libraryLinksBlob: (blobId, matter) => db().library.find((l) => (l.url ?? "").startsWith(`/api/blobs/${blobId}`) && ((matter !== null && l.matterId === matter) || (!l.matterId && (l.sharedWith ?? []).includes("firm")))).length > 0,
  };
}

/** Production dependencies: fast-model rewrites/condensing/notes, OpenAI image generation, authorized data access. */
export function productionDeps(ctx?: OfficeAgentContext<SlidesSnapshot>): SlidesToolDeps {
  return {
    data: ctx ? serverDataAccess(ctx) : undefined,
    async generateImage(prompt, size) {
      const r = await generateImage(`${prompt}. Clean, professional legal presentation graphic; no text artifacts; restrained palette; high contrast.`, { size, quality: "medium", name: `slide-${Date.now()}.png` });
      return { url: r.url, blobId: r.blobId };
    },
    async rewriteText(input, context) {
      const result = await generateJSON<{ markdown: string }>({
        instructions: REWRITE_INSTRUCTIONS,
        input: JSON.stringify({ deck: context.deckTitle, matter: context.matter, max_bullets: input.maxBullets, max_words_per_bullet: input.maxWords, extra: input.instruction ?? null, text: input.markdown }),
        schema: { type: "object", properties: { markdown: { type: "string" } }, required: ["markdown"] },
        name: "rewritten_text",
        fast: true,
        reasoningEffort: "low",
        taskType: "summarize",
        cacheStablePrefix: true,
        matterId: ctx?.matter?.id,
      });
      return result.markdown;
    },
    async condenseSlides(slides, goals, limits, context) {
      const result = await generateJSON<{ slides: { id: string; title?: string; body: string }[] }>({
        instructions: `${REWRITE_INSTRUCTIONS} You receive several slides; rewrite each body within the limits and return every slide id; keep the title unless it can state the takeaway more sharply.`,
        input: JSON.stringify({ deck: context.deckTitle, matter: context.matter, goals, max_bullets: limits.maxBullets, max_words_per_bullet: limits.maxWords, slides }),
        schema: { type: "object", properties: { slides: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["id", "body"] } } }, required: ["slides"] },
        name: "condensed_slides",
        fast: true,
        reasoningEffort: "low",
        taskType: "summarize",
        cacheStablePrefix: true,
        matterId: ctx?.matter?.id,
      });
      return result.slides;
    },
    async generateNotes(slides, style, context) {
      const result = await generateJSON<{ notes: { id: string; notes: string }[] }>({
        instructions: "Write presenter-facing speaker notes for each slide of a legal presentation by a litigation firm. 40–90 words per slide: what to emphasize, which cite or document to read aloud, one anticipated question, and the transition to the next slide. Plain text, no markdown. Never invent facts, cites or figures beyond the slide text; if a point needs verification say \"[VERIFY]\".",
        input: JSON.stringify({ style, deck: context.deckTitle, matter: context.matter, slides }),
        schema: { type: "object", properties: { notes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, notes: { type: "string" } }, required: ["id", "notes"] } } }, required: ["notes"] },
        name: "speaker_notes",
        fast: true,
        reasoningEffort: "low",
        taskType: "summarize",
        cacheStablePrefix: true,
        matterId: ctx?.matter?.id,
      });
      return result.notes;
    },
  };
}

export const slidesAgentHandler = createOfficeAgentHandler<SlidesSnapshot>({
  kind: "slides",
  parseSnapshot,
  instructions: slidesInstructions,
  tools: (ctx) => slidesAgentTools(ctx, productionDeps(ctx)),
  renderSnapshot: (s, scope) => renderSnapshot(s, scope),
  maxSteps: 24,
});
