"use client";
import * as React from "react";
import { Loader2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { renderMermaidToSvg } from "./client-utils";

export interface PromptRequest { title: string; description?: string; label?: string; placeholder?: string; defaultValue?: string; multiline?: boolean; confirm?: string; secondary?: { label: string; placeholder?: string; defaultValue?: string } }

/** Small reusable prompt dialog (link URL, footnote text, checkpoint name…). */
export function PromptDialog({ request, onSubmit, onCancel }: { request: PromptRequest | null; onSubmit: (value: string, secondary?: string) => void; onCancel: () => void }) {
  const [value, setValue] = React.useState("");
  const [secondary, setSecondary] = React.useState("");
  React.useEffect(() => { setValue(request?.defaultValue ?? ""); setSecondary(request?.secondary?.defaultValue ?? ""); }, [request]);
  const submit = () => { if (!value.trim() && !request?.secondary) return; onSubmit(value.trim(), secondary.trim() || undefined); };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>{request?.title}</DialogTitle>{request?.description && <DialogDescription>{request.description}</DialogDescription>}</DialogHeader>
        <div className="space-y-3">
          {request?.secondary && (
            <div className="space-y-1"><Label className="text-xs">{request.secondary.label}</Label><Input autoFocus value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder={request.secondary.placeholder} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} /></div>
          )}
          <div className="space-y-1">
            {request?.label && <Label className="text-xs">{request.label}</Label>}
            {request?.multiline ? <Textarea autoFocus={!request.secondary} value={value} onChange={(e) => setValue(e.target.value)} placeholder={request.placeholder} className="min-h-[96px]" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} /> : <Input autoFocus={!request?.secondary} value={value} onChange={(e) => setValue(e.target.value)} placeholder={request?.placeholder} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />}
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button onClick={submit}>{request?.confirm ?? "OK"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EXAMPLES: { label: string; source: string }[] = [
  { label: "Procedural timeline", source: `timeline\n    title Procedural history\n    2026-01-20 : Complaint filed\n    2026-03-04 : Answer and counterclaim\n    2026-06-15 : Close of fact discovery\n    2026-09-09 : MSJ filed\n    2026-10-09 : Opposition due` },
  { label: "Corporate structure", source: `flowchart TB\n    P[Parent Holdings, Inc.] --> S1[Meridian Fluorochem Corp.]\n    P --> S2[Meridian Specialty Chemicals LLC]\n    S1 --> J[Joint venture 49%]\n    S2 --> D[Distribution sub]` },
  { label: "Exposure pathway", source: `flowchart LR\n    A[AFFF training use] --> B[Soil infiltration]\n    B --> C[Groundwater plume]\n    C --> D[Municipal wells]\n    D --> E[Distribution system]\n    E --> F[Plaintiff residences]` },
  { label: "Deal steps", source: `sequenceDiagram\n    participant B as Buyer\n    participant S as Seller\n    participant E as Escrow\n    B->>S: Signing (SPA)\n    B->>E: Deposit\n    S-->>B: Consents & disclosures\n    B->>S: Closing payment\n    E-->>S: Release escrow (18 mo)` },
];

export function DiagramDialog({ open, onOpenChange, onInsert, initial }: { open: boolean; onOpenChange: (v: boolean) => void; onInsert: (source: string, caption: string) => Promise<void>; initial?: string }) {
  const [source, setSource] = React.useState(initial ?? EXAMPLES[0].source);
  const [caption, setCaption] = React.useState("");
  const [svg, setSvg] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) setSource(initial ?? EXAMPLES[0].source); }, [open, initial]);
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { renderMermaidToSvg(source).then((s) => { setSvg(s); setError(null); }).catch((e: Error) => setError(e.message.split("\n")[0])); }, 350);
    return () => clearTimeout(t);
  }, [source, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Workflow className="size-4" /> Insert diagram</DialogTitle><DialogDescription>Write Mermaid (flowchart, timeline, sequence, gantt, mindmap). It is rendered to an image and inserted at the cursor; the source is kept for later edits.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">{EXAMPLES.map((e) => <Button key={e.label} size="xs" variant="outline" onClick={() => setSource(e.source)}>{e.label}</Button>)}</div>
            <Textarea value={source} onChange={(e) => setSource(e.target.value)} className="min-h-[300px] font-mono text-xs" spellCheck={false} />
            <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional), e.g. Figure 1 — Exposure pathway" className="text-xs" />
          </div>
          <div className="mermaid-preview flex min-h-[300px] items-center justify-center overflow-auto rounded-lg border bg-paper p-3">
            {error ? <div className="text-xs text-destructive">{error}</div> : svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || Boolean(error) || !svg} onClick={async () => { setBusy(true); try { await onInsert(source, caption); onOpenChange(false); } finally { setBusy(false); } }}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Insert diagram</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
