"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bookmark, Check, Copy, FileDown, FileText, Loader2, Pin, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { PersonAvatar } from "@/components/ui/avatar";
import { NotSourceBackedBanner, TrustChip } from "./trust";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { formatBluebook } from "../normalize";
import { memoTitle } from "../memo";
import type { ResearchMessage, ResearchSource } from "../engine/types";
import type { LaneView, ResearchState, Stage } from "./use-research";
import { AnswerMarkdown } from "./answer-markdown";
import { NoKeyCard } from "./no-key-card";
import { useResearchActions } from "./research-context";

export interface ConversationProps {
  state: ResearchState;
  sources: ResearchSource[];
  userName: string;
  matter: { id: string; shortName: string; name: string; caption?: string } | null;
  aiConfigured: boolean;
  onSaveSearch: (name: string) => Promise<void>;
  emptyState: React.ReactNode;
}

const STAGE_LABEL: Record<Stage, string> = {
  idle: "", planning: "Planning research lanes", lanes: "Lanes are searching and reading", synthesis: "Writing the answer from the sources read", verifying: "Verifying every claim against the sources", correcting: "Revising claims the verifier flagged", finalizing: "Cross-checking citations", done: "Done", error: "Stopped",
};

export function Conversation({ state, sources, userName, matter, aiConfigured, onSaveSearch, emptyState }: ConversationProps) {
  const endRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [stick, setStick] = React.useState(true);
  const turns = React.useMemo(() => pairTurns(state.messages), [state.messages]);
  React.useEffect(() => { if (stick) endRef.current?.scrollIntoView({ block: "end" }); }, [state.pending?.text, state.pending?.stage, state.messages.length, stick]);

  if (!turns.length && !state.pending) return <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{emptyState}</div>;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" onScroll={(e) => { const el = e.currentTarget; setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 120); }}>
      <div className="mx-auto w-full max-w-[760px] px-6 pb-8 pt-6">
        {turns.map((t) => (
          <Turn key={t.assistant.id} question={t.user.content} message={t.assistant} sources={sources} userName={userName} matter={matter} aiConfigured={aiConfigured} onSaveSearch={onSaveSearch} />
        ))}
        {state.pending && <PendingTurn pending={state.pending} lanes={state.laneOrder.map((id) => state.lanes[id]).filter(Boolean)} sources={sources} userName={userName} error={state.error} aiConfigured={aiConfigured} />}
        <div ref={endRef} className="h-2" />
      </div>
    </div>
  );
}

function pairTurns(messages: ResearchMessage[]) {
  const out: { user: ResearchMessage; assistant: ResearchMessage }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant") {
      const prev = messages[i - 1];
      out.push({ user: prev?.role === "user" ? prev : { id: `q_${m.id}`, role: "user", content: "", createdAt: m.createdAt }, assistant: m });
    }
  }
  return out;
}

function QuestionBubble({ text, userName }: { text: string; userName: string }) {
  if (!text) return null;
  return (
    <div className="mb-5 flex justify-end">
      <div className="flex max-w-[85%] items-start gap-2.5">
        <div className="rounded-2xl rounded-tr-sm bg-accent/70 px-4 py-2.5 text-[14px] leading-relaxed text-foreground whitespace-pre-wrap">{text}</div>
        <PersonAvatar name={userName} size="sm" className="mt-1" />
      </div>
    </div>
  );
}

function StatusLine({ message, live }: { message: Partial<ResearchMessage> & { content?: string }; live?: boolean }) {
  const s = message.stats;
  const v = message.verification;
  const parts = [
    s ? `${s.sources} source${s.sources === 1 ? "" : "s"}` : null,
    s ? `${s.rounds} round${s.rounds === 1 ? "" : "s"}` : null,
    s ? `${s.agents} agent${s.agents === 1 ? "" : "s"}` : null,
    s?.read ? `${s.read} read` : null,
    v && v.verdicts?.length !== 0 && (v.supported + v.unsupported + v.contradicted) > 0 ? `${(v.score * 100).toFixed(0)}% verified` : null,
    s ? `${(s.durationMs / 1000).toFixed(1)}s` : null,
  ].filter(Boolean);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-[11.5px] text-muted-foreground">
      {live && <Loader2 className="size-3 animate-spin" />}
      <span className="tabular">{parts.join(" · ")}</span>
      {message.provenance && <TrustChip provenance={message.provenance} compact />}
    </div>
  );
}

