/**
 * Normalized, id-free view of an imported deck used to compare import → export → re-import round trips:
 * OOXML identity (shape id, kind, placeholder), effective EMU geometry, text (markdown + paragraph runs), tables
 * (cells with merges/fills/borders), charts, crops, notes, hidden/sections/transitions and backgrounds.
 */
import type { DeckContent, DeckElement, DeckSlide, EmuRect, RichParagraph } from "../model";
import { pxToEmuLen, pxToEmuX, pxToEmuY } from "./writer";
import type { CanvasMap } from "./reader";

export interface NormalizeOptions { runs?: boolean }

/** EMU geometry the exporter writes for an element: source EMU for unchanged components, converted px otherwise. */
export function effectiveEmu(e: DeckElement, map: CanvasMap): EmuRect {
  const o = e.ooxml;
  if (!o) return { x: pxToEmuX(e.x, map), y: pxToEmuY(e.y, map), cx: pxToEmuLen(e.w, map), cy: pxToEmuLen(e.h, map), ...(e.rotation ? { rot: Math.round(e.rotation * 60000) } : {}), ...(e.flipH ? { flipH: true } : {}), ...(e.flipV ? { flipV: true } : {}) };
  const b = o.base;
  const r: EmuRect = { x: e.x === b.x ? o.emu.x : pxToEmuX(e.x, map), y: e.y === b.y ? o.emu.y : pxToEmuY(e.y, map), cx: e.w === b.w ? o.emu.cx : pxToEmuLen(e.w, map), cy: e.h === b.h ? o.emu.cy : pxToEmuLen(e.h, map) };
  const rot = (e.rotation ?? 0) === (b.rotation ?? 0) ? o.emu.rot : e.rotation ? Math.round(e.rotation * 60000) : undefined;
  if (rot) r.rot = rot;
  if (e.flipH) r.flipH = true;
  if (e.flipV) r.flipV = true;
  return r;
}

const clean = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length))) as T;

function paragraphs(ps: RichParagraph[] | undefined) {
  return (ps ?? []).map((p) => clean({ level: p.level, bullet: p.bullet, bulletChar: p.bulletChar, numScheme: p.numScheme, align: p.align, spaceBefore: p.spaceBefore, spaceAfter: p.spaceAfter, lineSpacing: p.lineSpacing, runs: p.runs.map((r) => clean({ ...r })) }));
}

export function normalizedElement(e: DeckElement, map: CanvasMap, opts: NormalizeOptions = {}) {
  const o = e.ooxml;
  const textUnchanged = (e.text ?? "") === (e.rich?.markdown ?? "");
  return clean({
    spid: o?.spid,
    kind: o?.kind,
    name: o?.name,
    ph: o?.ph ? clean({ ...o.ph }) : undefined,
    type: e.type,
    role: e.role,
    emu: effectiveEmu(e, map),
    text: e.text || undefined,
    paragraphs: opts.runs !== false && e.rich && textUnchanged ? paragraphs(e.rich.paragraphs) : undefined,
    table: e.table ? clean({ header: e.table.header, rows: e.table.rows, cells: e.table.cells?.map((r) => r.map((c) => clean({ ...c }))) }) : undefined,
    chart: e.chart ? clean({ ...e.chart }) : undefined,
    crop: e.crop,
    media: o?.media ? true : e.type === "image" ? Boolean(e.src) : undefined,
    fill: e.style.fill,
    stroke: e.style.stroke,
  });
}

export function normalizedSlide(s: DeckSlide, map: CanvasMap, opts: NormalizeOptions = {}) {
  return clean({
    layout: s.ooxml?.layoutName,
    hidden: s.hidden,
    section: s.section,
    notes: s.notes || undefined,
    transition: s.transition,
    background: s.background,
    elements: [...s.elements].sort((a, b) => a.z - b.z).map((e) => normalizedElement(e, map, opts)),
  });
}

export function normalizedDeck(d: DeckContent, opts: NormalizeOptions = {}) {
  const map = d.meta?.pptx?.map ?? { scale: 1280 / 12192000, offX: 0, offY: 0 };
  return { theme: { fonts: d.theme.fonts, colors: d.theme.colors }, slides: d.slides.map((s) => normalizedSlide(s, map, opts)) };
}
