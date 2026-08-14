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
  CONDITIONAL_GO: "May Bid",
  PARTNER_BID: "Partnership",
  VERIFY: "Screening",
  NO_GO: "No Bid",
};

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
