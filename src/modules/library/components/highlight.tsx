"use client";
import * as React from "react";

/** Wrap query terms in <mark> without injecting HTML. */
export function Highlight({ text, query, className }: { text: string; query: string; className?: string }) {
  const terms = React.useMemo(() => Array.from(new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 1))).sort((a, b) => b.length - a.length), [query]);
  if (!terms.length || !text) return <span className={className}>{text}</span>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  const parts = text.split(re);
  return (
    <span className={className}>
      {parts.map((p, i) => (terms.includes(p.toLowerCase()) ? <mark key={i} className="rounded-sm bg-warning/35 px-0.5 text-foreground">{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </span>
  );
}
