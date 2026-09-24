import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Quiet status badge. Reserve it for filters and decision states (privileged,
 * hot, needs review, failed); counts are plain text, not badges.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[var(--radius-chip)] border font-medium whitespace-nowrap [&>svg]:shrink-0 transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        success: "border-transparent bg-success/12 text-success dark:bg-success/20",
        warning: "border-transparent bg-warning/18 text-warning-foreground dark:text-warning",
        destructive: "border-transparent bg-destructive/12 text-destructive",
        info: "border-transparent bg-info/12 text-info",
        accent: "border-transparent bg-accent text-accent-foreground",
      },
      size: {
        xs: "h-4 px-1 text-[10px] leading-none [&>svg]:size-2.5",
        sm: "h-[18px] px-1.5 text-[10.5px] leading-none [&>svg]:size-3",
        default: "px-2 py-0.5 text-[11px] leading-4 [&>svg]:size-3",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
