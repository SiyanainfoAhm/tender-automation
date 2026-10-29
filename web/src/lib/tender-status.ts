export const TENDER_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
  "DUPLICATE",
  "WON",
  "LOST",
  "DISQUALIFIED",
  "SUBMITTED",
  "CANCELLED",
  "TECHNICAL_REJECTED",
  "FINANCIAL_REJECTED",
  "DELETE",
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

/** Labels match the stored DB values exactly (GO, CONDITIONAL_GO, …) so screens and backend never disagree. */
export const STATUS_DISPLAY_LABELS: Record<TenderStatus, string> = {
  GO: "GO",
  CONDITIONAL_GO: "CONDITIONAL_GO",
  PARTNER_BID: "PARTNER_BID",
  VERIFY: "VERIFY",
  NO_GO: "NO_GO",
  DUPLICATE: "DUPLICATE",
  WON: "WON",
  LOST: "LOST",
  DISQUALIFIED: "DISQUALIFIED",
  SUBMITTED: "SUBMITTED",
  CANCELLED: "CANCELLED",
  TECHNICAL_REJECTED: "TECHNICAL_REJECTED",
  FINANCIAL_REJECTED: "FINANCIAL_REJECTED",
  DELETE: "DELETE",
};

/**
 * Visible list/dashboard buckets aligned with bid pipeline stages.
 */
export const TENDER_UI_STATUSES = [
  "verify",
  "may_bid",
  "will_bid",
  "partnership",
  "submitted",
  "won",
  "lost",
  "disqualified",
  "technical_rejected",
  "financial_rejected",
  "delete",
  "no_bid",
  "duplicate",
  "cancelled",
  "not_evaluated",
] as const;

export type TenderUiStatus = (typeof TENDER_UI_STATUSES)[number];

export const TENDER_UI_STATUS_LABELS: Record<TenderUiStatus, string> = {
  verify: "VERIFY",
  may_bid: "CONDITIONAL_GO",
  will_bid: "GO",
  partnership: "PARTNER_BID",
  submitted: "SUBMITTED",
  won: "WON",
  lost: "LOST",
  disqualified: "DISQUALIFIED",
  technical_rejected: "TECHNICAL_REJECTED",
  financial_rejected: "FINANCIAL_REJECTED",
  delete: "DELETE",
  no_bid: "NO_GO",
  duplicate: "DUPLICATE",
  cancelled: "CANCELLED",
  not_evaluated: "NOT_EVALUATED",
};

export const TENDER_UI_STATUS_COLORS: Record<TenderUiStatus, string> = {
  verify: "#0ea5e9",
  may_bid: "#f59e0b",
  will_bid: "#059669",
  partnership: "#7c3aed",
  submitted: "#3b82f6",
  won: "#16a34a",
  lost: "#b91c1c",
  disqualified: "#9f1239",
  technical_rejected: "#c2410c",
  financial_rejected: "#9a3412",
  delete: "#64748b",
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
  { value: "verify", label: "VERIFY" },
  { value: "may_bid", label: "CONDITIONAL_GO" },
  { value: "will_bid", label: "GO" },
  { value: "partnership", label: "PARTNER_BID" },
  { value: "submitted", label: "SUBMITTED" },
  { value: "won", label: "WON" },
  { value: "lost", label: "LOST" },
  { value: "disqualified", label: "DISQUALIFIED" },
  { value: "technical_rejected", label: "TECHNICAL_REJECTED" },
  { value: "financial_rejected", label: "FINANCIAL_REJECTED" },
  { value: "delete", label: "DELETE" },
  { value: "no_bid", label: "NO_GO" },
  { value: "duplicate", label: "DUPLICATE" },
  { value: "cancelled", label: "CANCELLED" },
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
    // Legacy DB value — never shown as its own UI status.
    value === "UNDER_EVALUATION" ||
    value === "SCREENING"
  ) {
    return "not_evaluated";
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
  if (value === "DELETE") return "delete";
  if (value === "VERIFY") return "verify";
  if (value === "CONDITIONAL_GO" || value === "MAY_BID") return "may_bid";
  return "not_evaluated";
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

  if (
    ui === "not_evaluated" ||
    upper === "NOT_EVALUATED" ||
    // Legacy filter URLs — treat as unevaluated (null status).
    ui === "under_evaluation" ||
    upper === "UNDER_EVALUATION"
  ) {
    return { kind: "null" };
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
  if (ui === "delete" || upper === "DELETE") {
    return { kind: "in", values: ["DELETE"] };
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
  NO_GO: "#dc2626",
  DUPLICATE: "#6b7280",
  WON: "#16a34a",
  LOST: "#b91c1c",
  DISQUALIFIED: "#9f1239",
  SUBMITTED: "#3b82f6",
  CANCELLED: "#78716c",
  TECHNICAL_REJECTED: "#c2410c",
  FINANCIAL_REJECTED: "#9a3412",
  DELETE: "#64748b",
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
  "DUPLICATE",
  "WON",
  "LOST",
  "CANCELLED",
  "TECHNICAL_REJECTED",
  "FINANCIAL_REJECTED",
  "DELETE",
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
 * After submission: Technical Rejected / Financial Rejected.
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
    current === "DUPLICATE" ||
    current === "CANCELLED" ||
    current === "TECHNICAL_REJECTED" ||
    current === "FINANCIAL_REJECTED" ||
    current === "DELETE"
  ) {
    return [current as TenderStatus];
  }

  // SUBMITTED and other post-submission mid-states
  return ["SUBMITTED", "TECHNICAL_REJECTED", "FINANCIAL_REJECTED", "DELETE"];
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
    value === "WON" ||
    value === "LOST" ||
    value === "CANCELLED" ||
    value === "TECHNICAL_REJECTED" ||
    value === "FINANCIAL_REJECTED" ||
    value === "DELETE"
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
    status === "FINANCIAL_REJECTED" ||
    status === "DELETE"
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
