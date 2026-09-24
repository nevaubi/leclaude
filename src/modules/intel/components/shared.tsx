"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Database, ExternalLink, ListChecks, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/misc";
import type { IntelEntityType, IntelFlag } from "../types";
import { DOC_KIND_LABEL, ENTITY_TYPE_LABEL, FLAG_LABEL, documentHref, entityHref, fmtDate } from "../analysis/pure";
import type { DocLite } from "../analysis/types";

/** Flags as quiet text with one icon; never a stack of pills. */
export function FlagList({ flags, className, max = 3 }: { flags: IntelFlag[]; className?: string; max?: number }) {
  if (!flags.length) return null;
  const shown = flags.slice(0, max);
  const tip = flags.map((f) => `${FLAG_LABEL[f.kind]}${f.note ? `: ${f.note}` : ""}`).join("\n");
  return (
    <Tip label={<div className="max-w-xs whitespace-pre-line text-[11px]">{tip}</div>}>
      <span className={cn("inline-flex min-w-0 items-center gap-1 text-[11px] text-warning-foreground dark:text-warning", className)}>
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{shown.map((f) => FLAG_LABEL[f.kind]).join(", ")}{flags.length > max ? ` +${flags.length - max}` : ""}</span>
      </span>
    </Tip>
  );
}

/** Confidence as tabular text (never a coloured wash); low values read as warnings. */
export function ConfidenceText({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  return <span className={cn("tabular text-[11.5px]", pct < 60 ? "text-warning-foreground dark:text-warning" : "text-muted-foreground", className)} title={`Confidence ${pct}%`}>{pct}%</span>;
}

export function EntityLink({ id, type, name, className }: { id: string; type: IntelEntityType; name: string; className?: string }) {
  return <Link href={entityHref({ id, type })} className={cn("truncate hover:text-primary hover:underline", className)} title={`${ENTITY_TYPE_LABEL[type]} · ${name}`}>{name}</Link>;
}

export function DocLink({ doc, className, showKind }: { doc: Pick<DocLite, "id" | "title" | "kind" | "url">; className?: string; showKind?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <Link href={documentHref(doc.id)} className="min-w-0 truncate hover:text-primary hover:underline" title={doc.title}>{doc.title}</Link>
      {showKind && <span className="shrink-0 text-[11px] text-muted-foreground">{DOC_KIND_LABEL[doc.kind]}</span>}
      {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-primary" aria-label="Open source" title={doc.url}><ExternalLink className="size-3" /></a>}
    </span>
  );
}

/** Small "Mar 4, 2024" date cell. */
export function DateText({ value, className }: { value?: string | null; className?: string }) {
  return <span className={cn("tabular whitespace-nowrap text-muted-foreground", className)} title={value ?? undefined}>{fmtDate(value)}</span>;
}

/** Empty state shared by every /intel page: how to bring sources online. */
export function EmptySources({ title, description, className, compact }: { title?: string; description?: React.ReactNode; className?: string; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      className={className}
      icon={Database}
      title={title ?? "No intelligence records yet"}
      description={description ?? <>Sources ingest case law, dockets, court rules, judges, regulations, Federal Register notices, FDA recalls, MDLs, counsel data, news and local folders in the background. Enable and run them under <Link href="/settings#sources" className="text-primary hover:underline">Settings → Data &amp; automation</Link>; add provider keys under <Link href="/settings#research" className="text-primary hover:underline">Research providers</Link>. Then run the analysis to derive entities, relations, trends and insights.</>}
      action={<RunAnalysisButton />}
    />
  );
}

/** Runs the deterministic analysis pass (entities → relations → insights) and reloads the page. */
export function RunAnalysisButton({ label = "Run analysis", size = "xs", variant = "outline", onDone, className }: { label?: string; size?: "xs" | "sm"; variant?: "outline" | "default" | "ghost"; onDone?: () => void; className?: string }) {
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/intel/analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run: "all" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `${res.status} ${res.statusText}`);
      toast.success("Analysis finished", { description: `${j.entities?.docs ?? 0} documents resolved · ${j.relations?.total ?? 0} relations · ${j.insights?.created ?? 0} new, ${j.insights?.updated ?? 0} updated insights` });
      if (onDone) onDone(); else window.location.reload();
    } catch (e) {
      toast.error("Analysis failed", { description: (e as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Button size={size} variant={variant} onClick={() => void run()} disabled={busy} className={className}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} {label}
    </Button>
  );
}

/** Fetch JSON with abort-on-unmount and a simple loading/error state. */
export function useJson<T>(url: string | null, deps: React.DependencyList = []): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(Boolean(url));
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!url) { setData(null); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `${r.status} ${r.statusText}`); return j as T; })
      .then((j) => { setData(j); setError(null); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setError((e as Error).message); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

/** Section heading inside a page body: 32px, hairline, count as text. */
export function BodySection({ title, count, actions, children, className }: { title: React.ReactNode; count?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="flex h-8 items-center gap-2 border-b">
        <h3 className="text-[12.5px] font-semibold tracking-tight">{title}</h3>
        {count != null && <span className="section-count">{count}</span>}
        <div className="flex-1" />
        {actions}
      </div>
      <div className="pt-2">{children}</div>
    </section>
  );
}

/** One-line note about the method behind derived data (TF-IDF fallback, computed without a key…). */
export function MethodNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[11px] leading-snug text-muted-foreground", className)}>{children}</p>;
}
