"use client";
import * as React from "react";
import { CircleCheck, CircleX, ShieldAlert, Flame, Tags, UserRoundPlus, Download, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PRIVILEGE_BASES } from "../types";
import type { CodingDecision } from "@/lib/types/domain";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { issueColorClasses } from "./shared";
import { cn } from "@/lib/utils";

export function BulkBar({ total, onCode }: { total: number; onCode: (patch: Partial<CodingDecision>, extra?: { addIssues?: string[]; removeIssues?: string[]; reviewerId?: string }) => Promise<void> }) {
  const { issueCodes, reviewers, matterId } = useReview();
  const selected = useReviewStore((s) => s.selected);
  const setSelected = useReviewStore((s) => s.setSelected);
  if (!selected.length) return null;

  const exportSelected = async () => {
    try {
      const res = await fetch(`/api/ediscovery/search?matter=${encodeURIComponent(matterId)}&limit=500`);
      const data = (await res.json()) as { hits: { id: string; bates: string; batesEnd?: string; date: string; custodianName: string; type: string; subject: string; from?: string; coding: CodingDecision; aiScore?: number }[] };
      const rows = data.hits.filter((h) => selected.includes(h.id));
      const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = ["BegBates,EndBates,Date,Custodian,Type,Subject,From,Responsive,Privileged,Hot,Issues,AIScore", ...rows.map((h) => [h.bates, h.batesEnd ?? h.bates, h.date, h.custodianName, h.type, h.subject, h.from ?? "", h.coding.responsive == null ? "" : h.coding.responsive ? "Y" : "N", h.coding.privileged ? "Y" : "", h.coding.hot ? "Y" : "", (h.coding.issues ?? []).join("; "), h.aiScore ?? ""].map(esc).join(","))].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `review-export-${rows.length}-docs.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${rows.length} rows`);
    } catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-primary/5 px-3 py-1.5 text-xs animate-fade-in" role="toolbar" aria-label="Bulk actions">
      <span className="mr-1 font-medium tabular">{selected.length} of {total} selected</span>
      <Button size="xs" variant="outline" onClick={() => onCode({ responsive: true })}><CircleCheck className="size-3.5 text-success" /> Responsive</Button>
      <Button size="xs" variant="outline" onClick={() => onCode({ responsive: false })}><CircleX className="size-3.5" /> Non-responsive</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline"><ShieldAlert className="size-3.5 text-info" /> Privileged <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Basis</DropdownMenuLabel>
          {PRIVILEGE_BASES.map((b) => <DropdownMenuItem key={b.id} onClick={() => onCode({ privileged: true, privilegeBasis: b.id })}>{b.label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onCode({ privileged: false })}>Not privileged</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="xs" variant="outline" onClick={() => onCode({ hot: true })}><Flame className="size-3.5 text-destructive" /> Hot</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline"><Tags className="size-3.5" /> Issue tags <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
          <DropdownMenuLabel>Add to selection</DropdownMenuLabel>
          {issueCodes.map((c) => (
            <DropdownMenuCheckboxItem key={c.id} checked={false} onCheckedChange={() => onCode({}, { addIssues: [c.code] })}>
              <span className={cn("mr-2 size-1.5 rounded-full", issueColorClasses(c.color).dot)} /><span className="font-mono text-[11px]">{c.code}</span><span className="ml-2 text-muted-foreground">{c.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Remove from selection</DropdownMenuLabel>
          {issueCodes.map((c) => <DropdownMenuItem key={"rm" + c.id} onClick={() => onCode({}, { removeIssues: [c.code] })}><span className="font-mono text-[11px]">{c.code}</span><span className="ml-2 text-muted-foreground">remove</span></DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline"><UserRoundPlus className="size-3.5" /> Assign <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Assign reviewer</DropdownMenuLabel>
          {reviewers.map((r) => <DropdownMenuItem key={r.id} onClick={() => onCode({}, { reviewerId: r.id })}>{r.name}{r.title && <span className="ml-2 text-xs text-muted-foreground">{r.title}</span>}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="xs" variant="outline" onClick={exportSelected}><Download className="size-3.5" /> Export</Button>
      <div className="flex-1" />
      <Button size="xs" variant="ghost" onClick={() => setSelected([])}><X className="size-3.5" /> Clear</Button>
    </div>
  );
}
