import { recoverInrAmountFromText, normalizeMoneySourceText } from "@/lib/format-inr";
import { isTenderStatus } from "@/lib/tender-classification";
import {
  STATUS_DISPLAY_LABELS,
  tenderUiStatusLabel,
  type TenderStatus,
} from "@/lib/tender-status";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

export const TENDER_EXPORT_COLUMN_HEADERS = [
  "Title",
  "Source",
  "Reference No.",
  "Organization",
  "Category",
  "Status",
  "Reason",
  "MSME Exemption",
  "Startup Exemption",
  "Scraped Date",
  "Created At",
  "Closing Date",
  "Value",
  "EMD",
  "Tender ID",
] as const;

export type ExportMoneyValue = number | "Not disclosed" | string;

export function exportDateStamp(d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function buildTenderExportAllFilename(): string {
  return `tenders-${exportDateStamp()}.xlsx`;
}

export function buildTenderPageExportFilename(page: number): string {
  return `tenders-page-${page}-${exportDateStamp()}.xlsx`;
}

export function buildTenderSelectedExportFilename(count: number): string {
  return `tenders-selected-${count}-${exportDateStamp()}.xlsx`;
}

/** @deprecated Use buildTenderExportAllFilename */
export function buildTenderExportFilename(_total?: number): string {
  return buildTenderExportAllFilename();
}

export function formatExemptionExport(
  value: boolean | null | undefined,
): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

export function tenderExportReason(row: WebTenderListRow): string {
  return (row.screening_reason || row.reason || "").trim();
}

export function tenderExportStatusLabel(
  status: string | null | undefined,
): string {
  if (!status) return tenderUiStatusLabel(null);
  const normalized = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (isTenderStatus(normalized)) {
    return STATUS_DISPLAY_LABELS[normalized as TenderStatus];
  }
  return tenderUiStatusLabel(status);
}

export function toExcelDate(value: unknown): Date | string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";

  const isoDateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1]);
    const month = Number(isoDateOnly[2]);
    const day = Number(isoDateOnly[3]);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  return parsed;
}

/** Numeric INR for Excel formatting, or readable text when not disclosed. */
export function exportMoneyCellValue(
  amount: number | null | undefined,
  text: string | null | undefined,
): ExportMoneyValue {
  if (typeof amount === "number" && Number.isFinite(amount)) {
    const recovered = recoverInrAmountFromText(amount, text);
    if (typeof recovered === "number" && Number.isFinite(recovered)) {
      return recovered;
    }
    return amount;
  }

  const normalized = normalizeMoneySourceText(text);
  if (normalized) {
    const lower = normalized.toLowerCase();
    if (
      lower.includes("not disclosed") ||
      lower.includes("refer") ||
      lower.includes("as per")
    ) {
      return "Not disclosed";
    }
    if (!/^[\d₹]/.test(normalized) && !/^rs\.?\s/i.test(normalized)) {
      return normalized;
    }
  }

  return "Not disclosed";
}
