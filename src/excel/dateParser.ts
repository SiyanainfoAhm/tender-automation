import { cleanCell } from "./types.js";

export interface DateParseResult {
  value: string;
  parsed: boolean;
  warning?: string;
}

/**
 * Normalize tender dates to YYYY-MM-DD when safely possible.
 * Supports Excel serials, Date objects, DD-MM-YYYY, DD/MM/YYYY, "20 Jul 2026", ISO.
 */
export function parseDateToIso(value: unknown): DateParseResult {
  if (value === null || value === undefined) {
    return { value: "", parsed: true };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { value: "", parsed: false, warning: "Invalid Date object" };
    }
    return { value: formatLocalIso(value), parsed: true };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const fromSerial = excelSerialToDate(value);
    if (fromSerial) {
      return { value: formatLocalIso(fromSerial), parsed: true };
    }
    return {
      value: String(value),
      parsed: false,
      warning: `Unrecognized numeric date serial: ${value}`,
    };
  }

  const raw = cleanCell(value);
  if (!raw) {
    return { value: "", parsed: true };
  }

  // Already ISO-like
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return { value: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, parsed: true };
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) {
      year += 2000;
    }
    if (isValidYmd(year, month, day)) {
      return {
        value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        parsed: true,
      };
    }
  }

  // 20 Jul 2026 / 20-Jul-2026
  const named = raw.match(
    /^(\d{1,2})[ \-]([A-Za-z]{3,9})[ \-](\d{2,4})$/,
  );
  if (named) {
    const day = Number(named[1]);
    const month = monthNameToNumber(named[2] ?? "");
    let year = Number(named[3]);
    if (year < 100) {
      year += 2000;
    }
    if (month && isValidYmd(year, month, day)) {
      return {
        value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        parsed: true,
      };
    }
  }

  // Last resort: Date.parse (may be locale-ambiguous — only accept if clear)
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return { value: formatLocalIso(date), parsed: true };
  }

  return {
    value: raw,
    parsed: false,
    warning: `Could not safely parse date "${raw}"; retained original text`,
  };
}

function excelSerialToDate(serial: number): Date | undefined {
  // Excel serial date (1900 date system). Ignore tiny integers that are not dates.
  if (serial < 20000 || serial > 80000) {
    // Still allow modern tender dates (~2000+)
    if (serial < 3000 || serial > 100000) {
      return undefined;
    }
  }
  // SheetJS / Excel: days since 1899-12-30
  const utc = Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
}

function formatLocalIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  // Prefer local calendar components when the Date was constructed locally
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== date.getUTCMonth() ||
    date.getDate() !== date.getUTCDate()
  ) {
    const ly = date.getFullYear();
    const lm = String(date.getMonth() + 1).padStart(2, "0");
    const ld = String(date.getDate()).padStart(2, "0");
    return `${ly}-${lm}-${ld}`;
  }
  return `${y}-${m}-${d}`;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(year, month - 1, day);
  return (
    dt.getFullYear() === year &&
    dt.getMonth() === month - 1 &&
    dt.getDate() === day
  );
}

function monthNameToNumber(name: string): number | undefined {
  const key = name.slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return map[key];
}
