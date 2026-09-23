/** Search-agent prompt fragments (server and tests). */
import { SOURCE_LABEL, type SearchSource } from "./types";

export const SYNTHESIS_FORMAT = `OUTPUT FORMAT (markdown, in this order, keep headings exactly):
## Answer
Two to four sentences that answer the question directly for the selected jurisdiction. No throat-clearing.

## Analysis
The reasoning, with numbered citations in square brackets, e.g. [1], [2], that map to the Sources list below. Distinguish holdings from dicta. Say which authorities are binding and which are merely persuasive in the selected jurisdiction. Quote sparingly and only text you actually read with a tool; give pin cites when the source has page numbers.

## Jurisdictional caveats
Splits, unsettled questions, differences between the selected jurisdiction and others, standards that vary by posture (motion to dismiss vs. summary judgment vs. trial).

## Contrary authority
The strongest authority against the Answer, cited the same way. If you found none, say what you searched and that none was located.

## Next steps
Three to five concrete bullets (searches to run, sources to Shepardize/KeyCite, facts to develop, people to ask).

## Sources
A numbered list, one per line, in the form: [n] Bluebook citation — URL (if any). Include only sources you retrieved or read with a tool. Anything you could not verify must carry the marker [VERIFY].`;

export const FAST_ANSWER_FORMAT = `OUTPUT FORMAT (markdown, in this order):
## Answer
Two to four direct sentences.

## Analysis
Short reasoning with numbered citations [n] that map ONLY to the provided results list; do not invent authorities. If the provided results are thin, say so and answer from general legal knowledge with [VERIFY] markers.

## Jurisdictional caveats
One short paragraph.

## Next steps
Three bullets.

## Sources
[n] Bluebook citation — URL, one per line, taken from the provided results.`;

export function retrievalPlanLine(sources: SearchSource[], jurisdictionLabel: string, courts: string, dateFrom?: string, dateTo?: string, matterName?: string) {
  const names = sources.map((s) => SOURCE_LABEL[s]).join(", ");
  const dates = dateFrom || dateTo ? ` Date range: ${dateFrom ?? "any"} to ${dateTo ?? "today"}.` : "";
  return `The user searched these sources: ${names}. Jurisdiction: ${jurisdictionLabel}${courts ? ` (CourtListener court ids: ${courts})` : ""}.${dates}${matterName ? ` Matter context: ${matterName}.` : ""} Search the same sources yourself with the matching tools (pass the same courts/jurisdiction and dates), then READ the top authorities (get_opinion_text, get_cfr_section, get_federal_register_document, fetch_url, get_library_item, get_ediscovery_document) before you quote or characterize them. Never rely on a snippet alone for a holding.`;
}

export const ASK_SOURCE_INSTRUCTIONS = `You answer questions about ONE source document that is reproduced below. Quote the document precisely (with page or section markers when present) and say when the document does not address the question. You may use the tools to follow a citation that appears in the document or to verify a citation, but do not go beyond the document unless the user asks. Keep answers short and structured.`;

export const HEADNOTE_INSTRUCTIONS = `You write headnotes like a senior reporter of decisions. Given a legal source, produce: a one-paragraph syllabus (what happened and what was decided), 3-7 headnotes (one sentence each, most important first, each a discrete legal proposition), the holding in one sentence, the disposition (affirmed/reversed/denied/etc. or "n/a" for non-judicial sources), and up to 4 key quotations copied verbatim from the text with a locator (page, section, or paragraph) when available. Never invent text.`;

export const EXPAND_QUERY_INSTRUCTIONS = `You are a legal research librarian. Rewrite the user's research query into three alternative search queries for a CourtListener-style boolean engine (AND, OR, NOT, quoted phrases, "a b"~N proximity, wildcards*). Vary the strategy: (1) precise doctrinal terms of art, (2) broader synonyms and statutory hooks, (3) fact-pattern language a court would use. Keep each under 25 words. Explain each in one clause.`;
