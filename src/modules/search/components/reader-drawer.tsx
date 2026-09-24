"use client";
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BookmarkPlus, Check, ChevronDown, ChevronUp, Copy, ExternalLink, Loader2, MessageCircleQuestion, Pin, Quote, ScrollText, ShieldCheck, Sparkles, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { Composer } from "@/components/ai/composer";
import { MessageList, SuggestionChips } from "@/components/ai/chat";
import { useAgent } from "@/hooks/use-agent";
import { courtAbbreviation } from "../jurisdictions";
import { formatBluebook } from "../normalize";
import { SOURCE_LABEL, type ReadResult, type SearchHit } from "../types";
import { Highlighted, SOURCE_ICON } from "./result-card";
import { NoKeyCard } from "./no-key-card";
import { CiteCheckTable, runCiteCheck, type CiteCheckResponse } from "./citecheck";

export interface ReaderDrawerProps {
  hit: SearchHit | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCite: (hit: SearchHit) => void;
  onPin: (hit: SearchHit) => void;
  onSave: (hit: SearchHit) => void;
  pinned: boolean;
  /** Pin a selected passage of the text. */
  onPinPassage?: (text: string, hit: SearchHit) => void;
  aiConfigured: boolean;
  terms: string[];
}

type Tab = "text" | "headnotes" | "ask" | "citations";

interface Headnotes { syllabus: string; headnotes: string[]; holding: string; disposition: string; keyQuotes: { quote: string; locator: string }[] }

const cache = new Map<string, ReadResult>();

