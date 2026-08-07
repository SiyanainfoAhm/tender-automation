"use client";

import { compactTenderCount } from "@/lib/analytics/category-display";

type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | string;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  /** Prefer this payload field for the title when present. */
  titleKey?: string;
  /** Override title derived from label/payload. */
  formatTitle?: (args: {
    label?: string | number;
    payload?: Record<string, unknown>;
    name?: string;
  }) => string;
};

/**
 * Compact custom tooltip: title + "N tenders".
 * Avoids raw enum / DB field dumps from Recharts defaults.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  titleKey = "fullName",
  formatTitle,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const first = payload[0]!;
  const row = first.payload ?? {};
  const title =
    formatTitle?.({
      label,
      payload: row,
      name: first.name,
    }) ??
    (typeof row[titleKey] === "string"
      ? String(row[titleKey])
      : typeof label === "string" || typeof label === "number"
        ? String(label)
        : first.name || "Value");

  const value = Number(first.value ?? 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[13px] font-medium text-slate-900 dark:text-slate-50">
        {title}
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {compactTenderCount(value)}
      </p>
    </div>
  );
}
