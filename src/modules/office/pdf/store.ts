"use client";
/**
 * Editor state for the PDF editor: the content model with undo/redo history,
 * the active tool, zoom, current page, selection and search state. Proposals
 * from the agent are applied through the same `applyOp` used on the server.
 */
import { create } from "zustand";
import type { ApplyResult, EditProposal } from "@/modules/office/shared";
import { DEFAULT_COLOR, activePages, emptyModel, newAnnotationId, normalizeModel, sourceToDisplay, type AnnotationType, type PdfAnnotation, type PdfModel, type PdfRect } from "./model";
import { applyOp, type PdfOp } from "./proposals";
import type { TextMatch } from "./text-search";

export type Tool = "select" | "hand" | "highlight" | "underline" | "strikeout" | "note" | "text" | "rect" | "ellipse" | "freehand" | "stamp" | "redaction" | "link" | "signature";
export type ZoomMode = number | "fit-width" | "fit-page";
export type SidebarTab = "annotations" | "outline" | "search" | "forms" | "comments";

export interface SearchHit { display: number; source: number; match: TextMatch }

export interface PdfEditorState {
  model: PdfModel;
  loaded: boolean;
  docId: string | null;
  /** Bumped on every model change (autosave). */
  changeTick: number;
  history: PdfModel[];
  future: PdfModel[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  fontSize: number;
  stampText: string;
  redactionReason: string;
  signatureDataUrl: string | null;
  zoom: ZoomMode;
  /** Effective scale computed by the viewer for fit modes. */
  effectiveScale: number;
  currentPage: number;
  selectedAnnotationId: string | null;
  selectedPageIds: string[];
  darkInvert: boolean;
  sidebarTab: SidebarTab | null;
  railOpen: boolean;
  search: { query: string; regex: boolean; caseSensitive: boolean; hits: SearchHit[]; index: number; running: boolean };
  scrollRequest: { display: number; rect?: PdfRect; nonce: number } | null;
  /** Text selection in the text layer (for scope + markups). */
  selection: { source: number; display: number; text: string; rects: PdfRect[] } | null;
  flash: { id: string; nonce: number } | null;

  load: (model: PdfModel, docId: string | null) => void;
  setModel: (model: PdfModel, opts?: { history?: boolean }) => void;
  applyOp: (op: PdfOp, opts?: { history?: boolean }) => void;
  applyProposals: (proposals: EditProposal[]) => Promise<ApplyResult>;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  addAnnotation: (a: Omit<PdfAnnotation, "id" | "author" | "createdAt" | "color" | "opacity"> & Partial<Pick<PdfAnnotation, "color" | "opacity" | "id">>) => PdfAnnotation;
  updateAnnotation: (id: string, patch: Partial<PdfAnnotation>, opts?: { history?: boolean }) => void;
  removeAnnotations: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  setColor: (c: string) => void;
  setZoom: (z: ZoomMode) => void;
  setEffectiveScale: (s: number) => void;
  setCurrentPage: (n: number) => void;
  select: (id: string | null) => void;
  selectPages: (ids: string[]) => void;
  setDarkInvert: (v: boolean) => void;
  setSidebarTab: (t: SidebarTab | null) => void;
  setRailOpen: (v: boolean) => void;
  setSearch: (patch: Partial<PdfEditorState["search"]>) => void;
  scrollTo: (display: number, rect?: PdfRect) => void;
  setSelection: (s: PdfEditorState["selection"]) => void;
  setPrefs: (p: Partial<Pick<PdfEditorState, "strokeWidth" | "fontSize" | "stampText" | "redactionReason" | "signatureDataUrl">>) => void;
  flashAnnotation: (id: string) => void;
}

export const CURRENT_USER = "Jordan Whitfield";
const MAX_HISTORY = 80;

export const usePdfStore = create<PdfEditorState>((set, get) => ({
  model: emptyModel(),
  loaded: false,
  docId: null,
  changeTick: 0,
  history: [],
  future: [],
  tool: "select",
  color: DEFAULT_COLOR.highlight,
  strokeWidth: 2,
  fontSize: 11,
  stampText: "CONFIDENTIAL",
  redactionReason: "PII",
  signatureDataUrl: null,
  zoom: "fit-width",
  effectiveScale: 1,
  currentPage: 1,
  selectedAnnotationId: null,
  selectedPageIds: [],
  darkInvert: false,
  sidebarTab: null,
  railOpen: true,
  search: { query: "", regex: false, caseSensitive: false, hits: [], index: -1, running: false },
  scrollRequest: null,
  selection: null,
  flash: null,

  load: (model, docId) => set({ model: normalizeModel(model), docId, loaded: true, history: [], future: [], changeTick: 0, selectedAnnotationId: null, selectedPageIds: [], currentPage: 1, search: { query: "", regex: false, caseSensitive: false, hits: [], index: -1, running: false }, selection: null }),
  setModel: (model, opts) => set((s) => ({ model, history: opts?.history === false ? s.history : [...s.history.slice(-MAX_HISTORY + 1), s.model], future: opts?.history === false ? s.future : [], changeTick: s.changeTick + 1 })),
  applyOp: (op, opts) => { const s = get(); s.setModel(applyOp(s.model, op), opts); },
  applyProposals: async (proposals) => {
    const applied: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const s = get();
    let model = s.model;
    for (const p of proposals) {
      try { model = applyOp(model, p.payload as unknown as PdfOp); applied.push(p.id); }
      catch (e) { failed.push({ id: p.id, error: (e as Error).message }); }
    }
    if (applied.length) s.setModel(model);
    // Jump to the first affected page.
    const first = proposals.find((p) => applied.includes(p.id) && p.target?.startsWith("page:"));
    if (first) { const d = Number(first.target!.slice(5)); if (d) get().scrollTo(d); }
    return { applied, failed };
  },
  undo: () => set((s) => { const prev = s.history[s.history.length - 1]; if (!prev) return {}; return { model: prev, history: s.history.slice(0, -1), future: [s.model, ...s.future].slice(0, MAX_HISTORY), changeTick: s.changeTick + 1, selectedAnnotationId: null }; }),
  redo: () => set((s) => { const next = s.future[0]; if (!next) return {}; return { model: next, future: s.future.slice(1), history: [...s.history, s.model].slice(-MAX_HISTORY), changeTick: s.changeTick + 1 }; }),
  pushHistory: () => set((s) => ({ history: [...s.history.slice(-MAX_HISTORY + 1), s.model], future: [] })),
  addAnnotation: (input) => {
    const s = get();
    const a: PdfAnnotation = { id: input.id ?? newAnnotationId(), author: CURRENT_USER, createdAt: new Date().toISOString(), color: input.color ?? s.color, opacity: input.opacity ?? defaultOpacity(input.type), ...input } as PdfAnnotation;
    s.applyOp({ op: "add_annotations", annotations: [a] });
    return a;
  },
  updateAnnotation: (id, patch, opts) => { const s = get(); if (!s.model.annotations.some((a) => a.id === id)) return; s.applyOp({ op: "update_annotation", id, patch }, opts); },
  removeAnnotations: (ids) => { const s = get(); s.applyOp({ op: "remove_annotations", ids }); set((st) => ({ selectedAnnotationId: ids.includes(st.selectedAnnotationId ?? "") ? null : st.selectedAnnotationId })); },
  setTool: (tool) => set((s) => ({ tool, selectedAnnotationId: tool === "select" ? s.selectedAnnotationId : null, color: tool === "select" || tool === "hand" ? s.color : DEFAULT_COLOR[tool as AnnotationType] ?? s.color })),
  setColor: (color) => set((s) => { if (s.selectedAnnotationId) { const model = applyOp(s.model, { op: "update_annotation", id: s.selectedAnnotationId, patch: { color } }); return { color, model, history: [...s.history, s.model].slice(-MAX_HISTORY), future: [], changeTick: s.changeTick + 1 }; } return { color }; }),
  setZoom: (zoom) => set({ zoom }),
  setEffectiveScale: (effectiveScale) => set((s) => (Math.abs(s.effectiveScale - effectiveScale) < 0.0005 ? {} : { effectiveScale })),
  setCurrentPage: (currentPage) => set((s) => (s.currentPage === currentPage ? {} : { currentPage })),
  select: (selectedAnnotationId) => set({ selectedAnnotationId }),
  selectPages: (selectedPageIds) => set({ selectedPageIds }),
  setDarkInvert: (darkInvert) => set({ darkInvert }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setRailOpen: (railOpen) => set({ railOpen }),
  setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
  scrollTo: (display, rect) => set((s) => ({ scrollRequest: { display, rect, nonce: (s.scrollRequest?.nonce ?? 0) + 1 } })),
  setSelection: (selection) => set({ selection }),
  setPrefs: (p) => set(p),
  flashAnnotation: (id) => set((s) => ({ flash: { id, nonce: (s.flash?.nonce ?? 0) + 1 } })),
}));

function defaultOpacity(type: AnnotationType) { return type === "highlight" ? 0.4 : type === "stamp" ? 0.9 : 1; }

/** Convenience selectors. */
export function pageCountOf(model: PdfModel) { return activePages(model).length; }
export function displayOf(model: PdfModel, source: number) { return sourceToDisplay(model, source); }
