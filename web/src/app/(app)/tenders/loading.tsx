import { TenderExplorerSkeleton } from "./tender-explorer";

export default function TendersLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-5 w-48 animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] animate-pulse rounded-lg bg-surface-muted"
          />
        ))}
      </div>
      <TenderExplorerSkeleton />
    </div>
  );
}
