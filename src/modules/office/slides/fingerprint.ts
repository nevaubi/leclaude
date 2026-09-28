/**
 * Content fingerprints for slides and elements (isomorphic, dependency-free).
 *
 * Used for two invariants:
 *  - package-preserving export: an imported slide/element whose fingerprint still equals the one recorded at
 *    import is written back byte-for-byte from the source package;
 *  - stale-proposal detection: an agent proposal records the fingerprint of the slide/element it was computed
 *    against, and the editor refuses to apply it once that target has changed (constitution §31/§44).
 */
import { fnv1a64 } from "@/lib/integrity/hash-pure";
import { normalizeElement, normalizeSlide, type DeckContent, type DeckElement, type DeckSlide, type DeckTheme } from "./model";

/** JSON with sorted keys; undefined, null and false-y defaults dropped so equivalent shapes hash equally. */
export function stableStringify(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== false).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

export const hashOf = (v: unknown) => fnv1a64(stableStringify(v));

/** Fingerprint of an element's content (id, z-order and OOXML link excluded). */
export function elementFingerprint(e: DeckElement): string {
  const n = normalizeElement(e) as Partial<DeckElement>;
  const { id: _id, z: _z, ooxml: _o, groupId: _g, locked: _l, name: _n, ...rest } = n;
  void _id; void _z; void _o; void _g; void _l; void _n;
  if (rest.rotation === 0) delete rest.rotation;
  return hashOf(rest);
}

/** Fingerprint of a slide's visible content (notes, ids and the app-level layout label excluded). */
export function slideFingerprint(s: DeckSlide): string {
  const n = normalizeSlide(s);
  const els = [...n.elements].sort((a, b) => a.z - b.z).map((e) => elementFingerprint(e));
  return hashOf({ bg: n.background, hidden: n.hidden, transition: n.transition && n.transition !== "none" ? n.transition : undefined, els });
}

/** Fingerprint used for stale detection: the whole slide including notes, element ids and order. */
export function slideVersion(s: DeckSlide): string {
  const n = normalizeSlide(s);
  return hashOf({ id: n.id, bg: n.background, hidden: n.hidden, transition: n.transition, notes: n.notes, layout: n.layout, section: n.section, els: n.elements.map((e) => ({ id: e.id, z: e.z, fp: elementFingerprint(e) })) });
}

export function elementVersion(e: DeckElement): string {
  return hashOf({ id: e.id, fp: elementFingerprint(e) });
}

/** Hash of an element's data payload (text, table, chart, image source and crop). */
export function elementDataFp(e: DeckElement): string {
  return hashOf({ text: e.text, table: e.table, chart: e.chart, src: e.src, crop: e.crop });
}

export function themeFingerprint(t: DeckTheme): string {
  return hashOf({ fonts: t.fonts, colors: t.colors, titleBg: t.titleBg, titleFg: t.titleFg });
}

/** Deck-level version: slide order + every slide version + theme. */
export function deckVersion(d: DeckContent): string {
  return hashOf({ order: d.slides.map((s) => slideVersion(s)), theme: themeFingerprint(d.theme) });
}

export function orderVersion(d: DeckContent): string {
  return hashOf(d.slides.map((s) => s.id));
}
