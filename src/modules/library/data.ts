import "server-only";
import { db } from "@/lib/db";
import type { LibraryItem } from "@/lib/types/domain";
import type { ActivityEntry, ClauseMeta, LibraryItemVersion } from "./types";

/** Module-private collections. */
export const LIBRARY_COLLECTIONS = {
  clauseMeta: "library_clause_meta",
  activity: "library_activity",
  versions: "library_versions",
} as const;

export const clauseMetaCollection = () => db().collection<ClauseMeta>(LIBRARY_COLLECTIONS.clauseMeta);
export const activityCollection = () => db().collection<ActivityEntry>(LIBRARY_COLLECTIONS.activity);
export const versionsCollection = () => db().collection<LibraryItemVersion>(LIBRARY_COLLECTIONS.versions);

/** Text used for the search index of a library item. */
export function indexTextFor(i: LibraryItem) {
  return [i.name, i.description ?? "", i.content ?? "", (i.tags ?? []).join(", "), i.url ?? ""].filter(Boolean).join("\n");
}
