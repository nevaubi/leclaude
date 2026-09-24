"use client";
import * as React from "react";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, type Simulation, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { Relationship } from "@/lib/types/domain";
import type { GraphEdge, GraphNode } from "../types";
import { curvedPath, edgeLanes, kindLabel, neighborsOf, nodeRadius } from "../graph-view";

interface SimNode extends SimulationNodeDatum, GraphNode { r: number }
interface SimLink extends SimulationLinkDatum<SimNode> { edge: GraphEdge }

const DIRECTED = new Set<Relationship["kind"]>(["reports_to", "supervises", "emailed", "cc", "retained", "represents", "testified_about", "authored", "received"]);

export interface FocusGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Hop distance from the center (0 = center). */
  depth: Map<string, number>;
  centerId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  /** Make a node the new center (Enter / double-click). */
  onCenter: (id: string) => void;
  onEscape?: () => void;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  className?: string;
  /** One-line caption under the canvas (counts, hints). */
  caption?: React.ReactNode;
}

/**
 * Focused people graph: the selected person (or an organization's members) and
 * the neighborhood around them. Ink and gray only; the center is the single
 * accent. Curved edges carry their relationship kind, node size follows the
 * evidence count, and the keyboard walks the neighbors (arrows), recenters
 * (Enter) and picks the connecting edge (E).
 */
