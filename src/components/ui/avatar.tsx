"use client";
import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn, initials } from "@/lib/utils";

const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root ref={ref} className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)} {...props} />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Image>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("aspect-square size-full", className)} {...props} />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Fallback>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback ref={ref} className={cn("flex size-full items-center justify-center rounded-full bg-accent text-accent-foreground text-[11px] font-semibold", className)} {...props} />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

const AVATAR_COLORS = ["bg-chart-1/20 text-chart-1", "bg-chart-2/20 text-chart-2", "bg-chart-3/25 text-chart-3", "bg-chart-4/20 text-chart-4", "bg-chart-5/20 text-chart-5"];

/** Deterministic initials avatar for a person name. */
function PersonAvatar({ name, className, size = "md" }: { name: string; className?: string; size?: "xs" | "sm" | "md" | "lg" }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length];
  const sz = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-[11px]";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", sz, color, className)} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

export { Avatar, AvatarImage, AvatarFallback, PersonAvatar };
