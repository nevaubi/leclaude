import "server-only";
import { nanoid } from "nanoid";
import { db, type Database } from "@/lib/db";
import { indexStats } from "@/lib/ai/vector-store";
import { contentHash } from "./hash";
import { audit } from "./audit";
import type { ScanFinding, ScanReport, ScanResult, ScanSeverity } from "./types";

export interface IntegrityScan {
  id: string;
  name: string;
  description: string;
  run: (d: Database) => { checked: number; findings: Omit<ScanFinding, "id" | "scanId">[] };
  /** Optional auto-fix for a finding produced by this scan. */
  fix?: (d: Database, finding: ScanFinding) => boolean;
}

const registry = new Map<string, IntegrityScan>();

/** Modules register their own scans (e.g. e-discovery family integrity, workflow orphans). */
export function registerScan(scan: IntegrityScan) {
  registry.set(scan.id, scan);
}

export function listScans() {
  return Array.from(registry.values()).map(({ id, name, description }) => ({ id, name, description }));
}

// ---------------------------------------------------------------------------
// Built-in scans
// ---------------------------------------------------------------------------

registerScan({
  id: "orphan-references",
  name: "Orphaned references",
  description: "Records pointing at matters, people or documents that no longer exist.",
  run: (d) => {
    const findings: Omit<ScanFinding, "id" | "scanId">[] = [];
    let checked = 0;
    for (const t of d.tasks.all()) { checked++; if (t.matterId && !d.matters.has(t.matterId)) findings.push({ severity: "medium", title: `Task "${t.title}" points at a missing matter`, detail: `matterId ${t.matterId}`, target: { kind: "task", id: t.id, href: `/?task=${t.id}` }, fixable: true }); if (t.assigneeId && !d.people.has(t.assigneeId)) findings.push({ severity: "low", title: `Task "${t.title}" assigned to a missing person`, detail: `assigneeId ${t.assigneeId}`, target: { kind: "task", id: t.id, href: `/?task=${t.id}` }, fixable: true }); }
    for (const e of d.events.all()) { checked++; if (e.matterId && !d.matters.has(e.matterId)) findings.push({ severity: "medium", title: `Event "${e.title}" points at a missing matter`, detail: `matterId ${e.matterId}`, target: { kind: "event", id: e.id, href: `/?event=${e.id}` } }); }
    for (const doc of d.edocs.all()) { checked++; if (!d.matters.has(doc.matterId)) findings.push({ severity: "high", title: `Document ${doc.bates} belongs to a missing matter`, detail: `matterId ${doc.matterId}`, target: { kind: "edoc", id: doc.id } }); if (!d.people.has(doc.custodianId)) findings.push({ severity: "medium", title: `Document ${doc.bates} has an unknown custodian`, detail: `custodianId ${doc.custodianId} (${doc.custodianName})`, target: { kind: "edoc", id: doc.id, href: `/ediscovery?matter=${doc.matterId}&doc=${doc.id}` } }); const parent = doc.family?.parentId; if (parent && !d.edocs.has(parent)) findings.push({ severity: "medium", title: `Document ${doc.bates} references a missing parent`, detail: `parentId ${parent}`, target: { kind: "edoc", id: doc.id } }); }
    for (const li of d.library.all()) { checked++; if (li.officeDocId && !d.officeDocs.has(li.officeDocId)) findings.push({ severity: "medium", title: `Library item "${li.name}" points at a missing office document`, detail: `officeDocId ${li.officeDocId}`, target: { kind: "library", id: li.id, href: `/library?item=${li.id}` }, fixable: true }); if (li.parentId && !d.library.has(li.parentId)) findings.push({ severity: "medium", title: `Library item "${li.name}" is in a missing folder`, detail: `parentId ${li.parentId}`, target: { kind: "library", id: li.id }, fixable: true }); }
    for (const r of d.relationships.all()) { checked++; if (!d.people.has(r.fromId) || !d.people.has(r.toId)) findings.push({ severity: "low", title: "Relationship references a missing person", detail: `${r.fromId} → ${r.toId} (${r.kind})`, target: { kind: "relationship", id: r.id }, fixable: true }); }
    for (const dep of d.depositions.all()) { checked++; if (!d.people.has(dep.witnessId)) findings.push({ severity: "medium", title: `Deposition of ${dep.witnessName} has no matching person record`, detail: `witnessId ${dep.witnessId}`, target: { kind: "deposition", id: dep.id, href: `/ediscovery?matter=${dep.matterId}&tab=depositions` } }); }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind === "task") { const t = d.tasks.get(f.target.id); if (!t) return false; d.tasks.put({ ...t, matterId: t.matterId && d.matters.has(t.matterId) ? t.matterId : undefined, assigneeId: t.assigneeId && d.people.has(t.assigneeId) ? t.assigneeId : undefined }); return true; }
    if (f.target?.kind === "library") { const li = d.library.get(f.target.id); if (!li) return false; if (li.officeDocId && !d.officeDocs.has(li.officeDocId)) { d.library.delete(li.id); return true; } if (li.parentId && !d.library.has(li.parentId)) { d.library.put({ ...li, parentId: null }); return true; } return false; }
    if (f.target?.kind === "relationship") { return d.relationships.delete(f.target.id); }
    return false;
  },
});

