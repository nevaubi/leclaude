/** Pure helpers for the review rail (unit-tested; no React). */
import type { SearchFilters } from "../types";

/** Number of active facet values across every facet key. */
export function activeFacetCount(filters: SearchFilters): number {
  return Object.values(filters).reduce((n, v) => n + (v?.length ?? 0), 0);
}
