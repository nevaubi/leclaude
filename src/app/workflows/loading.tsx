import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)}</div>
      <Skeleton className="h-[72px]" />
      <div className="flex gap-2"><Skeleton className="h-9 w-72" /><Skeleton className="ml-auto h-8 w-56" /></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[196px]" />)}</div>
    </div>
  );
}
