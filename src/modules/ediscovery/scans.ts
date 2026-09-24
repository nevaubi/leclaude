import "server-only";
import { registerScan } from "@/lib/integrity/scans";
import { CONFIDENCE_GATE, type ScanFinding } from "@/lib/integrity/types";
import { contentHash } from "@/lib/integrity/hash";
import { extractRecordCites } from "@/lib/ai/verify";
import { listProvenance } from "@/lib/integrity/store";
import type { Database } from "@/lib/db";

type Finding = Omit<ScanFinding, "id" | "scanId">;

const docHref = (matterId: string, id: string) => `/ediscovery?matter=${matterId}&doc=${id}`;

/** Bates numbers that exist in a matter (upper-cased), including ranges' end markers. */
function batesSet(d: Database, matterId: string): Set<string> {
  const s = new Set<string>();
  for (const doc of d.edocs.all()) if (doc.matterId === matterId) { s.add(doc.bates.toUpperCase()); if (doc.batesEnd) s.add(doc.batesEnd.toUpperCase()); }
  return s;
}

/**
 * E-discovery integrity: family completeness, privilege coding hygiene, hot
 * documents without issue codes, deposition cites that point nowhere, timeline
 * and conflict sources that do not resolve, and AI-scored documents that sit
 * below the confidence gate without a human decision.
 */
registerScan({
  id: "ediscovery-families",
  name: "E-discovery families",
  description: "Parents whose attachments are missing, attachments whose parent is gone, thread ids with a single member, and documents without a content hash.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    const threads = new Map<string, number>();
    for (const doc of d.edocs.all()) if (doc.family?.threadId) threads.set(doc.family.threadId, (threads.get(doc.family.threadId) ?? 0) + 1);
    for (const doc of d.edocs.all()) {
      checked++;
      const missingAtt = (doc.family?.attachmentIds ?? []).filter((id) => !d.edocs.has(id));
      if (missingAtt.length) findings.push({ severity: "medium", title: `${doc.bates} lists ${missingAtt.length} attachment(s) that no longer exist`, detail: missingAtt.join(", "), target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) }, fixable: true });
      const parentId = doc.family?.parentId;
      if (parentId && d.edocs.has(parentId)) { const parent = d.edocs.get(parentId)!; if (!(parent.family?.attachmentIds ?? []).includes(doc.id)) findings.push({ severity: "low", title: `${doc.bates} is an attachment of ${parent.bates} but the parent does not list it`, detail: "Family will not travel together in production.", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) }, fixable: true }); }
      if (doc.family?.threadId && (threads.get(doc.family.threadId) ?? 0) === 1 && doc.type === "Email") findings.push({ severity: "info", title: `${doc.bates} is the only member of thread ${doc.family.threadId}`, detail: "Thread grouping adds nothing; the rest of the thread may be uncollected.", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) } });
      if (!doc.hash) findings.push({ severity: "info", title: `${doc.bates} has no content hash`, detail: "Duplicate detection relies on hashes; the scan can compute it.", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) }, fixable: true });
      if (doc.isDuplicateOf && !d.edocs.has(doc.isDuplicateOf)) findings.push({ severity: "low", title: `${doc.bates} is marked as a duplicate of a missing document`, detail: doc.isDuplicateOf, target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) }, fixable: true });
    }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "edoc") return false;
    const doc = d.edocs.get(f.target.id);
    if (!doc) return false;
    if (/no content hash/.test(f.title)) { d.edocs.put({ ...doc, hash: contentHash(doc.text) }); return true; }
    if (/duplicate of a missing/.test(f.title)) { const { isDuplicateOf: _x, ...rest } = doc; void _x; d.edocs.put(rest); return true; }
    if (/attachment\(s\) that no longer exist/.test(f.title)) { d.edocs.put({ ...doc, family: { ...doc.family, attachmentIds: (doc.family?.attachmentIds ?? []).filter((id) => d.edocs.has(id)) } }); return true; }
    if (/parent does not list it/.test(f.title)) { const parent = doc.family?.parentId ? d.edocs.get(doc.family.parentId) : null; if (!parent) return false; d.edocs.put({ ...parent, family: { ...parent.family, attachmentIds: Array.from(new Set([...(parent.family?.attachmentIds ?? []), doc.id])) } }); return true; }
    return false;
  },
});