export function ReaderDrawer(p: ReaderDrawerProps) {
  const hit = p.hit;
  const [result, setResult] = React.useState<ReadResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; unreachable: boolean } | null>(null);
  const [tab, setTab] = React.useState<Tab>("text");
  const [find, setFind] = React.useState("");
  const [matchIdx, setMatchIdx] = React.useState(0);
  const [headnotes, setHeadnotes] = React.useState<Headnotes | null>(null);
  const [hnState, setHnState] = React.useState<"idle" | "loading" | "nokey" | "error">("idle");
  const [hnError, setHnError] = React.useState<string | null>(null);
  const [cites, setCites] = React.useState<CiteCheckResponse | null>(null);
  const [citesLoading, setCitesLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // load text when the hit changes
  React.useEffect(() => {
    if (!p.open || !hit) return;
    setTab("text"); setFind(""); setMatchIdx(0); setHeadnotes(null); setHnState("idle"); setHnError(null); setCites(null); setError(null);
    const cached = cache.get(hit.id);
    if (cached) { setResult(cached); return; }
    if (!hit.readRef) { setResult({ kind: "url", title: hit.title, text: hit.snippet ?? "", length: (hit.snippet ?? "").length, url: hit.url }); return; }
    const ctrl = new AbortController();
    setLoading(true);
    setResult(null);
    fetch("/api/search/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...hit.readRef, title: hit.title }), signal: ctrl.signal })
      .then(async (res) => {
        const j = (await res.json()) as { result?: ReadResult; error?: string; code?: string };
        if (!res.ok || !j.result) throw Object.assign(new Error(j.error ?? res.statusText), { unreachable: j.code === "provider_unreachable" });
        cache.set(hit.id, j.result);
        setResult(j.result);
      })
      .catch((e: Error & { unreachable?: boolean }) => { if (e.name !== "AbortError") setError({ message: e.message, unreachable: Boolean(e.unreachable) }); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [p.open, hit]);

  const paragraphs = React.useMemo(() => (result?.text ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean), [result]);
  const findTerms = React.useMemo(() => (find.trim().length >= 2 ? [find.trim()] : []), [find]);
  const matches = React.useMemo(() => {
    if (!findTerms.length) return [] as number[];
    const f = findTerms[0].toLowerCase();
    const out: number[] = [];
    paragraphs.forEach((para, i) => { if (para.toLowerCase().includes(f)) out.push(i); });
    return out;
  }, [paragraphs, findTerms]);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: paragraphs.length, getScrollElement: () => parentRef.current, estimateSize: () => 72, overscan: 12 });
  React.useEffect(() => { if (matches.length) virtualizer.scrollToIndex(matches[Math.min(matchIdx, matches.length - 1)], { align: "center" }); }, [matchIdx, matches, virtualizer]);
  React.useEffect(() => { setMatchIdx(0); }, [find]);

  const generateHeadnotes = async () => {
    if (!result || !hit) return;
    setHnState("loading"); setHnError(null);
    try {
      const res = await fetch("/api/search/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: result.title, cite: hit.cite ?? result.cite, text: result.text }) });
      const j = (await res.json()) as { headnotes?: Headnotes; error?: string; code?: string };
      if (res.status === 503 || j.code === "no_api_key") { setHnState("nokey"); return; }
      if (!res.ok || !j.headnotes) throw new Error(j.error ?? res.statusText);
      setHeadnotes(j.headnotes); setHnState("idle");
    } catch (e) { setHnState("error"); setHnError(e instanceof Error ? e.message : String(e)); }
  };

  const verify = async () => {
    if (!result) return;
    setCitesLoading(true);
    try { setCites(await runCiteCheck(result.text.slice(0, 120_000))); } catch (e) { toast.error("Citation check failed", { description: e instanceof Error ? e.message : String(e) }); } finally { setCitesLoading(false); }
  };

  const copyCite = () => { if (!hit) return; p.onCite(hit); setCopied(true); setTimeout(() => setCopied(false), 1200); };

  const Icon = hit ? SOURCE_ICON[hit.source] : ScrollText;
  const external = result?.url ?? hit?.url;
  const isExternal = external ? /^https?:/.test(external) : false;
  const contentRef = React.useRef<HTMLDivElement>(null);

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="right"
        width="max-w-3xl"
        className="p-0 gap-0 outline-none"
        // Focus the sheet itself rather than its first button: a focused button opens its tooltip, and the
        // tooltip then swallows the first Escape so the drawer would not close.
        onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement | null;
          if (!hit || e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) return;
          if (e.key === "c") { e.preventDefault(); copyCite(); }
        }}
      >
        {hit && (
          <>
            <div className="shrink-0 border-b px-5 pb-3 pt-4 pr-12">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base leading-snug">{result?.title ?? hit.title}</SheetTitle>
                  <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                    {[
                      hit.cite ? <span key="cite" className="font-mono text-foreground/80">{hit.cite}</span> : null,
                      hit.courtId || hit.court ? <span key="court">{courtAbbreviation(hit.courtId, hit.court)}</span> : null,
                      hit.date ? <span key="date">{formatDate(hit.date)}</span> : null,
                      <span key="source">{SOURCE_LABEL[hit.source]}</span>,
                      result ? <span key="len" className="tabular">{result.length.toLocaleString()} chars</span> : null,
                    ].filter(Boolean).map((el, i) => <React.Fragment key={i}>{i > 0 && <span className="opacity-50">·</span>}{el}</React.Fragment>)}
                    {hit.authority && hit.authority !== "n/a" && <Badge variant={hit.authority === "binding" ? "success" : "muted"} className="py-0 capitalize">{hit.authority}</Badge>}
                  </SheetDescription>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1">
                <Tip label="Copy Bluebook citation" shortcut="c"><Button variant="outline" size="xs" onClick={copyCite}>{copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />} Copy cite</Button></Tip>
                <Button variant="outline" size="xs" disabled={p.pinned} onClick={() => p.onPin(hit)}>{p.pinned ? <Check className="size-3 text-success" /> : <Pin className="size-3" />} {p.pinned ? "Pinned" : "Pin"}</Button>
                {p.onPinPassage && <Tip label="Pin the selected text as a passage"><Button variant="outline" size="xs" onClick={() => { const sel = window.getSelection()?.toString().trim(); if (!sel) { toast.info("Select text in the document first"); return; } p.onPinPassage!(sel, hit); }}><Quote className="size-3" /> Pin passage</Button></Tip>}
                <Button variant="outline" size="xs" onClick={() => p.onSave(hit)}><BookmarkPlus className="size-3" /> Save to library</Button>
                {external && <Button asChild variant="outline" size="xs"><a href={external} target={isExternal ? "_blank" : undefined} rel="noreferrer"><ExternalLink className="size-3" /> {isExternal ? "Open external" : "Open in app"}</a></Button>}
                <div className="flex-1" />
                <div className="flex items-center rounded-md border p-0.5">
                  {([["text", "Text", ScrollText], ["headnotes", "Headnotes", Sparkles], ["ask", "Ask", MessageCircleQuestion], ["citations", "Citations", ShieldCheck]] as const).map(([id, label, I]) => (
                    <button key={id} onClick={() => { setTab(id); if (id === "citations" && !cites && result && !citesLoading) void verify(); }} className={cn("flex h-6 items-center gap-1 rounded px-2 text-[11px] cursor-pointer", tab === id ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground")}><I className="size-3" /> {label}</button>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-3.5 w-1/2" />
                {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className={cn("h-3.5", i % 3 === 2 ? "w-3/4" : "w-full")} />)}
              </div>
            ) : error ? (
              <div className="p-6"><EmptyState icon={WifiOff} title={error.unreachable ? "Provider unreachable" : "Could not load this source"} description={error.message} action={external && isExternal ? <Button asChild variant="outline" size="sm"><a href={external} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /> Open the source directly</a></Button> : undefined} /></div>
            ) : result ? (
              <>
                {tab === "text" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-1.5">
                      <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search in document" className="h-7 w-56 text-xs" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setMatchIdx((i) => (matches.length ? (e.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length) : 0)); } if (e.key === "Escape") setFind(""); }} />
                      {find && <span className="tabular text-[11px] text-muted-foreground">{matches.length ? `${Math.min(matchIdx + 1, matches.length)} / ${matches.length} paragraphs` : "no matches"}</span>}
                      {find && <><Button variant="ghost" size="icon-xs" disabled={!matches.length} onClick={() => setMatchIdx((i) => (i - 1 + matches.length) % matches.length)} aria-label="Previous match"><ChevronUp className="size-3.5" /></Button><Button variant="ghost" size="icon-xs" disabled={!matches.length} onClick={() => setMatchIdx((i) => (i + 1) % matches.length)} aria-label="Next match"><ChevronDown className="size-3.5" /></Button><Button variant="ghost" size="icon-xs" onClick={() => setFind("")} aria-label="Clear"><X className="size-3.5" /></Button></>}
                      <div className="flex-1" />
                      {p.terms.length > 0 && <span className="hidden text-[10.5px] text-muted-foreground sm:inline">query terms highlighted</span>}
                    </div>
                    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scrollbar-thin font-serif text-[14px] leading-[1.7]">
                      {paragraphs.length === 0 ? <div className="text-sm text-muted-foreground">No text was returned for this source.</div> : (
                        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                          {virtualizer.getVirtualItems().map((vi) => {
                            const para = paragraphs[vi.index];
                            const isHeading = para.length < 90 && /^[A-Z0-9 .,'’&()-]+$|^(I|II|III|IV|V|VI|VII|VIII|IX|X)+\.|^§/.test(para);
                            const current = matches.length ? matches[Math.min(matchIdx, matches.length - 1)] === vi.index : false;
                            return (
                              <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}>
                                <p className={cn("pb-3 whitespace-pre-wrap break-words", isHeading && "font-sans text-[12.5px] font-semibold tracking-wide text-foreground/90", current && "rounded-md bg-primary/5 ring-1 ring-primary/30 px-1 -mx-1")}>
                                  <Highlighted text={para} terms={findTerms.length ? findTerms : p.terms} />
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === "headnotes" && (
                  <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
                    {hnState === "nokey" || (!p.aiConfigured && !headnotes) ? (
                      <NoKeyCard />
                    ) : headnotes ? (
                      <div className="space-y-4 text-sm">
                        <section><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Syllabus</div><p className="leading-relaxed">{headnotes.syllabus}</p></section>
                        <section>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Headnotes</div>
                          <ol className="space-y-1.5 pl-5 list-decimal marker:text-primary marker:font-medium">{headnotes.headnotes.map((h, i) => <li key={i} className="leading-relaxed">{h}</li>)}</ol>
                        </section>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <section className="rounded-md border bg-muted/30 p-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Holding</div><p className="text-[13px] leading-relaxed">{headnotes.holding}</p></section>
                          <section className="rounded-md border bg-muted/30 p-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Disposition</div><p className="text-[13px] leading-relaxed">{headnotes.disposition}</p></section>
                        </div>
                        {headnotes.keyQuotes.length > 0 && (
                          <section>
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Key quotations</div>
                            <ul className="space-y-1.5">
                              {headnotes.keyQuotes.map((q, i) => (
                                <li key={i}>
                                  <button onClick={() => { setFind(q.quote.slice(0, 40)); setTab("text"); }} className="flex w-full items-start gap-2 rounded-md border bg-card px-3 py-2 text-left text-[13px] hover:bg-accent cursor-pointer" title="Find in text">
                                    <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                    <span className="min-w-0"><span className="font-serif italic">“{q.quote}”</span>{q.locator && <span className="ml-1 text-[11px] text-muted-foreground">({q.locator})</span>}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}
                        <div className="text-[10.5px] text-muted-foreground">AI-generated from the source text. Verify quotations against the Text tab before relying on them.</div>
                      </div>
                    ) : (
                      <EmptyState icon={Sparkles} title="Headnote-style summary" description="Syllabus, numbered headnotes, holding, disposition and verbatim key quotations generated from the full text with the fast model." action={<Button size="sm" onClick={generateHeadnotes} disabled={hnState === "loading"}>{hnState === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate headnotes</Button>} />
                    )}
                    {hnState === "error" && <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{hnError}</div>}
                  </div>
                )}

                {tab === "ask" && <AskSource key={hit.id} hit={hit} result={result} aiConfigured={p.aiConfigured} />}

                {tab === "citations" && (
                  <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
                    {citesLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Extracting and verifying citations…</div> : cites ? <CiteCheckTable result={cites} /> : <EmptyState icon={ShieldCheck} title="Verify citations in this text" action={<Button size="sm" onClick={verify}><ShieldCheck className="size-3.5" /> Run check</Button>} />}
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AskSource({ hit, result, aiConfigured }: { hit: SearchHit; result: ReadResult; aiConfigured: boolean }) {
  const agent = useAgent({ endpoint: "/api/search/ask", extra: () => ({ source: { title: result.title, cite: hit.cite ?? result.cite, url: result.url ?? hit.url, kind: hit.source }, text: result.text }) });
  const suggestions = hit.source === "caselaw"
    ? ["What is the holding, and what is dicta?", "What standard of review applied?", "Which facts were decisive?", "Does this opinion distinguish or overrule earlier authority?"]
    : hit.source === "regulations" || hit.source === "federal_register" || hit.source === "statutes"
      ? ["Summarize the operative requirements.", "Who is covered and what are the deadlines?", "What penalties or enforcement mechanisms apply?"]
      : ["Summarize this document in five bullets.", "Who wrote it, to whom, and why does it matter?", "List every date and person mentioned."];
  const noKey = !aiConfigured || agent.messages.some((m) => m.status === "error" && /OPENAI_API_KEY/i.test(m.error ?? ""));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {noKey && <div className="p-3"><NoKeyCard compact /></div>}
      <MessageList messages={agent.messages} statusLine={agent.statusLine} className="min-h-0" emptyState={<div className="p-4"><div className="mb-2 text-xs text-muted-foreground">Ask anything about this source. Answers quote the text and can follow citations inside it.</div><SuggestionChips suggestions={suggestions} onPick={(s) => void agent.send(s)} /></div>} />
      <div className="shrink-0 border-t p-2"><Composer placeholder="Ask about this source…" disabled={!aiConfigured} streaming={agent.isStreaming} onStop={agent.stop} onSend={(t) => void agent.send(t)} /></div>
    </div>
  );
}

export function citeFor(hit: SearchHit) { return formatBluebook(hit); }
