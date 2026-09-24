import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid max-w-[1280px] gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4"><Skeleton className="h-7 w-72" /><Skeleton className="h-4 w-[520px]" />{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}<Skeleton className="h-9 w-40" /></div>
      <div className="space-y-3"><Skeleton className="h-5 w-32" />{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7" />)}<Skeleton className="mt-4 h-5 w-32" />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div>
    </div>
  );
}
