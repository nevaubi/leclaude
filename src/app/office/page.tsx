import type { Metadata } from "next";
import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { OfficeKind } from "@/lib/types/domain";
import { OfficeHome } from "@/modules/office/home/office-home";
import { officeHomeData } from "@/modules/office/home/service";
import { KIND_META, OFFICE_KINDS } from "@/modules/office/home/types";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ kind?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { kind } = await searchParams;
  const k = kind && (OFFICE_KINDS as string[]).includes(kind) ? (kind as OfficeKind) : null;
  return { title: k ? `${KIND_META[k].plural} · Office` : "Office" };
}

/** Office home: /office?kind=word|sheet|slides|pdf */
export default async function Page({ searchParams }: Props) {
  const { kind } = await searchParams;
  const k = kind && (OFFICE_KINDS as string[]).includes(kind) ? (kind as OfficeKind) : null;
  const initial = officeHomeData();
  return (
    <React.Suspense fallback={<div className="space-y-4 p-6"><Skeleton className="h-8 w-72" /><div className="grid grid-cols-4 gap-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div><Skeleton className="h-64" /></div>}>
      <OfficeHome initial={initial} kind={k} />
    </React.Suspense>
  );
}
