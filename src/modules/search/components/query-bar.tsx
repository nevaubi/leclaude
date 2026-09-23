"use client";
import * as React from "react";
import { ArrowRight, Briefcase, Calendar, Gavel, Lightbulb, Loader2, Search, Sparkles, Square, Wand2, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import type { Matter } from "@/lib/types/domain";
import { JURISDICTIONS } from "../jurisdictions";
import { spellingSuggestions, synonymSuggestions } from "../synonyms";
import { ALL_SOURCES, SOURCE_LABEL, type DatePreset, type SearchSettings, type SearchSource } from "../types";
import { SOURCE_ICON } from "./result-card";
import { QueryBuilder } from "./query-builder";

export interface QueryBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q?: string) => void;
  settings: SearchSettings;
  setSettings: (patch: Partial<SearchSettings>) => void;
  toggleSource: (s: SearchSource) => void;
  matters: Pick<Matter, "id" | "shortName" | "caption">[];
  streaming: boolean;
  onStop: () => void;
  compact?: boolean;
  autoFocus?: boolean;
  aiConfigured: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "1y", label: "1y" },
  { id: "5y", label: "5y" },
  { id: "10y", label: "10y" },
  { id: "custom", label: "Custom" },
];

export function QueryBar(p: QueryBarProps) {
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [expanding, setExpanding] = React.useState(false);
  const [expanded, setExpanded] = React.useState<{ query: string; rationale: string }[] | null>(null);
  const localRef = React.useRef<HTMLInputElement>(null);
  const ref = p.inputRef ?? localRef;

  const spelling = React.useMemo(() => spellingSuggestions(p.value), [p.value]);
  const synonyms = React.useMemo(() => synonymSuggestions(p.value), [p.value]);

  const applySpelling = (term: string, suggestion: string) => {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    p.onChange(p.value.replace(re, suggestion));
  };
  const applySynonym = (term: string, syn: string) => {
    const re = new RegExp(`(^|[^a-z0-9"])(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=[^a-z0-9"]|$)`, "i");
    const quoted = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
    if (re.test(p.value)) p.onChange(p.value.replace(re, (_m, pre: string, t: string) => `${pre}(${quoted(t)} OR ${quoted(syn)})`));
    else p.onChange(`${p.value.trim()} OR ${quoted(syn)}`);
    ref.current?.focus();
  };

  const expand = async () => {
    if (!p.value.trim()) return;
    setExpanding(true);
    setExpanded(null);
    try {
      const res = await fetch("/api/search/expand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: p.value, jurisdiction: p.settings.jurisdiction }) });
      const j = (await res.json()) as { queries?: { query: string; rationale: string }[]; error?: string; code?: string };
      if (!res.ok) { toast.error(j.code === "no_api_key" ? "OpenAI key required for AI query expansion" : j.error ?? "Could not expand query", { description: j.code === "no_api_key" ? "Add OPENAI_API_KEY to .env.local (Settings → AI configuration)." : undefined }); return; }
      setExpanded(j.queries ?? []);
    } catch (e) {
      toast.error("Could not expand query", { description: e instanceof Error ? e.message : String(e) });
    } finally { setExpanding(false); }
  };

  const j = JURISDICTIONS.find((x) => x.key === p.settings.jurisdiction) ?? JURISDICTIONS[0];

  return (
    <div className={cn("flex flex-col gap-2", p.compact ? "" : "gap-3")}>
      <form
        onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}
        className={cn("flex items-center gap-2 rounded-xl border bg-background shadow-xs transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30", p.compact ? "h-11 px-2" : "h-14 px-3")}
      >
        <Search className={cn("shrink-0 text-muted-foreground", p.compact ? "size-4" : "size-5")} />
        <input
          ref={ref}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
          autoFocus={p.autoFocus}
          placeholder={p.compact ? "Search case law, statutes, regulations, dockets, firm knowledge…" : 'Ask a research question or type a boolean query — e.g. "failure to warn" AND PFAS /s foam'}
          className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground", p.compact ? "text-sm" : "text-base")}
          aria-label="Research query"
          spellCheck={false}
          autoComplete="off"
        />
        <Popover open={builderOpen} onOpenChange={setBuilderOpen}>
          <Tip label="Query builder (boolean, phrase, proximity)"><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Query builder"><Wand2 className="size-4" /></Button></PopoverTrigger></Tip>
          <PopoverContent align="end" className="w-auto p-3">
            <QueryBuilder query={p.value} onApply={(q) => { p.onChange(q); setBuilderOpen(false); ref.current?.focus(); }} />
          </PopoverContent>
        </Popover>
        <Tip label={p.aiConfigured ? "Expand query with AI (3 alternate strategies)" : "Expand query with AI — requires OpenAI key"}>
          <Button type="button" variant="ghost" size="icon-sm" onClick={expand} disabled={expanding || !p.value.trim()} aria-label="Expand query with AI">{expanding ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}</Button>
        </Tip>
        {p.streaming ? (
          <Button type="button" size={p.compact ? "sm" : "default"} variant="outline" onClick={p.onStop}><Square className="size-3.5 fill-current" /> Stop</Button>
        ) : (
          <Button type="submit" size={p.compact ? "sm" : "default"} disabled={!p.value.trim()}>Search <ArrowRight className="size-4" /></Button>
        )}
      </form>

      {(spelling.length > 0 || synonyms.length > 0 || expanded) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11.5px] text-muted-foreground">
          {spelling.map((s) => (
            <span key={s.term}>Did you mean <button onClick={() => applySpelling(s.term, s.suggestion)} className="font-medium text-primary hover:underline cursor-pointer">{s.suggestion}</button>?</span>
          ))}
          {synonyms.map((s) => (
            <span key={s.term} className="inline-flex flex-wrap items-center gap-1">
              <Lightbulb className="size-3" /> <span className="italic">{s.term}</span> ≈
              {s.synonyms.slice(0, 4).map((syn) => (
                <button key={syn} onClick={() => applySynonym(s.term, syn)} className="rounded-full border px-1.5 py-px hover:bg-accent hover:text-foreground cursor-pointer" title={`Add "${syn}" as an OR alternative`}>{syn}</button>
              ))}
            </span>
          ))}
          {expanded && expanded.length > 0 && (
            <div className="flex w-full flex-col gap-1 pt-1">
              {expanded.map((e, i) => (
                <button key={i} onClick={() => { p.onChange(e.query); setExpanded(null); p.onSubmit(e.query); }} className="flex items-start gap-2 rounded-md border bg-card px-2 py-1.5 text-left hover:bg-accent cursor-pointer">
                  <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
                  <span className="min-w-0"><span className="font-mono text-[11px] text-foreground">{e.query}</span><span className="block text-[11px] text-muted-foreground">{e.rationale}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {ALL_SOURCES.map((s) => {
          const on = p.settings.sources.includes(s);
          const Icon = SOURCE_ICON[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => p.toggleSource(s)}
              aria-pressed={on}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors cursor-pointer", on ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:border-foreground/25 hover:text-foreground")}
            >
              <Icon className="size-3.5" /> {SOURCE_LABEL[s]}
              {s === "web" && on && !p.aiConfigured && <span className="text-[9.5px] opacity-70">(key)</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Gavel className="size-3.5 text-muted-foreground" />
          <Select value={p.settings.jurisdiction} onValueChange={(v) => p.setSettings({ jurisdiction: v })}>
            <SelectTrigger size="sm" className="w-[210px]"><SelectValue placeholder="Jurisdiction" /></SelectTrigger>
            <SelectContent>
              {(["Federal", "Circuits", "State"] as const).map((g) => (
                <SelectGroup key={g}>
                  <SelectLabel>{g}</SelectLabel>
                  {JURISDICTIONS.filter((x) => x.group === g).map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Tip label="Override with CourtListener court ids, e.g. “dsc ca4” or “cand”"><Input value={p.settings.courts ?? ""} onChange={(e) => p.setSettings({ courts: e.target.value })} placeholder="court ids" className="h-8 w-24 font-mono text-[11px]" /></Tip>
        </div>

        <div className="flex items-center gap-1">
          <Calendar className="size-3.5 text-muted-foreground" />
          <div className="flex items-center rounded-md border p-0.5">
            {DATE_PRESETS.map((d) => (
              <button key={d.id} type="button" onClick={() => p.setSettings({ datePreset: d.id })} className={cn("h-6 rounded px-2 text-[11px] cursor-pointer", p.settings.datePreset === d.id ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>{d.label}</button>
            ))}
          </div>
          {p.settings.datePreset === "custom" && (
            <>
              <Input type="date" value={p.settings.dateFrom ?? ""} onChange={(e) => p.setSettings({ dateFrom: e.target.value || undefined })} className="h-8 w-[130px] text-[11px]" aria-label="From date" />
              <span className="text-[11px] text-muted-foreground">to</span>
              <Input type="date" value={p.settings.dateTo ?? ""} onChange={(e) => p.setSettings({ dateTo: e.target.value || undefined })} className="h-8 w-[130px] text-[11px]" aria-label="To date" />
            </>
          )}
        </div>

        <Select value={String(p.settings.limit)} onValueChange={(v) => p.setSettings({ limit: Number(v) })}>
          <SelectTrigger size="sm" className="w-[92px]"><SelectValue /></SelectTrigger>
          <SelectContent>{[10, 15, 20, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n} / source</SelectItem>)}</SelectContent>
        </Select>

        <div className="flex items-center rounded-md border p-0.5">
          <button type="button" onClick={() => p.setSettings({ order: "score" })} className={cn("h-6 rounded px-2 text-[11px] cursor-pointer", p.settings.order === "score" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>Precision</button>
          <button type="button" onClick={() => p.setSettings({ order: "date" })} className={cn("h-6 rounded px-2 text-[11px] cursor-pointer", p.settings.order === "date" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>Recency</button>
        </div>

        <div className="flex items-center gap-1">
          <Briefcase className="size-3.5 text-muted-foreground" />
          <Select value={p.settings.matterId ?? "none"} onValueChange={(v) => p.setSettings({ matterId: v === "none" ? null : v })}>
            <SelectTrigger size="sm" className="w-[190px]"><SelectValue placeholder="Matter context" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No matter context</SelectItem>
              {p.matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}{m.caption ? ` · ${m.caption}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1" />
        <Tip label={p.settings.fast ? "Fast answer: fast model, low effort, no reading step" : "Full synthesis: reads the top authorities before answering"}>
          <label className={cn("flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11.5px] cursor-pointer transition-colors", p.settings.fast ? "border-warning/50 bg-warning/10 text-warning-foreground dark:text-warning" : "text-muted-foreground hover:text-foreground")}>
            <Zap className="size-3.5" /> Fast answer
            <Switch size="sm" checked={p.settings.fast} onCheckedChange={(v) => p.setSettings({ fast: v })} />
          </label>
        </Tip>
      </div>
      {!p.compact && <div className="px-1 text-[11px] text-muted-foreground">Binding/persuasive badges are computed against <span className="font-medium text-foreground/80">{j.label}</span>{p.settings.courts ? ` (override: ${p.settings.courts})` : ""}.</div>}
    </div>
  );
}