function Turn({ question, message, sources, userName, matter, aiConfigured, onSaveSearch }: { question: string; message: ResearchMessage; sources: ResearchSource[]; userName: string; matter: ConversationProps["matter"]; aiConfigured: boolean; onSaveSearch: (name: string) => Promise<void> }) {
  const a = useResearchActions();
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [wording, setWording] = React.useState(false);
  const cited = React.useMemo(() => sources.filter((s) => s.n != null && message.citeMap && message.citeMap[s.n] === s.id).sort((x, y) => (x.n ?? 0) - (y.n ?? 0)), [sources, message.citeMap]);

  const markdown = React.useCallback(() => {
    const head = `# ${memoTitle(question)}\n\n**Question.** ${question}\n\n`;
    const srcList = cited.length ? `\n\n---\n\n## Sources read\n\n${cited.map((s) => `[${s.n}] ${formatBluebook(s.hit)}${s.url ? ` — ${s.url}` : ""}${s.read ? "" : " (search excerpt only)"}`).join("\n")}` : "";
    const prov = message.provenance ? `\n\n---\n\n_Generated ${new Date(message.provenance.generatedAt).toLocaleString()} · ${message.provenance.model} · ${message.verification ? `${message.verification.supported} supported, ${message.verification.unsupported} unsupported, ${message.verification.contradicted} contradicted` : "unverified"}_` : "";
    return `${head}${message.content}${srcList}${prov}`;
  }, [question, message, cited]);

  const copy = () => navigator.clipboard.writeText(message.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); toast.success("Answer copied"); }).catch(() => toast.error("Clipboard unavailable"));
  const download = () => {
    const blob = new Blob([markdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `${memoTitle(question).replace(/[^\w\- ]+/g, "").slice(0, 60)}.md`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const toWord = async () => {
    setWording(true);
    try {
      const content = markdownToDoc(markdown(), { title: memoTitle(question) });
      const res = await fetch("/api/office/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "word", title: memoTitle(question), content, matterId: matter?.id, tags: ["research", "memo"], meta: { source: "search-research", runId: message.runId, provenance: message.provenance } }) });
      const j = (await res.json()) as { doc?: { id: string }; error?: string };
      if (!res.ok || !j.doc) throw new Error(j.error ?? res.statusText);
      toast.success("Opened in Word", { description: "The memo carries the answer, sources and provenance." });
      router.push(`/office/word/${j.doc.id}`);
    } catch (e) { toast.error("Could not create the Word document", { description: e instanceof Error ? e.message : String(e) }); } finally { setWording(false); }
  };
  const save = async () => { setSaving(true); try { await onSaveSearch(saveName.trim() || question.slice(0, 80)); setSaveOpen(false); setSaveName(""); } finally { setSaving(false); } };

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    setSelection(text.length > 12 && text.length < 4000 ? text : "");
  };
  const [selection, setSelection] = React.useState("");

  return (
    <section className="mb-10" data-run={message.runId}>
      <QuestionBubble text={question} userName={userName} />
      <div className="flex items-start gap-3">
        <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          {message.banner === "no-api-key" && <NoKeyCard className="mb-3" />}
          {message.banner === "not-source-backed" && <NotSourceBackedBanner className="mb-3" />}
          {message.banner === "no-api-key" && !message.content && cited.length === 0 && sources.length > 0 && (
            <div className="rounded-lg border bg-card p-3 font-sans text-xs text-muted-foreground">The lanes found {sources.length} source{sources.length === 1 ? "" : "s"} (see Sources). Add an OpenAI key to synthesize an answer from them.</div>
          )}
          {message.content && (
            <div className="relative" onMouseUp={onMouseUp}>
              <AnswerMarkdown text={message.content} />
              {selection && (
                <div className="sticky bottom-2 mt-2 flex justify-end">
                  <Button size="xs" variant="outline" className="shadow-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => { a.pinPassage(selection); setSelection(""); window.getSelection()?.removeAllRanges(); }}><Pin className="size-3" /> Pin selected passage</Button>
                </div>
              )}
            </div>
          )}
          {message.verification && message.verification.verdicts && message.verification.verdicts.length > 0 && <VerdictSummary verdicts={message.verification.verdicts} />}
          <StatusLine message={message} />
          {message.content && (
            <div className="mt-2 flex flex-wrap items-center gap-1 font-sans">
              <Tip label="Copy the answer as markdown"><Button variant="ghost" size="xs" onClick={copy}>{copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />} Copy</Button></Tip>
              <Tip label="Download as .md with sources and provenance"><Button variant="ghost" size="xs" onClick={download}><FileDown className="size-3" /> Markdown</Button></Tip>
              <Tip label="Open as a Word memo (answer, sources, provenance)"><Button variant="ghost" size="xs" onClick={toWord} disabled={wording}>{wording ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} Word</Button></Tip>
              <Popover open={saveOpen} onOpenChange={setSaveOpen}>
                <PopoverTrigger asChild><Button variant="ghost" size="xs"><Bookmark className="size-3" /> Save</Button></PopoverTrigger>
                <PopoverContent align="start" className="w-72 space-y-2 p-3">
                  <div className="text-xs font-medium">Save this search</div>
                  <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={question.slice(0, 60)} className="h-8 text-xs" autoFocus onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
                  <div className="text-[11px] text-muted-foreground">Keeps the question, scope, jurisdiction and matter so it can be re-run from the rail.</div>
                  <Button size="sm" className="w-full" onClick={save} disabled={saving}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />} Save</Button>
                </PopoverContent>
              </Popover>
              {!aiConfigured && <span className="ml-auto text-[11px] text-muted-foreground">AI off</span>}
            </div>
          )}
          {message.followUps && message.followUps.length > 0 && (
            <div className="mt-5 font-sans">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Suggested follow-ups</div>
              <div className="flex flex-wrap gap-1.5">
                {message.followUps.map((q) => (
                  <button key={q} onClick={() => a.askFollowUp(q)} className="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-left text-[12px] text-foreground/90 transition-colors hover:border-primary/40 hover:bg-accent cursor-pointer">
                    <span className="truncate">{q}</span><ArrowRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function VerdictSummary({ verdicts }: { verdicts: NonNullable<ResearchMessage["verification"]>["verdicts"] }) {
  const [open, setOpen] = React.useState(false);
  const list = verdicts ?? [];
  const flagged = list.filter((v) => v.status !== "supported");
  if (!list.length) return null;
  return (
    <div className="mt-3 rounded-md border bg-muted/30 font-sans text-xs">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground cursor-pointer">
        <ShieldCheck className={cn("size-3.5", flagged.length ? "text-warning" : "text-success")} />
        <span className="flex-1">{list.length - flagged.length} of {list.length} claims supported by the sources read{flagged.length ? ` · ${flagged.length} flagged` : ""}</span>
        <span className="text-[10.5px]">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ul className="divide-y border-t">
          {list.map((v, i) => (
            <li key={i} className="flex items-start gap-2 px-2.5 py-1.5">
              <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", v.status === "supported" ? "bg-success" : v.status === "contradicted" ? "bg-destructive" : "bg-warning")} />
              <div className="min-w-0 flex-1">
                <div className="text-foreground/90">{v.claim}{v.sourceN != null && <span className="ml-1 tabular text-primary">[{v.sourceN}]</span>}</div>
                {v.quote && <div className="mt-0.5 truncate font-serif italic text-muted-foreground" title={v.quote}>“{v.quote}”</div>}
                {v.note && <div className="mt-0.5 text-[11px] text-muted-foreground">{v.note}</div>}
              </div>
              <span className="shrink-0 text-[10.5px] capitalize text-muted-foreground">{v.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingTurn({ pending, lanes, sources, userName, error, aiConfigured }: { pending: NonNullable<ResearchState["pending"]>; lanes: LaneView[]; sources: ResearchSource[]; userName: string; error: string | null; aiConfigured: boolean }) {
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => { const t = setInterval(tick, 1000); return () => clearInterval(t); }, []);
  const read = sources.filter((s) => s.read).length;
  const doneLanes = lanes.filter((l) => l.status === "done" || l.status === "error" || l.status === "stopped").length;
  const elapsed = ((Date.now() - pending.startedAt) / 1000).toFixed(0);
  const label = STAGE_LABEL[pending.stage];
  return (
    <section className="mb-10" aria-live="polite">
      <QuestionBubble text={pending.question} userName={userName} />
      <div className="flex items-start gap-3">
        <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className={cn("size-3.5", pending.stage !== "done" && pending.stage !== "error" && "animate-pulse-soft")} /></span>
        <div className="min-w-0 flex-1">
          {!aiConfigured && <NoKeyCard className="mb-3" compact />}
          <div className="mb-3 rounded-lg border bg-card px-3 py-2 font-sans text-xs">
            <div className="flex items-center gap-2">
              {pending.stage === "error" ? <span className="size-3.5 rounded-full bg-destructive/20" /> : <Loader2 className="size-3.5 animate-spin text-primary" />}
              <span className="font-medium text-foreground">{pending.stage === "error" ? (error ?? "Stopped") : label}</span>
              <span className="ml-auto tabular text-muted-foreground">{elapsed}s</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>Round {pending.round}</span>
              <span>{doneLanes}/{lanes.length} lanes</span>
              <span>{sources.length} sources</span>
              <span>{read} read</span>
              {pending.verification && <span>{(pending.verification.score * 100).toFixed(0)}% verified</span>}
              {pending.roundReason && <span className="basis-full truncate text-[11px]" title={pending.roundReason}>{pending.roundReason}</span>}
              {pending.correction && <span className="basis-full text-[11px]">{pending.correction}</span>}
            </div>
            {lanes.length > 0 && (
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {lanes.map((l) => (
                  <li key={l.lane.id} className="flex items-center gap-1.5 truncate">
                    <span className={cn("size-1.5 shrink-0 rounded-full", l.status === "done" ? "bg-success" : l.status === "error" || l.status === "stopped" ? "bg-destructive" : "bg-primary animate-pulse-soft")} />
                    <span className="truncate">{l.lane.name}</span>
                    <span className="ml-auto shrink-0 tabular text-muted-foreground">{l.sourceIds.length}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {pending.text ? <AnswerMarkdown text={pending.text} streaming /> : pending.stage === "synthesis" ? <div className="space-y-2"><div className="h-3.5 w-1/3 animate-pulse-soft rounded bg-muted" /><div className="h-3.5 w-full animate-pulse-soft rounded bg-muted" /><div className="h-3.5 w-10/12 animate-pulse-soft rounded bg-muted" /></div> : null}
        </div>
      </div>
    </section>
  );
}
