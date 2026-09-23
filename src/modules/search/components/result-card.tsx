"use client";
import * as React from "react";
import { BookOpen, BookmarkPlus, Check, Copy, ExternalLink, FileSearch, FileText, Globe, Landmark, Library, Newspaper, Scale, ScrollText, type LucideIcon } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { highlightSegments } from "../query-builder";
import { courtAbbreviation } from "../jurisdictions";
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

function AuthorityBadge({ authority }: { authority?: SearchHit["authority"] }) {
  if (!authority || authority === "n/a") return null;
  return authority === "binding" ? <Badge variant="success" className="py-0">Binding</Badge> : <Badge variant="muted" className="py-0">Persuasive</Badge>;
}

export interface ResultCardProps {
  hit: SearchHit;
  index: number;
  terms: string[];
  selected: boolean;
  inMemo: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onCite: () => void;
  onSave: () => void;
  onMemo: () => void;
}

export const ResultCard = React.memo(function ResultCard({ hit, index, terms, selected, inMemo, onSelect, onOpen, onCite, onSave, onMemo }: ResultCardProps) {
  const Icon = SOURCE_ICON[hit.source];
  const [copied, setCopied] = React.useState(false);
  const cite = () => { onCite(); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const meta = metaLine(hit);
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        "group relative mx-2 my-1 rounded-lg border bg-card px-3 py-2.5 transition-colors cursor-pointer",
        selected ? "border-primary/50 ring-2 ring-primary/20 shadow-sm" : "hover:border-foreground/20 hover:bg-accent/30",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground", selected ? "bg-primary/10 text-primary" : "bg-muted")}><Icon className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="min-w-0 flex-1 text-left text-[13px] font-semibold leading-snug text-foreground hover:text-primary hover:underline underline-offset-2 cursor-pointer">
              <span className="mr-1.5 tabular text-[11px] font-medium text-muted-foreground">{index + 1}.</span>
              <Highlighted text={hit.title} terms={terms} />
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <AuthorityBadge authority={hit.authority} />
              {hit.status && hit.source === "caselaw" && <Badge variant={hit.status === "Published" ? "info" : "outline"} className="py-0 hidden md:inline-flex">{hit.status}</Badge>}
              {hit.source === "federal_register" && hit.fr?.type && <Badge variant="accent" className="py-0">{hit.fr.type}</Badge>}
              {hit.source === "library" && hit.library?.type && <Badge variant="accent" className="py-0 uppercase">{hit.library.type}</Badge>}
              {hit.source === "dockets" && hit.status && <Badge variant={hit.status === "Open" ? "success" : "muted"} className="py-0">{hit.status}</Badge>}
            </div>
          </div>
          {meta.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-muted-foreground">
              {meta.map((m, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="opacity-50">·</span>}
                  <span className={cn(m.mono && "font-mono text-[11px]", m.strong && "font-medium text-foreground/80")}>{m.text}</span>
                </React.Fragment>
              ))}
            </div>
          )}
          {hit.source === "dockets" && (hit.parties?.length || hit.assignedTo) && (
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              {hit.assignedTo && <span><span className="font-medium text-foreground/80">Judge:</span> {hit.assignedTo}</span>}
              {hit.assignedTo && hit.parties?.length ? <span className="opacity-50"> · </span> : null}
              {hit.parties?.length ? <span><span className="font-medium text-foreground/80">Parties:</span> {hit.parties.slice(0, 4).join("; ")}{hit.parties.length > 4 ? ` +${hit.parties.length - 4}` : ""}</span> : null}
            </div>
          )}
          {hit.source === "ediscovery" && hit.edoc && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {hit.edoc.aiScore != null && <Badge variant={hit.edoc.aiScore >= 70 ? "warning" : "muted"} className="py-0 tabular">AI {hit.edoc.aiScore}</Badge>}
              {hit.edoc.coding?.responsive && <Badge variant="info" className="py-0">Responsive</Badge>}
              {hit.edoc.coding?.privileged && <Badge variant="destructive" className="py-0">Privileged</Badge>}
              {hit.edoc.coding?.hot && <Badge variant="warning" className="py-0">Hot</Badge>}
              {hit.edoc.coding?.confidentiality && <Badge variant="outline" className="py-0 capitalize">{hit.edoc.coding.confidentiality}</Badge>}
            </div>
          )}
          {hit.source === "library" && hit.library?.tags?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">{hit.library.tags.slice(0, 5).map((t) => <Badge key={t} variant="outline" className="py-0 font-normal">{t}</Badge>)}</div>
          ) : null}
          {hit.snippet && <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-foreground/85"><Highlighted text={hit.snippet} terms={terms} /></p>}
          <div className={cn("mt-1.5 flex items-center gap-0.5 transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
            <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); onOpen(); }}><FileText className="size-3" /> Open</Button>
            <Tip label="Copy Bluebook citation" shortcut="c"><Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); cite(); }}>{copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />} Cite</Button></Tip>
            <Tip label="Save to firm library"><Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); onSave(); }}><BookmarkPlus className="size-3" /> Save</Button></Tip>
            <Tip label={inMemo ? "Already in memo" : "Add to research memo"} shortcut="m"><Button variant="ghost" size="xs" disabled={inMemo} onClick={(e) => { e.stopPropagation(); onMemo(); }}>{inMemo ? <Check className="size-3 text-success" /> : <BookOpen className="size-3" />} {inMemo ? "In memo" : "Memo"}</Button></Tip>
            {hit.url && /^https?:/.test(hit.url) && (
              <Button asChild variant="ghost" size="xs"><a href={hit.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink className="size-3" /> External</a></Button>
            )}
            <div className="flex-1" />
            {typeof hit.score === "number" && <span className="tabular text-[10px] text-muted-foreground">rel {Math.round(hit.score * 100)}%</span>}
          </div>
        </div>
      </div>
    </div>
  );
});

