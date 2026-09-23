"use client";
import * as React from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CaseSensitive, ChevronDown, ChevronUp, ListTree, Regex, Replace, ReplaceAll, Search, WholeWord, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/misc";
import { wordCount } from "./doc-model";
import { findKey, findRanges, type FindQuery } from "./extensions";
import { buildTrackedInline } from "./tracked-diff";
import type { PMNode } from "./doc-model";

export interface OutlineItem { id: string; level: number; text: string; pos: number; words: number; index: number }

/** Headings with word counts of the section that follows each. */
export function computeOutline(editor: Editor): OutlineItem[] {
  const out: OutlineItem[] = [];
  let n = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock || node.type.name === "image" || node.type.name === "pageBreak" || node.type.name === "horizontalRule") n++;
    if (node.type.name === "heading") { out.push({ id: String(node.attrs.id ?? ""), level: Number(node.attrs.level ?? 1), text: node.textContent, pos, words: 0, index: n }); return false; }
    if (node.isTextblock && out.length) { out[out.length - 1].words += wordCount(node.textContent); return false; }
    return true;
  });
  return out;
}

export type SidebarTab = "outline" | "find";

export function WordSidebar({ editor, tab, onTab, outline, currentHeadingId, onClose, findFocusKey }: { editor: Editor; tab: SidebarTab; onTab: (t: SidebarTab) => void; outline: OutlineItem[]; currentHeadingId: string | null; onClose: () => void; findFocusKey: number }) {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        {([["outline", "Outline", ListTree], ["find", "Find & Replace", Search]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => onTab(id)} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer", tab === id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="size-3.5" />{label}</button>
        ))}
        <div className="flex-1" />
        <Tip label="Close sidebar" shortcut="⌘⇧O"><Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close sidebar"><X className="size-3.5" /></Button></Tip>
      </div>
      {tab === "outline" ? <OutlinePanel editor={editor} outline={outline} currentHeadingId={currentHeadingId} /> : <FindReplacePanel editor={editor} focusKey={findFocusKey} />}
    </aside>
  );
}

