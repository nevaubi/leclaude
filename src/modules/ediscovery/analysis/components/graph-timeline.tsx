"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import type { GraphEdge } from "../types";
import type { timelineRows } from "../graph-view";

type Row = ReturnType<typeof timelineRows>[number];

const DAY = 86_400_000;
const LABEL_W = 176;
const ROW_H = 20;
const AXIS_H = 18;

function toT(d: string) { return new Date(d + (d.length === 10 ? "T00:00:00Z" : "")).getTime(); }

export interface GraphTimelineProps {
  rows: Row[];
  selectedEdgeId: string | null;
  onSelectEdge: (id: string | null) => void;
  /** Active date filter, shown as the visible range when set. */
  from?: string;
  to?: string;
  /** Edges of the neighborhood without dated evidence (shown as a count). */
  undated: number;
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

/**
 * When the relationships in view were active: one row per dated edge with a
 * bar from the first to the last piece of evidence and a dot per dated item.
 */
export function GraphTimeline({ rows, selectedEdgeId, onSelectEdge, from, to, undated, className, svgRef }: GraphTimelineProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(800);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setWidth(Math.max(320, e.contentRect.width)); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const domain = React.useMemo(() => {
    const ts = rows.flatMap((r) => [toT(r.first), toT(r.last)]);
    let t0 = from ? toT(from) : ts.length ? Math.min(...ts) : toT("2000-01-01");
    let t1 = to ? toT(to) : ts.length ? Math.max(...ts) : toT("2026-01-01");
    if (t1 - t0 < DAY * 400) { const mid = (t0 + t1) / 2; t0 = mid - DAY * 200; t1 = mid + DAY * 200; }
    const pad = (t1 - t0) * 0.06;
    return { t0: t0 - pad, t1: t1 + pad };
  }, [rows, from, to]);
  const plotW = width - LABEL_W - 12;
  const x = (t: number) => LABEL_W + ((t - domain.t0) / (domain.t1 - domain.t0)) * plotW;
  const ticks = React.useMemo(() => {
    const spanYears = (domain.t1 - domain.t0) / (DAY * 365);
    const step = spanYears > 30 ? 5 : spanYears > 12 ? 2 : 1;
    const out: { t: number; label: string }[] = [];
    const y0 = new Date(domain.t0).getUTCFullYear(), y1 = new Date(domain.t1).getUTCFullYear();
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) out.push({ t: Date.UTC(y, 0, 1), label: String(y) });
    return out;
  }, [domain.t0, domain.t1]);
  const height = AXIS_H + Math.max(1, rows.length) * ROW_H + 6;

  return (
    <div ref={ref} className={cn("relative select-none border-t bg-background", className)}>
      <div className="flex h-7 items-center gap-3 px-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">When these relationships were active</span>
        <span className="tabular">{rows.length} dated{undated ? ` · ${undated} undated` : ""}</span>
        {(from || to) && <span className="tabular">{from ?? "…"} – {to ?? "…"}</span>}
      </div>
      {!rows.length ? (
        <div className="px-3 pb-2 text-[11.5px] text-muted-foreground">No dated evidence in view. Documents give their date; testimony gives the deposition date.</div>
      ) : (
        <svg ref={svgRef} width={width} height={height} className="block" role="img" aria-label="Relationship timeline">
          {ticks.map((t) => { const px = x(t.t); if (px < LABEL_W || px > width) return null; return <g key={t.t}><line x1={px} x2={px} y1={AXIS_H - 4} y2={height} style={{ stroke: "var(--border)" }} /><text x={px + 3} y={AXIS_H - 7} style={{ fontSize: "10px", fill: "var(--muted-foreground)" }} className="tabular">{t.label}</text></g>; })}
          {rows.map((r, i) => {
            const y = AXIS_H + i * ROW_H;
            const sel = r.edge.id === selectedEdgeId;
            const x0 = x(toT(r.first)), x1 = Math.max(x(toT(r.last)), x0 + 3);
            return (
              <g key={r.edge.id} className="cursor-pointer" onClick={() => onSelectEdge(sel ? null : r.edge.id)}>
                <rect x={0} y={y} width={width} height={ROW_H} style={{ fill: sel ? "var(--accent)" : "transparent" }} />
                <text x={8} y={y + ROW_H / 2 + 3.5} style={{ fontSize: "11px", fill: sel ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: sel ? 600 : 400 }}>{r.label.length > 30 ? `${r.label.slice(0, 29)}…` : r.label}</text>
                <rect x={x0} y={y + 6} width={x1 - x0} height={ROW_H - 12} rx={2} style={{ fill: sel ? "var(--primary)" : "var(--muted-foreground)", opacity: sel ? 0.45 : 0.25 }} />
                {r.dates.map((d) => <circle key={d} cx={x(toT(d))} cy={y + ROW_H / 2} r={2.5} style={{ fill: sel ? "var(--primary)" : "var(--foreground)" }}><title>{d}</title></circle>)}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export type { GraphEdge };
