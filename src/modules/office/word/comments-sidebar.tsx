"use client";
import * as React from "react";
import type { Editor } from "@tiptap/core";
import { Check, CornerDownRight, MessageSquare, MoreHorizontal, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { OfficeComment } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/misc";
import { findBlockPos } from "./extensions";

export interface CommentsSidebarProps {
  editor: Editor;
  comments: OfficeComment[];
  activeId: string | null;
  onActive: (id: string | null) => void;
  onReply: (id: string, body: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLocate: (c: OfficeComment) => void;
  showResolved: boolean;
  onShowResolved: (v: boolean) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  /** Bumps when the document layout may have changed (typing, resize). */
  layoutKey: number;
  onClose: () => void;
}

interface Placed { c: OfficeComment; top: number; pos: number }

/** Position of a comment anchor: mark range if present, otherwise its block. */
export function commentAnchorPos(editor: Editor, c: OfficeComment): number | null {
  let markPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (markPos != null) return false;
    if (node.isText && node.marks.some((m) => m.type.name === "comment" && m.attrs.id === c.id)) { markPos = pos; return false; }
    return true;
  });
  if (markPos != null) return markPos;
  const b = findBlockPos(editor.state.doc, c.anchor);
  return b ? b.pos + 1 : null;
}

export function CommentsSidebar(props: CommentsSidebarProps) {
  const { editor, comments, activeId, onActive, onReply, onResolve, onDelete, onLocate, showResolved, onShowResolved, canvasRef, layoutKey, onClose } = props;
  const [placed, setPlaced] = React.useState<Placed[]>([]);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const columnRef = React.useRef<HTMLDivElement>(null);
  const visible = React.useMemo(() => comments.filter((c) => showResolved || !c.resolved), [comments, showResolved]);

  // Layout: anchor top offsets → cards, pushed down to avoid overlap.
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const column = columnRef.current;
    if (!canvas || !column) return;
    const colRect = column.getBoundingClientRect();
    const items: Placed[] = [];
    for (const c of visible) {
      const pos = commentAnchorPos(editor, c);
      if (pos == null) continue;
      try {
        const coords = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
        items.push({ c, pos, top: Math.max(0, coords.top - colRect.top - 4) });
      } catch { /* skip */ }
    }
    items.sort((a, b) => a.pos - b.pos);
    let cursor = 8;
    const gap = 8;
    const activeIdx = items.findIndex((i) => i.c.id === activeId);
    // Active card stays at its anchor; others flow around it.
    const heights = items.map((i) => cardRefs.current.get(i.c.id)?.offsetHeight ?? 120);
    const out: Placed[] = items.map((i) => ({ ...i }));
    for (let i = 0; i < out.length; i++) {
      out[i].top = Math.max(out[i].top, cursor);
      cursor = out[i].top + heights[i] + gap;
    }
    if (activeIdx >= 0) {
      const anchorTop = items[activeIdx].top;
      if (out[activeIdx].top > anchorTop) {
        // Shift the cards above upward so the active one sits at its anchor.
        const shift = out[activeIdx].top - anchorTop;
        for (let i = activeIdx; i >= 0; i--) out[i].top -= shift;
        let floor = -Infinity;
        for (let i = 0; i <= activeIdx; i++) { out[i].top = Math.max(out[i].top, floor === -Infinity ? 8 : floor); floor = out[i].top + heights[i] + gap; }
      }
    }
    setPlaced(out);
  }, [visible, editor, canvasRef, layoutKey, activeId]);

  const height = placed.length ? Math.max(...placed.map((p) => p.top + (cardRefs.current.get(p.c.id)?.offsetHeight ?? 120))) + 40 : 0;

  return (
    <div ref={columnRef} className="relative w-[260px] shrink-0 pl-3 pr-1" style={{ minHeight: height }}>
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 rounded-md border bg-background/90 px-2 py-1 text-xs backdrop-blur">
        <MessageSquare className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Comments</span>
        <span className="tabular text-muted-foreground">{comments.filter((c) => !c.resolved).length} open</span>
        <div className="flex-1" />
        <button onClick={() => onShowResolved(!showResolved)} className={cn("whitespace-nowrap text-[11px] hover:text-foreground cursor-pointer", showResolved ? "text-primary" : "text-muted-foreground")} title="Toggle resolved comments">Resolved</button>
        <button onClick={onClose} aria-label="Hide comments" className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"><X className="size-3.5" /></button>
      </div>
      {!visible.length && <div className="pt-6"><EmptyState icon={MessageSquare} title="No comments" description="Select text and press ⌘⇧C, or ask the agent to review the document." className="p-6" /></div>}
      {placed.map(({ c, top }) => (
        <div key={c.id} ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }} style={{ position: "absolute", top, left: 12, right: 4 }} className={cn("comment-card rounded-lg border bg-card p-2.5 text-xs shadow-xs", c.resolved && "opacity-60")} data-active={activeId === c.id} onClick={() => { onActive(c.id); onLocate(c); }}>
          <CommentCard c={c} active={activeId === c.id} onReply={onReply} onResolve={onResolve} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}

function CommentCard({ c, active, onReply, onResolve, onDelete }: { c: OfficeComment; active: boolean; onReply: (id: string, body: string) => Promise<void>; onResolve: (id: string, resolved: boolean) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const isAgent = c.source === "agent";
  const submit = async () => { if (!reply.trim()) return; setBusy(true); try { await onReply(c.id, reply.trim()); setReply(""); } finally { setBusy(false); } };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {isAgent ? <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-3" /></span> : <PersonAvatar name={c.authorName} size="sm" />}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-medium">{c.authorName}</div>
          <div className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}{c.resolved && " · resolved"}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button aria-label="Comment actions" onClick={(e) => e.stopPropagation()} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onResolve(c.id, !c.resolved)}>{c.resolved ? <><RotateCcw /> Reopen</> : <><Check /> Resolve</>}</DropdownMenuItem>
            <DropdownMenuItem destructive onClick={() => onDelete(c.id)}><Trash2 /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!c.resolved && <button aria-label="Resolve" onClick={(e) => { e.stopPropagation(); void onResolve(c.id, true); }} className="rounded p-0.5 text-muted-foreground hover:bg-success/10 hover:text-success cursor-pointer"><Check className="size-3.5" /></button>}
      </div>
      {c.quote && <div className="border-l-2 border-warning/60 pl-2 text-[11px] italic text-muted-foreground line-clamp-2">“{c.quote}”</div>}
      <div className="whitespace-pre-wrap leading-relaxed">{c.body}</div>
      {c.replies?.map((r) => (
        <div key={r.id} className="flex gap-1.5 pl-1 pt-1">
          <CornerDownRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1"><span className="font-medium">{r.authorName}</span> <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span><div className="whitespace-pre-wrap">{r.body}</div></div>
        </div>
      ))}
      {active && !c.resolved && (
        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }} placeholder="Reply… (⌘↵)" className="min-h-[52px] text-xs" />
          <div className="mt-1 flex justify-end gap-1"><Button size="xs" variant="ghost" onClick={() => setReply("")}>Cancel</Button><Button size="xs" disabled={!reply.trim() || busy} onClick={() => void submit()}>Reply</Button></div>
        </div>
      )}
    </div>
  );
}
