"use client";
import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/ui/form";
import type { Redaction, RedactionReason } from "@/lib/types/domain";
import type { RedactionInput } from "../types";
import { REDACTION_REASONS, defaultRedactionLabel } from "../redaction-pure";
import { api } from "./use-review-data";
import { formatDateTime } from "./shared";

export interface PendingRedaction { input: Omit<RedactionInput, "reason" | "label" | "note">; preview: string; anchor: { x: number; y: number } }

/**
 * "Redact this" popover: reason, label (defaults per reason) and a note; anchored
 * at the selection / drawn rectangle. Creates the redaction on confirm.
 */
export function NewRedactionPopover({ pending, onClose, onCreated }: { pending: PendingRedaction | null; onClose: () => void; onCreated: (r: Redaction) => void }) {
  const [reason, setReason] = React.useState<RedactionReason>("privilege");
  const [label, setLabel] = React.useState(defaultRedactionLabel("privilege"));
  const [note, setNote] = React.useState("");
  const [custom, setCustom] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (pending) { setReason("privilege"); setLabel(defaultRedactionLabel("privilege")); setNote(""); setCustom(false); } }, [pending]);
  const pickReason = (r: RedactionReason) => { setReason(r); if (!custom) setLabel(defaultRedactionLabel(r)); };
  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api<{ redaction: Redaction }>("/api/ediscovery/redactions", { method: "POST", json: { ...pending.input, reason, label: label.trim() || defaultRedactionLabel(reason), note: note.trim() || undefined } });
      onCreated(r.redaction);
      toast.success("Redaction added", { description: r.redaction.label, duration: 1600 });
    } catch (e) { toast.error("Could not add the redaction", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <Popover open={!!pending} onOpenChange={(v) => { if (!v) onClose(); }}>
      <PopoverAnchor asChild><span style={{ position: "absolute", left: pending?.anchor.x ?? 0, top: pending?.anchor.y ?? 0, width: 1, height: 1 }} aria-hidden /></PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-80 space-y-2 p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="text-[12px] font-medium">Redact {pending?.input.kind === "page" ? "this area" : "this text"}</div>
        {pending?.preview && <div className="max-h-16 overflow-hidden rounded border bg-muted/40 px-2 py-1 font-serif text-[11.5px] leading-snug text-muted-foreground">{pending.preview}</div>}
        <Field label="Reason"><Select value={reason} onValueChange={(v) => pickReason(v as RedactionReason)}><SelectTrigger size="sm" aria-label="Reason"><SelectValue /></SelectTrigger><SelectContent>{REDACTION_REASONS.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Label" help="burned into the box at production" htmlFor="rd-label"><Input id="rd-label" size="sm" value={label} onChange={(e) => { setLabel(e.target.value); setCustom(true); }} className="font-mono uppercase" /></Field>
        <Field label="Note" htmlFor="rd-note"><Textarea id="rd-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[40px] text-xs" placeholder="Why (protective order ¶, ESI protocol §)…" /></Field>
        <div className="flex justify-end gap-1.5"><Button variant="ghost" size="xs" onClick={onClose}>Cancel</Button><Button size="xs" onClick={() => void submit()} disabled={busy}>{busy && <Loader2 className="size-3 animate-spin" />} Redact</Button></div>
      </PopoverContent>
    </Popover>
  );
}

/** Details of a stored redaction with a remove action. */
export function RedactionPopover({ redaction, anchor, onClose, onRemoved }: { redaction: Redaction | null; anchor: { x: number; y: number } | null; onClose: () => void; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const remove = async () => {
    if (!redaction) return;
    setBusy(true);
    try { await api(`/api/ediscovery/redactions?id=${encodeURIComponent(redaction.id)}`, { method: "DELETE" }); onRemoved(redaction.id); toast.success("Redaction removed", { duration: 1400 }); }
    catch (e) { toast.error("Could not remove the redaction", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <Popover open={!!redaction} onOpenChange={(v) => { if (!v) onClose(); }}>
      <PopoverAnchor asChild><span style={{ position: "absolute", left: anchor?.x ?? 0, top: anchor?.y ?? 0, width: 1, height: 1 }} aria-hidden /></PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-72 space-y-1.5 p-3 text-[11.5px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        {redaction && (
          <>
            <div className="font-mono text-[11px] font-semibold">{redaction.label}</div>
            <div className="text-muted-foreground">{REDACTION_REASONS.find((r) => r.id === redaction.reason)?.label ?? redaction.reason} · {redaction.kind === "text" ? `characters ${redaction.start}–${redaction.end}` : `page ${redaction.page}`}</div>
            {redaction.quote && <div className="max-h-16 overflow-hidden rounded border bg-muted/40 px-2 py-1 font-serif leading-snug">{redaction.quote}</div>}
            {redaction.note && <div>{redaction.note}</div>}
            <div className="text-[10.5px] text-muted-foreground">Added {formatDateTime(redaction.createdAt)}</div>
            <div className="flex justify-end gap-1.5 pt-1"><Button variant="ghost" size="xs" onClick={onClose}>Close</Button><Button variant="outline" size="xs" onClick={() => void remove()} disabled={busy}>{busy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} Remove</Button></div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Black box for a text redaction inside the page (label visible on hover / title). */
export function RedactedSpan({ redaction, text, onClick }: { redaction: Redaction; text: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <span role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter") onClick(e as unknown as React.MouseEvent); }} title={`${redaction.label} — click for details`} data-redaction={redaction.id} className={cn("cursor-pointer rounded-[2px] bg-foreground text-foreground selection:bg-foreground selection:text-foreground hover:outline hover:outline-2 hover:outline-primary/60")} aria-label={`Redacted: ${redaction.label}`}>{text}</span>
  );
}
