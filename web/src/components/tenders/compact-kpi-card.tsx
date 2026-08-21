import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type CompactKpiCardProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  iconClassName: string;
};

export function CompactKpiCard({
  label,
  value,
  icon: Icon,
  iconClassName,
}: CompactKpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            iconClassName,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-tight text-foreground-900">
            {value}
          </p>
          <p className="truncate text-xs text-foreground-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
