"use client";
import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { BarChart3, Check, Crosshair, MessageSquare, Pencil, Reply, Sparkles, Trash2, Undo2, FileText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OfficeComment } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { OfficeAgentPanel, type OfficeAgentPanelProps } from "@/modules/office/shared";
import { chartData, ChartView } from "./charts";
import { DEFAULT_PAGE_SETUP, PAPER_SIZES, type PageSetup } from "./model";
import { useSheetStore } from "./store";
import { toA1 } from "./a1";

export type SideTab = "assistant" | "comments" | "charts" | "page";

export interface SidePanelProps {
  tab: SideTab;
  onTab: (t: SideTab) => void;
  agent: OfficeAgentPanelProps;
  comments: OfficeComment[];
  draftAnchor: string | null;
  onDraftAnchor: (a: string | null) => void;
  onAddComment: (anchor: string, body: string) => Promise<void>;
  onUpdateComment: (id: string, patch: { resolved?: boolean; reply?: string; body?: string }) => Promise<void>;
  onDeleteComment: (id: string) => Promise<void>;
  onLocate: (target: string) => void;
  onEditChart: (id: string) => void;
}

const TABS: { id: SideTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "assistant", label: "Assistant", icon: Sparkles },
  { id: "comments", label: "Comments", icon: MessageSquare },
  { id: "charts", label: "Charts", icon: BarChart3 },
  { id: "page", label: "Page Setup", icon: FileText },
];

