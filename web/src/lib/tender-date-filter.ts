/**
 * Tender list created/imported date presets in the application timezone.
 * Boundaries are IST calendar days — not UTC midnight.
 */

export const APP_TIME_ZONE = "Asia/Kolkata";
export const APP_TZ_OFFSET = "+05:30";

export const CREATED_DATE_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "custom",
] as const;

export type CreatedDatePreset = (typeof CREATED_DATE_PRESETS)[number];

export const CREATED_DATE_PRESET_LABELS: Record<CreatedDatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  custom: "Select Date",
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCreatedDatePreset(
  value: string | null | undefined,
): value is CreatedDatePreset {
  return Boolean(
    value && (CREATED_DATE_PRESETS as readonly string[]).includes(value),
  );
}

export function isIsoCalendarDate(value: string | null | undefined): value is string {
  return Boolean(value && YMD_RE.test(value));
}

export function calendarDateInAppTz(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function atNoonIst(ymd: string): Date {
  return new Date(`${ymd}T12:00:00${APP_TZ_OFFSET}`);
}

function shiftYmd(ymd: string, days: number): string {
  const shifted = new Date(atNoonIst(ymd).getTime() + days * 86_400_000);
  return calendarDateInAppTz(shifted);
}

export function dayStartIso(ymd: string): string {
  return `${ymd}T00:00:00.000${APP_TZ_OFFSET}`;
}

export function dayEndIso(ymd: string): string {
  return `${ymd}T23:59:59.999${APP_TZ_OFFSET}`;
}

export function formatCompactAppDate(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const year = parts.find((p) => p.type === "year")?.value;
  if (!day || !month || !year) return "—";
  return `${Number(day)} ${month} ${year}`;
}

export function formatAppDateTimeTooltip(
  value: string | Date | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export type CreatedDateRange = {
  from: string;
  to: string;
};

export function resolveCreatedDateRange(options: {
  preset?: string | null;
  selectedDate?: string | null;
  now?: Date;
}): CreatedDateRange | null {
  const preset = options.preset;
  if (!preset || !isCreatedDatePreset(preset)) return null;

  const now = options.now ?? new Date();
  const today = calendarDateInAppTz(now);
  const nowIso = now.toISOString();

  switch (preset) {
    case "today":
      return { from: dayStartIso(today), to: dayEndIso(today) };
    case "yesterday": {
      const ymd = shiftYmd(today, -1);
      return { from: dayStartIso(ymd), to: dayEndIso(ymd) };
    }
    case "this_week": {
      const todayDate = atNoonIst(today);
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: APP_TIME_ZONE,
        weekday: "short",
      }).format(todayDate);
      const daysFromMonday: Record<string, number> = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6,
      };
      const offset = daysFromMonday[weekday] ?? 0;
      const monday = shiftYmd(today, -offset);
      return { from: dayStartIso(monday), to: nowIso };
    }
    case "last_week": {
      const todayDate = atNoonIst(today);
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: APP_TIME_ZONE,
        weekday: "short",
      }).format(todayDate);
      const daysFromMonday: Record<string, number> = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6,
      };
      const offset = daysFromMonday[weekday] ?? 0;
      const thisMonday = shiftYmd(today, -offset);
      const lastMonday = shiftYmd(thisMonday, -7);
      const lastSunday = shiftYmd(thisMonday, -1);
      return { from: dayStartIso(lastMonday), to: dayEndIso(lastSunday) };
    }
    case "this_month": {
      const monthStart = `${today.slice(0, 7)}-01`;
      return { from: dayStartIso(monthStart), to: nowIso };
    }
    case "last_month": {
      const thisMonthStart = atNoonIst(`${today.slice(0, 7)}-01`);
      const lastMonthAnchor = new Date(
        thisMonthStart.getTime() - 86_400_000,
      );
      const lastMonthYmd = calendarDateInAppTz(lastMonthAnchor);
      const lastMonthStart = `${lastMonthYmd.slice(0, 7)}-01`;
      const lastMonthEnd = lastMonthYmd;
      return {
        from: dayStartIso(lastMonthStart),
        to: dayEndIso(lastMonthEnd),
      };
    }
    case "custom": {
      const selected = options.selectedDate?.trim();
      if (!isIsoCalendarDate(selected)) return null;
      return { from: dayStartIso(selected), to: dayEndIso(selected) };
    }
    default:
      return null;
  }
}
