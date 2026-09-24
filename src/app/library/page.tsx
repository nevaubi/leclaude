import type { Metadata } from "next";
import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LibraryPage } from "@/modules/library/components/library-page";
import type { LibraryInitialData } from "@/modules/library/components/library-provider";
import { listItems, treeResponse } from "@/modules/library/service";
import { parseFilters } from "@/modules/library/filters";
import { matterFolderId } from "@/modules/library/ids";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Library" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Library: /library?folder=<id>&item=<id>&matter=<id>&view=starred|recent|shared&q=… */
export default async function Page({ searchParams }: Props) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const filters = parseFilters(sp);
  // `?matter=` alone opens the matter folder (the client mirrors this in the URL).
  if (filters.matterId && !filters.folder && filters.view === "folder" && !filters.q) { filters.folder = matterFolderId(filters.matterId); filters.matterId = undefined; }
  const tree = treeResponse();
  const list = filters.q ? null : listItems(filters);
  const initial: LibraryInitialData = { tree, list, aiConfigured: tree.aiConfigured };
  return (
    <React.Suspense fallback={<div className="flex h-full"><Skeleton className="m-3 w-60" /><div className="flex-1 space-y-3 p-3"><Skeleton className="h-10" /><Skeleton className="h-64" /></div></div>}>
      <LibraryPage initial={initial} />
    </React.Suspense>
  );
}
