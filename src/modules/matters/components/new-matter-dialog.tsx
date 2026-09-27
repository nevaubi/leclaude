"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TeamMember } from "@/modules/workspace/roles";
import type { MatterRow } from "../types";
import { apiJSON, ApiError, loadTeam } from "./api";
import { draftToInput, emptyDraft, MatterFields, validateDraft, type DraftErrors, type MatterDraft } from "./matter-form";

export interface NewMatterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the matter exists (before the next-steps view is shown). */
  onCreated?: (matter: MatterRow) => void;
}

/**
 * Create a matter. Other modules can open it wherever a matter is missing:
 *
 *   <NewMatterDialog open={open} onOpenChange={setOpen} onCreated={(m) => select(m.id)} />
 *
 * After creation the dialog offers the next steps (upload documents, open the workspace) as quiet links.
 */
export function NewMatterDialog({ open, onOpenChange, onCreated }: NewMatterDialogProps) {
  const [draft, setDraft] = React.useState<MatterDraft>(emptyDraft);
  const [errors, setErrors] = React.useState<DraftErrors>({});
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [team, setTeam] = React.useState<TeamMember[] | null>(null);
  const [created, setCreated] = React.useState<MatterRow | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft());
    setErrors({});
    setTouched(false);
    setCreated(null);
    const ac = new AbortController();
    setTeam(null);
    loadTeam(ac.signal).then(setTeam).catch((e) => { if ((e as Error).name !== "AbortError") setTeam([]); });
    return () => ac.abort();
  }, [open]);

  const shown: DraftErrors = { ...(touched ? validateDraft(draft) : {}), ...errors };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (Object.keys(validateDraft(draft)).length) return;
    setBusy(true);
    setErrors({});
    try {
      const r = await apiJSON<{ matter: MatterRow }>("/api/matters", { json: draftToInput(draft) });
      setCreated(r.matter);
      onCreated?.(r.matter);
      toast.success(`Created ${r.matter.shortName}`);
    } catch (err) {
      const a = err as ApiError;
      setErrors({ ...(a.fields ?? {}), form: a.fields ? undefined : a.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.shortName} is ready</DialogTitle>
              <DialogDescription>The matter is empty. Add evidence or open its workspace.</DialogDescription>
            </DialogHeader>
            <nav className="divide-y rounded-md border" aria-label="Next steps">
              <NextStep href={`/ediscovery?matter=${encodeURIComponent(created.id)}`} label="Upload documents" hint="Add productions, emails and transcripts for review" onNavigate={() => onOpenChange(false)} />
              <NextStep href={`/?matter=${encodeURIComponent(created.id)}`} label="Open workspace" hint="Tasks, calendar and updates scoped to this matter" onNavigate={() => onOpenChange(false)} />
            </nav>
            <DialogFooter><Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>New matter</DialogTitle>
              <DialogDescription>Only the name and practice area are required; everything else can be filled in later.</DialogDescription>
            </DialogHeader>
            <div className="py-3">
              <MatterFields draft={draft} onChange={setDraft} errors={shown} team={team} idPrefix="new-matter" />
              {shown.form && <p className="mt-3 text-[12px] text-destructive" role="alert">{shown.form}</p>}
            </div>
            <DialogFooter>
              <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} Create matter</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NextStep({ href, label, hint, onNavigate }: { href: string; label: string; hint: string; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} className="group flex items-center gap-3 px-3 py-2.5 text-[12.5px] hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{label}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{hint}</span>
      </span>
      <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
