"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyValueList } from "@/components/ui/form";
import type { BulkCodingRequest, BulkPreview } from "../types";
import { bulkCodeRequest } from "./use-review-data";

/**
 * Batch-coding confirmation: the server computes the exact effect (dry run) —
 * how many documents change per field, how many already carry the value, how
 * many responsiveness calls would be overwritten and how many family members
 * the "include families" option pulls in — and the reviewer confirms.
 */
export function BulkConfirmDialog({ request, onClose, onApplied }: { request: BulkCodingRequest | null; onClose: () => void; onApplied: (ids: string[], request: BulkCodingRequest) => void }) {
  const [families, setFamilies] = React.useState(false);
  const [preview, setPreview] = React.useState<BulkPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setFamilies(false); setPreview(null); setError(null); }, [request]);
  React.useEffect(() => {
    if (!request) return;
    let alive = true;
    setPreview(null);
    bulkCodeRequest({ ...request, includeFamilies: families, dryRun: true }).then((r) => { if (alive) setPreview(r.preview); }).catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [request, families]);
  const apply = async () => {
    if (!request || !preview) return;
    setBusy(true);
    try {
      await bulkCodeRequest({ ...request, includeFamilies: families });
      onApplied(preview.ids, { ...request, includeFamilies: families });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const title = React.useMemo(() => {
    if (!request) return "";
    const p = request.patch ?? {};
    if (p.responsive === true) return "Code responsive";
    if (p.responsive === false) return "Code non-responsive";
    if (p.privileged === true) return `Code privileged (${p.privilegeBasis ?? "attorney-client"})`;
    if (p.privileged === false) return "Clear privilege";
    if (p.hot === true) return "Flag hot";
    if (p.hot === false) return "Clear hot";
    if (request.addIssues?.length) return `Add ${request.addIssues.join(", ")}`;
    if (request.removeIssues?.length) return `Remove ${request.removeIssues.join(", ")}`;
    if (request.reviewerId) return "Assign reviewer";
    return "Apply coding";
  }, [request]);
  const items = preview ? [
    { label: "Documents", value: <span className="tabular">{preview.total.toLocaleString()}{preview.addedFamily ? <span className="text-muted-foreground"> (incl. {preview.addedFamily} family member{preview.addedFamily === 1 ? "" : "s"})</span> : null}</span> },
    ...preview.fields.map((f) => ({ label: f.label, value: <span className="tabular">→ {f.to} · {f.changed.toLocaleString()} change{f.changed === 1 ? "" : "s"}</span> })),
    { label: "Already as requested", value: <span className="tabular">{preview.unchanged.toLocaleString()}</span>, muted: true },
    ...(preview.overwrites ? [{ label: "Overwrites a prior call", value: <span className="tabular text-warning-foreground dark:text-warning">{preview.overwrites.toLocaleString()} document{preview.overwrites === 1 ? "" : "s"} already coded the other way</span> }] : []),
  ] : [];
  return (
    <Dialog open={!!request} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Applied to every selected document in one audited change. Nothing is written until you confirm.</DialogDescription></DialogHeader>
        {error ? <p className="text-[12px] text-destructive">{error}</p> : !preview ? <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Computing the effect…</div> : <KeyValueList items={items} labelWidth={170} dense />}
        <label className="flex cursor-pointer items-center gap-2 text-[12px]"><Checkbox size="sm" checked={families} onCheckedChange={(v) => setFamilies(!!v)} /> Include family members (parents and attachments) so families travel together</label>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => void apply()} disabled={!preview || busy || preview.total === 0}>{busy && <Loader2 className="size-3.5 animate-spin" />} Apply to {preview?.total ?? "…"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
