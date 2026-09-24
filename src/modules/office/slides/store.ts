"use client";
/**
 * Editor state for the slides editor: the deck, selection, undo/redo history,
 * clipboard, view settings and every editing operation (all undoable).
 */
import { create } from "zustand";
import type { EditProposal } from "@/modules/office/shared/types";
import { applyLayout, buildSlide, groupIdFactory } from "./layouts";
import { GRID, SLIDE_H, SLIDE_W, clampToSlide, cloneDeck, cloneSlide, emptyDeck, getTheme, makeElement, newElementId, unionRect, type DeckContent, type DeckElement, type DeckSlide, type SlideBackground, type SlideLayout } from "./model";
import { applyOp } from "./proposals";

export type ZoomMode = "fit" | number;
export type AlignKind = "left" | "center" | "right" | "top" | "middle" | "bottom";

const HISTORY_LIMIT = 120;

export interface SlidesState {
  deck: DeckContent;
  loaded: boolean;
  currentSlideId: string | null;
  selectedIds: string[];
  editingId: string | null;
  past: DeckContent[];
  future: DeckContent[];
  clipboard: DeckElement[] | null;
  zoom: ZoomMode;
  showGrid: boolean;
  snap: boolean;
  showGuides: boolean;
  guides: { v: number[]; h: number[] };
  /** Increments on every deck change (autosave hook). */
  changeTick: number;

  load: (deck: DeckContent) => void;
  setZoom: (z: ZoomMode) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleGuides: () => void;
  setGuides: (g: { v: number[]; h: number[] }) => void;
  setCurrent: (id: string | null) => void;
  select: (ids: string[], opts?: { add?: boolean; toggle?: boolean }) => void;
  clearSelection: () => void;
  setEditing: (id: string | null) => void;
  pushHistory: () => void;
  /** Apply a change. history=false for transient updates (drag) after an explicit pushHistory(). */
  patch: (mutate: (deck: DeckContent) => DeckContent | void, opts?: { history?: boolean }) => void;
  undo: () => void;
  redo: () => void;

  addSlide: (layout: SlideLayout, afterId?: string | null) => string;
  deleteSlide: (id: string) => void;
  duplicateSlide: (id: string) => string | null;
  moveSlide: (from: number, to: number) => void;
  toggleHidden: (id: string) => void;
  setLayout: (id: string, layout: SlideLayout) => void;
  setNotes: (id: string, notes: string) => void;
  setBackground: (id: string, bg: SlideBackground | null) => void;
  setTheme: (themeId: string) => void;

  addElement: (partial: Partial<DeckElement> & { type: DeckElement["type"] }, opts?: { select?: boolean; slideId?: string }) => string | null;
  updateElement: (id: string, patch: Partial<DeckElement> | ((e: DeckElement) => Partial<DeckElement>), opts?: { history?: boolean }) => void;
  updateSelected: (fn: (e: DeckElement) => Partial<DeckElement>) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  nudge: (dx: number, dy: number) => void;
  reorder: (how: "front" | "back" | "forward" | "backward") => void;
  align: (kind: AlignKind) => void;
  distribute: (axis: "h" | "v") => void;
  group: () => void;
  ungroup: () => void;
  selectAll: () => void;
  applyProposals: (proposals: EditProposal[]) => { applied: string[]; failed: { id: string; error: string }[] };
}

export const currentSlideOf = (s: Pick<SlidesState, "deck" | "currentSlideId">): DeckSlide | null => s.deck.slides.find((x) => x.id === s.currentSlideId) ?? s.deck.slides[0] ?? null;

export const selectedElementsOf = (s: Pick<SlidesState, "deck" | "currentSlideId" | "selectedIds">): DeckElement[] => {
  const slide = currentSlideOf(s);
  return slide ? slide.elements.filter((e) => s.selectedIds.includes(e.id)) : [];
};

function expandGroups(slide: DeckSlide | null, ids: string[]): string[] {
  if (!slide) return ids;
  const groups = new Set(slide.elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId as string));
  if (!groups.size) return ids;
  const out = new Set(ids);
  for (const e of slide.elements) if (e.groupId && groups.has(e.groupId)) out.add(e.id);
  return Array.from(out);
}

