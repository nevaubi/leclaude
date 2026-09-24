"use client";
import * as React from "react";
import { ShieldCheck, RefreshCw, Wrench, ExternalLink, Loader2, ScrollText } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import type { AuditEvent, ScanFinding, ScanReport, ScanSeverity } from "@/lib/integrity/types";

const TONE: Record<ScanSeverity, "muted" | "info" | "warning" | "destructive"> = { info: "muted", low: "info", medium: "warning", high: "destructive" };

export function IntegrityPanel() {
  const [report, setReport] = React.useState<ScanReport | null>(null);
  const [running, setRunning] = React.useState(false);
  const [audit, setAudit] = React.useState<AuditEvent[]>([]);
  const [chain, setChain] = React.useState<{ ok: boolean; checked: number; brokenAt?: string } | null>(null);
  const load = React.useCallback(async () => {
    const [s, a, c] = await Promise.all([fetch("/api/integrity/scan").then((r) => r.json()), fetch("/api/integrity/audit?limit=40").then((r) => r.json()), fetch("/api/integrity/audit?verify=1").then((r) => r.json())]);
    setReport(s.report ?? null); setAudit(a.events ?? []); setChain(c);
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const run = async () => {
    setRunning(true);
    try { const r = await fetch("/api/integrity/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const j = await r.json(); setReport(j.report); toast.success(`Scan complete: ${j.report.totals.findings} finding${j.report.totals.findings === 1 ? "" : "s"}`); void load(); } catch (e) { toast.error(String(e)); } finally { setRunning(false); }
  };
  const fix = async (f: ScanFinding) => {
    const r = await fetch("/api/integrity/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fix: f.id }) });
    const j = await r.json();
    if (j.ok) { toast.success(j.message); void load(); } else toast.error(j.message);
  };
  const findings = (report?.results ?? []).flatMap((r) => r.findings.map((f) => ({ ...f, scanName: r.name }))).sort((a, b) => ["high", "medium", "low", "info"].indexOf(a.severity) - ["high", "medium", "low", "info"].indexOf(b.severity));
  return (
    <div className="space-y-6" id="integrity">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Data integrity scans</CardTitle>
            <CardDescription>Orphaned references, duplicate documents, index coverage, stuck workflow runs, office document consistency and calendar gaps. Runs automatically every 6 hours and shortly after startup.</CardDescription>
          </div>
          <Button size="sm" onClick={run} disabled={running}>{running ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Run scans</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {report ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Last run <RelativeTime value={report.ranAt} /> ({report.trigger})</span>
              <span>· {report.totals.checked.toLocaleString()} records checked</span>
              {(["high", "medium", "low", "info"] as ScanSeverity[]).map((s) => report.totals.bySeverity[s] ? <Badge key={s} variant={TONE[s]} className="capitalize">{s} {report.totals.bySeverity[s]}</Badge> : null)}
              {report.totals.findings === 0 && <Badge variant="success">All clear</Badge>}
            </div>
          ) : <div className="text-xs text-muted-foreground">No scan has run yet.</div>}
          {findings.length > 0 && (
            <ul className="divide-y rounded-md border">
              {findings.map((f) => (
                <li key={f.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <Badge variant={TONE[f.severity]} className="mt-0.5 capitalize">{f.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{f.title}{f.fixed && <Badge variant="success" className="ml-2">fixed</Badge>}</div>
                    <div className="text-xs text-muted-foreground">{f.scanName} · {f.detail}</div>
                  </div>
                  {f.target?.href && <Button asChild variant="ghost" size="xs"><Link href={f.target.href}><ExternalLink className="size-3" /> Open</Link></Button>}
                  {f.fixable && !f.fixed && <Button variant="outline" size="xs" onClick={() => fix(f)}><Wrench className="size-3" /> Fix</Button>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScrollText className="size-4 text-primary" /> Audit log {chain && (chain.ok ? <Badge variant="success">chain intact · {chain.checked}</Badge> : <Badge variant="destructive">chain broken at {chain.brokenAt}</Badge>)}</CardTitle>
          <CardDescription>Every AI generation, applied edit, coding change, import, export, workflow run and integrity fix, hash-chained so history cannot be silently altered.</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? <div className="text-xs text-muted-foreground">No events yet.</div> : (
            <ul className="divide-y text-xs">
              {audit.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-1.5">
                  <span className="w-28 shrink-0 text-muted-foreground"><RelativeTime value={e.ts} /></span>
                  <Badge variant="outline" className="shrink-0 font-mono">{e.action}</Badge>
                  <span className="min-w-0 flex-1 truncate">{e.target.label ?? `${e.target.kind}${e.target.id ? ` ${e.target.id}` : ""}`}</span>
                  <span className="shrink-0 text-muted-foreground">{e.actorName}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
