"use client";
import * as React from "react";
/** Hydration-safe relative time: renders the absolute date on the server and switches to "3 hours ago" after mount. */
export function RelativeTime({ value, className, title }: { value: string | number | Date; className?: string; title?: string }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const d = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  const abs = Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return <time dateTime={Number.isNaN(d.getTime()) ? undefined : d.toISOString()} title={title ?? abs} className={className} suppressHydrationWarning>{mounted ? relativeTimeLabel(d) : abs}</time>;
}

function relativeTimeLabel(d: Date, now = Date.now()) {
  const diff = (d.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}
