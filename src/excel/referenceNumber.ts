import { isValidReferenceNumber } from "../runScreening/duplicateScreening.js";

/** Trim only — preserve punctuation and internal spacing from Excel. */
export function cleanReferenceNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(value).trim() || null;
  }
  const text = String(value).trim();
  return text || null;
}

/** Excel Reference No. → DB value; blank/placeholder tokens → null. */
export function referenceNoFromExcel(value: unknown): string | null {
  const text = cleanReferenceNumber(value);
  if (!text) return null;
  if (!isValidReferenceNumber(text)) return null;
  return text;
}

export function referenceNoForWorkbookRow(row: {
  referenceNo?: string | null;
  bidAssistId?: string | null;
  tender247Id?: string | null;
}): string | null {
  const primary = referenceNoFromExcel(row.referenceNo);
  if (primary) return primary;

  const legacyBidAssist = referenceNoFromExcel(row.bidAssistId);
  if (!legacyBidAssist) return null;

  const tenderId = String(row.tender247Id ?? "").trim();
  if (tenderId && legacyBidAssist === tenderId) return null;

  return legacyBidAssist;
}
