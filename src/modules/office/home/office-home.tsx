"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, ChevronRight, FileText, Import, KeyRound, LayoutGrid, LayoutTemplate, List, Loader2, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { OfficeKind } from "@/lib/types/domain";
import { useUploads, isFileDrag } from "@/modules/library/components/use-uploads";
import { SegmentedControl } from "@/modules/office/shared/office-chrome";
import { KIND_META, OFFICE_KINDS, type OfficeDocSummary, type OfficeHomeData } from "./types";
import { NewTiles, KIND_ICON } from "./new-tiles";
import { DocCard, DocRow, DocRowHeader, duplicateOfficeDoc, type DocActions } from "./doc-card";
import { TemplatesSection } from "./templates-section";

type Sort = "updated" | "title" | "kind" | "created";
type KindTab = "all" | OfficeKind;
const SORT_LABEL: Record<Sort, string> = { updated: "Last updated", title: "Title", kind: "Type", created: "Created" };
const ALL_ACCEPT = OFFICE_KINDS.map((k) => KIND_META[k].accept).join(",");

/**
 * Office home: four New tiles, recent documents as a tidy list (or grid), a
 * quiet template gallery. Drop a file anywhere to import it into the matching editor.
 */
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
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("list");
  const [fileOver, setFileOver] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setHydrated(true); try { const v = localStorage.getItem("leclaude:office-home:view"); if (v === "list" || v === "grid") setViewMode(v); } catch {} }, []);
  React.useEffect(() => { if (hydrated) { try { localStorage.setItem("leclaude:office-home:view", viewMode); } catch {} } }, [viewMode, hydrated]);

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

  // Keyboard: "/" focuses search, 1/2 view, N new doc of the active kind, I import
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("[role=dialog]"))) return;
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
  const kindTabs = React.useMemo(() => [
    { id: "all" as KindTab, label: <>All <span className="ml-1 text-[11px] tabular text-muted-foreground">{total}</span></> },
    ...OFFICE_KINDS.map((k) => ({ id: k as KindTab, label: <>{KIND_META[k].plural} <span className="ml-1 text-[11px] tabular text-muted-foreground">{data.counts[k]}</span></>, icon: KIND_ICON[k] })),
  ], [total, data.counts]);
  const filtered = Boolean(query || matterId || kind);

  return (
    <div
      className={cn("relative h-full overflow-y-auto scrollbar-thin", fileOver && "bg-primary/5")}
      onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setFileOver(true); } }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setFileOver(false); }}
      onDrop={(e) => { if (isFileDrag(e)) { e.preventDefault(); setFileOver(false); if (e.dataTransfer.files.length) void uploads.upload(e.dataTransfer.files, { matterId: matterId || null }); } }}
    >
      <TopbarSlot>
        <LayoutGrid className="size-4 text-muted-foreground" />
        <button onClick={() => setKind(null)} className="shrink-0 text-[13px] font-semibold hover:text-primary cursor-pointer">Office</button>
        {kind && (<><ChevronRight className="size-3.5 text-muted-foreground" /><span className="text-[13px] text-muted-foreground">{KIND_META[kind].plural}</span></>)}
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {!data.aiConfigured && (
          <Tip label="Add OPENAI_API_KEY to enable the drafting assistants. Editing, comments and versions work without it.">
            <Link href="/settings#ai" className="hidden h-6 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 text-[11px] text-warning-foreground md:inline-flex dark:text-warning"><KeyRound className="size-3" /> Assistants need a key</Link>
          </Tip>
        )}
      </TopbarSlot>

      {fileOver && (
        <div className="pointer-events-none fixed inset-x-6 inset-y-20 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-background/70 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-[13px] shadow-lg"><Upload className="size-4 text-primary" /> Drop .docx, .xlsx, .pptx, .pdf, .md, .csv… to import</div>
        </div>
      )}

      <div className="mx-auto w-full max-w-[1400px] space-y-8 p-4 pb-16 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-[22px] font-semibold leading-tight tracking-tight">Documents, workbooks, decks and PDFs</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Browser-native editors with a drafting assistant in each. Edits arrive as previewed proposals; review flags citations and risk; ask answers from the document, the matter and the library.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input ref={fileRef} type="file" multiple accept={ALL_ACCEPT} className="hidden" onChange={(e) => { if (e.target.files?.length) void uploads.upload(e.target.files, { matterId: matterId || null }); e.target.value = ""; }} />
            <Tip label="Import a file into the matching editor" shortcut="I"><Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploads.busy}>{uploads.busy ? <Loader2 className="size-4 animate-spin" /> : <Import className="size-4" />} Import</Button></Tip>
            <Tip label={`New ${kind ? KIND_META[kind].lower : "document"}`} shortcut="N"><Button size="sm" asChild><Link href={`/office/${kind ?? "word"}/new${matterId ? `?matter=${matterId}` : ""}`}><FileText className="size-4" /> New {kind ? KIND_META[kind].lower : "document"}</Link></Button></Tip>
          </div>
        </div>

        {/* New tiles */}
        <NewTiles templates={data.templates} counts={data.counts} activeKind={kind} matterId={matterId || null} />

        {/* Recent documents */}
        <section className="space-y-3" aria-labelledby="office-recent">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="office-recent" className="text-[15px] font-semibold">Recent</h2>
            <span className="text-[11.5px] tabular text-muted-foreground">{docs.length} of {total}</span>
            <div className="flex-1" />
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, tags, matters" className="h-8 pl-8 pr-8 text-[13px]" aria-label="Search documents" />
              {query ? <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Clear search"><X className="size-3.5" /></button> : <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline">/</kbd>}
            </div>
            <Select value={matterId || "__all__"} onValueChange={(v) => setMatterId(v === "__all__" ? "" : v)}>
              <SelectTrigger size="sm" className="w-[160px]" aria-label="Filter by matter"><SelectValue placeholder="All matters" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All matters</SelectItem>{data.matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm" aria-label={`Sort by ${SORT_LABEL[sort]}`}><ArrowUpDown className="size-3.5" /><span className="hidden lg:inline">{SORT_LABEL[sort]}</span></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuLabel>Sort by</DropdownMenuLabel><DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>{(Object.keys(SORT_LABEL) as Sort[]).map((s) => <DropdownMenuRadioItem key={s} value={s}>{SORT_LABEL[s]}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
            </DropdownMenu>
            <SegmentedControl ariaLabel="View" size="sm" value={hydrated ? viewMode : "list"} onChange={setViewMode} options={[{ id: "list", label: "", icon: List, title: "List", shortcut: "2" }, { id: "grid", label: "", icon: LayoutGrid, title: "Grid", shortcut: "1" }]} />
          </div>
          <SegmentedControl ariaLabel="Document type" size="sm" value={(kind ?? "all") as KindTab} onChange={(v) => setKind(v === "all" ? null : v)} options={kindTabs} />

          {loading && !data.docs.length ? (
            <div className="space-y-1">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-md" />)}</div>
          ) : docs.length === 0 ? (
            <EmptyState compact icon={FileText} title={filtered ? "No documents match" : "No documents yet"} description={query || matterId ? "Try clearing the search or matter filter." : "Create one from a tile above, or drop a file anywhere on this page to import it."} action={<Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Import className="size-3.5" /> Import a file</Button>} />
          ) : (hydrated ? viewMode : "list") === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{docs.map((d) => <DocCard key={d.id} doc={d} actions={actions} />)}</div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card" role="table" aria-label="Recent documents">
              <DocRowHeader />
              {docs.map((d) => <DocRow key={d.id} doc={d} actions={actions} />)}
            </div>
          )}
        </section>

        {/* Templates */}
        <section className="space-y-3" aria-labelledby="office-templates">
          <div className="flex flex-wrap items-baseline gap-2">
            <LayoutTemplate className="size-4 self-center text-muted-foreground" />
            <h2 id="office-templates" className="text-[15px] font-semibold">Templates</h2>
            <span className="text-[11.5px] tabular text-muted-foreground">{data.templates.filter((t) => !kind || t.kind === kind).length}{kind ? ` for ${KIND_META[kind].lowerPlural}` : ""}</span>
            <span className="ml-auto text-[11.5px] text-muted-foreground">Managed in <Link href="/library?folder=lib_folder_templates" className="text-primary hover:underline">Library → Templates</Link></span>
          </div>
          <TemplatesSection templates={data.templates} kind={kind} matterId={matterId || null} query={query} />
        </section>

        <p className="text-[11.5px] text-muted-foreground">In every editor: <span className="font-medium text-foreground">Draft</span> proposes edits you apply as tracked changes · <span className="font-medium text-foreground">Review</span> flags citations, defined terms and risk · <span className="font-medium text-foreground">Ask</span> answers with paragraph, cell or slide references. Press <kbd>⌘/</kbd> inside an editor to open the assistant.</p>
      </div>
    </div>
  );
}
