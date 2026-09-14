import {
  differenceInCalendarDays,
  format,
  startOfDay,
  parseISO,
  isValid,
} from "date-fns";

export type DeadlineMeta = {
  dateLabel: string;
  relativeLabel: string;
  relativeClassName: string;
  isClosed: boolean;
};

function parseClosing(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(value);
  return isValid(date) ? date : null;
}

/** Calendar days until closing. Negative = closed. Null = no deadline. */
export function getCalendarDaysUntilDeadline(
  closingDate: string | Date | null | undefined,
  now = new Date(),
): number | null {
  const date = parseClosing(closingDate);
  if (!date) return null;
  return differenceInCalendarDays(startOfDay(date), startOfDay(now));
}

export function getDeadlineMeta(
  closingDate: string | Date | null | undefined,
  now = new Date(),
): DeadlineMeta {
  const date = parseClosing(closingDate);
  if (!date) {
    return {
      dateLabel: "—",
      relativeLabel: "",
      relativeClassName: "text-foreground-400",
      isClosed: false,
    };
  }

  const dateLabel = format(date, "dd MMM yyyy");
  const days = differenceInCalendarDays(startOfDay(date), startOfDay(now));

  if (days < 0) {
    return {
      dateLabel,
      relativeLabel: "Expired",
      relativeClassName: "text-rose-600 font-medium",
      isClosed: true,
    };
  }
  if (days === 0) {
    return {
      dateLabel,
      relativeLabel: "Due Today",
      relativeClassName: "text-rose-600 font-medium",
      isClosed: false,
    };
  }

  const relativeLabel = days === 1 ? "1 Day Left" : `${days} Days Left`;
  if (days <= 3) {
    return {
      dateLabel,
      relativeLabel,
      relativeClassName: "text-rose-600 font-medium",
      isClosed: false,
    };
  }
  if (days <= 7) {
    return {
      dateLabel,
      relativeLabel,
      relativeClassName: "text-amber-600 font-medium",
      isClosed: false,
    };
  }
  return {
    dateLabel,
    relativeLabel,
    relativeClassName: "text-foreground-500",
    isClosed: false,
  };
}

export function confidenceToPercent(
  value: number | null | undefined,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const normalized = value <= 1 ? value * 100 : value;
  if (!Number.isFinite(normalized)) return null;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

export function matchScoreClass(percent: number): string {
  if (percent >= 80) return "bg-emerald-500";
  if (percent >= 60) return "bg-amber-500";
  return "bg-rose-500";
}

export function matchScoreTextClass(percent: number): string {
  if (percent >= 80) return "text-emerald-700";
  if (percent >= 60) return "text-amber-700";
  return "text-rose-700";
}