export const useSlidesStore = create<SlidesState>((set, get) => {
  const mutateSlide = (slideId: string, fn: (slide: DeckSlide) => DeckSlide | void, opts?: { history?: boolean }) =>
    get().patch((deck) => { const i = deck.slides.findIndex((s) => s.id === slideId); if (i < 0) return; const r = fn(deck.slides[i]); if (r) deck.slides[i] = r; }, opts);

  return {
    deck: emptyDeck(),
    loaded: false,
    currentSlideId: null,
    selectedIds: [],
    editingId: null,
    past: [],
    future: [],
    clipboard: null,
    zoom: "fit",
    showGrid: false,
    snap: true,
    showGuides: true,
    guides: { v: [], h: [] },
    changeTick: 0,

    load: (deck) => set({ deck, loaded: true, currentSlideId: deck.slides[0]?.id ?? null, selectedIds: [], editingId: null, past: [], future: [], changeTick: 0, guides: { v: [], h: [] } }),
    setZoom: (zoom) => set({ zoom }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleSnap: () => set((s) => ({ snap: !s.snap })),
    toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
    setGuides: (guides) => set({ guides }),
    setCurrent: (id) => set((s) => (s.currentSlideId === id ? {} : { currentSlideId: id, selectedIds: [], editingId: null })),
    select: (ids, opts) => set((s) => {
      const slide = currentSlideOf(s);
      let next: string[];
      if (opts?.toggle) { const cur = new Set(s.selectedIds); for (const id of expandGroups(slide, ids)) { if (cur.has(id)) cur.delete(id); else cur.add(id); } next = Array.from(cur); }
      else if (opts?.add) next = Array.from(new Set([...s.selectedIds, ...expandGroups(slide, ids)]));
      else next = expandGroups(slide, ids);
      return { selectedIds: next, editingId: s.editingId && next.includes(s.editingId) ? s.editingId : null };
    }),
    clearSelection: () => set({ selectedIds: [], editingId: null }),
    setEditing: (editingId) => set((s) => ({ editingId, selectedIds: editingId ? [editingId] : s.selectedIds })),
    pushHistory: () => set((s) => ({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), cloneDeck(s.deck)], future: [] })),
    patch: (mutate, opts) => set((s) => {
      const next = cloneDeck(s.deck);
      const r = mutate(next);
      const deck = r ?? next;
      const history = opts?.history !== false;
      const selectedIds = s.selectedIds.filter((id) => currentSlideOf({ deck, currentSlideId: s.currentSlideId })?.elements.some((e) => e.id === id));
      const currentSlideId = deck.slides.some((x) => x.id === s.currentSlideId) ? s.currentSlideId : deck.slides[0]?.id ?? null;
      return { deck, selectedIds, currentSlideId, changeTick: s.changeTick + 1, ...(history ? { past: [...s.past.slice(-(HISTORY_LIMIT - 1)), cloneDeck(s.deck)], future: [] } : {}) };
    }),
    undo: () => set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      const currentSlideId = prev.slides.some((x) => x.id === s.currentSlideId) ? s.currentSlideId : prev.slides[0]?.id ?? null;
      return { deck: prev, past: s.past.slice(0, -1), future: [cloneDeck(s.deck), ...s.future].slice(0, HISTORY_LIMIT), selectedIds: [], editingId: null, currentSlideId, changeTick: s.changeTick + 1 };
    }),
    redo: () => set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      const currentSlideId = next.slides.some((x) => x.id === s.currentSlideId) ? s.currentSlideId : next.slides[0]?.id ?? null;
      return { deck: next, future: s.future.slice(1), past: [...s.past, cloneDeck(s.deck)].slice(-HISTORY_LIMIT), selectedIds: [], editingId: null, currentSlideId, changeTick: s.changeTick + 1 };
    }),

    addSlide: (layout, afterId) => {
      const s = get();
      const after = afterId === undefined ? s.currentSlideId : afterId;
      const index = after ? s.deck.slides.findIndex((x) => x.id === after) + 1 : s.deck.slides.length;
      const slide = buildSlide(layout, { title: layout === "title" ? "Presentation title" : layout === "section" ? "Section title" : layout === "quote" ? undefined : "Slide title", subtitle: layout === "title" || layout === "section" ? "Subtitle" : undefined, body: layout === "bullets" ? "- First point\n- Second point\n- Third point" : undefined, left: layout === "two_column" || layout === "comparison" ? "- Point" : undefined, right: layout === "two_column" || layout === "comparison" ? "- Point" : undefined, quote: layout === "quote" ? "Quotation" : undefined, attribution: layout === "quote" ? "Attribution" : undefined, agenda: layout === "agenda" ? ["First item", "Second item", "Third item"] : undefined, timeline: layout === "timeline" ? [{ date: "2024", label: "Event one" }, { date: "2025", label: "Event two" }, { date: "2026", label: "Event three" }] : undefined, table: layout === "table" ? { header: ["Column A", "Column B", "Column C"], rows: [["", "", ""], ["", "", ""]] } : undefined, chart: layout === "chart" ? { type: "bar", categories: ["2024", "2025", "2026"], series: [{ name: "Series A", values: [12, 18, 24] }], showLegend: false, showValues: true } : undefined, date: layout === "title" ? new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : undefined }, s.deck.theme, { slideNumber: index + 1 });
      s.patch((deck) => { deck.slides.splice(index, 0, slide); });
      set({ currentSlideId: slide.id, selectedIds: [], editingId: null });
      return slide.id;
    },
    deleteSlide: (id) => {
      const s = get();
      const i = s.deck.slides.findIndex((x) => x.id === id);
      if (i < 0) return;
      const nextId = s.deck.slides[i + 1]?.id ?? s.deck.slides[i - 1]?.id ?? null;
      s.patch((deck) => { deck.slides.splice(i, 1); });
      set({ currentSlideId: get().deck.slides.some((x) => x.id === s.currentSlideId) ? s.currentSlideId : nextId, selectedIds: [], editingId: null });
    },
    duplicateSlide: (id) => {
      const s = get();
      const i = s.deck.slides.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const copy = cloneSlide(s.deck.slides[i]);
      s.patch((deck) => { deck.slides.splice(i + 1, 0, copy); });
      set({ currentSlideId: copy.id, selectedIds: [], editingId: null });
      return copy.id;
    },
    moveSlide: (from, to) => {
      if (from === to) return;
      get().patch((deck) => { const [s] = deck.slides.splice(from, 1); deck.slides.splice(to, 0, s); });
    },
    toggleHidden: (id) => mutateSlide(id, (slide) => { slide.hidden = !slide.hidden; }),
    setLayout: (id, layout) => { const s = get(); const index = s.deck.slides.findIndex((x) => x.id === id); mutateSlide(id, (slide) => applyLayout(slide, layout, s.deck.theme, index + 1)); set({ selectedIds: [], editingId: null }); },
    setNotes: (id, notes) => mutateSlide(id, (slide) => { slide.notes = notes; }, { history: false }),
    setBackground: (id, bg) => mutateSlide(id, (slide) => { slide.background = bg ?? undefined; }),
    setTheme: (themeId) => {
      const theme = getTheme(themeId);
      get().patch((deck) => { deck.theme = theme; for (const sl of deck.slides) if (sl.layout === "title") sl.background = { ...(sl.background ?? {}), color: theme.titleBg ?? theme.colors.accent }; });
    },

    addElement: (partial, opts) => {
      const s = get();
      const slideId = opts?.slideId ?? s.currentSlideId;
      if (!slideId) return null;
      const el = makeElement(partial);
      mutateSlide(slideId, (slide) => { el.z = Math.max(-1, ...slide.elements.map((e) => e.z)) + 1; slide.elements.push(clampToSlide(el)); });
      if (opts?.select !== false) set({ selectedIds: [el.id], editingId: null });
      return el.id;
    },
    updateElement: (id, patch, opts) => {
      const s = get();
      if (!s.currentSlideId) return;
      mutateSlide(s.currentSlideId, (slide) => { const i = slide.elements.findIndex((e) => e.id === id); if (i < 0) return; const p = typeof patch === "function" ? patch(slide.elements[i]) : patch; slide.elements[i] = { ...slide.elements[i], ...p, style: p.style ? { ...slide.elements[i].style, ...p.style } : slide.elements[i].style }; }, opts);
    },
    updateSelected: (fn) => {
      const s = get();
      if (!s.currentSlideId || !s.selectedIds.length) return;
      const ids = new Set(s.selectedIds);
      mutateSlide(s.currentSlideId, (slide) => { slide.elements = slide.elements.map((e) => { if (!ids.has(e.id)) return e; const p = fn(e); return { ...e, ...p, style: p.style ? { ...e.style, ...p.style } : e.style }; }); });
    },
    deleteSelected: () => {
      const s = get();
      if (!s.currentSlideId || !s.selectedIds.length) return;
      const ids = new Set(s.selectedIds);
      mutateSlide(s.currentSlideId, (slide) => { slide.elements = slide.elements.filter((e) => !ids.has(e.id) || e.locked); });
      set({ selectedIds: [], editingId: null });
    },
    duplicateSelected: () => {
      const s = get();
      const sel = selectedElementsOf(s);
      if (!s.currentSlideId || !sel.length) return;
      const copies = sel.map((e) => ({ ...JSON.parse(JSON.stringify(e)) as DeckElement, id: newElementId(), x: e.x + 24, y: e.y + 24 }));
      const gm = new Map<string, string>();
      for (const c of copies) if (c.groupId) { if (!gm.has(c.groupId)) gm.set(c.groupId, groupIdFactory()); c.groupId = gm.get(c.groupId); }
      mutateSlide(s.currentSlideId, (slide) => { let z = Math.max(-1, ...slide.elements.map((e) => e.z)) + 1; for (const c of copies) { c.z = z++; slide.elements.push(clampToSlide(c)); } });
      set({ selectedIds: copies.map((c) => c.id), editingId: null });
    },
    copy: () => { const sel = selectedElementsOf(get()); if (sel.length) set({ clipboard: JSON.parse(JSON.stringify(sel)) }); },
    cut: () => { const s = get(); const sel = selectedElementsOf(s); if (!sel.length) return; set({ clipboard: JSON.parse(JSON.stringify(sel)) }); s.deleteSelected(); },
    paste: () => {
      const s = get();
      if (!s.clipboard?.length || !s.currentSlideId) return;
      const slide = currentSlideOf(s);
      const sameSlide = slide?.elements.some((e) => s.clipboard!.some((c) => c.id === e.id));
      const copies = s.clipboard.map((e) => ({ ...e, id: newElementId(), x: sameSlide ? e.x + 24 : e.x, y: sameSlide ? e.y + 24 : e.y }));
      const gm = new Map<string, string>();
      for (const c of copies) if (c.groupId) { if (!gm.has(c.groupId)) gm.set(c.groupId, groupIdFactory()); c.groupId = gm.get(c.groupId); }
      mutateSlide(s.currentSlideId, (sl) => { let z = Math.max(-1, ...sl.elements.map((e) => e.z)) + 1; for (const c of copies) { c.z = z++; sl.elements.push(clampToSlide(c)); } });
      set({ selectedIds: copies.map((c) => c.id), editingId: null, clipboard: copies.map((c) => ({ ...c })) });
    },
    nudge: (dx, dy) => { const s = get(); if (!s.selectedIds.length) return; s.updateSelected((e) => ({ x: e.x + dx, y: e.y + dy })); },
    reorder: (how) => {
      const s = get();
      if (!s.currentSlideId || !s.selectedIds.length) return;
      const ids = new Set(s.selectedIds);
      mutateSlide(s.currentSlideId, (slide) => {
        const sorted = [...slide.elements].sort((a, b) => a.z - b.z);
        const sel = sorted.filter((e) => ids.has(e.id)), rest = sorted.filter((e) => !ids.has(e.id));
        let order: DeckElement[];
        if (how === "front") order = [...rest, ...sel];
        else if (how === "back") order = [...sel, ...rest];
        else {
          order = sorted;
          if (how === "forward") for (let i = order.length - 2; i >= 0; i--) { if (ids.has(order[i].id) && !ids.has(order[i + 1].id)) [order[i], order[i + 1]] = [order[i + 1], order[i]]; }
          else for (let i = 1; i < order.length; i++) { if (ids.has(order[i].id) && !ids.has(order[i - 1].id)) [order[i], order[i - 1]] = [order[i - 1], order[i]]; }
        }
        order.forEach((e, i) => { e.z = i; });
        slide.elements = order;
      });
    },
    align: (kind) => {
      const s = get();
      const sel = selectedElementsOf(s);
      if (!sel.length) return;
      const box = sel.length > 1 ? unionRect(sel) : { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H };
      s.updateSelected((e) => {
        switch (kind) {
          case "left": return { x: box.x };
          case "center": return { x: Math.round(box.x + (box.w - e.w) / 2) };
          case "right": return { x: box.x + box.w - e.w };
          case "top": return { y: box.y };
          case "middle": return { y: Math.round(box.y + (box.h - e.h) / 2) };
          case "bottom": return { y: box.y + box.h - e.h };
        }
      });
    },
    distribute: (axis) => {
      const s = get();
      const sel = selectedElementsOf(s);
      if (sel.length < 3) return;
      const sorted = [...sel].sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));
      const first = sorted[0], last = sorted[sorted.length - 1];
      const total = axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
      const sizes = sorted.reduce((n, e) => n + (axis === "h" ? e.w : e.h), 0);
      const gap = (total - sizes) / (sorted.length - 1);
      const pos = new Map<string, number>();
      let cursor = axis === "h" ? first.x : first.y;
      for (const e of sorted) { pos.set(e.id, Math.round(cursor)); cursor += (axis === "h" ? e.w : e.h) + gap; }
      s.updateSelected((e) => (axis === "h" ? { x: pos.get(e.id) ?? e.x } : { y: pos.get(e.id) ?? e.y }));
    },
    group: () => { const s = get(); if (s.selectedIds.length < 2) return; const gid = groupIdFactory(); s.updateSelected(() => ({ groupId: gid })); },
    ungroup: () => { const s = get(); if (!s.selectedIds.length) return; s.updateSelected(() => ({ groupId: undefined })); },
    selectAll: () => { const slide = currentSlideOf(get()); if (slide) set({ selectedIds: slide.elements.filter((e) => !e.locked).map((e) => e.id), editingId: null }); },

    applyProposals: (proposals) => {
      const applied: string[] = []; const failed: { id: string; error: string }[] = [];
      const s = get();
      let deck = s.deck;
      let focus: { slideId?: string; elementId?: string } | null = null;
      for (const p of proposals) {
        try {
          deck = applyOp(deck, p.payload);
          applied.push(p.id);
          if (!focus) { const [slideId, elementId] = (p.target ?? "").split("/"); focus = { slideId: slideId || (p.payload as { slideId?: string }).slideId || (p.payload as { slide?: DeckSlide }).slide?.id, elementId }; }
        } catch (e) { failed.push({ id: p.id, error: (e as Error).message }); }
      }
      if (applied.length) {
        set((st) => ({ deck, past: [...st.past.slice(-(HISTORY_LIMIT - 1)), cloneDeck(st.deck)], future: [], changeTick: st.changeTick + 1 }));
        const slideId = focus?.slideId && deck.slides.some((x) => x.id === focus?.slideId) ? focus.slideId : deck.slides.some((x) => x.id === s.currentSlideId) ? s.currentSlideId : deck.slides[0]?.id ?? null;
        set({ currentSlideId: slideId, selectedIds: focus?.elementId ? [focus.elementId] : [], editingId: null });
      }
      return { applied, failed };
    },
  };
});

/** Snap a value to the grid when snapping is on. */
export function snapToGrid(v: number, on: boolean) { return on ? Math.round(v / GRID) * GRID : Math.round(v); }
