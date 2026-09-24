/**
 * Lane planner: a pure function that turns a question + scope into 1–5
 * bounded research lanes. Deterministic so the UI can preview lanes before a
 * run starts and tests can pin the behaviour.
 */
import type { SearchSettings, SearchSource } from "../types";
import { toCourtListenerSyntax } from "../query-builder";
import type { LaneKind, ResearchLane, ResearchMode } from "./types";

export interface PlanInput {
  question: string;
  settings: SearchSettings;
  mode: ResearchMode;
  hasMatter: boolean;
  round?: number;
  /** Refined queries from a previous round's coverage decision (per lane kind). */
  refinements?: Partial<Record<LaneKind, string[]>>;
}

const LANE_TOOLS: Record<LaneKind, string[]> = {
  controlling: ["search_case_law", "get_opinion_text", "search_statutes", "fetch_url", "verify_citations"],
  contrary: ["search_case_law", "get_opinion_text", "verify_citations"],
  regulatory: ["search_cfr", "get_cfr_section", "search_federal_register", "get_federal_register_document", "fetch_url"],
  record: ["search_dockets", "get_docket_entries", "search_ediscovery", "get_ediscovery_document", "get_matter_context"],
  secondary: ["web_search", "fetch_url", "search_library", "get_library_item"],
  fast: ["search_case_law", "search_statutes", "search_cfr", "search_library"],
};

const LANE_NAME: Record<LaneKind, { name: string; brief: string }> = {
  controlling: { name: "Controlling authority", brief: "Binding cases and statutes for the selected jurisdiction" },
  contrary: { name: "Contrary authority", brief: "The strongest cases against the answer, and any split" },
  regulatory: { name: "Regulatory", brief: "CFR sections and Federal Register actions on point" },
  record: { name: "Docket & record", brief: "Dockets, matter documents and depositions" },
  secondary: { name: "Secondary & web", brief: "Firm library, treatises, agency pages and the open web" },
  fast: { name: "Fast answer", brief: "One pass over the structured providers" },
};

/** Clean the natural-language question into a boolean-ish retrieval query. */
export function retrievalQuery(question: string): string {
  const q = question.trim().replace(/\s+/g, " ");
  // Already boolean/quoted → keep the operators, just normalise Westlaw connectors.
  if (/\b(AND|OR|NOT)\b|"|\/[sp]\b|\/\d+/.test(q)) return toCourtListenerSyntax(q);
  // Natural language → drop stop words and interrogatives, keep the terms of art.
  const stop = new Set(["is", "a", "an", "the", "of", "to", "in", "on", "for", "under", "against", "does", "do", "did", "can", "may", "what", "which", "when", "how", "are", "was", "were", "be", "by", "with", "and", "or", "at", "from", "that", "this", "it", "its", "as", "after", "before", "whether", "any", "there", "we", "our", "their", "than", "into", "about"]);
  const words = q.replace(/[?!.,;:()]/g, " ").split(/\s+/).filter((w) => w && !stop.has(w.toLowerCase()));
  return words.slice(0, 14).join(" ");
}

/** Query variant that surfaces authority against the proposition. */
export function contraryQuery(base: string): string {
  return `${base} AND (distinguish* OR reject* OR "we disagree" OR "contrary" OR "declined to follow" OR dissent*)`;
}

export function planLanes(input: PlanInput): ResearchLane[] {
  const round = input.round ?? 1;
  const base = retrievalQuery(input.question);
  const s = input.settings;
  const has = (src: SearchSource) => s.sources.includes(src);
  const lanes: ResearchLane[] = [];
  const mk = (kind: LaneKind, sources: SearchSource[], queries: string[], maxSteps: number, maxReads: number): ResearchLane => ({
    id: `lane_${kind}_r${round}`,
    kind,
    ...LANE_NAME[kind],
    sources,
    tools: LANE_TOOLS[kind].filter((t) => t !== "web_search" || has("web")),
    queries: Array.from(new Set((input.refinements?.[kind]?.length ? input.refinements[kind]! : queries).map((q) => q.trim()).filter(Boolean))).slice(0, 3),
    maxSteps,
    maxReads,
    round,
  });

  if (input.mode === "fast") {
    const sources = s.sources.filter((x) => x !== "web");
    return [mk("fast", sources.length ? sources : ["caselaw"], [base], 1, 2)];
  }

  if (has("caselaw") || has("statutes")) lanes.push(mk("controlling", (["caselaw", "statutes"] as SearchSource[]).filter(has), [base], 6, 4));
  if (has("caselaw")) lanes.push(mk("contrary", ["caselaw"], [contraryQuery(base)], 5, 3));
  if (has("regulations") || has("federal_register")) lanes.push(mk("regulatory", (["regulations", "federal_register"] as SearchSource[]).filter(has), [base], 6, 4));
  if (has("dockets") || (input.hasMatter && has("ediscovery"))) lanes.push(mk("record", (["dockets", "ediscovery"] as SearchSource[]).filter((x) => has(x) && (x !== "ediscovery" || input.hasMatter)), [base], 6, 4));
  if (has("web") || has("library")) lanes.push(mk("secondary", (["web", "library"] as SearchSource[]).filter(has), [base], 5, 3));

  if (!lanes.length) lanes.push(mk("controlling", ["caselaw"], [base], 6, 4));
  // Later rounds only re-run lanes that received refinements (the thin ones); round 1 keeps everything.
  const planned = round > 1 && input.refinements ? lanes.filter((l) => input.refinements?.[l.kind]?.length) : lanes;
  return (planned.length ? planned : lanes).slice(0, 5);
}

/** Tools relevant to a lane, filtered against what the toolkit exposes. */
export function laneToolNames(lane: ResearchLane): string[] {
  return lane.tools;
}
