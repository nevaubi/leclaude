"use client";
import * as React from "react";
import Link from "next/link";
import { KeyRound, Library, RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Composer } from "@/components/ai/composer";
import { MessageList, SuggestionChips } from "@/components/ai/chat";
import { useAgent } from "@/hooks/use-agent";
import { useLibrary } from "./library-provider";
import { useLibraryUI } from "./store";

const LIBRARY_INSTRUCTIONS = `You are the firm's Library assistant. Your only sources are the firm library (templates, clause bank, knowledge notes, links, matter folders) and matter documents reachable through the internal search tools. Always search the library first (search_library / get_library_item) before answering; quote the item name you relied on and link it as /library?item=<id>. If the library does not cover the question, say so plainly and suggest which note or clause should be created. Never invent authorities. When asked for a clause, return the clause text with its {{variables}} and mention the drafting notes.`;

/** Right-hand "Ask the library" chat dock (internal research only). */
export function AskLibraryPanel({ className }: { className?: string }) {
  const { aiConfigured, currentMatterId, list, view, matters } = useLibrary();
  const setAskOpen = useLibraryUI((s) => s.setAskOpen);
  const agent = useAgent({ endpoint: "/api/ai/chat", extra: () => ({ research: { web: false, legal: false, internal: true }, matterId: currentMatterId, instructions: LIBRARY_INSTRUCTIONS }) });
  const noKey = !aiConfigured || agent.messages.some((m) => m.status === "error" && /OPENAI_API_KEY|key required/i.test(m.error ?? ""));
  const matter = matters.find((m) => m.id === currentMatterId);

  const suggestions = React.useMemo(() => {
    const folder = list?.folder?.name;
    const base = [
      "Which clause should I use for a mutual consequential-damages waiver, and what are the drafting notes?",
      "Summarize the CMO 26 deadlines for the AFFF matter and list the open issues.",
      "What does the firm citation style say about record cites and the [VERIFY] convention?",
      "Give me the deposition objection rules for instructing a witness not to answer.",
    ];
    if (matter) base.unshift(`What library items relate to ${matter.shortName}, and what is most recent?`);
    if (folder && view === "folder") base.unshift(`What is in the “${folder}” folder and which items are approved?`);
    return base.slice(0, 5);
  }, [list, matter, view]);

  return (
    <aside className={cn("flex h-full min-h-0 w-[380px] shrink-0 flex-col border-l bg-background", className)}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="size-4 text-primary" />
        <div className="text-sm font-semibold">Ask the library</div>
        <Badge variant="muted" className="text-[10px]">internal only</Badge>
        <div className="flex-1" />
        <Tip label="New conversation"><Button variant="ghost" size="icon-xs" onClick={agent.reset} aria-label="Reset"><RotateCcw className="size-3.5" /></Button></Tip>
        <Tip label="Close" shortcut="A"><Button variant="ghost" size="icon-xs" onClick={() => setAskOpen(false)} aria-label="Close"><X className="size-4" /></Button></Tip>
      </header>
      {noKey && (
        <div className="flex items-start gap-2 border-b bg-warning/10 px-3 py-2 text-xs">
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <div>OpenAI key required. Add <code className="font-mono">OPENAI_API_KEY</code> to <code className="font-mono">.env.local</code> (see <Link href="/settings#ai" className="text-primary underline">Settings</Link>). Search, browsing and editing work without it.</div>
        </div>
      )}
      <MessageList
        messages={agent.messages}
        statusLine={agent.statusLine}
        userName="Jordan Whitfield"
        onRetry={(m) => void agent.send(m.content)}
        emptyState={
          <div className="space-y-3 p-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><Library className="size-3.5" /> Grounded in the firm library</div>
              Answers cite clauses, notes, templates and matter documents; web and case-law research are off here (use Search for those).{matter && <> Current matter context: <span className="font-medium text-foreground">{matter.shortName}</span>.</>}
            </div>
            <SuggestionChips suggestions={suggestions} onPick={(s) => void agent.send(s)} />
          </div>
        }
      />
      <div className="shrink-0 border-t p-2">
        <Composer placeholder="Ask about clauses, notes, templates…" streaming={agent.isStreaming} onSend={(t, atts) => void agent.send(t, { attachments: atts })} onStop={agent.stop} minRows={1} />
      </div>
    </aside>
  );
}
