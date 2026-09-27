"use client";
import * as React from "react";
import { Tags, BookOpenText, ShieldAlert, Plus, Pencil, Trash2, Save, Loader2, Download, FileText, RefreshCw, Eye, Check, ChevronDown, ShieldQuestion, ListChecks, FileSpreadsheet, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSSE } from "@/lib/ai/sse";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, CountChip } from "@/components/ui/misc";
import { SegmentedControl } from "@/components/ui/form";
import { Tip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ai/markdown";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import type { IssueCode } from "@/lib/types/domain";
import { ISSUE_COLORS, type IssueCodeInput, type PrivilegeLogRow } from "../types";
import { PRIVILEGE_STATUSES, fillTemplate, nextPrivilegeStatuses, templatesForBasis, type PrivilegeStatus } from "../privilege-templates";
import { useReview } from "./review-page";
import { ApiError, api, downloadFile, usePrivilegeLog, useRules } from "./use-review-data";
import { IssueChip, NoKeyCallout, SectionLabel, StateChip, TypeIcon, formatShortDate, issueColorClasses } from "./shared";
import { ReviewQueueSection } from "./review-queue-section";

export type CodesSection = "codes" | "rules" | "privilege" | "review";
type Section = CodesSection;
const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "review", label: "Needs review", icon: ShieldQuestion },
  { id: "codes", label: "Issue codes", icon: Tags },
  { id: "rules", label: "Coding rules", icon: BookOpenText },
  { id: "privilege", label: "Privilege log", icon: ShieldAlert },
];

