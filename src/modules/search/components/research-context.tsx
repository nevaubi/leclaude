"use client";
import * as React from "react";
import type { SearchHit } from "../types";
import type { ResearchSource } from "../engine/types";
import type { SourceTrustContext } from "../engine/trust";

/** Where the reader should land: a 1-based paragraph (reader numbering) and/or a quotation to find. */
export interface ReaderFocus {
  paragraph?: number;
  quote?: string;
}

/** Shared page-level actions so the answer, the panels and the map stay in sync (hover a source anywhere → the cited sentence lights up). */
export interface ResearchActions {
  sources: Record<string, ResearchSource>;
  /** The answer hash and verdicts the source states are judged against (the pending turn, else the last answer). */
  trustContext: SourceTrustContext;
  /** Re-ask the last (or given) question in the current thread. */
  retry: (question?: string) => void;
  sourceByN: (n: number) => ResearchSource | undefined;
  hoverN: number | null;
  setHoverN: (n: number | null) => void;
  hoverSourceId: string | null;
  setHoverSourceId: (id: string | null) => void;
  /** Open the reader; `focus` scrolls to a pinpoint paragraph ([n ¶k]) or the paragraph holding a verified quote. */
  openSource: (s: ResearchSource | SearchHit, focus?: ReaderFocus) => void;
  copyCite: (hit: SearchHit) => void;
  pinSource: (s: ResearchSource) => void;
  pinPassage: (text: string, sourceId?: string) => void;
  saveToLibrary: (hit: SearchHit) => void;
  isPinned: (sourceId: string) => boolean;
  askFollowUp: (q: string) => void;
}

const Ctx = React.createContext<ResearchActions | null>(null);

export function ResearchProvider({ value, children }: { value: ResearchActions; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useResearchActions(): ResearchActions {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useResearchActions must be used inside ResearchProvider");
  return v;
}
