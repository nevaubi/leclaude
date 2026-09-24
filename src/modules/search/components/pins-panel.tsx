"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Check, Copy, FileText, Loader2, Pin, Quote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { buildMemoMarkdown, memoTitle } from "../memo";
import { formatBluebook } from "../normalize";
import { SOURCE_SHORT } from "../types";
import type { ResearchPin } from "../engine/types";
import { SOURCE_ICON } from "./result-card";
import { useSearchStore } from "./store";
import { useResearchActions } from "./research-context";

export interface PinsPanelProps {
  question: string;
  answer: string;
  jurisdictionLabel: string;
  matter: { id: string; name: string; caption?: string } | null;
  userName: string;
}

export function PinsPanel({ question, answer, jurisdictionLabel, matter, userName }: PinsPanelProps) {
  const router = useRouter();
  const a = useResearchActions();
  const pins = useSearchStore((s) => s.pins);
  const { unpin, setPinNote, clearPins } = useSearchStore.getState();
  const [busy, setBusy] = React.useState<"word" | "library" | null>(null);
  const [copied, setCopied] = React.useState(false);
  const sourcePins = pins.filter((p) => p.kind === "source" && p.hit);
  const passagePins = pins.filter((p) => p.kind === "passage" && p.text);

  const markdown = () => buildMemoMarkdown({
    question,
    synthesis: answer,
    sources: sourcePins.map((p) => ({ hit: p.hit!, note: p.note, addedAt: p.addedAt })),
    passages: passagePins.map((p) => ({ text: p.text!, note: p.note, cite: p.hit ? formatBluebook(p.hit) : undefined })),
    author: userName,
    matterName: matter?.name,
    matterCaption: matter?.caption,
    jurisdictionLabel,
  });

  const toWord = async () => {
    setBusy("word");
    try {
      const md = markdown();
      const content = markdownToDoc(md, { title: memoTitle(question) });
      const res = await fetch("/api/office/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "word", title: memoTitle(question || "Pinned authorities"), content, matterId: matter?.id, tags: ["research", "memo"], meta: { source: "search-pins", pins: pins.length } }) });
      const j = (await res.json()) as { doc?: { id: string }; error?: string };
      if (!res.ok || !j.doc) throw new Error(j.error ?? res.statusText);
      toast.success("Memo created in Word");
      router.push(`/office/word/${j.doc.id}`);
    } catch (e) { toast.error("Could not create the memo", { description: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); }
  };
  const toLibrary = async () => {
    setBusy("library");
    let n = 0;
    try {
      for (const p of sourcePins) {
        const res = await fetch("/api/search/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hit: p.hit, matterId: matter?.id ?? null, note: p.note }) });
        if (res.ok) n++;
      }
      toast.success(`${n} authorit${n === 1 ? "y" : "ies"} saved to the library`, { description: "Library → Saved research" });
    } catch (e) { toast.error("Could not save to the library", { description: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); }
  };
  const copy = () => navigator.clipboard.writeText(markdown()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); toast.success("Memo markdown copied"); });

  if (!pins.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Pin className="size-5" /></span>
        <div className="text-sm font-medium">Nothing pinned yet</div>
        <div className="max-w-[260px] text-xs text-muted-foreground">Pin sources from the answer, the Sources tab or the reader; select text in the answer to pin a passage. Pins export to a Word memo and the library.</div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <Button size="xs" onClick={toWord} disabled={busy != null}>{busy === "word" ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} Word memo</Button>
        <Button size="xs" variant="outline" onClick={toLibrary} disabled={busy != null || !sourcePins.length}>{busy === "library" ? <Loader2 className="size-3 animate-spin" /> : <BookmarkPlus className="size-3" />} Library</Button>
        <Button size="xs" variant="ghost" onClick={copy}>{copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}</Button>
        <div className="flex-1" />
        <Tip label="Clear all pins"><Button size="icon-xs" variant="ghost" onClick={() => { clearPins(); toast.success("Pins cleared"); }} aria-label="Clear pins"><Trash2 className="size-3.5" /></Button></Tip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {sourcePins.length > 0 && <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">Authorities <span className="tabular font-normal">{sourcePins.length}</span></div>}
        <ul className="divide-y">{sourcePins.map((p) => <PinRow key={p.id} pin={p} onRemove={() => unpin(p.id)} onNote={(n) => setPinNote(p.id, n)} onOpen={() => a.openSource(p.hit!)} />)}</ul>
        {passagePins.length > 0 && <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">Passages <span className="tabular font-normal">{passagePins.length}</span></div>}
        <ul className="divide-y">{passagePins.map((p) => <PinRow key={p.id} pin={p} onRemove={() => unpin(p.id)} onNote={(n) => setPinNote(p.id, n)} onOpen={p.hit ? () => a.openSource(p.hit!) : undefined} />)}</ul>
      </div>
    </div>
  );
}

function PinRow({ pin, onRemove, onNote, onOpen }: { pin: ResearchPin; onRemove: () => void; onNote: (n: string) => void; onOpen?: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const hit = pin.hit;
  const Icon = hit ? SOURCE_ICON[hit.source] : Quote;
  return (
    <li className="group px-3 py-2">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {pin.kind === "source" && hit ? (
            <>
              <button onClick={onOpen} className="block w-full text-left text-[12.5px] font-medium leading-snug hover:text-primary cursor-pointer">{hit.title}</button>
              <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{[hit.cite, SOURCE_SHORT[hit.source], hit.date ? formatDate(hit.date) : null].filter(Boolean).join(" · ")}</div>
            </>
          ) : (
            <>
              <blockquote className="font-serif text-[12.5px] italic leading-snug text-foreground/90">“{pin.text}”</blockquote>
              {hit && <button onClick={onOpen} className="mt-0.5 truncate text-[10.5px] text-muted-foreground hover:text-primary cursor-pointer">{formatBluebook(hit)}</button>}
            </>
          )}
          {editing ? (
            <Textarea autoFocus value={pin.note ?? ""} onChange={(e) => onNote(e.target.value)} onBlur={() => setEditing(false)} placeholder={pin.kind === "source" ? "Holding / relevance for the memo" : "Why this passage matters"} className="mt-1.5 min-h-[56px] text-xs" />
          ) : (
            <button onClick={() => setEditing(true)} className={cn("mt-1 block w-full text-left text-[11.5px] cursor-text", pin.note ? "text-foreground/85" : "text-muted-foreground/70 opacity-0 group-hover:opacity-100")}>{pin.note || "Add a note…"}</button>
          )}
        </div>
        <Tip label="Remove pin"><Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" onClick={onRemove} aria-label="Remove pin"><Trash2 className="size-3.5" /></Button></Tip>
      </div>
    </li>
  );
}
