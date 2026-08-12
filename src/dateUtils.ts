/** Local system date helpers (Windows-friendly, no UTC conversion). */

export function getLocalDateParts(date: Date = new Date()): {
  year: string;
  month: string;
  day: string;
  hours: string;
  minutes: string;
  seconds: string;
} {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    year: String(date.getFullYear()),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hours: pad(date.getHours()),
    minutes: pad(date.getMinutes()),
    seconds: pad(date.getSeconds()),
  };
}

/**
 * YYYY-MM-DD for Asia/Kolkata (IST). Prefer this for business/run dates.
 * Falls back to local system calendar when Intl is unavailable.
 */
export function getIndiaTodayIsoDate(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // fall through
  }
  return getTodayIsoDate(now);
}

/** YYYY-MM-DD using local system date */
export function getTodayIsoDate(date: Date = new Date()): string {
  const { year, month, day } = getLocalDateParts(date);
  return `${year}-${month}-${day}`;
}

/** DD-MM-YYYY using local system date (Tender247 dashboard card format). */
export function getTodayDisplayDateDdMmYyyy(date: Date = new Date()): string {
  const { year, month, day } = getLocalDateParts(date);
  return `${day}-${month}-${year}`;
}

/** Convert YYYY-MM-DD → DD-MM-YYYY (Tender247 filtered-tab / mail-date label). */
export function formatIsoToDdMmYyyy(isoDate: string): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}; expected YYYY-MM-DD`);
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Convert YYYY-MM-DD → DD/MM/YYYY (Tender247 Select Mail Date input display). */
export function formatIsoToDdMmYyyySlash(isoDate: string): string {
  return formatIsoToDdMmYyyy(isoDate).replace(/-/g, "/");
}

/**
 * Parse a Tender247 mail-date display string into YYYY-MM-DD.
 * Accepts 11/08/2026, 11-08-2026, and ISO.
 */
export function parseMailDateDisplayToIso(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, "0");
    const month = dmy[2]!.padStart(2, "0");
    const year = dmy[3]!;
    return `${year}-${month}-${day}`;
  }
  return null;
}

export type IsoDateParts = {
  year: number;
  month: number;
  day: number;
  monthName: string;
  iso: string;
  ddMmYyyy: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Parse YYYY-MM-DD into calendar parts for Tender247 mail-date selection. */
export function parseIsoDateParts(isoDate: string): IsoDateParts {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}; expected YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    !Number.isFinite(year)
  ) {
    throw new Error(`Invalid calendar date: ${isoDate}`);
  }
  return {
    year,
    month,
    day,
    monthName: MONTH_NAMES[month - 1]!,
    iso: `${match[1]}-${match[2]}-${match[3]}`,
    ddMmYyyy: `${match[3]}-${match[2]}-${match[1]}`,
  };
}

/** Compact timestamp for screenshot filenames: YYYY-MM-DD_HH-MM-SS */
export function getLocalTimestamp(date: Date = new Date()): string {
  const { year, month, day, hours, minutes, seconds } = getLocalDateParts(date);
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = (seconds % 60).toFixed(0);
  return `${minutes}m ${rem}s`;
}
