"use client";
/** Word status bar: words · page setup · ~pages · ¶ n of N · section … comments · Track changes · language · zoom · save state. */
import * as React from "react";
import { Globe, Loader2, MessageSquare, PenLine, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OfficeStatusBar, StatusItem, StatusSpacer } from "@/modules/office/shared/office-chrome";
import { LANGUAGES } from "./constants";

export interface StatusBarProps {
  words: number; characters: number; pages: number; pageLabel: string;
  paraIndex: number; paraTotal: number; section: string;
  trackChanges: boolean; pending: number; language: string; onLanguage: (id: string) => void;
  onTrackChanges?: (on: boolean) => void;
  saveLabel: string; saveState?: string; comments: number; loading: boolean;
  onComments?: () => void;
  zoom: number; zoomMode: "fit" | number; onZoom: (z: "fit" | number) => void;
}

export function StatusBar(p: StatusBarProps) {
  return (
    <OfficeStatusBar>
      <StatusItem title={`${p.words.toLocaleString()} words · ${p.characters.toLocaleString()} characters`}><span className="tabular text-foreground">{p.words.toLocaleString()}</span> words</StatusItem>
      <StatusItem title="Page setup (change under Page in the toolbar)" className="hidden md:flex">{p.pageLabel}</StatusItem>
      <StatusItem title="Estimated printed pages"><span className="tabular">~{p.pages}</span> page{p.pages === 1 ? "" : "s"}</StatusItem>
      <StatusItem title="Current paragraph"><span className="tabular">¶ {p.paraIndex || "–"} of {p.paraTotal}</span></StatusItem>
      {p.section && <StatusItem className="hidden min-w-0 max-w-[280px] lg:flex" title="Current section"><span className="truncate">§ {p.section}</span></StatusItem>}
      <StatusSpacer />
      {p.comments > 0 && <StatusItem onClick={p.onComments} title="Open comments"><MessageSquare className="size-3" /> <span className="tabular">{p.comments}</span></StatusItem>}
      <StatusItem onClick={p.onTrackChanges ? () => p.onTrackChanges?.(!p.trackChanges) : undefined} active={p.trackChanges} title="Toggle track changes (⌘⇧E)">
        <PenLine className="size-3" /> Track changes {p.trackChanges ? "on" : "off"}
        {p.pending > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 tabular text-primary">{p.pending} pending</span>}
      </StatusItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="flex h-full items-center gap-1 border-r px-2.5 hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Proofing language"><Globe className="size-3" /> <span className="hidden sm:inline">{p.language}</span></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={LANGUAGES.find((l) => l.label === p.language)?.id ?? "en-US"} onValueChange={p.onLanguage}>{LANGUAGES.map((l) => <DropdownMenuRadioItem key={l.id} value={l.id}>{l.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="flex h-full items-center gap-1 border-r px-2.5 tabular hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Zoom"><ZoomIn className="size-3" /> {Math.round(p.zoom * 100)}%{p.zoomMode === "fit" ? " · fit" : ""}</button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={String(p.zoomMode)} onValueChange={(v) => p.onZoom(v === "fit" ? "fit" : Number(v))}><DropdownMenuRadioItem value="fit">Fit width</DropdownMenuRadioItem>{[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((z) => <DropdownMenuRadioItem key={z} value={String(z)}>{Math.round(z * 100)}%</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
      <StatusItem className={cn("min-w-[120px] justify-end", p.saveState === "error" && "text-destructive")} title="Save state">{p.loading ? <Loader2 className="size-3 animate-spin" /> : null}{p.saveLabel}</StatusItem>
    </OfficeStatusBar>
  );
}
