"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardCopy, FilePlus2, GitCompareArrows, Loader2, KeyRound, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Markdown } from "@/components/ai/markdown";
import { TrustBadge } from "@/components/ai/trust-badge";
import type { Provenance } from "@/lib/integrity/types";
import type { LibraryItemView } from "../types";
import { fillClause, prettyVariable, variableSpecs } from "../clauses";
import { api, isNoKeyError } from "./api";
import { useLibrary } from "./library-provider";

const STANCE_VARIANT = { "pro-client": "success", neutral: "muted", "pro-counterparty": "warning" } as const;

/** Clause bank tools: variable fill form, live preview, insert into a new Word document, copy, and compare to standard. */
export function ClausePanel({ item, standard }: { item: LibraryItemView; standard?: LibraryItemView | null }) {
  const router = useRouter();
  const { matters, currentMatterId, aiConfigured, refreshList } = useLibrary();
  const meta = item.clause;
  const specs = React.useMemo(() => variableSpecs(item.content ?? "", meta?.variables ?? []), [item.content, meta]);
  const storageKey = `leclaude:clause-values:${item.id}`;
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [matterId, setMatterId] = React.useState<string>(item.matterId ?? currentMatterId ?? "");
  const [title, setTitle] = React.useState(item.name);
  const [inserting, setInserting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(true);
  React.useEffect(() => { try { const raw = localStorage.getItem(storageKey); if (raw) setValues(JSON.parse(raw)); } catch {} }, [storageKey]);
  React.useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(values)); } catch {} }, [values, storageKey]);

  const filled = React.useMemo(() => fillClause(item.content ?? "", values), [item.content, values]);
  const nFilled = specs.filter((s) => values[s.name]?.trim()).length;

  const fillExamples = () => setValues((v) => { const next = { ...v }; for (const s of specs) if (!next[s.name] && s.example) next[s.name] = s.example; return next; });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(filled.text);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
      toast.success("Clause copied", { description: filled.missing.length ? `${filled.missing.length} variable${filled.missing.length === 1 ? "" : "s"} left as [placeholders]` : "All variables filled" });
      void api("/api/library/clauses", { method: "POST", json: { id: item.id, values, copyOnly: true } }).catch(() => {});
    } catch { toast.error("Clipboard is not available"); }
  };

  const insert = async () => {
    setInserting(true);
    try {
      const r = await api<{ url?: string; doc?: { id: string; title: string }; missing: string[] }>("/api/library/clauses", { method: "POST", json: { id: item.id, values, createDoc: true, matterId: matterId || undefined, title } });
      toast.success(`Created "${r.doc?.title ?? title}"`, { description: r.missing.length ? `${r.missing.length} placeholder${r.missing.length === 1 ? "" : "s"} to complete in the editor` : "Opening in Word", action: r.url ? { label: "Open", onClick: () => router.push(r.url!) } : undefined });
      await refreshList();
      if (r.url) router.push(r.url);
    } catch (e) { toast.error("Could not create the document", { description: (e as Error).message }); }
    finally { setInserting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {meta && <Badge variant="accent" className="capitalize">{meta.category}</Badge>}
        {meta && <Badge variant={STANCE_VARIANT[meta.stance]} className="capitalize">{meta.stance}</Badge>}
        {meta?.governingLaw && <Badge variant="outline">{meta.governingLaw} law</Badge>}
        {meta?.lastReviewedAt && <span className="text-[11px] text-muted-foreground">Reviewed {meta.lastReviewedAt}{meta.reviewedBy ? ` by ${meta.reviewedBy}` : ""}</span>}
        {typeof meta?.useCount === "number" && <span className="text-[11px] text-muted-foreground">· used {meta.useCount}×</span>}
      </div>

      {meta?.notes && (
        <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs leading-relaxed"><span className="font-medium">Drafting notes.</span> {meta.notes}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border">
        <header className="flex h-9 items-center gap-2 border-b px-3">
          <Wand2 className="size-4 text-primary" />
          <div className="text-[12.5px] font-semibold">Fill variables</div>
          <span className="text-[11px] text-muted-foreground">{nFilled}/{specs.length}</span>
          <div className="flex-1" />
          <Button variant="ghost" size="xs" onClick={fillExamples} disabled={!specs.some((s) => s.example)}>Use examples</Button>
          <Button variant="ghost" size="xs" onClick={() => setValues({})} disabled={!nFilled}>Clear</Button>
        </header>
        {specs.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">This clause has no variables — insert or copy it as is.</p>
        ) : (
          <div className="grid gap-2.5 p-3">
            {specs.map((s) => (
              <div key={s.name} className="space-y-1">
                <Label className="flex items-center gap-1 text-[11px]"><code className="rounded bg-muted px-1 font-mono text-[10px]">{`{{${s.name}}}`}</code>{s.description && <span className="truncate text-muted-foreground" title={s.description}>· {s.description}</span>}</Label>
                <Input value={values[s.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [s.name]: e.target.value }))} placeholder={s.example ?? prettyVariable(s.name)} className={cn("h-8 text-xs", values[s.name]?.trim() && "border-success/50")} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border">
        <header className="flex h-9 items-center gap-2 border-b px-3">
          <div className="text-[12.5px] font-semibold">Preview</div>
          {filled.missing.length > 0 && <Badge variant="warning" className="text-[10px]">{filled.missing.length} missing</Badge>}
          <div className="flex-1" />
          <Button variant="ghost" size="xs" onClick={() => setShowPreview((v) => !v)}>{showPreview ? "Hide" : "Show"}</Button>
        </header>
        {showPreview && <div className="max-h-[420px] overflow-y-auto px-4 py-3 scrollbar-thin"><Markdown compact className="reading-serif text-[14px] leading-[1.65]">{filled.text}</Markdown></div>}
      </section>
      </div>

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-[12.5px] font-semibold">Insert</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Document title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" /></div>
          <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Matter</Label>
            <Select value={matterId || "__none__"} onValueChange={(v) => setMatterId(v === "__none__" ? "" : v)}>
              <SelectTrigger size="sm"><SelectValue placeholder="No matter" /></SelectTrigger>
              <SelectContent><SelectItem value="__none__">No matter (My files)</SelectItem>{matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={insert} disabled={inserting}>{inserting ? <Loader2 className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" />} Insert into new document</Button>
          <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check className="size-3.5 text-success" /> : <ClipboardCopy className="size-3.5" />} Copy</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Creates a Word document from the filled clause in the matter folder; unfilled variables become bracketed placeholders the drafting agent can complete.</p>
      </section>

      <CompareSection item={item} standard={standard} aiConfigured={aiConfigured} />
    </div>
  );
}

function CompareSection({ item, standard, aiConfigured }: { item: LibraryItemView; standard?: LibraryItemView | null; aiConfigured: boolean }) {
  const [mode, setMode] = React.useState<"standard" | "paste">(standard ? "standard" : "paste");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // POST /api/library/ai {action: "compare"} → { analysis, mode, standardName?, provenance? } (AI analyses are claim-verified against both clauses).
  const [result, setResult] = React.useState<{ analysis: string; mode: "ai" | "heuristic"; standardName?: string; provenance?: Provenance } | null>(null);
  const [noKey, setNoKey] = React.useState(false);
  const run = async () => {
    setBusy(true); setResult(null); setNoKey(false);
    try {
      const r = await api<{ analysis: string; mode: "ai" | "heuristic"; standardName?: string; provenance?: Provenance }>("/api/library/ai", { method: "POST", json: { action: "compare", id: item.id, text: mode === "paste" ? text : undefined } });
      setResult(r);
    } catch (e) {
      if (isNoKeyError(e)) setNoKey(true); else toast.error("Comparison failed", { description: (e as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <section className="rounded-lg border">
      <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <GitCompareArrows className="size-4 text-primary" />
        <div className="text-sm font-medium">Compare</div>
        <div className="flex-1" />
        <div className="flex rounded-md border p-0.5 text-[11px]">
          <button disabled={!standard} onClick={() => setMode("standard")} className={cn("rounded px-2 py-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40", mode === "standard" && "bg-accent font-medium")}>To firm standard</button>
          <button onClick={() => setMode("paste")} className={cn("rounded px-2 py-0.5 cursor-pointer", mode === "paste" && "bg-accent font-medium")}>To pasted text</button>
        </div>
      </header>
      <div className="space-y-2 p-3">
        {mode === "standard" ? (
          <p className="text-xs text-muted-foreground">{standard ? <>Compares this clause against <span className="font-medium text-foreground">{standard.name}</span>.</> : "This clause is the firm standard (no parent standard). Paste counterparty text to compare."}</p>
        ) : (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the counterparty's clause here…" className="min-h-[96px] text-xs" />
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={run} disabled={busy || (mode === "paste" && !text.trim()) || (mode === "standard" && !standard)}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} {aiConfigured ? "Compare with AI" : "Compare (heuristic)"}</Button>
          {!aiConfigured && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><KeyRound className="size-3" /> Add an OpenAI key for a substantive analysis</span>}
        </div>
        {noKey && <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">OpenAI key required. Add <code className="font-mono">OPENAI_API_KEY</code> to <code className="font-mono">.env.local</code> and restart to enable AI comparison.</div>}
        {result && (
          <div className="rounded-md border bg-card p-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground"><Badge variant={result.mode === "ai" ? "success" : "muted"}>{result.mode === "ai" ? "AI analysis" : "Heuristic"}</Badge>{result.standardName && <span>vs. {result.standardName}</span>}{result.mode === "ai" && <TrustBadge provenance={result.provenance && Array.isArray(result.provenance.sources) ? result.provenance : undefined} compact={!result.provenance} />}</div>
            <Markdown compact>{result.analysis}</Markdown>
          </div>
        )}
      </div>
    </section>
  );
}
