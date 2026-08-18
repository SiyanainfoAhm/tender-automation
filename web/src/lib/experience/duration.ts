import { differenceInCalendarMonths, isValid, parseISO } from "date-fns";

import type { CompanyExperience } from "@/lib/experience/types";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(value);
  return isValid(date) ? date : null;
}

export function monthsBetween(
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
): number | null {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end || end < start) return null;
  return Math.max(0, differenceInCalendarMonths(end, start));
}

export function experienceDurationMonths(
  item: Pick<
    CompanyExperience,
    "startDate" | "endDate" | "projectStatus" | "durationMonths"
  >,
  now = new Date(),
): number | null {
  if (item.projectStatus === "completed") {
    return monthsBetween(item.startDate, item.endDate) ?? item.durationMonths;
  }
  return monthsBetween(item.startDate, now) ?? item.durationMonths;
}

export function formatDurationMonths(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(months)) return "—";
  const n = Math.max(0, Math.round(months));
  if (n <= 0) return "<1 month";
  if (n === 1) return "1 month";
  return `${n} months`;
}
