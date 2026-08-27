/**
 * Tender Management scrape/source-date presets in Asia/Kolkata.
 * Filters a SQL `date` column (scraped_date), not created_at or deadline.
 */

export const APP_TIME_ZONE = "Asia/Kolkata";
export const APP_TZ_OFFSET = "+05:30";
export const TENDER_DATE_FILTER_FIELD = "scraped_date";

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
  custom: "Custom Range",
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function normalizeDatePreset(
  value: string | null | undefined,
): CreatedDatePreset | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return isCreatedDatePreset(normalized) ? normalized : undefined;
}

export function isCreatedDatePreset(
  value: string | null | undefined,
): value is CreatedDatePreset {
  return Boolean(
    value && (CREATED_DATE_PRESETS as readonly string[]).includes(value),
  );
}

export function isIsoCalendarDate(
  value: string | null | undefined,
): value is string {
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

function daysFromMonday(ymd: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
  }).format(atNoonIst(ymd));
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[weekday] ?? 0;
}

export function formatIsoCalendarDate(ymd: string): string {
  const match = ymd.match(YMD_RE);
  if (!match) return "—";
  const year = match[1];
  const month = match[2];
  const day = match[3];
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function formatCompactAppDate(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  if (typeof value === "string") {
    const ymd = value.trim().slice(0, 10);
    if (YMD_RE.test(ymd) && (value.length === 10 || value[10] === "T" || value[10] === " ")) {
      return formatIsoCalendarDate(ymd);
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatIsoCalendarDate(calendarDateInAppTz(date));
}

export function formatAppDateTimeTooltip(
  value: string | Date | null | undefined,
): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && YMD_RE.test(value.trim())) {
    return formatIsoCalendarDate(value.trim());
  }
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

export type ScrapedDateFilter =
  | { mode: "eq"; value: string }
  | { mode: "range"; gte: string; lte: string };

export function resolveScrapedDateFilter(options: {
  preset?: string | null;
  selectedDate?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): ScrapedDateFilter | null {
  const preset = normalizeDatePreset(options.preset);
  const now = options.now ?? new Date();
  const today = calendarDateInAppTz(now);

  if (!preset) {
    const from = options.from?.trim();
    const to = options.to?.trim();
    if (isIsoCalendarDate(from) && isIsoCalendarDate(to)) {
      return { mode: "range", gte: from, lte: to };
    }
    if (isIsoCalendarDate(from) && !to) return { mode: "eq", value: from };
    if (isIsoCalendarDate(to) && !from) return { mode: "eq", value: to };
    return null;
  }

  switch (preset) {
    case "today":
      return { mode: "eq", value: today };
    case "yesterday":
      return { mode: "eq", value: shiftYmd(today, -1) };
    case "this_week": {
      const monday = shiftYmd(today, -daysFromMonday(today));
      return { mode: "range", gte: monday, lte: today };
    }
    case "last_week": {
      const thisMonday = shiftYmd(today, -daysFromMonday(today));
      return {
        mode: "range",
        gte: shiftYmd(thisMonday, -7),
        lte: shiftYmd(thisMonday, -1),
      };
    }
    case "this_month":
      return { mode: "range", gte: `${today.slice(0, 7)}-01`, lte: today };
    case "last_month": {
      const thisMonthStart = atNoonIst(`${today.slice(0, 7)}-01`);
      const lastMonthAnchor = new Date(thisMonthStart.getTime() - 86_400_000);
      const lastMonthYmd = calendarDateInAppTz(lastMonthAnchor);
      return {
        mode: "range",
        gte: `${lastMonthYmd.slice(0, 7)}-01`,
        lte: lastMonthYmd,
      };
    }
    case "custom": {
      const from = options.from?.trim() || options.selectedDate?.trim();
      const to = options.to?.trim() || options.selectedDate?.trim();
      if (isIsoCalendarDate(from) && isIsoCalendarDate(to)) {
        if (from === to) return { mode: "eq", value: from };
        return { mode: "range", gte: from, lte: to };
      }
      if (isIsoCalendarDate(from)) return { mode: "eq", value: from };
      if (isIsoCalendarDate(to)) return { mode: "eq", value: to };
      return null;
    }
    default:
      return null;
  }
}

/**
 * Asia/Kolkata calendar YMD bounds for Executive Dashboard periods.
 */
export function resolveDashboardPeriodYmdBounds(
  period: "today" | "week" | "month" | "quarter",
  now = new Date(),
): { fromYmd: string; toYmd: string } {
  const today = calendarDateInAppTz(now);
  switch (period) {
    case "today":
      return { fromYmd: today, toYmd: today };
    case "week": {
      const monday = shiftYmd(today, -daysFromMonday(today));
      return { fromYmd: monday, toYmd: today };
    }
    case "month":
      return { fromYmd: `${today.slice(0, 7)}-01`, toYmd: today };
    case "quarter": {
      const month = Number(today.slice(5, 7));
      const year = today.slice(0, 4);
      const qStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      const fromYmd = `${year}-${String(qStartMonth).padStart(2, "0")}-01`;
      return { fromYmd, toYmd: today };
    }
  }
}

/**
 * Resolve Created Date filter bounds for `created_at` (timestamptz).
 * Distinct from scraped_date / published_date.
 */
export function resolveCreatedAtFilter(options: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  selectedDate?: string | null;
  now?: Date;
}): { gte?: string; lte?: string } | null {
  const preset = normalizeDatePreset(options.preset);
  if (!preset) return null;

  const now = options.now ?? new Date();
  const today = calendarDateInAppTz(now);

  const dayStart = (ymd: string) => `${ymd}T00:00:00${APP_TZ_OFFSET}`;
  const dayEnd = (ymd: string) => `${ymd}T23:59:59.999${APP_TZ_OFFSET}`;

  switch (preset) {
    case "today":
      return { gte: dayStart(today), lte: dayEnd(today) };
    case "yesterday": {
      const y = shiftYmd(today, -1);
      return { gte: dayStart(y), lte: dayEnd(y) };
    }
    case "this_week": {
      const monday = shiftYmd(today, -daysFromMonday(today));
      return { gte: dayStart(monday), lte: dayEnd(today) };
    }
    case "last_week": {
      const thisMonday = shiftYmd(today, -daysFromMonday(today));
      return {
        gte: dayStart(shiftYmd(thisMonday, -7)),
        lte: dayEnd(shiftYmd(thisMonday, -1)),
      };
    }
    case "this_month":
      return { gte: dayStart(`${today.slice(0, 7)}-01`), lte: dayEnd(today) };
    case "last_month": {
      const thisMonthStart = atNoonIst(`${today.slice(0, 7)}-01`);
      const lastMonthAnchor = new Date(thisMonthStart.getTime() - 86_400_000);
      const lastMonthYmd = calendarDateInAppTz(lastMonthAnchor);
      return {
        gte: dayStart(`${lastMonthYmd.slice(0, 7)}-01`),
        lte: dayEnd(lastMonthYmd),
      };
    }
    case "custom": {
      const from = options.from?.trim() || options.selectedDate?.trim();
      const to = options.to?.trim() || options.selectedDate?.trim();
      if (!isIsoCalendarDate(from) && !isIsoCalendarDate(to)) return null;
      const result: { gte?: string; lte?: string } = {};
      if (isIsoCalendarDate(from)) result.gte = dayStart(from);
      if (isIsoCalendarDate(to)) result.lte = dayEnd(to);
      return result;
    }
    default:
      return null;
  }
}

/** Closing date (SQL `date`) preset / custom range. */
export function resolveClosingDateFilter(options: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): ScrapedDateFilter | null {
  const preset = normalizeDatePreset(options.preset);
  if (!preset) {
    // Custom range without a preset name (from/to only).
    const from = options.from?.trim();
    const to = options.to?.trim();
    if (isIsoCalendarDate(from) || isIsoCalendarDate(to)) {
      if (isIsoCalendarDate(from) && isIsoCalendarDate(to)) {
        return { mode: "range", gte: from, lte: to };
      }
      if (isIsoCalendarDate(from) && !to) return { mode: "eq", value: from };
      if (isIsoCalendarDate(to) && !from) return { mode: "eq", value: to };
    }
    return null;
  }

  const now = options.now ?? new Date();
  const today = calendarDateInAppTz(now);

  switch (preset) {
    case "today":
      return { mode: "eq", value: today };
    case "yesterday":
      return { mode: "eq", value: shiftYmd(today, -1) };
    case "this_week": {
      const monday = shiftYmd(today, -daysFromMonday(today));
      return { mode: "range", gte: monday, lte: today };
    }
    case "last_week": {
      const thisMonday = shiftYmd(today, -daysFromMonday(today));
      return {
        mode: "range",
        gte: shiftYmd(thisMonday, -7),
        lte: shiftYmd(thisMonday, -1),
      };
    }
    case "this_month":
      return { mode: "range", gte: `${today.slice(0, 7)}-01`, lte: today };
    case "last_month": {
      const thisMonthStart = atNoonIst(`${today.slice(0, 7)}-01`);
      const lastMonthAnchor = new Date(thisMonthStart.getTime() - 86_400_000);
      const lastMonthYmd = calendarDateInAppTz(lastMonthAnchor);
      return {
        mode: "range",
        gte: `${lastMonthYmd.slice(0, 7)}-01`,
        lte: lastMonthYmd,
      };
    }
    case "custom": {
      const from = options.from?.trim();
      const to = options.to?.trim();
      if (isIsoCalendarDate(from) && isIsoCalendarDate(to)) {
        return { mode: "range", gte: from, lte: to };
      }
      if (isIsoCalendarDate(from)) return { mode: "eq", value: from };
      if (isIsoCalendarDate(to)) return { mode: "eq", value: to };
      return null;
    }
    default:
      return null;
  }
}
