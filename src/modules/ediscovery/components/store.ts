"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SavedView, SearchFilters, SortKey } from "../types";

export type Density = "compact" | "comfortable";
export type ViewerTab = "text" | "metadata" | "family" | "similar" | "ai";

export interface ColumnDef { id: string; label: string; width: number; min: number; sort?: SortKey; align?: "left" | "right" }

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: "select", label: "", width: 36, min: 36 },
  { id: "bates", label: "Bates", width: 128, min: 96, sort: "bates" },
  { id: "date", label: "Date", width: 96, min: 80, sort: "date" },
  { id: "custodian", label: "Custodian", width: 124, min: 90, sort: "custodian" },
  { id: "type", label: "Type", width: 84, min: 64, sort: "type" },
  { id: "subject", label: "Subject", width: 420, min: 160, sort: "subject" },
  { id: "score", label: "AI score", width: 108, min: 88, sort: "aiScore", align: "right" },
  { id: "coding", label: "Coding", width: 210, min: 120 },
];

interface ReviewState {
  // query
  q: string;
  semantic: boolean;
  view: SavedView;
  filters: SearchFilters;
  sort: SortKey | undefined;
  dir: "asc" | "desc" | undefined;
  setQ: (q: string) => void;
  setSemantic: (v: boolean) => void;
  setView: (v: SavedView) => void;
  toggleFilter: (key: keyof SearchFilters, value: string) => void;
  clearFilters: () => void;
  setSort: (sort: SortKey) => void;
  // selection / cursor
  selected: string[];
  setSelected: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  lastClickedId: string | null;
  setLastClickedId: (id: string | null) => void;
  // viewer
  openDocId: string | null;
  setOpenDocId: (id: string | null) => void;
  fullscreen: boolean;
  setFullscreen: (v: boolean) => void;
  viewerTab: ViewerTab;
  setViewerTab: (t: ViewerTab) => void;
  codingPanelOpen: boolean;
  setCodingPanelOpen: (v: boolean) => void;
  // preferences (persisted)
  density: Density;
  setDensity: (d: Density) => void;
  columnWidths: Record<string, number>;
  setColumnWidth: (id: string, w: number) => void;
  autoAdvance: boolean;
  setAutoAdvance: (v: boolean) => void;
  railCollapsed: boolean;
  setRailCollapsed: (v: boolean) => void;
  /** Incremented to ask the review list to refetch (facets, AI scores) without changing the query. */
  listTick: number;
  bumpList: () => void;
  reset: () => void;
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      q: "",
      semantic: false,
      view: "all",
      filters: {},
      sort: undefined,
      dir: undefined,
      setQ: (q) => set({ q }),
      setSemantic: (semantic) => set({ semantic, sort: semantic ? "relevance" : get().sort === "relevance" ? undefined : get().sort }),
      setView: (view) => set({ view, selected: [] }),
      toggleFilter: (key, value) =>
        set((s) => {
          const cur = (s.filters[key] as string[] | undefined) ?? [];
          const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
          const filters = { ...s.filters, [key]: next };
          if (!next.length) delete (filters as Record<string, unknown>)[key];
          return { filters, selected: [] };
        }),
      clearFilters: () => set({ filters: {}, selected: [] }),
      setSort: (sort) =>
        set((s) => {
          if (s.sort === sort) return { dir: (s.dir ?? (sort === "aiScore" || sort === "relevance" ? "desc" : "asc")) === "asc" ? "desc" : "asc" };
          return { sort, dir: sort === "aiScore" || sort === "relevance" ? "desc" : "asc" };
        }),
      selected: [],
      setSelected: (selected) => set({ selected }),
      toggleSelected: (id) => set((s) => ({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] })),
      activeId: null,
      setActiveId: (activeId) => set({ activeId }),
      lastClickedId: null,
      setLastClickedId: (lastClickedId) => set({ lastClickedId }),
      openDocId: null,
      setOpenDocId: (openDocId) => set({ openDocId, activeId: openDocId ?? get().activeId }),
      fullscreen: false,
      setFullscreen: (fullscreen) => set({ fullscreen }),
      viewerTab: "text",
      setViewerTab: (viewerTab) => set({ viewerTab }),
      codingPanelOpen: true,
      setCodingPanelOpen: (codingPanelOpen) => set({ codingPanelOpen }),
      density: "compact",
      setDensity: (density) => set({ density }),
      columnWidths: {},
      setColumnWidth: (id, w) => set((s) => ({ columnWidths: { ...s.columnWidths, [id]: w } })),
      autoAdvance: true,
      setAutoAdvance: (autoAdvance) => set({ autoAdvance }),
      railCollapsed: false,
      setRailCollapsed: (railCollapsed) => set({ railCollapsed }),
      listTick: 0,
      bumpList: () => set((s) => ({ listTick: s.listTick + 1 })),
      reset: () => set({ q: "", semantic: false, view: "all", filters: {}, sort: undefined, dir: undefined, selected: [], activeId: null, openDocId: null }),
    }),
    { name: "leclaude:ediscovery:review", partialize: (s) => ({ density: s.density, columnWidths: s.columnWidths, autoAdvance: s.autoAdvance, codingPanelOpen: s.codingPanelOpen, railCollapsed: s.railCollapsed }) },
  ),
);
