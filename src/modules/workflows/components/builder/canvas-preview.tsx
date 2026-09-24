"use client";
import * as React from "react";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2 } from "lucide-react";
import type { Workflow, WorkflowRunStep } from "@/lib/types/domain";
import { useTheme } from "@/components/shell/theme-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DEFAULT_EDGE_OPTIONS, EDGE_TYPES, EdgeMarkers } from "./edges";
import { NODE_TYPES } from "./nodes";
import { fromDomain, graphBounds, useBuilderStore, type WfNode } from "./store";

/**
 * Read-only canvas showing a workflow snapshot with step statuses (used on
 * the run detail page). It loads the snapshot into the builder store so the
 * shared node/edge components can render statuses.
 */
export function CanvasPreview({ workflow, statuses, className, onNodeSelect }: { workflow: Pick<Workflow, "id" | "nodes" | "edges">; statuses: Record<string, WorkflowRunStep["status"]>; className?: string; onNodeSelect?: (id: string) => void }) {
  React.useEffect(() => {
    const snap = fromDomain(workflow.nodes, workflow.edges);
    useBuilderStore.setState({ workflowId: workflow.id, nodes: snap.nodes, edges: snap.edges, issues: [], stepStatuses: statuses, selectedNodeId: null });
  }, [workflow.id, workflow.nodes, workflow.edges]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { useBuilderStore.getState().setStepStatuses(statuses); }, [statuses]);
  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-background", className)}>
      <EdgeMarkers />
      <ReactFlowProvider>
        <PreviewFlow onNodeSelect={onNodeSelect} />
      </ReactFlowProvider>
    </div>
  );
}

function PreviewFlow({ onNodeSelect }: { onNodeSelect?: (id: string) => void }) {
  const { resolved } = useTheme();
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const rf = useReactFlow<WfNode>();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const anchor = React.useCallback(() => {
    const el = wrapperRef.current;
    if (!el || !nodes.length) return;
    const b = graphBounds(nodes);
    const fit = Math.min((el.clientWidth - 60) / Math.max(b.width, 1), (el.clientHeight - 60) / Math.max(b.height, 1), 0.9);
    if (fit >= 0.5) { rf.fitView({ padding: 0.15, maxZoom: 0.9 }); return; }
    const zoom = 0.62;
    rf.setViewport({ x: 32 - b.x * zoom, y: el.clientHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  }, [nodes, rf]);
  React.useEffect(() => { const t = setTimeout(anchor, 60); return () => clearTimeout(t); }, [anchor]);
  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow<WfNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        colorMode={resolved}
        minZoom={0.1}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={Boolean(onNodeSelect)}
        onNodeClick={(_e, n) => onNodeSelect?.(n.id)}
        zoomOnScroll={false}
        panOnScroll
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
      </ReactFlow>
      <div className="absolute right-2 top-2 flex gap-1">
        <Tip label="Fit graph"><Button variant="outline" size="icon-xs" onClick={() => rf.fitView({ padding: 0.15, duration: 250 })}><Maximize2 className="size-3.5" /></Button></Tip>
      </div>
    </div>
  );
}