registerScan({
  id: "duplicate-documents",
  name: "Duplicate documents",
  description: "E-discovery documents with identical text that are not linked as duplicates, and library items with the same name in one folder.",
  run: (d) => {
    const findings: Omit<ScanFinding, "id" | "scanId">[] = [];
    const byHash = new Map<string, string[]>();
    let checked = 0;
    for (const doc of d.edocs.all()) { checked++; const h = doc.hash ?? contentHash(doc.text); const list = byHash.get(`${doc.matterId}:${h}`) ?? []; list.push(doc.id); byHash.set(`${doc.matterId}:${h}`, list); }
    for (const ids of byHash.values()) {
      if (ids.length < 2) continue;
      const docs = ids.map((id) => d.edocs.get(id)!);
      const unlinked = docs.filter((x) => !x.isDuplicateOf && !docs.some((y) => y.isDuplicateOf === x.id));
      if (unlinked.length > 1) findings.push({ severity: "low", title: `${docs.length} documents share identical text`, detail: docs.map((x) => x.bates).join(", "), target: { kind: "edoc", id: docs[0].id, href: `/ediscovery?matter=${docs[0].matterId}&doc=${docs[0].id}` }, fixable: true });
    }
    const byName = new Map<string, string[]>();
    for (const li of d.library.all()) { if (li.type === "folder") continue; checked++; const k = `${li.parentId}:${li.name.toLowerCase()}`; const list = byName.get(k) ?? []; list.push(li.id); byName.set(k, list); }
    for (const ids of byName.values()) if (ids.length > 1) { const first = d.library.get(ids[0])!; findings.push({ severity: "info", title: `"${first.name}" appears ${ids.length} times in the same folder`, detail: ids.join(", "), target: { kind: "library", id: ids[0], href: `/library?item=${ids[0]}` } }); }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "edoc") return false;
    const primary = d.edocs.get(f.target.id);
    if (!primary) return false;
    const h = primary.hash ?? contentHash(primary.text);
    let changed = false;
    for (const doc of d.edocs.find((x) => x.matterId === primary.matterId && x.id !== primary.id && (x.hash ?? contentHash(x.text)) === h && !x.isDuplicateOf)) { d.edocs.put({ ...doc, isDuplicateOf: primary.id }); changed = true; }
    return changed;
  },
});

registerScan({
  id: "search-index",
  name: "Search index coverage",
  description: "Documents and library items missing from the hybrid search index.",
  run: (d) => {
    const findings: Omit<ScanFinding, "id" | "scanId">[] = [];
    const ed = indexStats("ediscovery_documents");
    const lib = indexStats("library_items");
    const off = indexStats("office_documents");
    const edocs = d.edocs.count();
    const libItems = d.library.count((l) => l.type !== "folder");
    const officeDocs = d.officeDocs.count();
    if (ed.docs < edocs) findings.push({ severity: "medium", title: `${edocs - ed.docs} e-discovery documents are not indexed`, detail: `Rebuild via POST /api/ediscovery/index or the Reindex button.`, fixable: false });
    if (lib.docs < Math.floor(libItems * 0.5)) findings.push({ severity: "low", title: `Library index covers ${lib.docs} of ${libItems} items`, detail: `POST /api/library/index rebuilds it.` });
    if (off.docs < officeDocs) findings.push({ severity: "low", title: `${officeDocs - off.docs} office documents are not indexed`, detail: `They index on their next save.` });
    if (edocs && ed.embedded === 0) findings.push({ severity: "info", title: "Semantic embeddings are not built", detail: "Keyword search only until an OpenAI key is configured and the index is rebuilt." });
    return { checked: edocs + libItems + officeDocs, findings };
  },
});

