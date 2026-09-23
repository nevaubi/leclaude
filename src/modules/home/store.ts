"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NewsItem, PracticeArea } from "@/lib/types/domain";
import type { EventInput, TaskInput } from "./types";

export type HomeSection = "calendar" | "tasks" | "news" | "updates" | "matters";
export type CalendarView = "month" | "week" | "agenda";

interface HomeUIState {
  focus: HomeSection | null;
  setFocus: (s: HomeSection | null) => void;

  calendarView: CalendarView;
  setCalendarView: (v: CalendarView) => void;
  /** Anchor date (YYYY-MM-DD) for the month/week being displayed. */
  calendarDate: string | null;
  setCalendarDate: (d: string | null) => void;
  selectedDay: string | null;
  setSelectedDay: (d: string | null) => void;

  eventSheetId: string | null;
  openEvent: (id: string | null) => void;
  eventDialog: { open: boolean; eventId: string | null; initial: Partial<EventInput> | null };
  openEventDialog: (opts?: { eventId?: string | null; initial?: Partial<EventInput> | null }) => void;
  closeEventDialog: () => void;

  tasksView: "list" | "board";
  setTasksView: (v: "list" | "board") => void;
  taskFilter: { mine: boolean; overdue: boolean; showDone: boolean };
  setTaskFilter: (p: Partial<HomeUIState["taskFilter"]>) => void;
  taskDialog: { open: boolean; taskId: string | null; initial: Partial<TaskInput> | null };
  openTaskDialog: (opts?: { taskId?: string | null; initial?: Partial<TaskInput> | null }) => void;
  closeTaskDialog: () => void;

  dockOpen: boolean;
  setDockOpen: (v: boolean) => void;
  dockPrefill: { text: string; nonce: number } | null;
  askAssistant: (text: string) => void;
  clearDockPrefill: () => void;

  composerNonce: number;
  focusComposer: () => void;

  news: { category: NewsItem["category"] | "all"; practiceArea: PracticeArea | "all"; sort: "relevance" | "newest"; query: string };
  setNews: (p: Partial<HomeUIState["news"]>) => void;
}

export const useHomeUI = create<HomeUIState>()(
  persist(
    (set) => ({
      focus: null,
      setFocus: (focus) => set({ focus }),
      calendarView: "month",
      setCalendarView: (calendarView) => set({ calendarView }),
      calendarDate: null,
      setCalendarDate: (calendarDate) => set({ calendarDate }),
      selectedDay: null,
      setSelectedDay: (selectedDay) => set({ selectedDay }),
      eventSheetId: null,
      openEvent: (eventSheetId) => set({ eventSheetId }),
      eventDialog: { open: false, eventId: null, initial: null },
      openEventDialog: (opts = {}) => set({ eventDialog: { open: true, eventId: opts.eventId ?? null, initial: opts.initial ?? null }, eventSheetId: null }),
      closeEventDialog: () => set((s) => ({ eventDialog: { ...s.eventDialog, open: false } })),
      tasksView: "list",
      setTasksView: (tasksView) => set({ tasksView }),
      taskFilter: { mine: false, overdue: false, showDone: false },
      setTaskFilter: (p) => set((s) => ({ taskFilter: { ...s.taskFilter, ...p } })),
      taskDialog: { open: false, taskId: null, initial: null },
      openTaskDialog: (opts = {}) => set({ taskDialog: { open: true, taskId: opts.taskId ?? null, initial: opts.initial ?? null } }),
      closeTaskDialog: () => set((s) => ({ taskDialog: { ...s.taskDialog, open: false } })),
      dockOpen: true,
      setDockOpen: (dockOpen) => set({ dockOpen }),
      dockPrefill: null,
      askAssistant: (text) => set((s) => ({ dockOpen: true, dockPrefill: { text, nonce: (s.dockPrefill?.nonce ?? 0) + 1 } })),
      clearDockPrefill: () => set({ dockPrefill: null }),
      composerNonce: 0,
      focusComposer: () => set((s) => ({ focus: null, composerNonce: s.composerNonce + 1 })),
      news: { category: "all", practiceArea: "all", sort: "relevance", query: "" },
      setNews: (p) => set((s) => ({ news: { ...s.news, ...p } })),
    }),
    // skipHydration: the first client render must match the server HTML; HomeProvider rehydrates after mount.
    { name: "leclaude:home", skipHydration: true, partialize: (s) => ({ calendarView: s.calendarView, tasksView: s.tasksView, dockOpen: s.dockOpen, taskFilter: s.taskFilter }) },
  ),
);
