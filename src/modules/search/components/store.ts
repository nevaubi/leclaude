"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { DEFAULT_SETTINGS, type SearchHit, type SearchSettings, type SearchSource } from "../types";
import type { ResearchPin } from "../engine/types";

export type PanelTab = "live" | "sources" | "map" | "pins";

interface SearchStoreState {
  settings: SearchSettings;
  setSettings: (patch: Partial<SearchSettings>) => void;
  replaceSettings: (settings: SearchSettings) => void;
  toggleSource: (s: SearchSource) => void;
  /** Pins live client-side and are mirrored to the thread on the server. */
  pins: ResearchPin[];
  pinSource: (hit: SearchHit, sourceId: string, note?: string) => "added" | "exists";
  pinPassage: (text: string, opts?: { sourceId?: string; hit?: SearchHit; note?: string }) => void;
  unpin: (id: string) => void;
  setPinNote: (id: string, note: string) => void;
  replacePins: (pins: ResearchPin[]) => void;
  clearPins: () => void;
  recentQueries: string[];
  pushRecentQuery: (q: string) => void;
  panelTab: PanelTab;
  setPanelTab: (t: PanelTab) => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  railOpen: boolean;
  setRailOpen: (v: boolean) => void;
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
      pins: [],
      pinSource: (hit, sourceId, note) => {
        if (get().pins.some((p) => p.kind === "source" && p.sourceId === sourceId)) return "exists";
        set((s) => ({ pins: [...s.pins, { id: `pin_${nanoid(8)}`, kind: "source", sourceId, hit, note, addedAt: Date.now() }] }));
        return "added";
      },
      pinPassage: (text, opts) => set((s) => ({ pins: [...s.pins, { id: `pin_${nanoid(8)}`, kind: "passage", text: text.trim().slice(0, 4000), sourceId: opts?.sourceId, hit: opts?.hit, note: opts?.note, addedAt: Date.now() }] })),
      unpin: (id) => set((s) => ({ pins: s.pins.filter((p) => p.id !== id) })),
      setPinNote: (id, note) => set((s) => ({ pins: s.pins.map((p) => (p.id === id ? { ...p, note } : p)) })),
      replacePins: (pins) => set({ pins }),
      clearPins: () => set({ pins: [] }),
      recentQueries: [],
      pushRecentQuery: (q) => set((s) => ({ recentQueries: [q, ...s.recentQueries.filter((x) => x !== q)].slice(0, 12) })),
      panelTab: "live",
      setPanelTab: (panelTab) => set({ panelTab }),
      panelOpen: true,
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      railOpen: true,
      setRailOpen: (railOpen) => set({ railOpen }),
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
    }),
    {
      name: "leclaude:search",
      version: 2,
      skipHydration: true,
      partialize: (s) => ({ settings: s.settings, pins: s.pins, recentQueries: s.recentQueries, panelOpen: s.panelOpen, railOpen: s.railOpen }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SearchStoreState>;
        return { ...current, ...p, pins: Array.isArray(p.pins) ? p.pins : [], settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
    },
  ),
);
