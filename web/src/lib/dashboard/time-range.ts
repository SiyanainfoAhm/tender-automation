export const DASHBOARD_PERIODS = [
  "today",
  "week",
  "month",
  "quarter",
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  quarter: "This Quarter",
};

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = "month";

export const DASHBOARD_DATE_BASES = ["scraped", "created"] as const;

export type DashboardDateBasis = (typeof DASHBOARD_DATE_BASES)[number];

export const DASHBOARD_DATE_BASIS_LABELS: Record<DashboardDateBasis, string> = {
  scraped: "Scraped Date",
  created: "Created Date",
};

export const DEFAULT_DASHBOARD_DATE_BASIS: DashboardDateBasis = "scraped";

/** @deprecated Use DashboardPeriod — kept for tests migrating off 7d/30d keys. */
export type DashboardTimeRange = DashboardPeriod;

export const DASHBOARD_TIME_RANGES = DASHBOARD_PERIODS;
export const DASHBOARD_TIME_RANGE_LABELS = DASHBOARD_PERIOD_LABELS;
export const DEFAULT_DASHBOARD_TIME_RANGE = DEFAULT_DASHBOARD_PERIOD;

export function parseDashboardPeriod(
  raw: string | string[] | undefined | null,
): DashboardPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Back-compat with old query params
  if (value === "7d") return "week";
  if (value === "30d") return "month";
  if (value === "90d" || value === "1y") return "quarter";
  if (
    value &&
    (DASHBOARD_PERIODS as readonly string[]).includes(value)
  ) {
    return value as DashboardPeriod;
  }
  return DEFAULT_DASHBOARD_PERIOD;
}

export function parseDashboardTimeRange(
  raw: string | string[] | undefined | null,
): DashboardPeriod {
  return parseDashboardPeriod(raw);
}

export function parseDashboardDateBasis(
  raw: string | string[] | undefined | null,
): DashboardDateBasis {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    value &&
    (DASHBOARD_DATE_BASES as readonly string[]).includes(value)
  ) {
    return value as DashboardDateBasis;
  }
  return DEFAULT_DASHBOARD_DATE_BASIS;
}

/** Calendar-day span helper for legacy comparison helpers. */
export function dashboardRangeDays(period: DashboardPeriod): number {
  switch (period) {
    case "today":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
    case "quarter":
      return 90;
  }
}
