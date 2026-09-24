"use client";
import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeSpec, sourceHandles } from "../../registry";
import { NodeTypeIcon, StepStatusIcon, toneFor } from "../shared";
import { nodeSummary } from "../node-summary";
import { useBuilderStore, type WfNode } from "./store";

export { nodeSummary };

function WorkflowNodeViewInner({ id, data, selected }: NodeProps<WfNode>) {
  const status = useBuilderStore((st) => st.stepStatuses[id]);
  const errorCount = useBuilderStore((st) => st.issues.filter((i) => i.nodeId === id && i.level === "error").length);
  const warnCount = useBuilderStore((st) => st.issues.filter((i) => i.nodeId === id && i.level === "warning").length);
  const spec = nodeSpec(data.wfType);
  const tone = toneFor(data.wfType);
  const outs = sourceHandles(data.wfType, data.config);
  const isTrigger = data.wfType.startsWith("trigger.");
  const isLoop = data.wfType === "logic.loop";
  const multi = outs.length > 1;

  return (
    <div
      className={cn(
        "wf-node group relative w-[240px] rounded-lg border bg-card text-card-foreground shadow-xs transition-[box-shadow,border-color] duration-150",
        selected ? "border-ring shadow-md ring-2 ring-ring/30" : "hover:border-foreground/25 hover:shadow-sm",
        status === "running" && "border-info ring-2 ring-info/30",
        status === "succeeded" && "border-success/60",
        status === "failed" && "border-destructive/70",
        status === "waiting_approval" && "border-warning ring-2 ring-warning/30",
        status === "skipped" && "opacity-55",
      )}
      data-node-type={data.wfType}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground/70" />}
      {isLoop && <Handle type="target" position={Position.Bottom} id="loop-back" className="!size-2.5 !rounded-full !border-2 !border-background !bg-warning" title="Loop back" />}
      <div className="flex items-center gap-2 px-2.5 pt-2.5">
        <NodeTypeIcon type={data.wfType} size="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[12.5px] font-semibold">{data.label}</div>
          <div className={cn("truncate text-[10px] font-medium uppercase tracking-wider", tone.text)}>{spec?.short ?? data.wfType}<span className="ml-1 font-mono normal-case tracking-normal text-muted-foreground/80">· {id}</span></div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {errorCount > 0 && <span title={`${errorCount} error(s)`}><AlertTriangle className="size-3.5 text-destructive" /></span>}
          {!errorCount && warnCount > 0 && <span title={`${warnCount} warning(s)`}><AlertTriangle className="size-3.5 text-warning" /></span>}
          {status && status !== "pending" && (status === "running" ? <Loader2 className="size-3.5 animate-spin text-info" /> : <StepStatusIcon status={status} className="size-3.5" />)}
        </div>
      </div>
      <div className="px-2.5 pb-2.5 pt-1.5 text-[11px] leading-snug text-muted-foreground">
        <div className="line-clamp-2 min-h-[14px]">{nodeSummary(data.wfType, data.config)}</div>
        {(spec?.usesAI || spec?.usesNetwork) && (
          <div className="mt-1.5 flex gap-1">
            {spec.usesAI && <span className="rounded bg-primary/10 px-1 py-px text-[9.5px] font-medium uppercase tracking-wider text-primary">AI</span>}
            {spec.usesNetwork && <span className="rounded bg-info/10 px-1 py-px text-[9.5px] font-medium uppercase tracking-wider text-info">net</span>}
          </div>
        )}
      </div>
      {multi ? (
        <div className="border-t">
          {outs.map((h) => (
            <div key={h.id} className="relative flex items-center justify-end px-2.5 py-1 text-[10.5px] text-muted-foreground">
              <span className="truncate">{h.label}</span>
              <Handle type="source" position={Position.Right} id={h.id} className={cn("!size-2.5 !rounded-full !border-2 !border-background", h.id === "each" ? "!bg-warning" : h.id === "rejected" ? "!bg-destructive" : h.id === "else" ? "!bg-muted-foreground" : "!bg-primary")} style={{ top: "50%" }} title={h.hint ?? h.label} />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Right} id={outs[0]?.id ?? "out"} className="!size-2.5 !rounded-full !border-2 !border-background !bg-primary" />
      )}
    </div>
  );
}

export const WorkflowNodeView = React.memo(WorkflowNodeViewInner);
export const NODE_TYPES = { wf: WorkflowNodeView };
