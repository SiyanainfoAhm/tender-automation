import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-72 rounded-full" />
      </div>

      <Skeleton className="h-28 w-full rounded-2xl" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-2xl">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="size-10 rounded-xl" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="h-44 w-full rounded-2xl" />

      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-[320px] rounded-2xl xl:col-span-3" />
        <Skeleton className="h-[320px] rounded-2xl xl:col-span-2" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
