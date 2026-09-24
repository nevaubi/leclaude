"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import type { OfficeKind } from "@/lib/types/domain";
import { KIND_META, type OfficeTemplateSummary } from "./types";
import { KIND_BG, KIND_COLOR, KIND_ICON, newHref } from "./new-tiles";

/** Quiet template gallery grouped by category, filtered by the active kind and the search box. */
export function TemplatesSection({ templates, kind, matterId, query }: { templates: OfficeTemplateSummary[]; kind: OfficeKind | null; matterId: string | null; query: string }) {
  const q = query.trim().toLowerCase();
  const visible = templates.filter((t) => (!kind || t.kind === kind) && (!q || `${t.name} ${t.description} ${t.category} ${(t.tags ?? []).join(" ")}`.toLowerCase().includes(q)));
  const groups = React.useMemo(() => { const m = new Map<string, OfficeTemplateSummary[]>(); for (const t of visible) { if (!m.has(t.category)) m.set(t.category, []); m.get(t.category)!.push(t); } return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length); }, [visible]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  if (!visible.length) return <EmptyState compact icon={LayoutTemplate} title={kind ? `No ${KIND_META[kind].lower} templates yet` : "No templates match"} description={kind ? "Templates for this editor are added by Knowledge Management. Start from a blank file or import one." : "Try a different search."} />;
  return (
    <div className="space-y-5">
      {groups.map(([category, list]) => {
        const open = expanded.has(category);
        const shown = open ? list : list.slice(0, 4);
        return (
          <div key={category}>
            <div className="mb-2 flex items-baseline gap-2"><h3 className="text-[13px] font-semibold">{category}</h3><span className="text-[11px] tabular text-muted-foreground">{list.length}</span></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {shown.map((t) => <TemplateCard key={t.id} t={t} matterId={matterId} />)}
            </div>
            {list.length > 4 && <Button variant="link" size="xs" className="mt-1 px-0 text-muted-foreground" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(category)) n.delete(category); else n.add(category); return n; })}>{open ? "Show fewer" : `Show all ${list.length}`}</Button>}
          </div>
        );
      })}
    </div>
  );
}

function TemplateCard({ t, matterId }: { t: OfficeTemplateSummary; matterId: string | null }) {
  const Icon = KIND_ICON[t.kind];
  return (
    <Link href={newHref(t.kind, { templateId: t.id, matterId })} className="group flex gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", KIND_BG[t.kind], KIND_COLOR[t.kind])}><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5"><div className="truncate text-[13px] font-medium">{t.name}</div><ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /></div>
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{t.description}</p>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[10.5px] text-muted-foreground">
          <span>{KIND_META[t.kind].label}</span>
          {t.practiceArea && <><span aria-hidden>·</span><span>{t.practiceArea}</span></>}
        </div>
      </div>
    </Link>
  );
}
