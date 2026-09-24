/** Engine prompt fragments (server and tests). Client-safe strings. */

export const SYNTHESIS_FORMAT = `OUTPUT FORMAT (markdown, in this order, keep the headings exactly):
## Answer
Two to four sentences that answer the question directly for the selected jurisdiction. No throat-clearing.

## Analysis
The reasoning, with numbered citations in square brackets, e.g. [1], [2], that map ONLY to the numbered SOURCES list you were given. Distinguish holdings from dicta and binding from persuasive authority. Quote only text that appears in a source marked as read; give pin cites when the source has page numbers. When a source is tagged [MATTER RECORD], present it under a sub-heading "The record in this matter" and keep it separate from outside authority.

## Jurisdictional caveats
Splits, unsettled questions, differences between the selected jurisdiction and others, standards that vary by posture.

## Contrary authority
The strongest authority against the Answer, cited the same way. If the lanes found none, say so plainly.

## Next steps
Three to five concrete bullets (searches to run, sources to KeyCite, facts to develop, people to ask).

## Sources
A numbered list, one per line: [n] Bluebook citation — URL (if any). Include only numbers from the SOURCES list that you actually cited above. Never add a source that is not on the list.`;

export const SYNTHESIS_RULES = `Grounding rules (non-negotiable):
- Cite ONLY the numbered SOURCES provided. Every case name, statute, regulation or record fact must carry a [n] marker that points at the source it came from.
- A source marked "(not read — snippet only)" may be cited for what its snippet says and nothing more; say "per the search excerpt" when you do.
- If the sources do not answer part of the question, say so and mark any authority you recall from general knowledge with [VERIFY] — do not give it a [n] number.
- If there are NO sources at all, begin the Answer with the line "**General practice (not source-backed).**", answer from general legal practice, mark every authority [VERIFY], and keep the Sources section empty.`;

export const CORRECTION_INSTRUCTIONS = `You are revising a legal research answer after a verification pass. You receive the ANSWER, the numbered SOURCES that were actually read, and VERDICTS marking claims as supported, unsupported or contradicted. Rewrite the answer so that:
- contradicted claims are corrected to what the cited source actually says (keep the [n] marker) or removed;
- unsupported claims are either re-attributed to a source that supports them, softened and marked [VERIFY], or removed;
- supported claims, structure, headings and all [n] markers are otherwise preserved verbatim.
Return the full revised answer in the same markdown format, nothing else.`;

export const LANE_NOTE_HEADER = "Lane notes (written by the research lanes after reading; use them as a map, but cite the SOURCES list):";
