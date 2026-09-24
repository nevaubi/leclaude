"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Briefcase, ChevronDown, Download, FileSpreadsheet, FileText, History, Loader2, Printer, Save, Sparkles, Upload, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Matter, OfficeComment } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TopbarSlot } from "@/components/shell/app-shell";
import { saveStateLabel, useOfficeDoc, type ApplyResult, type EditProposal, type OfficeScope } from "@/modules/office/shared";
import "./sheet.css";
import { applyProposals, locateTarget, previewProposal } from "./apply-proposals";
import { downloadCsv, downloadXlsx, importFile, MOD, printWorkbook } from "./client-utils";
import { ChartDialog, ConditionalFormatDialog, FindReplaceDialog, NamedRangesDialog, SortDialog, ValidationDialog, VersionsDialog } from "./dialogs";
import { formulaErrors } from "./engine";
import { FormulaBar } from "./formula-bar";
import { SheetGrid } from "./grid";
import { emptyWorkbook, type ChartType, type Workbook } from "./model";
import { PrintView } from "./print-view";
import { SheetTabs } from "./sheet-tabs";
import { SidePanel, type SideTab } from "./side-panel";
import { buildSnapshot } from "./snapshot";
import { StatusBar } from "./status-bar";
import { useSheetStore } from "./store";
import { SheetToolbar, type DialogKind } from "./toolbar";
import { rangeToA1, toA1 } from "./a1";

const SUGGESTIONS = {
  draft: [
    "Add a Total row that sums every numeric column",
    "Build a settlement tracker template with headers and formulas",
    "Chart the first two columns as a bar chart",
    "Style this as a professional table: bold shaded header, borders, currency, frozen header",
    "Build a settlement allocation: gross, fees, costs, liens, net to client",
    "Highlight overdue rows and sort by due date",
  ],
  review: ["Check every formula for errors and hardcoded numbers", "Are the totals consistent with the detail rows?", "Find numbers stored as text and inconsistent dates"],
  ask: ["Explain what's in A1:A1", "What does this workbook model and what are its inputs?", "Which rows are overdue as of today?"],
};

export interface SheetEditorPageProps { id: string; templateId?: string | null; matterId?: string | null; matters: Matter[] }