registerScan({
  id: "workflow-runs",
  name: "Workflow run health",
  description: "Runs stuck in a running state, approvals waiting more than 7 days, and workflows whose triggers reference missing matters.",
  run: (d) => {
    const findings: Omit<ScanFinding, "id" | "scanId">[] = [];
    const now = Date.now();
    let checked = 0;
    for (const r of d.workflowRuns.all()) {
      checked++;
      const age = now - new Date(r.startedAt).getTime();
      if ((r.status === "running" || r.status === "queued") && age > 60 * 60 * 1000) findings.push({ severity: "medium", title: `Run ${r.id} has been ${r.status} for ${Math.round(age / 3600000)}h`, detail: "Likely interrupted by a server restart.", target: { kind: "workflowRun", id: r.id, href: `/workflows/runs/${r.id}` }, fixable: true });
      if (r.status === "waiting_approval" && age > 7 * 86400000) findings.push({ severity: "low", title: `Approval pending for ${Math.round(age / 86400000)} days`, detail: r.id, target: { kind: "workflowRun", id: r.id, href: `/workflows/runs/${r.id}` } });
      if (r.matterId && !d.matters.has(r.matterId)) findings.push({ severity: "low", title: `Run ${r.id} references a missing matter`, detail: r.matterId, target: { kind: "workflowRun", id: r.id } });
    }
    for (const w of d.workflows.all()) { checked++; const trig = w.nodes.find((n) => n.type.startsWith("trigger.")); const m = trig?.config?.matterId; if (typeof m === "string" && m && !d.matters.has(m)) findings.push({ severity: "low", title: `Workflow "${w.name}" is scoped to a missing matter`, detail: m, target: { kind: "workflow", id: w.id, href: `/workflows/${w.id}` } }); }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "workflowRun") return false;
    const r = d.workflowRuns.get(f.target.id);
    if (!r || (r.status !== "running" && r.status !== "queued")) return false;
    d.workflowRuns.put({ ...r, status: "failed", finishedAt: new Date().toISOString(), steps: r.steps.map((s) => (s.status === "running" || s.status === "pending" ? { ...s, status: "failed", error: "Interrupted (marked by integrity scan)" } : s)) });
    return true;
  },
});

registerScan({
  id: "office-consistency",
  name: "Office documents",
  description: "Office documents without a library entry, versions without a document, and empty documents that have history.",
  run: (d) => {
    const findings: Omit<ScanFinding, "id" | "scanId">[] = [];
    let checked = 0;
    const withRows = new Set(d.library.all().map((l) => l.officeDocId).filter(Boolean));
    for (const doc of d.officeDocs.all()) { checked++; if (!withRows.has(doc.id)) findings.push({ severity: "low", title: `"${doc.title}" has no library entry`, detail: `${doc.kind} ${doc.id}`, target: { kind: "officeDoc", id: doc.id, href: `/office/${doc.kind}/${doc.id}` } }); const size = JSON.stringify(doc.content ?? null).length; if (size < 80 && doc.contentVersion > 2) findings.push({ severity: "medium", title: `"${doc.title}" is empty but has ${doc.contentVersion} versions`, detail: "Possible accidental overwrite; restore from Versions.", target: { kind: "officeDoc", id: doc.id, href: `/office/${doc.kind}/${doc.id}` } }); }
    for (const v of d.officeVersions.all()) { checked++; if (!d.officeDocs.has(v.docId)) findings.push({ severity: "low", title: `Version ${v.version} belongs to a missing document`, detail: v.docId, target: { kind: "officeVersion", id: v.id }, fixable: true }); }
    for (const c of d.officeComments.all()) { checked++; if (!d.officeDocs.has(c.docId)) findings.push({ severity: "info", title: "Comment belongs to a missing document", detail: c.docId, target: { kind: "officeComment", id: c.id }, fixable: true }); }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind === "officeVersion") return d.officeVersions.delete(f.target.id);
    if (f.target?.kind === "officeComment") return d.officeComments.delete(f.target.id);
    return false;
  },
});

