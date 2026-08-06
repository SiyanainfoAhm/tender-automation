import { TenderExplorerSkeleton } from "./tender-explorer";

export default function TendersLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-surface-muted" />
      </div>
      <TenderExplorerSkeleton />
    </div>
  );
}
