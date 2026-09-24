import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="hidden p-4 xl:block"><Skeleton className="h-full w-full" /></div>
      <div className="space-y-3 border-l p-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-72" />{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
    </div>
  );
}