function metaLine(hit: SearchHit): { text: string; mono?: boolean; strong?: boolean }[] {
  const out: { text: string; mono?: boolean; strong?: boolean }[] = [];
  switch (hit.source) {
    case "caselaw":
      if (hit.cite) out.push({ text: hit.cite, mono: true, strong: true });
      if (hit.citations && hit.citations.length > 1) out.push({ text: `+${hit.citations.length - 1} parallel` });
      if (hit.courtId || hit.court) out.push({ text: courtAbbreviation(hit.courtId, hit.court) });
      if (hit.date) out.push({ text: formatDate(hit.date) });
      if (hit.docketNumber) out.push({ text: `No. ${hit.docketNumber}`, mono: true });
      if (typeof hit.citeCount === "number") out.push({ text: `${hit.citeCount.toLocaleString()} citing` });
      if (hit.judge) out.push({ text: hit.judge });
      break;
    case "dockets":
      if (hit.docketNumber) out.push({ text: hit.docketNumber, mono: true, strong: true });
      if (hit.courtId || hit.court) out.push({ text: courtAbbreviation(hit.courtId, hit.court) });
      if (hit.date) out.push({ text: `filed ${formatDate(hit.date)}` });
      if (hit.dateTerminated) out.push({ text: `terminated ${formatDate(hit.dateTerminated)}` });
      if (hit.natureOfSuit) out.push({ text: `NOS ${hit.natureOfSuit}` });
      break;
    case "regulations":
      if (hit.cfr?.partHeading) out.push({ text: `Part ${hit.cfr.part} — ${hit.cfr.partHeading}` });
      if (hit.cfr?.effective) out.push({ text: `effective ${formatDate(hit.cfr.effective)}` });
      break;
    case "federal_register":
      if (hit.cite) out.push({ text: hit.cite, mono: true, strong: true });
      if (hit.fr?.agencies?.length) out.push({ text: hit.fr.agencies.slice(0, 2).join(", ") });
      if (hit.date) out.push({ text: `published ${formatDate(hit.date)}` });
      if (hit.fr?.effectiveOn) out.push({ text: `effective ${formatDate(hit.fr.effectiveOn)}` });
      if (hit.fr?.commentsCloseOn) out.push({ text: `comments close ${formatDate(hit.fr.commentsCloseOn)}` });
      if (hit.fr?.docketIds?.length) out.push({ text: hit.fr.docketIds[0], mono: true });
      break;
    case "statutes":
      if (hit.cite) out.push({ text: hit.cite, mono: true, strong: true });
      if (hit.statute?.collection) out.push({ text: hit.statute.collection });
      if (hit.date) out.push({ text: formatDate(hit.date) });
      if (hit.statute?.packageId) out.push({ text: hit.statute.packageId, mono: true });
      break;
    case "library":
      if (hit.library?.practiceArea) out.push({ text: hit.library.practiceArea });
      if (hit.library?.description) out.push({ text: hit.library.description.slice(0, 90) });
      break;
    case "ediscovery":
      if (hit.edoc?.bates) out.push({ text: hit.edoc.bates, mono: true, strong: true });
      if (hit.edoc?.custodian) out.push({ text: hit.edoc.custodian });
      if (hit.edoc?.type) out.push({ text: hit.edoc.type });
      if (hit.date) out.push({ text: formatDate(hit.date) });
      if (hit.edoc?.from) out.push({ text: `from ${hit.edoc.from}` });
      break;
    case "web":
      if (hit.subtitle) out.push({ text: hit.subtitle });
      break;
  }
  return out;
}
