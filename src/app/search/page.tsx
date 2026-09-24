import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import { listRuns, listSavedSearches } from "@/modules/search/service";
import { listThreadSummaries } from "@/modules/search/engine/threads";
import { ResearchPage } from "@/modules/search/components/research-page";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; tool?: string; thread?: string }> }) {
  const sp = await searchParams;
  const d = db();
  const matters = d.matters.list({ where: (m) => m.status !== "closed", sortBy: "shortName" }).map((m) => ({ id: m.id, shortName: m.shortName, name: m.name, caption: m.caption }));
  const saved = listSavedSearches();
  const runs = listRuns(30);
  const threads = listThreadSummaries(40);
  const me = d.people.get("p_jwhitfield");
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <ResearchPage initialQuery={sp.q ?? ""} initialTool={sp.tool} initialThreadId={sp.thread} saved={saved} runs={runs} threads={threads} matters={matters} aiConfigured={aiConfig().hasKey} userName={me?.name ?? "Jordan Whitfield"} />
    </Suspense>
  );
}

function SearchSkeleton() {
  return (
    <div className="flex h-full">
      <div className="hidden w-[248px] shrink-0 border-r p-3 lg:block"><Skeleton className="h-8 w-full" /><div className="mt-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div></div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[760px] flex-1 px-6 pt-16"><Skeleton className="h-3 w-32" /><Skeleton className="mt-2 h-7 w-2/3" /><Skeleton className="mt-2 h-4 w-full" /></div>
        <div className="mx-auto w-full max-w-[760px] px-4 pb-4"><Skeleton className="h-24 w-full rounded-2xl" /></div>
      </div>
      <div className="hidden w-[380px] shrink-0 border-l md:block" />
    </div>
  );
}
