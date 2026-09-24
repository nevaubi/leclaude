"use client";
/**
 * Interactive slide canvas: fit-to-width zoom, hit-testing overlay, drag /
 * resize / rotate handles, marquee selection, snap-to-grid, smart alignment
 * guides, in-place text editing and keyboard editing shortcuts.
 */
import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { GRID, SLIDE_H, SLIDE_W, estimateTextFit, unionRect, type DeckElement, type Rect } from "./model";
import { SlideView } from "./slide-view";
import { TextEditor, type TextEditorHandle } from "./text-editor";
import { currentSlideOf, selectedElementsOf, useSlidesStore } from "./store";

type HandlePos = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: HandlePos[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

interface DragState {
  kind: "move" | "resize" | "rotate" | "marquee";
  pointerId: number;
  startX: number;
  startY: number;
  ids: string[];
  origin: Map<string, Rect & { rotation?: number }>;
  bbox: Rect;
  handle?: HandlePos;
  moved: boolean;
  historyPushed: boolean;
  aspect?: boolean;
}

export interface SlideCanvasProps {
  textEditorRef: React.RefObject<TextEditorHandle | null>;
  onOpenElementEditor: (el: DeckElement) => void;
  /** Called with the 1280×720 slide node (for PNG capture). */
  slideNodeRef?: React.RefObject<HTMLDivElement | null>;
}

function guideCandidates(others: DeckElement[]): { v: number[]; h: number[] } {
  const v = new Set<number>([0, SLIDE_W / 2, SLIDE_W]);
  const h = new Set<number>([0, SLIDE_H / 2, SLIDE_H]);
  for (const e of others) { v.add(e.x); v.add(e.x + e.w / 2); v.add(e.x + e.w); h.add(e.y); h.add(e.y + e.h / 2); h.add(e.y + e.h); }
  return { v: Array.from(v), h: Array.from(h) };
}

/** Snap a box: returns the adjustment (dx, dy) and the guides hit. */
function snapBox(box: Rect, cands: { v: number[]; h: number[] }, threshold: number, grid: boolean): { dx: number; dy: number; v: number[]; h: number[] } {
  let dx = 0, dy = 0; const v: number[] = []; const h: number[] = [];
  let best = threshold + 1;
  for (const edge of [box.x, box.x + box.w / 2, box.x + box.w]) for (const g of cands.v) { const d = g - edge; if (Math.abs(d) < best) { best = Math.abs(d); dx = d; v.length = 0; v.push(g); } }
  if (best > threshold) { dx = grid ? Math.round(box.x / GRID) * GRID - box.x : 0; v.length = 0; }
  best = threshold + 1;
  for (const edge of [box.y, box.y + box.h / 2, box.y + box.h]) for (const g of cands.h) { const d = g - edge; if (Math.abs(d) < best) { best = Math.abs(d); dy = d; h.length = 0; h.push(g); } }
  if (best > threshold) { dy = grid ? Math.round(box.y / GRID) * GRID - box.y : 0; h.length = 0; }
  return { dx, dy, v, h };
}

export function SlideCanvas({ textEditorRef, onOpenElementEditor, slideNodeRef }: SlideCanvasProps) {
  const deck = useSlidesStore((s) => s.deck);
  const currentSlideId = useSlidesStore((s) => s.currentSlideId);
  const selectedIds = useSlidesStore((s) => s.selectedIds);
  const editingId = useSlidesStore((s) => s.editingId);
  const zoom = useSlidesStore((s) => s.zoom);
  const showGrid = useSlidesStore((s) => s.showGrid);
  const snap = useSlidesStore((s) => s.snap);
  const showGuides = useSlidesStore((s) => s.showGuides);
  const guides = useSlidesStore((s) => s.guides);
  const slide = currentSlideOf({ deck, currentSlideId });
  const theme = deck.theme;

  const viewportRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [marquee, setMarquee] = React.useState<Rect | null>(null);
  const drag = React.useRef<DragState | null>(null);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => { const r = entries[0]?.contentRect; if (r) setSize({ w: r.width, h: r.height }); });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const scale = zoom === "fit" ? Math.max(0.1, Math.min((size.w - 48) / SLIDE_W, (size.h - 48) / SLIDE_H)) : zoom;
  const inv = 1 / Math.max(0.05, scale);

  const toSlide = React.useCallback((clientX: number, clientY: number) => {
    const r = layerRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  }, [scale]);

  const selected = React.useMemo(() => selectedElementsOf({ deck, currentSlideId, selectedIds }), [deck, currentSlideId, selectedIds]);
  const bbox = selected.length ? unionRect(selected) : null;
  const editing = editingId ? slide?.elements.find((e) => e.id === editingId) ?? null : null;

  // ---- pointer interactions -------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const st = useSlidesStore.getState();
    if (st.editingId && !target.closest("[data-overlay='text-editor']")) { /* blur commits */ }
    const p = toSlide(e.clientX, e.clientY);
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle as HandlePos | "rotate" | undefined;
    if (handle && bbox) {
      e.preventDefault();
      const origin = new Map(selected.map((el) => [el.id, { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation }]));
      drag.current = { kind: handle === "rotate" ? "rotate" : "resize", pointerId: e.pointerId, startX: p.x, startY: p.y, ids: selected.map((s) => s.id), origin, bbox, handle: handle === "rotate" ? undefined : handle, moved: false, historyPushed: false, aspect: selected.length === 1 && selected[0].type === "image" };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const hit = target.closest<HTMLElement>("[data-hit-id]");
    if (hit) {
      const id = hit.dataset.hitId!;
      const el = slide?.elements.find((x) => x.id === id);
      if (!el) return;
      e.preventDefault();
      if (e.shiftKey || e.metaKey || e.ctrlKey) { st.select([id], { toggle: true }); return; }
      if (!st.selectedIds.includes(id)) st.select([id]);
      if (el.locked) return;
      const after = useSlidesStore.getState();
      const ids = after.selectedIds;
      const els = slide!.elements.filter((x) => ids.includes(x.id) && !x.locked);
      if (!els.length) return;
      drag.current = { kind: "move", pointerId: e.pointerId, startX: p.x, startY: p.y, ids: els.map((x) => x.id), origin: new Map(els.map((x) => [x.id, { x: x.x, y: x.y, w: x.w, h: x.h, rotation: x.rotation }])), bbox: unionRect(els), moved: false, historyPushed: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    // empty canvas → marquee
    if (!e.shiftKey) st.clearSelection();
    drag.current = { kind: "marquee", pointerId: e.pointerId, startX: p.x, startY: p.y, ids: [], origin: new Map(), bbox: { x: p.x, y: p.y, w: 0, h: 0 }, moved: false, historyPushed: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const st = useSlidesStore.getState();
    const p = toSlide(e.clientX, e.clientY);
    const dx = p.x - d.startX, dy = p.y - d.startY;
    if (!d.moved && Math.hypot(dx * scale, dy * scale) < 3) return;
    if (!d.moved) { d.moved = true; if (d.kind !== "marquee") { st.pushHistory(); d.historyPushed = true; } }
    const threshold = 6 * inv;
    if (d.kind === "marquee") {
      setMarquee({ x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y), w: Math.abs(dx), h: Math.abs(dy) });
      return;
    }
    if (d.kind === "move") {
      const others = slide!.elements.filter((x) => !d.ids.includes(x.id) && x.role !== "decor" && x.role !== "footer");
      const cands = st.showGuides ? guideCandidates(others) : { v: [], h: [] };
      const moved = { x: d.bbox.x + dx, y: d.bbox.y + dy, w: d.bbox.w, h: d.bbox.h };
      const sn = snapBox(moved, cands, st.showGuides ? threshold : 0, st.snap);
      const fx = dx + sn.dx, fy = dy + sn.dy;
      st.patch((deck) => { const sl = deck.slides.find((x) => x.id === st.currentSlideId); if (!sl) return; for (const el of sl.elements) { const o = d.origin.get(el.id); if (o) { el.x = Math.round(o.x + fx); el.y = Math.round(o.y + fy); } } }, { history: false });
      st.setGuides(st.showGuides ? { v: sn.v, h: sn.h } : { v: [], h: [] });
      return;
    }
    if (d.kind === "resize" && d.handle) {
      const b = d.bbox;
      let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
      if (d.handle.includes("w")) x1 = Math.min(x2 - 8, b.x + dx);
      if (d.handle.includes("e")) x2 = Math.max(x1 + 8, b.x + b.w + dx);
      if (d.handle.includes("n")) y1 = Math.min(y2 - 8, b.y + dy);
      if (d.handle.includes("s")) y2 = Math.max(y1 + 8, b.y + b.h + dy);
      if (d.aspect || e.shiftKey) {
        const ratio = b.w / Math.max(1, b.h);
        const w = x2 - x1, h = y2 - y1;
        if (d.handle.length === 2) { const nh = w / ratio; if (d.handle.includes("n")) y1 = y2 - nh; else y2 = y1 + nh; }
        else if (d.handle === "e" || d.handle === "w") { const nh = w / ratio; y2 = y1 + nh; }
        else { const nw = h * ratio; x2 = x1 + nw; }
      }
      // snap the moving edges
      if (st.snap || st.showGuides) {
        const others = slide!.elements.filter((x) => !d.ids.includes(x.id) && x.role !== "decor");
        const cands = st.showGuides ? guideCandidates(others) : { v: [], h: [] };
        const snapEdge = (v: number, list: number[]) => { let best = v, bd = st.showGuides ? threshold : 0; for (const g of list) { const dd = Math.abs(g - v); if (dd <= bd) { bd = dd; best = g; } } if (best === v && st.snap) return Math.round(v / GRID) * GRID; return best; };
        if (d.handle.includes("w")) x1 = snapEdge(x1, cands.v); if (d.handle.includes("e")) x2 = snapEdge(x2, cands.v);
        if (d.handle.includes("n")) y1 = snapEdge(y1, cands.h); if (d.handle.includes("s")) y2 = snapEdge(y2, cands.h);
        st.setGuides({ v: [x1, x2].filter((v) => cands.v.includes(v)), h: [y1, y2].filter((v) => cands.h.includes(v)) });
      }
      const nb = { x: x1, y: y1, w: Math.max(8, x2 - x1), h: Math.max(8, y2 - y1) };
      const sx = nb.w / Math.max(1, b.w), sy = nb.h / Math.max(1, b.h);
      st.patch((deck) => {
        const sl = deck.slides.find((x) => x.id === st.currentSlideId); if (!sl) return;
        for (const el of sl.elements) {
          const o = d.origin.get(el.id); if (!o) continue;
          if (d.ids.length === 1) { el.x = Math.round(nb.x); el.y = Math.round(nb.y); el.w = Math.round(nb.w); el.h = el.type === "line" ? Math.round(nb.h < 10 && o.h === 0 ? 0 : nb.h) : Math.round(nb.h); }
          else { el.x = Math.round(nb.x + (o.x - b.x) * sx); el.y = Math.round(nb.y + (o.y - b.y) * sy); el.w = Math.max(4, Math.round(o.w * sx)); el.h = Math.max(el.type === "line" ? 0 : 4, Math.round(o.h * sy)); }
          if (el.type === "text" && d.ids.length > 1 && el.style.fontSize) el.style.fontSize = Math.max(6, Math.round(el.style.fontSize * Math.min(sx, sy) * 10) / 10);
        }
      }, { history: false });
      return;
    }
    if (d.kind === "rotate") {
      const cx = d.bbox.x + d.bbox.w / 2, cy = d.bbox.y + d.bbox.h / 2;
      let angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      angle = Math.round(((angle % 360) + 360) % 360);
      st.patch((deck) => { const sl = deck.slides.find((x) => x.id === st.currentSlideId); if (!sl) return; for (const el of sl.elements) if (d.origin.has(el.id)) el.rotation = angle === 0 ? undefined : angle; }, { history: false });
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const st = useSlidesStore.getState();
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    st.setGuides({ v: [], h: [] });
    if (d.kind === "marquee") {
      if (marquee && slide && d.moved) {
        const hits = slide.elements.filter((el) => !el.locked && el.x < marquee.x + marquee.w && el.x + el.w > marquee.x && el.y < marquee.y + marquee.h && el.y + Math.max(1, el.h) > marquee.y).map((el) => el.id);
        st.select(hits, { add: e.shiftKey });
      }
      setMarquee(null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-hit-id]");
    if (!hit || !slide) return;
    const el = slide.elements.find((x) => x.id === hit.dataset.hitId);
    if (!el || el.locked) return;
    e.preventDefault();
    if (el.type === "text" || el.type === "shape") { useSlidesStore.getState().pushHistory(); useSlidesStore.getState().setEditing(el.id); }
    else onOpenElementEditor(el);
  };

  // ---- keyboard --------------------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable || target.closest("[role='dialog']") || target.closest("[data-radix-popper-content-wrapper]"));
      if (typing) return;
      const st = useSlidesStore.getState();
      if (st.editingId) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const sel = st.selectedIds.length;
      if (mod && key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && key.toLowerCase() === "y") { e.preventDefault(); st.redo(); return; }
      if (mod && key.toLowerCase() === "a") { e.preventDefault(); st.selectAll(); return; }
      if (mod && key.toLowerCase() === "c" && sel) { e.preventDefault(); st.copy(); return; }
      if (mod && key.toLowerCase() === "x" && sel) { e.preventDefault(); st.cut(); return; }
      if (mod && key.toLowerCase() === "v" && st.clipboard?.length) { e.preventDefault(); st.paste(); return; }
      if (mod && key.toLowerCase() === "d" && sel) { e.preventDefault(); st.duplicateSelected(); return; }
      if (mod && key.toLowerCase() === "g") { e.preventDefault(); if (e.shiftKey) st.ungroup(); else st.group(); return; }
      if (mod && (key === "]" || key === "}")) { e.preventDefault(); st.reorder(e.shiftKey ? "front" : "forward"); return; }
      if (mod && (key === "[" || key === "{")) { e.preventDefault(); st.reorder(e.shiftKey ? "back" : "backward"); return; }
      if (mod && key === "'") { e.preventDefault(); st.toggleGrid(); return; }
      if (mod) return;
      if ((key === "Delete" || key === "Backspace") && sel) { e.preventDefault(); st.deleteSelected(); return; }
      if (key === "Escape") { st.clearSelection(); return; }
      if (key === "Enter" && sel === 1) { const el = currentSlideOf(st)?.elements.find((x) => x.id === st.selectedIds[0]); if (el && (el.type === "text" || el.type === "shape")) { e.preventDefault(); st.pushHistory(); st.setEditing(el.id); } return; }
      if (key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (sel) { st.nudge(key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0, key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0); return; }
        const i = st.deck.slides.findIndex((x) => x.id === st.currentSlideId);
        const next = key === "ArrowUp" || key === "ArrowLeft" ? i - 1 : i + 1;
        if (st.deck.slides[next]) st.setCurrent(st.deck.slides[next].id);
        return;
      }
      if (key === "PageUp" || key === "PageDown") { e.preventDefault(); const i = st.deck.slides.findIndex((x) => x.id === st.currentSlideId); const next = key === "PageUp" ? i - 1 : i + 1; if (st.deck.slides[next]) st.setCurrent(st.deck.slides[next].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!slide) return <div ref={viewportRef} className="sl-viewport flex h-full items-center justify-center text-sm text-muted-foreground">No slides yet — add one from the rail.</div>;

  const handleSize = 10 * inv;
  const overflowIds = new Set(slide.elements.filter((e) => e.type === "text" && e.text?.trim() && estimateTextFit(e, theme).overflow).map((e) => e.id));

  return (
    <div ref={viewportRef} className="sl-viewport relative h-full min-h-0 w-full overflow-auto scrollbar-thin">
      <div style={{ width: Math.max(size.w, SLIDE_W * scale + 48), height: Math.max(size.h, SLIDE_H * scale + 48), display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="sl-stage" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale, position: "relative", flex: "none" }}>
          <div ref={layerRef} style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: SLIDE_W, height: SLIDE_H, position: "relative" }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={onDoubleClick}>
            <div ref={slideNodeRef} style={{ width: SLIDE_W, height: SLIDE_H, pointerEvents: "none" }}>
              <SlideView slide={slide} theme={theme} hideElementId={editingId} />
            </div>

            {/* overlay: grid, hit boxes, selection, guides, marquee, text editor */}
            <div data-overlay="canvas" style={{ position: "absolute", inset: 0 }}>
              {showGrid && (
                <svg width={SLIDE_W} height={SLIDE_H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  <defs><pattern id="sl-grid" width={GRID * 4} height={GRID * 4} patternUnits="userSpaceOnUse"><path d={`M ${GRID * 4} 0 L 0 0 0 ${GRID * 4}`} fill="none" stroke="var(--primary)" strokeOpacity={0.18} strokeWidth={inv} /></pattern></defs>
                  <rect width={SLIDE_W} height={SLIDE_H} fill="url(#sl-grid)" />
                  <line x1={SLIDE_W / 2} y1={0} x2={SLIDE_W / 2} y2={SLIDE_H} stroke="var(--primary)" strokeOpacity={0.25} strokeWidth={inv} strokeDasharray={`${6 * inv} ${6 * inv}`} />
                  <line x1={0} y1={SLIDE_H / 2} x2={SLIDE_W} y2={SLIDE_H / 2} stroke="var(--primary)" strokeOpacity={0.25} strokeWidth={inv} strokeDasharray={`${6 * inv} ${6 * inv}`} />
                </svg>
              )}

              {[...slide.elements].sort((a, b) => a.z - b.z).map((el) => (
                el.id === editingId ? null : (
                  <div key={el.id} data-hit-id={el.id} data-locked={el.locked ? "true" : undefined} className="sl-hit" style={{ left: el.x, top: el.y, width: el.w, height: Math.max(el.type === "line" ? 12 : 1, el.h), transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, transformOrigin: "center center", cursor: el.locked ? "default" : "move", marginTop: el.type === "line" && el.h < 12 ? -6 : 0 }} />
                )
              ))}

              {bbox && !editingId && (
                <>
                  {selected.length > 1 && selected.map((el) => <div key={el.id} style={{ position: "absolute", left: el.x, top: el.y, width: el.w, height: Math.max(1, el.h), outline: `${inv}px solid var(--primary)`, outlineOffset: 0, pointerEvents: "none", transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }} />)}
                  {(() => {
                    const single = selected.length === 1 ? selected[0] : null;
                    const rot = single?.rotation;
                    const b = single ? { x: single.x, y: single.y, w: single.w, h: Math.max(1, single.h) } : bbox;
                    const locked = single?.locked;
                    return (
                      <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, transform: rot ? `rotate(${rot}deg)` : undefined, transformOrigin: "center center", pointerEvents: "none" }}>
                        <div style={{ position: "absolute", inset: -inv, border: `${1.5 * inv}px solid var(--primary)`, borderStyle: single?.groupId ? "dashed" : "solid" }} />
                        {!locked && HANDLES.map((pos) => {
                          const left = pos.includes("w") ? -handleSize / 2 : pos.includes("e") ? b.w - handleSize / 2 : b.w / 2 - handleSize / 2;
                          const top = pos.includes("n") ? -handleSize / 2 : pos.includes("s") ? b.h - handleSize / 2 : b.h / 2 - handleSize / 2;
                          if (single?.type === "line" && !["e", "w", "n", "s"].includes(pos) && b.h > 8) return null;
                          return <div key={pos} data-handle={pos} className="sl-handle" style={{ left, top, width: handleSize, height: handleSize, pointerEvents: "auto", borderWidth: 1.5 * inv }} />;
                        })}
                        {!locked && single && single.type !== "line" && (
                          <>
                            <div style={{ position: "absolute", left: b.w / 2, top: -28 * inv, width: inv, height: 22 * inv, background: "var(--primary)" }} />
                            <div data-handle="rotate" className="sl-rotate" style={{ left: b.w / 2 - 9 * inv, top: -40 * inv, width: 18 * inv, height: 18 * inv, pointerEvents: "auto", borderWidth: 1.5 * inv }}><RotateCw style={{ width: 10 * inv, height: 10 * inv }} /></div>
                          </>
                        )}
                        {single && overflowIds.has(single.id) && (
                          <div title="Text overflows the box" style={{ position: "absolute", right: -inv, bottom: -inv, transform: "translate(50%, 50%)", background: "var(--warning)", color: "var(--warning-foreground)", borderRadius: 999, padding: 3 * inv, display: "flex" }}><AlertTriangle style={{ width: 12 * inv, height: 12 * inv }} /></div>
                        )}
                        <div style={{ position: "absolute", left: 0, top: -22 * inv, transform: `translateY(${single?.type !== "line" ? -22 * inv : 0}px)`, fontSize: 11 * inv, lineHeight: 1, padding: `${3 * inv}px ${6 * inv}px`, background: "var(--primary)", color: "var(--primary-foreground)", borderRadius: 4 * inv, whiteSpace: "nowrap", fontFamily: "var(--font-sans)" }}>
                          {single ? `${single.name ?? single.role ?? single.type} · ${Math.round(single.w)}×${Math.round(single.h)}` : `${selected.length} elements`}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {(guides.v.length > 0 || guides.h.length > 0) && (
                <svg width={SLIDE_W} height={SLIDE_H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  {guides.v.map((x) => <line key={`v${x}`} x1={x} y1={0} x2={x} y2={SLIDE_H} stroke="var(--destructive)" strokeWidth={inv} strokeDasharray={`${4 * inv} ${3 * inv}`} />)}
                  {guides.h.map((y) => <line key={`h${y}`} x1={0} y1={y} x2={SLIDE_W} y2={y} stroke="var(--destructive)" strokeWidth={inv} strokeDasharray={`${4 * inv} ${3 * inv}`} />)}
                </svg>
              )}

              {marquee && <div style={{ position: "absolute", left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, border: `${inv}px solid var(--primary)`, background: "color-mix(in oklch, var(--primary) 10%, transparent)", pointerEvents: "none" }} />}

              {editing && (
                <TextEditor
                  key={editing.id}
                  ref={textEditorRef}
                  element={editing}
                  theme={theme}
                  onChange={(text) => useSlidesStore.getState().updateElement(editing.id, { text }, { history: false })}
                  onCommit={() => { const st = useSlidesStore.getState(); if (st.editingId === editing.id) st.setEditing(null); }}
                  onCancel={() => useSlidesStore.getState().setEditing(null)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useCanvasScale() {
  return useSlidesStore((s) => s.zoom);
}
