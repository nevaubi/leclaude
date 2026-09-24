/** Pure helpers for the workflows gallery (tested without React). */
import type { WorkflowListItem } from "../../types";

/** Filter a list by the gallery's search term and category chip. */
export function filterWorkflows(list: WorkflowListItem[], term: string, category: string): WorkflowListItem[] {
  const t = term.trim().toLowerCase();
  return list.filter((w) => (!category || w.category === category) && (!t || `${w.name} ${w.description ?? ""} ${(w.tags ?? []).join(" ")}`.toLowerCase().includes(t)));
}

/** Start page for a workflow with a front end; the builder's run dialog otherwise. */
export function startHref(w: Pick<WorkflowListItem, "id" | "hasFrontend">): string {
  return w.hasFrontend ? `/workflows/${w.id}/start` : `/workflows/${w.id}?run=1`;
}