registerScan({
  id: "ediscovery-coding",
  name: "E-discovery coding hygiene",
  description: "Documents coded privileged without a basis, hot documents without issue codes, privilege-log entries for documents no longer privileged, and issue codes applied that do not exist in the matter rubric.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    const codes = new Map<string, Set<string>>();
    for (const c of d.issueCodes.all()) { const s = codes.get(c.matterId) ?? new Set(); s.add(c.code); codes.set(c.matterId, s); }
    for (const doc of d.edocs.all()) {
      checked++;
      if (doc.coding.privileged === true && !doc.coding.privilegeBasis) findings.push({ severity: "high", title: `${doc.bates} is coded privileged without a basis`, detail: "A privilege log entry needs attorney-client, work-product, common-interest or joint-defense. Open the document and pick one.", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) } });
      if (doc.coding.hot && !(doc.coding.issues?.length)) findings.push({ severity: "medium", title: `${doc.bates} is hot but carries no issue code`, detail: "Hot documents drive the trial outline; tag the issue so they surface in the chronology and outlines.", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) } });
      const valid = codes.get(doc.matterId);
      const unknown = (doc.coding.issues ?? []).filter((i) => valid && !valid.has(i));
      if (unknown.length) findings.push({ severity: "low", title: `${doc.bates} uses issue code(s) missing from the rubric`, detail: unknown.join(", "), target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) }, fixable: true });
      if (doc.coding.privileged === true && doc.coding.responsive === false) findings.push({ severity: "info", title: `${doc.bates} is privileged but coded non-responsive`, detail: "Non-responsive documents are not logged; confirm the responsiveness call.", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) } });
    }
    for (const e of d.privilegeLog.all()) {
      checked++;
      const doc = d.edocs.get(e.docId);
      if (!doc) findings.push({ severity: "medium", title: `Privilege log entry ${e.bates} points at a missing document`, detail: e.docId, target: { kind: "privilegeEntry", id: e.id, href: `/ediscovery?matter=${e.matterId}&tab=codes` }, fixable: true });
      else if (doc.coding.privileged !== true) findings.push({ severity: "medium", title: `Privilege log entry for ${e.bates} but the document is no longer coded privileged`, detail: `status ${e.status}`, target: { kind: "privilegeEntry", id: e.id, href: docHref(doc.matterId, doc.id) }, fixable: true });
    }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind === "privilegeEntry") return d.privilegeLog.delete(f.target.id);
    if (f.target?.kind === "edoc" && /missing from the rubric/.test(f.title)) { const doc = d.edocs.get(f.target.id); if (!doc) return false; const valid = new Set(d.issueCodes.find((c) => c.matterId === doc.matterId).map((c) => c.code)); d.edocs.put({ ...doc, coding: { ...doc.coding, issues: (doc.coding.issues ?? []).filter((i) => valid.has(i)) } }); return true; }
    return false;
  },
});

