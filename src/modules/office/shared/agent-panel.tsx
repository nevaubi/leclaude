"use client";
import * as React from "react";
import { Sparkles, Undo2, PenLine, ScanSearch, MessageCircleQuestion, Check, X, Globe, ChevronDown, Loader2, AlertTriangle, Crosshair, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Composer } from "@/components/ai/composer";
import { MessageList, SuggestionChips } from "@/components/ai/chat";
import { useAgent, type AgentAttachment, type AgentMessage } from "@/hooks/use-agent";
import type { AgentEvent } from "@/lib/ai/agent";
import type { EditProposal, OfficeAgentMode, OfficeAgentSuggestions, OfficeScope, ReviewFinding } from "./types";

export interface ApplyResult { applied: string[]; failed: { id: string; error: string }[] }

export interface OfficeAgentPanelProps {
  endpoint: string;
  docId?: string;
  docTitle: string;
  matterId?: string | null;
  /** Live snapshot of the editor's document model (paragraph ids, cells, slides…). */
  getSnapshot: () => unknown;
  /** Scopes available right now: first must be the whole document. Recomputed by the editor on selection change. */
  scopes: OfficeScope[];
  /** Apply proposals to the editor (as tracked changes where supported). */
  applyProposals: (proposals: EditProposal[]) => Promise<ApplyResult>;
  onUndo?: () => void;
  /** Scroll/select a target (paragraph id, cell ref, slide id, page). */
  onLocate?: (target: string) => void;
  suggestions: OfficeAgentSuggestions;
  /** Editor-specific extras merged into the request (selection text, active sheet…). */
  extraContext?: () => Record<string, unknown>;
  /** Called after proposals are applied, with a one-line summary (for version history). */
  onApplied?: (summary: string, proposals: EditProposal[]) => void;
  className?: string;
  defaultMode?: OfficeAgentMode;
  title?: string;
}

const MODES: { id: OfficeAgentMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "draft", label: "Draft", icon: PenLine },
  { id: "review", label: "Review", icon: ScanSearch },
  { id: "ask", label: "Ask", icon: MessageCircleQuestion },
];

const SEVERITY_VARIANT: Record<ReviewFinding["severity"], "muted" | "info" | "warning" | "destructive"> = { info: "muted", low: "info", medium: "warning", high: "destructive", critical: "destructive" };

