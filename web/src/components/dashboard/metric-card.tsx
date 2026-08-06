import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type MetricVariant =
  | "total"
  | "new"
  | "closing"
  | "go"
  | "verify"
  | "manual";

/** Icon container only — never apply variant colors to KPI text. */
export const metricIconVariants: Record<MetricVariant, string> = {
  total:
    "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  new:
    "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  closing:
    "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  go:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  verify:
    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  manual:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

/** @deprecated Use metricIconVariants */
export const metricVariants = Object.fromEntries(
  Object.entries(metricIconVariants).map(([key, iconContainer]) => [
    key,
    {
      iconContainer,
      value: "text-slate-950 dark:text-slate-50",
      label: "text-slate-700 dark:text-slate-200",
      hint: "text-slate-500 dark:text-slate-400",
    },
  ]),
) as Record<
  MetricVariant,
  { iconContainer: string; value: string; label: string; hint: string }
>;

type MetricCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  variant?: MetricVariant;
  trend?: string;
  loading?: boolean;
  className?: string;
};

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  variant = "total",
  trend,
  loading = false,
  className,
}: MetricCardProps) {
  const displayValue = loading ? "—" : value;

  return (
    <div
      className={cn(
        "metric-card overflow-hidden rounded-2xl p-6",
        "border border-slate-200 bg-white text-slate-950 shadow-sm",
        "dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50",
        "opacity-100",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "mb-5 flex size-12 items-center justify-center rounded-2xl",
            metricIconVariants[variant],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        {trend ? (
          <span className="kpi-hint text-xs font-medium opacity-100">{trend}</span>
        ) : null}
      </div>

      <div className="space-y-1">
        <div
          className={cn(
            "kpi-value text-3xl font-semibold tracking-tight text-slate-950 opacity-100 dark:text-slate-50",
            loading &&
              "animate-pulse text-slate-300 dark:text-slate-700",
          )}
        >
          {displayValue}
        </div>

        <div className="kpi-label text-sm font-semibold text-slate-700 opacity-100 dark:text-slate-200">
          {label}
        </div>

        {hint ? (
          <div className="kpi-hint text-sm text-slate-500 opacity-100 dark:text-slate-400">
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}
