import { Skeleton } from "@/components/ui/skeleton";

export default function TenderDetailLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-3xl" />
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-10 w-full max-w-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-[14px]" />
        <Skeleton className="h-64 rounded-[14px]" />
      </div>
    </div>
  );
}
