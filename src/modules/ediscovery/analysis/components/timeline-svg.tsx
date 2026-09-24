"use client";
import * as React from "react";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { TimelineEvent } from "@/lib/types/domain";
import { TIMELINE_CATEGORIES, type TimelineCategory } from "../types";
import { formatEventDate, sourceLabel } from "../chronology";
import { CategoryChip, tokenDot } from "./shared";

const FILL: Record<string, string> = { "chart-1": "fill-chart-1", "chart-2": "fill-chart-2", "chart-3": "fill-chart-3", "chart-4": "fill-chart-4", "chart-5": "fill-chart-5", primary: "fill-primary", info: "fill-info", muted: "fill-muted-foreground" };
const DAY = 86_400_000;
const LANE_H = 34;
const AXIS_H = 26;
const PAD_L = 108;

function toT(d: string) { return new Date(d + (d.length === 10 ? "T00:00:00Z" : "")).getTime(); }

export interface TimelineSvgProps {
  events: TimelineEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  people: Map<string, string>;
  className?: string;
}

export function TimelineSvg({ events, selectedId, onSelect, people, className }: TimelineSvgProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(900);
  const [view, setView] = React.useState<{ t0: number; t1: number } | null>(null);
  const [hover, setHover] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const drag = React.useRef<{ x: number; t0: number; t1: number; moved: boolean } | null>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setWidth(Math.max(320, e.contentRect.width)); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const lanes = React.useMemo(() => TIMELINE_CATEGORIES.filter((c) => events.some((e) => e.category === c.id)), [events]);
  const laneIndex = React.useMemo(() => new Map(lanes.map((l, i) => [l.id, i])), [lanes]);
  const height = AXIS_H + Math.max(1, lanes.length) * LANE_H + 12;
  const domain = React.useMemo(() => {
    if (!events.length) return { t0: toT("2000-01-01"), t1: toT("2027-01-01") };
    const ts = events.map((e) => toT(e.date));
    const min = Math.min(...ts), max = Math.max(...ts);
    const pad = Math.max(DAY * 120, (max - min) * 0.04);
    return { t0: min - pad, t1: max + pad };
  }, [events]);
  const v = view ?? domain;
  const plotW = width - PAD_L - 16;
  const x = (t: number) => PAD_L + ((t - v.t0) / (v.t1 - v.t0)) * plotW;
  const tAt = (px: number) => v.t0 + ((px - PAD_L) / plotW) * (v.t1 - v.t0);

  // Fit when the event set changes.
  React.useEffect(() => { setView(null); }, [domain.t0, domain.t1]);

  const zoom = (factor: number, centerPx?: number) => {
    const c = centerPx != null ? tAt(centerPx) : (v.t0 + v.t1) / 2;
    const span = (v.t1 - v.t0) * factor;
    if (span < DAY * 20 || span > DAY * 365 * 80) return;
    const ratio = (c - v.t0) / (v.t1 - v.t0);
    setView({ t0: c - span * ratio, t1: c + span * (1 - ratio) });
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const dt = ((e.deltaX || e.deltaY) / plotW) * (v.t1 - v.t0); setView({ t0: v.t0 + dt, t1: v.t1 + dt }); return; }
    zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, e.clientX - rect.left);
  };
  const wheelRef = React.useRef(onWheel);
  wheelRef.current = onWheel;
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);
  const onPointerDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, t0: v.t0, t1: v.t1, moved: false }; (e.currentTarget as Element).setPointerCapture(e.pointerId); };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 3) drag.current.moved = true;
    const dt = (dx / plotW) * (drag.current.t1 - drag.current.t0);
    setView({ t0: drag.current.t0 - dt, t1: drag.current.t1 - dt });
  };
  const onPointerUp = () => { if (drag.current && !drag.current.moved) onSelect(null); drag.current = null; };

  // Ticks: years, or months when zoomed in.
  const ticks = React.useMemo(() => {
    const spanDays = (v.t1 - v.t0) / DAY;
    const out: { t: number; label: string; major: boolean }[] = [];
    const start = new Date(v.t0), end = new Date(v.t1);
    if (spanDays > 365 * 6) {
      const step = spanDays > 365 * 30 ? 5 : spanDays > 365 * 14 ? 2 : 1;
      for (let y = Math.floor(start.getUTCFullYear() / step) * step; y <= end.getUTCFullYear(); y += step) out.push({ t: Date.UTC(y, 0, 1), label: String(y), major: true });
    } else if (spanDays > 200) {
      const step = spanDays > 365 * 2.5 ? 6 : spanDays > 365 ? 3 : 1;
      for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) for (let m = 0; m < 12; m += step) { const t = Date.UTC(y, m, 1); if (t >= v.t0 - DAY * 31 && t <= v.t1) out.push({ t, label: m === 0 ? String(y) : new Date(t).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), major: m === 0 }); }
    } else {
      const step = spanDays > 60 ? 7 : 1;
      for (let t = Math.floor(v.t0 / DAY) * DAY; t <= v.t1; t += DAY * step) { const d = new Date(t); if (step === 7 && d.getUTCDay() !== 1) continue; out.push({ t, label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), major: d.getUTCDate() === 1 }); }
    }
    return out;
  }, [v.t0, v.t1]);

  // Stagger dots that would overlap within a lane.
  const placed = React.useMemo(() => {
    const byLane = new Map<number, { e: TimelineEvent; px: number; r: number; dy: number }[]>();
    const sorted = [...events].sort((a, b) => toT(a.date) - toT(b.date));
    for (const e of sorted) {
      const lane = laneIndex.get(e.category) ?? 0;
      const px = x(toT(e.date));
      const r = 3 + e.significance * 1.6;
      const arr = byLane.get(lane) ?? [];
      let dy = 0;
      for (const p of arr) if (Math.abs(p.px - px) < p.r + r + 1 && p.dy === dy) dy = dy === 0 ? -9 : dy < 0 ? 9 : dy - 18 <= -14 ? 0 : dy;
      arr.push({ e, px, r, dy });
      byLane.set(lane, arr);
    }
    return Array.from(byLane.entries()).flatMap(([lane, arr]) => arr.map((p) => ({ ...p, cy: AXIS_H + lane * LANE_H + LANE_H / 2 + p.dy })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, laneIndex, v.t0, v.t1, width]);

  const hovered = hover ? events.find((e) => e.id === hover.id) : null;
  const visible = placed.filter((p) => p.px >= PAD_L - 10 && p.px <= width);

  return (
    <div ref={ref} className={cn("relative select-none overflow-hidden rounded-lg border bg-card", className)}>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-xs">
        <Tip label="Zoom in"><Button size="icon-xs" variant="ghost" onClick={() => zoom(1 / 1.5)} aria-label="Zoom in"><ZoomIn className="size-3.5" /></Button></Tip>
        <Tip label="Zoom out"><Button size="icon-xs" variant="ghost" onClick={() => zoom(1.5)} aria-label="Zoom out"><ZoomOut className="size-3.5" /></Button></Tip>
        <Tip label="Fit all events"><Button size="icon-xs" variant="ghost" onClick={() => setView(null)} aria-label="Fit"><Maximize className="size-3.5" /></Button></Tip>
      </div>
      <svg width={width} height={height} className="block cursor-grab active:cursor-grabbing" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { drag.current = null; setHover(null); }} role="img" aria-label="Chronology timeline">
        {/* lanes */}
        {lanes.map((l, i) => (
          <g key={l.id}>
            <rect x={0} y={AXIS_H + i * LANE_H} width={width} height={LANE_H} className={cn(i % 2 === 0 ? "fill-muted/40" : "fill-transparent")} />
            <line x1={PAD_L} x2={width} y1={AXIS_H + i * LANE_H + LANE_H / 2} y2={AXIS_H + i * LANE_H + LANE_H / 2} className="stroke-border" strokeDasharray="2 4" />
            <text x={8} y={AXIS_H + i * LANE_H + LANE_H / 2 + 4} className="fill-muted-foreground text-[10.5px] font-medium">{l.label}</text>
            <circle cx={PAD_L - 12} cy={AXIS_H + i * LANE_H + LANE_H / 2} r={3} className={FILL[l.color] ?? FILL.muted} />
          </g>
        ))}
        {/* axis */}
        <line x1={PAD_L} x2={width} y1={AXIS_H - 1} y2={AXIS_H - 1} className="stroke-border" />
        {ticks.map((t) => { const px = x(t.t); if (px < PAD_L || px > width) return null; return (
          <g key={t.t}>
            <line x1={px} x2={px} y1={AXIS_H - (t.major ? 8 : 4)} y2={height} className={cn(t.major ? "stroke-border" : "stroke-border/60")} />
            <text x={px + 3} y={AXIS_H - 10} className={cn("text-[10px] tabular", t.major ? "fill-foreground/80 font-medium" : "fill-muted-foreground")}>{t.label}</text>
          </g>
        ); })}
        {/* today */}
        {(() => { const px = x(Date.now()); return px >= PAD_L && px <= width ? <g><line x1={px} x2={px} y1={AXIS_H} y2={height} className="stroke-primary/50" strokeDasharray="3 3" /><text x={px + 3} y={height - 3} className="fill-primary text-[9px]">today</text></g> : null; })()}
        {/* dots */}
        {visible.map(({ e, px, r, cy }) => {
          const sel = e.id === selectedId;
          const col = TIMELINE_CATEGORIES.find((c) => c.id === e.category)?.color ?? "muted";
          return (
            <g key={e.id} transform={`translate(${px},${cy})`} className="cursor-pointer" onPointerEnter={(ev) => { const rect = ref.current!.getBoundingClientRect(); setHover({ id: e.id, x: ev.clientX - rect.left, y: cy }); }} onPointerLeave={() => setHover(null)} onClick={(ev) => { ev.stopPropagation(); onSelect(sel ? null : e.id); }}>
              {sel && <circle r={r + 5} className="fill-primary/15 stroke-primary" strokeWidth={1.5} />}
              <circle r={r} className={cn(FILL[col] ?? FILL.muted, e.disputed ? "stroke-destructive" : "stroke-background", "transition-[r]")} strokeWidth={e.disputed ? 2 : 1.5} opacity={e.verified === false ? 0.55 : 0.95} />
              {e.disputed && <text y={-r - 3} textAnchor="middle" className="fill-destructive text-[9px] font-bold">!</text>}
            </g>
          );
        })}
      </svg>
      {hovered && hover && (
        <div className="pointer-events-none absolute z-20 w-72 rounded-md border bg-popover p-2.5 text-popover-foreground shadow-lg animate-fade-in" style={{ left: Math.min(Math.max(8, hover.x - 140), width - 296), top: Math.min(hover.y + 14, height - 10) }}>
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", tokenDot(TIMELINE_CATEGORIES.find((c) => c.id === hovered.category)?.color ?? "muted"))} /><span className="tabular">{formatEventDate(hovered)}</span><span>·</span><span>sig. {hovered.significance}/5</span>{hovered.disputed && <span className="text-destructive">· disputed</span>}</div>
          <div className="mt-0.5 text-[12px] font-medium leading-snug">{hovered.title}</div>
          {hovered.description && <div className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">{hovered.description}</div>}
          {hovered.sources.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{hovered.sources.slice(0, 4).map((s, i) => <span key={i} className="rounded border bg-muted px-1 font-mono text-[10px]">{sourceLabel(s)}</span>)}{hovered.sources.length > 4 && <span className="text-[10px] text-muted-foreground">+{hovered.sources.length - 4}</span>}</div>}
          {hovered.personIds?.length ? <div className="mt-1 text-[10.5px] text-muted-foreground">{hovered.personIds.map((p) => people.get(p) ?? p).join(", ")}</div> : null}
        </div>
      )}
      <div className="flex items-center gap-3 border-t px-3 py-1 text-[10.5px] text-muted-foreground">
        <span>{visible.length} of {events.length} in view</span>
        <span className="hidden sm:inline">scroll to zoom · drag to pan · shift+scroll to slide</span>
        <span className="flex-1" />
        <span className="hidden items-center gap-2 md:flex">{[1, 3, 5].map((s) => <span key={s} className="inline-flex items-center gap-1"><span className="rounded-full bg-muted-foreground/60" style={{ width: 6 + s * 3.2, height: 6 + s * 3.2 }} />{s}</span>)} significance</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full border-2 border-destructive" /> disputed</span>
      </div>
    </div>
  );
}

export function CategoryLegend({ active, onToggle }: { active: Set<TimelineCategory>; onToggle: (c: TimelineCategory) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TIMELINE_CATEGORIES.map((c) => <button key={c.id} type="button" onClick={() => onToggle(c.id)} className={cn("transition-opacity cursor-pointer", active.size && !active.has(c.id) && "opacity-40")}><CategoryChip category={c.id} /></button>)}
    </div>
  );
}
