"use client";
import * as React from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { LocateFixed, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { ENTITY_TYPE_LABEL, RELATION_LABEL } from "../analysis/pure";
import type { GraphExport, GraphLinkExport, GraphNodeExport } from "../analysis/types";
import { GRAPH_EDGE_DASH, GRAPH_TYPE_DOT, GRAPH_TYPE_FILL, graphRadius } from "./models";

interface SimNode extends SimulationNodeDatum, GraphNodeExport { r: number }
interface SimLink extends SimulationLinkDatum<SimNode> { link: GraphLinkExport }

/**
 * d3-force graph of intelligence entities (the e-discovery people-graph
 * pattern): drag nodes, scroll to zoom, click to select; node colour follows
 * the entity type in a fixed order, edge width follows the number of
 * supporting records, and the label shows the initials until zoomed in.
 */
export function IntelForceGraph({ data, selectedId, onSelect, className }: { data: GraphExport; selectedId: string | null; onSelect: (id: string | null) => void; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 900, h: 520 });
  const [, setTick] = React.useState(0);
  const [view, setView] = React.useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = React.useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = React.useState<SimLink | null>(null);
  const simRef = React.useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = React.useRef<SimNode[]>([]);
  const linksRef = React.useRef<SimLink[]>([]);
  const dragRef = React.useRef<{ node: SimNode | null; startX: number; startY: number; vx: number; vy: number; moved: boolean } | null>(null);
  const raf = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setSize({ w: Math.max(320, e.contentRect.width), h: Math.max(280, e.contentRect.height) }); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: SimNode[] = data.nodes.map((n) => { const p = prev.get(n.id); return { ...n, r: graphRadius(n), x: p?.x ?? size.w / 2 + (Math.random() - 0.5) * 200, y: p?.y ?? size.h / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0 }; });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = data.links.filter((l) => byId.has(l.source) && byId.has(l.target)).map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)!, link: l }));
    nodesRef.current = nodes;
    linksRef.current = links;
    simRef.current?.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => 56 + 36 / Math.sqrt(l.link.weight)).strength((l) => Math.min(0.9, 0.2 + Math.log1p(l.link.weight) * 0.12)))
      .force("charge", forceManyBody<SimNode>().strength((d) => -110 - d.r * 9))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 5).strength(0.9))
      .force("center", forceCenter(size.w / 2, size.h / 2).strength(0.06))
      .alpha(1).alphaDecay(0.04)
      .on("tick", () => { if (raf.current == null) raf.current = requestAnimationFrame(() => { raf.current = null; setTick((t) => t + 1); }); });
    simRef.current = sim;
    return () => { sim.stop(); if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toLocal = (clientX: number, clientY: number) => { const rect = ref.current!.getBoundingClientRect(); return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }; };
  const wheelRef = React.useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const k = Math.min(4, Math.max(0.3, view.k * (e.deltaY > 0 ? 0.9 : 1.1)));
    setView({ k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k });
  };
  React.useEffect(() => { const el = ref.current; if (!el) return; const h = (e: WheelEvent) => wheelRef.current(e); el.addEventListener("wheel", h, { passive: false }); return () => el.removeEventListener("wheel", h); }, []);
  const zoomBy = (f: number) => { const k = Math.min(4, Math.max(0.3, view.k * f)); const cx = size.w / 2, cy = size.h / 2; setView({ k, x: cx - ((cx - view.x) / view.k) * k, y: cy - ((cy - view.y) / view.k) * k }); };
  const fit = () => {
    const ns = nodesRef.current; if (!ns.length) return;
    const xs = ns.map((n) => n.x ?? 0), ys = ns.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40, minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
    const k = Math.min(3, Math.max(0.3, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))));
    setView({ k, x: (size.w - (minX + maxX) * k) / 2, y: (size.h - (minY + maxY) * k) / 2 });
  };
  const center = () => { if (!selectedId) return fit(); const n = nodesRef.current.find((x) => x.id === selectedId); if (!n) return; setView((v) => ({ ...v, x: size.w / 2 - (n.x ?? 0) * v.k, y: size.h / 2 - (n.y ?? 0) * v.k })); };
  const onPointerDown = (e: React.PointerEvent, node?: SimNode) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); dragRef.current = { node: node ?? null, startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y, moved: false }; if (node) { node.fx = node.x; node.fy = node.y; simRef.current?.alphaTarget(0.25).restart(); } e.stopPropagation(); };
  const onPointerMove = (e: React.PointerEvent) => { const d = dragRef.current; if (!d) return; if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true; if (d.node) { const p = toLocal(e.clientX, e.clientY); d.node.fx = p.x; d.node.fy = p.y; } else setView((v) => ({ ...v, x: d.vx + (e.clientX - d.startX), y: d.vy + (e.clientY - d.startY) })); };
  const onPointerUp = () => { const d = dragRef.current; if (!d) return; if (d.node) { if (!d.moved) onSelect(selectedId === d.node.id ? null : d.node.id); d.node.fx = null; d.node.fy = null; simRef.current?.alphaTarget(0); } else if (!d.moved) onSelect(null); dragRef.current = null; };

  const neighbors = React.useMemo(() => { const m = new Map<string, Set<string>>(); for (const l of data.links) { if (!m.has(l.source)) m.set(l.source, new Set()); if (!m.has(l.target)) m.set(l.target, new Set()); m.get(l.source)!.add(l.target); m.get(l.target)!.add(l.source); } return m; }, [data.links]);
  const focus = hover ?? selectedId;
  const dim = (id: string) => (focus ? !(id === focus || neighbors.get(focus)?.has(id)) : false);
  const nodes = nodesRef.current, links = linksRef.current;
  const initials = (label: string) => label.split(/\s+/).filter((w) => /^[A-Z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join("") || label.slice(0, 2).toUpperCase();
  const typesPresent = Array.from(new Set(data.nodes.map((n) => n.type)));

  return (
    <div ref={ref} className={cn("relative h-full min-h-[280px] select-none overflow-hidden rounded-md border bg-card", className)}>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5">
        <Tip label="Zoom in"><Button size="icon-xs" variant="ghost" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><ZoomIn className="size-3.5" /></Button></Tip>
        <Tip label="Zoom out"><Button size="icon-xs" variant="ghost" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><ZoomOut className="size-3.5" /></Button></Tip>
        <Tip label="Fit"><Button size="icon-xs" variant="ghost" onClick={fit} aria-label="Fit"><Maximize className="size-3.5" /></Button></Tip>
        <Tip label="Center on selection"><Button size="icon-xs" variant="ghost" onClick={center} aria-label="Center"><LocateFixed className="size-3.5" /></Button></Tip>
      </div>
      <svg width={size.w} height={size.h} className="block cursor-grab active:cursor-grabbing" onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} role="img" aria-label="Knowledge graph">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {links.map((l, i) => { const s = l.source as SimNode, t = l.target as SimNode; const dimmed = focus ? !(s.id === focus || t.id === focus) : false; return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} strokeWidth={Math.min(5, 0.8 + Math.log1p(l.link.weight) * 1.1) / view.k} strokeDasharray={GRAPH_EDGE_DASH[l.link.type]} className="stroke-muted-foreground transition-opacity" opacity={dimmed ? 0.08 : hoverEdge === l ? 0.95 : 0.4} onPointerEnter={() => setHoverEdge(l)} onPointerLeave={() => setHoverEdge(null)} />; })}
          {nodes.map((n) => {
            const sel = n.id === selectedId;
            const d = dim(n.id);
            const showLabel = n.r >= 12 || sel || hover === n.id || (focus != null && neighbors.get(focus)?.has(n.id)) || view.k > 1.5 || n.id === data.center;
            return (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`} className="cursor-pointer" opacity={d ? 0.18 : 1} onPointerDown={(e) => onPointerDown(e, n)} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                {sel && <circle r={n.r + 5} className="fill-primary/15 stroke-primary" strokeWidth={1.5 / view.k} />}
                {n.flagged && <circle r={n.r + 3} className="fill-transparent stroke-warning" strokeWidth={1.5 / view.k} strokeDasharray="3 2" />}
                <circle r={n.r} className={cn(GRAPH_TYPE_FILL[n.type], "stroke-background")} strokeWidth={2 / view.k} opacity={0.92} />
                <text textAnchor="middle" dy="0.35em" className="pointer-events-none fill-background font-semibold" style={{ fontSize: Math.max(8, Math.min(11, n.r * 0.8)) }}>{initials(n.label)}</text>
                {showLabel && <text y={n.r + 11} textAnchor="middle" className={cn("pointer-events-none", sel ? "fill-foreground font-semibold" : "fill-foreground/80")} style={{ fontSize: 10.5, paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}>{n.label.length > 34 ? `${n.label.slice(0, 32)}…` : n.label}</text>}
              </g>
            );
          })}
        </g>
      </svg>
      {hoverEdge && (
        <div className="pointer-events-none absolute bottom-9 left-3 z-20 max-w-sm rounded-md border bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md">
          <span className="font-medium">{(hoverEdge.source as SimNode).label}</span> <span className="text-muted-foreground">{RELATION_LABEL[hoverEdge.link.type]}</span> <span className="font-medium">{(hoverEdge.target as SimNode).label}</span>
          <span className="ml-1 tabular text-muted-foreground">· {hoverEdge.link.weight} record{hoverEdge.link.weight === 1 ? "" : "s"} · {Math.round(hoverEdge.link.confidence * 100)}%</span>
          {hoverEdge.link.evidence[0]?.quote && <div className="mt-0.5 truncate text-muted-foreground">{hoverEdge.link.evidence[0].quote}</div>}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-background/90 px-3 py-1 text-[10.5px] text-muted-foreground">
        <span className="tabular">{nodes.length} entities · {links.length} relations{data.truncated ? " · truncated" : ""}</span>
        <span className="hidden sm:inline">drag · scroll to zoom · click to inspect</span>
        <span className="flex-1" />
        {typesPresent.map((t) => <span key={t} className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", GRAPH_TYPE_DOT[t])} aria-hidden />{ENTITY_TYPE_LABEL[t]}</span>)}
      </div>
    </div>
  );
}
