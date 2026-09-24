/**
 * Pure chronology helpers (client + server safe): sorting, dedupe, filters,
 * CSV and markdown export.
 */
import type { TimelineEvent } from "@/lib/types/domain";
import type { TimelineFilters } from "./types";

export function compareEvents(a: TimelineEvent, b: TimelineEvent) {
  return a.date.localeCompare(b.date) || b.significance - a.significance || a.title.localeCompare(b.title);
}

export function sortEvents<T extends TimelineEvent>(events: T[]): T[] {
  return [...events].sort(compareEvents);
}

/** Normalised key for dedupe: date + lower-cased title with punctuation and stop words removed. */
export function eventKey(e: Pick<TimelineEvent, "date" | "title">) {
  const title = e.title.toLowerCase().replace(/[^a-z0-9µ ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).join(" ");
  return `${e.date.slice(0, 10)}|${title}`;
}
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "at", "by", "with", "re", "from", "is", "—", "-"]);

/**
 * Merge incoming events into an existing list. Events sharing date + title are
 * merged (sources unioned, longer description kept). Returns the full list plus
 * the events that were actually new.
 */
export function dedupeEvents<T extends TimelineEvent>(existing: T[], incoming: T[]): { merged: T[]; added: T[]; mergedInto: { incoming: T; existing: T }[] } {
  const byKey = new Map<string, T>();
  for (const e of existing) byKey.set(eventKey(e), e);
  const added: T[] = [];
  const mergedInto: { incoming: T; existing: T }[] = [];
  const merged = [...existing];
  for (const e of incoming) {
    const k = eventKey(e);
    const hit = byKey.get(k);
    if (!hit) { byKey.set(k, e); merged.push(e); added.push(e); continue; }
    const seen = new Set(hit.sources.map((s) => `${s.kind}|${s.bates ?? ""}|${s.cite ?? ""}|${s.id ?? ""}`));
    for (const s of e.sources) { const sk = `${s.kind}|${s.bates ?? ""}|${s.cite ?? ""}|${s.id ?? ""}`; if (!seen.has(sk)) { hit.sources.push(s); seen.add(sk); } }
    if ((e.description?.length ?? 0) > (hit.description?.length ?? 0)) hit.description = e.description;
    hit.significance = Math.max(hit.significance, e.significance) as TimelineEvent["significance"];
    if (e.personIds?.length) hit.personIds = Array.from(new Set([...(hit.personIds ?? []), ...e.personIds]));
    mergedInto.push({ incoming: e, existing: hit });
  }
  return { merged: sortEvents(merged), added, mergedInto };
}

export function filterEvents<T extends TimelineEvent>(events: T[], f: TimelineFilters | undefined): T[] {
  if (!f) return events;
  const q = f.q?.trim().toLowerCase();
  return events.filter((e) => {
    if (f.categories?.length && !f.categories.includes(e.category)) return false;
    if (f.personId && !e.personIds?.includes(f.personId)) return false;
    if (f.minSignificance && e.significance < f.minSignificance) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.sourceKind && !e.sources.some((s) => s.kind === f.sourceKind)) return false;
    if (f.disputedOnly && !e.disputed) return false;
    if (f.unverifiedOnly && e.verified) return false;
    if (q && !`${e.title} ${e.description ?? ""} ${e.sources.map((s) => `${s.bates ?? ""} ${s.cite ?? ""}`).join(" ")}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function sourceLabel(s: TimelineEvent["sources"][number]) {
  if (s.kind === "document") return s.bates ?? s.cite ?? s.id ?? "document";
  if (s.kind === "deposition") return s.cite ?? s.id ?? "deposition";
  return s.cite ?? "external";
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function chronologyCsv(events: TimelineEvent[], people: Map<string, string> = new Map()): string {
  const header = ["Date", "End date", "Precision", "Event", "Description", "Category", "Significance", "Sources", "People", "Verified", "Disputed", "Created by"];
  const lines = [header.join(",")];
  for (const e of sortEvents(events)) {
    lines.push([
      e.date, e.dateEnd ?? "", e.precision ?? "day", e.title, e.description ?? "", e.category, e.significance,
      e.sources.map(sourceLabel).join("; "), (e.personIds ?? []).map((p) => people.get(p) ?? p).join("; "), e.verified ? "yes" : "no", e.disputed ? "yes" : "no", e.createdBy,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function formatEventDate(e: Pick<TimelineEvent, "date" | "dateEnd" | "precision">) {
  const fmt = (d: string) => {
    const dt = new Date(d + (d.length === 10 ? "T00:00:00Z" : ""));
    if (Number.isNaN(dt.getTime())) return d;
    if (e.precision === "year") return String(dt.getUTCFullYear());
    if (e.precision === "month") return dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
  };
  return e.dateEnd && e.dateEnd !== e.date ? `${fmt(e.date)} – ${fmt(e.dateEnd)}` : fmt(e.date);
}

export function chronologyMarkdown(events: TimelineEvent[], opts: { title?: string; matterName?: string; people?: Map<string, string> } = {}): string {
  const sorted = sortEvents(events);
  const out: string[] = [];
  out.push(`# ${opts.title ?? "Chronology"}`);
  out.push("");
  out.push(`${opts.matterName ? `**Matter:** ${opts.matterName}  ` : ""}**Events:** ${sorted.length}  **Verified:** ${sorted.filter((e) => e.verified).length}  **Disputed:** ${sorted.filter((e) => e.disputed).length}`);
  out.push("");
  out.push("| Date | Event | Category | Sources | Status |");
  out.push("|---|---|---|---|---|");
  for (const e of sorted) {
    const status = [e.verified ? "verified" : "unverified", e.disputed ? "disputed" : null].filter(Boolean).join(", ");
    out.push(`| ${formatEventDate(e)} | ${e.title.replace(/\|/g, "/")} | ${e.category} | ${e.sources.map(sourceLabel).join("; ")} | ${status} |`);
  }
  out.push("");
  out.push("## Detail");
  out.push("");
  for (const e of sorted) {
    out.push(`### ${formatEventDate(e)} — ${e.title}`);
    if (e.description) out.push(e.description);
    const meta: string[] = [`Category: ${e.category}`, `Significance: ${e.significance}/5`];
    if (e.personIds?.length) meta.push(`People: ${e.personIds.map((p) => opts.people?.get(p) ?? p).join(", ")}`);
    if (e.disputed) meta.push("**Disputed**");
    out.push(meta.join(" · "));
    if (e.sources.length) {
      out.push("");
      for (const s of e.sources) out.push(`- ${sourceLabel(s)}${s.excerpt ? ` — "${s.excerpt}"` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}
