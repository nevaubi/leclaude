"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, ChevronRight, FileText, Import, KeyRound, LayoutGrid, LayoutTemplate, List, Loader2, MessageCircleQuestion, PenLine, ScanSearch, Search, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { OfficeKind } from "@/lib/types/domain";
import { useUploads, isFileDrag } from "@/modules/library/components/use-uploads";
import { KIND_META, OFFICE_KINDS, type OfficeDocSummary, type OfficeHomeData } from "./types";
import { NewTiles, KIND_ICON } from "./new-tiles";
import { DocCard, DocRow, duplicateOfficeDoc, type DocActions } from "./doc-card";
import { TemplatesSection } from "./templates-section";

type Sort = "updated" | "title" | "kind" | "created";
const SORT_LABEL: Record<Sort, string> = { updated: "Last updated", title: "Title", kind: "Type", created: "Created" };
const ALL_ACCEPT = OFFICE_KINDS.map((k) => KIND_META[k].accept).join(",");

export function OfficeHome({ initial, kind: initialKind }: { initial: OfficeHomeData; kind: OfficeKind | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const kindParam = sp.get("kind");
  const kind: OfficeKind | null = kindParam && (OFFICE_KINDS as string[]).includes(kindParam) ? (kindParam as OfficeKind) : initialKind;
  const [data, setData] = React.useState<OfficeHomeData>(initial);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [matterId, setMatterId] = React.useState<string>("");
  const [sort, setSort] = React.useState<Sort>("updated");
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
  const [fileOver, setFileOver] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setHydrated(true); try { const v = localStorage.getItem("leclaude:office-home:view"); if (v === "list" || v === "grid") setViewMode(v); } catch {} }, []);
  React.useEffect(() => { try { localStorage.setItem("leclaude:office-home:view", viewMode); } catch {} }, [viewMode]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/library/office?full=1"); if (r.ok) setData((await r.json()) as OfficeHomeData); }
    catch { /* keep current */ } finally { setLoading(false); }
  }, []);

  const setKind = (k: OfficeKind | null) => { const params = new URLSearchParams(sp.toString()); if (k) params.set("kind", k); else params.delete("kind"); const qs = params.toString(); router.replace(qs ? `${pathname}?${qs}` : pathname); };

  const uploads = useUploads({ onDone: refresh, openSingle: (url) => router.push(url) });

  const docs = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data.docs.filter((d) => (!kind || d.kind === kind) && (!matterId || d.matterId === matterId) && (!q || d.title.toLowerCase().includes(q) || (d.tags ?? []).some((t) => t.toLowerCase().includes(q)) || (d.matterShortName ?? "").toLowerCase().includes(q)));
    const cmp: Record<Sort, (a: OfficeDocSummary, b: OfficeDocSummary) => number> = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title),
      kind: (a, b) => a.kind.localeCompare(b.kind) || b.updatedAt.localeCompare(a.updatedAt),
    };
    return [...list].sort(cmp[sort]);
  }, [data.docs, kind, matterId, query, sort]);

  const actions = React.useMemo<DocActions>(() => ({
    async rename(doc, title) {
      setData((d) => ({ ...d, docs: d.docs.map((x) => (x.id === doc.id ? { ...x, title } : x)) }));
      try {
        const res = await fetch(`/api/office/docs/${doc.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
        toast.success(`Renamed to "${title}"`);
        await refresh();
      } catch (e) { setData((d) => ({ ...d, docs: d.docs.map((x) => (x.id === doc.id ? { ...x, title: doc.title } : x)) })); toast.error("Rename failed", { description: (e as Error).message }); }
    },
    async duplicate(doc) {
      try {
        const copy = await duplicateOfficeDoc(doc);
        toast.success(`Created "${copy.title}"`, { action: { label: "Open", onClick: () => router.push(`/office/${copy.kind}/${copy.id}`) } });
        await refresh();
      } catch (e) { toast.error("Duplicate failed", { description: (e as Error).message }); }
    },
    async remove(doc) {
      if (!window.confirm(`Delete "${doc.title}"? Its version history and comments will be removed. This cannot be undone.`)) return;
      const prev = data.docs;
      setData((d) => ({ ...d, docs: d.docs.filter((x) => x.id !== doc.id) }));
      try {
        const res = await fetch(`/api/office/docs/${doc.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(res.statusText);
        toast.success(`Deleted "${doc.title}"`);
        await refresh();
      } catch (e) { setData((d) => ({ ...d, docs: prev })); toast.error("Delete failed", { description: (e as Error).message }); }
    },
  }), [data.docs, refresh, router]);

  // Keyboard: "/" focuses search, 1/2 view, n new doc of active kind
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "1") setViewMode("grid");
      if (e.key === "2") setViewMode("list");
      if (e.key.toLowerCase() === "i") { e.preventDefault(); fileRef.current?.click(); }
      if (e.key.toLowerCase() === "n") { e.preventDefault(); router.push(`/office/${kind ?? "word"}/new${matterId ? `?matter=${matterId}` : ""}`); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, matterId, router]);

  const total = data.docs.length;

  return (
    <div
      className={cn("relative h-full overflow-y-auto scrollbar-thin", fileOver && "bg-primary/5")}
      onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setFileOver(true); } }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setFileOver(false); }}
      onDrop={(e) => { if (isFileDrag(e)) { e.preventDefault(); setFileOver(false); if (e.dataTransfer.files.length) void uploads.upload(e.dataTransfer.files, { matterId: matterId || null }); } }}
    >
      <TopbarSlot>
        <LayoutGrid className="size-4 text-muted-foreground" />
        <button onClick={() => setKind(null)} className="shrink-0 text-sm font-semibold hover:text-primary cursor-pointer">Office</button>
        {kind && (<><ChevronRight className="size-3.5 text-muted-foreground" /><span className="text-sm text-muted-foreground">{KIND_META[kind].plural}</span></>)}
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <div className="hidden items-center gap-1 md:flex">
          {!data.aiConfigured && <Tip label="Add OPENAI_API_KEY to enable the drafting agents"><Link href="/settings#ai"><Badge variant="warning" className="gap-1 cursor-pointer"><KeyRound className="size-3" /> agents need a key</Badge></Link></Tip>}
        </div>
      </TopbarSlot>

      {fileOver && (
        <div className="pointer-events-none fixed inset-x-6 inset-y-20 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-background/70 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-lg bg-background px-4 py-2 text-sm shadow-lg"><Upload className="size-4 text-primary" /> Drop .docx, .xlsx, .pptx, .pdf, .md, .csv… to import</div>
        </div>
      )}

      <div className="mx-auto w-full max-w-[1440px] space-y-8 p-4 pb-12 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Office suite</div>
            <h1 className="font-serif text-3xl leading-tight tracking-tight">Documents, workbooks, decks and PDFs</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Browser-native editors with a drafting agent in each: <span className="font-medium text-foreground">Draft</span> makes previewed, tracked edits; <span className="font-medium text-foreground">Review</span> flags citations, defined terms and risk; <span className="font-medium text-foreground">Ask</span> answers from the document, the matter and the library.</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" multiple accept={ALL_ACCEPT} className="hidden" onChange={(e) => { if (e.target.files?.length) void uploads.upload(e.target.files, { matterId: matterId || null }); e.target.value = ""; }} />
            <Tip label="Import a file into the matching editor" shortcut="I"><Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploads.busy}>{uploads.busy ? <Loader2 className="size-4 animate-spin" /> : <Import className="size-4" />} Import</Button></Tip>
            <Button asChild><Link href={`/office/${kind ?? "word"}/new${matterId ? `?matter=${matterId}` : ""}`}><FileText className="size-4" /> New {kind ? KIND_META[kind].lower : "document"}</Link></Button>
          </div>
        </div>

        {/* Hero tiles */}
        <NewTiles templates={data.templates} counts={data.counts} activeKind={kind} matterId={matterId || null} />

        {/* Recent documents */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Recent</h2>
            <span className="text-xs text-muted-foreground">{docs.length} of {total}</span>
            <div className="ml-2 flex items-center gap-0.5 rounded-lg bg-muted p-0.5 text-xs">
              <KindTab active={!kind} onClick={() => setKind(null)} label="All" count={total} />
              {OFFICE_KINDS.map((k) => <KindTab key={k} active={kind === k} onClick={() => setKind(k)} label={KIND_META[k].plural} count={data.counts[k]} icon={KIND_ICON[k]} />)}
            </div>
            <div className="flex-1" />
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, tags, matters…" className="h-8 pl-8 pr-8 text-sm" aria-label="Search documents" />
              {query ? <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Clear"><X className="size-3.5" /></button> : <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline">/</kbd>}
            </div>
            <Select value={matterId || "__all__"} onValueChange={(v) => setMatterId(v === "__all__" ? "" : v)}>
              <SelectTrigger size="sm" className="w-[170px]"><SelectValue placeholder="All matters" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All matters</SelectItem>{data.matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><ArrowUpDown className="size-3.5" /> {SORT_LABEL[sort]}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuLabel>Sort by</DropdownMenuLabel><DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>{(Object.keys(SORT_LABEL) as Sort[]).map((s) => <DropdownMenuRadioItem key={s} value={s}>{SORT_LABEL[s]}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
            </DropdownMenu>
            <ToggleGroup type="single" value={hydrated ? viewMode : "grid"} onValueChange={(v) => v && setViewMode(v as "grid" | "list")} size="sm" variant="outline" className="rounded-md border p-0.5 [&>button]:border-0 [&>button]:shadow-none">
              <ToggleGroupItem value="grid" aria-label="Grid" size="xs"><LayoutGrid className="size-4" /></ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List" size="xs"><List className="size-4" /></ToggleGroupItem>
            </ToggleGroup>
          </div>

          {loading && !data.docs.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[168px] rounded-xl" />)}</div>
          ) : docs.length === 0 ? (
            <EmptyState icon={FileText} title={query || matterId || kind ? "No documents match" : "No documents yet"} description={query || matterId ? "Try clearing the search or matter filter." : "Create one from a tile above, or drop a file anywhere on this page to import it."} action={<Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Import className="size-3.5" /> Import a file</Button>} />
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{docs.map((d) => <DocCard key={d.id} doc={d} actions={actions} />)}</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <div className="min-w-[960px]">
                <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span className="w-4" /><span className="min-w-[240px] flex-1">Title</span><span className="w-[100px]">Type</span><span className="w-[150px]">Matter</span><span className="w-[150px]">Owner</span><span className="w-[110px]">Updated</span><span className="w-[90px]">Versions</span><span className="w-[70px] text-right">Size</span><span className="w-7" /></div>
                {docs.map((d) => <DocRow key={d.id} doc={d} actions={actions} />)}
              </div>
            </div>
          )}
        </section>

        {/* Templates */}
        <section className="space-y-3">
          <div className="flex items-center gap-2"><LayoutTemplate className="size-4 text-muted-foreground" /><h2 className="text-base font-semibold">Templates</h2><span className="text-xs text-muted-foreground">{data.templates.filter((t) => !kind || t.kind === kind).length}{kind ? ` for ${KIND_META[kind].lowerPlural}` : ""}</span><span className="ml-auto text-xs text-muted-foreground">Manage in <Link href="/library?folder=lib_folder_templates" className="text-primary hover:underline">Library → Templates</Link></span></div>
          <TemplatesSection templates={data.templates} kind={kind} matterId={matterId || null} query={query} />
        </section>

        {/* Agent tips */}
        <section className="space-y-3">
          <div className="flex items-center gap-2"><Sparkles className="size-4 text-muted-foreground" /><h2 className="text-base font-semibold">Working with the agent</h2>{!data.aiConfigured && <Badge variant="warning" className="gap-1"><KeyRound className="size-3" /> OpenAI key required</Badge>}</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <TipCard icon={PenLine} title="Draft" blurb="Ask for changes; every edit arrives as a previewed proposal you apply as tracked changes." examples={["Tighten the introduction to three sentences and add a roadmap.", "Insert a limitation-of-liability clause from the clause bank after §12.", "Convert the deadline list into a table with owner and date columns."]} />
            <TipCard icon={ScanSearch} title="Review" blurb="Read-only pass that records findings — citations to verify, undefined terms, broken cross-references, risk — with one-click fixes." examples={["Check every citation and mark anything unverified.", "Find defined terms used before they are defined.", "Flag formulas that reference empty cells."]} />
            <TipCard icon={MessageCircleQuestion} title="Ask" blurb="Questions about the document, the matter record and the library, with paragraph, cell or slide references." examples={["Which paragraphs rely on the Voss deposition?", "Summarize the assumptions behind the damages model.", "What does the firm style say about record cites?"]} />
          </div>
        </section>
      </div>
    </div>
  );
}

function KindTab({ active, onClick, label, count, icon: Icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors cursor-pointer", active ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      {Icon && <Icon className="size-3.5" />}{label}<span className={cn("tabular text-[10px]", active ? "text-muted-foreground" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

function TipCard({ icon: Icon, title, blurb, examples }: { icon: React.ComponentType<{ className?: string }>; title: string; blurb: string; examples: string[] }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><h3 className="text-sm font-semibold">{title}</h3></div>
      <p className="mt-2 text-xs text-muted-foreground">{blurb}</p>
      <ul className="mt-3 space-y-1.5">
        {examples.map((e) => <li key={e} className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-[11.5px] leading-snug">“{e}”</li>)}
      </ul>
    </div>
  );
}
