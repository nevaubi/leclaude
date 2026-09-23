"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Copy, Eye, FileText, GripVertical, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { Markdown } from "@/components/ai/markdown";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { buildMemoMarkdown, memoTitle, splitSynthesis } from "../memo";
import { formatBluebook } from "../normalize";
import { SOURCE_SHORT, type SearchHit } from "../types";
import { useSearchStore } from "./store";
import { SOURCE_ICON } from "./result-card";

export interface MemoTrayProps {
  jurisdictionLabel: string;
  matter: { id: string; name: string; caption?: string } | null;
  currentQuery: string;
  currentSynthesis: string;
  onClose: () => void;
  onOpenHit: (hit: SearchHit) => void;
  userName?: string;
}

export function MemoTray({ jurisdictionLabel, matter, currentQuery, currentSynthesis, onClose, onOpenHit, userName = "Jordan Whitfield" }: MemoTrayProps) {
  const router = useRouter();
  const memo = useSearchStore((s) => s.memo);
  const memoQuestion = useSearchStore((s) => s.memoQuestion);
  const memoIssues = useSearchStore((s) => s.memoIssues);
  const memoSynthesis = useSearchStore((s) => s.memoSynthesis);
  const { removeFromMemo, setMemoNote, setMemoField, clearMemo } = useSearchStore.getState();
  const [preview, setPreview] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const question = memoQuestion.trim() || currentQuery;
  const synthesis = memoSynthesis || currentSynthesis;
  const markdown = React.useMemo(() => buildMemoMarkdown({ question: question || "[Question presented]", synthesis, sources: memo, openIssues: memoIssues.split("\n").map((s) => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean), author: userName, matterName: matter?.name, matterCaption: matter?.caption, jurisdictionLabel }), [question, synthesis, memo, memoIssues, userName, matter, jurisdictionLabel]);
  const derived = splitSynthesis(synthesis);

  const create = async () => {
    setCreating(true);
    try {
      const content = markdownToDoc(markdown);
      const res = await fetch("/api/office/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "word", title: memoTitle(question || "Untitled research"), content, matterId: matter?.id, tags: ["research memo"], meta: { source: "search-memo", sources: memo.map((m) => m.hit.id), jurisdiction: jurisdictionLabel } }) });
      const j = (await res.json()) as { doc?: { id: string }; error?: string };
      if (!res.ok || !j.doc) throw new Error(j.error ?? res.statusText);
      toast.success("Memo created", { description: "Opening in Word…" });
      router.push(`/office/word/${j.doc.id}`);
    } catch (e) {
      toast.error("Could not create the memo", { description: e instanceof Error ? e.message : String(e) });
    } finally { setCreating(false); }
  };

  const copy = () => navigator.clipboard.writeText(markdown).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); toast.success("Memo markdown copied"); });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <BookOpen className="size-4 text-primary" />
        <div className="text-sm font-semibold">Memo</div>
        <Badge variant="muted" className="py-0 tabular">{memo.length}</Badge>
        <div className="flex-1" />
        <Tip label={preview ? "Edit" : "Preview memo"}><Button variant="ghost" size="icon-xs" onClick={() => setPreview((v) => !v)} aria-label="Toggle preview"><Eye className={cn("size-3.5", preview && "text-primary")} /></Button></Tip>
        <Tip label="Clear memo tray"><Button variant="ghost" size="icon-xs" onClick={() => { if (memo.length === 0 || confirm("Clear the memo tray?")) clearMemo(); }} aria-label="Clear memo"><Trash2 className="size-3.5" /></Button></Tip>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close memo tray"><X className="size-3.5" /></Button>
      </div>

      {preview ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin"><Markdown compact>{markdown}</Markdown></div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <section className="border-b p-3">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><span>Question presented</span>{matter && <span className="normal-case tracking-normal font-normal truncate max-w-[60%]" title={matter.name}>{matter.name}</span>}</div>
            <Textarea value={memoQuestion} onChange={(e) => setMemoField("memoQuestion", e.target.value)} placeholder={currentQuery || "Whether…"} className="min-h-[56px] text-xs" />
          </section>

          <section className="border-b p-3">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Brief answer & analysis</span>
              {currentSynthesis && memoSynthesis !== currentSynthesis && <button onClick={() => setMemoField("memoSynthesis", currentSynthesis)} className="normal-case tracking-normal font-medium text-primary hover:underline cursor-pointer inline-flex items-center gap-1"><Sparkles className="size-3" /> use current synthesis</button>}
            </div>
            {synthesis ? (
              <div className="rounded-md border bg-muted/30 p-2 text-[12px]">
                <div className="line-clamp-4 leading-relaxed">{derived.briefAnswer || synthesis.slice(0, 300)}</div>
                <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted-foreground"><span>{synthesis.length.toLocaleString()} chars</span>{memoSynthesis && <button onClick={() => setMemoField("memoSynthesis", "")} className="hover:text-foreground cursor-pointer">clear</button>}</div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-2 text-[11.5px] text-muted-foreground">Run a search; the synthesis fills the brief answer and analysis. You can also paste your own in the Word editor.</div>
            )}
          </section>

          <section className="border-b p-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Authorities · {memo.length}</div>
            {memo.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11.5px] text-muted-foreground">Add sources with the <span className="font-medium text-foreground">Memo</span> button on a result (or press <kbd>m</kbd>). Each becomes a row in the authorities table.</div>
            ) : (
              <ul className="space-y-1.5">
                {memo.map((m, i) => {
                  const Icon = SOURCE_ICON[m.hit.source];
                  return (
                    <li key={m.hit.id} className="group rounded-md border bg-card p-2">
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                        <span className="mt-0.5 tabular text-[10.5px] text-muted-foreground">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <button onClick={() => onOpenHit(m.hit)} className="text-left text-[12px] font-medium leading-snug hover:text-primary hover:underline cursor-pointer line-clamp-2">{m.hit.title}</button>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
                            <Icon className="size-3" /> {SOURCE_SHORT[m.hit.source]}
                            {m.hit.cite && <span className="font-mono">· {m.hit.cite}</span>}
                            {m.hit.date && <span>· {formatDate(m.hit.date)}</span>}
                            {m.hit.authority && m.hit.authority !== "n/a" && <Badge variant={m.hit.authority === "binding" ? "success" : "muted"} className="py-0 capitalize">{m.hit.authority}</Badge>}
                          </div>
                          <div className="mt-1 text-[10.5px] text-muted-foreground line-clamp-1" title={formatBluebook(m.hit)}>{formatBluebook(m.hit)}</div>
                          <input value={m.note ?? ""} onChange={(e) => setMemoNote(m.hit.id, e.target.value)} placeholder="Holding / relevance (table column)" className="mt-1 h-6 w-full rounded border bg-background px-1.5 text-[11px] outline-none focus:border-ring" />
                        </div>
                        <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" onClick={() => removeFromMemo(m.hit.id)} aria-label="Remove"><X className="size-3" /></Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Open issues (one per line)</div>
            <Textarea value={memoIssues} onChange={(e) => setMemoField("memoIssues", e.target.value)} placeholder={"Verify subsequent history for [2]\nConfirm choice-of-law clause"} className="min-h-[64px] text-xs" />
          </section>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1.5 border-t p-2">
        <Button size="sm" onClick={create} disabled={creating || (!memo.length && !synthesis)} className="flex-1">{creating ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} Create memo document</Button>
        <Tip label="Copy memo markdown"><Button size="icon-sm" variant="outline" onClick={copy} aria-label="Copy markdown">{copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}</Button></Tip>
      </div>
    </div>
  );
}
