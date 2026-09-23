"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SETTINGS, type MemoSource, type SearchHit, type SearchSettings, type SearchSource } from "../types";

export type MemoField = "memoQuestion" | "memoIssues" | "memoSynthesis";

interface SearchStoreState {
  settings: SearchSettings;
  setSettings: (patch: Partial<SearchSettings>) => void;
  replaceSettings: (settings: SearchSettings) => void;
  toggleSource: (s: SearchSource) => void;
  memo: MemoSource[];
  memoQuestion: string;
  memoIssues: string;
  memoSynthesis: string;
  memoOpen: boolean;
  addToMemo: (hit: SearchHit, note?: string) => "added" | "exists";
  removeFromMemo: (id: string) => void;
  setMemoNote: (id: string, note: string) => void;
  setMemoField: (field: MemoField, value: string) => void;
  clearMemo: () => void;
  setMemoOpen: (v: boolean) => void;
  recentQueries: string[];
  pushRecentQuery: (q: string) => void;
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
}

export const useSearchStore = create<SearchStoreState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      replaceSettings: (settings) => set({ settings }),
      toggleSource: (src) =>
        set((s) => {
          const has = s.settings.sources.includes(src);
          const sources = has ? s.settings.sources.filter((x) => x !== src) : [...s.settings.sources, src];
          return { settings: { ...s.settings, sources: sources.length ? sources : s.settings.sources } };
        }),
      memo: [],
      memoQuestion: "",
      memoIssues: "",
      memoSynthesis: "",
      memoOpen: false,
      addToMemo: (hit, note) => {
        if (get().memo.some((m) => m.hit.id === hit.id)) return "exists";
        set((s) => ({ memo: [...s.memo, { hit, note, addedAt: Date.now() }] }));
        return "added";
      },
      removeFromMemo: (id) => set((s) => ({ memo: s.memo.filter((m) => m.hit.id !== id) })),
      setMemoNote: (id, note) => set((s) => ({ memo: s.memo.map((m) => (m.hit.id === id ? { ...m, note } : m)) })),
      setMemoField: (field, value) => set({ [field]: value } as Pick<SearchStoreState, MemoField>),
      clearMemo: () => set({ memo: [], memoQuestion: "", memoIssues: "", memoSynthesis: "" }),
      setMemoOpen: (v) => set({ memoOpen: v }),
      recentQueries: [],
      pushRecentQuery: (q) => set((s) => ({ recentQueries: [q, ...s.recentQueries.filter((x) => x !== q)].slice(0, 12) })),
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
    }),
    {
      name: "leclaude:search",
      skipHydration: true,
      partialize: (s) => ({ settings: s.settings, memo: s.memo, memoQuestion: s.memoQuestion, memoIssues: s.memoIssues, memoSynthesis: s.memoSynthesis, recentQueries: s.recentQueries }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SearchStoreState>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
    },
  ),
);