export function OfficeAgentPanel(props: OfficeAgentPanelProps) {
  const { endpoint, docId, docTitle, matterId, getSnapshot, scopes, applyProposals, onUndo, onLocate, suggestions, extraContext, onApplied, className, defaultMode = "draft", title = "Drafting assistant" } = props;
  const [mode, setMode] = React.useState<OfficeAgentMode>(defaultMode);
  const [scopeId, setScopeId] = React.useState<string>(scopes[0]?.id ?? "document");
  const [research, setResearch] = React.useState(false);
  const [autoApply, setAutoApply] = React.useState(false);
  const [proposals, setProposals] = React.useState<EditProposal[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [findings, setFindings] = React.useState<ReviewFinding[]>([]);
  const [applying, setApplying] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0] ?? null;
  const autoApplyRef = React.useRef(autoApply);
  autoApplyRef.current = autoApply;
  const applyRef = React.useRef(applyProposals);
  applyRef.current = applyProposals;

  React.useEffect(() => { if (!scopes.some((s) => s.id === scopeId)) setScopeId(scopes[0]?.id ?? "document"); }, [scopes, scopeId]);

  const onEvent = React.useCallback((ev: AgentEvent) => {
    if (ev.type === "proposal") {
      const p = ev.proposal as EditProposal;
      setProposals((ps) => [...ps, p]);
      setSelected((s) => new Set(s).add(p.id));
      if (autoApplyRef.current) {
        void applyRef.current([p]).then((r) => {
          setProposals((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: r.applied.includes(p.id) ? "applied" : "failed", error: r.failed.find((f) => f.id === p.id)?.error } : x)));
        });
      }
    } else if (ev.type === "artifact" && ev.artifact.kind === "review-finding") {
      setFindings((fs) => [...fs, ev.artifact.data as ReviewFinding]);
    }
  }, []);

  const agent = useAgent({
    endpoint,
    extra: () => ({ mode, scope, research, snapshot: getSnapshot(), docId, docTitle, matterId: matterId ?? null, context: extraContext?.() ?? {} }),
    onEvent,
    onDone: (m) => {
      if (autoApplyRef.current) { const n = proposalsRef.current.filter((p) => p.status === "applied").length; if (n) onApplied?.(summarize(m, proposalsRef.current), proposalsRef.current); }
    },
  });
  const proposalsRef = React.useRef(proposals);
  proposalsRef.current = proposals;

  const send = (text: string, attachments: AgentAttachment[]) => {
    // A new request starts a fresh proposal batch; pending ones from before are discarded to avoid stale targets.
    setProposals((ps) => ps.filter((p) => p.status === "applied"));
    setFindings([]);
    void agent.send(text, { attachments });
  };

  const pending = proposals.filter((p) => p.status === "pending");
  const applied = proposals.filter((p) => p.status === "applied");

  const apply = async (ids: string[]) => {
    const batch = pending.filter((p) => ids.includes(p.id));
    if (!batch.length) return;
    setApplying(true);
    try {
      const r = await applyProposals(batch);
      setProposals((ps) => ps.map((p) => (r.applied.includes(p.id) ? { ...p, status: "applied" } : r.failed.some((f) => f.id === p.id) ? { ...p, status: "failed", error: r.failed.find((f) => f.id === p.id)?.error } : p)));
      if (r.failed.length) toast.error(`${r.failed.length} edit${r.failed.length === 1 ? "" : "s"} could not be applied`, { description: r.failed[0]?.error });
      if (r.applied.length) {
        const last = agent.messages.filter((m) => m.role === "assistant").at(-1);
        onApplied?.(summarize(last, batch.filter((p) => r.applied.includes(p.id))), batch);
        toast.success(`Applied ${r.applied.length} edit${r.applied.length === 1 ? "" : "s"} as tracked changes`);
      }
    } finally { setApplying(false); }
  };

  const discard = (ids?: string[]) => setProposals((ps) => ps.map((p) => (p.status === "pending" && (!ids || ids.includes(p.id)) ? { ...p, status: "discarded" } : p)));

  const emptyState = (
    <div className="px-3 pt-4">
      <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        {mode === "draft" && <>Ask me to draft, rewrite, restructure, format, cite, or polish. I read the whole document, propose edits you can preview, and apply them as tracked changes. Drop in a screenshot to transcribe it, or dictate with the mic.</>}
        {mode === "review" && <>I&apos;ll read the document and flag citation, defined-term, cross-reference, numbering, risk and style issues, with one-click fixes where safe.</>}
        {mode === "ask" && <>Ask questions about this document, the matter, or the law. Turn on Research for web, case law, statutes and dockets.</>}
      </div>
      <SuggestionChips suggestions={suggestions[mode] ?? []} onPick={(s) => send(s, [])} />
    </div>
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="size-4 text-primary" />
        <div className="flex-1 truncate text-sm font-semibold">{title}</div>
        {onUndo && <Tip label="Undo last edit" shortcut="⌘Z"><Button variant="ghost" size="sm" onClick={onUndo}><Undo2 className="size-4" /> Undo</Button></Tip>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Assistant settings"><Settings2 className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Edit behaviour</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={!autoApply} onCheckedChange={() => setAutoApply(false)}>Preview edits first</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={autoApply} onCheckedChange={() => setAutoApply(true)}>Apply edits immediately</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { agent.reset(); setProposals([]); setFindings([]); }}>Clear conversation</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-1 p-2">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)} className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer", mode === m.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
            <m.icon className="size-3.5" /> {m.label}
          </button>
        ))}
      </div>

      <MessageList messages={agent.messages} statusLine={agent.statusLine} emptyState={emptyState} className="min-h-0" onRetry={(m) => m.role === "user" && send(m.content, m.attachments ?? [])} />

      {(pending.length > 0 || findings.length > 0 || (applied.length > 0 && agent.isStreaming)) && (
        <div className="max-h-[38%] shrink-0 overflow-y-auto border-t bg-muted/20 scrollbar-thin">
          {findings.length > 0 && <FindingsCard findings={findings} onLocate={onLocate} />}
          {pending.length > 0 && (
            <div className="p-2">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Proposed edits · {pending.length}</div>
                <button className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setSelected(selected.size === pending.length ? new Set() : new Set(pending.map((p) => p.id)))}>{selected.size === pending.length ? "Select none" : "Select all"}</button>
              </div>
              <ul className="space-y-1">
                {pending.map((p) => <ProposalRow key={p.id} proposal={p} checked={selected.has(p.id)} onCheck={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(p.id); else n.delete(p.id); return n; })} onLocate={onLocate} />)}
              </ul>
              <div className="mt-2 flex items-center gap-2 px-1">
                <Button size="sm" onClick={() => apply(pending.map((p) => p.id))} disabled={applying || agent.isStreaming}>{applying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Apply all</Button>
                {selected.size > 0 && selected.size < pending.length && <Button size="sm" variant="outline" onClick={() => apply(Array.from(selected))} disabled={applying}>Apply {selected.size}</Button>}
                <Button size="sm" variant="ghost" onClick={() => discard()} disabled={applying}><X className="size-3.5" /> Discard</Button>
              </div>
            </div>
          )}
          {applied.length > 0 && pending.length === 0 && <div className="px-3 py-1.5 text-[11px] text-muted-foreground">{applied.length} edit{applied.length === 1 ? "" : "s"} applied as tracked changes.</div>}
        </div>
      )}

      <div className="shrink-0 border-t p-2">
        <Composer
          value={draft}
          onValueChange={setDraft}
          placeholder={mode === "ask" ? "Ask about this document…" : mode === "review" ? "What should I look for? (or just say “review”)" : `Instruct the editor (${scope?.label.toLowerCase() ?? "whole document"})…`}
          streaming={agent.isStreaming}
          onStop={agent.stop}
          onSend={send}
          leading={
            <>
              {scopes.map((s) => (
                <button key={s.id} onClick={() => setScopeId(s.id)} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] transition-colors cursor-pointer", scopeId === s.id ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>{s.label}</button>
              ))}
              <div className="flex-1" />
              <label className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] cursor-pointer transition-colors", research ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Globe className="size-3" /> Research {research ? "on" : "off"}
                <Switch size="sm" checked={research} onCheckedChange={setResearch} className="ml-0.5" />
              </label>
            </>
          }
        />
      </div>
    </div>
  );
}