registerScan({
  id: "ediscovery-citations",
  name: "Deposition and chronology cites",
  description: "Deposition exhibits and AI digests citing Bates numbers that do not exist, timeline events whose sources do not resolve, and conflicts whose sides point at missing records.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    const batesByMatter = new Map<string, Set<string>>();
    const bates = (m: string) => { let s = batesByMatter.get(m); if (!s) { s = batesSet(d, m); batesByMatter.set(m, s); } return s; };
    for (const dep of d.depositions.all()) {
      checked++;
      const known = bates(dep.matterId);
      const href = `/ediscovery?matter=${dep.matterId}&tab=depositions&deposition=${dep.id}`;
      const badExhibits = (dep.exhibits ?? []).filter((e) => e.bates && !known.has(e.bates.toUpperCase()));
      if (badExhibits.length) findings.push({ severity: "medium", title: `${dep.witnessName} deposition: ${badExhibits.length} exhibit(s) cite Bates numbers not in the review set`, detail: badExhibits.map((e) => `${e.id} → ${e.bates}`).join(", "), target: { kind: "deposition", id: dep.id, href } });
      if (dep.aiDigest) {
        const text = [dep.aiDigest.summary, ...dep.aiDigest.keyAdmissions, ...(dep.aiDigest.credibilityNotes ?? []), ...(dep.aiDigest.followUps ?? [])].join("\n");
        const cites = extractRecordCites(text);
        const missing = cites.bates.filter((b) => !known.has(b));
        if (missing.length) findings.push({ severity: "medium", title: `${dep.witnessName} AI digest cites ${missing.length} Bates number(s) that do not exist`, detail: missing.join(", "), target: { kind: "deposition", id: dep.id, href } });
        const pages = new Set(dep.transcript.map((q) => q.page));
        const badPages = cites.pageLines.map((pl) => Number(pl.split(":")[0])).filter((p) => pages.size && !pages.has(p));
        if (badPages.length) findings.push({ severity: "low", title: `${dep.witnessName} AI digest cites ${badPages.length} page(s) outside the transcript`, detail: Array.from(new Set(badPages)).slice(0, 10).join(", "), target: { kind: "deposition", id: dep.id, href } });
      }
    }
    for (const e of d.timeline.all()) {
      checked++;
      const known = bates(e.matterId);
      const bad = e.sources.filter((s) => (s.kind === "document" && ((s.id && !d.edocs.has(s.id)) || (!s.id && s.bates && !known.has(s.bates.toUpperCase())))) || (s.kind === "deposition" && s.id && !d.depositions.has(s.id)));
      if (bad.length) findings.push({ severity: "medium", title: `Timeline event "${e.title}" (${e.date}) has ${bad.length} source(s) that do not resolve`, detail: bad.map((s) => s.id ?? s.bates ?? s.cite ?? s.kind).join(", "), target: { kind: "timelineEvent", id: e.id, href: `/ediscovery?matter=${e.matterId}&tab=timeline&event=${e.id}` }, fixable: bad.some((s) => s.kind === "document" && s.bates && known.has(s.bates.toUpperCase())) });
      if (!e.sources.length && e.createdBy === "ai") findings.push({ severity: "low", title: `AI timeline event "${e.title}" has no source`, detail: "Every AI-extracted event should cite the Bates number it came from.", target: { kind: "timelineEvent", id: e.id, href: `/ediscovery?matter=${e.matterId}&tab=timeline&event=${e.id}` } });
    }
    for (const c of d.conflicts.all()) {
      checked++;
      const bad = c.sides.filter((s) => (s.sourceKind === "document" && !d.edocs.has(s.sourceId)) || (s.sourceKind === "deposition" && !d.depositions.has(s.sourceId)));
      if (bad.length) findings.push({ severity: "high", title: `Conflict "${c.title}" has ${bad.length} side(s) pointing at missing records`, detail: bad.map((s) => `${s.sourceKind} ${s.sourceId} (${s.cite})`).join(", "), target: { kind: "conflict", id: c.id, href: `/ediscovery?matter=${c.matterId}&tab=conflicts&conflict=${c.id}` } });
    }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "timelineEvent") return false;
    const e = d.timeline.get(f.target.id);
    if (!e) return false;
    const byBates = new Map(d.edocs.find((x) => x.matterId === e.matterId).map((x) => [x.bates.toUpperCase(), x.id]));
    let changed = false;
    const sources = e.sources.map((s) => { if (s.kind === "document" && (!s.id || !d.edocs.has(s.id)) && s.bates && byBates.has(s.bates.toUpperCase())) { changed = true; return { ...s, id: byBates.get(s.bates.toUpperCase()) }; } return s; });
    if (changed) d.timeline.put({ ...e, sources });
    return changed;
  },
});

registerScan({
  id: "ediscovery-ai-review",
  name: "AI output awaiting review",
  description: "AI-scored documents below the confidence gate that no reviewer has decided, and AI-created timeline events, conflicts and analyses whose provenance is pending or contradicted.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    for (const doc of d.edocs.all()) {
      if (doc.aiScore == null && !doc.aiProvenance) continue;
      checked++;
      const conf = doc.aiProvenance?.confidence;
      const uncertain = doc.aiScore != null && doc.aiScore >= 40 && doc.aiScore < 70;
      const belowGate = conf != null && conf < CONFIDENCE_GATE;
      if ((belowGate || uncertain) && doc.coding.responsive == null && doc.aiProvenance?.review?.status !== "approved" && doc.aiProvenance?.review?.status !== "rejected") {
        findings.push({ severity: "low", title: `${doc.bates} was AI-scored ${doc.aiScore ?? "—"}${conf != null ? ` (confidence ${(conf * 100).toFixed(0)}%)` : ""} and has no reviewer decision`, detail: "Below the confidence gate: the prediction must not drive production or privilege calls until a reviewer codes it.", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) } });
      }
      if (doc.aiProvenance?.verification?.status === "contradicted") findings.push({ severity: "medium", title: `${doc.bates}: AI analysis was contradicted by the document text`, detail: doc.aiProvenance.verification.notes ?? "", target: { kind: "edoc", id: doc.id, href: docHref(doc.matterId, doc.id) } });
    }
    const stale = Date.now() - 14 * 86400000;
    for (const r of listProvenance({ pending: true })) {
      checked++;
      if (new Date(r.updatedAt).getTime() < stale) findings.push({ severity: "low", title: `"${r.title}" has waited ${Math.round((Date.now() - new Date(r.updatedAt).getTime()) / 86400000)} days for review`, detail: `${r.kind} · ${r.provenance.surface} · ${r.provenance.review?.note ?? "pending"}`, target: { kind: r.kind, id: r.recordId, href: r.href ?? `/integrity?review=${r.kind}:${r.recordId}` } });
      if (r.provenance.verification?.status === "contradicted") findings.push({ severity: "medium", title: `"${r.title}" is contradicted by its own sources`, detail: r.provenance.verification.notes ?? "", target: { kind: r.kind, id: r.recordId, href: r.href } });
    }
    return { checked, findings };
  },
});
