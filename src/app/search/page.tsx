import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import { listRuns, listSavedSearches } from "@/modules/search/service";
import { SearchPage } from "@/modules/search/components/search-page";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; tool?: string }> }) {
  const sp = await searchParams;
  const d = db();
  const matters = d.matters.list({ where: (m) => m.status !== "closed", sortBy: "shortName" }).map((m) => ({ id: m.id, shortName: m.shortName, name: m.name, caption: m.caption }));
  const saved = listSavedSearches();
  const runs = listRuns(40);
  const me = d.people.get("p_jwhitfield");
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchPage initialQuery={sp.q ?? ""} initialTool={sp.tool} saved={saved} runs={runs} matters={matters} aiConfigured={aiConfig().hasKey} userName={me?.name ?? "Jordan Whitfield"} />
    </Suspense>
  );
}

function SearchSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-8 space-y-4">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="flex gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-24 rounded-full" />)}</div>
      <div className="grid gap-6 pt-6 lg:grid-cols-2">
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      </div>
    </div>
  );
}
