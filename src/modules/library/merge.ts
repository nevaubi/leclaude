import type { LibraryItem, OfficeDocument } from "@/lib/types/domain";
import { LIBRARY_FOLDERS, matterFolderId } from "./ids";
import { TYPE_BY_OFFICE_KIND } from "./types";

/**
 * Office documents are created by the editors (and by /api/office/docs) and
 * may not have a library entry, or may have one at the root (parentId null).
 * This pure planner decides which library rows to create or re-home so every
 * office document appears in the right matter folder. Idempotent.
 */
export interface MergePlan {
  create: LibraryItem[];
  update: { id: string; patch: Partial<LibraryItem> }[];
}

export function planOfficeDocMerge(officeDocs: Pick<OfficeDocument, "id" | "kind" | "title" | "matterId" | "folderId" | "createdAt" | "updatedAt" | "createdById" | "size" | "tags" | "contentVersion">[], items: LibraryItem[], opts: { existingFolderIds?: Set<string>; now?: string } = {}): MergePlan {
  const folderIds = opts.existingFolderIds ?? new Set(items.filter((i) => i.type === "folder").map((i) => i.id));
  const byDoc = new Map<string, LibraryItem>();
  for (const it of items) if (it.officeDocId && !byDoc.has(it.officeDocId)) byDoc.set(it.officeDocId, it);
  const plan: MergePlan = { create: [], update: [] };
  const homeFor = (doc: { matterId?: string; folderId?: string }) => {
    if (doc.folderId && folderIds.has(doc.folderId)) return doc.folderId;
    if (doc.matterId && folderIds.has(matterFolderId(doc.matterId))) return matterFolderId(doc.matterId);
    return folderIds.has(LIBRARY_FOLDERS.myFiles) ? LIBRARY_FOLDERS.myFiles : null;
  };
  for (const doc of officeDocs) {
    const existing = byDoc.get(doc.id);
    if (!existing) {
      plan.create.push({
        id: `lib_office_${doc.id}`,
        parentId: homeFor(doc),
        name: doc.title,
        type: TYPE_BY_OFFICE_KIND[doc.kind],
        matterId: doc.matterId,
        officeDocId: doc.id,
        size: doc.size,
        tags: doc.tags,
        ownerId: doc.createdById,
        sharedWith: doc.matterId ? ["matter-team"] : ["firm"],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        version: doc.contentVersion,
        status: "draft",
      });
      continue;
    }
    const patch: Partial<LibraryItem> = {};
    if (!existing.parentId) { const home = homeFor(doc); if (home) patch.parentId = home; }
    if (existing.name !== doc.title) patch.name = doc.title;
    if ((existing.matterId ?? undefined) !== (doc.matterId ?? undefined)) patch.matterId = doc.matterId;
    if (existing.updatedAt < doc.updatedAt) { patch.updatedAt = doc.updatedAt; patch.size = doc.size; patch.version = doc.contentVersion; }
    if (Object.keys(patch).length) plan.update.push({ id: existing.id, patch });
  }
  return plan;
}

/** Library rows whose office document no longer exists (deleted outside the library). */
export function orphanedOfficeEntries(officeDocIds: Set<string>, items: LibraryItem[]) {
  return items.filter((i) => i.officeDocId && !officeDocIds.has(i.officeDocId));
}
