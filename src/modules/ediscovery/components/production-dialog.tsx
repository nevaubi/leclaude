"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, SegmentedControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProductionSet } from "@/lib/types/domain";
import type { ProductionCreateInput, SavedSearchRecord } from "../types";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { api, useProductions, useSavedSearches } from "./use-review-data";
import { activeFacetCount } from "./rail-helpers";

type Source = "ready" | "selection" | "search" | "saved";

/**
 * Create a production set: freezes the production-ready documents (responsive, not
 * privileged, not exact duplicates) of the chosen source and assigns production
 * Bates numbers with the prefix, padding and (continuing) start number.
 */
export function ProductionDialog({ open, onOpenChange, onCreated, defaultSource }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (p: ProductionSet) => void; defaultSource?: Source }) {
  const { matterId, matter } = useReview();
  const selected = useReviewStore((s) => s.selected);
  const q = useReviewStore((s) => s.q);
  const view = useReviewStore((s) => s.view);
  const filters = useReviewStore((s) => s.filters);
  const saved = useSavedSearches(matterId);
  const productions = useProductions(matterId);
  const [source, setSource] = React.useState<Source>("ready");
  const [savedId, setSavedId] = React.useState("");
  const [name, setName] = React.useState("");
  const [prefix, setPrefix] = React.useState("");
  const [padding, setPadding] = React.useState("7");
  const [startNumber, setStartNumber] = React.useState("");
  const [volume, setVolume] = React.useState("");
  const [stamp, setStamp] = React.useState("CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const facetCount = activeFacetCount(filters);
  React.useEffect(() => {
    if (!open) return;
    const prev = productions.data?.productions?.[0];
    setSource(defaultSource ?? (selected.length ? "selection" : "ready"));
    setName(""); setSavedId(""); setStartNumber(""); setNotes("");
    setPrefix(prev?.prefix ?? (matter?.shortName ?? "PROD").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase());
    setPadding(String(prev?.padding ?? 7));
    setVolume(`VOL${String((productions.data?.productions?.length ?? 0) + 1).padStart(3, "0")}`);
    setStamp(prev?.stampText ?? "CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER");
  }, [open, defaultSource, selected.length, matter?.shortName, productions.data]);
  const submit = async () => {
    setBusy(true);
    try {
      const body: ProductionCreateInput = {
        matterId, name: name.trim(), prefix: prefix.trim(), padding: Number(padding) || 7, startNumber: Number(startNumber) > 0 ? Number(startNumber) : undefined, volume: volume.trim() || undefined, stampText: stamp, notes: notes.trim() || undefined,
        ...(source === "selection" ? { ids: selected } : source === "search" ? { q, view: view === "all" ? undefined : view, filters: facetCount ? filters : undefined } : source === "saved" ? { savedSearchId: savedId } : {}),
      };
      const r = await api<{ production: ProductionSet }>("/api/ediscovery/productions", { method: "POST", json: body });
      toast.success(`${r.production.name} created`, { description: `${r.production.docIds.length} documents · ${r.production.prefix} from ${r.production.bates[r.production.docIds[0]]?.begin ?? ""}` });
      onCreated(r.production);
      onOpenChange(false);
    } catch (e) { toast.error("Could not create the production", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const disabled = busy || !name.trim() || !prefix.trim() || (source === "selection" && !selected.length) || (source === "saved" && !savedId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>New production</DialogTitle><DialogDescription>Only production-ready documents are included: responsive, not privileged, not exact duplicates. Families are ordered together and Bates numbers are assigned per page.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Documents">
            <SegmentedControl size="xs" grow value={source} onChange={setSource} ariaLabel="Production source" options={[
              { value: "ready", label: "All production-ready" },
              { value: "selection", label: `Selection (${selected.length})`, disabled: !selected.length },
              { value: "search", label: "Current search" },
              { value: "saved", label: "Saved search" },
            ]} />
            {source === "saved" && (
              <Select value={savedId} onValueChange={setSavedId}><SelectTrigger size="sm" className="mt-1.5" aria-label="Saved search"><SelectValue placeholder="Pick a saved search" /></SelectTrigger><SelectContent>{(saved.data?.searches ?? []).map((s: SavedSearchRecord) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            )}
          </Field>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Name" required htmlFor="p-name"><Input id="p-name" size="sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Production 2 — rolling custodial" /></Field>
            <Field label="Volume" htmlFor="p-vol"><Input id="p-vol" size="sm" value={volume} onChange={(e) => setVolume(e.target.value)} className="font-mono" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Bates prefix" required htmlFor="p-prefix"><Input id="p-prefix" size="sm" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} className="font-mono uppercase" /></Field>
            <Field label="Padding" htmlFor="p-pad"><Input id="p-pad" size="sm" type="number" min={4} max={10} value={padding} onChange={(e) => setPadding(e.target.value)} className="tabular" /></Field>
            <Field label="Start number" help="blank continues the prefix" htmlFor="p-start"><Input id="p-start" size="sm" type="number" min={1} value={startNumber} onChange={(e) => setStartNumber(e.target.value)} placeholder="auto" className="tabular" /></Field>
          </div>
          <Field label="Confidentiality stamp" help="burned into the footer of every produced page (blank = none)" htmlFor="p-stamp"><Input id="p-stamp" size="sm" value={stamp} onChange={(e) => setStamp(e.target.value)} /></Field>
          <Field label="Notes" htmlFor="p-notes"><Textarea id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[48px] text-xs" placeholder="CMO, RFP set, rolling production number…" /></Field>
        </div>
        <DialogFooter><Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button><Button size="sm" onClick={() => void submit()} disabled={disabled}>{busy && <Loader2 className="size-3.5 animate-spin" />} Create draft</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
