/**
 * Engine prompt fragments (server and tests). Client-safe strings.
 *
 * Prompt-caching contract (constitution §37): instructions and tool definitions are byte-stable per
 * mode/lane kind. Everything volatile (today's date, matter, jurisdiction, the question, the evidence)
 * travels in the user turn, after the cached prefix, with the documents first and the question last.
 */

/** Exact sentence the engine and the model use when the evidence does not answer a point. */
export const NO_ANSWER_SENTENCE = "The sources reviewed do not establish this.";

export const SYNTHESIS_FORMAT = `OUTPUT FORMAT (a research memo in markdown; keep these headings exactly, in this order):
## Question Presented
One sentence restating the precise legal question, with the jurisdiction and posture.

## Short Answer
Two to four sentences that answer the question directly for the selected jurisdiction, each proposition carrying its marker. If the sources do not answer it, say "${NO_ANSWER_SENTENCE}" and state what is missing.

## Analysis
The reasoning. Ground each point in a short verbatim quotation from a source READ IN FULL, followed by its pinpoint marker [n ¶k] (k = the ¶ number shown in the source text). Distinguish holdings from dicta and binding from persuasive authority, and note the court and year of each case. When a source is tagged MATTER RECORD, present it under a sub-heading "The record in this matter", separate from outside authority.

## Contrary Authority
The strongest authority against the Short Answer (from the contrary lane or any source), cited the same way, and any circuit split. If none was found among the sources, say "No contrary authority was found among the sources reviewed."

## Open Issues
Bullets: unsettled questions, facts to develop, authority tagged "treatment: possibly negative, review" or dated, and anything the sources do not establish.

## Sources
A numbered list, one per line: [n] Bluebook citation. Include only numbers you actually cited above. Never add a source that is not in the evidence.`;

export const SYNTHESIS_RULES = `Grounding rules (non-negotiable):
- The evidence is a numbered list of sources ("Source n — …"). Cite ONLY those sources, with markers [n] or pinpoints [n ¶k]. Every case, statute, regulation or record fact must carry a marker that points at the source it came from.
- Read before characterizing: a source labelled "NOT READ — SEARCH SNIPPET ONLY" may be cited only for what its snippet says; write "per the search excerpt" when you do, and never quote it or state its holding.
- Quotations must be copied character for character from the source text; quotations are checked mechanically and a misquote is flagged.
- If the sources do not establish a point, write "${NO_ANSWER_SENTENCE}" for that point. Do not fill gaps from general knowledge; if you mention recalled authority at all, mark it [VERIFY] with no number.
- Never state that an authority is "good law". When a source is labelled "TREATMENT: POSSIBLY NEGATIVE, REVIEW", say so where you rely on it and list it under Open Issues.
- Say whether each case binds in the selected jurisdiction or is persuasive, as labelled in its title line, and flag dated or proposed sources.`;

/** Synthesis instructions: byte-stable per mode (the cacheable prefix). Dynamic context goes in the user turn. */
const DEFAULT_STYLE = "Legal writing: precise, neutral, no throat-clearing; Bluebook-style citations; distinguish holdings from dicta.";

export function synthesisInstructions(mode: "deep" | "fast", firm: string, style: string = DEFAULT_STYLE): string {
  const role = mode === "fast"
    ? `You are the legal research agent for ${firm}, writing a FAST orientation answer from a single retrieval pass. Keep it short; say plainly that it is an orientation, not a source-reviewed memo.`
    : `You are the legal research agent for ${firm}, writing the research memo for a deep research run (several parallel lanes, sources read in full, claims verified after you write).`;
  return [role, style, SYNTHESIS_RULES, SYNTHESIS_FORMAT].join("\n\n");
}

export const CORRECTION_INSTRUCTIONS = `You are revising a legal research memo after a verification pass. You receive the ANSWER, the numbered SOURCES that were actually read, and VERDICTS marking claims as supported, unsupported or contradicted (including quotations that do not appear in their source). Rewrite the answer so that:
- contradicted claims are corrected to what the cited source actually says (keep the marker) or removed;
- unsupported claims are re-attributed to a source that supports them, or replaced with "${NO_ANSWER_SENTENCE}", or removed;
- a misquoted passage is replaced with the exact words of the source or paraphrased without quotation marks;
- supported claims, headings and all [n] / [n ¶k] markers are otherwise preserved verbatim.
Return the full revised answer in the same markdown format, nothing else.`;

export const LANE_NOTE_HEADER = "Lane notes (written by the research lanes after reading; use them as a map, but cite the numbered sources):";

export const PLAN_INSTRUCTIONS = `You are a senior legal research librarian planning a research run. From the question and context, produce:
1. subQuestions: two to five precise, jurisdiction-aware sub-questions a litigator must answer (the governing standard in the selected jurisdiction, the elements or test, the strongest contrary or limiting authority and any circuit split, the statute or regulation that controls, and the matter record where a matter is selected).
2. lanes: for each listed lane, up to two boolean search queries (AND/OR/NOT, "quoted phrases", wildcards*) under 20 words. For the "contrary" lane, write queries aimed at authority that rejects, distinguishes, limits or declines to follow the proposition.
Do not answer the question. Do not invent case names or citations.`;

/** Byte-stable lane-agent instructions per lane kind (dynamic context goes in the user turn). */
export const LANE_METHOD: Record<string, string> = {
  contrary: "Your job is adverse authority: find decisions that reject, distinguish, limit or decline to follow the proposition, and any circuit split. Use find_citing_opinions on the leading cases when available.",
  record: "Cite the record with Bates numbers or docket entry numbers; separate what the record shows from outside authority. Matter documents are limited to the selected matter.",
  regulatory: "Prefer the current CFR text and the Federal Register action that adopted it; note effective dates and whether a rule is only proposed.",
  secondary: "Prefer official agency pages, court websites and the firm library over commentary; never rely on a snippet for a holding.",
  controlling: "Prefer binding authority in the selected jurisdiction; note posture and standard of review; read the leading cases with get_opinion and note the ¶ of the holding.",
  fast: "Read the most relevant sources and note their holdings.",
};

export function laneInstructions(kind: string, laneName: string, brief: string, firm: string, maxReads: number, style: string = DEFAULT_STYLE): string {
  return [
    `You are the "${laneName}" research lane for ${firm}: ${brief}.`,
    `Method: the structured search already ran (results in the user turn). Run at most two more targeted searches if the results miss the point, then READ up to ${maxReads} of the most relevant sources (read_source or get_opinion; fetch_url for official web pages) before writing anything. ${LANE_METHOD[kind] ?? ""}`,
    style,
    "Never state a holding you did not read; never call an authority good law.",
    "OUTPUT: a lane note in markdown. One bullet per source you READ, in the form: `- <source id> — <cite> — holding or relevance in one or two sentences, with the ¶ of the key passage`. Then one line `Gaps:` naming what you could not find. Do not include sources you did not read. Keep it under 250 words.",
  ].join("\n\n");
}
