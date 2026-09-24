"use client";
import * as React from "react";
import { AlertCircle, RotateCcw, Copy, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { ToolActivityList, CitationList } from "./tool-activity";
import type { AgentMessage } from "@/hooks/use-agent";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/ui/avatar";

export function MessageList({ messages, statusLine, className, emptyState, userName = "You", onRetry }: { messages: AgentMessage[]; statusLine?: string | null; className?: string; emptyState?: React.ReactNode; userName?: string; onRetry?: (m: AgentMessage) => void }) {
  const endRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [stick, setStick] = React.useState(true);
  React.useEffect(() => { if (stick) endRef.current?.scrollIntoView({ block: "end" }); }, [messages, statusLine, stick]);
  return (
    <div
      ref={containerRef}
      className={cn("flex-1 overflow-y-auto scrollbar-thin", className)}
      onScroll={(e) => { const el = e.currentTarget; setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80); }}
    >
      {messages.length === 0 && emptyState}
      <div className="space-y-3 p-3">
        {messages.map((m, i) => (
          <MessageBubble key={m.id} message={m} userName={userName} onRetry={onRetry && m.role === "assistant" && m.status === "error" ? () => onRetry(messages[i - 1] ?? m) : undefined} />
        ))}
        {statusLine && (
          <div className="flex items-center gap-2 pl-8 text-[11.5px] text-muted-foreground" role="status"><Loader2 className="size-3 animate-spin" aria-hidden />{statusLine}</div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export function MessageBubble({ message: m, userName, onRetry }: { message: AgentMessage; userName: string; onRetry?: () => void }) {
  const [copied, setCopied] = React.useState(false);
  if (m.role === "user") {
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
          <div className="rounded-md bg-accent/60 px-3 py-1.5 text-[13px] whitespace-pre-wrap">{m.content}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5 group">
      <AssistantMark />
      <div className="min-w-0 flex-1 space-y-2">
        {m.tools && m.tools.length > 0 && <ToolActivityList tools={m.tools} />}
        {m.content ? <Markdown>{m.content}</Markdown> : m.status === "streaming" ? <div className="h-3.5 w-24 rounded bg-muted" aria-hidden /> : null}
        {m.status === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <div className="flex-1">{m.error ?? "Something went wrong."}</div>
            {onRetry && <Button variant="ghost" size="xs" onClick={onRetry}><RotateCcw className="size-3" /> Retry</Button>}
          </div>
        )}
        {m.status === "stopped" && <div className="text-[11px] text-muted-foreground">Stopped.</div>}
        {m.citations && m.citations.length > 0 && <CitationList citations={m.citations} />}
        {m.content && m.status === "done" && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => { navigator.clipboard.writeText(m.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}>
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Monochrome assistant mark: a single initial in a quiet circle (no glyph, no colour wash). */
export function AssistantMark({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("mt-0.5 flex shrink-0 items-center justify-center rounded-full border bg-muted font-serif font-semibold text-muted-foreground", size === "sm" ? "size-6 text-[11px]" : "size-7 text-[12px]", className)} aria-label="Assistant" role="img">A</span>
  );
}

export function SuggestionChips({ suggestions, onPick, className }: { suggestions: string[]; onPick: (s: string) => void; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {suggestions.map((s) => (
        <button key={s} onClick={() => onPick(s)} className="rounded-md border px-2.5 py-1.5 text-left text-[12px] text-foreground/90 hover:bg-accent hover:border-foreground/20 transition-colors cursor-pointer">{s}</button>
      ))}
    </div>
  );
}
