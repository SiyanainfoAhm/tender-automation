/**
 * Historical Excel sheet naming / skip rules for Supabase-only backfill.
 *
 * Existing convention (21–24 Aug already in DB):
 *   table: agenttender_tenders
 *   conflict: source_portal,source_tender_id
 *   date field: scraped_date (+ raw_metadata.runDate)
 *   sheet field: none historically — we store excelSheetName / sheetDates in raw_metadata
 */
export const PROTECTED_SCRAPED_DATES = [
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
  "2026-08-24",
] as const;

export const PROTECTED_SCRAPED_DATE_SET = new Set<string>(PROTECTED_SCRAPED_DATES);

const MONTH: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function normalizeSheetKey(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sheets already imported (or empty) — never process. */
export function shouldSkipSheet(sheetName: string): boolean {
  const key = normalizeSheetKey(sheetName);
  if (!key) return true;
  if (key === "final") return true;
  if (key === "24" || key === "24 aug" || key === "24 august") return true;
  // "21 22 23" / "21 22 23 aug"
  if (/^21\s*22\s*23(\s+aug(ust)?)?$/.test(key)) return true;
  return false;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Parse dates implied by a sheet tab name.
 * "18 aug" → [2026-08-18]
 * "8 9 10 Aug" → [2026-08-08, 2026-08-09, 2026-08-10]
 * "19 & 20 aug" → [2026-08-19, 2026-08-20]
 * "21 22 23" → [2026-08-21, 2026-08-22, 2026-08-23]
 */
export function parseDatesFromSheetName(
  sheetName: string,
  defaultYear = 2026,
): string[] {
  const key = normalizeSheetKey(sheetName);
  if (!key || key === "final") return [];

  const monthMatch = key.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/,
  );
  const month = monthMatch ? MONTH[monthMatch[1]!] ?? null : null;

  // Bare day list without month → assume August (historical Aug workbook context)
  if (month == null) {
    if (/^(\d{1,2}\s+)+\d{1,2}$/.test(key) || /^\d{1,2}$/.test(key)) {
      const dayTokens = key.match(/\d{1,2}/g) || [];
      const days = [...new Set(dayTokens.map(Number).filter((d) => d >= 1 && d <= 31))].sort(
        (a, b) => a - b,
      );
      const out: string[] = [];
      for (const day of days) {
        const iso = isoDate(defaultYear, 8, day);
        if (iso) out.push(iso);
      }
      return out;
    }
    return [];
  }

  const beforeMonth = key.slice(0, monthMatch!.index).trim();
  const dayTokens = beforeMonth.match(/\d{1,2}/g) || [];
  const days = dayTokens
    .map((t) => Number(t))
    .filter((d) => d >= 1 && d <= 31);
  const uniqueDays = [...new Set(days)].sort((a, b) => a - b);
  const out: string[] = [];
  for (const day of uniqueDays) {
    const iso = isoDate(defaultYear, month, day);
    if (iso) out.push(iso);
  }
  return out;
}

export function sheetImpliesOnlyProtectedDates(sheetName: string): boolean {
  const dates = parseDatesFromSheetName(sheetName);
  if (dates.length === 0) return shouldSkipSheet(sheetName);
  return dates.every((d) => PROTECTED_SCRAPED_DATE_SET.has(d));
}
