"use client";
/** Slide-anchored comments (anchor "slide:<id>") with replies and resolution. */
import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, CornerDownRight, MessageSquare, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OfficeComment } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PersonAvatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/misc";
import { slideTitle, type DeckSlide } from "./model";

export interface CommentsPanelProps {
  comments: OfficeComment[];
  slides: DeckSlide[];
  currentSlideId: string | null;
  onAdd: (anchor: string, body: string) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onGoTo: (slideId: string) => void;
  onClose: () => void;
  className?: string;
}

export function commentSlideId(anchor: string): string | null { return anchor.startsWith("slide:") ? anchor.slice(6) : null; }

export function CommentsPanel({ comments, slides, currentSlideId, onAdd, onReply, onResolve, onDelete, onGoTo, onClose, className }: CommentsPanelProps) {
  const [draft, setDraft] = React.useState("");
  const [allSlides, setAllSlides] = React.useState(false);
  const [showResolved, setShowResolved] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const [replyDraft, setReplyDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const indexOf = (id: string | null) => slides.findIndex((s) => s.id === id);
  const visible = comments.filter((c) => (showResolved || !c.resolved) && (allSlides || commentSlideId(c.anchor) === currentSlideId)).sort((a, b) => (allSlides ? indexOf(commentSlideId(a.anchor)) - indexOf(commentSlideId(b.anchor)) : 0) || a.createdAt.localeCompare(b.createdAt));
  const submit = async () => { if (!draft.trim() || !currentSlideId) return; setBusy(true); try { await onAdd(`slide:${currentSlideId}`, draft.trim()); setDraft(""); } finally { setBusy(false); } };
  const submitReply = async (id: string) => { if (!replyDraft.trim()) return; setBusy(true); try { await onReply(id, replyDraft.trim()); setReplyDraft(""); setReplyTo(null); } finally { setBusy(false); } };
  return (
    <div className={cn("flex h-full w-[300px] shrink-0 flex-col border-l bg-background", className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <MessageSquare className="size-4 text-primary" />
        <span className="text-xs font-semibold">Comments</span>
        <span className="text-[11px] text-muted-foreground">{comments.filter((c) => !c.resolved).length} open</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close comments"><X className="size-4" /></Button>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1.5 cursor-pointer"><Switch size="sm" checked={allSlides} onCheckedChange={setAllSlides} /> All slides</label>
        <label className="flex items-center gap-1.5 cursor-pointer"><Switch size="sm" checked={showResolved} onCheckedChange={setShowResolved} /> Resolved</label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2">
        {visible.length === 0 && <EmptyState icon={MessageSquare} title={allSlides ? "No comments yet" : "No comments on this slide"} description="Comments are anchored to slides and visible to the matter team." className="m-1 p-6" />}
        <ul className="space-y-1.5">
          {visible.map((c) => {
            const sid = commentSlideId(c.anchor);
            const idx = indexOf(sid);
            return (
              <li key={c.id} className={cn("rounded-md border bg-card p-2 text-xs", c.resolved && "opacity-60")}>
                <div className="flex items-center gap-1.5">
                  {c.source === "agent" ? <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-3" /></span> : <PersonAvatar name={c.authorName} className="size-5 text-[9px]" />}
                  <span className="truncate font-medium">{c.authorName}</span>
                  <span className="text-[10px] text-muted-foreground" title={new Date(c.createdAt).toLocaleString()}>{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                  <div className="flex-1" />
                  {idx >= 0 && <button onClick={() => sid && onGoTo(sid)} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer" title={slideTitle(slides[idx])}>Slide {idx + 1}</button>}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed">{c.body}</div>
                {(c.replies ?? []).length > 0 && (
                  <ul className="mt-1.5 space-y-1 border-l pl-2">
                    {c.replies!.map((r) => <li key={r.id}><div className="flex items-center gap-1 text-[10px] text-muted-foreground"><CornerDownRight className="size-3" /><span className="font-medium text-foreground">{r.authorName}</span><span>{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span></div><div className="text-[12px]">{r.body}</div></li>)}
                  </ul>
                )}
                {replyTo === c.id ? (
                  <div className="mt-1.5 space-y-1">
                    <Textarea autoFocus value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} placeholder="Reply…" className="min-h-[56px] text-xs" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitReply(c.id); if (e.key === "Escape") setReplyTo(null); }} />
                    <div className="flex gap-1"><Button size="xs" onClick={() => void submitReply(c.id)} disabled={busy}>Reply</Button><Button size="xs" variant="ghost" onClick={() => setReplyTo(null)}>Cancel</Button></div>
                  </div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-1">
                    <button className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => { setReplyTo(c.id); setReplyDraft(""); }}>Reply</button>
                    <span className="text-muted-foreground/40">·</span>
                    <button className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => void onResolve(c.id, !c.resolved)}><Check className="size-3" /> {c.resolved ? "Reopen" : "Resolve"}</button>
                    <div className="flex-1" />
                    <button className="text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => void onDelete(c.id)} aria-label="Delete comment"><Trash2 className="size-3" /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="shrink-0 border-t p-2">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={currentSlideId ? `Comment on slide ${indexOf(currentSlideId) + 1}… (⌘↵ to post)` : "Select a slide"} className="min-h-[64px] text-xs" disabled={!currentSlideId} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }} />
        <div className="mt-1.5 flex justify-end"><Button size="sm" onClick={() => void submit()} disabled={!draft.trim() || busy || !currentSlideId}>Comment</Button></div>
      </div>
    </div>
  );
}
