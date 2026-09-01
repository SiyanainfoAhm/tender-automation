import { parseISO } from "date-fns";

import type { DashboardDateBasis, DashboardPeriod } from "@/lib/dashboard/time-range";
import { resolveDashboardPeriodYmdBounds } from "@/lib/tender-date-filter";

export type DashboardPeriodTenderRow = {
  first_seen_at: string | null;
  crawled_at: string | null;
  created_at: string | null;
  scraped_date: string | null;
};

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = parseISO(raw.length === 10 ? `${raw}T12:00:00+05:30` : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function tenderBasisDate(
  row: DashboardPeriodTenderRow,
  basis: DashboardDateBasis,
): Date | null {
  if (basis === "scraped") {
    return (
      parseDate(row.scraped_date) ||
      parseDate(row.first_seen_at) ||
      parseDate(row.crawled_at) ||
      parseDate(row.created_at)
    );
  }
  return (
    parseDate(row.created_at) ||
    parseDate(row.first_seen_at) ||
    parseDate(row.crawled_at) ||
    parseDate(row.scraped_date)
  );
}

function inRange(date: Date | null, from: Date, to: Date): boolean {
  if (!date) return false;
  const t = date.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

export function resolveDashboardPeriodBounds(
  period: DashboardPeriod,
  now = new Date(),
): { from: Date; to: Date; fromYmd: string; toYmd: string } {
  const { fromYmd, toYmd } = resolveDashboardPeriodYmdBounds(period, now);
  const from = new Date(`${fromYmd}T00:00:00+05:30`);
  const to = new Date(`${toYmd}T23:59:59.999+05:30`);
  return { from, to, fromYmd, toYmd };
}

/** Period filter used by Executive Dashboard summary stats (matches volume chart fallbacks). */
export function filterRowsForDashboardPeriod<T extends DashboardPeriodTenderRow>(
  rows: T[],
  options: {
    period: DashboardPeriod;
    dateBasis: DashboardDateBasis;
    now?: Date;
  },
): T[] {
  const { from, to } = resolveDashboardPeriodBounds(
    options.period,
    options.now,
  );
  return rows.filter((row) =>
    inRange(tenderBasisDate(row, options.dateBasis), from, to),
  );
}
