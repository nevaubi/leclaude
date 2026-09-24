import type { LibraryItemType, PracticeArea } from "@/lib/types/domain";
import type { LibraryFilters, LibrarySort, LibraryView } from "./types";

export const LIBRARY_VIEWS: LibraryView[] = ["folder", "starred", "recent", "shared", "all"];
export const LIBRARY_SORTS: LibrarySort[] = ["name", "updated", "created", "size", "type"];

/** Parse list/search filters from a query string (shared by the API routes and the client URL state). */
export function parseFilters(sp: URLSearchParams): LibraryFilters {
  const view = sp.get("view") as LibraryView | null;
  const sort = sp.get("sort") as LibrarySort | null;
  const dir = sp.get("dir");
  return {
    view: view && LIBRARY_VIEWS.includes(view) ? view : "folder",
    folder: sp.get("folder") || null,
    matterId: sp.get("matter") || undefined,
    type: (sp.get("type") as LibraryItemType | "office" | null) || undefined,
    practiceArea: (sp.get("practiceArea") as PracticeArea | null) || undefined,
    tag: sp.get("tag") || undefined,
    ownerId: sp.get("owner") || undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    q: sp.get("q") || undefined,
    status: (sp.get("status") as LibraryFilters["status"]) || undefined,
    sort: sort && LIBRARY_SORTS.includes(sort) ? sort : undefined,
    dir: dir === "asc" || dir === "desc" ? dir : undefined,
  };
}

/** Serialize filters back to query params (omits defaults). */
export function filtersToParams(f: LibraryFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.view && f.view !== "folder") sp.set("view", f.view);
  if (f.folder) sp.set("folder", f.folder);
  if (f.matterId) sp.set("matter", f.matterId);
  if (f.type) sp.set("type", f.type);
  if (f.practiceArea) sp.set("practiceArea", f.practiceArea);
  if (f.tag) sp.set("tag", f.tag);
  if (f.ownerId) sp.set("owner", f.ownerId);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (f.q) sp.set("q", f.q);
  if (f.status) sp.set("status", f.status);
  if (f.sort) sp.set("sort", f.sort);
  if (f.dir) sp.set("dir", f.dir);
  return sp;
}

export function activeFilterCount(f: LibraryFilters) {
  return [f.type, f.matterId, f.practiceArea, f.tag, f.ownerId, f.from, f.to, f.status].filter(Boolean).length;
}
