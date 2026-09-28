"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Chip, StatusDot } from "@/components/ui/misc";
import { SOURCE_STATE_LABEL, SOURCE_STATE_TONE, type CoverageSourceState } from "./coverage-models";

/** Where a search came from: a fact in the matter record, a suggested wording, or the source's own configuration. */
export function OriginChip({ origin, className }: { origin: "record" | "suggested" | "configured" | "unspecified"; className?: string }) {
  if (origin === "unspecified") return null;
  if (origin === "record") return <Chip tone="primary" className={cn("shrink-0", className)} title="Taken from the matter record">From matter record</Chip>;
  if (origin === "suggested") return <Chip tone="outline" className={cn("shrink-0 border-dashed border-line-quiet", className)} title="Search wording generated from the matter (by the model or by rules); check it">Suggested search</Chip>;
  return <Chip tone="outline" className={cn("shrink-0", className)} title="Configured on the source">On source</Chip>;
}

export function SourceStateText({ state, className }: { state: CoverageSourceState; className?: string }) {
  const tone = SOURCE_STATE_TONE[state];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[11.5px]", state === "failed" ? "text-destructive" : state === "needs_key" ? "text-warning-foreground dark:text-warning" : state === "running" ? "text-foreground" : "text-muted-foreground", className)}>
      <StatusDot tone={tone} pulse={state === "running"} />
      {SOURCE_STATE_LABEL[state]}
    </span>
  );
}
