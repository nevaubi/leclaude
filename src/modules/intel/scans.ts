import "server-only";
import { registerScan } from "@/lib/integrity/scans";
import type { ScanFinding } from "@/lib/integrity/types";
import { getAdapter } from "./adapters";
import { providerStatuses } from "./config";
import { failJob, retryJob } from "./jobs";
import { periodMs } from "./schedule";
import { flagDocument, hasFlag, indexIntelDocument, intelDocuments, intelJobs, intelSources } from "./store";
import { lastSweepReport, staleDocuments } from "./steward";
import { INTEL_STALE_AFTER_DAYS } from "./types";

type Finding = Omit<ScanFinding, "id" | "scanId">;

const SETTINGS = "/settings?tab=data";

/** Sources: repeated failures, never-run schedules, unknown adapters, enabled sources whose provider is not configured. */
registerScan({
  id: "intel-sources",
  name: "Intelligence sources",
  description: "Sources failing repeatedly, enabled sources whose provider is not configured, schedules that never fired, and unknown adapters.",
  run: () => {
    const findings: Finding[] = [];
    const now = Date.now();
    const statuses = new Map(providerStatuses().map((s) => [s.id, s]));
    let checked = 0;
    for (const s of intelSources().all()) {
      checked++;
      const adapter = getAdapter(s.adapter);
      const target = { kind: "intel.source", id: s.id, href: `${SETTINGS}&source=${s.id}` };
      if (!adapter) { findings.push({ severity: "high", title: `Source "${s.name}" uses unknown adapter "${s.adapter}"`, detail: "Disable or delete it.", target, fixable: true }); continue; }
      const missing = adapter.requires.filter((r) => statuses.get(r)?.configured === false);
      if (s.enabled && missing.length) findings.push({ severity: "low", title: `"${s.name}" is enabled but ${missing.join(", ")} is not configured`, detail: missing.map((m) => statuses.get(m)?.envVar).filter(Boolean).map((v) => `set ${v}`).join("; ") || "Add the provider key or disable the source.", target, fixable: true });
      if (s.health.consecutiveFailures >= 3) findings.push({ severity: s.health.consecutiveFailures >= 5 ? "high" : "medium", title: `"${s.name}" has failed ${s.health.consecutiveFailures} times in a row`, detail: s.health.lastError ?? "No error recorded.", target });
      const period = periodMs(s.schedule);
      if (s.enabled && period && !s.lastRunAt && now - new Date(s.createdAt).getTime() > 2 * period) findings.push({ severity: "low", title: `"${s.name}" is scheduled but has never run`, detail: `Created ${s.createdAt.slice(0, 10)}. The runner only works while the server is up (or through the cron tick).`, target });
      else if (s.enabled && period && s.lastRunAt && now - new Date(s.lastRunAt).getTime() > 3 * period) findings.push({ severity: "low", title: `"${s.name}" last ran ${Math.round((now - new Date(s.lastRunAt).getTime()) / 3600_000)} hours ago`, detail: `Expected every ${Math.round(period / 60_000)} minutes.`, target });
    }
    return { checked, findings };
  },
  fix: (_d, f) => {
    if (f.target?.kind !== "intel.source") return false;
    const s = intelSources().get(f.target.id);
    if (!s || !s.enabled) return false;
    intelSources().put({ ...s, enabled: false, status: "disabled", nextRunAt: undefined, updatedAt: new Date().toISOString() });
    return true;
  },
});

