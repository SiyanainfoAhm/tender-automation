import { Skeleton } from "@/components/ui/skeleton";

export default function BidWorkspaceLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-40 rounded-lg" />
      <Skeleton className="h-9 w-80 rounded-lg" />
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
