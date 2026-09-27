"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import type { SavedSearchRecord } from "../types";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { api } from "./use-review-data";
import { SAVED_VIEWS } from "../types";
import { activeFacetCount } from "./rail-helpers";

/** Save the current query, view, facets, sort and semantic flag as a matter saved search (private or shared). */
export function SavedSearchDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: (s: SavedSearchRecord) => void }) {
  const { matterId } = useReview();
  const q = useReviewStore((s) => s.q);
  const view = useReviewStore((s) => s.view);
  const filters = useReviewStore((s) => s.filters);
  const semantic = useReviewStore((s) => s.semantic);
  const sort = useReviewStore((s) => s.sort);
  const dir = useReviewStore((s) => s.dir);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [shared, setShared] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setName(""); setDescription(""); setShared(true); } }, [open]);
  const facetCount = activeFacetCount(filters);
  const empty = !q.trim() && view === "all" && facetCount === 0;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ search: SavedSearchRecord }>("/api/ediscovery/saved-searches", { method: "POST", json: { matterId, name: name.trim(), description: description.trim() || undefined, q, view: view === "all" ? undefined : view, filters: facetCount ? filters : undefined, sort, dir, semantic, shared } });
      toast.success(`Saved “${r.search.name}”`, { description: shared ? "Shared with the matter team." : "Private to you." });
      onSaved(r.search);
      onOpenChange(false);
    } catch (e) { toast.error("Could not save the search", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Save search</DialogTitle><DialogDescription>Stores the query, the view and the active facets so anyone on the matter can re-run it.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11.5px]">
            <div className="font-mono">{q.trim() || <span className="text-muted-foreground">(no query)</span>}</div>
            <div className="mt-1 text-muted-foreground">View: {SAVED_VIEWS.find((v) => v.id === view)?.label} · {facetCount} facet filter{facetCount === 1 ? "" : "s"}{semantic ? " · semantic ranking" : ""}</div>
          </div>
          <Field label="Name" required htmlFor="ss-name"><Input id="ss-name" size="sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warranty negotiations" onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !empty) void submit(); }} /></Field>
          <Field label="Description" htmlFor="ss-desc"><Textarea id="ss-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[56px] text-xs" placeholder="What this search is for (RFP numbers, protocol section)…" /></Field>
          <label className="flex items-center justify-between text-[12px]"><span>Share with the matter team</span><Switch checked={shared} onCheckedChange={setShared} size="sm" /></label>
          {empty && <p className="text-[11.5px] text-destructive">Type a query, pick a view or set a facet first — an empty search cannot be saved.</p>}
        </div>
        <DialogFooter><Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button><Button size="sm" onClick={() => void submit()} disabled={busy || !name.trim() || empty}>{busy && <Loader2 className="size-3.5 animate-spin" />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
