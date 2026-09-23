"use client";
import * as React from "react";
import Link from "next/link";
import { BookOpen, Check, Copy, KeyRound, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { Composer } from "@/components/ai/composer";
import { MessageList } from "@/components/ai/chat";
import type { useAgent } from "@/hooks/use-agent";
import type { RunState } from "./use-search";

export interface SynthesisPaneProps {
  agent: ReturnType<typeof useAgent>;
  run: RunState;
  aiConfigured: boolean;
  onFollowUp: (text: string) => void;
  onAddToMemo: (text: string) => void;
  userName?: string;
}

export function NoKeyCard({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs", className)}>
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
        <div className="min-w-0 space-y-1">
          <div className="font-semibold text-foreground">OpenAI key required</div>
          <div className="text-muted-foreground">AI synthesis, headnotes, “ask about this source” and query expansion call the OpenAI Responses API. Add <code className="rounded bg-muted px-1 font-mono">OPENAI_API_KEY</code> to <code className="rounded bg-muted px-1 font-mono">.env.local</code> and restart. Structured retrieval keeps working without it.</div>
          {!compact && <Link href="/settings#ai" className="inline-block font-medium text-primary hover:underline">Open AI configuration →</Link>}
        </div>
      </div>
    </div>
  );
}

export function SynthesisPane({ agent, run, aiConfigured, onFollowUp, onAddToMemo, userName = "Jordan Whitfield" }: SynthesisPaneProps) {
  const [copied, setCopied] = React.useState(false);
  const answer = React.useMemo(() => agent.messages.find((m) => m.role === "assistant" && m.content)?.content ?? "", [agent.messages]);
  const started = run.runId != null;
  const noKey = run.aiNoKey || (!aiConfigured && started && !run.cached);
  const fast = run.settings?.fast;

  const copy = () => {
    if (!answer) return;
    navigator.clipboard.writeText(answer).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); toast.success("Synthesis copied"); });
  };

  const emptyState = started ? (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="size-3.5 animate-pulse-soft text-primary" /> {fast ? "Drafting a fast answer from the structured results…" : "Reading the top authorities before answering…"}</div>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-11/12" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="mt-3 h-4 w-1/4" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-3/4" />
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-5" /></span>
      <div className="text-sm font-medium">Answer-first research synthesis</div>
      <div className="max-w-xs text-xs text-muted-foreground">Run a search. The agent reads the top authorities, answers first, then gives the analysis with numbered citations, jurisdictional caveats, contrary authority and next steps.</div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="size-4 text-primary" />
        <div className="text-sm font-semibold">Synthesis</div>
        {started && (fast ? <Badge variant="warning" className="py-0"><Zap className="size-3" /> Fast answer</Badge> : <Badge variant="accent" className="py-0">Full research</Badge>)}
        {run.cached && <Badge variant="muted" className="py-0">Cached</Badge>}
        {agent.isStreaming && <Badge variant="info" className="py-0 animate-pulse-soft">Working</Badge>}
        <div className="flex-1" />
        {answer && (
          <>
            <Tip label="Copy the synthesis as markdown"><Button variant="ghost" size="xs" onClick={copy}>{copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />} Copy</Button></Tip>
            <Tip label="Use this synthesis as the memo's brief answer and analysis"><Button variant="ghost" size="xs" onClick={() => onAddToMemo(answer)}><BookOpen className="size-3" /> To memo</Button></Tip>
          </>
        )}
      </div>

      {noKey ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
          <NoKeyCard />
          {run.cached && answer && <div className="mt-3"><MessageList messages={agent.messages} className="flex-none" userName={userName} /></div>}
        </div>
      ) : (
        <MessageList messages={agent.messages} statusLine={agent.statusLine} emptyState={emptyState} className="min-h-0" userName={userName} onRetry={(m) => m.role === "user" && onFollowUp(m.content)} />
      )}

      <div className="shrink-0 border-t p-2">
        <Composer
          placeholder={!started ? "Run a search first, then ask follow-ups here…" : run.cached ? "Re-run this search to ask follow-ups" : fast ? "Ask a follow-up (fast model)…" : "Ask a follow-up — e.g. “distinguish the contrary authority” or “draft the argument section”"}
          disabled={!started || Boolean(run.cached) || noKey}
          streaming={agent.isStreaming}
          onStop={agent.stop}
          onSend={(text) => onFollowUp(text)}
          minRows={1}
        />
      </div>
    </div>
  );
}
