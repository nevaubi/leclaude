"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { ValidatedDraft } from "../../schema";
import { WORKFLOW_CATEGORIES } from "../../registry";
import { apiJson, ApiError, type WorkflowMeta } from "../../hooks";
import { CategoryBadge, InlineAlert, NodeTypeIcon } from "../shared";

const EXAMPLES = [
  "When a new engagement letter is uploaded, extract client, scope and fee terms, check them against our standard terms, and open a task for the billing partner if anything deviates.",
  "Every Friday, pull the open tasks and upcoming deadlines for the Northgate matter, draft a short internal status note, and post it to the team.",
  "Take a deposition transcript, find every statement about the 2016 EHS memo, and build a chronology memo with page:line cites, then ask Jordan to approve before filing it.",
];

export function DescribeWorkflowDialog({ open, onOpenChange, meta, initialText }: { open: boolean; onOpenChange: (o: boolean) => void; meta: WorkflowMeta | null; initialText?: string }) {
  const router = useRouter();
  const [text, setText] = React.useState(initialText ?? "");
  const [category, setCategory] = React.useState<string>("");
  const [matterId, setMatterId] = React.useState<string>("");
  const [busy, setBusy] = React.useState<"generate" | "create" | null>(null);
  const [draft, setDraft] = React.useState<ValidatedDraft | null>(null);
  const [error, setError] = React.useState<{ message: string; code?: string } | null>(null);
  React.useEffect(() => { if (open && initialText) setText(initialText); }, [open, initialText]);

  const generate = async () => {
    setBusy("generate"); setError(null); setDraft(null);
    try {
      const res = await apiJson<{ draft: ValidatedDraft }>("/api/workflows/generate", { method: "POST", body: JSON.stringify({ description: text, category: category || undefined, matterId: matterId || undefined }) });
      setDraft(res.draft);
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, code: e.code } : { message: (e as Error).message });
    } finally { setBusy(null); }
  };

  const create = async () => {
    if (!draft) return;
    setBusy("create");
    try {
      const res = await apiJson<{ workflow: { id: string } }>("/api/workflows", { method: "POST", body: JSON.stringify({ name: draft.name, description: draft.description, category: draft.category, tags: draft.tags, inputs: draft.inputs, nodes: draft.nodes, edges: draft.edges, status: "draft" }) });
      toast.success("Draft workflow created");
      onOpenChange(false);
      router.push(`/workflows/${res.workflow.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create the workflow");
    } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="size-4 text-primary" /> Describe a workflow</DialogTitle>
          <DialogDescription>Say what should happen in plain English. The builder turns it into connected steps you can refine on the canvas.</DialogDescription>
        </DialogHeader>
        {meta && !meta.aiConfigured && <InlineAlert tone="warning" icon={KeyRound} title="OpenAI key required">The AI builder needs OPENAI_API_KEY in .env.local. You can still start from a template.</InlineAlert>}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="When a new NDA comes in, extract the parties and term, score the risk, draft an issues memo and assign the review…" className="text-sm" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim().length >= 8) void generate(); }} />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer line-clamp-1 max-w-full">{ex}</button>)}
        </div>
        <div className="flex items-center gap-2">
          <Select value={category || "auto"} onValueChange={(v) => setCategory(v === "auto" ? "" : v)}>
            <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">Category: auto</SelectItem>{WORKFLOW_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={matterId || "none"} onValueChange={(v) => setMatterId(v === "none" ? "" : v)}>
            <SelectTrigger size="sm" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Matter context: none</SelectItem>{(meta?.matters ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
          </Select>
          <Button className="ml-auto" size="sm" onClick={generate} disabled={busy !== null || text.trim().length < 8}>{busy === "generate" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate</Button>
        </div>
        {error && <InlineAlert tone={error.code === "no_api_key" ? "warning" : "destructive"} icon={error.code === "no_api_key" ? KeyRound : undefined} title={error.code === "no_api_key" ? "OpenAI key required" : "Could not generate"}>{error.message}</InlineAlert>}
        {draft && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{draft.name}</span>
              <CategoryBadge category={draft.category} />
              <span className="ml-auto text-[11px] text-muted-foreground">{draft.nodes.length} steps · {draft.inputs.length} inputs</span>
            </div>
            <p className="text-xs text-muted-foreground">{draft.description}</p>
            <ol className="flex flex-wrap items-center gap-1">
              {draft.nodes.map((n, i) => (
                <li key={n.id} className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-1 text-[11px]"><NodeTypeIcon type={n.type} size="xs" />{n.label}{i < draft.nodes.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}</li>
              ))}
            </ol>
            {draft.inputs.length > 0 && <div className="flex flex-wrap gap-1">{draft.inputs.map((i) => <Badge key={i.key} variant="outline" className="font-mono">{i.key}{i.required ? "*" : ""}</Badge>)}</div>}
            {draft.notes.length > 0 && <ul className="list-disc pl-4 text-[11px] text-muted-foreground">{draft.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {draft.issues.length > 0 && <div className="text-[11px] text-warning-foreground dark:text-warning">{draft.issues.length} thing(s) to configure in the builder: {draft.issues.slice(0, 3).map((i) => i.message).join("; ")}</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={!draft || busy !== null}>{busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Open in builder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
