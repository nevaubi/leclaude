"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LibrarySort } from "../types";

export type ViewMode = "grid" | "list";

interface LibraryUIState {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  sort: LibrarySort;
  dir: "asc" | "desc";
  setSort: (sort: LibrarySort, dir?: "asc" | "desc") => void;
  askOpen: boolean;
  setAskOpen: (v: boolean) => void;
  expanded: string[];
  toggleExpanded: (id: string) => void;
  expandMany: (ids: string[]) => void;
  showPreviewOnSelect: boolean;
  setShowPreviewOnSelect: (v: boolean) => void;
  treeWidth: number;
  setTreeWidth: (w: number) => void;
}

export const useLibraryUI = create<LibraryUIState>()(
  persist(
    (set) => ({
      viewMode: "grid",
      setViewMode: (viewMode) => set({ viewMode }),
      sort: "name",
      dir: "asc",
      setSort: (sort, dir) => set((s) => ({ sort, dir: dir ?? (s.sort === sort ? (s.dir === "asc" ? "desc" : "asc") : sort === "updated" || sort === "created" ? "desc" : "asc") })),
      askOpen: false,
      setAskOpen: (askOpen) => set({ askOpen }),
      expanded: ["lib_folder_matters", "lib_folder_knowledge"],
      toggleExpanded: (id) => set((s) => ({ expanded: s.expanded.includes(id) ? s.expanded.filter((x) => x !== id) : [...s.expanded, id] })),
      expandMany: (ids) => set((s) => ({ expanded: Array.from(new Set([...s.expanded, ...ids])) })),
      showPreviewOnSelect: false,
      setShowPreviewOnSelect: (showPreviewOnSelect) => set({ showPreviewOnSelect }),
      treeWidth: 252,
      setTreeWidth: (treeWidth) => set({ treeWidth: Math.min(420, Math.max(200, treeWidth)) }),
    }),
    { name: "leclaude:library", partialize: (s) => ({ viewMode: s.viewMode, sort: s.sort, dir: s.dir, askOpen: s.askOpen, expanded: s.expanded, treeWidth: s.treeWidth }) },
  ),
);
