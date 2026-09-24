"use client";
import * as React from "react";
import { Sparkles, Undo2, PenLine, ScanSearch, MessageCircleQuestion, Check, X, Globe, ChevronDown, Loader2, AlertTriangle, Crosshair, MoreHorizontal, History, KeyRound, Copy, RotateCcw, AlertCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Provenance } from "@/lib/integrity/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { PersonAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Composer } from "@/components/ai/composer";
import { Markdown } from "@/components/ai/markdown";
import { ToolActivityList, CitationList } from "@/components/ai/tool-activity";
import { NotSourceBackedBanner, TrustBadge } from "@/components/ai/trust-badge";
import { useAgent, type AgentAttachment, type AgentMessage } from "@/hooks/use-agent";
import type { AgentEvent } from "@/lib/ai/agent";
import { extractRunProvenance, mergeRunProvenance, needsNotSourceBackedBanner, proposalAuditPayload, SegmentedControl, type AuditedProposalStatus } from "./office-chrome";
import type { EditProposal, OfficeAgentMode, OfficeAgentSuggestions, OfficeScope, ReviewFinding } from "./types";

export interface ApplyResult { applied: string[]; failed: { id: string; error: string }[] }

/** Proposals and findings may carry the provenance of the agent turn that produced them. */
export type ProvenancedProposal = EditProposal & { provenance?: Provenance };
type ProvenancedFinding = ReviewFinding & { provenance?: Provenance };

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
  /** Hover preview: called with the hovered pending proposal, or null when the pointer leaves. */
  onPreview?: (proposal: EditProposal | null) => void;
  /** Whether applied edits become tracked changes (Word). Defaults to true for the Word endpoint, false otherwise; affects wording only. */
  trackedChanges?: boolean;
  /** Optional hook fired after proposals are audited (applied/discarded); the panel already POSTs to audit-apply. */
  onAudited?: (payload: { applied: number; discarded: number; failed: number }) => void;
  /** "Versions (n)" link in the header. */
  onVersions?: () => void;
  versionCount?: number;
  /** Aliases for onVersions / versionCount. */
  onOpenVersions?: () => void;
  versionsCount?: number;
  /** Close button in the header (panel toggles live in the editor chrome). */
  onClose?: () => void;
  className?: string;
  defaultMode?: OfficeAgentMode;
  title?: string;
  userName?: string;
}

const MODES: { id: OfficeAgentMode; label: string; icon: LucideIcon; title: string }[] = [
  { id: "draft", label: "Draft", icon: PenLine, title: "Propose edits you can preview and apply" },
  { id: "review", label: "Review", icon: ScanSearch, title: "Read-only pass: citations, defined terms, risk" },
  { id: "ask", label: "Ask", icon: MessageCircleQuestion, title: "Questions about the document, matter and law" },
];

const SEVERITY_VARIANT: Record<ReviewFinding["severity"], "muted" | "info" | "warning" | "destructive"> = { info: "muted", low: "info", medium: "warning", high: "destructive", critical: "destructive" };

interface RunInfo { provenance: Provenance | null; research: boolean; mode: OfficeAgentMode; message: string; noKey?: boolean }