export function CodesTab({ initialSection }: { initialSection?: CodesSection } = {}) {
  const { matterId, reviewQueuePending, setReviewQueuePending } = useReview();
  const [section, setSection] = React.useState<Section>(initialSection ?? "codes");
  const onQueueChanged = React.useCallback((n: number) => setReviewQueuePending(n), [setReviewQueuePending]);
  const count = (id: Section) => (id === "review" && reviewQueuePending ? <CountChip tone="warning" className="ml-auto">{reviewQueuePending}</CountChip> : null);
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[200px] shrink-0 border-r bg-sidebar/40 md:block">
        <SectionLabel>Codes & privilege</SectionLabel>
        <nav className="px-1.5" aria-label="Codes and privilege sections">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)} className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors cursor-pointer", section === s.id ? "bg-accent font-medium text-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent")} aria-current={section === s.id ? "page" : undefined}>
              <s.icon className={cn("size-3.5", section === s.id ? "text-primary" : "text-muted-foreground")} />{s.label}{count(s.id)}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 no-scrollbar md:hidden">{SECTIONS.map((s) => <button key={s.id} onClick={() => setSection(s.id)} className={cn("flex h-9 shrink-0 items-center gap-1 px-2.5 text-xs font-medium cursor-pointer", section === s.id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground")}>{s.label}{count(s.id)}</button>)}</div>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {section === "review" && <ReviewQueueSection matterId={matterId} onChanged={onQueueChanged} />}
          {section === "codes" && <IssueCodesSection />}
          {section === "rules" && <RulesSection />}
          {section === "privilege" && <PrivilegeLogSection />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue codes
// ---------------------------------------------------------------------------

function IssueCodesSection() {
  const { matterId, issueCodes, refreshIssueCodes } = useReview();
  const [editing, setEditing] = React.useState<IssueCode | "new" | null>(null);
  const [adding, setAdding] = React.useState(false);
  const addStandard = async () => {
    setAdding(true);
    try {
      const r = await api<{ created: IssueCode[]; skipped: string[] }>("/api/ediscovery/issue-codes", { method: "POST", json: { matterId, preset: "standard" } });
      refreshIssueCodes();
      toast.success(r.created.length ? `Added ${r.created.length} code${r.created.length === 1 ? "" : "s"}` : "The standard codes are already here");
    } catch (e) { toast.error("Could not add codes", { description: (e as Error).message }); }
    finally { setAdding(false); }
  };
  const roots = issueCodes.filter((c) => !c.parentId);
  const childrenOf = (id: string) => issueCodes.filter((c) => c.parentId === id);
  const total = issueCodes.reduce((n, c) => n + (c.count ?? 0), 0);
  const max = Math.max(1, ...issueCodes.map((c) => c.count ?? 0));

  const remove = async (c: IssueCode) => {
    if (!window.confirm(`Delete ${c.code} — ${c.label}? It will be removed from ${c.count ?? 0} document${c.count === 1 ? "" : "s"}; child codes move up a level.`)) return;
    try { await api(`/api/ediscovery/issue-codes/${c.id}`, { method: "DELETE" }); refreshIssueCodes(); toast.success(`Deleted ${c.code}`); } catch (e) { toast.error("Delete failed", { description: (e as Error).message }); }
  };

  const Row = ({ c, depth, index }: { c: IssueCode; depth: number; index: number }) => {
    const cls = issueColorClasses(c.color);
    return (
      <li className="group flex h-9 items-center gap-3 border-b px-4 text-[12.5px] hover:bg-accent/30" style={{ paddingLeft: 16 + depth * 22 }}>
        <span className={cn("size-1.5 shrink-0 rounded-full", cls.dot)} />
        <span className="w-20 shrink-0 font-mono text-[12px] font-medium">{c.code}</span>
        <span className="min-w-0 flex-1 truncate"><span className="font-medium">{c.label}</span>{c.description && <span className="ml-2 text-[11.5px] text-muted-foreground">{c.description}</span>}</span>
        {index < 9 && <kbd className="hidden px-1 text-[10px] sm:inline" title="Keyboard shortcut in the review grid">{index + 1}</kbd>}
        <span className="hidden w-40 items-center gap-2 sm:flex"><span className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/40" style={{ width: `${((c.count ?? 0) / max) * 100}%` }} /></span><span className="w-8 text-right tabular text-[11.5px] text-muted-foreground">{c.count ?? 0}</span></span>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tip label="Edit"><Button variant="ghost" size="icon-xs" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`}><Pencil className="size-3.5" /></Button></Tip>
          <Tip label="Delete"><Button variant="ghost" size="icon-xs" onClick={() => remove(c)} aria-label={`Delete ${c.code}`}><Trash2 className="size-3.5" /></Button></Tip>
        </span>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Issue codes</h2>
          <p className="text-[11.5px] text-muted-foreground">{issueCodes.length ? `${issueCodes.length} codes · ${total.toLocaleString()} applications. ` : ""}Codes drive facets, the suggestion rubric and the production load file; keys 1–9 apply the first nine in the grid.</p>
        </div>
        {!!issueCodes.length && <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus className="size-4" /> Add code</Button>}
      </div>
      {!issueCodes.length ? (
        <EmptyState icon={Tags} title="No issue codes yet" description="Add the codes reviewers will apply in this matter, or start from a small standard set (responsive, not responsive, hot, privileged, confidential) and edit it." action={<div className="flex items-center justify-center gap-2"><Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> Add code</Button><Button size="sm" variant="ghost" onClick={() => void addStandard()} disabled={adding}>{adding && <Loader2 className="size-4 animate-spin" />} Use standard set</Button></div>} />
      ) : (
        <ul className="border-t">
          {roots.map((r) => (<React.Fragment key={r.id}><Row c={r} depth={0} index={issueCodes.indexOf(r)} />{childrenOf(r.id).map((ch) => <Row key={ch.id} c={ch} depth={1} index={issueCodes.indexOf(ch)} />)}</React.Fragment>))}
        </ul>
      )}
      <IssueCodeDialog open={editing !== null} initial={editing === "new" ? null : editing} codes={issueCodes} matterId={matterId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refreshIssueCodes(); }} />
    </div>
  );
}

function IssueCodeDialog({ open, initial, codes, matterId, onClose, onSaved }: { open: boolean; initial: IssueCode | null; codes: IssueCode[]; matterId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState<IssueCodeInput>({ code: "", label: "", description: "", color: "chart-1", parentId: undefined });
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) setForm(initial ? { code: initial.code, label: initial.label, description: initial.description ?? "", color: initial.color ?? "chart-1", parentId: initial.parentId } : { code: "", label: "", description: "", color: "chart-1", parentId: undefined }); }, [open, initial]);
  const submit = async () => {
    if (!form.code.trim() || !form.label.trim()) { toast.error("Code and label are required"); return; }
    setSaving(true);
    try {
      if (initial) await api(`/api/ediscovery/issue-codes/${initial.id}`, { method: "PATCH", json: { ...form, parentId: form.parentId ?? "" } });
      else await api("/api/ediscovery/issue-codes", { method: "POST", json: { ...form, matterId } });
      toast.success(initial ? `Updated ${form.code.toUpperCase()}` : `Created ${form.code.toUpperCase()}`);
      onSaved();
    } catch (e) { toast.error("Could not save", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>{initial ? `Edit ${initial.code}` : "New issue code"}</DialogTitle><DialogDescription>Renaming a code updates every document that carries it.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <div><Label htmlFor="ic-code" className="text-xs">Code</Label><Input id="ic-code" size="sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="TOX-01" className="mt-1 font-mono uppercase" /></div>
            <div><Label htmlFor="ic-label" className="text-xs">Label</Label><Input id="ic-label" size="sm" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Toxicology knowledge" className="mt-1" /></div>
          </div>
          <div><Label htmlFor="ic-desc" className="text-xs">Definition (used in the suggestion rubric)</Label><Textarea id="ic-desc" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 min-h-[72px] text-sm" placeholder="What a reviewer should look for before applying this code." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Colour</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
                {ISSUE_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={form.color === c} onClick={() => setForm({ ...form, color: c })} className={cn("flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow cursor-pointer", issueColorClasses(c).dot, form.color === c && "ring-2 ring-ring")} aria-label={c}>{form.color === c && <Check className="size-3.5 text-background" />}</button>)}
              </div>
            </div>
            <div>
              <Label className="text-xs">Parent code</Label>
              <Select value={form.parentId ?? "none"} onValueChange={(v) => setForm({ ...form, parentId: v === "none" ? undefined : v })}>
                <SelectTrigger size="sm" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">None (top level)</SelectItem>{codes.filter((c) => c.id !== initial?.id && !c.parentId).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">Preview <IssueChip code={form.code || "CODE"} codes={[{ id: "preview", matterId, code: form.code || "CODE", label: form.label, color: form.color }]} /> {form.label}</div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {initial ? "Save" : "Create"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Coding rules
// ---------------------------------------------------------------------------

function RulesSection() {
  const { matterId } = useReview();
  const rules = useRules(matterId);
  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (rules.data) setText(rules.data.rules); }, [rules.data]);
  const dirty = rules.data ? text !== rules.data.rules : false;
  const save = async () => {
    setSaving(true);
    try { await api("/api/ediscovery/rules", { method: "PUT", json: { matterId, rules: text } }); rules.mutate(() => ({ rules: text })); toast.success("Coding rules saved", { description: "Batch prediction and suggested coding use this text as their rubric." }); }
    catch (e) { toast.error("Save failed", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && dirty) { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, text]);
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col p-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div><h2 className="text-[15px] font-semibold">Coding rules & definitions</h2><p className="text-[11.5px] text-muted-foreground">Markdown. Shown to reviewers here and used verbatim as the protocol in suggested coding and batch prediction.</p></div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={preview ? "secondary" : "outline"} onClick={() => setPreview(!preview)}><Eye className="size-4" /> {preview ? "Edit" : "Preview"}</Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
        </div>
      </div>
      {!rules.data ? <Skeleton className="h-96 w-full" /> : preview ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card p-5 scrollbar-thin"><Markdown>{text}</Markdown></div>
      ) : (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[480px] flex-1 resize-none font-mono text-[12.5px] leading-relaxed" spellCheck={false} aria-label="Coding rules" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privilege log: drafts from coding, templates, status workflow, xlsx / csv / Word export
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<PrivilegeStatus, "muted" | "info" | "success"> = { draft: "muted", review: "info", final: "success" };
const BASES = ["Attorney-client", "Work product", "Attorney-client; Work product", "Common interest", "Joint defense"];

function PrivilegeLogSection() {
  const { matterId, matter, aiConfigured, openDocument } = useReview();
  const log = usePrivilegeLog(matterId);
  const [gen, setGen] = React.useState<{ running: boolean; done: number; total: number; ai?: boolean }>({ running: false, done: 0, total: 0 });
  const [noKey, setNoKey] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<"all" | PrivilegeStatus>("all");
  const [selected, setSelected] = React.useState<string[]>([]);
  const entries = React.useMemo(() => log.data?.entries ?? [], [log.data]);
  const missing = log.data?.missing ?? [];
  const counts = { draft: entries.filter((e) => e.status === "draft").length, review: entries.filter((e) => e.status === "review").length, final: entries.filter((e) => e.status === "final").length };
  const visible = statusFilter === "all" ? entries : entries.filter((e) => e.status === statusFilter);
  const selectedSet = new Set(selected);

  const generate = async (regenerate: boolean, useAI: boolean) => {
    setGen({ running: true, done: 0, total: 0 });
    try {
      const res = await fetch("/api/ediscovery/privilege-log/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matterId, regenerate, useAI }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
      let summary: { created?: number; removed?: number; ai?: boolean } = {};
      await readSSE<{ type: string; done?: number; total?: number; ai?: boolean; created?: number; removed?: number; code?: string; message?: string }>(res, (ev) => {
        if (ev.type === "start") setGen((g) => ({ ...g, ai: ev.ai }));
        if (ev.type === "progress") setGen((g) => ({ ...g, done: ev.done ?? 0, total: ev.total ?? 0 }));
        if (ev.type === "done") summary = ev;
        if (ev.type === "error") { if (ev.code === "no_api_key") setNoKey(true); else throw new Error(ev.message); }
      });
      log.refresh();
      toast.success(`Privilege log ${regenerate ? "regenerated" : "updated"}`, { description: `${summary.created ?? 0} entr${summary.created === 1 ? "y" : "ies"} written${summary.removed ? `, ${summary.removed} stale removed` : ""} · ${summary.ai ? "drafted descriptions" : "template descriptions"}` });
    } catch (e) { toast.error("Drafting failed", { description: (e as Error).message }); }
    finally { setGen((g) => ({ ...g, running: false })); }
  };

  const patch = async (id: string, p: Partial<Pick<PrivilegeLogRow, "description" | "status" | "basis" | "templateId">>) => {
    try {
      await api("/api/ediscovery/privilege-log", { method: "PATCH", json: { id, patch: p } });
      log.mutate((cur) => (cur ? { ...cur, entries: cur.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) } : cur));
    } catch (e) { toast.error("Update failed", { description: (e as Error).message }); }
  };
  const bulkStatus = async (status: PrivilegeStatus) => {
    if (!selected.length) return;
    try {
      const r = await api<{ updated: number }>("/api/ediscovery/privilege-log", { method: "PATCH", json: { ids: selected, patch: { status } } });
      log.mutate((cur) => (cur ? { ...cur, entries: cur.entries.map((e) => (selectedSet.has(e.id) ? { ...e, status } : e)) } : cur));
      toast.success(`${r.updated} entr${r.updated === 1 ? "y" : "ies"} → ${PRIVILEGE_STATUSES.find((s) => s.id === status)?.label}`);
      setSelected([]);
    } catch (e) { toast.error("Update failed", { description: (e as Error).message }); }
  };
  const remove = async (id: string) => {
    try { await api(`/api/ediscovery/privilege-log?id=${encodeURIComponent(id)}`, { method: "DELETE" }); log.mutate((cur) => (cur ? { ...cur, entries: cur.entries.filter((e) => e.id !== id) } : cur)); log.refresh(); }
    catch (e) { toast.error("Delete failed", { description: (e as Error).message }); }
  };
  const applyTemplate = (e: PrivilegeLogRow, templateId: string) => {
    const t = templatesForBasis(e.basis).find((x) => x.id === templateId) ?? templatesForBasis(e.basis)[0];
    if (!t) return;
    const description = fillTemplate(t, { type: e.docType === "Email" ? "Email" : e.docType === "Memo" ? "Memorandum" : e.docType, author: e.author, recipients: e.recipients.join(", "), topic: "legal matters", date: e.date });
    void patch(e.id, { description, templateId: t.id });
  };
  const exportWord = async () => {
    setExporting("word");
    try {
      const md = await api<{ title: string; markdown: string; count: number }>(`/api/ediscovery/privilege-log/export?matter=${encodeURIComponent(matterId)}&format=markdown`);
      const content = markdownToDoc(md.markdown);
      const r = await api<{ doc: { id: string; title: string } }>("/api/office/docs", { method: "POST", json: { kind: "word", title: md.title, content, matterId, tags: ["privilege-log", "ediscovery"], meta: { source: "ediscovery.privilege-log", entries: md.count } } });
      toast.success("Privilege log exported to Word", { description: `${md.count} entries · filed in the ${matter?.shortName ?? "matter"} folder`, action: { label: "Open", onClick: () => window.open(`/office/word/${r.doc.id}`, "_blank") } });
    } catch (e) { if (e instanceof ApiError && e.status === 404) toast.error("Office documents API unavailable"); else toast.error("Export failed", { description: (e as Error).message }); }
    finally { setExporting(null); }
  };
  const exportFile = async (format: "xlsx" | "csv") => {
    setExporting(format);
    try { const name = await downloadFile(`/api/ediscovery/privilege-log/export?matter=${encodeURIComponent(matterId)}&format=${format}`, `privilege-log.${format}`); toast.success(`Downloaded ${name}`); }
    catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
    finally { setExporting(null); }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Privilege log</h2>
          <p className="text-[11.5px] text-muted-foreground">{entries.length} entries · {counts.draft} draft · {counts.review} in review · {counts.final} final · {missing.length} privileged document{missing.length === 1 ? "" : "s"} without an entry. Rule 26(b)(5)(A) descriptions never reveal the substance of the advice.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" disabled={gen.running}>{gen.running ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />} Draft entries <ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>{aiConfigured ? "Drafted descriptions (verified against the header)" : "Template descriptions (no AI provider)"}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => generate(false, true)}><Plus className="size-4" /> Draft entries for {missing.length} missing document{missing.length === 1 ? "" : "s"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => generate(true, true)}><RefreshCw className="size-4" /> Redraft every entry from the coding</DropdownMenuItem>
              {aiConfigured && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => generate(false, false)}><FileText className="size-4" /> Add missing using templates only</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={!!exporting || !entries.length}>{exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export <ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => void exportFile("xlsx")}><FileSpreadsheet className="size-4" /> Excel (.xlsx) with legend</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportFile("csv")}><FileText className="size-4" /> CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportWord()}><FileText className="size-4" /> Word (filed in the matter)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {noKey && <div className="mb-3"><NoKeyCallout feature="Drafted privilege-log descriptions" compact /></div>}
      {gen.running && gen.total > 0 && <div className="mb-3 text-xs text-muted-foreground">Drafting {gen.done} / {gen.total}…</div>}
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2">
        <SegmentedControl size="xs" value={statusFilter} onChange={setStatusFilter} ariaLabel="Status filter" options={[{ value: "all", label: `All ${entries.length}` }, { value: "draft", label: `Draft ${counts.draft}` }, { value: "review", label: `In review ${counts.review}` }, { value: "final", label: `Final ${counts.final}` }]} />
        {selected.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 text-[11.5px]">
            <span className="tabular text-muted-foreground">{selected.length} selected</span>
            <Button size="xs" variant="outline" className="h-6" onClick={() => void bulkStatus("review")}><Send className="size-3" /> Send to review</Button>
            <Button size="xs" variant="outline" className="h-6" onClick={() => void bulkStatus("final")}><Check className="size-3" /> Finalise</Button>
            <Button size="xs" variant="ghost" className="h-6" onClick={() => void bulkStatus("draft")}><Undo2 className="size-3" /> Back to draft</Button>
            <Button size="xs" variant="ghost" className="h-6" onClick={() => setSelected([])}>Clear</Button>
          </span>
        )}
      </div>
      {log.loading && !log.data ? <Skeleton className="h-64 w-full" /> : !entries.length ? (
        <EmptyState icon={ShieldAlert} title="No privilege log entries" description={missing.length ? `${missing.length} documents are coded privileged. Draft entries from the coding to start the log.` : "Code documents as privileged in the Review tab; they will appear here."} action={missing.length ? <Button size="sm" onClick={() => generate(false, true)}><ListChecks className="size-4" /> Draft {missing.length} entries</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[980px] text-[11.5px]">
            <thead className="grid-head bg-muted/40">
              <tr>
                <th className="w-8 px-2 py-1.5"><Checkbox size="xs" checked={visible.length > 0 && visible.every((e) => selectedSet.has(e.id)) ? true : visible.some((e) => selectedSet.has(e.id)) ? "indeterminate" : false} onCheckedChange={(v) => setSelected(v ? visible.map((e) => e.id) : [])} aria-label="Select all" /></th>
                {["#", "Bates", "Date", "Type", "Author", "Recipients", "Basis", "Description", "Status", ""].map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => (
                <tr key={e.id} className={cn("border-t align-top hover:bg-accent/30", selectedSet.has(e.id) && "bg-primary/5")}>
                  <td className="px-2 py-1.5"><Checkbox size="xs" checked={selectedSet.has(e.id)} onCheckedChange={(v) => setSelected(v ? [...selected, e.id] : selected.filter((x) => x !== e.id))} aria-label={`Select ${e.bates}`} /></td>
                  <td className="px-2 py-1.5 tabular text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap"><button onClick={() => openDocument(e.docId)} className="hover:text-primary hover:underline cursor-pointer" title={e.subject}>{e.bates}</button></td>
                  <td className="px-2 py-1.5 tabular whitespace-nowrap">{formatShortDate(e.date)}</td>
                  <td className="px-2 py-1.5"><span className="flex items-center gap-1"><TypeIcon type={e.docType} />{e.docType}</span></td>
                  <td className="px-2 py-1.5">{e.author}</td>
                  <td className="max-w-[150px] px-2 py-1.5 text-muted-foreground">{e.recipients.join("; ") || "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Select value={e.basis} onValueChange={(v) => patch(e.id, { basis: v })} disabled={e.status === "final"}>
                      <SelectTrigger size="xs" className="w-[132px] text-[11px]" aria-label="Basis"><SelectValue /></SelectTrigger>
                      <SelectContent>{BASES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="min-w-[280px] px-2 py-1.5">
                    {editingId === e.id ? (
                      <div>
                        <Textarea value={editText} onChange={(ev) => setEditText(ev.target.value)} className="min-h-[70px] text-xs" autoFocus />
                        <div className="mt-1 flex gap-1"><Button size="xs" onClick={() => { void patch(e.id, { description: editText, templateId: undefined }); setEditingId(null); }}>Save</Button><Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button></div>
                      </div>
                    ) : (
                      <div className="group/desc">
                        <button onClick={() => { if (e.status !== "final") { setEditingId(e.id); setEditText(e.description); } }} className={cn("w-full text-left leading-relaxed", e.status !== "final" && "hover:text-primary cursor-text")} title={e.status === "final" ? "Final entries are locked; move back to review to edit" : "Click to edit"}>{e.description}</button>
                        {e.status !== "final" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><button type="button" className="mt-0.5 text-[10.5px] text-muted-foreground opacity-0 hover:text-foreground group-hover/desc:opacity-100 focus-visible:opacity-100 cursor-pointer">{e.templateId ? `template · ${e.templateId}` : "apply a template…"}</button></DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-80">
                              <DropdownMenuLabel>Description templates · {e.basis}</DropdownMenuLabel>
                              {templatesForBasis(e.basis).map((t) => <DropdownMenuItem key={t.id} onClick={() => applyTemplate(e, t.id)}><span className="min-w-0 flex-1 truncate">{t.label}</span>{e.templateId === t.id && <Check className="size-3.5" />}</DropdownMenuItem>)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button type="button" className="cursor-pointer" title="Change status"><StateChip tone={STATUS_TONE[e.status]}>{PRIVILEGE_STATUSES.find((s) => s.id === e.status)?.label}</StateChip></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {nextPrivilegeStatuses(e.status).map((s) => <DropdownMenuItem key={s} onClick={() => void patch(e.id, { status: s })}>{PRIVILEGE_STATUSES.find((x) => x.id === s)?.label}<span className="ml-2 text-[10.5px] text-muted-foreground">{PRIVILEGE_STATUSES.find((x) => x.id === s)?.hint}</span></DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                  <td className="px-1 py-1.5"><Tip label="Remove entry"><Button variant="ghost" size="icon-xs" onClick={() => remove(e.id)} aria-label="Remove" disabled={e.status === "final"}><Trash2 className="size-3.5" /></Button></Tip></td>
                </tr>
              ))}
              {!visible.length && <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">No entries in this status.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {missing.length > 0 && entries.length > 0 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <span className="font-medium">{missing.length} privileged document{missing.length === 1 ? "" : "s"} not yet logged:</span>{" "}
          {missing.slice(0, 6).map((m) => <button key={m.id} onClick={() => openDocument(m.id)} className="mr-2 font-mono hover:underline cursor-pointer">{m.bates}</button>)}{missing.length > 6 && `+${missing.length - 6} more`}
        </div>
      )}
    </div>
  );
}
