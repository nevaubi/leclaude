/** Pure mapping between library filters and Filterbar values (no React; unit-tested). */
import type { FilterValues } from "@/components/ui/filterbar-helpers";
import type { LibraryFilters } from "../types";

export const LIBRARY_FILTER_IDS = ["type", "matterId", "status", "practiceArea", "ownerId", "tag", "from", "to"] as const;

/** Library filters → Filterbar values (single-value chips; empty strings are dropped). */
export function filterValuesFrom(filters: LibraryFilters): FilterValues {
  const out: FilterValues = {};
  for (const id of LIBRARY_FILTER_IDS) { const v = filters[id]; if (v) out[id] = String(v); }
  return out;
}

/** Filterbar values → a LibraryFilters patch (every known key present so cleared chips clear the filter). */
export function filtersPatchFrom(values: FilterValues): Partial<LibraryFilters> {
  const patch: Record<string, string | undefined> = {};
  for (const id of LIBRARY_FILTER_IDS) { const v = values[id]; patch[id] = Array.isArray(v) ? v[0] : v || undefined; }
  return patch as Partial<LibraryFilters>;
}