registerScan({
  id: "calendar-consistency",
  name: "Calendar & deadlines",
  description: "Matter key dates without calendar events and past-due tasks still open for more than 30 days.",
  run: (d) => {
    const findings: Omit<ScanFinding, "id" | "scanId">[] = [];
    let checked = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const m of d.matters.all()) for (const kd of m.keyDates ?? []) { checked++; const has = d.events.findOne((e) => e.matterId === m.id && e.startsAt.slice(0, 10) === kd.date); if (!has && kd.date >= today) findings.push({ severity: "low", title: `${m.shortName}: "${kd.label}" (${kd.date}) has no calendar event`, detail: "Key dates render as read-only deadlines; add an event to assign attendees and notes.", target: { kind: "matter", id: m.id, href: `/?section=calendar` } }); }
    for (const t of d.tasks.all()) { checked++; if (t.status !== "done" && t.dueAt && t.dueAt < today) { const days = Math.round((Date.now() - new Date(t.dueAt).getTime()) / 86400000); if (days > 30) findings.push({ severity: "low", title: `Task "${t.title}" is ${days} days overdue`, detail: `due ${t.dueAt}`, target: { kind: "task", id: t.id, href: `/?task=${t.id}` } }); } }
    return { checked, findings };
  },
});

// ---------------------------------------------------------------------------

const REPORT_KEY = "integrity:last-report";

export function runScans(trigger: ScanReport["trigger"] = "manual", only?: string[]): ScanReport {
  const d = db();
  const results: ScanResult[] = [];
  for (const scan of registry.values()) {
    if (only?.length && !only.includes(scan.id)) continue;
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const r = scan.run(d);
      results.push({ scanId: scan.id, name: scan.name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, checked: r.checked, findings: r.findings.map((f) => ({ ...f, id: `sf_${nanoid(8)}`, scanId: scan.id })) });
    } catch (e) {
      results.push({ scanId: scan.id, name: scan.name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, checked: 0, findings: [], error: (e as Error).message });
    }
  }
  const bySeverity: Record<ScanSeverity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  let findings = 0, checked = 0;
  for (const r of results) { checked += r.checked; for (const f of r.findings) { findings++; bySeverity[f.severity]++; } }
  const report: ScanReport = { id: `scan_${nanoid(8)}`, ranAt: new Date().toISOString(), trigger, results, totals: { checked, findings, bySeverity } };
  d.kv.set(REPORT_KEY, report);
  audit("scan.run", { kind: "integrity", label: `${findings} findings across ${results.length} scans` }, { trigger, totals: report.totals });
  return report;
}

export function lastReport(): ScanReport | null {
  return db().kv.get<ScanReport>(REPORT_KEY);
}

export function fixFinding(findingId: string): { ok: boolean; message: string } {
  const report = lastReport();
  const finding = report?.results.flatMap((r) => r.findings).find((f) => f.id === findingId);
  if (!report || !finding) return { ok: false, message: "Finding not found (run the scan again)" };
  const scan = registry.get(finding.scanId);
  if (!scan?.fix || !finding.fixable) return { ok: false, message: "This finding has no automatic fix" };
  const ok = scan.fix(db(), finding);
  if (ok) {
    finding.fixed = true;
    db().kv.set(REPORT_KEY, report);
    audit("scan.fix", { kind: finding.target?.kind ?? "integrity", id: finding.target?.id, label: finding.title });
  }
  return { ok, message: ok ? "Fixed" : "Could not fix automatically" };
}

type G = typeof globalThis & { __leclaudeScanTimer?: ReturnType<typeof setInterval> };

/** Start the periodic scan (every 6 hours) once per process; the first run happens shortly after boot. */
export function ensureScheduledScans() {
  const g = globalThis as G;
  if (g.__leclaudeScanTimer) return;
  g.__leclaudeScanTimer = setInterval(() => { try { runScans("scheduled"); } catch (e) { console.warn("[integrity] scheduled scan failed", (e as Error).message); } }, 6 * 60 * 60 * 1000);
  setTimeout(() => { try { if (!lastReport()) runScans("boot"); } catch (e) { console.warn("[integrity] boot scan failed", (e as Error).message); } }, 15_000).unref?.();
  g.__leclaudeScanTimer.unref?.();
}