export function OfficeAgentPanel(props: OfficeAgentPanelProps) {
  const { endpoint, docId, docTitle, matterId, getSnapshot, scopes, applyProposals, onUndo, onLocate, suggestions, extraContext, onApplied, onPreview, onAudited, onClose, className, defaultMode = "draft", title = "Drafting assistant", userName = "You" } = props;
  const onVersions = props.onVersions ?? props.onOpenVersions;
  const versionCount = props.versionCount ?? props.versionsCount;
  const tracked = props.trackedChanges ?? /\/word\//.test(endpoint);
  const appliedNoun = tracked ? "as tracked changes" : "to the document";
  const [mode, setMode] = React.useState<OfficeAgentMode>(defaultMode);
  const [scopeId, setScopeId] = React.useState<string>(scopes[0]?.id ?? "document");
  const [research, setResearch] = React.useState(false);
  const [autoApply, setAutoApply] = React.useState(false);
  const [proposals, setProposals] = React.useState<ProvenancedProposal[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [findings, setFindings] = React.useState<ProvenancedFinding[]>([]);
  const [applying, setApplying] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  /** Per assistant-message run info (provenance, research flag) keyed by message id. */
  const [runs, setRuns] = React.useState<Record<string, RunInfo>>({});
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0] ?? null;
  const autoApplyRef = React.useRef(autoApply);
  autoApplyRef.current = autoApply;
  const applyRef = React.useRef(applyProposals);
  applyRef.current = applyProposals;
  const researchRef = React.useRef(research);
  researchRef.current = research;
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  const lastMessageRef = React.useRef("");
  const docIdRef = React.useRef(docId);
  docIdRef.current = docId;

  React.useEffect(() => { if (!scopes.some((s) => s.id === scopeId)) setScopeId(scopes[0]?.id ?? "document"); }, [scopes, scopeId]);

  /** Every application or discard of AI edits lands on the audit trail (fire-and-forget; never blocks the UI). */
  const auditProposals = React.useCallback((batch: ProvenancedProposal[], statusOf: (p: EditProposal) => AuditedProposalStatus) => {
    const id = docIdRef.current;
    if (!id || id === "new" || !batch.length) return;
    const payload = proposalAuditPayload(batch, statusOf, { mode: modeRef.current, message: lastMessageRef.current });
    void fetch(`/api/office/docs/${id}/audit-apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { applied?: number; discarded?: number; failed?: number } | null) => { if (j) onAudited?.({ applied: j.applied ?? 0, discarded: j.discarded ?? 0, failed: j.failed ?? 0 }); })
      .catch(() => { /* auditing must never break editing */ });
  }, [onAudited]);

  const onEvent = React.useCallback((ev: AgentEvent, ctx: { messageId: string }) => {
    if (ev.type === "proposal") {
      const p = ev.proposal as ProvenancedProposal;
      setProposals((ps) => [...ps, p]);
      setSelected((s) => new Set(s).add(p.id));
      if (autoApplyRef.current) {
        void applyRef.current([p]).then((r) => {
          const ok = r.applied.includes(p.id);
          setProposals((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: ok ? "applied" : "failed", error: r.failed.find((f) => f.id === p.id)?.error } : x)));
          auditProposals([p], () => (ok ? "applied" : "failed"));
        });
      }
    } else if (ev.type === "artifact" && ev.artifact.kind === "review-finding") {
      setFindings((fs) => [...fs, ev.artifact.data as ProvenancedFinding]);
    } else if (ev.type === "artifact" && ev.artifact.kind === "office-provenance") {
      const { run, proposals: perProposal, findings: perFinding } = extractRunProvenance(ev.artifact.data);
      // The provenance artifact arrives after any error event: merge, never replace, so a no-key failure keeps its dedicated card.
      setRuns((rs) => ({ ...rs, [ctx.messageId]: mergeRunProvenance(rs[ctx.messageId], run, { research: researchRef.current, mode: modeRef.current, message: lastMessageRef.current }) as RunInfo }));
      if (Object.keys(perProposal).length) setProposals((ps) => ps.map((p) => (perProposal[p.id] ? { ...p, provenance: perProposal[p.id] } : p)));
      if (Object.keys(perFinding).length) setFindings((fs) => fs.map((f) => (perFinding[f.id] ? { ...f, provenance: perFinding[f.id] } : f)));
    } else if (ev.type === "error" && ev.code === "no_api_key") {
      setRuns((rs) => ({ ...rs, [ctx.messageId]: { ...(rs[ctx.messageId] ?? { provenance: null, research: researchRef.current, mode: modeRef.current, message: lastMessageRef.current }), noKey: true } }));
    }
  }, [auditProposals]);

  const agent = useAgent({
    endpoint,
    extra: () => ({ mode, scope, research, snapshot: getSnapshot(), docId, docTitle, matterId: matterId ?? null, context: extraContext?.() ?? {} }),
    onEvent,
    onDone: (m) => {
      // Record the run's research flag even when the server sent no provenance artifact (older servers).
      setRuns((rs) => (rs[m.id] ? rs : { ...rs, [m.id]: { provenance: null, research: researchRef.current, mode: modeRef.current, message: lastMessageRef.current } }));
      if (autoApplyRef.current) { const n = proposalsRef.current.filter((p) => p.status === "applied").length; if (n) onApplied?.(summarize(m, proposalsRef.current), proposalsRef.current); }
    },
  });
  const proposalsRef = React.useRef(proposals);
  proposalsRef.current = proposals;

  const send = (text: string, attachments: AgentAttachment[]) => {
    // A new request starts a fresh proposal batch; pending ones from before are discarded to avoid stale targets.
    const stale = proposalsRef.current.filter((p) => p.status === "pending");
    if (stale.length) auditProposals(stale, () => "discarded");
    setProposals((ps) => ps.filter((p) => p.status === "applied"));
    setFindings([]);
    lastMessageRef.current = text;
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
      auditProposals(batch, (p) => (r.applied.includes(p.id) ? "applied" : "failed"));
      if (r.failed.length) toast.error(`${r.failed.length} edit${r.failed.length === 1 ? "" : "s"} could not be applied`, { description: r.failed[0]?.error });
      if (r.applied.length) {
        const last = agent.messages.filter((m) => m.role === "assistant").at(-1);
        onApplied?.(summarize(last, batch.filter((p) => r.applied.includes(p.id))), batch);
        toast.success(`Applied ${r.applied.length} edit${r.applied.length === 1 ? "" : "s"} ${appliedNoun}`);
      }
    } finally { setApplying(false); }
  };

  const discard = (ids?: string[]) => {
    const batch = pending.filter((p) => !ids || ids.includes(p.id));
    if (!batch.length) return;
    setProposals((ps) => ps.map((p) => (p.status === "pending" && (!ids || ids.includes(p.id)) ? { ...p, status: "discarded" } : p)));
    auditProposals(batch, () => "discarded");
  };

  const clearConversation = () => {
    const stale = proposalsRef.current.filter((p) => p.status === "pending");
    if (stale.length) auditProposals(stale, () => "discarded");
    agent.reset(); setProposals([]); setFindings([]); setRuns({});
  };

  const emptyState = (
    <div className="px-3 pt-3">
      <p className="mb-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        {mode === "draft" && <>Ask for a rewrite, a new section, a table, a cite or a polish. Every edit arrives as a proposal you can preview, then apply {tracked ? "as tracked changes" : "with full undo"}.</>}
        {mode === "review" && <>A read-only pass over the document: citations, defined terms, cross-references, numbering, risk and style, each with a one-click fix where safe.</>}
        {mode === "ask" && <>Questions about this document, the matter record and the law. Turn on Research for web, case law, statutes and dockets.</>}
      </p>
      <div className="flex flex-col gap-1.5">
        {(suggestions[mode] ?? []).map((s) => (
          <button key={s} onClick={() => send(s, [])} className="w-full rounded-md border bg-background px-3 py-2 text-left text-[12.5px] leading-snug text-foreground/85 transition-colors hover:border-foreground/20 hover:bg-accent cursor-pointer">{s}</button>
        ))}
      </div>
    </div>
  );

  const allSelected = pending.length > 0 && selected.size >= pending.length && pending.every((p) => selected.has(p.id));
  const selectedPending = pending.filter((p) => selected.has(p.id)).length;

  return (
    <div className={cn("@container flex h-full min-h-0 flex-col bg-background", className)} data-office-agent-panel>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
        <Sparkles className="size-4 text-primary" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</div>
        {onVersions && (
          <Tip label="Version history"><button onClick={onVersions} className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"><History className="size-3.5" /><span className="hidden @min-[380px]:inline">Versions{versionCount ? ` (${versionCount})` : ""}</span>{versionCount ? <span className="tabular @min-[380px]:hidden">{versionCount}</span> : null}</button></Tip>
        )}
        {onUndo && <Tip label="Undo last edit" shortcut="⌘Z"><Button variant="ghost" size="xs" onClick={onUndo} className="text-muted-foreground" aria-label="Undo last edit"><Undo2 className="size-3.5" /><span className="hidden @min-[340px]:inline">Undo</span></Button></Tip>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Assistant options"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Edits</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={!autoApply} onCheckedChange={() => setAutoApply(false)}>Preview before applying</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={autoApply} onCheckedChange={() => setAutoApply(true)}>Apply immediately</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={research} onCheckedChange={(v) => setResearch(Boolean(v))}><Globe /> External research</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={clearConversation}>Clear conversation</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && <Tip label="Close assistant" shortcut="⌘/"><Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close assistant"><X className="size-4" /></Button></Tip>}
      </div>

      <div className="shrink-0 px-3 py-2">
        <SegmentedControl ariaLabel="Assistant mode" grow options={MODES.map((m) => ({ id: m.id, label: m.label, icon: m.icon, title: m.title }))} value={mode} onChange={setMode} />
      </div>

      <Thread messages={agent.messages} runs={runs} statusLine={agent.statusLine} emptyState={emptyState} userName={userName} onRetry={(m) => m.role === "user" && send(m.content, m.attachments ?? [])} />

      {(pending.length > 0 || findings.length > 0 || (applied.length > 0 && agent.isStreaming)) && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-t bg-muted/20 scrollbar-thin">
          {findings.length > 0 && <FindingsCard findings={findings} onLocate={onLocate} />}
          {pending.length > 0 && (
            <div className="p-2">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <label className="flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground cursor-pointer">
                  <Checkbox checked={allSelected} onCheckedChange={(c) => setSelected(c ? new Set(pending.map((p) => p.id)) : new Set())} aria-label="Select all proposals" />
                  Proposed edits · {pending.length}
                </label>
                {pending[0]?.provenance && <TrustBadge provenance={pending[0].provenance} compact />}
              </div>
              <ul className="space-y-1">
                {pending.map((p) => <ProposalRow key={p.id} proposal={p} checked={selected.has(p.id)} onCheck={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(p.id); else n.delete(p.id); return n; })} onLocate={onLocate} onPreview={onPreview} />)}
              </ul>
              <div className="mt-2 flex items-center gap-1.5 px-1">
                <Button size="sm" onClick={() => apply(allSelected || selectedPending === 0 ? pending.map((p) => p.id) : Array.from(selected))} disabled={applying || agent.isStreaming}>
                  {applying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  {allSelected || selectedPending === 0 ? "Apply all" : `Apply ${selectedPending}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => discard()} disabled={applying}><X className="size-3.5" /> Discard</Button>
                <span className="ml-auto text-[11px] text-muted-foreground">{tracked ? "Applied as tracked changes" : "Undo restores the document"}</span>
              </div>
            </div>
          )}
          {applied.length > 0 && pending.length === 0 && <div className="px-3 py-1.5 text-[11.5px] text-muted-foreground">{applied.length} edit{applied.length === 1 ? "" : "s"} applied {appliedNoun}.</div>}
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
                <button key={s.id} onClick={() => setScopeId(s.id)} aria-pressed={scopeId === s.id} className={cn("h-6 rounded-full border px-2.5 text-[11.5px] transition-colors cursor-pointer", scopeId === s.id ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>{s.label}</button>
              ))}
              <div className="flex-1" />
              <Tip label={research ? "External research is on: web, case law, statutes, dockets" : "External research is off: firm library and matter record only"}>
                <button onClick={() => setResearch((v) => !v)} aria-pressed={research} className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11.5px] transition-colors cursor-pointer", research ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                  <Globe className="size-3" /> Research {research ? "on" : "off"}
                </button>
              </Tip>
            </>
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread: messages with provenance footer + not-source-backed banner
// ---------------------------------------------------------------------------

