import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

/**
 * Main list shows ChatGPT prescreen text only (not screening/qualification decision reason).
 */
export function tenderListPrescreenReason(row: WebTenderListRow): string {
  return String(row.prescreen_reason || "").trim();
}

/** @deprecated Use tenderListPrescreenReason — kept for call-site compatibility. */
export function tenderListDecisionReason(row: WebTenderListRow): string {
  return tenderListPrescreenReason(row);
}

/** Metadata-only: do not HEAD Azure from the list. */
export function tenderListHasDocuments(row: WebTenderListRow): boolean {
  if (row.document_archive_available === true) return true;
  return Boolean(String(row.documents_zip_url || "").trim());
}

/** Metadata-only: AI summary path or availability flag. */
export function tenderListHasAiSummary(row: WebTenderListRow): boolean {
  if (row.ai_summary_available === true) return true;
  return Boolean(String(row.ai_summary_url || "").trim());
}

export function tenderDocumentsDetailHref(tenderId: string): string {
  return `/tenders/${tenderId}?tab=documents`;
}

export function tenderAiSummaryDetailHref(tenderId: string): string {
  return `/tenders/${tenderId}?tab=documents&focus=ai-summary`;
}
