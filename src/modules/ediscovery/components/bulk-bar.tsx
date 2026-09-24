"use client";
import * as React from "react";
import { CircleCheck, CircleX, ShieldAlert, Flame, Tags, UserRoundPlus, Download, X, ChevronDown, Layers, PackagePlus, Ungroup } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PRIVILEGE_BASES, type DocRow } from "../types";
import type { CodingDecision } from "@/lib/types/domain";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { issueColorClasses } from "./shared";
import { groupMemberIds } from "./review-helpers";
import { cn } from "@/lib/utils";

export interface BulkExtra { addIssues?: string[]; removeIssues?: string[]; reviewerId?: string }

/**
 * Selection toolbar. Every coding action goes through `onCode`, which shows the
 * confirmation summary (what changes, for how many, families) before applying.
 */
export function BulkBar({ hits, onCode, onCreateBatch, onCreateProduction }: { hits: DocRow[]; onCode: (patch: Partial<CodingDecision>, extra?: BulkExtra) => void; onCreateBatch: () => void; onCreateProduction: () => void }) {
  const { issueCodes, reviewers } = useReview();
  const selected = useReviewStore((s) => s.selected);
  const setSelected = useReviewStore((s) => s.setSelected);
  const groupBy = useReviewStore((s) => s.groupBy);
  const total = hits.length;
  if (!selected.length) return null;

  const exportSelected = () => {
    try {
      const sel = new Set(selected);
      const rows = hits.filter((h) => sel.has(h.id));
      const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = ["BegBates,EndBates,Date,Custodian,Type,Subject,From,Responsive,Privileged,Hot,Issues,SuggestedScore", ...rows.map((h) => [h.bates, h.batesEnd ?? h.bates, h.date, h.custodianName, h.type, h.subject, h.from ?? "", h.coding.responsive == null ? "" : h.coding.responsive ? "Y" : "N", h.coding.privileged ? "Y" : "", h.coding.hot ? "Y" : "", (h.coding.issues ?? []).join("; "), h.aiScore ?? ""].map(esc).join(","))].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `review-export-${rows.length}-docs.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${rows.length} rows`);
    } catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
  };

  const selectGroups = () => {
    const next = new Set(selected);
    for (const id of selected) for (const m of groupMemberIds(hits, id)) next.add(m);
    setSelected(Array.from(next));
  };

  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 border-b bg-primary/5 px-2 py-1 text-[11.5px]" role="toolbar" aria-label="Bulk actions">
      <span className="mr-1 font-medium tabular">{selected.length} of {total} selected</span>
      <Button size="xs" variant="outline" className="h-6" onClick={() => onCode({ responsive: true })}><CircleCheck className="size-3 text-success" /> Responsive</Button>
      <Button size="xs" variant="outline" className="h-6" onClick={() => onCode({ responsive: false })}><CircleX className="size-3" /> Non-responsive</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline" className="h-6"><ShieldAlert className="size-3 text-info" /> Privileged <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Basis</DropdownMenuLabel>
          {PRIVILEGE_BASES.map((b) => <DropdownMenuItem key={b.id} onClick={() => onCode({ privileged: true, privilegeBasis: b.id })}>{b.label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onCode({ privileged: false })}>Not privileged</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline" className="h-6"><Flame className="size-3 text-destructive" /> Hot <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onCode({ hot: true })}>Flag hot</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCode({ hot: false })}>Not hot</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline" className="h-6"><Tags className="size-3" /> Issues <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
          <DropdownMenuLabel>Add to selection</DropdownMenuLabel>
          {issueCodes.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => onCode({}, { addIssues: [c.code] })}>
              <span className={cn("mr-1 size-1.5 rounded-full", issueColorClasses(c.color).dot)} /><span className="font-mono text-[11px]">{c.code}</span><span className="ml-2 truncate text-muted-foreground">{c.label}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Remove from selection</DropdownMenuLabel>
          {issueCodes.map((c) => <DropdownMenuItem key={"rm" + c.id} onClick={() => onCode({}, { removeIssues: [c.code] })}><span className="font-mono text-[11px]">{c.code}</span><span className="ml-2 text-muted-foreground">remove</span></DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline" className="h-6"><UserRoundPlus className="size-3" /> Assign <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Assign reviewer</DropdownMenuLabel>
          {reviewers.map((r) => <DropdownMenuItem key={r.id} onClick={() => onCode({}, { reviewerId: r.id })}>{r.name}{r.title && <span className="ml-2 text-xs text-muted-foreground">{r.title}</span>}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      {groupBy !== "none" && <Button size="xs" variant="ghost" className="h-6" onClick={selectGroups} title="Add every member of the selected families / threads / clusters"><Ungroup className="size-3" /> Select groups</Button>}
      <Button size="xs" variant="ghost" className="h-6" onClick={onCreateBatch}><Layers className="size-3" /> Batch…</Button>
      <Button size="xs" variant="ghost" className="h-6" onClick={onCreateProduction}><PackagePlus className="size-3" /> Production…</Button>
      <Button size="xs" variant="ghost" className="h-6" onClick={exportSelected}><Download className="size-3" /> Export</Button>
      <div className="flex-1" />
      <Button size="xs" variant="ghost" className="h-6" onClick={() => setSelected([])}><X className="size-3" /> Clear</Button>
    </div>
  );
}
