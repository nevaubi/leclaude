"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, FilePlus2, FileSpreadsheet, FileText, FileType, LayoutTemplate, Presentation, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { OfficeKind } from "@/lib/types/domain";
import { KIND_META, OFFICE_KINDS, type OfficeTemplateSummary } from "./types";

export const KIND_ICON: Record<OfficeKind, LucideIcon> = { word: FileText, sheet: FileSpreadsheet, slides: Presentation, pdf: FileType };
export const KIND_COLOR: Record<OfficeKind, string> = { word: "text-chart-1", sheet: "text-chart-4", slides: "text-chart-5", pdf: "text-destructive" };
export const KIND_BG: Record<OfficeKind, string> = { word: "bg-chart-1/12", sheet: "bg-chart-4/12", slides: "bg-chart-5/12", pdf: "bg-destructive/10" };

export function newHref(kind: OfficeKind, opts: { templateId?: string; matterId?: string | null } = {}) {
  const sp = new URLSearchParams();
  if (opts.templateId) sp.set("template", opts.templateId);
  if (opts.matterId) sp.set("matter", opts.matterId);
  const qs = sp.toString();
  return `/office/${kind}/new${qs ? `?${qs}` : ""}`;
}

/** Hero row: one "New" tile per editor with a blank option and a template dropdown fed by /api/office/templates?kind=. */
export function NewTiles({ templates, counts, activeKind, matterId }: { templates: OfficeTemplateSummary[]; counts: Record<OfficeKind, number>; activeKind: OfficeKind | null; matterId: string | null }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {OFFICE_KINDS.map((kind) => <NewTile key={kind} kind={kind} initialTemplates={templates.filter((t) => t.kind === kind)} count={counts[kind]} active={activeKind === kind} matterId={matterId} />)}
    </div>
  );
}

function NewTile({ kind, initialTemplates, count, active, matterId }: { kind: OfficeKind; initialTemplates: OfficeTemplateSummary[]; count: number; active: boolean; matterId: string | null }) {
  const router = useRouter();
  const meta = KIND_META[kind];
  const Icon = KIND_ICON[kind];
  const [templates, setTemplates] = React.useState(initialTemplates);
  const [loading, setLoading] = React.useState(false);
  const loadedRef = React.useRef(false);
  const loadTemplates = async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    try { const r = await fetch(`/api/office/templates?kind=${kind}`); if (r.ok) setTemplates(((await r.json()) as { templates: OfficeTemplateSummary[] }).templates); }
    catch { /* keep initial */ } finally { setLoading(false); }
  };
  const byCategory = React.useMemo(() => { const m = new Map<string, OfficeTemplateSummary[]>(); for (const t of templates) { if (!m.has(t.category)) m.set(t.category, []); m.get(t.category)!.push(t); } return Array.from(m.entries()); }, [templates]);
  return (
    <div className={cn("group relative flex flex-col rounded-xl border bg-card p-4 shadow-xs transition-all hover:border-foreground/20 hover:shadow-sm", active && "border-primary/50 ring-2 ring-primary/20")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", KIND_BG[kind], KIND_COLOR[kind])}><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><h3 className="text-sm font-semibold">New {meta.lower}</h3><span className="text-[11px] text-muted-foreground">{meta.app}</span></div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{meta.blurb}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" asChild className="flex-1"><Link href={newHref(kind, { matterId })}><FilePlus2 className="size-3.5" /> Blank</Link></Button>
        <DropdownMenu onOpenChange={(o) => { if (o) void loadTemplates(); }}>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="flex-1"><LayoutTemplate className="size-3.5" /> From template <ChevronDown className="size-3.5 opacity-60" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            {loading && templates.length === 0 && <DropdownMenuLabel>Loading templates…</DropdownMenuLabel>}
            {!loading && templates.length === 0 && <DropdownMenuLabel className="font-normal text-muted-foreground">No {meta.lower} templates yet. Start blank or import a file.</DropdownMenuLabel>}
            {byCategory.map(([category, list], i) => (
              <React.Fragment key={category}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{category}</DropdownMenuLabel>
                {list.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => router.push(newHref(kind, { templateId: t.id, matterId }))} className="flex-col items-start gap-0">
                    <span className="text-sm">{t.name}</span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">{t.description}</span>
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{count} {count === 1 ? meta.lower : meta.lowerPlural} · {templates.length} template{templates.length === 1 ? "" : "s"} · .{meta.ext}</div>
    </div>
  );
}
