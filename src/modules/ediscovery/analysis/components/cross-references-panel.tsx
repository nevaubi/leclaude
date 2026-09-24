"use client";
import * as React from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/misc";
import { formatPageLine, type CrossReference } from "../types";
import { CiteChip, ConfidenceText, ListSkeleton } from "./shared";
import { useCrossReferences } from "./use-analysis-data";

const KIND_LABEL: Record<CrossReference["kind"], string> = { bates: "Bates cited", exhibit: "Exhibit", subject: "Subject match", date: "Same date" };

/** Documents mentioned in the testimony, grouped per document with the page:line hits that reference them. */
export function CrossReferencesPanel({ depositionId, onOpenDocument, onJump }: { depositionId: string; onOpenDocument?: (docId: string) => void; onJump: (index: number) => void }) {
  const res = useCrossReferences(depositionId);
  const [min, setMin] = React.useState(0.5);
  if (res.loading && !res.data) return <ListSkeleton rows={5} />;
  const groups = (res.data?.groups ?? []).map((g) => ({ ...g, hits: g.hits.filter((h) => h.confidence >= min) })).filter((g) => g.hits.length);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[11px] text-muted-foreground">
        <span className="tabular">{groups.length} document{groups.length === 1 ? "" : "s"} · {groups.reduce((a, g) => a + g.hits.length, 0)} references</span>
        <span className="flex-1" />
        <label className="flex items-center gap-1">min <select value={min} onChange={(e) => setMin(Number(e.target.value))} className="h-5 rounded border bg-background px-1 text-[11px]" aria-label="Minimum confidence"><option value={0}>any</option><option value={0.5}>50%</option><option value={0.8}>80%</option><option value={0.95}>certain</option></select></label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {!groups.length ? <div className="p-3"><EmptyState icon={Link2} title="No documents referenced" description="References are found by Bates number, marked exhibit, distinctive subject words or a date the testimony names." compact /></div> : (
          <table className="w-full table-fixed text-[11.5px]">
            <thead className="grid-head sticky top-0 z-10 bg-background"><tr><th className="w-[104px] px-2 py-1 text-left">Document</th><th className="px-2 py-1 text-left">Subject</th><th className="w-[46px] px-1 py-1 text-right">Conf.</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  <tr className="border-t bg-muted/30">
                    <td className="px-2 py-1"><CiteChip cite={g.bates ?? "—"} kind="document" onClick={g.docId ? () => onOpenDocument?.(g.docId!) : undefined} /></td>
                    <td className="truncate px-2 py-1 font-medium" title={g.label}>{g.label}</td>
                    <td className="px-1 py-1 text-right"><ConfidenceText value={g.best} /></td>
                  </tr>
                  {g.hits.map((h, i) => (
                    <tr key={i} className={cn("row-compact border-t border-border/50 hover:bg-accent/40 cursor-pointer")} onClick={() => onJump(h.index)}>
                      <td className="px-2 font-mono text-[10.5px] text-muted-foreground">{formatPageLine(h.page, h.line)}</td>
                      <td className="truncate px-2 text-muted-foreground" title={h.match}>{KIND_LABEL[h.kind]} · {h.match}</td>
                      <td className="px-1 text-right"><ConfidenceText value={h.confidence} /></td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
