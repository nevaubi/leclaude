"use client";
import * as React from "react";
import { Tags, BookOpenText, ShieldAlert, PackageCheck, Plus, Pencil, Trash2, Save, Loader2, Download, FileText, Sparkles, RefreshCw, Eye, Check, ChevronDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSSE } from "@/lib/ai/sse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ai/markdown";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import type { IssueCode } from "@/lib/types/domain";
import { ISSUE_COLORS, type IssueCodeInput, type PrivilegeLogRow } from "../types";
import { useReview } from "./review-page";
import { ApiError, api, usePrivilegeLog, useProduction, useRules } from "./use-review-data";
import { IssueChip, NoKeyCallout, SectionLabel, TypeIcon, formatShortDate, issueColorClasses } from "./shared";

type Section = "codes" | "rules" | "privilege" | "production";
const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "codes", label: "Issue codes", icon: Tags },
  { id: "rules", label: "Coding rules", icon: BookOpenText },
  { id: "privilege", label: "Privilege log", icon: ShieldAlert },
  { id: "production", label: "Production", icon: PackageCheck },
];

export function CodesTab() {
  const [section, setSection] = React.useState<Section>("codes");
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[200px] shrink-0 border-r bg-sidebar/40 md:block">
        <SectionLabel>Codes & privilege</SectionLabel>
        <nav className="px-1.5">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors cursor-pointer", section === s.id ? "bg-accent font-medium text-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent")} aria-current={section === s.id ? "page" : undefined}>
              <s.icon className={cn("size-3.5", section === s.id ? "text-primary" : "text-muted-foreground")} />{s.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b px-2 md:hidden">{SECTIONS.map((s) => <button key={s.id} onClick={() => setSection(s.id)} className={cn("h-9 px-2.5 text-xs font-medium cursor-pointer", section === s.id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground")}>{s.label}</button>)}</div>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {section === "codes" && <IssueCodesSection />}
          {section === "rules" && <RulesSection />}
          {section === "privilege" && <PrivilegeLogSection />}
          {section === "production" && <ProductionSection />}
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
  const roots = issueCodes.filter((c) => !c.parentId);
  const childrenOf = (id: string) => issueCodes.filter((c) => c.parentId === id);
  const total = issueCodes.reduce((n, c) => n + (c.count ?? 0), 0);
  const max = Math.max(1, ...issueCodes.map((c) => c.count ?? 0));

  const remove = async (c: IssueCode) => {
    if (!window.confirm(`Delete ${c.code} — ${c.label}? It will be removed from ${c.count ?? 0} document${c.count === 1 ? "" : "s"}; child codes move up a level.`)) return;
    try { await api(`/api/ediscovery/issue-codes/${c.id}`, { method: "DELETE" }); refreshIssueCodes(); toast.success(`Deleted ${c.code}`); } catch (e) { toast.error("Delete failed", { description: (e as Error).message }); }
  };

  const Row = ({ c, depth }: { c: IssueCode; depth: number }) => {
    const cls = issueColorClasses(c.color);
    return (
      <li className="group flex items-center gap-3 border-b px-4 py-2 text-sm hover:bg-accent/30" style={{ paddingLeft: 16 + depth * 22 }}>
        <span className={cn("size-2.5 shrink-0 rounded-full", cls.dot)} />
        <span className="w-20 shrink-0 font-mono text-[12px] font-semibold">{c.code}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{c.label}</span>
          {c.description && <span className="block truncate text-xs text-muted-foreground">{c.description}</span>}
        </span>
        <span className="hidden w-40 items-center gap-2 sm:flex"><span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn("absolute inset-y-0 left-0 rounded-full", cls.dot)} style={{ width: `${((c.count ?? 0) / max) * 100}%` }} /></span><span className="w-8 text-right tabular text-xs text-muted-foreground">{c.count ?? 0}</span></span>
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
          <h2 className="text-base font-semibold">Issue codes</h2>
          <p className="text-xs text-muted-foreground">{issueCodes.length} codes · {total.toLocaleString()} applications. Codes drive facets, the AI rubric and the production load file.</p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> New code</Button>
      </div>
      {!issueCodes.length ? (
        <EmptyState icon={Tags} title="No issue codes yet" description="Create codes such as TOX-01 Toxicology knowledge to tag documents and steer batch prediction." action={<Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> New code</Button>} />
      ) : (
        <ul className="rounded-md border bg-card">
          {roots.map((r) => (<React.Fragment key={r.id}><Row c={r} depth={0} />{childrenOf(r.id).map((ch) => <Row key={ch.id} c={ch} depth={1} />)}</React.Fragment>))}
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
            <div><Label htmlFor="ic-code" className="text-xs">Code</Label><Input id="ic-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="TOX-01" className="mt-1 font-mono uppercase" /></div>
            <div><Label htmlFor="ic-label" className="text-xs">Label</Label><Input id="ic-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Toxicology knowledge" className="mt-1" /></div>
          </div>
          <div><Label htmlFor="ic-desc" className="text-xs">Definition (used in the AI rubric)</Label><Textarea id="ic-desc" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 min-h-[72px] text-sm" placeholder="What a reviewer should look for before applying this code." /></div>
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
    try { await api("/api/ediscovery/rules", { method: "PUT", json: { matterId, rules: text } }); rules.mutate(() => ({ rules: text })); toast.success("Coding rules saved", { description: "The batch predictor and document analysis use this text as their rubric." }); }
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
        <div><h2 className="text-base font-semibold">Coding rules & definitions</h2><p className="text-xs text-muted-foreground">Markdown. Shown to reviewers here and used verbatim as the protocol in AI analysis and batch prediction.</p></div>
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
// Privilege log
// ---------------------------------------------------------------------------

function PrivilegeLogSection() {
  const { matterId, matter, aiConfigured, openDocument } = useReview();
  const log = usePrivilegeLog(matterId);
  const [gen, setGen] = React.useState<{ running: boolean; done: number; total: number; ai?: boolean }>({ running: false, done: 0, total: 0 });
  const [noKey, setNoKey] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const entries = log.data?.entries ?? [];
  const missing = log.data?.missing ?? [];
  const finalCount = entries.filter((e) => e.status === "final").length;

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
      toast.success(`Privilege log ${regenerate ? "regenerated" : "updated"}`, { description: `${summary.created ?? 0} entr${summary.created === 1 ? "y" : "ies"} written${summary.removed ? `, ${summary.removed} stale removed` : ""} · ${summary.ai ? "AI descriptions" : "template descriptions"}` });
    } catch (e) { toast.error("Generation failed", { description: (e as Error).message }); }
    finally { setGen((g) => ({ ...g, running: false })); }
  };

  const patch = async (id: string, p: Partial<Pick<PrivilegeLogRow, "description" | "status" | "basis">>) => {
    try {
      await api("/api/ediscovery/privilege-log", { method: "PATCH", json: { id, patch: p } });
      log.mutate((cur) => (cur ? { ...cur, entries: cur.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) } : cur));
    } catch (e) { toast.error("Update failed", { description: (e as Error).message }); }
  };
  const remove = async (id: string) => {
    try { await api(`/api/ediscovery/privilege-log?id=${encodeURIComponent(id)}`, { method: "DELETE" }); log.mutate((cur) => (cur ? { ...cur, entries: cur.entries.filter((e) => e.id !== id) } : cur)); log.refresh(); }
    catch (e) { toast.error("Delete failed", { description: (e as Error).message }); }
  };

  const exportWord = async () => {
    setExporting(true);
    try {
      const md = await api<{ title: string; markdown: string; count: number }>(`/api/ediscovery/privilege-log/export?matter=${encodeURIComponent(matterId)}&format=markdown`);
      const content = markdownToDoc(md.markdown);
      const r = await api<{ doc: { id: string; title: string } }>("/api/office/docs", { method: "POST", json: { kind: "word", title: md.title, content, matterId, tags: ["privilege-log", "ediscovery"], meta: { source: "ediscovery.privilege-log", entries: md.count } } });
      toast.success("Privilege log exported to Word", { description: `${md.count} entries · filed in the ${matter?.shortName ?? "matter"} folder`, action: { label: "Open", onClick: () => window.open(`/office/word/${r.doc.id}`, "_blank") } });
    } catch (e) { if (e instanceof ApiError && e.status === 404) toast.error("Office documents API unavailable"); else toast.error("Export failed", { description: (e as Error).message }); }
    finally { setExporting(false); }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Privilege log</h2>
          <p className="text-xs text-muted-foreground">{entries.length} entries · {finalCount} final · {missing.length} privileged document{missing.length === 1 ? "" : "s"} without an entry. Rule 26(b)(5)(A) descriptions never reveal the substance of the advice.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" disabled={gen.running}>{gen.running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate <ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>{aiConfigured ? "AI-drafted descriptions (generateText)" : "Template descriptions (no OpenAI key)"}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => generate(false, true)}><Plus className="size-4" /> Add entries for {missing.length} missing document{missing.length === 1 ? "" : "s"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => generate(true, true)}><RefreshCw className="size-4" /> Regenerate all draft & final entries</DropdownMenuItem>
              {aiConfigured && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => generate(false, false)}><FileText className="size-4" /> Add missing using templates only</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" asChild><a href={`/api/ediscovery/privilege-log/export?matter=${encodeURIComponent(matterId)}&format=csv`} download><Download className="size-4" /> CSV</a></Button>
          <Tip label="markdownToDoc → POST /api/office/docs; opens in the Word editor and is filed in the matter folder"><Button size="sm" variant="outline" onClick={exportWord} disabled={exporting || !entries.length}>{exporting ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Word</Button></Tip>
        </div>
      </div>
      {noKey && <div className="mb-3"><NoKeyCallout feature="AI-drafted privilege-log descriptions" compact /></div>}
      {gen.running && gen.total > 0 && <div className="mb-3 text-xs text-muted-foreground">Drafting {gen.done} / {gen.total}…</div>}
      {log.loading && !log.data ? <Skeleton className="h-64 w-full" /> : !entries.length ? (
        <EmptyState icon={ShieldAlert} title="No privilege log entries" description={missing.length ? `${missing.length} documents are coded privileged. Generate entries to start the log.` : "Code documents as privileged in the Review tab; they will appear here."} action={missing.length ? <Button size="sm" onClick={() => generate(false, true)}><Sparkles className="size-4" /> Generate {missing.length} entries</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>{["#", "Bates", "Date", "Type", "Author", "Recipients", "Basis", "Description", "Status", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} className="border-t align-top hover:bg-accent/30">
                  <td className="px-3 py-2 tabular text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap"><button onClick={() => openDocument(e.docId)} className="hover:text-primary hover:underline cursor-pointer" title={e.subject}>{e.bates}</button></td>
                  <td className="px-3 py-2 tabular whitespace-nowrap">{formatShortDate(e.date)}</td>
                  <td className="px-3 py-2"><span className="flex items-center gap-1"><TypeIcon type={e.docType} />{e.docType}</span></td>
                  <td className="px-3 py-2">{e.author}</td>
                  <td className="max-w-[150px] px-3 py-2 text-muted-foreground">{e.recipients.join("; ") || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Select value={e.basis} onValueChange={(v) => patch(e.id, { basis: v })}>
                      <SelectTrigger size="sm" className="h-7 w-[132px] text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{["Attorney-client", "Work product", "Attorney-client; Work product", "Common interest", "Joint defense"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="min-w-[260px] px-3 py-2">
                    {editingId === e.id ? (
                      <div>
                        <Textarea value={editText} onChange={(ev) => setEditText(ev.target.value)} className="min-h-[70px] text-xs" autoFocus />
                        <div className="mt-1 flex gap-1"><Button size="xs" onClick={() => { void patch(e.id, { description: editText }); setEditingId(null); }}>Save</Button><Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button></div>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingId(e.id); setEditText(e.description); }} className="w-full text-left leading-relaxed hover:text-primary cursor-text" title="Click to edit">{e.description}</button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => patch(e.id, { status: e.status === "final" ? "draft" : "final" })} className="cursor-pointer" title="Toggle draft / final"><Badge variant={e.status === "final" ? "success" : "warning"}>{e.status}</Badge></button>
                  </td>
                  <td className="px-2 py-2"><Tip label="Remove entry"><Button variant="ghost" size="icon-xs" onClick={() => remove(e.id)} aria-label="Remove"><Trash2 className="size-3.5" /></Button></Tip></td>
                </tr>
              ))}
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

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

function ProductionSection() {
  const { matterId, matter } = useReview();
  const prod = useProduction(matterId);
  const p = prod.data;
  const maxC = Math.max(1, ...(p?.byCustodian.map((c) => c.count) ?? [1]));
  const maxT = Math.max(1, ...(p?.byType.map((c) => c.count) ?? [1]));
  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Production export</h2>
          <p className="text-xs text-muted-foreground">Responsive, non-privileged, de-duplicated documents. The load file is a DAT-style CSV with family ranges, custodian, dates, confidentiality and hash.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" asChild><a href={`/api/ediscovery/production?matter=${encodeURIComponent(matterId)}&format=csv`} download><Download className="size-4" /> Load file (CSV)</a></Button>
          <Button size="sm" variant="outline" asChild><a href={`/api/ediscovery/privilege-log/export?matter=${encodeURIComponent(matterId)}&format=csv`} download><ShieldAlert className="size-4" /> Privilege log (CSV)</a></Button>
        </div>
      </div>
      {!p ? <Skeleton className="h-64 w-full" /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Responsive", p.responsive, "coded responsive"], ["Withheld", p.privilegedWithheld, "privileged, on the log"], ["Produced", p.produced, "in the load file"], ["Bates ranges", p.batesRanges.length, "contiguous runs"]] as [string, number, string][]).map(([k, v, h]) => (
              <div key={k} className="rounded-md border bg-card p-3"><div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{k}</div><div className="mt-1 tabular text-xl font-semibold">{v.toLocaleString()}</div><div className="text-[11px] text-muted-foreground">{h}</div></div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-md border bg-card">
              <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bates range summary</div>
              <table className="w-full text-xs">
                <thead className="text-[11px] text-muted-foreground"><tr><th className="px-3 py-1.5 text-left font-medium">Begin</th><th className="px-3 py-1.5 text-left font-medium">End</th><th className="px-3 py-1.5 text-right font-medium">Docs</th></tr></thead>
                <tbody>{p.batesRanges.map((r) => <tr key={r.start} className="border-t"><td className="px-3 py-1.5 font-mono">{r.start}</td><td className="px-3 py-1.5 font-mono">{r.end}</td><td className="px-3 py-1.5 text-right tabular">{r.count}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="space-y-5">
              <div className="rounded-md border bg-card p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">By custodian</div>
                {p.byCustodian.map((c) => <div key={c.custodian} className="mb-1.5 flex items-center gap-2 text-xs"><span className="w-32 truncate">{c.custodian}</span><span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 rounded-full bg-chart-1" style={{ width: `${(c.count / maxC) * 100}%` }} /></span><span className="w-8 text-right tabular text-muted-foreground">{c.count}</span></div>)}
              </div>
              <div className="rounded-md border bg-card p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">By document type</div>
                {p.byType.map((c) => <div key={c.type} className="mb-1.5 flex items-center gap-2 text-xs"><span className="w-32 truncate">{c.type}</span><span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 rounded-full bg-chart-2" style={{ width: `${(c.count / maxT) * 100}%` }} /></span><span className="w-8 text-right tabular text-muted-foreground">{c.count}</span></div>)}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Production for {matter?.name}. Exact duplicates are suppressed; near-duplicates and family members are produced with their families. <a href="/library" className="inline-flex items-center gap-0.5 text-primary hover:underline">Matter folder <ExternalLink className="size-3" /></a></p>
        </div>
      )}
    </div>
  );
}
