import "server-only";
import { registerScan } from "@/lib/integrity/scans";
import type { ScanFinding } from "@/lib/integrity/types";
import { extractPlainText } from "@/lib/ai/toolkit/internal";
import { extractVariables } from "./clauses";
import { clauseMetaCollection } from "./data";

type Finding = Omit<ScanFinding, "id" | "scanId">;

const OFFICE_LINK = /\/office\/(word|sheet|slides|pdf)\/([A-Za-z0-9_-]{6,})/g;

/**
 * Library integrity: approved (published) documents that still contain
 * unfilled clause variables, approved notes that have not been reviewed in a
 * year, and links to office documents that no longer exist.
 */
registerScan({
  id: "library-content",
  name: "Library content",
  description: "Published documents with unfilled clause variables, approved notes older than a year, clauses whose declared variables drift from their text.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
    for (const li of d.library.all()) {
      if (li.type === "folder") continue;
      checked++;
      const href = `/library?item=${li.id}`;
      if (li.type === "clause") {
        const meta = clauseMetaCollection().get(li.id);
        const inText = extractVariables(li.content ?? "");
        const declared = new Set((meta?.variables ?? []).map((v) => v.name));
        const undeclared = inText.filter((v) => !declared.has(v));
        if (meta && undeclared.length) findings.push({ severity: "low", title: `Clause "${li.name}" uses ${undeclared.length} variable(s) not declared in its metadata`, detail: undeclared.join(", "), target: { kind: "library", id: li.id, href }, fixable: true });
        continue;
      }
      const published = li.status === "approved";
      if (published) {
        const text = li.content ?? (li.officeDocId ? extractPlainText(d.officeDocs.get(li.officeDocId)?.content) : "");
        const vars = extractVariables(text);
        if (vars.length) findings.push({ severity: "high", title: `Approved "${li.name}" still contains ${vars.length} unfilled variable(s)`, detail: vars.slice(0, 8).map((v) => `{{${v}}}`).join(", "), target: { kind: "library", id: li.id, href: li.officeDocId ? `/office/${d.officeDocs.get(li.officeDocId)?.kind ?? "word"}/${li.officeDocId}` : href } });
        if (li.type === "note" && li.updatedAt < yearAgo) findings.push({ severity: "low", title: `Approved note "${li.name}" has not been reviewed in over a year`, detail: `Last updated ${li.updatedAt.slice(0, 10)}. Re-approve or archive.`, target: { kind: "library", id: li.id, href }, fixable: true });
      }
    }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "library") return false;
    const li = d.library.get(f.target.id);
    if (!li) return false;
    if (/not declared in its metadata/.test(f.title)) { const meta = clauseMetaCollection().get(li.id); if (!meta) return false; const names = new Set(meta.variables.map((v) => v.name)); const extra = extractVariables(li.content ?? "").filter((v) => !names.has(v)).map((v) => ({ name: v, label: v.replace(/[_-]+/g, " ") })); clauseMetaCollection().put({ ...meta, variables: [...meta.variables, ...extra] }); return true; }
    if (/not been reviewed in over a year/.test(f.title)) { d.library.put({ ...li, status: "draft", updatedAt: new Date().toISOString() }); return true; }
    return false;
  },
});

registerScan({
  id: "library-links",
  name: "Library links",
  description: "Library links and note bodies that point at office documents which no longer exist.",
  run: (d) => {
    const findings: Finding[] = [];
    let checked = 0;
    for (const li of d.library.all()) {
      if (li.type === "folder") continue;
      checked++;
      const targets: { kind: string; id: string }[] = [];
      for (const src of [li.url ?? "", li.content ?? ""]) for (const m of src.matchAll(OFFICE_LINK)) targets.push({ kind: m[1], id: m[2] });
      const broken = targets.filter((t) => !d.officeDocs.has(t.id));
      if (broken.length) findings.push({ severity: "medium", title: `"${li.name}" links to ${broken.length} office document(s) that no longer exist`, detail: broken.map((t) => `/office/${t.kind}/${t.id}`).join(", "), target: { kind: "library", id: li.id, href: `/library?item=${li.id}` }, fixable: li.type === "link" });
    }
    return { checked, findings };
  },
  fix: (d, f) => {
    if (f.target?.kind !== "library") return false;
    const li = d.library.get(f.target.id);
    if (!li || li.type !== "link") return false;
    return d.library.delete(li.id);
  },
});
