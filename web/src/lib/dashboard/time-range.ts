export const DASHBOARD_TIME_RANGES = ["7d", "30d", "90d", "1y"] as const;

export type DashboardTimeRange = (typeof DASHBOARD_TIME_RANGES)[number];

export const DASHBOARD_TIME_RANGE_LABELS: Record<DashboardTimeRange, string> = {
  "7d": "7 Days",
  "30d": "30 Days",
  "90d": "3 Months",
  "1y": "1 Year",
};

export const DEFAULT_DASHBOARD_TIME_RANGE: DashboardTimeRange = "30d";

export function parseDashboardTimeRange(
  raw: string | string[] | undefined | null,
): DashboardTimeRange {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    value &&
    (DASHBOARD_TIME_RANGES as readonly string[]).includes(value)
  ) {
    return value as DashboardTimeRange;
  }
  return DEFAULT_DASHBOARD_TIME_RANGE;
}

export function dashboardRangeDays(range: DashboardTimeRange): number {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "1y":
      return 365;
  }
}

/** Chart bucket size for the selected range. */
export function dashboardTrendGranularity(
  range: DashboardTimeRange,
): "day" | "week" | "month" {
  switch (range) {
    case "7d":
      return "day";
    case "30d":
    case "90d":
      return "week";
    case "1y":
      return "month";
  }
}