function ProposalRow({ proposal: p, checked, onCheck, onLocate }: { proposal: EditProposal; checked: boolean; onCheck: (c: boolean) => void; onLocate?: (t: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="rounded-md border bg-background">
      <div className="flex items-start gap-2 px-2 py-1.5">
        <Checkbox checked={checked} onCheckedChange={(c) => onCheck(Boolean(c))} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{p.title}</span>
            {p.targetLabel && <button onClick={() => p.target && onLocate?.(p.target)} className="text-[11px] text-primary hover:underline cursor-pointer inline-flex items-center gap-0.5"><Crosshair className="size-3" />{p.targetLabel}</button>}
            {p.risk && p.risk !== "low" && <Badge variant={p.risk === "high" ? "destructive" : "warning"} className="py-0">{p.risk} risk</Badge>}
          </div>
          {p.summary && <div className={cn("mt-0.5 text-[12px] text-muted-foreground whitespace-pre-wrap", !open && "line-clamp-3")}>{p.summary}</div>}
        </div>
        {p.summary && p.summary.length > 160 && <button onClick={() => setOpen((o) => !o)} className="mt-0.5 text-muted-foreground cursor-pointer"><ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} /></button>}
      </div>
    </li>
  );
}

function FindingsCard({ findings, onLocate }: { findings: ReviewFinding[]; onLocate?: (t: string) => void }) {
  const order: ReviewFinding["severity"][] = ["critical", "high", "medium", "low", "info"];
  const sorted = [...findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <div className="p-2">
      <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Review findings · {findings.length}</div>
      <ul className="space-y-1">
        {sorted.map((f) => (
          <li key={f.id} className="rounded-md border bg-background px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <Badge variant={SEVERITY_VARIANT[f.severity]} className="py-0 capitalize">{f.severity}</Badge>
              <span className="text-xs font-medium truncate">{f.title}</span>
              <span className="text-[10px] text-muted-foreground">{f.category}</span>
              {f.targetLabel && <button onClick={() => f.target && onLocate?.(f.target)} className="ml-auto text-[11px] text-primary hover:underline cursor-pointer inline-flex items-center gap-0.5"><Crosshair className="size-3" />{f.targetLabel}</button>}
            </div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">{f.detail}</div>
            {f.suggestion && <div className="mt-1 flex items-start gap-1 text-[12px]"><AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" /><span>{f.suggestion}</span></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function summarize(m: AgentMessage | undefined, proposals: EditProposal[]) {
  const titles = proposals.map((p) => p.title).slice(0, 4).join(", ");
  const first = (m?.content ?? "").split("\n").map((s) => s.replace(/^[-*•\s]+/, "").trim()).find(Boolean);
  return `Agent edit: ${first ? first.slice(0, 140) : titles}${proposals.length > 4 ? ` (+${proposals.length - 4} more)` : ""}`;
}