export function FocusGraph(p: FocusGraphProps) {
  const { nodes, edges, depth, centerId, selectedEdgeId, onSelectNode, onSelectEdge, onCenter } = p;
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const localSvg = React.useRef<SVGSVGElement | null>(null);
  const svgRef = p.svgRef ?? localSvg;
  const [size, setSize] = React.useState({ w: 800, h: 480 });
  const [tick, setTick] = React.useState(0);
  const [view, setView] = React.useState({ k: 1, x: 0, y: 0 });
  const [hoverNode, setHoverNode] = React.useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = React.useState<string | null>(null);
  const [kbIdx, setKbIdx] = React.useState(-1);
  const simRef = React.useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = React.useRef<SimNode[]>([]);
  const linksRef = React.useRef<SimLink[]>([]);
  const dragRef = React.useRef<{ node: SimNode | null; startX: number; startY: number; vx: number; vy: number; moved: boolean } | null>(null);
  const raf = React.useRef<number | null>(null);
  const fitted = React.useRef(false);

  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setSize({ w: Math.max(240, e.contentRect.width), h: Math.max(240, e.contentRect.height) }); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const lanes = React.useMemo(() => edgeLanes(edges), [edges]);
  const neighbors = React.useMemo(() => (centerId ? neighborsOf(centerId, edges) : []), [centerId, edges]);
  React.useEffect(() => { setKbIdx(-1); }, [centerId, edges]);

  const fit = React.useCallback(() => {
    const ns = nodesRef.current; if (!ns.length) return;
    const xs = ns.map((n) => n.x ?? 0), ys = ns.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60, minY = Math.min(...ys) - 44, maxY = Math.max(...ys) + 44;
    const k = Math.min(1.6, Math.max(0.35, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))));
    setView({ k, x: (size.w - (minX + maxX) * k) / 2, y: (size.h - (minY + maxY) * k) / 2 });
  }, [size.w, size.h]);

  // Rebuild the simulation when the neighborhood changes. Positions are kept for nodes that stay.
  React.useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const cx = size.w / 2, cy = size.h / 2;
    const sim: SimNode[] = nodes.map((n, i) => {
      const old = prev.get(n.id);
      const d = depth.get(n.id) ?? 1;
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const ring = d === 0 ? 0 : d === 1 ? 140 : 240;
      return { ...n, r: nodeRadius(n), x: old?.x ?? cx + Math.cos(a) * ring, y: old?.y ?? cy + Math.sin(a) * ring, vx: 0, vy: 0, fx: d === 0 ? cx : undefined, fy: d === 0 ? cy : undefined };
    });
    const byId = new Map(sim.map((n) => [n.id, n]));
    const links: SimLink[] = edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, edge: e }));
    nodesRef.current = sim; linksRef.current = links; fitted.current = false;
    simRef.current?.stop();
    const s = forceSimulation<SimNode, SimLink>(sim)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => { const a = depth.get((l.source as SimNode).id) ?? 1, b = depth.get((l.target as SimNode).id) ?? 1; return (a === 0 || b === 0 ? 130 : 95) + 24 / Math.sqrt(l.edge.weight); }).strength((l) => Math.min(0.8, 0.2 + Math.log1p(l.edge.weight) * 0.12)))
      .force("charge", forceManyBody<SimNode>().strength((d) => -220 - d.r * 8))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 16).strength(0.9))
      .force("x", forceX<SimNode>(cx).strength(0.05))
      .force("y", forceY<SimNode>(cy).strength(0.05))
      .alpha(1).alphaDecay(0.05)
      .on("tick", () => { if (raf.current == null) raf.current = requestAnimationFrame(() => { raf.current = null; setTick((t) => t + 1); }); })
      .on("end", () => { if (!fitted.current) { fitted.current = true; fit(); } });
    simRef.current = s;
    return () => { s.stop(); if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, depth]);

  const toLocal = (clientX: number, clientY: number) => { const rect = wrapRef.current!.getBoundingClientRect(); return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const k = Math.min(4, Math.max(0.3, view.k * (e.deltaY > 0 ? 0.9 : 1.1)));
    setView({ k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k });
  };
  const wheelRef = React.useRef(onWheel);
  wheelRef.current = onWheel;
  React.useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);
  const zoomBy = (f: number) => { const k = Math.min(4, Math.max(0.3, view.k * f)); const cx = size.w / 2, cy = size.h / 2; setView({ k, x: cx - ((cx - view.x) / view.k) * k, y: cy - ((cy - view.y) / view.k) * k }); };

  const onPointerDown = (e: React.PointerEvent, node?: SimNode) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { node: node ?? null, startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (node) { node.fx = node.x; node.fy = node.y; simRef.current?.alphaTarget(0.2).restart(); }
    e.stopPropagation();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (d.node) { const q = toLocal(e.clientX, e.clientY); d.node.fx = q.x; d.node.fy = q.y; }
    else setView((v) => ({ ...v, x: d.vx + (e.clientX - d.startX), y: d.vy + (e.clientY - d.startY) }));
  };
  const onPointerUp = () => {
    const d = dragRef.current; if (!d) return;
    if (d.node) { if (!d.moved) onSelectNode(d.node.id); if ((depth.get(d.node.id) ?? 1) !== 0) { d.node.fx = null; d.node.fy = null; } simRef.current?.alphaTarget(0); }
    else if (!d.moved) onSelectEdge(null);
    dragRef.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!neighbors.length && e.key !== "Escape") return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setKbIdx((i) => (i + 1) % neighbors.length); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setKbIdx((i) => (i <= 0 ? neighbors.length - 1 : i - 1)); }
    else if (e.key === "Enter" && kbIdx >= 0) { e.preventDefault(); onCenter(neighbors[kbIdx].id); }
    else if ((e.key === "e" || e.key === " ") && kbIdx >= 0) { e.preventDefault(); onSelectEdge(neighbors[kbIdx].edgeIds[0] ?? null); }
    else if (e.key === "Escape") { e.preventDefault(); if (selectedEdgeId) onSelectEdge(null); else p.onEscape?.(); }
  };

  const simNodes = nodesRef.current;
  const links = linksRef.current;
  const kbId = kbIdx >= 0 ? neighbors[kbIdx]?.id ?? null : null;
  const focusEdge = selectedEdgeId ?? hoverEdge;
  const showAllLabels = links.length <= 28 || view.k >= 1.1;
  void tick;

  return (
    <div ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} className={cn("relative h-full min-h-[240px] select-none overflow-hidden bg-background outline-none focus-visible:ring-1 focus-visible:ring-ring", p.className)} aria-label="People graph" role="application">
      <div className="absolute right-2 top-2 z-10 flex items-center rounded-md border bg-background">
        <Tip label="Zoom in"><Button size="icon-xs" variant="ghost" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><ZoomIn className="size-3.5" /></Button></Tip>
        <Tip label="Zoom out"><Button size="icon-xs" variant="ghost" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><ZoomOut className="size-3.5" /></Button></Tip>
        <Tip label="Fit"><Button size="icon-xs" variant="ghost" onClick={fit} aria-label="Fit"><Maximize className="size-3.5" /></Button></Tip>
      </div>
      {!nodes.length && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12.5px] text-muted-foreground">Select a person or an organization on the left to see who they dealt with.</div>}
      <svg ref={svgRef} width={size.w} height={size.h} className="block cursor-grab active:cursor-grabbing" onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} role="img" aria-label="Relationship graph">
        <defs>
          <marker id="pg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.5 L8,4 L0,7.5 z" style={{ fill: "var(--muted-foreground)" }} /></marker>
          <marker id="pg-arrow-selected" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.5 L8,4 L0,7.5 z" style={{ fill: "var(--primary)" }} /></marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {links.map((l) => {
            const s = l.source as SimNode, t = l.target as SimNode;
            const e = l.edge;
            const sel = focusEdge === e.id;
            const secondary = (depth.get(s.id) ?? 1) !== 0 && (depth.get(t.id) ?? 1) !== 0;
            const { d, mx, my } = curvedPath(s.x ?? 0, s.y ?? 0, t.x ?? 0, t.y ?? 0, lanes.get(e.id) ?? 0);
            const w = (1 + Math.log1p(e.weight) * 0.8) / view.k;
            const label = e.label ? `${kindLabel(e.kind)} · ${e.label}` : kindLabel(e.kind);
            return (
              <g key={e.id} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)} onPointerDown={(ev) => { ev.stopPropagation(); onSelectEdge(e.id); }} className="cursor-pointer">
                <path d={d} fill="none" strokeWidth={Math.max(10, w + 8) / view.k} style={{ stroke: "transparent" }} />
                <path d={d} fill="none" strokeWidth={sel ? w * 1.6 : w} markerEnd={DIRECTED.has(e.kind) ? `url(#${sel ? "pg-arrow-selected" : "pg-arrow"})` : undefined} style={{ stroke: sel ? "var(--primary)" : "var(--muted-foreground)", opacity: sel ? 1 : secondary ? 0.28 : 0.55, transition: "opacity 150ms" }} />
                {(sel || showAllLabels) && (
                  <text x={mx} y={my} textAnchor="middle" dy="0.35em" style={{ fontSize: `${10 / view.k}px`, fill: sel ? "var(--primary)" : "var(--muted-foreground)", paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 / view.k, fontWeight: sel ? 600 : 400, opacity: secondary && !sel ? 0.6 : 1 }}>{label.length > 34 ? `${label.slice(0, 33)}…` : label}</text>
                )}
              </g>
            );
          })}
          {simNodes.map((n) => {
            const d = depth.get(n.id) ?? 1;
            const isCenter = d === 0 && !!centerId && n.id === centerId;
            const kb = kbId === n.id;
            const hov = hoverNode === n.id;
            const fill = isCenter ? "var(--primary)" : d <= 1 ? "var(--foreground)" : "var(--muted-foreground)";
            const initials = n.label.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("");
            return (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`} className="cursor-pointer" onPointerDown={(e) => onPointerDown(e, n)} onDoubleClick={(e) => { e.stopPropagation(); onCenter(n.id); }} onPointerEnter={() => setHoverNode(n.id)} onPointerLeave={() => setHoverNode(null)}>
                {(kb || hov) && <circle r={n.r + 4} fill="none" strokeWidth={1.5 / view.k} strokeDasharray={kb ? `${3 / view.k} ${3 / view.k}` : undefined} style={{ stroke: kb ? "var(--primary)" : "var(--border)" }} />}
                <circle r={n.r} strokeWidth={2 / view.k} style={{ fill, stroke: "var(--background)", opacity: isCenter ? 1 : d <= 1 ? 0.82 : 0.6 }} />
                <text textAnchor="middle" dy="0.35em" style={{ fontSize: `${Math.max(8, Math.min(11, n.r * 0.85)) / view.k}px`, fontWeight: 600, fill: "var(--background)", pointerEvents: "none" }}>{initials}</text>
                <text y={n.r + 12 / view.k} textAnchor="middle" style={{ fontSize: `${11 / view.k}px`, fontWeight: isCenter ? 600 : 500, fill: "var(--foreground)", paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 / view.k, pointerEvents: "none", opacity: d >= 2 ? 0.7 : 1 }}>{n.label}</text>
                {isCenter && (n.title || n.organization) && <text y={n.r + 24 / view.k} textAnchor="middle" style={{ fontSize: `${10 / view.k}px`, fill: "var(--muted-foreground)", paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 / view.k, pointerEvents: "none" }}>{(n.title ?? n.organization ?? "").slice(0, 48)}</text>}
              </g>
            );
          })}
        </g>
      </svg>
      {p.caption && <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t bg-background px-3 py-1 text-[11px] text-muted-foreground">{p.caption}</div>}
    </div>
  );
}
