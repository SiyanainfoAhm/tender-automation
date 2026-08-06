import {
  format,
  formatDistanceToNow,
  isValid,
  parseISO,
  type Locale,
} from "date-fns";

const CRORE = 1_00_00_000;
const LAKH = 1_00_000;

function formatUnitValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded % 1 === 0) {
    return rounded.toFixed(0);
  }
  return rounded.toFixed(2);
}

export function formatIndianCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs >= CRORE) {
    return `${sign}₹${formatUnitValue(abs / CRORE)} Cr`;
  }

  if (abs >= LAKH) {
    return `${sign}₹${formatUnitValue(abs / LAKH)} Lakh`;
  }

  return `${sign}₹${abs.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(value);
  return isValid(date) ? date : null;
}

export function formatDate(
  value: string | Date | null | undefined,
  pattern = "dd MMM yyyy",
  options?: { locale?: Locale },
): string {
  const date = toDate(value);
  if (!date) return "—";
  return format(date, pattern, options);
}

export function formatConfidence(
  value: number | null | undefined,
  options?: { decimals?: number },
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  const decimals = options?.decimals ?? 0;
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(decimals)}%`;
}

export function formatRelativeTime(
  value: string | Date | null | undefined,
  options?: { addSuffix?: boolean; locale?: Locale },
): string {
  const date = toDate(value);
  if (!date) return "—";

  return formatDistanceToNow(date, {
    addSuffix: options?.addSuffix ?? true,
    locale: options?.locale,
  });
}