export function SheetEditorPage({ id, templateId, matterId, matters }: SheetEditorPageProps) {
  const router = useRouter();
  const office = useOfficeDoc<Workbook>({ id, kind: "sheet", emptyContent: emptyWorkbook, templateId: templateId ?? null, matterId: matterId ?? null, autosaveMs: 1500 });
  const { doc, loading, error } = office;
  const store = useSheetStore;
  const workbook = useSheetStore((s) => s.workbook);
  const computed = useSheetStore((s) => s.computed);
  const selection = useSheetStore((s) => s.selection);
  const revision = useSheetStore((s) => s.revision);
  const [ready, setReady] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [comments, setComments] = React.useState<OfficeComment[]>([]);
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [tab, setTab] = React.useState<SideTab>("assistant");
  const [draftAnchor, setDraftAnchor] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<DialogKind | null>(null);
  const [chartEdit, setChartEdit] = React.useState<{ id?: string; type?: ChartType } | null>(null);
  const [layout, setLayout] = React.useState({ firstRow: 1, lastRow: 100, pages: 1 });
  const [exporting, setExporting] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const sheet = workbook.sheets[workbook.activeSheet] ?? workbook.sheets[0];
  const matter = React.useMemo(() => matters.find((m) => m.id === (doc?.matterId ?? matterId)) ?? null, [matters, doc?.matterId, matterId]);
  const errors = React.useMemo(() => formulaErrors(workbook, computed, sheet.id).length, [workbook, computed, sheet.id]);

  // load document into the store
  React.useEffect(() => {
    if (!doc) return;
    store.getState().load(doc.content);
    store.getState().setOnChange((wb) => office.markDirty(wb));
    setTitle(doc.title);
    setReady(true);
    void office.comments.list().then(setComments).catch(() => setComments([]));
    return () => { store.getState().setOnChange(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);
  React.useEffect(() => { if (doc?.title) setTitle(doc.title); }, [doc?.title]);
  React.useEffect(() => { void revision; }, [revision]);
  // Development hook for browser automation / debugging (never in production builds).
  React.useEffect(() => { if (process.env.NODE_ENV !== "production") (window as unknown as { __leclaudeSheetStore?: unknown }).__leclaudeSheetStore = useSheetStore; }, []);

  const focusGrid = React.useCallback(() => { (document.querySelector(".sheet-grid") as HTMLElement | null)?.focus(); }, []);
  const saveNow = React.useCallback(async () => { const r = await office.save(); if (r) toast.success("Saved"); }, [office]);
  const commitTitle = React.useCallback(async () => { const t = title.trim() || "Untitled workbook"; if (t !== doc?.title) await office.setTitle(t); }, [title, doc?.title, office]);

  // comments API wrappers
  const refreshComments = React.useCallback(async () => { try { setComments(await office.comments.list()); } catch { /* ignore */ } }, [office]);
  const addComment = React.useCallback(async (anchor: string, body: string) => { await office.comments.add({ anchor, body }); await refreshComments(); }, [office, refreshComments]);
  const updateComment = React.useCallback(async (cid: string, patch: { resolved?: boolean; reply?: string; body?: string }) => { await office.comments.update(cid, patch); await refreshComments(); }, [office, refreshComments]);
  const deleteComment = React.useCallback(async (cid: string) => { await office.comments.remove(cid); await refreshComments(); }, [office, refreshComments]);

  // agent wiring
  const getSnapshot = React.useCallback(() => {
    const st = store.getState();
    const wb = st.workbook;
    const active = wb.sheets[wb.activeSheet];
    return buildSnapshot(wb, st.computed, { title: title || doc?.title || "Untitled workbook", selection: { sheet: active.name, range: st.selectionA1() }, comments: comments.map((c) => ({ id: c.id, anchor: c.anchor, body: c.body, author: c.authorName, resolved: c.resolved })), matterId: doc?.matterId ?? matterId ?? null });
  }, [store, title, doc?.title, doc?.matterId, matterId, comments]);
  const scopes = React.useMemo<OfficeScope[]>(() => {
    const out: OfficeScope[] = [{ id: "document", label: "Whole workbook", kind: "document" }];
    if (workbook.sheets.length > 1) out.push({ id: `sheet:${sheet.name}`, label: sheet.name, kind: "sheet", ref: sheet.name });
    const r = selection.ranges[selection.ranges.length - 1];
    if (r && (r.start.row !== r.end.row || r.start.col !== r.end.col)) out.push({ id: `range:${sheet.name}!${rangeToA1(r)}`, label: rangeToA1(r), kind: "range", ref: `${sheet.name}!${rangeToA1(r)}` });
    return out;
  }, [workbook.sheets.length, sheet.name, selection.ranges]);
  const onApplyProposals = React.useCallback(async (ps: EditProposal[]): Promise<ApplyResult> => {
    const r = await applyProposals(ps, { store: () => store.getState(), addComment: async (input) => { await office.comments.add(input); await refreshComments(); } });
    store.getState().setPreview(null);
    return r;
  }, [store, office, refreshComments]);
  // Locate selects the target and shows a dashed preview highlight (cleared on apply / Escape).
  const onLocate = React.useCallback((target: string) => { const st = store.getState(); locateTarget(target, st); previewProposal({ id: "", kind: "", title: "", target, payload: {}, status: "pending" }, store.getState()); focusGrid(); }, [store, focusGrid]);
  const onApplied = React.useCallback((summary: string) => { void office.save({ version: { summary, authorName: "Spreadsheet assistant", force: true } }); }, [office]);

  // keyboard shortcuts (page level)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); void saveNow(); }
      else if (k === "f" || k === "h") { e.preventDefault(); setDialog("find"); }
      else if (k === "/") { e.preventDefault(); setPanelOpen(true); setTab("assistant"); }
      else if (k === "p") { e.preventDefault(); printWorkbook(); }
      else if (k === "`") { e.preventDefault(); store.getState().setShowFormulas(!store.getState().showFormulas); }
      else if (e.shiftKey && k === "m") { e.preventDefault(); startComment(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveNow]);

  const startComment = (ref?: string) => {
    const st = store.getState();
    const a = st.selection.active;
    setDraftAnchor(`${st.activeSheet().name}!${ref ?? toA1(a.row, a.col)}`);
    setPanelOpen(true);
    setTab("comments");
  };
  const insertChart = (type: ChartType) => { setChartEdit({ type }); setDialog("chart"); };
  const doExport = async (kind: "xlsx" | "csv" | "pdf") => {
    if (kind === "pdf") { printWorkbook(); return; }
    setExporting(kind);
    try {
      const wb = store.getState().workbook;
      if (kind === "xlsx") { await downloadXlsx(wb, title || "workbook", doc?.id); toast.success("Exported .xlsx", { description: "Values, formulas, formats, widths, merges and names. Charts are not included in XLSX export." }); }
      else await downloadCsv(wb, title || "workbook", sheet.name, doc?.id);
    } catch (e) { toast.error(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };
  const onImport = async (file: File) => {
    const t = toast.loading(`Importing ${file.name}…`);
    try { const { url } = await importFile(file, doc?.matterId ?? matterId); toast.success("Imported", { id: t }); router.push(url); }
    catch (e) { toast.error(`Import failed: ${(e as Error).message}`, { id: t }); }
  };
  const saveLabel = saveStateLabel(office.saveState, office.lastSavedAt);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <TopbarSlot><Link href="/library" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to Library</Link></TopbarSlot>
        <EmptyState icon={AlertTriangle} title={error} description="The workbook may have been deleted, or the link is wrong." action={<Button asChild variant="outline"><Link href="/office?kind=sheet">Open workbooks</Link></Button>} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <TopbarSlot>
        <Tip label="Back to Library"><Link href="/library" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Library</Link></Tip>
        <Badge variant="success" className="shrink-0 gap-1 font-mono"><FileSpreadsheet className="size-3" /> XLSX</Badge>
        {matter && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="hidden max-w-[180px] shrink-0 items-center gap-1 truncate rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground lg:flex cursor-pointer"><Briefcase className="size-3" /><span className="truncate">{matter.shortName}</span><ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Matter</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={matter.id} onValueChange={(v) => void office.save({ matterId: v })}>{matters.map((mm) => <DropdownMenuRadioItem key={mm.id} value={mm.id}><span className="truncate">{mm.shortName} <span className="text-muted-foreground">· {mm.client}</span></span></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void commitTitle()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} aria-label="Workbook title" placeholder="Untitled workbook" className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold outline-none transition-colors hover:border-border focus:border-ring focus:bg-background" />
        <span className={cn("hidden shrink-0 text-[11px] xl:inline", office.saveState === "error" ? "text-destructive" : office.saveState === "dirty" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>{saveLabel}</span>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="gap-1.5">{exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download <ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => void doExport("xlsx")}><FileSpreadsheet /> Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport("csv")}><FileText /> CSV — {sheet.name}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport("pdf")}><Printer /> PDF (print) <span className="ml-auto text-[10px] text-muted-foreground">{MOD}P</span></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}><Upload /> Import .xlsx / .csv…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }} />
          <Tip label="Save" shortcut={`${MOD}S`}><Button variant="ghost" size="sm" onClick={() => void saveNow()} disabled={office.saveState === "saving"}><Save className="size-4" /> Save</Button></Tip>
          <Tip label="Version history"><Button variant="ghost" size="sm" onClick={() => setDialog("versions")} disabled={!ready}><History className="size-4" /> Versions</Button></Tip>
          <Tip label="Spreadsheet assistant" shortcut={`${MOD}/`}><Button variant={panelOpen && tab === "assistant" ? "secondary" : "ghost"} size="icon-sm" onClick={() => { if (panelOpen && tab === "assistant") setPanelOpen(false); else { setPanelOpen(true); setTab("assistant"); } }} aria-label="Toggle assistant"><Sparkles className={cn("size-4", panelOpen && tab === "assistant" && "text-primary")} /></Button></Tip>
          <Tip label="Side panel"><Button variant={panelOpen ? "secondary" : "ghost"} size="icon-sm" onClick={() => setPanelOpen((v) => !v)} aria-pressed={panelOpen} aria-label="Toggle side panel"><PanelRight className="size-4" /></Button></Tip>
        </div>
      </TopbarSlot>

      <SheetToolbar onOpen={(d) => { if (d === "chart") setChartEdit({}); setDialog(d); }} onInsertChart={insertChart} onAddComment={() => startComment()} disabled={!ready} />
      <FormulaBar onFocusGrid={focusGrid} />

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel minSize={420}>
            <div className="flex h-full min-h-0 flex-col">
              {!ready || loading ? (
                <div className="flex-1 space-y-1 p-3">{Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" style={{ opacity: 1 - i * 0.05 }} />)}</div>
              ) : (
                <SheetGrid comments={comments} onOpenComment={(anchor) => { setPanelOpen(true); setTab("comments"); onLocate(anchor); }} onAddComment={(ref) => startComment(ref)} onInsertChart={insertChart} onLayout={setLayout} onEditChart={(cid) => { setChartEdit({ id: cid }); setDialog("chart"); }} className="flex-1" />
              )}
              <SheetTabs />
            </div>
          </ResizablePanel>
          {panelOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={400} minSize={320} maxSize={640}>
                <SidePanel
                  tab={tab}
                  onTab={setTab}
                  agent={{ endpoint: "/api/office/sheet/agent", docId: doc?.id, docTitle: title || doc?.title || "Untitled workbook", matterId: doc?.matterId ?? matterId ?? null, getSnapshot, scopes, applyProposals: onApplyProposals, onUndo: () => store.getState().undo(), onLocate, suggestions: SUGGESTIONS, onApplied, extraContext: () => ({ activeSheet: sheet.name, selection: store.getState().selectionA1(), showFormulas: store.getState().showFormulas }) }}
                  comments={comments}
                  draftAnchor={draftAnchor}
                  onDraftAnchor={setDraftAnchor}
                  onAddComment={addComment}
                  onUpdateComment={updateComment}
                  onDeleteComment={deleteComment}
                  onLocate={onLocate}
                  onEditChart={(cid) => { setChartEdit({ id: cid }); setDialog("chart"); }}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <StatusBar firstRow={layout.firstRow} lastRow={layout.lastRow} pages={layout.pages} saveLabel={saveLabel} loading={loading} comments={comments.filter((c) => !c.resolved).length} errors={errors} saveState={office.saveState} />

      <ConditionalFormatDialog open={dialog === "conditional"} onOpenChange={(v) => !v && setDialog(null)} />
      <FindReplaceDialog open={dialog === "find"} onOpenChange={(v) => !v && setDialog(null)} />
      <NamedRangesDialog open={dialog === "names"} onOpenChange={(v) => !v && setDialog(null)} />
      <ValidationDialog open={dialog === "validation"} onOpenChange={(v) => !v && setDialog(null)} />
      <SortDialog open={dialog === "sort"} onOpenChange={(v) => !v && setDialog(null)} />
      <ChartDialog open={dialog === "chart"} onOpenChange={(v) => { if (!v) { setDialog(null); setChartEdit(null); } }} chartId={chartEdit?.id ?? null} initialType={chartEdit?.type} />
      <VersionsDialog open={dialog === "versions"} onOpenChange={(v) => !v && setDialog(null)} list={office.versions.list} checkpoint={office.versions.checkpoint} restore={async (vid) => { const d = await office.versions.restore(vid); if (d) { store.getState().load(d.content); store.getState().setOnChange((wb) => office.markDirty(wb)); } }} />
      <PrintView title={title || doc?.title || "Workbook"} />
    </div>
  );
}
