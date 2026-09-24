"use client";
/** Presenter mode: fullscreen slide, arrow/space navigation, notes + next-slide + timer panel, Esc to exit. */
import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, StickyNote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLIDE_H, SLIDE_W, slideTitle, type DeckContent } from "./model";
import { ScaledSlide, SlideView } from "./slide-view";

export function Presenter({ deck, startIndex, onExit }: { deck: DeckContent; startIndex: number; onExit: (lastIndex: number) => void }) {
  const slides = React.useMemo(() => deck.slides.filter((s) => !s.hidden), [deck]);
  const [index, setIndex] = React.useState(() => Math.max(0, Math.min(slides.length - 1, slides.findIndex((s) => s.id === deck.slides[startIndex]?.id))));
  const [notesOpen, setNotesOpen] = React.useState(true);
  const [elapsed, setElapsed] = React.useState(0);
  const [running, setRunning] = React.useState(true);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const indexRef = React.useRef(index);
  indexRef.current = index;

  React.useEffect(() => {
    const root = rootRef.current;
    root?.requestFullscreen?.().catch(() => {});
    const onFs = () => { if (!document.fullscreenElement) onExit(indexRef.current); };
    document.addEventListener("fullscreenchange", onFs);
    return () => { document.removeEventListener("fullscreenchange", onFs); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => { if (!running) return; const t = setInterval(() => setElapsed((e) => e + 1), 1000); return () => clearInterval(t); }, [running]);
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => { const r = entries[0]?.contentRect; if (r) setSize({ w: r.width, h: r.height }); });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [notesOpen]);

  const go = React.useCallback((d: number) => setIndex((i) => Math.max(0, Math.min(slides.length - 1, i + d))), [slides.length]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onExit(indexRef.current); return; }
      if (["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "Home") { e.preventDefault(); setIndex(0); }
      else if (e.key === "End") { e.preventDefault(); setIndex(slides.length - 1); }
      else if (e.key.toLowerCase() === "n") setNotesOpen((v) => !v);
      else if (e.key.toLowerCase() === "t") setRunning((v) => !v);
      else if (/^[1-9]$/.test(e.key)) setIndex(Math.min(slides.length - 1, Number(e.key) - 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, onExit, slides.length]);

  const slide = slides[index];
  const next = slides[index + 1];
  const scale = size.w && size.h ? Math.min((size.w - 32) / SLIDE_W, (size.h - 32) / SLIDE_H) : 0.5;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0"), ss = String(elapsed % 60).padStart(2, "0");
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={rootRef} className="sl-presenter fixed inset-0 z-[100] flex select-none text-white" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; go(1); }}>
      <div ref={stageRef} className="relative flex min-w-0 flex-1 items-center justify-center">
        {slide ? (
          <div style={{ width: SLIDE_W * scale, height: SLIDE_H * scale, overflow: "hidden", boxShadow: "0 30px 80px rgb(0 0 0 / 0.6)" }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: SLIDE_W, height: SLIDE_H }}><SlideView slide={slide} theme={deck.theme} /></div>
          </div>
        ) : <div className="text-sm text-white/60">No visible slides</div>}
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs opacity-0 transition-opacity hover:opacity-100 backdrop-blur">
          <button className="rounded-full p-1 hover:bg-white/15 cursor-pointer" onClick={() => go(-1)} aria-label="Previous"><ChevronLeft className="size-4" /></button>
          <span className="tabular px-1">{index + 1} / {slides.length}</span>
          <button className="rounded-full p-1 hover:bg-white/15 cursor-pointer" onClick={() => go(1)} aria-label="Next"><ChevronRight className="size-4" /></button>
          <button className="rounded-full p-1 hover:bg-white/15 cursor-pointer" onClick={() => setNotesOpen((v) => !v)} aria-label="Toggle notes"><StickyNote className="size-4" /></button>
          <button className="rounded-full p-1 hover:bg-white/15 cursor-pointer" onClick={() => onExit(index)} aria-label="Exit"><X className="size-4" /></button>
        </div>
      </div>
      {notesOpen && (
        <aside className={cn("flex w-[360px] shrink-0 flex-col border-l border-white/10 bg-[#111] p-4")} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wider text-white/50">Slide {index + 1} of {slides.length}</div>
            <div className="flex items-center gap-1 font-mono text-lg tabular">
              {mm}:{ss}
              <button className="rounded p-1 text-white/60 hover:text-white cursor-pointer" onClick={() => setRunning((v) => !v)} aria-label="Pause timer">{running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
              <button className="rounded p-1 text-white/60 hover:text-white cursor-pointer" onClick={() => setElapsed(0)} aria-label="Reset timer"><RotateCcw className="size-3.5" /></button>
            </div>
          </div>
          <div className="mt-1 truncate text-sm font-semibold">{slide ? slideTitle(slide) || "(untitled)" : ""}</div>
          <div className="mt-3 text-[11px] font-medium uppercase tracking-wider text-white/50">Notes</div>
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[15px] leading-relaxed text-white/90 scrollbar-thin">{slide?.notes.trim() || <span className="text-white/40">No speaker notes for this slide.</span>}</div>
          <div className="mt-3 text-[11px] font-medium uppercase tracking-wider text-white/50">Next</div>
          <div className="mt-1 overflow-hidden rounded border border-white/10 bg-black">{next ? <ScaledSlide slide={next} theme={deck.theme} width={328} lite /> : <div className="p-4 text-xs text-white/40">End of deck</div>}</div>
          <div className="mt-1 truncate text-xs text-white/60">{next ? slideTitle(next) : ""}</div>
          <div className="mt-3 text-[10px] text-white/40">← → Space navigate · N notes · T timer · Esc exit</div>
        </aside>
      )}
    </div>,
    document.body,
  );
}
