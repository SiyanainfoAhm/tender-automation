/**
 * Indian financial year helpers for Reports.
 * FY 2025-26 = 2025-04-01 inclusive → 2026-04-01 exclusive.
 */
import { addMonths, format } from "date-fns";

import { generateFinancialYears } from "@/lib/company/types";

export type FinancialYearKey = string; // "2025-26"

const FY_KEY_RE = /^(\d{4})-(\d{2})$/;

export function currentFinancialYearKey(reference = new Date()): FinancialYearKey {
  const month = reference.getMonth();
  const year = reference.getFullYear();
  const startYear = month < 3 ? year - 1 : year;
  const end = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${end}`;
}

export function parseFinancialYearKey(
  raw: string | string[] | undefined | null,
  reference = new Date(),
): FinancialYearKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return currentFinancialYearKey(reference);
  const trimmed = value.replace(/^FY\s+/i, "").trim();
  if (FY_KEY_RE.test(trimmed)) return trimmed;
  return currentFinancialYearKey(reference);
}

export function financialYearLabel(key: FinancialYearKey): string {
  return `FY ${key}`;
}

export function financialYearBounds(key: FinancialYearKey): {
  from: Date;
  toExclusive: Date;
  fromIso: string;
  toExclusiveIso: string;
} {
  const match = key.match(FY_KEY_RE);
  const startYear = match ? Number(match[1]) : new Date().getFullYear();
  const from = new Date(startYear, 3, 1, 0, 0, 0, 0);
  const toExclusive = new Date(startYear + 1, 3, 1, 0, 0, 0, 0);
  return {
    from,
    toExclusive,
    fromIso: from.toISOString(),
    toExclusiveIso: toExclusive.toISOString(),
  };
}

export function financialYearOptions(count = 6, reference = new Date()): Array<{
  key: FinancialYearKey;
  label: string;
}> {
  return generateFinancialYears(count, reference).map((label) => ({
    key: label.replace(/^FY\s+/i, ""),
    label,
  }));
}

export function financialYearMonths(key: FinancialYearKey): Array<{
  key: string;
  label: string;
}> {
  const { from } = financialYearBounds(key);
  const months: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < 12; i += 1) {
    const d = addMonths(from, i);
    months.push({
      key: format(d, "yyyy-MM"),
      label: format(d, "MMM yyyy"),
    });
  }
  return months;
}

export function isInFinancialYear(
  date: Date | null,
  bounds: { from: Date; toExclusive: Date },
): boolean {
  if (!date) return false;
  const t = date.getTime();
  return t >= bounds.from.getTime() && t < bounds.toExclusive.getTime();
}
