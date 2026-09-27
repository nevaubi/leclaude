import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Quiet badge. Neutral variants are a very light chip without a border; the
 * semantic variants (success, warning, destructive, info, accent) render as
 * plain text led by a 6px dot in a muted semantic colour, never a filled pill.
 * Decorative icons inside a semantic badge are hidden (the dot carries the
 * tone); a spinner (`.animate-spin`) stays and replaces the dot.
 */
const dot =
  "before:content-[''] before:size-1.5 before:shrink-0 before:rounded-full has-[>.animate-spin]:before:hidden [&>svg:not(.animate-spin)]:hidden bg-transparent px-0 text-muted-foreground";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border border-transparent font-medium whitespace-nowrap [&>svg]:shrink-0 [&>svg]:text-muted-foreground transition-colors",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground/80",
        secondary: "bg-muted text-muted-foreground",
        outline: "bg-transparent text-muted-foreground",
        muted: "bg-muted text-muted-foreground",
        success: cn(dot, "before:bg-success/75"),
        warning: cn(dot, "before:bg-warning"),
        destructive: cn(dot, "before:bg-destructive text-foreground/85"),
        info: cn(dot, "before:bg-muted-foreground/60"),
        accent: cn(dot, "before:bg-primary"),
      },
      size: {
        xs: "h-4 px-1 text-[10.5px] leading-none [&>svg]:size-2.5",
        sm: "h-[18px] px-1.5 text-[11px] leading-none [&>svg]:size-3",
        default: "h-5 px-1.5 text-[11px] leading-none [&>svg]:size-3",
      },
    },
    compoundVariants: [
      // Dot-led badges sit flush with surrounding text.
      { variant: ["success", "warning", "destructive", "info", "accent"], className: "px-0" },
    ],
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
