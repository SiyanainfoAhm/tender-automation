import type { TenderStatus } from "@/lib/tender-status";

/** Outcomes shown on the Submitted Tenders page. */
export const SUBMITTED_OUTCOME_STATUSES = [
  "SUBMITTED",
  "WON",
  "LOST",
] as const;

export type SubmittedOutcomeStatus =
  (typeof SUBMITTED_OUTCOME_STATUSES)[number];

export type SubmittedTenderListItem = {
  id: string;
  title: string;
  referenceNo: string | null;
  organization: string | null;
  portal: string | null;
  sourceRegion: "INDIAN" | "GLOBAL" | null;
  location: string | null;
  closingDate: string | null;
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

export type SubmittedTenderSummary = {
  total: number;
  submitted: number;
  won: number;
  lost: number;
};

export function summarizeSubmittedTenders(
  items: SubmittedTenderListItem[],
): SubmittedTenderSummary {
  let submitted = 0;
  let won = 0;
  let lost = 0;
  for (const item of items) {
    const status = String(item.qualificationStatus || "").toUpperCase();
    if (status === "WON") won += 1;
    else if (status === "LOST") lost += 1;
    else submitted += 1;
  }
  return { total: items.length, submitted, won, lost };
}

export function isSubmittedOutcomeStatus(
  value: string | null | undefined,
): value is SubmittedOutcomeStatus {
  const upper = String(value || "").toUpperCase();
  return (SUBMITTED_OUTCOME_STATUSES as readonly string[]).includes(upper);
}
