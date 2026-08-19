export const TENDER_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
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

export const REJECTED_STATUSES = ["NO_GO"] as const;

/** Presentation labels only — stored DB values remain GO / CONDITIONAL_GO / etc. */
export const STATUS_DISPLAY_LABELS: Record<TenderStatus, string> = {
  GO: "Will Bid",
  CONDITIONAL_GO: "Screening",
  PARTNER_BID: "Partnership",
  VERIFY: "Screening",
  NO_GO: "No Bid",
};

/**
 * Visible list/dashboard buckets. CONDITIONAL_GO and VERIFY both map to
 * Screening so the UI never shows a duplicate May Bid stage.
 */
export const TENDER_UI_STATUSES = [
  "screening",
  "will_bid",
  "partnership",
  "submitted",
  "won",
  "no_bid",
  "not_evaluated",
] as const;

export type TenderUiStatus = (typeof TENDER_UI_STATUSES)[number];

export const TENDER_UI_STATUS_LABELS: Record<TenderUiStatus, string> = {
  screening: "Screening",
  will_bid: "Will Bid",
  partnership: "Partnership",
  submitted: "Submitted",
  won: "Won",
  no_bid: "No Bid",
  not_evaluated: "Not Evaluated",
};

export const TENDER_UI_STATUS_COLORS: Record<TenderUiStatus, string> = {
  screening: "#2563eb",
  will_bid: "#059669",
  partnership: "#7c3aed",
  submitted: "#3b82f6",
  won: "#16a34a",
  no_bid: "#dc2626",
  not_evaluated: "#94a3b8",
};

/** Filter chips for Tender Management (pipeline-only Submitted/Won omitted). */
export const TENDER_LIST_STATUS_FILTERS: Array<{
  value: string;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "screening", label: "Screening" },
  { value: "will_bid", label: "Will Bid" },
  { value: "partnership", label: "Partnership" },
  { value: "no_bid", label: "No Bid" },
  { value: "not_evaluated", label: "Not Evaluated" },
];

export function getTenderUiStatus(
  rawStatus: string | null | undefined,
): TenderUiStatus {
  const value = String(rawStatus || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!value || value === "NOT_EVALUATED" || value === "NEW") {
    return "not_evaluated";
  }
  if (value === "GO" || value === "WILL_BID") return "will_bid";
  if (value === "PARTNER_BID" || value === "PARTNERSHIP") return "partnership";
  if (value === "NO_GO" || value === "NO_BID") return "no_bid";
  if (value === "SUBMITTED") return "submitted";
  if (value === "WON") return "won";
  if (
    value === "VERIFY" ||
    value === "MAY_BID" ||
    value === "SCREENING" ||
    value === "CONDITIONAL_GO"
  ) {
    return "screening";
  }
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

  if (ui === "not_evaluated" || upper === "NOT_EVALUATED") {
    return { kind: "null" };
  }
  if (ui === "screening" || upper === "SCREENING" || upper === "MAY_BID") {
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
  NOT_EVALUATED: "#94a3b8",
};

export function isQualifiedStatus(
  status: string | null | undefined,
): status is (typeof QUALIFIED_STATUSES)[number] {
  return status === "GO";
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
  return status === "NO_GO";
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