/** Jobs: escalations awaiting a human, stuck heartbeats, backlog, failures in the last day. */
registerScan({
  id: "intel-jobs",
  name: "Intelligence jobs",
  description: "Escalated jobs awaiting review, running jobs with stale heartbeats, queue backlog and failures in the last 24 hours.",
  run: () => {
    const findings: Finding[] = [];
    const now = Date.now();
    const jobs = intelJobs().all();
    for (const j of jobs) {
      const target = { kind: "intel.job", id: j.id, href: `${SETTINGS}&job=${j.id}` };
      if (j.status === "escalated") findings.push({ severity: "medium", title: `Escalated job ${j.kind}${j.sourceId ? ` (${intelSources().get(j.sourceId)?.name ?? j.sourceId})` : ""}`, detail: j.escalation?.reason ?? j.error?.message ?? "Escalated by the steward.", target });
      if (j.status === "running" && now - new Date(j.heartbeatAt ?? j.startedAt ?? j.updatedAt).getTime() > 10 * 60_000) findings.push({ severity: "medium", title: `Job ${j.id} has had no heartbeat for ${Math.round((now - new Date(j.heartbeatAt ?? j.startedAt ?? j.updatedAt).getTime()) / 60_000)} minutes`, detail: `${j.kind}; attempt ${j.attempts}/${j.maxAttempts}.`, target, fixable: true });
    }
    const queued = jobs.filter((j) => j.status === "queued").length;
    if (queued > 50) findings.push({ severity: "low", title: `${queued} jobs queued`, detail: "The runner may be off (LECLAUDE_BACKGROUND) or the cron tick is not firing.", target: { kind: "intel.queue", id: "queue", href: SETTINGS } });
    const failed = jobs.filter((j) => j.status === "failed" && (j.finishedAt ?? j.updatedAt) >= new Date(now - 86400_000).toISOString());
    if (failed.length) findings.push({ severity: failed.length > 5 ? "medium" : "info", title: `${failed.length} job(s) failed in the last 24 hours`, detail: failed.slice(0, 5).map((j) => `${j.kind}: ${j.error?.message.slice(0, 80) ?? "?"}`).join(" · "), target: { kind: "intel.queue", id: "failed", href: SETTINGS }, fixable: true });
    return { checked: jobs.length, findings };
  },
  fix: (_d, f) => {
    if (f.target?.kind === "intel.job") {
      const j = intelJobs().get(f.target.id);
      if (!j || j.status !== "running") return false;
      return Boolean(failJob(j.id, { code: "timeout", message: "Reaped by the integrity scan (stale heartbeat)" }, { retryable: true, backoffMs: 5_000 }));
    }
    if (f.target?.kind === "intel.queue" && f.target.id === "failed") {
      let n = 0;
      for (const j of intelJobs().find((j) => j.status === "failed" && !j.payload.rerunOf)) { if (retryJob(j.id, { by: "steward", note: "Re-queued by the integrity scan" })) n++; }
      return n > 0;
    }
    return false;
  },
});

/** Documents: unindexed text, missing blobs, low confidence without a flag, cross-source duplicates, orphaned sources. */
registerScan({
  id: "intel-documents",
  name: "Intelligence documents",
  description: "Documents with text but no chunks, missing full text, low confidence without a flag, cross-source duplicates and documents whose source is gone.",
  run: (d) => {
    const findings: Finding[] = [];
    const docs = intelDocuments().all();
    const sources = new Set(intelSources().all().map((s) => s.id));
    const byHash = new Map<string, string[]>();
    for (const doc of docs) {
      const target = { kind: "intel.document", id: doc.id, href: `/intel/documents/${doc.id}` };
      if (doc.textLength > 0 && doc.chunkCount === 0) findings.push({ severity: "low", title: `"${doc.title.slice(0, 80)}" has text but no chunks`, detail: `${doc.textLength} characters; re-index it.`, target, fixable: true });
      if (doc.textBlobId && !d.blobs.meta(doc.textBlobId) && !hasFlag(doc, "parse_error")) findings.push({ severity: "medium", title: `"${doc.title.slice(0, 80)}" is missing its full text`, detail: `Blob ${doc.textBlobId} not found.`, target, fixable: true });
      if (doc.confidence < 0.4 && !hasFlag(doc, "low_confidence") && !hasFlag(doc, "parse_error") && !hasFlag(doc, "unverified")) findings.push({ severity: "low", title: `"${doc.title.slice(0, 80)}" has confidence ${(doc.confidence * 100).toFixed(0)}% without a flag`, detail: "Flag it low_confidence so it is excluded from automation.", target, fixable: true });
      if (!sources.has(doc.sourceId) && !hasFlag(doc, "needs_review")) findings.push({ severity: "low", title: `"${doc.title.slice(0, 80)}" belongs to a source that no longer exists`, detail: doc.sourceId, target, fixable: true });
      byHash.set(doc.hash, [...(byHash.get(doc.hash) ?? []), doc.id]);
    }
    for (const [hash, ids] of byHash) {
      if (ids.length < 2) continue;
      const group = ids.map((id) => intelDocuments().get(id)!).filter(Boolean);
      const sourcesInGroup = new Set(group.map((g) => `${g.adapter}:${g.sourceId}`));
      if (sourcesInGroup.size < 2) continue;
      const unflagged = group.filter((g) => !hasFlag(g, "duplicate"));
      if (unflagged.length) findings.push({ severity: "info", title: `${group.length} documents share identical text across sources`, detail: `${group.map((g) => g.title.slice(0, 50)).join(" · ")} (hash ${hash.slice(0, 8)})`, target: { kind: "intel.document", id: unflagged[0].id, href: `/intel/documents/${unflagged[0].id}` }, fixable: true });
    }
    return { checked: docs.length, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "intel.document") return false;
    const doc = intelDocuments().get(f.target.id);
    if (!doc) return false;
    const at = new Date().toISOString();
    if (/no chunks/.test(f.title)) { void indexIntelDocument(doc).catch(() => {}); return true; }
    if (/missing its full text/.test(f.title)) return Boolean(flagDocument(doc.id, { kind: "parse_error", note: "Full text blob missing; re-fetch from the source", by: "scan", at }));
    if (/without a flag/.test(f.title)) return Boolean(flagDocument(doc.id, { kind: "low_confidence", note: "Flagged by the integrity scan", by: "scan", at }));
    if (/no longer exists/.test(f.title)) return Boolean(flagDocument(doc.id, { kind: "needs_review", note: `Source ${doc.sourceId} was deleted`, by: "scan", at }));
    if (/identical text/.test(f.title)) {
      const group = intelDocuments().find((x) => x.hash === doc.hash).sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
      for (const g of group.slice(1)) flagDocument(g.id, { kind: "duplicate", note: `Duplicate of ${group[0].id} (${group[0].adapter})`, by: "scan", at });
      return group.length > 1;
    }
    void d;
    return false;
  },
});

