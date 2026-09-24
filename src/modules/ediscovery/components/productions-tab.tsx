"use client";
import * as React from "react";
import { PackageCheck, Plus, RefreshCw, Loader2, Download, ShieldCheck, Trash2, FileText, AlertTriangle, ArrowRight, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { KeyValueList } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import type { ProductionQcReport, ProductionSet } from "@/lib/types/domain";
import type { ProductionSummary2 } from "../types";
import { PRODUCTION_STATUSES } from "../production-pure";
import { useReview } from "./review-page";
import { api, downloadFile, useProductionDetail, useProductions, type ProductionRow } from "./use-review-data";
import { ProductionDialog } from "./production-dialog";
import { DecisionCell, StateChip, TypeIcon, formatDateTime, formatShortDate } from "./shared";

const STATUS_TONE: Record<ProductionSet["status"], "muted" | "info" | "success"> = { draft: "muted", qc: "info", final: "success" };
const statusLabel = (s: ProductionSet["status"]) => PRODUCTION_STATUSES.find((x) => x.id === s)?.label ?? s;

/**
 * Productions: frozen document sets with production Bates numbers, a QC report
 * (privileged in set, missing family members, unredacted PII, uncoded) that gates
 * draft → QC → final, load files (DAT/OPT) and the volume zip.
 */
export function ProductionsTab({ initialProductionId }: { initialProductionId?: string }) {
  const { matterId } = useReview();
  const productions = useProductions(matterId);
  const [active, setActive] = React.useState<string | null>(initialProductionId ?? null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const rows = React.useMemo(() => productions.data?.productions ?? [], [productions.data]);
  React.useEffect(() => { if (!active && rows.length) setActive(rows[0].id); }, [rows, active]);
  const columns = React.useMemo<DataTableColumn<ProductionSummary2>[]>(() => [
    { id: "name", header: "Production", width: 240, minWidth: 140, sortable: true, accessor: (p) => p.name, locked: true, render: (p) => <span className="truncate font-medium">{p.name}</span> },
    { id: "volume", header: "Volume", width: 80, accessor: (p) => p.volume, render: (p) => <span className="font-mono text-[11.5px]">{p.volume}</span> },
    { id: "status", header: "Status", width: 80, sortable: true, accessor: (p) => p.status, render: (p) => <StateChip tone={STATUS_TONE[p.status]}>{statusLabel(p.status)}</StateChip> },
    { id: "docs", header: "Docs", width: 64, align: "right", sortable: true, accessor: (p) => p.docCount },
    { id: "pages", header: "Pages", width: 64, align: "right", sortable: true, accessor: (p) => p.pageCount },
    { id: "bates", header: "Bates range", width: 240, accessor: (p) => p.batesRange?.begin ?? "", render: (p) => p.batesRange ? <span className="font-mono text-[11.5px] tabular">{p.batesRange.begin} – {p.batesRange.end}</span> : <span className="text-muted-foreground">—</span> },
    { id: "qc", header: "QC", width: 110, accessor: (p) => p.qc?.ok, render: (p) => !p.qc ? <span className="text-muted-foreground">not run</span> : p.qc.ok ? <span className="text-success">clean</span> : <span className="text-warning-foreground dark:text-warning tabular">{p.qc.privilegedInSet.length + p.qc.missingFamily.length + p.qc.unredactedPii.length + p.qc.uncoded.length} findings</span> },
    { id: "redacted", header: "Redacted", width: 80, align: "right", accessor: (p) => p.redactedDocs, defaultHidden: true },
    { id: "created", header: "Created", width: 150, sortable: true, accessor: (p) => p.createdAt, render: (p) => <span className="tabular text-muted-foreground">{formatDateTime(p.createdAt)}{p.createdByName ? ` · ${p.createdByName}` : ""}</span> },
  ], []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <PackageCheck className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold">Productions</span>
        <span className="tabular text-[11.5px] text-muted-foreground">{rows.length}</span>
        <div className="flex-1" />
        <Button size="xs" variant="ghost" onClick={productions.refresh} aria-label="Refresh"><RefreshCw className="size-3.5" /></Button>
        <Button size="xs" onClick={() => setCreateOpen(true)}><Plus className="size-3.5" /> New production</Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={cn("shrink-0 border-b", active ? "h-[200px]" : "flex-1")}>
          <DataTable<ProductionSummary2>
            rows={rows}
            columns={columns}
            rowId={(p) => p.id}
            selectionMode="single"
            activeId={active}
            onActiveChange={setActive}
            defaultSort={{ columnId: "created", dir: "desc" }}
            noun="production"
            summary={false}
            columnChooser={false}
            loading={productions.loading && !productions.data}
            error={productions.error?.message ?? null}
            empty={<div className="p-8"><EmptyState icon={PackageCheck} title="No productions" description="A production freezes the responsive, non-privileged set, assigns production Bates numbers and builds the load files." action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New production</Button>} /></div>}
            ariaLabel="Productions"
          />
        </div>
        {active && <ProductionDetail id={active} onChanged={productions.refresh} onDeleted={() => { setActive(null); productions.refresh(); }} />}
      </div>
      <ProductionDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(p) => { productions.refresh(); setActive(p.id); }} />
    </div>
  );
}

