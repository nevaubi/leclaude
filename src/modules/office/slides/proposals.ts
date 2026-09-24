/**
 * Slides edit proposals: the payload vocabulary shared by the agent tools
 * (server, which mutates the snapshot deck) and the editor store (client,
 * which applies accepted proposals as undoable edits).
 */
import { cloneSlide, normalizeElement, normalizeSlide, type DeckContent, type DeckElement, type DeckSlide, type DeckTheme, type SlideBackground, type SlideLayout } from "./model";

export type SlidesOp =
  | { op: "add_slide"; afterId: string | null; slide: DeckSlide }
  | { op: "replace_slide"; slideId: string; slide: DeckSlide }
  | { op: "replace_slide_with"; slideId: string; slides: DeckSlide[] }
  | { op: "delete_slide"; slideId: string }
  | { op: "duplicate_slide"; slideId: string; slide: DeckSlide }
  | { op: "reorder_slides"; ids: string[] }
  | { op: "set_element"; slideId: string; elementId: string; patch: Partial<DeckElement> }
  | { op: "add_element"; slideId: string; element: DeckElement }
  | { op: "remove_element"; slideId: string; elementId: string }
  | { op: "set_slide"; slideId: string; patch: { notes?: string; background?: SlideBackground | null; transition?: DeckSlide["transition"]; hidden?: boolean; layout?: SlideLayout; name?: string } }
  | { op: "apply_theme"; theme: DeckTheme }
  | { op: "replace_deck"; slides: DeckSlide[]; theme?: DeckTheme };

export function slideIndex(deck: DeckContent, slideId: string): number {
  const i = deck.slides.findIndex((s) => s.id === slideId);
  if (i < 0) throw new Error(`No slide with id "${slideId}"`);
  return i;
}

/** Apply one operation, returning a new deck (input untouched). Throws on invalid targets. */
export function applyOp(deck: DeckContent, raw: SlidesOp | Record<string, unknown>): DeckContent {
  const op = raw as SlidesOp;
  const slides = deck.slides.map((s) => ({ ...s, elements: s.elements.map((e) => ({ ...e })) }));
  const next: DeckContent = { ...deck, slides };
  switch (op.op) {
    case "add_slide": {
      const slide = normalizeSlide(op.slide);
      const i = op.afterId ? slideIndex(next, op.afterId) + 1 : slides.length;
      if (slides.some((s) => s.id === slide.id)) slide.id = cloneSlide(slide).id;
      slides.splice(i, 0, slide);
      return next;
    }
    case "replace_slide": {
      const i = slideIndex(next, op.slideId);
      slides[i] = { ...normalizeSlide(op.slide), id: op.slideId };
      return next;
    }
    case "replace_slide_with": {
      const i = slideIndex(next, op.slideId);
      const repl = op.slides.map((s) => normalizeSlide(s));
      if (repl.length && repl[0].id !== op.slideId) repl[0] = { ...repl[0], id: op.slideId };
      slides.splice(i, 1, ...repl);
      return next;
    }
    case "delete_slide": {
      const i = slideIndex(next, op.slideId);
      slides.splice(i, 1);
      return next;
    }
    case "duplicate_slide": {
      const i = slideIndex(next, op.slideId);
      const copy = op.slide ? normalizeSlide(op.slide) : cloneSlide(slides[i]);
      slides.splice(i + 1, 0, copy);
      return next;
    }
    case "reorder_slides": {
      const map = new Map(slides.map((s) => [s.id, s]));
      const ordered: DeckSlide[] = [];
      for (const id of op.ids) { const s = map.get(id); if (s) { ordered.push(s); map.delete(id); } }
      // any slides not mentioned keep their relative order at the end
      for (const s of slides) if (map.has(s.id)) ordered.push(s);
      next.slides = ordered;
      return next;
    }
    case "set_element": {
      const s = slides[slideIndex(next, op.slideId)];
      const j = s.elements.findIndex((e) => e.id === op.elementId);
      if (j < 0) throw new Error(`No element "${op.elementId}" on slide "${op.slideId}"`);
      const cur = s.elements[j];
      const patch = op.patch ?? {};
      s.elements[j] = normalizeElement({ ...cur, ...patch, id: cur.id, style: patch.style ? { ...cur.style, ...patch.style } : cur.style }, j);
      return next;
    }
    case "add_element": {
      const s = slides[slideIndex(next, op.slideId)];
      const e = normalizeElement(op.element, s.elements.length);
      e.z = Math.max(-1, ...s.elements.map((x) => x.z)) + 1;
      if (s.elements.some((x) => x.id === e.id)) e.id = normalizeElement({}, 0).id;
      s.elements.push(e);
      return next;
    }
    case "remove_element": {
      const s = slides[slideIndex(next, op.slideId)];
      const before = s.elements.length;
      s.elements = s.elements.filter((e) => e.id !== op.elementId);
      if (s.elements.length === before) throw new Error(`No element "${op.elementId}"`);
      return next;
    }
    case "set_slide": {
      const s = slides[slideIndex(next, op.slideId)];
      const p = op.patch ?? {};
      if (p.notes !== undefined) s.notes = p.notes;
      if (p.background !== undefined) s.background = p.background ?? undefined;
      if (p.transition !== undefined) s.transition = p.transition;
      if (p.hidden !== undefined) s.hidden = p.hidden;
      if (p.layout !== undefined) s.layout = p.layout;
      if (p.name !== undefined) s.name = p.name;
      return next;
    }
    case "apply_theme": {
      next.theme = op.theme;
      return next;
    }
    case "replace_deck": {
      next.slides = op.slides.map((s) => normalizeSlide(s));
      if (op.theme) next.theme = op.theme;
      return next;
    }
    default:
      throw new Error(`Unknown slides operation "${(raw as { op?: string }).op ?? "?"}"`);
  }
}

/** Human label for a proposal target. */
export function slideLabel(deck: DeckContent, slideId: string): string {
  const i = deck.slides.findIndex((s) => s.id === slideId);
  return i >= 0 ? `Slide ${i + 1}` : "Slide";
}
