"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, History, ListChecks, Printer, Search, Sparkles, TableProperties, Tags, Upload, PanelRight } from "lucide-react";
import type { Matter, OfficeComment } from "@/lib/types/domain";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { saveStateLabel, useOfficeDoc, type ApplyResult, type EditProposal, type OfficeScope } from "@/modules/office/shared";
import { OfficeChrome, OfficeErrorState, ToolbarSkeleton, useNarrowViewport, type ChromeMenuEntry } from "@/modules/office/shared/office-chrome";
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
  ask: ["What does this workbook model and what are its inputs?", "Which rows are overdue as of today?"],
};

export interface SheetEditorPageProps { id: string; templateId?: string | null; matterId?: string | null; matters: Matter[] }

export function SheetEditorPage({ id, templateId, matterId, matters }: SheetEditorPageProps) {
  const router = useRouter();
  const office = useOfficeDoc<Workbook>({ id, kind: "sheet", emptyContent: emptyWorkbook, templateId: templateId ?? null, matterId: matterId ?? null, autosaveMs: 1500 });
  const { doc, loading, error } = office;
  const officeRef = React.useRef(office);
  officeRef.current = office;
  const narrow = useNarrowViewport();
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
  const [versionCount, setVersionCount] = React.useState<number | undefined>(undefined);
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
  React.useEffect(() => { if (doc?.title && document.activeElement?.getAttribute("data-title-input") !== "1") setTitle(doc.title); }, [doc?.title]);
  React.useEffect(() => { void revision; }, [revision]);
  // Narrow viewports open with the side panel closed; ⌘/ or the toggles reopen it.
  const autoCollapsed = React.useRef(false);
  React.useEffect(() => { if (narrow && !autoCollapsed.current) { autoCollapsed.current = true; setPanelOpen(false); } }, [narrow]);
  // "Versions (n)" in the assistant header; refreshed after each save.
  const contentVersion = doc?.contentVersion;
  React.useEffect(() => {
    if (!ready || !doc?.id) return;
    let alive = true;
    officeRef.current.versions.list().then((v) => { if (alive) setVersionCount(v.length); }).catch(() => {});
    return () => { alive = false; };
  }, [ready, doc?.id, contentVersion]);
  // Development hook for browser automation / debugging (never in production builds).
  React.useEffect(() => { if (process.env.NODE_ENV !== "production") (window as unknown as { __leclaudeSheetStore?: unknown }).__leclaudeSheetStore = useSheetStore; }, []);

  const focusGrid = React.useCallback(() => { (document.querySelector(".sheet-grid") as HTMLElement | null)?.focus(); }, []);
  const saveNow = React.useCallback(async () => { const r = await office.save(); if (r) toast.success("Saved", { duration: 1200 }); }, [office]);
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
  const selectionLabel = React.useMemo(() => { const r = selection.ranges[selection.ranges.length - 1]; return r ? rangeToA1(r) : "A1"; }, [selection.ranges]);
  const suggestions = React.useMemo(() => ({ ...SUGGESTIONS, ask: [`Explain what's in ${selectionLabel}`, ...SUGGESTIONS.ask] }), [selectionLabel]);
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
      else if (k === "/") { e.preventDefault(); setPanelOpen((open) => !(open && tabRef.current === "assistant")); setTab("assistant"); }
      else if (k === "p") { e.preventDefault(); printWorkbook(); }
      else if (k === "`") { e.preventDefault(); store.getState().setShowFormulas(!store.getState().showFormulas); }
      else if (e.shiftKey && k === "m") { e.preventDefault(); startComment(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveNow]);
  const tabRef = React.useRef(tab);
  tabRef.current = tab;

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
  const openComments = comments.filter((c) => !c.resolved).length;

  const downloadEntries: ChromeMenuEntry[] = [
    { label: "Excel (.xlsx)", icon: FileSpreadsheet, onSelect: () => void doExport("xlsx") },
    { label: `CSV — ${sheet.name}`, icon: FileText, onSelect: () => void doExport("csv") },
    { label: "PDF (print)", icon: Printer, shortcut: `${MOD}P`, onSelect: () => void doExport("pdf") },
    "separator",
    { label: "Import .xlsx / .csv…", icon: Upload, onSelect: () => fileInputRef.current?.click() },
  ];
  const moreEntries: ChromeMenuEntry[] = [
    { label: "Version history", icon: History, onSelect: () => setDialog("versions") },
    "separator",
    { label: "Find & replace…", icon: Search, shortcut: `${MOD}F`, onSelect: () => setDialog("find") },
    { label: "Named ranges…", icon: Tags, onSelect: () => setDialog("names") },
    { label: "Data validation…", icon: ListChecks, onSelect: () => setDialog("validation") },
    { label: "Conditional formatting…", icon: TableProperties, onSelect: () => setDialog("conditional") },
  ];

  if (error) return <OfficeErrorState kind="sheet" error={error} description="The workbook may have been deleted, or the link is wrong." />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <OfficeChrome
        kind="sheet"
        title={title}
        onTitleChange={setTitle}
        onTitleCommit={commitTitle}
        matter={matter}
        matters={matters}
        onMatterChange={(v) => void office.save({ matterId: v })}
        saveState={office.saveState}
        lastSavedAt={office.lastSavedAt}
        onSave={() => void saveNow()}
        ready={ready}
        download={downloadEntries}
        downloadLabel="Export"
        exporting={Boolean(exporting)}
        more={moreEntries}
        panels={[
          { id: "assistant", label: "Spreadsheet assistant", icon: Sparkles, shortcut: `${MOD}/`, active: panelOpen && tab === "assistant", onToggle: () => { if (panelOpen && tab === "assistant") setPanelOpen(false); else { setPanelOpen(true); setTab("assistant"); } } },
          { id: "panel", label: panelOpen ? "Hide side panel" : "Show side panel", icon: PanelRight, active: panelOpen, onToggle: () => setPanelOpen((v) => !v), count: !panelOpen ? openComments : undefined },
        ]}
      />

      {ready ? <SheetToolbar onOpen={(d) => { if (d === "chart") setChartEdit({}); setDialog(d); }} onInsertChart={insertChart} onAddComment={() => startComment()} /> : <ToolbarSkeleton />}
      <FormulaBar onFocusGrid={focusGrid} />

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel minSize={360}>
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
              <ResizablePanel defaultSize={narrow ? 340 : 400} minSize={300} maxSize={640}>
                <SidePanel
                  tab={tab}
                  onTab={setTab}
                  onClose={() => setPanelOpen(false)}
                  agent={{ endpoint: "/api/office/sheet/agent", docId: doc?.id, docTitle: title || doc?.title || "Untitled workbook", matterId: doc?.matterId ?? matterId ?? null, getSnapshot, scopes, applyProposals: onApplyProposals, onUndo: () => store.getState().undo(), onLocate, suggestions, onApplied, extraContext: () => ({ activeSheet: sheet.name, selection: store.getState().selectionA1(), showFormulas: store.getState().showFormulas }), onVersions: () => setDialog("versions"), versionCount }}
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

      <StatusBar firstRow={layout.firstRow} lastRow={layout.lastRow} pages={layout.pages} saveLabel={saveLabel} loading={loading} comments={openComments} errors={errors} saveState={office.saveState} onComments={() => { setPanelOpen(true); setTab("comments"); }} />

      <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }} />
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
