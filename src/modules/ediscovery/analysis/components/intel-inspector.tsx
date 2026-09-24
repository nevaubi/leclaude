"use client";
import * as React from "react";
import { Gavel, Globe, Landmark, Loader2, RefreshCw, ScrollText } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Inspector } from "@/components/ui/inspector";
import { KeyValueList } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MatterIntelPanel } from "../types";
import { ConfidenceText, formatShortDate } from "./shared";
import { api, useIntelPanel } from "./use-analysis-data";

const KIND_LABEL: Record<string, string> = { docket: "Docket", docket_entry: "Docket entry", opinion: "Opinion", mdl: "MDL", regulation: "Regulation", register_notice: "Federal Register", recall: "Recall", adverse_event: "Adverse event", statute: "Statute", court_rule: "Court rule" };

function Section({ title, count, children }: { title: string; count?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b">
      <h3 className="flex h-7 items-center gap-2 px-3 text-[11px] font-medium text-muted-foreground">{title}{count != null && <span className="tabular">{count}</span>}</h3>
      {children}
    </section>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <div className="px-3 pb-2 text-[11.5px] text-muted-foreground">{children}</div>;

/**
 * Matter intelligence beside the chronology: the judge's profile and recent
 * rulings, docket activity, the regulatory chronology and the MDL status from
 * the intelligence corpus, and a gated, deduplicated merge of the intelligence
 * chronology into the matter timeline. Every section has an empty state; when
 * the sources are off the panel says so and links to Settings.
 */
export function IntelInspector({ matterId, onClose, onMerged, width = 360 }: { matterId: string; onClose?: () => void; onMerged?: () => void; width?: number }) {
  const res = useIntelPanel(matterId);
  const [minConfidence, setMinConfidence] = React.useState("0.6");
  const [merging, setMerging] = React.useState(false);
  const p = res.data;
  const merge = async () => {
    setMerging(true);
    try {
      const r = await api<{ created: number; skippedDuplicates: number; belowGate: number }>("/api/ediscovery/analysis/intel", { method: "POST", json: { matterId, minConfidence: Number(minConfidence) } });
      toast.success(r.created ? `${r.created} event${r.created === 1 ? "" : "s"} added to the chronology` : "Nothing new to add", { description: `${r.skippedDuplicates} already on the timeline · ${r.belowGate} below the confidence gate · added events are unverified until a reviewer accepts them` });
      res.refresh(); onMerged?.();
    } catch (e) { toast.error("Merge failed", { description: (e as Error).message }); }
    finally { setMerging(false); }
  };
  const title = "Intelligence";
  const subtitle = p ? `${p.sources.enabled} of ${p.sources.total} sources on` : undefined;
  const actions = <Button size="icon-xs" variant="ghost" onClick={res.refresh} aria-label="Refresh" disabled={res.loading}>{res.loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</Button>;
  if (res.loading && !p) return <Inspector title={title} width={width} onClose={onClose} actions={actions}><div className="p-3 text-[12px] text-muted-foreground">Reading the intelligence record…</div></Inspector>;
  if (res.error || !p) return <Inspector title={title} width={width} onClose={onClose} actions={actions}><div className="p-4"><EmptyState icon={Globe} title="Intelligence unavailable" description={res.error?.message ?? "The intelligence record could not be read."} compact /></div></Inspector>;
  if (!p.available) return <Inspector title={title} subtitle={subtitle} width={width} onClose={onClose} actions={actions}><div className="p-4"><EmptyState icon={Globe} title="No intelligence for this matter" description="Court, docket, regulatory and MDL sources are collected in the background once enabled." action={<Button asChild size="xs" variant="outline"><Link href="/settings#data">Open Data &amp; automation</Link></Button>} compact /></div></Inspector>;
  return (
    <Inspector title={title} subtitle={subtitle} width={width} onClose={onClose} actions={actions} ariaLabel="Matter intelligence">
      <Section title="Judge">
        {!p.judge ? <Muted>No judge profile linked to this matter.</Muted> : (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 text-[12.5px]"><Gavel className="size-3.5 text-muted-foreground" /><Link href={p.judge.href} className="font-medium hover:underline">{p.judge.name}</Link><span className="text-[11px] tabular text-muted-foreground">{p.judge.documents} records</span></div>
            {p.judge.court && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{p.judge.court}</div>}
            {p.judge.tendencies.length > 0 && (
              <table className="mt-1.5 w-full text-[11.5px]">
                <thead className="grid-head"><tr><th className="py-0.5 text-left">Motion</th><th className="w-[40px] py-0.5 text-right">Rulings</th><th className="w-[56px] py-0.5 text-right">Granted</th></tr></thead>
                <tbody>{p.judge.tendencies.slice(0, 6).map((t) => <tr key={t.motion} className="border-t border-border/60"><td className="py-0.5 pr-2">{t.label}</td><td className="py-0.5 text-right tabular">{t.total}</td><td className="py-0.5 text-right tabular">{t.grantRate == null ? "—" : `${Math.round(t.grantRate * 100)}%`}</td></tr>)}</tbody>
              </table>
            )}
            {p.judge.recent.length > 0 && <ul className="mt-1.5 space-y-0.5">{p.judge.recent.slice(0, 4).map((r) => <li key={r.id} className="flex items-baseline gap-2 text-[11.5px]"><span className="w-[70px] shrink-0 tabular text-muted-foreground">{r.date ? formatShortDate(r.date) : "—"}</span><Link href={`/intel/documents/${encodeURIComponent(r.id)}`} className="min-w-0 truncate hover:underline" title={r.title}>{r.title}</Link></li>)}</ul>}
          </div>
        )}
      </Section>
      <Section title="Docket activity" count={p.docket.length || undefined}>
        {!p.docket.length ? <Muted>No docket entries collected for this matter.</Muted> : (
          <table className="w-full table-fixed text-[11.5px]">
            <tbody>{p.docket.map((d) => <tr key={d.id} className="row-default row-hover border-t border-border/60"><td className="w-[74px] px-3 tabular text-muted-foreground">{d.date ? formatShortDate(d.date) : "—"}</td><td className="truncate px-1"><Link href={`/intel/documents/${encodeURIComponent(d.id)}`} className="hover:underline" title={d.title}>{d.title}</Link>{d.flagged && <span className="ml-1 text-[10.5px] text-warning-foreground dark:text-warning">unverified</span>}</td><td className="w-[64px] pr-3 text-right text-[10.5px] text-muted-foreground">{KIND_LABEL[d.kind] ?? d.kind}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
      <Section title="Regulatory chronology" count={p.regulatory.length || undefined}>
        {!p.regulatory.length ? <Muted>No regulatory events, notices or recalls linked to this matter.</Muted> : (
          <table className="w-full table-fixed text-[11.5px]">
            <tbody>{p.regulatory.slice(0, 12).map((r, i) => <tr key={`${r.at}-${i}`} className="row-default row-hover border-t border-border/60"><td className="w-[74px] px-3 tabular text-muted-foreground">{formatShortDate(r.at.slice(0, 10))}</td><td className="truncate px-1"><Link href={`/intel/documents/${encodeURIComponent(r.docIds[0] ?? "")}`} className="hover:underline" title={r.title}>{r.title}</Link></td><td className="w-[44px] pr-3 text-right"><ConfidenceText value={r.confidence} /></td></tr>)}</tbody>
          </table>
        )}
      </Section>
      <Section title="MDL">
        {!p.mdl ? <Muted>Not linked to a multidistrict litigation.</Muted> : (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 text-[12.5px]"><Landmark className="size-3.5 text-muted-foreground" /><Link href={p.mdl.href} className="font-medium hover:underline">{p.mdl.name}</Link>{p.mdl.flagged && <span className="text-[10.5px] text-warning-foreground dark:text-warning">unverified</span>}</div>
            <KeyValueList dense labelWidth={70} className="mt-1" items={[{ label: "Number", value: p.mdl.number ? `MDL ${p.mdl.number}` : "—", muted: !p.mdl.number }, { label: "Court", value: p.mdl.court ?? "—", muted: !p.mdl.court }, { label: "Status", value: p.mdl.status ?? "—" }, { label: "Updated", value: p.mdl.updatedAt ? formatShortDate(p.mdl.updatedAt.slice(0, 10)) : "—", muted: !p.mdl.updatedAt }]} />
            {p.mdl.detail && <p className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-muted-foreground">{p.mdl.detail}</p>}
          </div>
        )}
      </Section>
      <Section title="Chronology">
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 text-[11.5px]"><ScrollText className="size-3.5 text-muted-foreground" /><span className="tabular">{p.chronology.entries} intelligence entries · {p.chronology.alreadyOnTimeline} already on the chronology</span></div>
          <div className="mt-2 flex items-center gap-1.5">
            <Select value={minConfidence} onValueChange={setMinConfidence}><SelectTrigger size="xs" className={cn("h-7 w-[104px] text-[11.5px]")} aria-label="Minimum confidence"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0.5">≥ 50%</SelectItem><SelectItem value="0.6">≥ 60% (gate)</SelectItem><SelectItem value="0.8">≥ 80%</SelectItem></SelectContent></Select>
            <Button size="xs" onClick={merge} disabled={merging || !p.chronology.entries}>{merging ? <Loader2 className="size-3.5 animate-spin" /> : null} Merge into chronology</Button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">Entries at or above the gate become chronology events with their source records and provenance; near-duplicates of existing events are skipped. Added events stay unverified until a reviewer accepts them.</p>
        </div>
      </Section>
      <div className="px-3 py-2 text-[10.5px] tabular text-muted-foreground">Read {formatShortDate(p.generatedAt.slice(0, 10))}{p.sources.disabled.length ? ` · off: ${p.sources.disabled.slice(0, 3).join(", ")}${p.sources.disabled.length > 3 ? ` +${p.sources.disabled.length - 3}` : ""}` : ""}</div>
    </Inspector>
  );
}

export type { MatterIntelPanel };
