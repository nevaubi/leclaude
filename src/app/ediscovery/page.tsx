import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import { MATTERS } from "@/lib/seed/ids";
import { Skeleton } from "@/components/ui/skeleton";
import { ReviewPage } from "@/modules/ediscovery/components/review-page";
import { REVIEW_TABS, type ReviewTab } from "@/modules/ediscovery/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "E-Discovery" };

export default async function Page({ searchParams }: { searchParams: Promise<{ matter?: string; tab?: string; doc?: string; person?: string; q?: string; view?: string; custodian?: string }> }) {
  const sp = await searchParams;
  const d = db();
  const counts = new Map<string, number>();
  for (const doc of d.edocs.all()) counts.set(doc.matterId, (counts.get(doc.matterId) ?? 0) + 1);
  const matters = d.matters
    .list({ where: (m) => m.status !== "closed" })
    .map((m) => ({ id: m.id, shortName: m.shortName, name: m.name, caption: m.caption, client: m.client, stage: m.stage, docCount: counts.get(m.id) ?? 0 }))
    .sort((a, b) => b.docCount - a.docCount || a.shortName.localeCompare(b.shortName));
  // A `?doc=` deep link (id or Bates) without `?matter=` opens in the document's own matter, not the default one.
  // The viewer and the list cursor work on document ids, so a Bates deep link is resolved to its id here.
  const linkedDoc = sp.doc ? d.edocs.get(sp.doc) ?? d.edocs.findOne((x) => x.bates.toLowerCase() === sp.doc!.toLowerCase()) : null;
  const requestedMatter = sp.matter ?? linkedDoc?.matterId;
  const matterId = requestedMatter && matters.some((m) => m.id === requestedMatter) ? requestedMatter : matters.find((m) => m.id === MATTERS.afff)?.id ?? matters[0]?.id ?? MATTERS.afff;
  // `?tab=` is canonical; `?view=timeline` is accepted for links created by the Home module.
  const requested = sp.tab ?? sp.view;
  const tab = (REVIEW_TABS.some((t) => t.id === requested) ? requested : "review") as ReviewTab;
  const reviewers = d.people
    .find((p) => p.organization === "Calloway & Reyes LLP" && (p.role === "attorney" || p.role === "paralegal" || p.role === "staff"))
    .map((p) => ({ id: p.id, name: p.name, title: p.title }));
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <ReviewPage
        matters={matters}
        initialMatterId={matterId}
        initialTab={tab}
        initialDocId={linkedDoc?.id ?? sp.doc}
        initialQuery={sp.q}
        initialCustodian={sp.custodian}
        aiConfigured={aiConfig().hasKey}
        reviewers={reviewers}
        currentUserId="p_jwhitfield"
      />
    </Suspense>
  );
}

function ReviewSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b px-4 py-3">
        <Skeleton className="h-5 w-96" />
        <div className="flex gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-28" />)}</div>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-60 space-y-2 border-r p-3">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        <div className="flex-1 space-y-1.5 p-3">{Array.from({ length: 18 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
      </div>
    </div>
  );
}
