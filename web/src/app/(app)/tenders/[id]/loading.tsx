import { Skeleton } from "@/components/ui/skeleton";

export default function TenderDetailLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-44 rounded-lg" />
      <Skeleton className="h-9 w-72 rounded-lg" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-lg lg:col-span-2" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  );
}
