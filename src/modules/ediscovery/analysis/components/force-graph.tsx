"use client";
import * as React from "react";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, type Simulation, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force";
import { ZoomIn, ZoomOut, Maximize, LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { Relationship } from "@/lib/types/domain";
import type { GraphData, GraphEdge, GraphNode } from "../types";
import { RELATIONSHIP_LABELS } from "../graph";

interface SimNode extends SimulationNodeDatum, GraphNode { r: number }
interface SimLink extends SimulationLinkDatum<SimNode> { edge: GraphEdge }

const FILL: Record<string, string> = { "chart-1": "fill-chart-1", "chart-2": "fill-chart-2", "chart-3": "fill-chart-3", "chart-4": "fill-chart-4", "chart-5": "fill-chart-5", primary: "fill-primary", info: "fill-info", muted: "fill-muted-foreground" };
const STROKE: Record<string, string> = { "chart-1": "stroke-chart-1", "chart-2": "stroke-chart-2", "chart-3": "stroke-chart-3", "chart-4": "stroke-chart-4", "chart-5": "stroke-chart-5", primary: "stroke-primary", info: "stroke-info", muted: "stroke-muted-foreground" };
const EDGE_STROKE: Partial<Record<Relationship["kind"], string>> = { reports_to: "stroke-primary", supervises: "stroke-primary", retained: "stroke-chart-2", represents: "stroke-chart-4", testified_about: "stroke-chart-5", meeting: "stroke-chart-3", emailed: "stroke-muted-foreground", cc: "stroke-muted-foreground", same_org: "stroke-border", authored: "stroke-chart-1", received: "stroke-chart-1", other: "stroke-muted-foreground" };
const EDGE_DASH: Partial<Record<Relationship["kind"], string>> = { cc: "2 3", testified_about: "5 3", meeting: "1 3", other: "3 3" };

export function radiusFor(n: GraphNode) { return Math.min(26, 7 + Math.sqrt(n.docCount + n.depositions * 6) * 2.4); }

export interface ForceGraphProps {
  data: GraphData;
  kinds: Set<Relationship["kind"]>;
  selectedId: string | null;
  highlightIds: Set<string>;
  onSelect: (id: string | null) => void;
  className?: string;
}

export function ForceGraph({ data, kinds, selectedId, highlightIds, onSelect, className }: ForceGraphProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 900, h: 560 });
  const [tick, setTick] = React.useState(0);
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
    const ro = new ResizeObserver((es) => { for (const e of es) setSize({ w: Math.max(320, e.contentRect.width), h: Math.max(320, e.contentRect.height) }); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const clusterCenter = React.useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    const n = data.clusters.length || 1;
    const R = Math.min(size.w, size.h) * (n > 1 ? 0.32 : 0);
    data.clusters.forEach((c, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; m.set(c.id, { x: size.w / 2 + Math.cos(a) * R * (i === 0 && n > 3 ? 0.35 : 1), y: size.h / 2 + Math.sin(a) * R * (i === 0 && n > 3 ? 0.35 : 1) }); });
    return m;
  }, [data.clusters, size.w, size.h]);

  // Build / rebuild the simulation when the data changes.
  React.useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: SimNode[] = data.nodes.map((n) => { const p = prev.get(n.id); const c = clusterCenter.get(n.cluster) ?? { x: size.w / 2, y: size.h / 2 }; return { ...n, r: radiusFor(n), x: p?.x ?? c.x + (Math.random() - 0.5) * 80, y: p?.y ?? c.y + (Math.random() - 0.5) * 80, vx: 0, vy: 0 }; });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = data.edges.filter((e) => kinds.has(e.kind) && byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, edge: e }));
    nodesRef.current = nodes;
    linksRef.current = links;
    simRef.current?.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => 60 + 40 / Math.sqrt(l.edge.weight)).strength((l) => Math.min(0.9, 0.15 + Math.log1p(l.edge.weight) * 0.12)))
      .force("charge", forceManyBody<SimNode>().strength((d) => -120 - d.r * 10))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 6).strength(0.9))
      .force("x", forceX<SimNode>((d) => clusterCenter.get(d.cluster)?.x ?? size.w / 2).strength(0.07))
      .force("y", forceY<SimNode>((d) => clusterCenter.get(d.cluster)?.y ?? size.h / 2).strength(0.07))
      .alpha(1).alphaDecay(0.035)
      .on("tick", () => { if (raf.current == null) raf.current = requestAnimationFrame(() => { raf.current = null; setTick((t) => t + 1); }); });
    simRef.current = sim;
    return () => { sim.stop(); if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, kinds, clusterCenter]);

  const toLocal = (clientX: number, clientY: number) => { const rect = ref.current!.getBoundingClientRect(); return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const k = Math.min(4, Math.max(0.3, view.k * (e.deltaY > 0 ? 0.9 : 1.1)));
    setView({ k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k });
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
  const zoomBy = (f: number) => { const k = Math.min(4, Math.max(0.3, view.k * f)); const cx = size.w / 2, cy = size.h / 2; setView({ k, x: cx - ((cx - view.x) / view.k) * k, y: cy - ((cy - view.y) / view.k) * k }); };
  const fit = () => {
    const ns = nodesRef.current; if (!ns.length) return;
    const xs = ns.map((n) => n.x ?? 0), ys = ns.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40, minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
    const k = Math.min(4, Math.max(0.3, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))));
    setView({ k, x: (size.w - (minX + maxX) * k) / 2, y: (size.h - (minY + maxY) * k) / 2 });
  };
  const center = () => { if (!selectedId) return fit(); const n = nodesRef.current.find((x) => x.id === selectedId); if (!n) return; setView((v) => ({ ...v, x: size.w / 2 - (n.x ?? 0) * v.k, y: size.h / 2 - (n.y ?? 0) * v.k })); };

  const onPointerDown = (e: React.PointerEvent, node?: SimNode) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { node: node ?? null, startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (node) { node.fx = node.x; node.fy = node.y; simRef.current?.alphaTarget(0.25).restart(); }
    e.stopPropagation();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (d.node) { const p = toLocal(e.clientX, e.clientY); d.node.fx = p.x; d.node.fy = p.y; }
    else setView((v) => ({ ...v, x: d.vx + (e.clientX - d.startX), y: d.vy + (e.clientY - d.startY) }));
  };
  const onPointerUp = () => {
    const d = dragRef.current; if (!d) return;
    if (d.node) { if (!d.moved) onSelect(selectedId === d.node.id ? null : d.node.id); d.node.fx = null; d.node.fy = null; simRef.current?.alphaTarget(0); }
    else if (!d.moved) onSelect(null);
    dragRef.current = null;
  };

  const neighbors = React.useMemo(() => { const m = new Map<string, Set<string>>(); for (const e of data.edges) { if (!kinds.has(e.kind)) continue; if (!m.has(e.source)) m.set(e.source, new Set()); if (!m.has(e.target)) m.set(e.target, new Set()); m.get(e.source)!.add(e.target); m.get(e.target)!.add(e.source); } return m; }, [data.edges, kinds]);
  const focus = hover ?? selectedId;
  const dim = (id: string) => (focus ? !(id === focus || neighbors.get(focus)?.has(id)) : highlightIds.size ? !highlightIds.has(id) : false);
  const nodes = nodesRef.current;
  const links = linksRef.current;
  void tick;

  return (
    <div ref={ref} className={cn("relative h-full min-h-[320px] select-none overflow-hidden rounded-lg border bg-card", className)}>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-xs">
        <Tip label="Zoom in"><Button size="icon-xs" variant="ghost" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><ZoomIn className="size-3.5" /></Button></Tip>
        <Tip label="Zoom out"><Button size="icon-xs" variant="ghost" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><ZoomOut className="size-3.5" /></Button></Tip>
        <Tip label="Fit"><Button size="icon-xs" variant="ghost" onClick={fit} aria-label="Fit"><Maximize className="size-3.5" /></Button></Tip>
        <Tip label="Center on selection"><Button size="icon-xs" variant="ghost" onClick={center} aria-label="Center"><LocateFixed className="size-3.5" /></Button></Tip>
      </div>
      <svg width={size.w} height={size.h} className="block cursor-grab active:cursor-grabbing" onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} role="img" aria-label="People graph">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {links.map((l, i) => {
            const s = l.source as SimNode, t = l.target as SimNode;
            const dimmed = focus ? !(s.id === focus || t.id === focus) : highlightIds.size ? !(highlightIds.has(s.id) && highlightIds.has(t.id)) : false;
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} strokeWidth={Math.min(6, 0.8 + Math.log1p(l.edge.weight) * 1.1) / view.k} strokeDasharray={EDGE_DASH[l.edge.kind]} className={cn(EDGE_STROKE[l.edge.kind] ?? "stroke-muted-foreground", "transition-opacity")} opacity={dimmed ? 0.08 : hoverEdge === l ? 0.95 : 0.45} onPointerEnter={() => setHoverEdge(l)} onPointerLeave={() => setHoverEdge(null)} />;
          })}
          {nodes.map((n) => {
            const sel = n.id === selectedId;
            const d = dim(n.id);
            const showLabel = n.r >= 11 || sel || hover === n.id || highlightIds.has(n.id) || (focus != null && neighbors.get(focus)?.has(n.id)) || view.k > 1.6;
            return (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`} className="cursor-pointer" opacity={d ? 0.18 : 1} onPointerDown={(e) => onPointerDown(e, n)} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                {sel && <circle r={n.r + 6} className="fill-primary/15 stroke-primary" strokeWidth={1.5 / view.k} />}
                {highlightIds.has(n.id) && !sel && <circle r={n.r + 4} className="fill-warning/20 stroke-warning" strokeWidth={1.5 / view.k} />}
                <circle r={n.r} className={cn(FILL[n.color] ?? FILL.muted, "stroke-background")} strokeWidth={2 / view.k} opacity={0.92} />
                {n.depositions > 0 && <circle r={n.r} className={cn("fill-transparent", STROKE[n.color] ?? STROKE.muted)} strokeWidth={2.5 / view.k} strokeDasharray={`${(2 * Math.PI * n.r) / 8} ${(2 * Math.PI * n.r) / 16}`} opacity={0.9} />}
                <text textAnchor="middle" dy="0.35em" className="pointer-events-none fill-background text-[10px] font-semibold" style={{ fontSize: Math.max(8, Math.min(12, n.r * 0.85)) }}>{n.label.split(" ").filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("")}</text>
                {showLabel && <text y={n.r + 11} textAnchor="middle" className={cn("pointer-events-none text-[10.5px]", sel ? "fill-foreground font-semibold" : "fill-foreground/80")} style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}>{n.label}</text>}
              </g>
            );
          })}
        </g>
      </svg>
      {hoverEdge && (
        <div className="pointer-events-none absolute bottom-10 left-3 z-20 max-w-sm rounded-md border bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-lg">
          <span className="font-medium">{(hoverEdge.source as SimNode).label}</span> <span className="text-muted-foreground">{RELATIONSHIP_LABELS[hoverEdge.edge.kind]}</span> <span className="font-medium">{(hoverEdge.target as SimNode).label}</span>
          {hoverEdge.edge.label && <span className="text-muted-foreground"> — {hoverEdge.edge.label}</span>}
          <span className="ml-1 rounded bg-muted px-1 tabular">×{hoverEdge.edge.weight}</span>
          {hoverEdge.edge.evidence.length > 0 && <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{hoverEdge.edge.evidence.map((e) => e.bates).filter(Boolean).slice(0, 5).join(" · ")}</div>}
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-background/85 px-3 py-1 text-[10.5px] text-muted-foreground backdrop-blur">
        <span>{nodes.length} people · {links.length} relationships</span>
        <span className="hidden sm:inline">drag nodes · scroll to zoom · click to inspect</span>
        <span className="flex-1" />
        {data.clusters.slice(0, 6).map((c) => <span key={c.id} className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", { "chart-1": "bg-chart-1", "chart-2": "bg-chart-2", "chart-3": "bg-chart-3", "chart-4": "bg-chart-4", "chart-5": "bg-chart-5", primary: "bg-primary", info: "bg-info" }[c.color] ?? "bg-muted-foreground")} />{c.label} <span className="tabular">{c.size}</span></span>)}
      </div>
    </div>
  );
}
