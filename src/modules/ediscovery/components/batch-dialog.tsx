"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, SegmentedControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReviewBatch } from "@/lib/types/domain";
import type { BatchCreateInput, ReviewBatchSummary, SavedSearchRecord } from "../types";
import { BATCH_PRIORITIES } from "../batch-pure";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { api, useSavedSearches } from "./use-review-data";
import { activeFacetCount } from "./rail-helpers";

type Source = "selection" | "search" | "saved" | "uncoded";

/**
 * Create review batches from the current selection, the current search, a saved
 * search or every uncoded document; optionally split by size, assign, prioritise,
 * set a due date, a QC sample and the second-pass flag.
 */
export function BatchDialog({ open, onOpenChange, onCreated, defaultSource }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (batches: ReviewBatch[]) => void; defaultSource?: Source }) {
  const { matterId, reviewers, currentUserId } = useReview();
  const selected = useReviewStore((s) => s.selected);
  const q = useReviewStore((s) => s.q);
  const view = useReviewStore((s) => s.view);
  const filters = useReviewStore((s) => s.filters);
  const saved = useSavedSearches(matterId);
  const [source, setSource] = React.useState<Source>("selection");
  const [savedId, setSavedId] = React.useState<string>("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [size, setSize] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState<string>(currentUserId);
  const [priority, setPriority] = React.useState<ReviewBatch["priority"]>("normal");
  const [dueAt, setDueAt] = React.useState("");
  const [qc, setQc] = React.useState("10");
  const [secondPass, setSecondPass] = React.useState(false);
  const [uncodedOnly, setUncodedOnly] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setSource(defaultSource ?? (selected.length ? "selection" : q.trim() || view !== "all" || activeFacetCount(filters) ? "search" : "uncoded"));
    setName(""); setDescription(""); setSize(""); setAssigneeId(currentUserId); setPriority("normal"); setDueAt(""); setQc("10"); setSecondPass(false); setUncodedOnly(true); setSavedId("");
  }, [open, defaultSource, selected.length, q, view, filters, currentUserId]);
  const facetCount = activeFacetCount(filters);
  const searchLabel = `${q.trim() ? `“${q.trim()}”` : "no query"} · view ${view} · ${facetCount} facet${facetCount === 1 ? "" : "s"}`;
  const submit = async () => {
    setBusy(true);
    try {
      const body: BatchCreateInput = {
        matterId, name: name.trim(), description: description.trim() || undefined, assigneeId: assigneeId || undefined, priority, dueAt: dueAt || undefined,
        qcSamplePercent: Math.max(0, Math.min(100, Number(qc) || 0)), secondPass, size: Number(size) > 0 ? Number(size) : undefined, uncodedOnly: source === "selection" ? false : uncodedOnly,
        ...(source === "selection" ? { ids: selected } : source === "search" ? { q, view: view === "all" ? undefined : view, filters: facetCount ? filters : undefined } : source === "saved" ? { savedSearchId: savedId } : { view: "needs_review" as const }),
      };
      const r = await api<{ batches: ReviewBatch[] }>("/api/ediscovery/batches", { method: "POST", json: body });
      toast.success(`${r.batches.length === 1 ? "Batch" : `${r.batches.length} batches`} created`, { description: `${r.batches.reduce((n, b) => n + b.docIds.length, 0)} documents` });
      onCreated(r.batches);
      onOpenChange(false);
    } catch (e) { toast.error("Could not create the batch", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const disabled = busy || !name.trim() || (source === "selection" && !selected.length) || (source === "saved" && !savedId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>New review batch</DialogTitle><DialogDescription>A batch freezes a document set and assigns it; progress, QC sampling and disagreements are tracked per batch.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Documents">
            <SegmentedControl size="xs" grow value={source} onChange={setSource} ariaLabel="Batch source" options={[
              { value: "selection", label: `Selection (${selected.length})`, disabled: !selected.length },
              { value: "search", label: "Current search" },
              { value: "saved", label: "Saved search" },
              { value: "uncoded", label: "All uncoded" },
            ]} />
            <div className="mt-1 text-[11px] text-muted-foreground">{source === "search" ? searchLabel : source === "uncoded" ? "Every document without a responsiveness decision." : source === "selection" ? "The rows selected in the grid, coded or not." : "Documents matching a saved search."}</div>
            {source === "saved" && (
              <Select value={savedId} onValueChange={setSavedId}><SelectTrigger size="sm" className="mt-1.5" aria-label="Saved search"><SelectValue placeholder="Pick a saved search" /></SelectTrigger><SelectContent>{(saved.data?.searches ?? []).map((s: SavedSearchRecord) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            )}
          </Field>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Name" required htmlFor="b-name"><Input id="b-name" size="sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First pass — Voss custodial" /></Field>
            <Field label="Split every" help="documents per batch (blank = one batch)" htmlFor="b-size"><Input id="b-size" size="sm" type="number" min={1} value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 50" className="tabular" /></Field>
          </div>
          <Field label="Instructions" htmlFor="b-desc"><Textarea id="b-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[52px] text-xs" placeholder="Protocol section, what to look for, escalation rule…" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Assignee"><Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger size="sm" aria-label="Assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger><SelectContent>{reviewers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Priority"><Select value={priority} onValueChange={(v) => setPriority(v as ReviewBatch["priority"])}><SelectTrigger size="sm" aria-label="Priority"><SelectValue /></SelectTrigger><SelectContent>{BATCH_PRIORITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Due" htmlFor="b-due"><Input id="b-due" size="sm" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="tabular" /></Field>
          </div>
          <div className="grid grid-cols-3 items-end gap-3">
            <Field label="QC sample %" help="re-read by a second reviewer" htmlFor="b-qc"><Input id="b-qc" size="sm" type="number" min={0} max={100} value={qc} onChange={(e) => setQc(e.target.value)} className="tabular" /></Field>
            <label className="flex h-7 items-center justify-between gap-2 text-[12px]"><span>Second pass</span><Switch checked={secondPass} onCheckedChange={setSecondPass} size="sm" /></label>
            {source !== "selection" && <label className="flex h-7 items-center justify-between gap-2 text-[12px]"><span>Uncoded only</span><Switch checked={uncodedOnly} onCheckedChange={setUncodedOnly} size="sm" /></label>}
          </div>
        </div>
        <DialogFooter><Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button><Button size="sm" onClick={() => void submit()} disabled={disabled}>{busy && <Loader2 className="size-3.5 animate-spin" />} Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { ReviewBatchSummary };
