/**
 * Central document-section lock rules for Tender Details.
 * Status values are DB/qualification enums.
 */

export type DocumentAccessStatus = string | null | undefined;

function normalizeStatus(raw: DocumentAccessStatus): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

const BIDDING_UNLOCK = new Set([
  "GO",
  "WILL_BID",
  "PARTNER_BID",
  "PARTNERSHIP",
  "SUBMITTED",
  "WON",
  "AWARDED",
]);

const FINANCIAL_UNLOCK = new Set([
  "CONDITIONAL_GO",
  "MAY_BID",
  "GO",
  "WILL_BID",
  "PARTNER_BID",
  "PARTNERSHIP",
  "SUBMITTED",
  "WON",
  "AWARDED",
]);

const DELIVERABLE_UNLOCK = new Set(["WON", "AWARDED"]);

const FEE_ELIGIBLE = new Set([
  "CONDITIONAL_GO",
  "MAY_BID",
  "GO",
  "WILL_BID",
  "PARTNER_BID",
  "PARTNERSHIP",
  "SUBMITTED",
  "WON",
  "AWARDED",
]);

export function canAccessTenderDocuments(_status?: DocumentAccessStatus): boolean {
  return true;
}

export function canAccessBiddingDocuments(status: DocumentAccessStatus): boolean {
  return BIDDING_UNLOCK.has(normalizeStatus(status));
}

export function canAccessFinancialDocuments(status: DocumentAccessStatus): boolean {
  return FINANCIAL_UNLOCK.has(normalizeStatus(status));
}

export function canAccessDeliverables(status: DocumentAccessStatus): boolean {
  return DELIVERABLE_UNLOCK.has(normalizeStatus(status));
}

export function canCreateFeeForTender(status: DocumentAccessStatus): boolean {
  return FEE_ELIGIBLE.has(normalizeStatus(status));
}

export function biddingDocumentsLockReason(status: DocumentAccessStatus): string {
  if (canAccessBiddingDocuments(status)) return "";
  return "Bidding documents unlock when status is Will Bid, Partnership, Submitted, or Won.";
}

export function financialDocumentsLockReason(status: DocumentAccessStatus): string {
  if (canAccessFinancialDocuments(status)) return "";
  return "Financial documents unlock from May Bid onward.";
}

export function deliverablesLockReason(status: DocumentAccessStatus): string {
  if (canAccessDeliverables(status)) return "";
  return "Project deliverables unlock after the tender is Won.";
}
