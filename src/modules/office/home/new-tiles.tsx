"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { OfficeKind } from "@/lib/types/domain";
import { OfficeAppIcon } from "../shared/office-app-icon";
import { KIND_META, OFFICE_KINDS, type OfficeTemplateSummary } from "./types";

export function newHref(kind: OfficeKind, opts: { templateId?: string; matterId?: string | null } = {}) {
  const sp = new URLSearchParams();
  if (opts.templateId) sp.set("template", opts.templateId);
  if (opts.matterId) sp.set("matter", opts.matterId);
  const qs = sp.toString();
  return `/office/${kind}/new${qs ? `?${qs}` : ""}`;
}

/** Compact "New" row: Document · Workbook · Deck · PDF, each with Blank and a template menu (fed by /api/office/templates?kind=). */
export function NewTiles({ templates, activeKind, matterId }: { templates: OfficeTemplateSummary[]; activeKind: OfficeKind | null; matterId: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-y border-line-quiet py-3 lg:grid-cols-4" role="group" aria-label="New">
      {OFFICE_KINDS.map((kind) => <NewItem key={kind} kind={kind} initialTemplates={templates.filter((t) => t.kind === kind)} active={activeKind === kind} matterId={matterId} />)}
    </div>
  );
}

function NewItem({ kind, initialTemplates, active, matterId }: { kind: OfficeKind; initialTemplates: OfficeTemplateSummary[]; active: boolean; matterId: string | null }) {
  const router = useRouter();
  const meta = KIND_META[kind];
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
    <div className="flex min-w-0 items-center gap-2" data-kind={kind}>
      <OfficeAppIcon kind={kind} size={22} />
      <span className={cn("min-w-0 truncate text-[13px] font-medium", active && "text-primary")}>{meta.label}</span>
      <span className="ml-auto flex shrink-0 items-center">
        <Tip label={`New blank ${meta.lower}`} shortcut={active ? "N" : undefined}><Button size="xs" variant="ghost" asChild><Link href={newHref(kind, { matterId })} aria-label={`New blank ${meta.lower}`}>Blank</Link></Button></Tip>
        <DropdownMenu onOpenChange={(o) => { if (o) void loadTemplates(); }}>
          <DropdownMenuTrigger asChild><Button size="xs" variant="ghost" className="text-muted-foreground hover:text-foreground" aria-label={`New ${meta.lower} from a template`}>Template <ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 max-h-[60vh]">
            {loading && templates.length === 0 && <DropdownMenuLabel>Loading templates…</DropdownMenuLabel>}
            {!loading && templates.length === 0 && <DropdownMenuLabel className="font-normal text-muted-foreground">No {meta.lower} templates yet. Start blank or import a file.</DropdownMenuLabel>}
            {byCategory.map(([category, list], i) => (
              <React.Fragment key={category}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{category}</DropdownMenuLabel>
                {list.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => router.push(newHref(kind, { templateId: t.id, matterId }))} className="flex-col items-start gap-0">
                    <span className="text-[13px]">{t.name}</span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">{t.description}</span>
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}
