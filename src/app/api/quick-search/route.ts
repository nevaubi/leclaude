import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { QuickSearchHit } from "@/components/shell/command-palette";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return Response.json({ hits: [] });
  const d = db();
  const hits: QuickSearchHit[] = [];
  const has = (s?: string | null) => !!s && s.toLowerCase().includes(q);
  for (const m of d.matters.all()) if (has(m.name) || has(m.shortName) || has(m.client) || has(m.caption)) hits.push({ id: m.id, kind: "matter", title: m.shortName, subtitle: `${m.caption ?? ""} · ${m.client}`, href: `/ediscovery?matter=${m.id}` });
  for (const p of d.people.all()) if (has(p.name) || has(p.organization)) hits.push({ id: p.id, kind: "person", title: p.name, subtitle: `${p.title ?? p.role} · ${p.organization ?? ""}`, href: `/ediscovery?tab=people&person=${p.id}` });
  for (const t of d.tasks.all()) if (has(t.title)) hits.push({ id: t.id, kind: "task", title: t.title, subtitle: t.status.replace("_", " "), href: `/?task=${t.id}` });
  for (const e of d.events.all()) if (has(e.title)) hits.push({ id: e.id, kind: "event", title: e.title, subtitle: e.startsAt.slice(0, 10), href: `/?event=${e.id}` });
  for (const w of d.workflows.all()) if (has(w.name) || has(w.description)) hits.push({ id: w.id, kind: "workflow", title: w.name, subtitle: w.category, href: `/workflows/${w.id}` });
  for (const o of d.officeDocs.all()) if (has(o.title)) hits.push({ id: o.id, kind: "office", title: o.title, subtitle: o.kind, href: `/office/${o.kind}/${o.id}` });
  for (const l of d.library.all()) if (l.type !== "folder" && !l.officeDocId && (has(l.name) || has(l.description))) hits.push({ id: l.id, kind: "library", title: l.name, subtitle: l.type, href: `/library?item=${l.id}` });
  let n = 0;
  for (const doc of d.edocs.all()) { if (n >= 8) break; if (has(doc.bates) || has(doc.subject)) { hits.push({ id: doc.id, kind: "document", title: `${doc.bates} — ${doc.subject}`, subtitle: `${doc.custodianName} · ${doc.date}`, href: `/ediscovery?matter=${doc.matterId}&doc=${doc.id}` }); n++; } }
  return Response.json({ hits: hits.slice(0, 30) });
}
