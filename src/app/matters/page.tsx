import type { Metadata } from "next";
import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MattersPage } from "@/modules/matters/components/matters-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Matters" };

/** Matters: /matters?id=<matterId>&new=1. Data loads through the authorized /api/matters routes. */
export default function Page() {
  return (
    <React.Suspense fallback={<div className="space-y-2 p-3"><Skeleton className="h-9" /><Skeleton className="h-64" /></div>}>
      <MattersPage />
    </React.Suspense>
  );
}
