"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShellState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  activeMatterId: string | null;
  setActiveMatterId: (id: string | null) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      paletteOpen: false,
      setPaletteOpen: (v) => set({ paletteOpen: v }),
      activeMatterId: null,
      setActiveMatterId: (id) => set({ activeMatterId: id }),
    }),
    { name: "leclaude:shell", partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, activeMatterId: s.activeMatterId }) },
  ),
);