export function SidePanel(p: SidePanelProps) {
  const open = p.comments.filter((c) => !c.resolved).length;
  const wb = useSheetStore((s) => s.workbook);
  const sheet = wb.sheets[wb.activeSheet];
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center border-b px-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => p.onTab(t.id)} className={cn("relative flex h-full items-center gap-1.5 px-2.5 text-xs font-medium transition-colors cursor-pointer", p.tab === t.id ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground")}>
            <t.icon className="size-3.5" /> {t.label}
            {t.id === "comments" && open > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] tabular text-primary">{open}</span>}
            {t.id === "charts" && sheet.charts.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular">{sheet.charts.length}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {p.tab === "assistant" && <OfficeAgentPanel {...p.agent} title="Spreadsheet assistant" />}
        {p.tab === "comments" && <CommentsTab {...p} />}
        {p.tab === "charts" && <ChartsTab onEdit={p.onEditChart} onLocate={p.onLocate} />}
        {p.tab === "page" && <PageSetupTab />}
      </div>
    </div>
  );
}

function CommentsTab({ comments, draftAnchor, onDraftAnchor, onAddComment, onUpdateComment, onDeleteComment, onLocate }: SidePanelProps) {
  const [draft, setDraft] = React.useState("");
  const [showResolved, setShowResolved] = React.useState(false);
  const [replyFor, setReplyFor] = React.useState<string | null>(null);
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const selection = useSheetStore((s) => s.selection);
  const wb = useSheetStore((s) => s.workbook);
  const sheet = wb.sheets[wb.activeSheet];
  const activeAnchor = `${sheet.name}!${toA1(selection.active.row, selection.active.col)}`;
  const list = comments.filter((c) => showResolved || !c.resolved).sort((a, b) => (a.resolved === b.resolved ? b.createdAt.localeCompare(a.createdAt) : a.resolved ? 1 : -1));
  const anchor = draftAnchor ?? activeAnchor;
  const submit = async () => { if (!draft.trim()) return; setBusy(true); try { await onAddComment(anchor, draft.trim()); setDraft(""); onDraftAnchor(null); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b p-2">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground"><span>Comment on <button onClick={() => onLocate(anchor)} className="font-mono text-primary hover:underline cursor-pointer">{anchor}</button></span><label className="flex items-center gap-1 cursor-pointer"><Checkbox checked={showResolved} onCheckedChange={(c) => setShowResolved(Boolean(c))} /> Show resolved</label></div>
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note for the team or the assistant… (⌘Enter to post)" rows={2} className="text-xs" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit(); }} />
        <div className="mt-1 flex justify-end"><Button size="xs" onClick={() => void submit()} disabled={busy || !draft.trim()}>Post</Button></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 scrollbar-thin">
        {list.length === 0 ? <EmptyState icon={MessageSquare} title="No comments" description="Select a cell and post a note. The assistant reads comments and can add its own." className="border-0" /> : (
          <ul className="space-y-2">
            {list.map((c) => (
              <li key={c.id} className={cn("rounded-md border bg-card p-2 text-xs", c.resolved && "opacity-60")}>
                <div className="flex items-center gap-1.5">
                  {c.source === "agent" ? <Sparkles className="size-3.5 text-primary" /> : <div className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px] font-semibold">{c.authorName.split(" ").map((x) => x[0]).join("").slice(0, 2)}</div>}
                  <span className="font-medium">{c.authorName}</span>
                  <span className="text-muted-foreground">{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                  <button onClick={() => onLocate(c.anchor)} className="ml-auto inline-flex items-center gap-0.5 font-mono text-[10px] text-primary hover:underline cursor-pointer"><Crosshair className="size-3" />{c.anchor}</button>
                </div>
                {c.quote && <div className="mt-1 truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{c.quote}</div>}
                <div className="mt-1 whitespace-pre-wrap">{c.body}</div>
                {(c.replies ?? []).map((r) => <div key={r.id} className="mt-1.5 border-l-2 pl-2"><span className="font-medium">{r.authorName}</span> <span className="text-muted-foreground">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span><div className="whitespace-pre-wrap">{r.body}</div></div>)}
                {replyFor === c.id ? (
                  <div className="mt-1.5 flex gap-1"><Input autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" className="h-7 text-xs" onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) { void onUpdateComment(c.id, { reply: reply.trim() }); setReply(""); setReplyFor(null); } if (e.key === "Escape") setReplyFor(null); }} /><Button size="xs" onClick={() => { if (reply.trim()) { void onUpdateComment(c.id, { reply: reply.trim() }); setReply(""); setReplyFor(null); } }}>Send</Button></div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setReplyFor(c.id)}><Reply className="size-3" /> Reply</Button>
                    <Button size="xs" variant="ghost" onClick={() => void onUpdateComment(c.id, { resolved: !c.resolved })}>{c.resolved ? <><Undo2 className="size-3" /> Reopen</> : <><Check className="size-3" /> Resolve</>}</Button>
                    <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => void onDeleteComment(c.id)} aria-label="Delete comment"><Trash2 className="size-3" /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChartsTab({ onEdit, onLocate }: { onEdit: (id: string) => void; onLocate: (t: string) => void }) {
  const wb = useSheetStore((s) => s.workbook);
  const computed = useSheetStore((s) => s.computed);
  const store = useSheetStore;
  const sheet = wb.sheets[wb.activeSheet];
  if (!sheet.charts.length) return <EmptyState icon={BarChart3} title="No charts on this sheet" description="Select a table and use the chart buttons in the toolbar, or ask the assistant to chart a range." className="m-2 border-dashed" />;
  return (
    <div className="h-full overflow-auto p-2 scrollbar-thin">
      <ul className="space-y-2">
        {sheet.charts.map((ch) => (
          <li key={ch.id} className="rounded-md border bg-card">
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5 text-xs">
              <Badge variant="muted" className="py-0 capitalize">{ch.type}</Badge>
              <span className="truncate font-medium">{ch.title}</span>
              <button onClick={() => onLocate(`${sheet.name}!${ch.range}`)} className="ml-auto font-mono text-[10px] text-primary hover:underline cursor-pointer">{ch.range}</button>
              <button onClick={() => onEdit(ch.id)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Edit chart"><Pencil className="size-3" /></button>
              <button onClick={() => store.getState().apply({ type: "remove_chart", sheet: sheet.id, id: ch.id })} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer" aria-label="Delete chart"><Trash2 className="size-3" /></button>
            </div>
            <div className="h-40 p-1"><ChartView chart={ch} data={chartData(ch, sheet, computed, wb)} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PageSetupTab() {
  const wb = useSheetStore((s) => s.workbook);
  const store = useSheetStore;
  const ps: PageSetup = { ...DEFAULT_PAGE_SETUP, ...(wb.pageSetup ?? {}) };
  const set = (patch: Partial<PageSetup>) => store.getState().apply({ type: "set_page_setup", patch });
  const margin = (k: keyof PageSetup["margins"], v: string) => set({ margins: { ...ps.margins, [k]: Number(v) || 0 } });
  const cls = "h-8 w-full rounded-md border bg-background px-2 text-xs";
  return (
    <div className="h-full overflow-auto p-3 text-xs scrollbar-thin">
      <div className="grid gap-3">
        <div className="space-y-1"><Label>Orientation</Label><div className="grid grid-cols-2 gap-1">{(["portrait", "landscape"] as const).map((o) => <button key={o} onClick={() => set({ orientation: o })} className={cn("h-8 rounded-md border capitalize cursor-pointer", ps.orientation === o ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>{o}</button>)}</div></div>
        <div className="space-y-1"><Label>Paper</Label><select value={ps.paper} onChange={(e) => set({ paper: e.target.value as PageSetup["paper"] })} className={cls}>{Object.entries(PAPER_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div className="space-y-1"><Label>Margins (inches)</Label><div className="grid grid-cols-4 gap-1">{(["top", "right", "bottom", "left"] as const).map((k) => <div key={k}><div className="mb-0.5 text-[10px] capitalize text-muted-foreground">{k}</div><Input type="number" step="0.1" min="0" value={ps.margins[k]} onChange={(e) => margin(k, e.target.value)} className="h-7 text-xs" /></div>)}</div></div>
        <div className="space-y-1"><Label>Print area</Label><Input value={ps.printArea ?? ""} onChange={(e) => set({ printArea: e.target.value || undefined })} placeholder="Used range (e.g. A1:K40)" className="h-8 font-mono text-xs" /><div className="text-[10px] text-muted-foreground">Leave blank to print the used range of the active sheet.</div></div>
        <div className="space-y-1"><Label>Header</Label><Input value={ps.header ?? ""} onChange={(e) => set({ header: e.target.value })} className="h-8 text-xs" placeholder="&[Title]" /></div>
        <div className="space-y-1"><Label>Footer</Label><Input value={ps.footer ?? ""} onChange={(e) => set({ footer: e.target.value })} className="h-8 text-xs" placeholder="Page &[Page] of &[Pages]" /><div className="text-[10px] text-muted-foreground">Tokens: &amp;[Title], &amp;[Sheet], &amp;[Page], &amp;[Pages], &amp;[Date]</div></div>
        <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={Boolean(ps.fitToPage)} onCheckedChange={(c) => set({ fitToPage: Boolean(c) })} /> Fit all columns to one page width</label>
        <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={Boolean(ps.gridlines)} onCheckedChange={(c) => set({ gridlines: Boolean(c) })} /> Print gridlines</label>
        <div className="space-y-1"><Label>Repeat header rows</Label><Input type="number" min="0" max="5" value={ps.repeatHeaderRows ?? 1} onChange={(e) => set({ repeatHeaderRows: Number(e.target.value) || 0 })} className="h-8 w-24 text-xs" /></div>
        <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">Toggle <span className="font-medium text-foreground">Page breaks</span> in the toolbar to preview page boundaries on the grid. Use Download → PDF (print) to print with these settings.</div>
      </div>
    </div>
  );
}
