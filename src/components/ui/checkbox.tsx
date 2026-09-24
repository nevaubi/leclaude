"use client";
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckboxSize = "xs" | "sm" | "default";
const SIZE: Record<CheckboxSize, { box: string; icon: string }> = {
  xs: { box: "size-3 rounded-[3px]", icon: "size-2.5" },
  sm: { box: "size-3.5 rounded-[3px]", icon: "size-2.5" },
  default: { box: "size-4 rounded-[4px]", icon: "size-3" },
};

const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { size?: CheckboxSize }>(({ className, size = "default", ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-size={size}
    className={cn("peer shrink-0 border border-input bg-background shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground cursor-pointer", SIZE[size].box, className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      {props.checked === "indeterminate" ? <Minus className={SIZE[size].icon} /> : <Check className={SIZE[size].icon} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
