/**
 * Safe BidAssist / GeM date parser → YYYY-MM-DD.
 * Does not guess ambiguous 2-digit-year dates.
 */

const MONTHS: Record<string, number> = {
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export type ParsedBidAssistDate = {
  isoDate: string | null;
  originalText: string | null;
  valid: boolean;
  reason?: string;
};

/**
 * Parse common BidAssist / GeM date formats to YYYY-MM-DD.
 * Ambiguous values like 05/08/26 remain null.
 */
export function parseBidAssistDate(value: unknown): ParsedBidAssistDate {
  if (value === null || value === undefined) {
    return { isoDate: null, originalText: null, valid: false, reason: "empty" };
  }
  const original = String(value).replace(/\u00a0/g, " ").trim();
  if (!original || /^(--|—|–|n\/a|na|not available)$/i.test(original)) {
    return {
      isoDate: null,
      originalText: original || null,
      valid: false,
      reason: "empty_or_placeholder",
    };
  }

  // Reject ambiguous 2-digit year forms early
  if (/\b\d{1,2}[-/]\d{1,2}[-/]\d{2}\b/.test(original) && !/\d{4}/.test(original)) {
    return {
      isoDate: null,
      originalText: original,
      valid: false,
      reason: "ambiguous_year",
    };
  }

  // ISO / datetime: 2026-08-05 or 2026-08-05 14:00:00
  const iso = original.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (isValidYmd(year, month, day)) {
      return {
        isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
        originalText: original,
        valid: true,
      };
    }
  }

  // DMY: 05/08/2026, 05-08-2026, 10-08-2026 14:00:00
  const dmy = original.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T].*)?$/,
  );
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (isValidYmd(year, month, day)) {
      return {
        isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
        originalText: original,
        valid: true,
      };
    }
  }

  // 05 Aug 2026 / 5 August 2026
  const dMonY = original.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[ T,].*)?$/,
  );
  if (dMonY) {
    const day = Number(dMonY[1]);
    const month = MONTHS[dMonY[2]!.toLowerCase()];
    const year = Number(dMonY[3]);
    if (month && isValidYmd(year, month, day)) {
      return {
        isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
        originalText: original,
        valid: true,
      };
    }
  }

  // Aug 5, 2026 / August 5, 2026
  const monDY = original.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:[ T].*)?$/,
  );
  if (monDY) {
    const month = MONTHS[monDY[1]!.toLowerCase()];
    const day = Number(monDY[2]);
    const year = Number(monDY[3]);
    if (month && isValidYmd(year, month, day)) {
      return {
        isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
        originalText: original,
        valid: true,
      };
    }
  }

  // Embedded ISO or DMY inside longer PDF lines
  const embeddedIso = original.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (embeddedIso) {
    const year = Number(embeddedIso[1]);
    const month = Number(embeddedIso[2]);
    const day = Number(embeddedIso[3]);
    if (isValidYmd(year, month, day)) {
      return {
        isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
        originalText: original,
        valid: true,
      };
    }
  }
  const embeddedDmy = original.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (embeddedDmy) {
    const day = Number(embeddedDmy[1]);
    const month = Number(embeddedDmy[2]);
    const year = Number(embeddedDmy[3]);
    if (isValidYmd(year, month, day)) {
      return {
        isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
        originalText: original,
        valid: true,
      };
    }
  }

  return {
    isoDate: null,
    originalText: original,
    valid: false,
    reason: "unparseable",
  };
}
