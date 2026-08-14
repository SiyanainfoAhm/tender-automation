import {
  format,
  formatDistanceToNow,
  isValid,
  parseISO,
  type Locale,
} from "date-fns";

import { formatInrCompactAmount } from "@/lib/format-inr";

/**
 * Compact INR for KPIs / charts.
 * null → "—" (aggregates / empty cells). Prefer formatTenderValue for tender rows.
 */
export function formatIndianCurrency(value: number | null | undefined): string {
  return formatInrCompactAmount(value) ?? "—";
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

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export {
  formatEmdAmount,
  formatInrCompactAmount,
  formatInrFullAmount,
  formatTenderValue,
  parseInrInput,
} from "@/lib/format-inr";
