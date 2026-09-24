"use client";
import * as React from "react";
import type { SearchHit } from "../types";
import type { ResearchSource } from "../engine/types";

/** Shared page-level actions so the answer, the panels and the map stay in sync (hover a source anywhere → the cited sentence lights up). */
export interface ResearchActions {
  sources: Record<string, ResearchSource>;
  sourceByN: (n: number) => ResearchSource | undefined;
  hoverN: number | null;
  setHoverN: (n: number | null) => void;
  hoverSourceId: string | null;
  setHoverSourceId: (id: string | null) => void;
  openSource: (s: ResearchSource | SearchHit) => void;
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