function OutlinePanel({ editor, outline, currentHeadingId }: { editor: Editor; outline: OutlineItem[]; currentHeadingId: string | null }) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: outline.length, getScrollElement: () => parentRef.current, estimateSize: () => 30, overscan: 12 });
  const go = (item: OutlineItem) => {
    editor.chain().focus().setTextSelection(item.pos + 1).run();
    const dom = editor.view.nodeDOM(item.pos) as HTMLElement | null;
    dom?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  if (!outline.length) return <div className="p-3"><EmptyState icon={ListTree} title="No headings yet" description="Use Heading 1–3 styles (⌘⌥1–3) to build an outline. The agent can also structure the document for you." className="p-6" /></div>;
  const total = outline.reduce((n, o) => n + o.words, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground"><span>{outline.length} headings</span><span className="tabular">{total.toLocaleString()} words</span></div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-1.5 pb-2">
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const item = outline[v.index];
            const active = item.id === currentHeadingId;
            return (
              <button key={item.id || v.index} onClick={() => go(item)} title={item.text} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: v.size, transform: `translateY(${v.start}px)` }} className={cn("flex items-center gap-2 rounded-md px-2 text-left text-xs transition-colors cursor-pointer", active ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground/85")}>
                <span className="shrink-0" style={{ width: (item.level - 1) * 12 }} />
                <span className={cn("shrink-0 text-[10px] tabular", active ? "text-primary/80" : "text-muted-foreground/70")}>H{item.level}</span>
                <span className={cn("min-w-0 flex-1 truncate", item.level === 1 && "font-medium")}>{item.text || <span className="italic text-muted-foreground">Untitled heading</span>}</span>
                <span className="shrink-0 text-[10px] tabular text-muted-foreground">{item.words}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FindReplacePanel({ editor, focusKey }: { editor: Editor; focusKey: number }) {
  const [query, setQuery] = React.useState("");
  const [replace, setReplace] = React.useState("");
  const [regex, setRegex] = React.useState(false);
  const [caseSensitive, setCase] = React.useState(false);
  const [wholeWord, setWhole] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [count, setCount] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [focusKey]);

  const run = React.useCallback((q: FindQuery) => {
    const ranges = findRanges(editor.state.doc, q);
    setCount(ranges.length);
    const idx = ranges.length ? Math.min(Math.max(0, q.current ?? 0), ranges.length - 1) : -1;
    editor.view.dispatch(editor.state.tr.setMeta("find", { ...q, current: idx }));
    if (idx >= 0) {
      const r = ranges[idx];
      try { const dom = editor.view.domAtPos(r.from).node; const el = dom instanceof HTMLElement ? dom : dom.parentElement; el?.scrollIntoView({ block: "center" }); } catch { /* ignore */ }
    }
    return ranges;
  }, [editor]);

  React.useEffect(() => {
    const t = setTimeout(() => { setCurrent(0); run({ text: query, regex, caseSensitive, wholeWord, current: 0 }); }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, regex, caseSensitive, wholeWord]);

  React.useEffect(() => () => { editor.view.dispatch(editor.state.tr.setMeta("find", null)); }, [editor]);

  const step = (dir: 1 | -1) => {
    if (!count) return;
    const next = (current + dir + count) % count;
    setCurrent(next);
    run({ text: query, regex, caseSensitive, wholeWord, current: next });
  };

  const doReplace = (all: boolean) => {
    const state = findKey.getState(editor.state);
    if (!state?.ranges.length) return;
    const ranges = all ? state.ranges : [state.ranges[Math.max(0, state.current)]];
    const tracking = (editor.storage as unknown as { trackChanges: { enabled: boolean; author: string } }).trackChanges;
    const tr = editor.state.tr;
    const sorted = [...ranges].sort((a, b) => b.from - a.from);
    for (const r of sorted) {
      const matched = editor.state.doc.textBetween(r.from, r.to);
      let rep = replace;
      if (regex) { try { rep = matched.replace(new RegExp(query, `u${caseSensitive ? "" : "i"}`), replace); } catch { /* keep */ } }
      const $from = editor.state.doc.resolve(r.from);
      const marks = $from.marks();
      if (tracking?.enabled) {
        const old = [{ type: "text", text: matched, marks: marks.map((m) => m.toJSON() as { type: string; attrs?: Record<string, unknown> }) }] as PMNode[];
        const next = rep ? [{ type: "text", text: rep, marks: marks.map((m) => m.toJSON() as { type: string; attrs?: Record<string, unknown> }) }] as PMNode[] : [];
        const content = buildTrackedInline(old, next, { change: { id: `fr_${Date.now().toString(36)}`, author: tracking.author, date: new Date().toISOString() } });
        tr.replaceWith(r.from, r.to, content.map((n) => editor.state.schema.nodeFromJSON(n)));
      } else {
        if (rep) tr.replaceWith(r.from, r.to, editor.state.schema.text(rep, marks)); else tr.delete(r.from, r.to);
      }
    }
    tr.setMeta("trackChanges", "ignore");
    editor.view.dispatch(tr);
    toast.success(all ? `Replaced ${ranges.length} occurrence${ranges.length === 1 ? "" : "s"}` : "Replaced");
    setTimeout(() => run({ text: query, regex, caseSensitive, wholeWord, current: Math.min(current, Math.max(0, count - 2)) }), 0);
  };

  const selectCurrent = () => {
    const state = findKey.getState(editor.state);
    const r = state?.ranges[state.current];
    if (!r) return;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, r.from, r.to)).scrollIntoView());
    editor.view.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === "Escape") { setQuery(""); editor.view.focus(); } }} placeholder="Find in document" className="h-8 pl-7 pr-16 text-xs" aria-label="Find" />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular text-muted-foreground">{query ? (count ? `${current + 1}/${count}` : "0/0") : ""}</span>
      </div>
      <div className="flex items-center gap-0.5">
        <Tip label="Match case"><button onClick={() => setCase((v) => !v)} aria-pressed={caseSensitive} className={cn("rounded p-1 cursor-pointer", caseSensitive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}><CaseSensitive className="size-4" /></button></Tip>
        <Tip label="Whole word"><button onClick={() => setWhole((v) => !v)} aria-pressed={wholeWord} className={cn("rounded p-1 cursor-pointer", wholeWord ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}><WholeWord className="size-4" /></button></Tip>
        <Tip label="Regular expression"><button onClick={() => setRegex((v) => !v)} aria-pressed={regex} className={cn("rounded p-1 cursor-pointer", regex ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}><Regex className="size-4" /></button></Tip>
        <div className="flex-1" />
        <Tip label="Previous (⇧↵)"><button onClick={() => step(-1)} disabled={!count} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"><ChevronUp className="size-4" /></button></Tip>
        <Tip label="Next (↵)"><button onClick={() => step(1)} disabled={!count} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"><ChevronDown className="size-4" /></button></Tip>
      </div>
      <div className="relative">
        <Replace className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={replace} onChange={(e) => setReplace(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doReplace(e.metaKey || e.ctrlKey); } }} placeholder="Replace with" className="h-8 pl-7 text-xs" aria-label="Replace" />
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="xs" variant="outline" disabled={!count} onClick={() => doReplace(false)}><Replace className="size-3.5" /> Replace</Button>
        <Button size="xs" variant="outline" disabled={!count} onClick={() => doReplace(true)}><ReplaceAll className="size-3.5" /> All ({count})</Button>
        <Button size="xs" variant="ghost" disabled={!count} onClick={selectCurrent}>Select</Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Replacements are tracked when Track changes is on. Use ⌘↵ in the replace box to replace all.{regex && " Regex groups: use $1 in the replacement."}</p>
    </div>
  );
}
