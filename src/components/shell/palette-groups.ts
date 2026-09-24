/** Pure grouping for the command palette's quick-search hits (unit-tested; no React). */
export interface QuickSearchHit {
  id: string;
  kind: "matter" | "document" | "person" | "task" | "event" | "workflow" | "library" | "office";
  title: string;
  subtitle?: string;
  href: string;
}

export const KIND_LABEL: Record<QuickSearchHit["kind"], string> = { matter: "Matter", document: "Document", person: "Person", task: "Task", event: "Event", workflow: "Workflow", library: "Library", office: "Office" };

/** Order sections by what a litigator reaches for first: matters, then documents, then people and the rest. */
const ORDER: QuickSearchHit["kind"][] = ["matter", "document", "office", "library", "person", "task", "event", "workflow"];

/** Group hits by kind so a mixed result list reads as sections; headings pluralise when a group has several rows. */
export function groupHits(hits: QuickSearchHit[]): { kind: QuickSearchHit["kind"]; label: string; hits: QuickSearchHit[] }[] {
  const by = new Map<QuickSearchHit["kind"], QuickSearchHit[]>();
  for (const h of hits) by.set(h.kind, [...(by.get(h.kind) ?? []), h]);
  return ORDER.filter((k) => by.has(k)).map((k) => ({ kind: k, label: KIND_LABEL[k] + (by.get(k)!.length === 1 ? "" : "s"), hits: by.get(k)! }));
}
