import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex h-full">
      <div className="w-[268px] space-y-2 border-r p-3">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      <div className="relative flex-1 p-8"><div className="grid grid-cols-3 gap-10">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-[240px]" />)}</div></div>
      <div className="w-[400px] space-y-3 border-l p-3"><Skeleton className="h-7 w-40" /><Skeleton className="h-4 w-64" />{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
    </div>
  );
}
