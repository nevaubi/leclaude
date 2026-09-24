/** Pure model for the Home matters table (no React; unit-tested). */
import type { MatterOverview } from "../types";

export const SIDE_LABEL: Record<MatterOverview["clientSide"], string> = { plaintiff: "Plaintiff", defendant: "Defendant", petitioner: "Petitioner", respondent: "Respondent", buyer: "Buyer", seller: "Seller", other: "Client" };

/** Rows for the table: the filtered matter (when one is active) or every open matter, most urgent key date first. */
export function matterRows(overview: MatterOverview[], matterFilter: string | null | undefined): MatterOverview[] {
  const rows = matterFilter ? overview.filter((m) => m.id === matterFilter) : [...overview];
  return rows.sort((a, b) => (a.nextKeyDate?.daysUntil ?? Infinity) - (b.nextKeyDate?.daysUntil ?? Infinity) || a.shortName.localeCompare(b.shortName));
}

/** Tone for the key-date countdown: within a week reads as destructive, within a month as warning. */
export function keyDateTone(daysUntil: number | undefined): "destructive" | "warning" | undefined {
  if (daysUntil == null) return undefined;
  if (daysUntil <= 7) return "destructive";
  if (daysUntil <= 30) return "warning";
  return undefined;
}

/** One quiet meta line: caption (or name), side, client, pre-suit marker. */
export function matterMeta(m: Pick<MatterOverview, "caption" | "name" | "clientSide" | "client" | "status">): string {
  return [m.caption ?? m.name, SIDE_LABEL[m.clientSide], m.client, m.status === "pre-suit" ? "Pre-suit" : null].filter(Boolean).join(" · ");
}

/** Task cell: open count plus a late marker when anything is overdue. */
export function taskCell(m: Pick<MatterOverview, "openTasks" | "overdueTasks" | "myOpenTasks">): { text: string; late: boolean; title: string } {
  const late = m.overdueTasks > 0;
  return {
    text: late ? `${m.openTasks} (${m.overdueTasks} late)` : String(m.openTasks),
    late,
    title: `${m.openTasks} open task${m.openTasks === 1 ? "" : "s"}${late ? ` · ${m.overdueTasks} overdue` : ""}${m.myOpenTasks ? ` · ${m.myOpenTasks} yours` : ""}`,
  };
}

/** Hot documents as "hot / total". */
export function hotCell(m: Pick<MatterOverview, "hotDocs" | "docCount">): { text: string; hot: boolean } {
  return { text: `${m.hotDocs} / ${m.docCount}`, hot: m.hotDocs > 0 };
}
