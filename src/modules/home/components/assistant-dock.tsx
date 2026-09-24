"use client";
import * as React from "react";
import Link from "next/link";
import { KeyRound, PanelRightClose, RotateCcw, Scale, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Composer, MessageList, SuggestionChips } from "@/components/ai";
import { useAgent } from "@/hooks/use-agent";
import { useHomeUI } from "../store";
import { useHome } from "./home-provider";

const SUGGESTIONS = [
  "What is due this week on AFFF?",
  "Summarize yesterday's Federal Register PFAS items",
  "Draft a status update for Northgate",
  "Which of my tasks are overdue, and what should I do first?",
  "What did the team post about the Hale deposition?",
];

/** True while the viewport is narrower than `px` (false during SSR and before mount). */
function useNarrow(px: number) {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return narrow;
}

/**
 * Firm assistant. At xl and wider it is a fixed right column; below xl it opens
 * as a right-hand sheet so the overview keeps its width.
 */
export function AssistantDock() {
  const open = useHomeUI((s) => s.dockOpen);
  const setOpen = useHomeUI((s) => s.setDockOpen);
  const narrow = useNarrow(1280);

  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent width="max-w-md" className="w-full p-0" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Firm assistant</SheetTitle>
          <AssistantBody onCollapse={() => setOpen(false)} inSheet />
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) return null;
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l bg-card 2xl:w-[400px]" aria-label="Firm assistant">
      <AssistantBody onCollapse={() => setOpen(false)} />
    </aside>
  );
}

function AssistantBody({ onCollapse, inSheet }: { onCollapse: () => void; inSheet?: boolean }) {
  const { matterFilter, matterById, aiConfigured, userName } = useHome();
  const prefill = useHomeUI((s) => s.dockPrefill);
  const clearPrefill = useHomeUI((s) => s.clearDockPrefill);
  const [draft, setDraft] = React.useState("");
  const [noKey, setNoKey] = React.useState(!aiConfigured);
  const matter = matterById(matterFilter);

  const agent = useAgent({
    endpoint: "/api/ai/chat",
    extra: () => ({ matterId: matterFilter, research: { web: true, legal: true, internal: true } }),
    onEvent: (ev) => { if (ev.type === "error" && ev.code === "no_api_key") setNoKey(true); },
  });

  React.useEffect(() => {
    if (prefill) { setDraft(prefill.text); clearPrefill(); }
  }, [prefill, clearPrefill]);

  const send = (text: string) => { void agent.send(text); };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className={cn("section-header h-10", inSheet && "pr-10")}>
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-3" /></span>
        <div className="min-w-0 leading-tight">
          <div className="section-title">Firm assistant</div>
          <div className="truncate text-[10.5px] text-muted-foreground">{matter ? <span className="inline-flex items-center gap-1"><Scale className="size-2.5" />{matter.shortName}</span> : "Research, e-discovery, library and calendar tools"}</div>
        </div>
        <div className="flex-1" />
        {agent.messages.length > 0 && <Tip label="New conversation"><Button variant="ghost" size="icon-xs" onClick={() => { agent.reset(); setDraft(""); }} aria-label="New conversation"><RotateCcw className="size-3.5" /></Button></Tip>}
        {!inSheet && <Tip label="Collapse" shortcut="A"><Button variant="ghost" size="icon-xs" onClick={onCollapse} aria-label="Collapse assistant"><PanelRightClose className="size-3.5" /></Button></Tip>}
      </header>

      {noKey && (
        <div className="flex items-start gap-2 border-b bg-warning/10 px-3 py-2 text-[11.5px] text-warning-foreground dark:text-warning">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          <span><span className="font-semibold">OpenAI key required.</span> Add <code className="rounded bg-background/60 px-1 font-mono text-[10.5px]">OPENAI_API_KEY</code> to <code className="rounded bg-background/60 px-1 font-mono text-[10.5px]">.env.local</code> and restart to enable the assistant. <Link href="/settings#ai" className="underline underline-offset-2">Settings</Link></span>
        </div>
      )}

      <MessageList
        messages={agent.messages}
        statusLine={agent.statusLine}
        userName={userName}
        onRetry={(m) => send(m.content)}
        className="bg-background/40"
        emptyState={
          <div className="p-3">
            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-medium"><Sparkles className="size-3.5 text-primary" /> Ask about today</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">The assistant reads your calendar, tasks and matter context, searches the library and e-discovery sets, pulls case law and Federal Register documents, and drafts updates. Every answer cites its sources.</p>
              {matter && <Chip tone="accent" icon={Scale} className="mt-2">Scoped to {matter.shortName}</Chip>}
            </div>
            <div className="mt-3 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Try</div>
            <SuggestionChips className="mt-1.5" suggestions={SUGGESTIONS} onPick={send} />
          </div>
        }
      />

      <div className="shrink-0 border-t p-2.5">
        <Composer
          placeholder={matter ? `Ask about ${matter.shortName}…` : "Ask the firm assistant…"}
          value={draft}
          onValueChange={setDraft}
          streaming={agent.isStreaming}
          onStop={agent.stop}
          onSend={(text, attachments) => { void agent.send(text, { attachments }); }}
          minRows={2}
          className={cn(noKey && "opacity-80")}
        />
        <div className="mt-1 flex items-center justify-between px-0.5 text-[10px] text-muted-foreground">
          <span className="truncate">Web · CourtListener · Federal Register · Library · E-Discovery</span>
          <span><kbd>↵</kbd> send</span>
        </div>
      </div>
    </div>
  );
}
