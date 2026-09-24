"use client";
import * as React from "react";
import Link from "next/link";
import { KeyRound, Library, MessageSquareText, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Inspector } from "@/components/ui/inspector";
import { Composer } from "@/components/ai/composer";
import { MessageList, SuggestionChips } from "@/components/ai/chat";
import { useAgent } from "@/hooks/use-agent";
import { currentUser } from "@/lib/current-user";
import { useLibrary } from "./library-provider";
import { useLibraryUI } from "./store";

const LIBRARY_INSTRUCTIONS = `You are the firm's Library assistant. Your only sources are the firm library (templates, clause bank, knowledge notes, links, matter folders) and matter documents reachable through the internal search tools. Always search the library first (search_library / get_library_item) before answering; quote the item name you relied on and link it as /library?item=<id>. If the library does not cover the question, say so plainly and suggest which note or clause should be created. Never invent authorities. When asked for a clause, return the clause text with its {{variables}} and mention the drafting notes.`;

/** Right-hand "Ask the library" inspector (internal research only). */
export function AskLibraryPanel({ className }: { className?: string }) {
  const { aiConfigured, currentMatterId, list, view, matters } = useLibrary();
  const setAskOpen = useLibraryUI((s) => s.setAskOpen);
  const agent = useAgent({ endpoint: "/api/ai/chat", extra: () => ({ research: { web: false, legal: false, internal: true }, matterId: currentMatterId, instructions: LIBRARY_INSTRUCTIONS }) });
  const noKey = !aiConfigured || agent.messages.some((m) => m.status === "error" && /OPENAI_API_KEY|key required/i.test(m.error ?? ""));
  const matter = matters.find((m) => m.id === currentMatterId);
  const [width, setWidth] = React.useState(380);

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
    <Inspector
      icon={MessageSquareText}
      title="Ask the library"
      subtitle={matter ? `Internal only · ${matter.shortName}` : "Internal only: clauses, notes, templates, matter documents"}
      width={width}
      resizable
      minWidth={320}
      maxWidth={560}
      onWidthChange={setWidth}
      onClose={() => setAskOpen(false)}
      closeShortcut="A"
      actions={<Tip label="New conversation"><Button variant="ghost" size="icon-xs" onClick={agent.reset} aria-label="Reset"><RotateCcw className="size-3.5" /></Button></Tip>}
      className={cn("hidden lg:flex", className)}
      bodyClassName="flex flex-col"
      footer={<div className="p-2"><Composer placeholder="Ask about clauses, notes, templates…" streaming={agent.isStreaming} onSend={(t, atts) => void agent.send(t, { attachments: atts })} onStop={agent.stop} minRows={1} /></div>}
      ariaLabel="Ask the library"
    >
      {noKey && (
        <div className="flex items-start gap-2 border-b bg-warning/10 px-3 py-2 text-[11.5px]">
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <div>OpenAI key required. Add <code className="font-mono">OPENAI_API_KEY</code> to <code className="font-mono">.env.local</code> (see <Link href="/settings#ai" className="text-primary underline">Settings</Link>). Search, browsing and editing work without it.</div>
        </div>
      )}
      <MessageList
        messages={agent.messages}
        statusLine={agent.statusLine}
        userName={currentUser().name}
        onRetry={(m) => void agent.send(m.content)}
        className="min-h-0 flex-1"
        emptyState={
          <div className="space-y-3 p-3">
            <div className="text-[11.5px] leading-relaxed text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-foreground"><Library className="size-3.5" /> Grounded in the firm library</div>
              Answers cite clauses, notes, templates and matter documents; web and case-law research are off here (use Search for those).{matter && <> Current matter context: <span className="font-medium text-foreground">{matter.shortName}</span>.</>}
            </div>
            <SuggestionChips suggestions={suggestions} onPick={(s) => void agent.send(s)} />
          </div>
        }
      />
    </Inspector>
  );
}