function Thread({ messages, runs, statusLine, emptyState, userName, onRetry }: { messages: AgentMessage[]; runs: Record<string, RunInfo>; statusLine?: string | null; emptyState: React.ReactNode; userName: string; onRetry: (m: AgentMessage) => void }) {
  const endRef = React.useRef<HTMLDivElement>(null);
  const [stick, setStick] = React.useState(true);
  React.useEffect(() => { if (stick) endRef.current?.scrollIntoView({ block: "end" }); }, [messages, statusLine, stick]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" onScroll={(e) => { const el = e.currentTarget; setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80); }}>
      {messages.length === 0 && emptyState}
      <div className="space-y-4 p-3">
        {messages.map((m, i) => (m.role === "user" ? <UserBubble key={m.id} message={m} userName={userName} /> : <AssistantBubble key={m.id} message={m} run={runs[m.id]} onRetry={m.status === "error" ? () => onRetry(messages[i - 1] ?? m) : undefined} />))}
        {statusLine && <div className="flex items-center gap-2 pl-8 text-[12px] text-muted-foreground animate-pulse-soft"><Sparkles className="size-3.5" />{statusLine}</div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function UserBubble({ message: m, userName }: { message: AgentMessage; userName: string }) {
  return (
    <div className="flex gap-2.5">
      <PersonAvatar name={userName} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {m.attachments?.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1.5">{m.attachments.map((a, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={a.dataUrl} alt={a.name} className="h-16 rounded-md border object-cover" />
          ))}</div>
        ) : null}
        <div className="rounded-lg bg-accent/60 px-3 py-2 text-[13px] whitespace-pre-wrap">{m.content}</div>
      </div>
    </div>
  );
}

