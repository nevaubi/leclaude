import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Seeger Weiss brand marks, drawn as inline SVG so they render crisply in both
 * themes without network fonts. The monogram is the navy "SW" tile used in the
 * navigation rail; the wordmark is the serif "SEEGERWEISS LLP" lockup with the
 * "COMPLEX LITIGATION | SIMPLE JUSTICE" tagline.
 */
export function SWMark({ className, size = 32, title = "Seeger Weiss" }: { className?: string; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} className={cn("shrink-0", className)}>
      <rect width="64" height="64" rx="10" fill="#14284b" />
      <text x="32" y="43" textAnchor="middle" fontFamily="'Source Serif 4 Variable', Georgia, 'Times New Roman', serif" fontWeight="600" fontSize="31" fill="#ffffff" letterSpacing="-1">SW</text>
    </svg>
  );
}

export function SeegerWeissWordmark({ className, height = 34, tagline = true, color }: { className?: string; height?: number; tagline?: boolean; color?: string }) {
  const width = tagline ? (height * 380) / 100 : (height * 400) / 60;
  return (
    <svg height={height} width={width} viewBox={tagline ? "0 0 380 100" : "0 0 400 60"} role="img" aria-label="Seeger Weiss LLP — Complex Litigation | Simple Justice" className={cn("shrink-0", className)}>
      <text x="0" y="52" fontFamily="'Source Serif 4 Variable', Georgia, 'Times New Roman', serif" fontWeight="700" fontSize="58" fill={color ?? "currentColor"} letterSpacing="-1.5">
        S<tspan fontSize="46">EEGER</tspan>W<tspan fontSize="46">EISS</tspan>
        <tspan fontSize="20" dx="8" fontWeight="600" letterSpacing="1">LLP</tspan>
      </text>
      {tagline && (
        <text x="1" y="86" fontFamily="'Inter Variable', ui-sans-serif, system-ui, sans-serif" fontWeight="500" fontSize="12.5" fill="#1f6fb2" letterSpacing="4.2">
          COMPLEX LITIGATION | SIMPLE JUSTICE
        </text>
      )}
    </svg>
  );
}

/** Compact lockup for headers: monogram + firm name. */
export function BrandLockup({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 min-w-0", className)}>
      <SWMark size={30} />
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-serif text-[15px] font-semibold tracking-tight">Seeger Weiss <span className="text-[11px] font-medium tracking-wider">LLP</span></span>
          <span className="block truncate text-[9.5px] font-medium uppercase tracking-[0.18em] text-[#1f6fb2] dark:text-[#6fb2e6]">Complex Litigation | Simple Justice</span>
        </span>
      )}
    </span>
  );
}
