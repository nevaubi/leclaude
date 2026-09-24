"use client";
import * as React from "react";
import { BookOpen, FileSearch, Globe, Landmark, Library, Newspaper, Scale, ScrollText, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { highlightSegments } from "../query-builder";
import type { SearchHit, SearchSource } from "../types";

export const SOURCE_ICON: Record<SearchSource, LucideIcon> = { caselaw: Scale, statutes: ScrollText, regulations: BookOpen, federal_register: Newspaper, dockets: Landmark, web: Globe, library: Library, ediscovery: FileSearch };

export function Highlighted({ text, terms, className }: { text?: string; terms: string[]; className?: string }) {
  const segs = React.useMemo(() => (text ? highlightSegments(text, terms) : []), [text, terms]);
  if (!text) return null;
  return (
    <span className={className}>
      {segs.map((s, i) => (s.hit ? <mark key={i} className="rounded-sm bg-warning/30 px-0.5 text-foreground dark:bg-warning/25">{s.text}</mark> : <React.Fragment key={i}>{s.text}</React.Fragment>))}
    </span>
  );
}

export function AuthorityBadge({ authority }: { authority?: SearchHit["authority"] }) {
  if (!authority || authority === "n/a") return null;
  return authority === "binding" ? <Badge variant="success" className="py-0">Binding</Badge> : <Badge variant="muted" className="py-0">Persuasive</Badge>;
}
