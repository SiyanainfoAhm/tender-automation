export const TENDER_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "UNDER_EVALUATION",
  "NO_GO",
  "DUPLICATE",
  "WON",
  "LOST",
  "DISQUALIFIED",
  "SUBMITTED",
  "CANCELLED",
  "TECHNICAL_REJECTED",
  "FINANCIAL_REJECTED",
] as const;

export type TenderStatus = (typeof TENDER_STATUSES)[number];

/** Strictly qualified — Siyana qualifies independently. */
export const QUALIFIED_STATUSES = ["GO"] as const;

/** Positive but may require conditions or partner arrangement. */
export const ACTIONABLE_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
] as const;

export const MANUAL_REVIEW_STATUSES = ["VERIFY"] as const;

export const REJECTED_STATUSES = [
  "NO_GO",
  "LOST",
  "DISQUALIFIED",
  "CANCELLED",
  "TECHNICAL_REJECTED",
  "FINANCIAL_REJECTED",
] as const;

/** Presentation labels only — stored DB values remain GO / CONDITIONAL_GO / etc. */
export const STATUS_DISPLAY_LABELS: Record<TenderStatus, string> = {
  GO: "Will Bid",
  CONDITIONAL_GO: "May Bid",
  PARTNER_BID: "Partnership",
  VERIFY: "Verify",
  UNDER_EVALUATION: "Under Evaluation",
  NO_GO: "No Bid",
  DUPLICATE: "Duplicate",
  WON: "Won",
  LOST: "Lost",
  DISQUALIFIED: "Disqualified",
  SUBMITTED: "Submitted",
  CANCELLED: "Tender cancelled",
  TECHNICAL_REJECTED: "Technical Rejected",
  FINANCIAL_REJECTED: "Financial Rejected",
};

/**
 * Visible list/dashboard buckets aligned with bid pipeline stages.
 */
export const TENDER_UI_STATUSES = [
  "verify",
  "under_evaluation",
  "may_bid",
  "will_bid",
  "partnership",
  "submitted",
  "won",
  "lost",
  "disqualified",
  "technical_rejected",
  "financial_rejected",
  "no_bid",
  "duplicate",
  "cancelled",
  "not_evaluated",
] as const;

export type TenderUiStatus = (typeof TENDER_UI_STATUSES)[number];

export const TENDER_UI_STATUS_LABELS: Record<TenderUiStatus, string> = {
  verify: "Verify",
  under_evaluation: "Under Evaluation",
  may_bid: "May Bid",
  will_bid: "Will Bid",
  partnership: "Partnership",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  disqualified: "Disqualified",
  technical_rejected: "Technical Rejected",
  financial_rejected: "Financial Rejected",
  no_bid: "No Bid",
  duplicate: "Duplicate",
  cancelled: "Tender cancelled",
  not_evaluated: "Not Evaluated",
};

export const TENDER_UI_STATUS_COLORS: Record<TenderUiStatus, string> = {
  verify: "#0ea5e9",
  under_evaluation: "#64748b",
  may_bid: "#f59e0b",
  will_bid: "#059669",
  partnership: "#7c3aed",
  submitted: "#3b82f6",
  won: "#16a34a",
  lost: "#b91c1c",
  disqualified: "#9f1239",
  technical_rejected: "#c2410c",
  financial_rejected: "#9a3412",
  no_bid: "#dc2626",
  duplicate: "#6b7280",
  cancelled: "#78716c",
  not_evaluated: "#94a3b8",
};

/** Filter chips for Tender Management. */
export const TENDER_LIST_STATUS_FILTERS: Array<{
  value: string;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "verify", label: "Verify" },
  { value: "under_evaluation", label: "Under Evaluation" },
  { value: "may_bid", label: "May Bid" },
  { value: "will_bid", label: "Will Bid" },
  { value: "partnership", label: "Partnership" },
  { value: "submitted", label: "Submitted" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "disqualified", label: "Disqualified" },
  { value: "technical_rejected", label: "Technical Rejected" },
  { value: "financial_rejected", label: "Financial Rejected" },
  { value: "no_bid", label: "No Bid" },
  { value: "duplicate", label: "Duplicate" },
  { value: "cancelled", label: "Tender cancelled" },
];

