"use client";
import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root ref={ref} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)} {...props}>
    <ProgressPrimitive.Indicator className={cn("h-full w-full flex-1 bg-primary transition-transform duration-300", indicatorClassName)} style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }} />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

/** Small horizontal score bar (0–100) coloured by threshold; used for AI relevance scores. */
function ScoreBar({ value, className, showValue = true }: { value: number; className?: string; showValue?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = v >= 85 ? "bg-chart-1" : v >= 60 ? "bg-chart-3" : "bg-muted-foreground/50";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className={cn("absolute inset-y-0 left-0 rounded-full", color)} style={{ width: `${v}%` }} /></span>
      {showValue && <span className="tabular text-xs text-muted-foreground w-6 text-right">{v}</span>}
    </span>
  );
}

export { Progress, ScoreBar };