function ProductionDetail({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const { openDocument } = useReview();
  const detail = useProductionDetail(id);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [stamp, setStamp] = React.useState<string | null>(null);
  const p = detail.data?.production;
  const rows = React.useMemo(() => detail.data?.rows ?? [], [detail.data]);
  React.useEffect(() => setSelected([]), [id]);
  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); detail.refresh(); onChanged(); }
    catch (e) { toast.error(`${label} failed`, { description: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const patch = (body: Record<string, unknown>) => api(`/api/ediscovery/productions/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
  const runQc = () => act("QC", async () => { await api(`/api/ediscovery/productions/${encodeURIComponent(id)}/qc`, { method: "POST" }); toast.success("QC report updated"); });
  const setStatus = (status: ProductionSet["status"]) => act(`Move to ${statusLabel(status)}`, async () => { await patch({ status }); toast.success(`Production is now ${statusLabel(status)}`); });
  const removeSelected = () => act("Remove", async () => { await patch({ remove: selected }); setSelected([]); toast.success(`${selected.length} removed and renumbered`); });
  const remove = () => { if (!p || !window.confirm(`Delete ${p.name}? Production Bates numbers assigned here are discarded.`)) return; void act("Delete", async () => { await api(`/api/ediscovery/productions/${encodeURIComponent(id)}`, { method: "DELETE" }); onDeleted(); }); };
  const download = (format: "dat" | "opt" | "zip") => act(`Export ${format.toUpperCase()}`, async () => { const name = await downloadFile(`/api/ediscovery/productions/${encodeURIComponent(id)}/export?format=${format}`, `${p?.volume ?? "production"}.${format}`); toast.success(`Downloaded ${name}`); });
  const columns = React.useMemo<DataTableColumn<ProductionRow>[]>(() => [
    { id: "begin", header: "Prod. Bates", width: 140, sortable: true, accessor: (r) => r.begin, locked: true, render: (r) => <span className="font-mono text-[11.5px] tabular">{r.begin}{r.pages > 1 && <span className="text-muted-foreground"> – {r.end.slice(-4)}</span>}</span> },
    { id: "orig", header: "Original Bates", width: 120, sortable: true, accessor: (r) => r.bates, render: (r) => <button type="button" onClick={() => openDocument(r.docId)} className="font-mono text-[11.5px] tabular text-primary hover:underline cursor-pointer">{r.bates}</button> },
    { id: "pages", header: "Pages", width: 56, align: "right", sortable: true, accessor: (r) => r.pages },
    { id: "subject", header: "Subject", width: 300, minWidth: 140, sortable: true, accessor: (r) => r.subject, render: (r) => <span className="truncate">{r.subject}</span> },
    { id: "custodian", header: "Custodian", width: 120, sortable: true, accessor: (r) => r.custodianName },
    { id: "date", header: "Date", width: 96, sortable: true, accessor: (r) => r.date, render: (r) => <span className="tabular text-muted-foreground">{formatShortDate(r.date)}</span> },
    { id: "type", header: "Type", width: 90, sortable: true, accessor: (r) => r.type, render: (r) => <span className="flex items-center gap-1.5 text-muted-foreground"><TypeIcon type={r.type as never} />{r.type}</span> },
    { id: "coding", header: "Decision", width: 90, render: (r) => <DecisionCell coding={{ responsive: r.responsive, privileged: r.privileged }} /> },
    { id: "conf", header: "Confidentiality", width: 120, accessor: (r) => r.confidentiality ?? "", render: (r) => <span className="text-muted-foreground">{r.confidentiality ?? "stamp"}</span>, defaultHidden: true },
    { id: "redactions", header: "Redactions", width: 84, align: "right", accessor: (r) => r.redactions, render: (r) => r.redactions ? <span className="tabular">{r.redactions}</span> : <span className="text-muted-foreground/40">—</span> },
  ], [openDocument]);
  if (!p) return <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading production…</div>;
  const qc = p.qc;
  const findings = qc ? qc.privilegedInSet.length + qc.missingFamily.length + qc.unredactedPii.length + qc.uncoded.length : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-1">
        <span className="text-[12.5px] font-semibold">{p.name}</span>
        <StateChip tone={STATUS_TONE[p.status]}>{statusLabel(p.status)}</StateChip>
        <span className="tabular text-[11.5px] text-muted-foreground">{p.docCount} docs · {p.pageCount} pages{p.batesRange ? ` · ${p.batesRange.begin} – ${p.batesRange.end}` : ""} · {p.redactedDocs} redacted</span>
        <div className="flex-1" />
        {p.status === "draft" && <Tip label={PRODUCTION_STATUSES[1].hint}><Button size="xs" variant="outline" onClick={() => setStatus("qc")} disabled={!!busy}><ArrowRight className="size-3" /> Send to QC</Button></Tip>}
        {p.status === "qc" && <Tip label="Back to draft to change the document set"><Button size="xs" variant="ghost" onClick={() => setStatus("draft")} disabled={!!busy}><Undo2 className="size-3" /> Draft</Button></Tip>}
        {p.status === "qc" && <Tip label={qc?.ok ? "QC is clean — lock Bates numbers and load files" : "The QC report must be clean before finalising"}><Button size="xs" onClick={() => setStatus("final")} disabled={!!busy || !qc?.ok}><ShieldCheck className="size-3" /> Finalise</Button></Tip>}
        <Button size="xs" variant="outline" onClick={runQc} disabled={!!busy}>{busy === "QC" ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />} Run QC</Button>
        <Button size="xs" variant="ghost" onClick={() => download("dat")} disabled={!!busy}><FileText className="size-3" /> DAT</Button>
        <Button size="xs" variant="ghost" onClick={() => download("opt")} disabled={!!busy}><FileText className="size-3" /> OPT</Button>
        <Button size="xs" variant="ghost" onClick={() => download("zip")} disabled={!!busy}>{busy?.startsWith("Export ZIP") ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} Volume zip</Button>
        {p.status !== "final" && <Button size="xs" variant="ghost" onClick={remove} aria-label="Delete production"><Trash2 className="size-3" /></Button>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {selected.length > 0 && p.status === "draft" && (
            <div className="flex h-7 shrink-0 items-center gap-2 border-b bg-primary/5 px-3 text-[11.5px]"><span className="tabular">{selected.length} selected</span><Button size="xs" variant="outline" className="h-5" onClick={removeSelected} disabled={!!busy}><Trash2 className="size-3" /> Remove from production</Button><span className="text-muted-foreground">Remaining documents are renumbered.</span></div>
          )}
          <DataTable<ProductionRow> rows={rows} columns={columns} rowId={(r) => r.docId} selectionMode={p.status === "draft" ? "multi" : "none"} selected={selected} onSelectedChange={setSelected} onRowActivate={(r) => openDocument(r.docId)} noun="document" serverSort ariaLabel="Production documents" summary={p.status === "draft"} />
        </div>
        <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l scrollbar-thin lg:flex" aria-label="Production details">
          <div className="p-3">
            <KeyValueList dense labelWidth={100} items={[
              { label: "Prefix", value: <span className="font-mono">{p.prefix} · {p.padding} digits · from {p.startNumber}</span> },
              { label: "Volume", value: <span className="font-mono">{p.volume}</span> },
              { label: "Stamp", value: p.status === "final" ? p.stampText || "none" : <span className="flex items-center gap-1"><Input size="xs" value={stamp ?? p.stampText} onChange={(e) => setStamp(e.target.value)} onBlur={() => { if (stamp != null && stamp !== p.stampText) void act("Stamp", async () => { await patch({ stampText: stamp }); }); setStamp(null); }} aria-label="Confidentiality stamp" /></span> },
              { label: "Source", value: p.source.kind === "search" ? `search${p.source.q ? ` “${p.source.q}”` : ""}` : p.source.kind === "selection" ? "selection" : "all production-ready" },
              { label: "Created", value: `${formatDateTime(p.createdAt)}${p.createdByName ? ` · ${p.createdByName}` : ""}` },
              ...(p.finalizedAt ? [{ label: "Finalised", value: formatDateTime(p.finalizedAt) }] : []),
              ...(p.notes ? [{ label: "Notes", value: p.notes }] : []),
            ]} />
          </div>
          <div className="border-t px-3 py-2">
            <div className="flex items-center justify-between"><span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">QC report</span>{qc && <span className="tabular text-[10.5px] text-muted-foreground">{formatDateTime(qc.ranAt)}</span>}</div>
            {!qc ? <p className="mt-1 text-[11.5px] text-muted-foreground">Not run yet. QC checks privileged documents in the set, family members left behind, unredacted PII patterns and uncoded documents; a clean report is required to finalise.</p> : qc.ok ? <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-success"><ShieldCheck className="size-3.5" /> Clean — no findings.</p> : (
              <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-warning-foreground dark:text-warning"><AlertTriangle className="size-3.5" /> {findings} finding{findings === 1 ? "" : "s"}</p>
            )}
            {qc && !qc.ok && <QcFindings qc={qc} onOpen={openDocument} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function QcFindings({ qc, onOpen }: { qc: ProductionQcReport; onOpen: (id: string) => void }) {
  const Section = ({ title, items, hint }: { title: string; items: { docId: string; label: string; detail?: string }[]; hint: string }) => !items.length ? null : (
    <div className="mt-2">
      <div className="text-[11px] font-medium">{title} <span className="tabular text-muted-foreground">· {items.length}</span></div>
      <div className="text-[10.5px] text-muted-foreground">{hint}</div>
      <ul className="mt-1 divide-y rounded-md border text-[11px]">{items.slice(0, 12).map((it, i) => <li key={i} className="flex h-6 items-center gap-2 px-2"><button type="button" onClick={() => onOpen(it.docId)} className="font-mono text-primary hover:underline cursor-pointer">{it.label}</button>{it.detail && <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.detail}</span>}</li>)}{items.length > 12 && <li className="px-2 py-1 text-muted-foreground">+{items.length - 12} more</li>}</ul>
    </div>
  );
  return (
    <>
      <Section title="Privileged in set" hint="Withhold these or clear the privilege call before producing." items={qc.privilegedInSet.map((x) => ({ docId: x.docId, label: x.bates }))} />
      <Section title="Family members missing" hint="Parents or attachments not in the set (privileged members are expected to be withheld)." items={qc.missingFamily.map((x) => ({ docId: x.missingId, label: x.missingBates, detail: `family of ${x.bates}` }))} />
      <Section title="Unredacted PII" hint="Patterns still visible after text redactions are applied." items={qc.unredactedPii.map((x) => ({ docId: x.docId, label: x.bates, detail: `${x.pattern} ${x.sample}` }))} />
      <Section title="Uncoded" hint="No responsiveness decision on record." items={qc.uncoded.map((x) => ({ docId: x.docId, label: x.bates }))} />
    </>
  );
}