export function getTenderUiStatus(
  rawStatus: string | null | undefined,
): TenderUiStatus {
  const value = String(rawStatus || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (
    !value ||
    value === "NOT_EVALUATED" ||
    value === "NEW" ||
    value === "UNDER_EVALUATION"
  ) {
    return "under_evaluation";
  }
  if (value === "GO" || value === "WILL_BID") return "will_bid";
  if (value === "PARTNER_BID" || value === "PARTNERSHIP") return "partnership";
  if (value === "NO_GO" || value === "NO_BID") return "no_bid";
  if (value === "DUPLICATE") return "duplicate";
  if (value === "CANCELLED" || value === "CANCELED") return "cancelled";
  if (value === "SUBMITTED") return "submitted";
  if (value === "WON" || value === "AWARDED") return "won";
  if (value === "LOST") return "lost";
  if (value === "DISQUALIFIED") return "disqualified";
  if (value === "TECHNICAL_REJECTED") return "technical_rejected";
  if (value === "FINANCIAL_REJECTED") return "financial_rejected";
  if (value === "VERIFY") return "verify";
  if (value === "CONDITIONAL_GO" || value === "MAY_BID") return "may_bid";
  if (value === "SCREENING") return "under_evaluation";
  return "under_evaluation";
}

export function tenderUiStatusLabel(
  rawStatus: string | null | undefined,
): string {
  return TENDER_UI_STATUS_LABELS[getTenderUiStatus(rawStatus)];
}

/** DB qualification values for a list/dashboard status filter. */
export function qualificationStatusesForFilter(
  raw: string | null | undefined,
): { kind: "all" } | { kind: "null" } | { kind: "in"; values: string[] } {
  const value = String(raw || "ALL").trim();
  if (!value || value === "ALL") return { kind: "all" };
  const upper = value.toUpperCase().replace(/[\s-]+/g, "_");
  const ui = value.toLowerCase().replace(/[\s-]+/g, "_");

  if (ui === "not_evaluated" || upper === "NOT_EVALUATED") {
    return { kind: "null" };
  }
  if (ui === "under_evaluation" || upper === "UNDER_EVALUATION") {
    return { kind: "in", values: ["UNDER_EVALUATION"] };
  }
  if (ui === "verify" || upper === "VERIFY") {
    return { kind: "in", values: ["VERIFY"] };
  }
  if (ui === "may_bid" || upper === "MAY_BID" || upper === "CONDITIONAL_GO") {
    return { kind: "in", values: ["CONDITIONAL_GO"] };
  }
  if (ui === "screening" || upper === "SCREENING") {
    return { kind: "in", values: ["VERIFY", "CONDITIONAL_GO"] };
  }
  if (ui === "will_bid" || upper === "WILL_BID") {
    return { kind: "in", values: ["GO"] };
  }
  if (ui === "partnership" || upper === "PARTNERSHIP") {
    return { kind: "in", values: ["PARTNER_BID"] };
  }
  if (ui === "no_bid" || upper === "NO_BID") {
    return { kind: "in", values: ["NO_GO"] };
  }
  if (ui === "duplicate" || upper === "DUPLICATE") {
    return { kind: "in", values: ["DUPLICATE"] };
  }
  if (ui === "won" || upper === "WON" || upper === "AWARDED") {
    return { kind: "in", values: ["WON"] };
  }
  if (ui === "lost" || upper === "LOST") {
    return { kind: "in", values: ["LOST"] };
  }
  if (ui === "disqualified" || upper === "DISQUALIFIED") {
    return { kind: "in", values: ["DISQUALIFIED"] };
  }
  if (ui === "technical_rejected" || upper === "TECHNICAL_REJECTED") {
    return { kind: "in", values: ["TECHNICAL_REJECTED"] };
  }
  if (ui === "financial_rejected" || upper === "FINANCIAL_REJECTED") {
    return { kind: "in", values: ["FINANCIAL_REJECTED"] };
  }
  if (ui === "submitted" || upper === "SUBMITTED") {
    return { kind: "in", values: ["SUBMITTED"] };
  }
  if (ui === "cancelled" || ui === "canceled" || upper === "CANCELLED" || upper === "CANCELED") {
    return { kind: "in", values: ["CANCELLED"] };
  }
  if ((TENDER_STATUSES as readonly string[]).includes(upper)) {
    return { kind: "in", values: [upper] };
  }
  return { kind: "all" };
}

/** Chart colors — decision distribution (not qualification semantics). */
export const DECISION_CHART_COLORS: Record<TenderStatus | "NOT_EVALUATED", string> = {
  GO: "#059669",
  CONDITIONAL_GO: "#d97706",
  PARTNER_BID: "#7c3aed",
  VERIFY: "#2563eb",
  UNDER_EVALUATION: "#64748b",
  NO_GO: "#dc2626",
  DUPLICATE: "#6b7280",
  WON: "#16a34a",
  LOST: "#b91c1c",
  DISQUALIFIED: "#9f1239",
  SUBMITTED: "#3b82f6",
  CANCELLED: "#78716c",
  TECHNICAL_REJECTED: "#c2410c",
  FINANCIAL_REJECTED: "#9a3412",
  NOT_EVALUATED: "#94a3b8",
};

export function isQualifiedStatus(
  status: string | null | undefined,
): status is (typeof QUALIFIED_STATUSES)[number] {
  return status === "GO";
}

/** Outcomes that replace the pre-submission pipeline after a bid is submitted. */
export const POST_SUBMISSION_STATUSES = [
  "SUBMITTED",
  "UNDER_EVALUATION",
  "DUPLICATE",
  "WON",
  "LOST",
  "CANCELLED",
  "TECHNICAL_REJECTED",
  "FINANCIAL_REJECTED",
] as const;

export function isPostSubmissionStatus(
  status: string | null | undefined,
): boolean {
  const value = String(status || "")
    .trim()
    .toUpperCase();
  return (POST_SUBMISSION_STATUSES as readonly string[]).includes(value);
}

/**
 * Status choices on tender details.
 * - Submitted → Technical Rejected / Financial Rejected
 * - Under Evaluation → Technical Rejected / Financial Rejected
 * Terminal outcomes lock to themselves.
 */
export function tenderDetailStatusChoices(options: {
  currentStatus: string | null | undefined;
  submitted?: boolean;
}): readonly TenderStatus[] {
  const current = String(options.currentStatus || "")
    .trim()
    .toUpperCase();
  const pastSubmission =
    options.submitted === true || isPostSubmissionStatus(current);
  if (!pastSubmission) return TENDER_STATUSES;

  if (
    current === "WON" ||
    current === "LOST" ||
    current === "CANCELLED" ||
    current === "TECHNICAL_REJECTED" ||
    current === "FINANCIAL_REJECTED"
  ) {
    return [current as TenderStatus];
  }

  if (current === "UNDER_EVALUATION") {
    return [
      "UNDER_EVALUATION",
      "TECHNICAL_REJECTED",
      "FINANCIAL_REJECTED",
    ];
  }

  // SUBMITTED and other post-submission mid-states
  return ["SUBMITTED", "TECHNICAL_REJECTED", "FINANCIAL_REJECTED"];
}

/**
 * Once the bid workspace is submitted, a leftover pre-submission status
 * (for example Will Bid) must not be what tender details displays.
 */
export function resolveDisplayedDetailStatus(options: {
  qualificationStatus: TenderStatus | null;
  submitted: boolean;
}): TenderStatus | null {
  if (
    options.submitted &&
    !isPostSubmissionStatus(options.qualificationStatus)
  ) {
    return "SUBMITTED";
  }
  return options.qualificationStatus;
}

/** Bid Workspace stays available from Will Bid through later outcomes. */
export function canOpenBidWorkspace(
  status: string | null | undefined,
): boolean {
  const value = String(status || "")
    .trim()
    .toUpperCase();
  return (
    value === "GO" ||
    value === "SUBMITTED" ||
    value === "UNDER_EVALUATION" ||
    value === "WON" ||
    value === "LOST" ||
    value === "CANCELLED" ||
    value === "TECHNICAL_REJECTED" ||
    value === "FINANCIAL_REJECTED"
  );
}

export function isActionableStatus(
  status: string | null | undefined,
): boolean {
  return (
    status != null &&
    (ACTIONABLE_STATUSES as readonly string[]).includes(status)
  );
}

export function isRejectedStatus(
  status: string | null | undefined,
): boolean {
  return (
    status === "NO_GO" ||
    status === "CANCELLED" ||
    status === "LOST" ||
    status === "DISQUALIFIED" ||
    status === "TECHNICAL_REJECTED" ||
    status === "FINANCIAL_REJECTED"
  );
}

export type TenderListRow = {
  effective_qualification_status: string | null;
  qualified_at: string | null;
};

/** Rows eligible for the “Recently qualified” dashboard section (GO only). */
export function filterRecentlyQualifiedRows<T extends TenderListRow>(
  rows: T[],
): T[] {
  return rows.filter(
    (row) =>
      isQualifiedStatus(row.effective_qualification_status) &&
      row.qualified_at != null,
  );
}

/** Rows eligible for the “Recently actionable” dashboard section. */
export function filterRecentlyActionableRows<T extends TenderListRow>(
  rows: T[],
): T[] {
  return rows.filter(
    (row) =>
      isActionableStatus(row.effective_qualification_status) &&
      row.qualified_at != null,
  );
}
