"use client";
import * as React from "react";
import { ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ai/markdown";
import { Button } from "@/components/ui/button";

function looksLikeProse(s: string) {
  return s.length > 80 && (/\n/.test(s) || /[.!?]\s/.test(s)) && !/^\s*[[{]/.test(s);
}

/** Renders any step output: Markdown for prose, a collapsible tree for JSON. */
export function OutputViewer({ value, className, defaultDepth = 1 }: { value: unknown; className?: string; defaultDepth?: number }) {
  if (value == null) return <div className={cn("text-[11px] italic text-muted-foreground", className)}>No output</div>;
  if (typeof value === "string") {
    return looksLikeProse(value) ? <div className={cn("rounded-md border bg-background p-3", className)}><Markdown compact>{value}</Markdown></div> : <pre className={cn("whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 font-mono text-[11px]", className)}>{value}</pre>;
  }
  if (typeof value !== "object") return <code className={cn("font-mono text-[11px]", className)}>{String(value)}</code>;
  const obj = value as Record<string, unknown>;
  // Common case: { text } → render as prose with the rest as a tree.
  if (!Array.isArray(value) && typeof obj.text === "string" && looksLikeProse(obj.text)) {
    const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "text"));
    return (
      <div className={cn("space-y-2", className)}>
        <div className="rounded-md border bg-background p-3"><Markdown compact>{obj.text}</Markdown></div>
        {Object.keys(rest).length > 0 && <JsonTree value={rest} depth={0} defaultDepth={defaultDepth} />}
      </div>
    );
  }
  return <div className={cn("rounded-md border bg-muted/30 p-2", className)}><JsonTree value={value} depth={0} defaultDepth={defaultDepth} /></div>;
}

export function JsonTree({ value, depth, defaultDepth, name }: { value: unknown; depth: number; defaultDepth: number; name?: string }) {
  const [open, setOpen] = React.useState(depth < defaultDepth);
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object";
  if (!isObj) return <Leaf name={name} value={value} />;
  const entries = isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const summary = isArr ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <div className="font-mono text-[11px] leading-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded px-0.5 hover:bg-accent cursor-pointer">
        <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")} />
        {name !== undefined && <span className="text-info">{name}</span>}
        {name !== undefined && <span className="text-muted-foreground">:</span>}
        <span className="text-muted-foreground">{summary}</span>
        {!open && entries.length > 0 && <span className="ml-1 truncate text-muted-foreground/70">{preview(value)}</span>}
      </button>
      {open && (
        <div className="ml-2 border-l border-border/60 pl-3">
          {entries.slice(0, 200).map(([k, v]) => <JsonTree key={k} name={k} value={v} depth={depth + 1} defaultDepth={defaultDepth} />)}
          {entries.length > 200 && <div className="text-muted-foreground">… {entries.length - 200} more</div>}
        </div>
      )}
    </div>
  );
}

function preview(v: unknown): string {
  try { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 80) + "…" : s; } catch { return ""; }
}

function Leaf({ name, value }: { name?: string; value: unknown }) {
  const [expanded, setExpanded] = React.useState(false);
  const str = typeof value === "string";
  const long = str && (value as string).length > 160;
  const text = str ? (expanded || !long ? (value as string) : (value as string).slice(0, 160) + "…") : String(value);
  return (
    <div className="flex items-start gap-1 font-mono text-[11px] leading-5">
      {name !== undefined && <span className="shrink-0 text-info">{name}<span className="text-muted-foreground">:</span></span>}
      <span className={cn("min-w-0 whitespace-pre-wrap break-words", str ? "text-foreground" : typeof value === "number" ? "text-chart-3" : typeof value === "boolean" ? "text-chart-4" : "text-muted-foreground")}>{str ? `"${text}"` : text}</span>
      {long && <button type="button" onClick={() => setExpanded((e) => !e)} className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer">{expanded ? "less" : "more"}</button>}
    </div>
  );
}

export function CopyButton({ value, className }: { value: unknown; className?: string }) {
  return (
    <Button variant="ghost" size="icon-xs" className={className} onClick={() => { navigator.clipboard?.writeText(typeof value === "string" ? value : JSON.stringify(value, null, 2)); toast.success("Copied to clipboard"); }} aria-label="Copy">
      <Copy className="size-3.5" />
    </Button>
  );
}
