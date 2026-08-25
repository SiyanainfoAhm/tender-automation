import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type CompactKpiCardProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  iconClassName: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

export function CompactKpiCard({
  label,
  value,
  icon: Icon,
  iconClassName,
  active = false,
  onClick,
  disabled = false,
}: CompactKpiCardProps) {
  const interactive = typeof onClick === "function";

  const className = cn(
    "rounded-lg border bg-card p-4 text-left transition-colors",
    active
      ? "border-primary-500 ring-2 ring-primary-500/20 bg-primary-50/40"
      : "border-border",
    interactive &&
      !disabled &&
      "cursor-pointer hover:border-foreground-300 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40",
    interactive && disabled && "cursor-not-allowed opacity-60",
  );

  const body = (
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
  );

  if (!interactive) {
    return <div className={className}>{body}</div>;
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`Filter tenders: ${label}`}
    >
      {body}
    </button>
  );
}
