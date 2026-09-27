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
  <AvatarPrimitive.Fallback ref={ref} className={cn("flex size-full items-center justify-center rounded-full bg-muted text-foreground/70 text-[11px] font-medium", className)} {...props} />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

/** Initials avatar for a person name: one neutral treatment, no per-person colour. */
function PersonAvatar({ name, className, size = "md" }: { name: string; className?: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const color = "bg-muted text-foreground/70 ring-1 ring-inset ring-border";
  const sz = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-[11px]";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium", sz, color, className)} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

export { Avatar, AvatarImage, AvatarFallback, PersonAvatar };
