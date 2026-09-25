import type { TenderStatus } from "@/lib/tender-status";

/** Outcomes shown on the Submitted Tenders page. */
export const SUBMITTED_OUTCOME_STATUSES = [
  "SUBMITTED",
  "WON",
  "LOST",
  "DUPLICATE",
] as const;

export type SubmittedOutcomeStatus =
  (typeof SUBMITTED_OUTCOME_STATUSES)[number];

/** Bid evaluation method shown on Submitted Tenders (from `tender_type`). */
export const L1_QCBS_METHODS = ["L1", "QCBS"] as const;

export type L1QcbsMethod = (typeof L1_QCBS_METHODS)[number];

export type SubmittedTenderListItem = {
  id: string;
  title: string;
  referenceNo: string | null;
  organization: string | null;
  portal: string | null;
  sourceRegion: "INDIAN" | "GLOBAL" | null;
  location: string | null;
  closingDate: string | null;
  /** Raw portal tender_type value (may be L1 / QCBS variants). */
  tenderType: string | null;
  /** Normalized L1 or QCBS from tender_type. */
  evaluationMethod: L1QcbsMethod | null;
  /** Calendar date the tender was scraped (`scraped_date`). */
  scrapedDate: string | null;
  tenderValue: number | null;
  /** Effective qualification status (SUBMITTED / WON / LOST, etc.). */
  qualificationStatus: TenderStatus | string;
  /** Bid workspace submission timestamp when available. */
  submittedAt: string | null;
  submissionReference: string | null;
  /** Required when status is LOST — stored in raw_metadata.lostReason. */
  lostReason: string | null;
  /** Linked won-project id when marked won. */
  wonProjectId: string | null;
  updatedAt: string | null;
};

/**
 * Map portal tender_type values (L1, l1-lowest-bidder, QCBS, qcbs-qcbc, …)
 * to a stable L1 / QCBS label for the Submitted Tenders screen.
 */
export function normalizeL1QcbsMethod(
  value: string | null | undefined,
): L1QcbsMethod | null {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw.includes("qcbs") || raw.includes("qcbc")) return "QCBS";
  if (/(^|[^a-z0-9])l1([^a-z0-9]|$)/.test(raw) || raw.includes("lowest")) {
    return "L1";
  }
  return null;
}

export type SubmittedTenderSummary = {
  total: number;
  submitted: number;
  won: number;
  lost: number;
  duplicate: number;
};

export function summarizeSubmittedTenders(
  items: SubmittedTenderListItem[],
): SubmittedTenderSummary {
  let submitted = 0;
  let won = 0;
  let lost = 0;
  let duplicate = 0;
  for (const item of items) {
    const status = String(item.qualificationStatus || "").toUpperCase();
    if (status === "WON") won += 1;
    else if (status === "LOST") lost += 1;
    else if (status === "DUPLICATE") duplicate += 1;
    else if (status === "CANCELLED" || status === "DELETE") {
      // Cancelled stays in the list but is not "awaiting outcome".
    } else submitted += 1;
  }
  return { total: items.length, submitted, won, lost, duplicate };
}

export function isSubmittedOutcomeStatus(
  value: string | null | undefined,
): value is SubmittedOutcomeStatus {
  const upper = String(value || "").toUpperCase();
  return (SUBMITTED_OUTCOME_STATUSES as readonly string[]).includes(upper);
}
