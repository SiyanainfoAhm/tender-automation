import { resolveTenderArtifactUrls } from "@/lib/tenders/resolve-document-urls";
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

function listArtifactUrls(row: WebTenderListRow) {
  return resolveTenderArtifactUrls({
    document_urls: (row as WebTenderListRow & { document_urls?: unknown })
      .document_urls,
    documents_zip_url: row.documents_zip_url,
    ai_summary_url: row.ai_summary_url,
  });
}

/**
 * Show documents icon only when a real SharePoint zip URL exists.
 * Do not trust document_archive_available alone (can be stale).
 */
export function tenderListHasDocuments(row: WebTenderListRow): boolean {
  return Boolean(listArtifactUrls(row).documentsZipUrl);
}

/**
 * Show AI summary icon only when a real SharePoint AI summary URL exists.
 * Do not trust ai_summary_available alone (can be true with no file).
 */
export function tenderListHasAiSummary(row: WebTenderListRow): boolean {
  return Boolean(listArtifactUrls(row).aiSummaryUrl);
}

/** Prefer document_urls / SharePoint column values for AI summary viewer. */
export function tenderListAiSummaryUrl(row: WebTenderListRow): string | null {
  return listArtifactUrls(row).aiSummaryUrl;
}

export function tenderDocumentsDetailHref(tenderId: string): string {
  return `/tenders/${tenderId}?tab=documents`;
}

export function tenderAiSummaryDetailHref(tenderId: string): string {
  return `/tenders/${tenderId}?tab=documents&focus=ai-summary`;
}
