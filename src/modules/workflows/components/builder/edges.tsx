"use client";
import * as React from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, MarkerType, type EdgeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { sourceHandles } from "../../registry";
import { useBuilderStore } from "./store";

function WorkflowEdgeViewInner(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, source, sourceHandleId, targetHandleId, label } = props;
  const sourceNode = useBuilderStore((s) => s.nodes.find((n) => n.id === source));
  const sourceStatus = useBuilderStore((s) => s.stepStatuses[source]);
  const removeEdges = useBuilderStore((s) => s.removeEdges);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const handleLabel = React.useMemo(() => {
    if (typeof label === "string" && label) return label;
    if (!sourceHandleId || !sourceNode) return targetHandleId === "loop-back" ? "loop back" : "";
    const h = sourceHandles(sourceNode.data.wfType, sourceNode.data.config).find((x) => x.id === sourceHandleId);
    return h?.label ?? sourceHandleId;
  }, [label, sourceHandleId, sourceNode, targetHandleId]);
  const isLoopBack = targetHandleId === "loop-back";
  const stroke = selected ? "var(--ring)" : sourceStatus === "succeeded" ? "var(--success)" : sourceStatus === "failed" ? "var(--destructive)" : isLoopBack ? "var(--warning)" : "var(--border)";
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={`url(#wf-arrow${selected ? "-selected" : ""})`} style={{ stroke, strokeWidth: selected ? 2 : 1.5, strokeDasharray: isLoopBack ? "6 4" : undefined }} interactionWidth={16} />
      {(handleLabel || selected) && (
        <EdgeLabelRenderer>
          <div style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }} className="nodrag nopan pointer-events-auto absolute flex items-center gap-1">
            {handleLabel && <span className={cn("rounded-full border bg-background px-1.5 py-px text-[10px] text-muted-foreground shadow-xs", selected && "border-ring text-foreground")}>{handleLabel}</span>}
            {selected && (
              <button onClick={() => removeEdges([id])} className="flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:bg-destructive hover:text-destructive-foreground cursor-pointer" title="Delete connection">
                <X className="size-3" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const WorkflowEdgeView = React.memo(WorkflowEdgeViewInner);
export const EDGE_TYPES = { wf: WorkflowEdgeView };
export const DEFAULT_EDGE_OPTIONS = { type: "wf", markerEnd: { type: MarkerType.ArrowClosed } } as const;

/** SVG marker definitions rendered once inside the flow. */
export function EdgeMarkers() {
  return (
    <svg className="absolute size-0">
      <defs>
        <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" /></marker>
        <marker id="wf-arrow-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ring)" /></marker>
      </defs>
    </svg>
  );
}