function AssistantBubble({ message: m, run, onRetry }: { message: AgentMessage; run?: RunInfo; onRetry?: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const done = m.status === "done";
  const showBanner = done && run ? needsNotSourceBackedBanner(run.research, run.provenance) : false;
  return (
    <div className="group flex gap-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-3.5" /></span>
      <div className="min-w-0 flex-1 space-y-2">
        {m.tools && m.tools.length > 0 && <ToolActivityList tools={m.tools} />}
        {m.content ? <Markdown>{m.content}</Markdown> : m.status === "streaming" ? <div className="h-4 w-24 animate-pulse-soft rounded bg-muted" /> : null}
        {m.status === "error" && (
          run?.noKey ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px]">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <div className="flex-1"><span className="font-medium">The assistant needs an OpenAI key.</span> Add <code className="font-mono text-[11px]">OPENAI_API_KEY</code> in Settings → AI to enable drafting, review and research. Editing, comments and versions work without it.</div>
              <Button asChild variant="ghost" size="xs"><Link href="/settings#ai">Settings</Link></Button>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <div className="flex-1">{m.error ?? "Something went wrong."}</div>
              {onRetry && <Button variant="ghost" size="xs" onClick={onRetry}><RotateCcw className="size-3" /> Retry</Button>}
            </div>
          )
        )}
        {m.status === "stopped" && <div className="text-[11.5px] text-muted-foreground">Stopped.</div>}
        {showBanner && <NotSourceBackedBanner detail="Research was on but no sources were read for this answer. Treat case-specific statements as unverified until you confirm them against the record." />}
        {m.citations && m.citations.length > 0 && <CitationList citations={m.citations} />}
        {done && (run?.provenance || m.content) && (
          <div className="flex items-center gap-1.5">
            {run?.provenance && <TrustBadge provenance={run.provenance} compact />}
            {run?.provenance && run.provenance.sources.length > 0 && <span className="text-[11px] tabular text-muted-foreground">{run.provenance.sources.length} source{run.provenance.sources.length === 1 ? "" : "s"}</span>}
            {m.content && (
              <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => { navigator.clipboard.writeText(m.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}>
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposals and findings
// ---------------------------------------------------------------------------

function ProposalRow({ proposal: p, checked, onCheck, onLocate, onPreview }: { proposal: ProvenancedProposal; checked: boolean; onCheck: (c: boolean) => void; onLocate?: (t: string) => void; onPreview?: (proposal: EditProposal | null) => void }) {
  const [open, setOpen] = React.useState(false);
  const long = Boolean(p.summary && p.summary.length > 160);
  return (
    <li className={cn("rounded-md border bg-background transition-colors", checked ? "border-border" : "border-transparent bg-background/60")} data-proposal-id={p.id} data-proposal-target={p.target} data-proposal-kind={p.kind} onMouseEnter={() => onPreview?.(p)} onMouseLeave={() => onPreview?.(null)}>
      <div className="flex items-start gap-2 px-2 py-1.5">
        <Checkbox checked={checked} onCheckedChange={(c) => onCheck(Boolean(c))} className="mt-0.5" aria-label={`Select ${p.title}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-[12.5px] font-medium">{p.title}</span>
            {p.targetLabel && <button onClick={() => p.target && onLocate?.(p.target)} className="inline-flex items-center gap-0.5 rounded border px-1.5 text-[10.5px] text-muted-foreground hover:border-primary/40 hover:text-primary cursor-pointer"><Crosshair className="size-3" />{p.targetLabel}</button>}
            {p.risk && p.risk !== "low" && <Badge variant={p.risk === "high" ? "destructive" : "warning"} className="py-0 text-[10px]">{p.risk} risk</Badge>}
            {p.provenance?.verification?.unresolvedCites?.length ? <Badge variant="warning" className="py-0 text-[10px]">{p.provenance.verification.unresolvedCites.length} cite{p.provenance.verification.unresolvedCites.length === 1 ? "" : "s"} to verify</Badge> : null}
          </div>
          {p.summary && <div className={cn("mt-0.5 text-[12px] leading-snug text-muted-foreground whitespace-pre-wrap", !open && "line-clamp-3")}>{p.summary}</div>}
        </div>
        {long && <button onClick={() => setOpen((o) => !o)} className="mt-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" aria-label={open ? "Collapse" : "Expand"}><ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} /></button>}
      </div>
    </li>
  );
}

function FindingsCard({ findings, onLocate }: { findings: ProvenancedFinding[]; onLocate?: (t: string) => void }) {
  const order: ReviewFinding["severity"][] = ["critical", "high", "medium", "low", "info"];
  const sorted = [...findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <div className="p-2">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <div className="text-[11.5px] font-medium text-muted-foreground">Review findings · {findings.length}</div>
        {findings[0]?.provenance && <TrustBadge provenance={findings[0].provenance} compact />}
      </div>
      <ul className="space-y-1">
        {sorted.map((f) => (
          <li key={f.id} className="rounded-md border bg-background px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <Badge variant={SEVERITY_VARIANT[f.severity]} className="py-0 text-[10px] capitalize">{f.severity}</Badge>
              <span className="truncate text-[12.5px] font-medium">{f.title}</span>
              <span className="text-[10.5px] text-muted-foreground">{f.category}</span>
              {f.targetLabel && <button onClick={() => f.target && onLocate?.(f.target)} className="ml-auto inline-flex items-center gap-0.5 rounded border px-1.5 text-[10.5px] text-muted-foreground hover:border-primary/40 hover:text-primary cursor-pointer"><Crosshair className="size-3" />{f.targetLabel}</button>}
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{f.detail}</div>
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
