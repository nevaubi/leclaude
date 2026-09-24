import * as React from "react";
import { cn } from "@/lib/utils";

export type InputSize = "xs" | "sm" | "default";

const SIZE: Record<InputSize, string> = {
  xs: "h-7 px-2 text-[12.5px] rounded-md",
  sm: "h-8 px-2.5 text-[12.5px] rounded-md",
  default: "h-9 px-3 text-sm rounded-md",
};

export interface InputProps extends Omit<React.ComponentProps<"input">, "size"> {
  /** Control height: xs = 28px (toolbars, grids), sm = 32px (forms), default = 36px. */
  size?: InputSize;
  /** Native `size` attribute (character width), rarely needed. */
  htmlSize?: number;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, size = "default", htmlSize, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    size={htmlSize}
    data-size={size}
    className={cn(
      "flex w-full min-w-0 border border-input bg-background py-1 shadow-xs transition-[color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
      SIZE[size],
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
