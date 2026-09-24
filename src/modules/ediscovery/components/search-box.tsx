"use client";
import * as React from "react";
import { Search, Sparkles, X, Loader2, HelpCircle, AlertTriangle, LayoutList, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import type { SearchResponse } from "../types";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { Kbd } from "./shared";

const EXAMPLES: { q: string; hint: string }[] = [
  { q: 'toxicology AND (rat OR bioassay) NOT marketing', hint: "Boolean with grouping" },
  { q: '"monitoring well" custodian:hale type:email', hint: "Phrase + field prefixes" },
  { q: "MFC-0041877–MFC-0041999", hint: "Bates range" },
  { q: "from:kaine date:2001-03-01..2001-03-31", hint: "Sender + date range" },
  { q: "issue:REG-01 -draft", hint: "Issue code, exclude a term" },
  { q: "date:>2010 subject:decatur", hint: "Date comparison" },
];

export function SearchBox({ response, loading }: { response: SearchResponse | null; loading: boolean }) {
  const { aiConfigured } = useReview();
  const q = useReviewStore((s) => s.q);
  const setQ = useReviewStore((s) => s.setQ);
  const semantic = useReviewStore((s) => s.semantic);
  const setSemantic = useReviewStore((s) => s.setSemantic);
  const density = useReviewStore((s) => s.density);
  const setDensity = useReviewStore((s) => s.setDensity);
  const [local, setLocal] = React.useState(q);
  React.useEffect(() => setLocal(q), [q]);
  const commit = React.useCallback((v: string) => setQ(v), [setQ]);
  // Debounce typing → store
  React.useEffect(() => { const t = setTimeout(() => { if (local !== q) commit(local); }, 220); return () => clearTimeout(t); }, [local, q, commit]);
  const warnings = response?.parsed.warnings ?? [];
  const parsed = response?.parsed;

  return (
    <div className="shrink-0 border-b bg-background">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          {loading ? <Loader2 className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
          <input
            id="ediscovery-search"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(local); if (e.key === "Escape") { setLocal(""); commit(""); (e.target as HTMLInputElement).blur(); } }}
            placeholder={semantic ? "Describe what you are looking for — e.g. internal doubts about whether the surfactant biodegrades" : 'Search — boolean, "phrases", custodian:, type:, from:, date:, Bates ranges'}
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 font-mono text-[12.5px] shadow-xs placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label="Search documents"
            autoComplete="off"
            spellCheck={false}
          />
          {local && <button onClick={() => { setLocal(""); commit(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        <Tip label={aiConfigured ? "Semantic: hybrid embedding + keyword ranking" : "Semantic mode ranks with BM25 only until an OpenAI key is configured"}>
          <Toggle pressed={semantic} onPressedChange={setSemantic} size="sm" variant="outline" className={cn("h-8 gap-1.5 px-2.5 text-xs", semantic && "border-primary/40 bg-primary/10 text-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary")} aria-label="Toggle semantic search">
            <Sparkles className="size-3.5" /> Semantic
          </Toggle>
        </Tip>
        <Popover>
          <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Search syntax help"><HelpCircle className="size-4" /></Button></PopoverTrigger>
          <PopoverContent align="end" className="w-[380px] p-3">
            <div className="text-xs font-medium">Query syntax</div>
            <p className="mt-1 text-[11px] text-muted-foreground">Terms are AND-ed. Use <Kbd>OR</Kbd>, <Kbd>NOT</Kbd> or <Kbd>-term</Kbd>, parentheses and quoted phrases. Fields: custodian, type, from, to, cc, subject, date, bates, issue, tag, hash.</p>
            <ul className="mt-2 space-y-1">
              {EXAMPLES.map((ex) => (
                <li key={ex.q}><button onClick={() => { setLocal(ex.q); commit(ex.q); }} className="flex w-full items-baseline justify-between gap-3 rounded px-1.5 py-1 text-left hover:bg-accent cursor-pointer"><code className="font-mono text-[11.5px]">{ex.q}</code><span className="shrink-0 text-[10.5px] text-muted-foreground">{ex.hint}</span></button></li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        <div className="ml-1 hidden items-center rounded-md border p-0.5 sm:flex" role="group" aria-label="Row density">
          <Tip label="Compact rows"><button onClick={() => setDensity("compact")} className={cn("rounded p-1 cursor-pointer", density === "compact" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")} aria-pressed={density === "compact"} aria-label="Compact"><Rows3 className="size-3.5" /></button></Tip>
          <Tip label="Comfortable rows"><button onClick={() => setDensity("comfortable")} className={cn("rounded p-1 cursor-pointer", density === "comfortable" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")} aria-pressed={density === "comfortable"} aria-label="Comfortable"><LayoutList className="size-3.5" /></button></Tip>
        </div>
      </div>
      {(warnings.length > 0 || (parsed && (parsed.bates.length > 0 || parsed.fields.length > 0))) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-[11px]">
          {parsed?.bates.map((b, i) => <span key={i} className="rounded border bg-muted/60 px-1.5 py-px font-mono text-muted-foreground">Bates {b.start}{b.end !== b.start ? ` – ${b.end}` : ""}</span>)}
          {parsed?.fields.map((f, i) => <span key={i} className="rounded border bg-muted/60 px-1.5 py-px font-mono text-muted-foreground">{f.field}:{f.value}</span>)}
          {warnings.map((w, i) => <span key={i} className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-px text-warning-foreground dark:text-warning"><AlertTriangle className="size-3" />{w}</span>)}
        </div>
      )}
    </div>
  );
}