/** Freshness: stale documents without a flag, overdue sources, an old sweep. */
registerScan({
  id: "intel-freshness",
  name: "Intelligence freshness",
  description: "Documents older than their kind's freshness window without a stale flag, sources overdue by more than two periods, and a verification sweep older than a day.",
  run: () => {
    const findings: Finding[] = [];
    const now = new Date();
    const docs = intelDocuments().all();
    const stale = staleDocuments(now, docs).filter((d) => !hasFlag(d, "stale"));
    if (stale.length) findings.push({ severity: "low", title: `${stale.length} document(s) are past their freshness window without a stale flag`, detail: stale.slice(0, 5).map((d) => `${d.title.slice(0, 50)} (${d.kind}, ${INTEL_STALE_AFTER_DAYS[d.kind]}d)`).join(" · "), target: { kind: "intel.freshness", id: "stale", href: SETTINGS }, fixable: true });
    for (const s of intelSources().all()) {
      const period = periodMs(s.schedule);
      if (!s.enabled || !period || !s.nextRunAt) continue;
      const overdue = now.getTime() - new Date(s.nextRunAt).getTime();
      if (overdue > 2 * period) findings.push({ severity: "low", title: `"${s.name}" is overdue by ${Math.round(overdue / 3600_000)} hours`, detail: "The job runner is not picking it up; check LECLAUDE_BACKGROUND or the cron tick.", target: { kind: "intel.source", id: s.id, href: `${SETTINGS}&source=${s.id}` } });
    }
    const sweep = lastSweepReport();
    if (docs.length && (!sweep || now.getTime() - new Date(sweep.at).getTime() > 24 * 3600_000)) findings.push({ severity: "info", title: sweep ? `Last verification sweep ran ${Math.round((now.getTime() - new Date(sweep.at).getTime()) / 3600_000)} hours ago` : "No verification sweep has run yet", detail: "Sweeps run every 6 hours through the job runner.", target: { kind: "intel.sweep", id: "sweep", href: SETTINGS } });
    return { checked: docs.length + intelSources().count(), findings };
  },
  fix: (_d, f) => {
    if (f.target?.kind !== "intel.freshness") return false;
    const now = new Date();
    let n = 0;
    for (const doc of staleDocuments(now)) if (!hasFlag(doc, "stale")) { flagDocument(doc.id, { kind: "stale", note: `Not refreshed for more than ${INTEL_STALE_AFTER_DAYS[doc.kind]} days`, by: "scan", at: now.toISOString() }); n++; }
    return n > 0;
  },
});

