"use client";
import * as React from "react";
import { Globe, Loader2, MessageSquare, PenLine, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LANGUAGES } from "./constants";

export interface StatusBarProps {
  words: number; characters: number; pages: number; pageLabel: string;
  paraIndex: number; paraTotal: number; section: string;
  trackChanges: boolean; pending: number; language: string; onLanguage: (id: string) => void;
  saveLabel: string; comments: number; loading: boolean;
  zoom: number; zoomMode: "fit" | number; onZoom: (z: "fit" | number) => void;
}

export function StatusBar(p: StatusBarProps) {
  const Item = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) => <span title={title} className={cn("flex items-center gap-1 whitespace-nowrap px-2", className)}>{children}</span>;
  return (
    <div className="flex h-7 shrink-0 items-center overflow-hidden border-t bg-background text-[11px] text-muted-foreground divide-x">
      <Item title="Words · characters"><span className="tabular text-foreground">{p.words.toLocaleString()}</span> words <span className="tabular">· {p.characters.toLocaleString()} chars</span></Item>
      <Item title="Page setup">{p.pageLabel}</Item>
      <Item title="Estimated page count"><span className="tabular">~{p.pages}</span> page{p.pages === 1 ? "" : "s"}</Item>
      <Item title="Current paragraph"><span className="tabular">¶{p.paraIndex || "–"} of {p.paraTotal}</span></Item>
      {p.section && <Item className="hidden min-w-0 max-w-[260px] lg:flex" title="Current section"><span className="truncate">§ {p.section}</span></Item>}
      <div className="flex-1" />
      {p.comments > 0 && <Item><MessageSquare className="size-3" /> <span className="tabular">{p.comments}</span></Item>}
      <Item className={cn(p.trackChanges && "text-primary")}><PenLine className="size-3" /> Track changes {p.trackChanges ? "on" : "off"}{p.pending > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 tabular text-primary">{p.pending} pending</span>}</Item>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="flex h-full items-center gap-1 px-2 hover:bg-accent hover:text-foreground cursor-pointer"><Globe className="size-3" /> {p.language}</button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={LANGUAGES.find((l) => l.label === p.language)?.id ?? "en-US"} onValueChange={p.onLanguage}>{LANGUAGES.map((l) => <DropdownMenuRadioItem key={l.id} value={l.id}>{l.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="flex h-full items-center gap-1 px-2 tabular hover:bg-accent hover:text-foreground cursor-pointer" title="Zoom"><ZoomIn className="size-3" /> {Math.round(p.zoom * 100)}%{p.zoomMode === "fit" ? " · fit" : ""}</button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={String(p.zoomMode)} onValueChange={(v) => p.onZoom(v === "fit" ? "fit" : Number(v))}><DropdownMenuRadioItem value="fit">Fit width</DropdownMenuRadioItem>{[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((z) => <DropdownMenuRadioItem key={z} value={String(z)}>{Math.round(z * 100)}%</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
      <Item className="min-w-[110px] justify-end">{p.loading ? <Loader2 className="size-3 animate-spin" /> : null}{p.saveLabel}</Item>
    </div>
  );
}
